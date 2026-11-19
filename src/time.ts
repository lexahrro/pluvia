/**
 * Affichage des heures dans le fuseau du lieu consulté (et non celui de l'appareil) :
 * pour un lieu à New York, « 14:00 » doit être l'heure de New York.
 */

let zone: string | undefined;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Fuseau IANA du lieu (ex. « Europe/Paris »). Fuseau invalide ou absent : celui de l'appareil. */
export function setDisplayTimeZone(timeZone: string | undefined): void {
  if (!timeZone) {
    zone = undefined;
    return;
  }
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone });
    zone = timeZone;
  } catch {
    zone = undefined;
  }
}

function formatter(id: string, options: Intl.DateTimeFormatOptions, timeZone: string | undefined): Intl.DateTimeFormat {
  const key = `${id}|${timeZone ?? ''}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('fr-FR', { ...options, timeZone });
    formatters.set(key, f);
  }
  return f;
}

/** « 14:05 » dans le fuseau du lieu. */
export function formatTime(date: Date): string {
  return formatter('time', { hour: '2-digit', minute: '2-digit' }, zone).format(date);
}

/** « 14:05 » dans le fuseau de l'appareil (heure de dernière mise à jour, par exemple). */
export function formatDeviceTime(date: Date): string {
  return formatter('time', { hour: '2-digit', minute: '2-digit' }, undefined).format(date);
}

/** « ven. » dans le fuseau du lieu. */
export function formatWeekday(date: Date): string {
  return formatter('weekday', { weekday: 'short' }, zone).format(date);
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

function localParts(date: Date): LocalParts {
  const parts = formatter(
    'parts',
    { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' },
    zone,
  ).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

/** Heure (0-23) dans le fuseau du lieu. */
export function localHour(date: Date): number {
  return localParts(date).hour;
}

/** Nombre de jours calendaires entre `reference` et `date`, dans le fuseau du lieu. */
export function dayDifference(date: Date, reference: Date): number {
  const a = localParts(date);
  const b = localParts(reference);
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / dayMs);
}
