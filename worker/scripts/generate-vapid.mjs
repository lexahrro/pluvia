// Génère la paire de clés VAPID (ECDSA P-256) qui identifie ton serveur auprès des services de push.
//  - la clé PRIVÉE reste dans worker/vapid-private.jwk.json (ignoré par git) puis dans un secret Cloudflare ;
//  - la clé PUBLIQUE est écrite dans worker/vapid-public.txt : elle est publique, on peut la mettre dans le code.
import { webcrypto } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const privatePath = `${dir}vapid-private.jwk.json`;
const publicPath = `${dir}vapid-public.txt`;

if (existsSync(privatePath)) {
  console.error('Une clé existe déjà (vapid-private.jwk.json). Je ne l\'écrase pas : en changer invaliderait tous les abonnements.');
  process.exit(1);
}

const { subtle } = webcrypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
const publicKey = Buffer.from(publicRaw).toString('base64url');

writeFileSync(privatePath, JSON.stringify(privateJwk), { mode: 0o600 });
writeFileSync(publicPath, `${publicKey}\n`);
console.log('Clés générées.');
console.log(`Clé publique : ${publicKey}`);
