/**
 * Alertes de pluie : abonnement aux notifications push (Web Push) et échanges avec la fonction
 * Cloudflare « pluvia-alerts », qui surveille la météo et envoie les notifications.
 */

/** Adresse de la fonction Cloudflare (voir le dossier worker/). */
export const ALERTS_API = 'https://pluvia-alerts.pluvia-alerts.workers.dev';
/** Clé publique VAPID (publique : elle identifie le serveur d'alertes auprès du navigateur). */
const VAPID_PUBLIC_KEY = 'BHBX446bNyAwvS1lNsKCeO6RNKF8t_kxjHUtq9TsGVehbYk4coEzA8QV1ExSwDwyoO_XPUeSMuDa6cfLzJMLH1M';
const STORAGE_KEY = 'pluvia:alerts:v1';
const SETTINGS_KEY = 'pluvia:alerts:settings:v1';

export interface AlertPlace {
  lat: number;
  lon: number;
  name: string;
  timezone: string;
  /** Nom de la ville choisie, pour l'afficher dans la notification (absent pour la position GPS) */
  city?: string;
}

export type MinLevel = 'any' | 'moderate' | 'heavy';

/** Réglages des alertes (le même format est envoyé au serveur). */
export interface AlertSettings {
  /** Prévenir quand la pluie commence dans moins de ce délai (minutes) */
  leadMin: 15 | 30 | 60;
  minLevel: MinLevel;
  /** Plage « ne pas déranger » en heures locales de l'appareil ; null = désactivée */
  quiet: { from: string; to: string } | null;
}

export const DEFAULT_SETTINGS: AlertSettings = { leadMin: 30, minLevel: 'any', quiet: null };
/** Plage proposée à l'activation de « ne pas déranger ». */
export const DEFAULT_QUIET = { from: '23:00', to: '07:00' };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function loadSettings(): AlertSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) as Partial<AlertSettings> & { quiet?: { from?: unknown; to?: unknown } | null };
    const quiet =
      v.quiet && typeof v.quiet.from === 'string' && typeof v.quiet.to === 'string' && TIME.test(v.quiet.from) && TIME.test(v.quiet.to)
        ? { from: v.quiet.from, to: v.quiet.to }
        : null;
    return {
      leadMin: v.leadMin === 15 || v.leadMin === 60 ? v.leadMin : 30,
      minLevel: v.minLevel === 'moderate' || v.minLevel === 'heavy' ? v.minLevel : 'any',
      quiet,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: AlertSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* stockage indisponible : les réglages restent valables côté serveur */
  }
}

/** Réglages tels qu'envoyés au serveur : la plage silencieuse est liée au fuseau de l'appareil. */
function serverSettings(settings: AlertSettings): unknown {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return { leadMin: settings.leadMin, minLevel: settings.minLevel, quiet: settings.quiet ? { ...settings.quiet, timeZone } : null };
}

/** Phrase résumant les réglages, pour l'affichage. */
export function describeSettings(settings: AlertSettings): string {
  const lead = settings.leadMin === 60 ? '1 heure' : `${settings.leadMin} minutes`;
  const what = { any: 'une pluie', moderate: 'une pluie modérée ou forte', heavy: 'une pluie forte' }[settings.minLevel];
  const quiet = settings.quiet ? ` Pas de notification de ${settings.quiet.from} à ${settings.quiet.to}.` : '';
  return `Tu es prévenu quand ${what} commence dans moins de ${lead} (une alerte par épisode).${quiet}`;
}

export type Support = 'ok' | 'ios-install' | 'unsupported';

/** Les alertes demandent un service worker, l'API Push et l'API Notification. */
export function alertsSupport(): Support {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (apple && !standalone) return 'ios-install'; // sur iPhone, seulement une fois ajoutée à l'écran d'accueil
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return ok ? 'ok' : 'unsupported';
}

export function loadSavedPlace(): AlertPlace | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<AlertPlace>;
    if (typeof value.lat !== 'number' || typeof value.lon !== 'number' || typeof value.name !== 'string') {
      return undefined;
    }
    return { lat: value.lat, lon: value.lon, name: value.name, timezone: value.timezone ?? 'UTC', city: typeof value.city === 'string' ? value.city : undefined };
  } catch {
    return undefined;
  }
}

function savePlace(place: AlertPlace | undefined): void {
  try {
    if (place) localStorage.setItem(STORAGE_KEY, JSON.stringify(place));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* stockage indisponible : l'abonnement reste valable côté serveur */
  }
}

/** Même lieu à 0,01° près (environ 1 km), comme côté serveur. */
export function samePlace(a: AlertPlace, b: AlertPlace): boolean {
  const r = (n: number): number => Math.round(n * 100);
  return r(a.lat) === r(b.lat) && r(a.lon) === r(b.lon);
}

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  // En développement (npm run dev), il n'y a pas de service worker : les alertes ne sont pas disponibles.
  if (!(await navigator.serviceWorker.getRegistration())) return undefined;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 4000)),
  ]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${ALERTS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Le serveur d'alertes a répondu ${response.status}.`);
  return response;
}

/** Demande l'autorisation, s'abonne et enregistre le lieu surveillé. Lève une Error lisible en cas d'échec. */
export async function enableAlerts(place: AlertPlace): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Les notifications n’ont pas été autorisées.');
  const reg = await registration();
  if (!reg) throw new Error('Le service worker n’est pas prêt. Recharge la page et réessaie.');
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlToBytes(VAPID_PUBLIC_KEY) }));
  await post('/subscribe', { subscription: subscription.toJSON(), lat: place.lat, lon: place.lon, timezone: place.timezone, city: place.city, settings: serverSettings(loadSettings()) });
  savePlace(place);
}

/** Change le lieu surveillé (l'abonnement reste le même). */
export async function moveAlerts(place: AlertPlace): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Aucun abonnement actif.');
  await post('/subscribe', { subscription: subscription.toJSON(), lat: place.lat, lon: place.lon, timezone: place.timezone, city: place.city, settings: serverSettings(loadSettings()) });
  savePlace(place);
}

/** Enregistre de nouveaux réglages (sur l'appareil, puis sur le serveur pour le lieu déjà surveillé). */
export async function updateSettings(settings: AlertSettings): Promise<void> {
  const place = loadSavedPlace();
  const subscription = await currentSubscription();
  if (!place || !subscription) throw new Error('Aucun abonnement actif.');
  await post('/subscribe', { subscription: subscription.toJSON(), lat: place.lat, lon: place.lon, timezone: place.timezone, city: place.city, settings: serverSettings(settings) });
  saveSettings(settings);
}

/** Supprime l'abonnement et la position côté serveur, puis côté navigateur. */
export async function disableAlerts(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) {
    try {
      await post('/unsubscribe', { endpoint: subscription.endpoint });
    } finally {
      await subscription.unsubscribe();
    }
  }
  savePlace(undefined);
}

/** Demande au serveur d'envoyer une notification de test. */
export async function sendTest(): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Aucun abonnement actif.');
  const response = await post('/test', { endpoint: subscription.endpoint });
  const result = (await response.json()) as { ok?: boolean };
  return result.ok === true;
}
