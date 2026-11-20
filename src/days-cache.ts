import type { DaysForecast } from './days.ts';

const KEY = 'pluvia:days:v1';
/** Nombre maximum de lieux dont on garde les prévisions par jour. */
const MAX_ENTRIES = 4;
/** Au-delà, les données mémorisées sont trop anciennes pour être affichées. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Stored {
  savedAt: number;
  forecast: DaysForecast;
}

export interface CachedDays {
  savedAt: Date;
  forecast: DaysForecast;
}

function readAll(): Record<string, Stored> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, Stored>) : {};
  } catch {
    return {};
  }
}

/** Mémorise les prévisions par jour d'un lieu, pour les afficher hors ligne. Ne lève jamais d'erreur. */
export function saveDays(key: string, forecast: DaysForecast, now: Date = new Date()): void {
  try {
    const all = readAll();
    all[key] = { savedAt: now.getTime(), forecast };
    const kept = Object.entries(all)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // stockage plein ou indisponible : on s'en passe
  }
}

/** Relit les dernières prévisions par jour de CE lieu ; null si rien, trop ancien ou illisible. */
export function loadDays(key: string, now: Date = new Date()): CachedDays | null {
  try {
    const stored = readAll()[key];
    if (!stored || now.getTime() - stored.savedAt > MAX_AGE_MS) return null;
    if (!stored.forecast || !Array.isArray(stored.forecast.days)) return null;
    return { savedAt: new Date(stored.savedAt), forecast: stored.forecast };
  } catch {
    return null;
  }
}
