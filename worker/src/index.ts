import { buildMessage, decide, DEFAULT_SETTINGS, parseSettings, parseSlots } from './rain.ts';
import type { AlertSettings, Slot } from './rain.ts';
import { base64urlToBytes, importVapidPrivateKey, sendPush } from './webpush.ts';
import type { PushTarget } from './webpush.ts';

/** Types minimaux (pas besoin des types Cloudflare pour ce petit fichier). */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  SUBS: KV;
  /** Origines autorisées à appeler l'API, séparées par des virgules */
  ALLOWED_ORIGINS: string;
  /** Clé publique VAPID (base64url) */
  VAPID_PUBLIC_KEY: string;
  /** Adresse de contact pour les services de push (URL https ou mailto:) */
  VAPID_SUBJECT: string;
  /** Clé privée VAPID au format JWK (secret) */
  VAPID_PRIVATE_JWK: string;
}

interface Subscriber extends PushTarget {
  lat: number;
  lon: number;
  timezone: string;
  /** Pas d'alerte avant cet instant (ms) */
  quietUntil: number;
  /** Réglages choisis par l'utilisateur (absents pour les abonnés antérieurs : valeurs par défaut) */
  settings?: AlertSettings;
}

const STORE_KEY = 'subs';
/** Garde-fou : le plan gratuit limite à 50 requêtes sortantes par exécution. */
const MAX_SUBSCRIBERS = 20;
const MAX_BODY_CHARS = 4096;
/** Seuls les vrais services de push sont acceptés : le Worker ne doit pas pouvoir être détourné vers d'autres sites. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

type Store = Record<string, Subscriber>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadStore(env: Env): Promise<Store> {
  const raw = await env.SUBS.get(STORE_KEY);
  return raw ? (JSON.parse(raw) as Store) : {};
}

function saveStore(env: Env, store: Store): Promise<void> {
  return env.SUBS.put(STORE_KEY, JSON.stringify(store));
}

function validTimeZone(value: unknown): string {
  if (typeof value !== 'string') return 'UTC';
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

function isPushTarget(value: unknown): value is PushTarget {
  if (typeof value !== 'object' || value === null) return false;
  const { endpoint, keys } = value as Partial<PushTarget>;
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !keys) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return false;
  try {
    const p256dh = base64urlToBytes(String(keys.p256dh));
    const auth = base64urlToBytes(String(keys.auth));
    return p256dh.length === 65 && p256dh[0] === 4 && auth.length === 16;
  } catch {
    return false;
  }
}

/** Les coordonnées sont arrondies à 0,01° (environ 1 km) avant d'être enregistrées. */
function roundCoord(value: unknown, limit: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) return null;
  return Math.round(value * 100) / 100;
}

function corsHeaders(request: Request, env: Env): Record<string, string> | null {
  const origin = request.headers.get('Origin');
  if (!origin) return {}; // appel hors navigateur (test, cron) : pas de CORS
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function vapidConfig(env: Env) {
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: await importVapidPrivateKey(JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey),
  };
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (cors === null) return new Response('Origine non autorisée', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === '/') {
    return json({ name: 'pluvia-alerts', ok: true }, 200, cors);
  }
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, cors);

  const body = await readJson(request);
  if (!body) return json({ error: 'Corps de requête invalide' }, 400, cors);

  // Inscription (ou mise à jour du lieu surveillé).
  if (path === '/subscribe') {
    const lat = roundCoord(body.lat, 90);
    const lon = roundCoord(body.lon, 180);
    if (!isPushTarget(body.subscription) || lat === null || lon === null) {
      return json({ error: 'Abonnement ou position invalide' }, 400, cors);
    }
    const { endpoint, keys } = body.subscription;
    const id = await sha256Hex(endpoint);
    const store = await loadStore(env);
    if (!store[id] && Object.keys(store).length >= MAX_SUBSCRIBERS) {
      return json({ error: 'Nombre maximal d’abonnés atteint' }, 429, cors);
    }
    const previous = store[id];
    const moved = !previous || previous.lat !== lat || previous.lon !== lon;
    store[id] = {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      lat,
      lon,
      timezone: validTimeZone(body.timezone),
      // Nouveau lieu : on repart de zéro pour pouvoir alerter tout de suite.
      quietUntil: moved ? 0 : previous.quietUntil,
      // Réglages absents de la requête : on garde les précédents.
      settings: body.settings === undefined ? (previous?.settings ?? { ...DEFAULT_SETTINGS }) : parseSettings(body.settings),
    };
    await saveStore(env, store);
    return json({ ok: true }, 200, cors);
  }

  // Désinscription : supprime l'abonné et sa position.
  if (path === '/unsubscribe') {
    if (typeof body.endpoint !== 'string') return json({ error: 'Adresse manquante' }, 400, cors);
    const id = await sha256Hex(body.endpoint);
    const store = await loadStore(env);
    if (store[id]) {
      delete store[id];
      await saveStore(env, store);
    }
    return json({ ok: true }, 200, cors);
  }

  // Notification de test, pour vérifier que tout fonctionne sans attendre la pluie.
  if (path === '/test') {
    if (typeof body.endpoint !== 'string') return json({ error: 'Adresse manquante' }, 400, cors);
    const store = await loadStore(env);
    const sub = store[await sha256Hex(body.endpoint)];
    if (!sub) return json({ error: 'Abonnement inconnu' }, 404, cors);
    const status = await sendPush(
      sub,
      { title: 'Pluvia : notification de test', body: 'Les alertes de pluie fonctionnent.', tag: 'pluvia-test' },
      await vapidConfig(env),
    );
    return json({ ok: status >= 200 && status < 300, status }, 200, cors);
  }

  return json({ error: 'Introuvable' }, 404, cors);
}

async function fetchSlots(lat: number, lon: number, nowMs: number, fetcher: typeof fetch): Promise<Slot[] | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    minutely_15: 'precipitation',
    forecast_days: '2',
    timeformat: 'unixtime',
    timezone: 'UTC',
  });
  try {
    const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return parseSlots((await response.json()) as Parameters<typeof parseSlots>[0], nowMs);
  } catch {
    return null;
  }
}

/** Tâche planifiée : pour chaque abonné, regarde si la pluie arrive et envoie l'alerte. */
export async function runAlerts(env: Env, nowMs: number = Date.now(), fetcher: typeof fetch = fetch): Promise<number> {
  const store = await loadStore(env);
  const ids = Object.keys(store);
  if (ids.length === 0) return 0;

  // Une seule requête météo par lieu, même si plusieurs abonnés sont au même endroit.
  const places = new Map<string, Slot[] | null>();
  await Promise.all(
    [...new Set(ids.map((id) => `${store[id].lat},${store[id].lon}`))].map(async (key) => {
      const [lat, lon] = key.split(',').map(Number);
      places.set(key, await fetchSlots(lat, lon, nowMs, fetcher));
    }),
  );

  const vapid = await vapidConfig(env);
  let sent = 0;
  let changed = false;

  for (const id of ids) {
    const sub = store[id];
    const slots = places.get(`${sub.lat},${sub.lon}`);
    if (!slots) continue; // météo indisponible : on réessaiera au prochain passage

    const decision = decide(slots, nowMs, sub.quietUntil, sub.settings ?? DEFAULT_SETTINGS);
    const previousQuiet = sub.quietUntil;
    if (decision.quietUntil !== previousQuiet) {
      sub.quietUntil = decision.quietUntil;
      changed = true;
    }
    if (!decision.alert) continue;

    try {
      const status = await sendPush(sub, { ...buildMessage(decision.alert, sub.timezone), tag: 'pluvia-rain' }, vapid, fetcher);
      if (status === 404 || status === 410) {
        delete store[id]; // l'abonnement n'existe plus (appli désinstallée, autorisation retirée)
        changed = true;
      } else if (status >= 200 && status < 300) {
        sent++;
      } else {
        sub.quietUntil = previousQuiet; // échec temporaire : nouvel essai au prochain passage
      }
    } catch (error) {
      sub.quietUntil = previousQuiet;
      console.error('Envoi impossible', error);
    }
  }

  if (changed) await saveStore(env, store);
  return sent;
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): void => {
    ctx.waitUntil(runAlerts(env).catch((error) => console.error('Tâche planifiée en échec', error)));
  },
};
