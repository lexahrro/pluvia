/**
 * Web Push sans bibliothèque, avec la seule API WebCrypto (disponible dans Cloudflare Workers) :
 *  - chiffrement du message : RFC 8291 (contenu « aes128gcm », RFC 8188) ;
 *  - authentification du serveur : VAPID, RFC 8292 (jeton JWT signé ES256).
 */

const encoder = new TextEncoder();

export function base64urlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF (extraction puis expansion) avec SHA-256. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export interface EncryptOptions {
  /** Réservé aux tests (vecteur de la RFC 8291) : clé éphémère et sel imposés. */
  ephemeral?: { privateKey: CryptoKey; publicRaw: Uint8Array };
  salt?: Uint8Array;
}

/**
 * Chiffre `plaintext` pour un abonnement :
 * `uaPublic` = clé publique p256dh (65 octets), `authSecret` = secret auth (16 octets).
 * Renvoie le corps complet de la requête (en-tête aes128gcm + données chiffrées).
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array> {
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (options.ephemeral) {
    asPrivate = options.ephemeral.privateKey;
    asPublic = options.ephemeral.publicRaw;
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // Un seul enregistrement : on ajoute le délimiteur 0x02 (dernier enregistrement) après les données.
  const padded = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const recordSize = new Uint8Array([0, 0, 0x10, 0]); // 4096, entier non signé sur 4 octets
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** Importe la clé privée VAPID (JWK de la courbe P-256) pour signer. */
export function importVapidPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** En-tête Authorization VAPID : « vapid t=<jwt>, k=<clé publique> ». */
export async function vapidAuthorization(
  endpoint: string,
  subject: string,
  publicKey: string,
  privateKey: CryptoKey,
  nowMs: number = Date.now(),
): Promise<string> {
  const header = bytesToBase64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToBase64url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(nowMs / 1000) + 12 * 3600, // moins de 24 h, comme l'impose la RFC
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto renvoie la signature au format brut r||s (64 octets), celui attendu par JWT.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToBase64url(signature)}, k=${publicKey}`;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: CryptoKey;
}

/** Envoie une notification. Renvoie le code HTTP du service de push (201 = accepté, 404/410 = abonnement mort). */
export async function sendPush(
  target: PushTarget,
  message: unknown,
  vapid: VapidConfig,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const body = await encryptPayload(
    encoder.encode(JSON.stringify(message)),
    base64urlToBytes(target.keys.p256dh),
    base64urlToBytes(target.keys.auth),
  );
  const response = await fetcher(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Une alerte de pluie ne vaut plus rien après une demi-heure.
      TTL: '1800',
      Urgency: 'high',
    },
    body,
  });
  return response.status;
}
