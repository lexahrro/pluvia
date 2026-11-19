/**
 * Alertes de pluie : abonnement aux notifications push (Web Push) et échanges avec la fonction
 * Cloudflare « pluvia-alerts », qui surveille la météo et envoie les notifications.
 */

/** Adresse de la fonction Cloudflare (voir le dossier worker/). */
export const ALERTS_API = 'https://pluvia-alerts.pluvia-alerts.workers.dev';
/** Clé publique VAPID (publique : elle identifie le serveur d'alertes auprès du navigateur). */
const VAPID_PUBLIC_KEY = 'BHBX446bNyAwvS1lNsKCeO6RNKF8t_kxjHUtq9TsGVehbYk4coEzA8QV1ExSwDwyoO_XPUeSMuDa6cfLzJMLH1M';
const STORAGE_KEY = 'pluvia:alerts:v1';

export interface AlertPlace {
  lat: number;
  lon: number;
  name: string;
  timezone: string;
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
    return { lat: value.lat, lon: value.lon, name: value.name, timezone: value.timezone ?? 'UTC' };
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
  await post('/subscribe', { subscription: subscription.toJSON(), lat: place.lat, lon: place.lon, timezone: place.timezone });
  savePlace(place);
}

/** Change le lieu surveillé (l'abonnement reste le même). */
export async function moveAlerts(place: AlertPlace): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Aucun abonnement actif.');
  await post('/subscribe', { subscription: subscription.toJSON(), lat: place.lat, lon: place.lon, timezone: place.timezone });
  savePlace(place);
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
