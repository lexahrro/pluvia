import type { Position } from './location.ts';
import type { CurrentConditions, Forecast, HourForecast, RainSlot } from './weather.ts';

const KEY = 'pluvia:last-forecast:v1';
const HOUR_MS = 60 * 60 * 1000;
/** Au-delà, les données mémorisées sont trop anciennes pour être affichées. */
const MAX_AGE_MS = 12 * HOUR_MS;

interface StoredForecast {
  savedAt: number;
  position: Position;
  rainSlots: { start: number; end: number; mm: number }[];
  hours: (Omit<HourForecast, 'time'> & { time: number })[];
  current: CurrentConditions | null;
}

export interface CachedForecast {
  savedAt: Date;
  position: Position;
  forecast: Forecast;
}

/** Mémorise la dernière prévision pour l'afficher hors ligne. Ne lève jamais d'erreur. */
export function saveForecast(position: Position, forecast: Forecast, now: Date = new Date()): void {
  const stored: StoredForecast = {
    savedAt: now.getTime(),
    position,
    rainSlots: forecast.rainSlots.map((s) => ({ start: s.start.getTime(), end: s.end.getTime(), mm: s.mm })),
    hours: forecast.hours.map((h) => ({ ...h, time: h.time.getTime() })),
    current: forecast.current,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // stockage plein ou indisponible (navigation privée) : on s'en passe
  }
}

/**
 * Relit la dernière prévision mémorisée, en retirant ce qui est déjà passé.
 * Renvoie null s'il n'y a rien, si c'est trop ancien ou si les données sont illisibles.
 */
export function loadForecast(now: Date = new Date()): CachedForecast | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredForecast;
    if (now.getTime() - stored.savedAt > MAX_AGE_MS) return null;

    const rainSlots: RainSlot[] = stored.rainSlots
      .filter((s) => s.end > now.getTime())
      .map((s) => ({ start: new Date(s.start), end: new Date(s.end), mm: s.mm }));
    const hours: HourForecast[] = stored.hours
      .filter((h) => h.time + HOUR_MS > now.getTime())
      .map((h) => ({ ...h, time: new Date(h.time) }));
    if (rainSlots.length === 0) return null;

    return {
      savedAt: new Date(stored.savedAt),
      position: stored.position,
      forecast: { rainSlots, hours, current: stored.current },
    };
  } catch {
    return null;
  }
}
