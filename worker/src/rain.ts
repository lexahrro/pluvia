/** Logique de décision des alertes (pure : aucune entrée / sortie, donc testable). */

/** Cumul sur 15 minutes à partir duquel on considère qu'il pleut (0,1 mm / 15 min = 0,4 mm/h). */
export const RAIN_MM_15 = 0.1;
/** Délai d'alerte par défaut : on prévient quand la pluie commence dans moins de 30 minutes. */
export const ALERT_WINDOW_MS = 30 * 60_000;
/** Deux averses séparées par moins de 4 créneaux secs (1 h) comptent comme un seul épisode. */
const MAX_DRY_GAP_SLOTS = 4;
/** Silence après la fin prévue de l'épisode, pour ne pas alerter deux fois pour la même pluie. */
const QUIET_AFTER_MS = 60 * 60_000;
const SLOT_MS = 15 * 60_000;

export type MinLevel = 'any' | 'moderate' | 'heavy';

/** Réglages choisis par l'utilisateur pour ses alertes. */
export interface AlertSettings {
  /** Prévenir quand la pluie commence dans moins de ce délai (minutes) */
  leadMin: 15 | 30 | 60;
  /** Intensité minimale pour déclencher une alerte */
  minLevel: MinLevel;
  /** Plage « ne pas déranger » (heures locales du fuseau indiqué) ; null = désactivée */
  quiet: { from: string; to: string; timeZone: string } | null;
}

export const DEFAULT_SETTINGS: AlertSettings = { leadMin: 30, minLevel: 'any', quiet: null };

/** Seuil de déclenchement en mm/h : toute pluie (0,4), modérée (2,5) ou forte (7,6). */
const LEVEL_MM_PER_HOUR: Record<MinLevel, number> = { any: RAIN_MM_15 * 4, moderate: 2.5, heavy: 7.6 };

const LEADS = [15, 30, 60];
const LEVELS = ['any', 'moderate', 'heavy'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validZone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Valide des réglages reçus du client ; toute valeur invalide est remplacée par la valeur par défaut. */
export function parseSettings(value: unknown): AlertSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const v = value as Record<string, unknown>;
  const q = v.quiet as Record<string, unknown> | null | undefined;
  const quiet =
    q && typeof q === 'object' && typeof q.from === 'string' && typeof q.to === 'string' && TIME.test(q.from) && TIME.test(q.to) && validZone(q.timeZone)
      ? { from: q.from, to: q.to, timeZone: q.timeZone }
      : null;
  return {
    leadMin: (LEADS.includes(v.leadMin as number) ? v.leadMin : DEFAULT_SETTINGS.leadMin) as AlertSettings['leadMin'],
    minLevel: (LEVELS.includes(v.minLevel as string) ? v.minLevel : DEFAULT_SETTINGS.minLevel) as MinLevel,
    quiet,
  };
}

function minutesOfDay(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(ms);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** Vrai si l'instant tombe dans la plage silencieuse (qui peut passer minuit, ex. 23:00 → 07:00). */
export function inQuietHours(quiet: AlertSettings['quiet'], nowMs: number): boolean {
  if (!quiet) return false;
  const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const from = toMin(quiet.from);
  const to = toMin(quiet.to);
  if (from === to) return false;
  const now = minutesOfDay(nowMs, quiet.timeZone);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export interface Slot {
  start: number;
  end: number;
  /** Précipitations de la période [start, end[, en mm */
  mm: number;
}

interface MinutelyResponse {
  minutely_15?: { time?: number[]; precipitation?: (number | null)[] };
}

/**
 * Créneaux de 15 min à venir. Comme dans l'application, l'heure fournie par Open-Meteo
 * est la FIN de la période sur laquelle les précipitations sont cumulées.
 */
export function parseSlots(json: MinutelyResponse, nowMs: number): Slot[] {
  const time = json.minutely_15?.time;
  const rain = json.minutely_15?.precipitation;
  if (!Array.isArray(time) || !Array.isArray(rain)) throw new Error('Réponse Open-Meteo inattendue');
  const slots: Slot[] = [];
  time.forEach((t, i) => {
    const mm = rain[i];
    const end = t * 1000;
    if (mm === null || mm === undefined || end <= nowMs) return;
    slots.push({ start: end - SLOT_MS, end, mm });
  });
  return slots;
}

export interface Alert {
  /** Début de la pluie, en ms */
  startMs: number;
  /** Fin prévue de l'épisode ; null si la prévision s'arrête avant la fin */
  endMs: number | null;
  /** Délai avant le début, en minutes */
  minutes: number;
  /** Débit maximal prévu, en mm/h */
  peakMmPerHour: number;
  /** Cumul prévu sur l'épisode (jusqu'à la fin de la prévision si elle s'arrête avant), en mm */
  totalMm: number;
}

export interface Decision {
  alert: Alert | null;
  /** Nouvelle valeur du « silence jusqu'à » à enregistrer pour cet abonné */
  quietUntil: number;
}

export function decide(
  slots: Slot[],
  nowMs: number,
  quietUntil: number,
  settings: AlertSettings = DEFAULT_SETTINGS,
): Decision {
  const rainy = slots.map((s) => s.mm >= RAIN_MM_15);
  const threshold = LEVEL_MM_PER_HOUR[settings.minLevel];
  const strong = slots.map((s) => s.mm * 4 >= threshold - 1e-9);

  // Une pluie de l'intensité demandée est déjà en cours : pas d'alerte, et on reste silencieux tant que ça dure (+ 1 h).
  if (slots.length > 0 && strong[0] && slots[0].start <= nowMs) {
    return { alert: null, quietUntil: Math.max(quietUntil, nowMs + QUIET_AFTER_MS) };
  }
  if (nowMs < quietUntil) return { alert: null, quietUntil };
  // Plage « ne pas déranger » : on ne notifie pas (la pluie encore à venir à la fin de la plage sera signalée alors).
  if (inQuietHours(settings.quiet, nowMs)) return { alert: null, quietUntil };

  // Premier créneau atteignant l'intensité demandée : c'est lui qui déclenche l'alerte (s'il est assez proche).
  const trigger = strong.indexOf(true);
  if (trigger === -1 || slots[trigger].start - nowMs > settings.leadMin * 60_000) return { alert: null, quietUntil };

  // Fin de l'épisode : dernier créneau pluvieux, en tolérant de courtes accalmies.
  let last = trigger;
  let dry = 0;
  for (let k = trigger + 1; k < slots.length; k++) {
    if (rainy[k]) {
      last = k;
      dry = 0;
    } else if (++dry > MAX_DRY_GAP_SLOTS) {
      break;
    }
  }
  const endsInsideForecast = last < slots.length - 1;
  const peak = Math.max(...slots.slice(trigger, last + 1).map((s) => s.mm * 4));
  const endMs = slots[last].end;
  const totalMm = slots.slice(trigger, last + 1).reduce((sum, s) => sum + s.mm, 0);

  return {
    alert: {
      startMs: slots[trigger].start,
      endMs: endsInsideForecast ? endMs : null,
      minutes: Math.max(1, Math.round((slots[trigger].start - nowMs) / 60_000)),
      peakMmPerHour: peak,
      totalMm,
    },
    quietUntil: endMs + QUIET_AFTER_MS,
  };
}

export function intensityLabel(mmPerHour: number): string {
  if (mmPerHour < 2.5) return 'faible';
  if (mmPerHour < 7.6) return 'modérée';
  return 'forte';
}

function clock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(ms);
}

function formatMm(mm: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.round(mm * 10) / 10);
}

/** Nom de ville accepté (texte court, sans caractères de contrôle) ; undefined sinon. */
export function cleanCity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const city = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return city.length > 0 && city.length <= 60 ? city : undefined;
}

/** Texte de la notification, avec les heures dans le fuseau du lieu surveillé. */
export function buildMessage(alert: Alert, timeZone: string, city?: string): { title: string; body: string } {
  const start = clock(alert.startMs, timeZone);
  const until = alert.endMs === null ? 'pour un moment' : `jusqu'à environ ${clock(alert.endMs, timeZone)}`;
  const amount = `${formatMm(alert.totalMm)} mm prévus`;
  return {
    title: `Pluie ${intensityLabel(alert.peakMmPerHour)} dans ${alert.minutes} min`,
    body: `À partir de ${start}, ${until}.\n${city ? `${city} · ${amount}` : amount}`,
  };
}
