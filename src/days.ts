import { dayDifference, localHour, setDisplayTimeZone } from './time.ts';

/**
 * Prévisions jour par jour, découpées en quatre périodes :
 * matin (6 h – 12 h), après-midi (12 h – 18 h), soir (18 h – 24 h) et nuit (0 h – 6 h du lendemain).
 * Tout vient des prévisions horaires d'Open-Meteo, regroupées ici : pas d'autre service à appeler.
 */

export type PeriodId = 'morning' | 'afternoon' | 'evening' | 'night';

export interface PeriodForecast {
  id: PeriodId;
  /** Début et fin de la période (ms) */
  start: number;
  end: number;
  /** Température moyenne et ressentie moyenne, en °C */
  temperature: number;
  feelsLike: number | null;
  /** Code météo WMO représentatif de la période */
  weatherCode: number;
  isDay: boolean;
  /** Cumul de pluie (mm) et probabilité maximale de pluie (%) */
  rainMm: number;
  rainProbability: number | null;
  /** Vent moyen et rafales maximales en km/h ; direction d'où vient le vent, en degrés */
  windSpeed: number | null;
  windGusts: number | null;
  windDirection: number | null;
  /** Indice UV maximal (null si absent) et couverture nuageuse moyenne en % */
  uvMax: number | null;
  cloudCover: number | null;
}

export interface DayForecast {
  /** Minuit local du jour (ms) */
  date: number;
  tempMin: number | null;
  tempMax: number | null;
  weatherCode: number | null;
  rainMm: number | null;
  rainProbability: number | null;
  periods: PeriodForecast[];
}

export interface DaysForecast {
  timezone: string | undefined;
  days: DayForecast[];
}

type Nums = (number | null)[];

interface DaysResponse {
  timezone?: string;
  daily?: {
    time?: number[];
    weather_code?: Nums;
    temperature_2m_max?: Nums;
    temperature_2m_min?: Nums;
    precipitation_sum?: Nums;
    precipitation_probability_max?: Nums;
  };
  hourly?: {
    time?: number[];
    temperature_2m?: Nums;
    apparent_temperature?: Nums;
    precipitation?: Nums;
    precipitation_probability?: Nums;
    weather_code?: Nums;
    wind_speed_10m?: Nums;
    wind_gusts_10m?: Nums;
    wind_direction_10m?: Nums;
    uv_index?: Nums;
    cloud_cover?: Nums;
    is_day?: Nums;
  };
}

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const HOUR_MS = 60 * 60 * 1000;
/** Nombre de jours affichés (Open-Meteo en fournit 16 : les 2 derniers servent à compléter la dernière nuit). */
export const DAYS_SHOWN = 14;
const FORECAST_DAYS = DAYS_SHOWN + 2;

export const PERIOD_LABELS: Record<PeriodId, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
  night: 'Nuit',
};

/** Plage de chaque période, en heures locales (la nuit appartient au jour précédent : 0 h – 6 h le lendemain). */
export const PERIOD_HOURS: Record<PeriodId, [number, number]> = {
  morning: [6, 12],
  afternoon: [12, 18],
  evening: [18, 24],
  night: [0, 6],
};

export function buildDaysUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly:
      'temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,cloud_cover,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    forecast_days: String(FORECAST_DAYS),
    timeformat: 'unixtime',
    timezone: 'auto',
  });
  return `${BASE_URL}?${params.toString()}`;
}

/** Une heure de prévision, avec les valeurs « de l'heure précédente » d'Open-Meteo déjà réalignées. */
interface Hour {
  time: number;
  temperature: number;
  feelsLike: number | null;
  rain: number;
  probability: number | null;
  code: number | null;
  isDay: boolean;
  wind: number | null;
  gust: number | null;
  direction: number | null;
  uv: number | null;
  cloud: number | null;
}

/**
 * Gravité des codes météo avec précipitations : sert à choisir l'icône d'une période.
 * Le grésil et la neige passent avant la pluie, l'orage avant tout le reste.
 */
const PRECIP_RANK: Record<number, number> = {
  51: 42, 53: 44, 55: 46, 61: 48, 80: 50, 63: 58, 81: 60, 56: 62, 66: 62, 57: 63, 65: 64, 82: 65, 67: 66,
  77: 68, 71: 70, 85: 71, 73: 72, 86: 73, 75: 74, 95: 90, 96: 92, 99: 94,
};
const THUNDER_RANK = 90;

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function numbers(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

/**
 * Code météo représentatif : un orage, même d'une heure, l'emporte ; puis les précipitations
 * (si elles durent au moins 2 h ou cumulent 1 mm) ; puis le brouillard ; sinon on classe le ciel
 * d'après la couverture nuageuse moyenne.
 */
export function pickWeatherCode(hours: Pick<Hour, 'code' | 'rain' | 'cloud'>[]): number {
  const wet = hours.filter((h) => h.code !== null && PRECIP_RANK[h.code] !== undefined);
  const worst = (list: typeof wet): number =>
    list.reduce((best, h) => (PRECIP_RANK[h.code as number] > PRECIP_RANK[best] ? (h.code as number) : best), list[0].code as number);

  const thunder = wet.filter((h) => PRECIP_RANK[h.code as number] >= THUNDER_RANK);
  if (thunder.length > 0) return worst(thunder);

  const totalRain = hours.reduce((sum, h) => sum + h.rain, 0);
  if (wet.length >= 2 || (wet.length >= 1 && totalRain >= 1)) return worst(wet);

  if (hours.filter((h) => h.code === 45 || h.code === 48).length >= 3) return 45;

  const cloud = mean(numbers(hours.map((h) => h.cloud)));
  if (cloud !== null) return cloud < 12.5 ? 0 : cloud < 37.5 ? 1 : cloud < 75 ? 2 : 3;
  const sky = hours.map((h) => h.code).filter((c): c is number => c !== null && c <= 3);
  return sky.length > 0 ? Math.max(...sky) : 3;
}

/** Direction moyenne du vent (moyenne vectorielle pondérée par la vitesse, pour éviter 350° + 10° = 180°). */
function meanDirection(hours: Hour[]): number | null {
  let x = 0;
  let y = 0;
  let any = false;
  for (const h of hours) {
    if (h.direction === null) continue;
    const weight = h.wind !== null && h.wind > 0 ? h.wind : 1;
    const rad = (h.direction * Math.PI) / 180;
    x += Math.sin(rad) * weight;
    y += Math.cos(rad) * weight;
    any = true;
  }
  if (!any || (x === 0 && y === 0)) return null;
  return (Math.round((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
}

function aggregate(id: PeriodId, hours: Hour[]): PeriodForecast {
  const temperature = mean(hours.map((h) => h.temperature)) as number;
  const wind = mean(numbers(hours.map((h) => h.wind)));
  const gust = numbers(hours.map((h) => h.gust));
  const probability = numbers(hours.map((h) => h.probability));
  const uv = numbers(hours.map((h) => h.uv));
  return {
    id,
    start: hours[0].time,
    end: hours[hours.length - 1].time + HOUR_MS,
    temperature,
    feelsLike: mean(numbers(hours.map((h) => h.feelsLike))),
    weatherCode: pickWeatherCode(hours),
    isDay: hours.filter((h) => h.isDay).length * 2 >= hours.length,
    rainMm: hours.reduce((sum, h) => sum + h.rain, 0),
    rainProbability: probability.length > 0 ? Math.max(...probability) : null,
    windSpeed: wind,
    windGusts: gust.length > 0 ? Math.max(...gust) : null,
    windDirection: meanDirection(hours),
    uvMax: uv.length > 0 ? Math.max(...uv) : null,
    cloudCover: mean(numbers(hours.map((h) => h.cloud))),
  };
}

function periodOf(hour: number): { id: PeriodId; dayOffset: number } {
  if (hour >= 18) return { id: 'evening', dayOffset: 0 };
  if (hour >= 12) return { id: 'afternoon', dayOffset: 0 };
  if (hour >= 6) return { id: 'morning', dayOffset: 0 };
  return { id: 'night', dayOffset: -1 }; // 0 h – 6 h : la nuit qui suit la journée d'avant
}

const ORDER: PeriodId[] = ['morning', 'afternoon', 'evening', 'night'];

/** Regroupe les prévisions horaires en jours et en périodes. */
export function parseDays(json: DaysResponse): DaysForecast {
  const dailyTimes = json.daily?.time;
  const h = json.hourly;
  if (!Array.isArray(dailyTimes) || dailyTimes.length === 0 || !h || !Array.isArray(h.time)) {
    throw new Error('Réponse Open-Meteo inattendue.');
  }
  const timezone = typeof json.timezone === 'string' ? json.timezone : undefined;
  setDisplayTimeZone(timezone);
  const firstDay = new Date(dailyTimes[0] * 1000);
  const count = Math.min(DAYS_SHOWN, dailyTimes.length);

  const groups: Map<PeriodId, Hour[]>[] = Array.from({ length: count }, () => new Map());
  for (let i = 0; i < h.time.length; i++) {
    const temperature = h.temperature_2m?.[i];
    if (temperature === null || temperature === undefined) continue;
    const time = new Date(h.time[i] * 1000);
    const { id, dayOffset } = periodOf(localHour(time));
    const day = dayDifference(time, firstDay) + dayOffset;
    if (day < 0 || day >= count) continue;
    // Cumul de pluie, probabilité et rafales d'Open-Meteo à l'heure H : ils couvrent l'heure H-1 → H,
    // donc la valeur de l'heure qui COMMENCE à H est lue à l'index suivant.
    const next = i + 1;
    const hour: Hour = {
      time: time.getTime(),
      temperature,
      feelsLike: h.apparent_temperature?.[i] ?? null,
      rain: h.precipitation?.[next] ?? 0,
      probability: h.precipitation_probability?.[next] ?? null,
      code: h.weather_code?.[i] ?? null,
      isDay: (h.is_day?.[i] ?? 1) === 1,
      wind: h.wind_speed_10m?.[i] ?? null,
      gust: h.wind_gusts_10m?.[next] ?? null,
      direction: h.wind_direction_10m?.[i] ?? null,
      uv: h.uv_index?.[i] ?? null,
      cloud: h.cloud_cover?.[i] ?? null,
    };
    const list = groups[day].get(id) ?? [];
    list.push(hour);
    groups[day].set(id, list);
  }

  const d = json.daily;
  const days: DayForecast[] = groups.map((periods, i) => ({
    date: dailyTimes[i] * 1000,
    tempMin: d?.temperature_2m_min?.[i] ?? null,
    tempMax: d?.temperature_2m_max?.[i] ?? null,
    weatherCode: d?.weather_code?.[i] ?? null,
    rainMm: d?.precipitation_sum?.[i] ?? null,
    rainProbability: d?.precipitation_probability_max?.[i] ?? null,
    periods: ORDER.filter((id) => periods.has(id)).map((id) => aggregate(id, periods.get(id) as Hour[])),
  }));
  return { timezone, days };
}

export async function fetchDays(lat: number, lon: number, signal?: AbortSignal): Promise<DaysForecast> {
  const res = await fetch(buildDaysUrl(lat, lon), { signal });
  if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}.`);
  const forecast = parseDays((await res.json()) as DaysResponse);
  if (forecast.days.every((day) => day.periods.length === 0)) throw new Error('Aucune donnée disponible pour le moment.');
  return forecast;
}
