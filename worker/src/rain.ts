/** Logique de décision des alertes (pure : aucune entrée / sortie, donc testable). */

/** Cumul sur 15 minutes à partir duquel on considère qu'il pleut (0,1 mm / 15 min = 0,4 mm/h). */
export const RAIN_MM_15 = 0.1;
/** On prévient quand la pluie commence dans moins de ce délai. */
export const ALERT_WINDOW_MS = 30 * 60_000;
/** Deux averses séparées par moins de 4 créneaux secs (1 h) comptent comme un seul épisode. */
const MAX_DRY_GAP_SLOTS = 4;
/** Silence après la fin prévue de l'épisode, pour ne pas alerter deux fois pour la même pluie. */
const QUIET_AFTER_MS = 60 * 60_000;
const SLOT_MS = 15 * 60_000;

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
}

export interface Decision {
  alert: Alert | null;
  /** Nouvelle valeur du « silence jusqu'à » à enregistrer pour cet abonné */
  quietUntil: number;
}

export function decide(slots: Slot[], nowMs: number, quietUntil: number): Decision {
  const rainy = slots.map((s) => s.mm >= RAIN_MM_15);

  // Il pleut déjà : pas d'alerte, et on reste silencieux tant que ça dure (+ 1 h).
  if (slots.length > 0 && rainy[0] && slots[0].start <= nowMs) {
    return { alert: null, quietUntil: Math.max(quietUntil, nowMs + QUIET_AFTER_MS) };
  }
  if (nowMs < quietUntil) return { alert: null, quietUntil };

  const first = rainy.indexOf(true);
  if (first === -1 || slots[first].start - nowMs > ALERT_WINDOW_MS) return { alert: null, quietUntil };

  // Fin de l'épisode : dernier créneau pluvieux, en tolérant de courtes accalmies.
  let last = first;
  let dry = 0;
  for (let k = first + 1; k < slots.length; k++) {
    if (rainy[k]) {
      last = k;
      dry = 0;
    } else if (++dry > MAX_DRY_GAP_SLOTS) {
      break;
    }
  }
  const endsInsideForecast = last < slots.length - 1;
  const peak = Math.max(...slots.slice(first, last + 1).map((s) => s.mm * 4));
  const endMs = slots[last].end;

  return {
    alert: {
      startMs: slots[first].start,
      endMs: endsInsideForecast ? endMs : null,
      minutes: Math.max(1, Math.round((slots[first].start - nowMs) / 60_000)),
      peakMmPerHour: peak,
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

/** Texte de la notification, avec les heures dans le fuseau du lieu surveillé. */
export function buildMessage(alert: Alert, timeZone: string): { title: string; body: string } {
  const start = clock(alert.startMs, timeZone);
  const until = alert.endMs === null ? 'pour un moment' : `jusqu'à environ ${clock(alert.endMs, timeZone)}`;
  return {
    title: `Pluie ${intensityLabel(alert.peakMmPerHour)} dans ${alert.minutes} min`,
    body: `À partir de ${start}, ${until}.`,
  };
}
