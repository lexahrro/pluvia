import type { Position } from './location.ts';
import type { CurrentConditions, Forecast, HourForecast, RainSlot } from './weather.ts';

const KEY = 'pluvia:forecasts:v3';
/** Nombre maximum de lieux dont on garde la dernière prévision. */
const MAX_ENTRIES = 6;
const HOUR_MS = 60 * 60 * 1000;
/** Au-delà, les données mémorisées sont trop anciennes pour être affichées. */
const MAX_AGE_MS = 12 * HOUR_MS;

interface StoredForecast {
  /** Lieu auquel appartient la prévision (« gps » ou « place:<id> ») */
  key: string;
  savedAt: number;
  position: Position;
  timezone: string | undefined;
  uvMaxToday?: number | null;
  rainTodayMm?: number | null;
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
export function saveForecast(
  key: string,
  position: Position,
  forecast: Forecast,
  now: Date = new Date(),
): void {
  const stored: StoredForecast = {
    key,
    savedAt: now.getTime(),
    position,
    timezone: forecast.timezone,
    uvMaxToday: forecast.uvMaxToday,
    rainTodayMm: forecast.rainTodayMm,
    rainSlots: forecast.rainSlots.map((s) => ({ start: s.start.getTime(), end: s.end.getTime(), mm: s.mm })),
    hours: forecast.hours.map((h) => ({ ...h, time: h.time.getTime() })),
    current: forecast.current,
  };
  try {
    const all = readAll();
    all[key] = stored;
    // On ne garde que les lieux les plus récemment consultés.
    const kept = Object.entries(all)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // stockage plein ou indisponible (navigation privée) : on s'en passe
  }
}

function readAll(): Record<string, StoredForecast> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, StoredForecast>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Relit la dernière prévision mémorisée POUR CE LIEU, en retirant ce qui est déjà passé.
 * Renvoie null s'il n'y a rien pour ce lieu, si c'est trop ancien ou si les données sont illisibles.
 */
export function loadForecast(key: string, now: Date = new Date()): CachedForecast | null {
  try {
    const stored = readAll()[key];
    if (!stored || stored.key !== key) return null;
    if (now.getTime() - stored.savedAt > MAX_AGE_MS) return null;

    const rainSlots: RainSlot[] = stored.rainSlots
      .filter((s) => s.end > now.getTime())
      .map((s) => ({ start: new Date(s.start), end: new Date(s.end), mm: s.mm }));
    const hours: HourForecast[] = stored.hours
      .filter((h) => h.time + HOUR_MS > now.getTime())
      // Les anciennes entrées n'ont pas vent / UV par heure.
      .map((h) => ({
        ...h,
        time: new Date(h.time),
        windSpeed: h.windSpeed ?? null,
        windDirection: h.windDirection ?? null,
        uvIndex: h.uvIndex ?? null,
      }));
    if (rainSlots.length === 0) return null;

    return {
      savedAt: new Date(stored.savedAt),
      position: stored.position,
      // Les entrées enregistrées avant l'ajout du vent / de l'humidité / de l'UV n'ont pas ces champs.
      forecast: {
        rainSlots,
        hours,
        // Les anciennes entrées n'ont pas la température ressentie.
        current: stored.current ? { ...stored.current, apparentTemperature: stored.current.apparentTemperature ?? null } : stored.current,
        timezone: stored.timezone,
        uvMaxToday: stored.uvMaxToday ?? null,
        rainTodayMm: stored.rainTodayMm ?? null,
      },
    };
  } catch {
    return null;
  }
}
