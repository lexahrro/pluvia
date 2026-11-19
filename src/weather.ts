/** Un créneau de 15 minutes avec la quantité de pluie prévue. */
export interface RainSlot {
  start: Date;
  end: Date;
  /** Précipitations en mm sur les 15 minutes du créneau */
  mm: number;
}

/** Prévision pour une heure donnée. */
export interface HourForecast {
  /** Début de l'heure */
  time: Date;
  temperature: number;
  /** Probabilité de précipitations en % (null si le modèle ne la fournit pas) */
  precipProbability: number | null;
  /** Précipitations en mm sur l'heure */
  precipitation: number;
  /** Code météo WMO */
  weatherCode: number;
  isDay: boolean;
  /** Vent moyen à 10 m en km/h, direction d'où il vient en degrés, indice UV (null si absent) */
  windSpeed: number | null;
  windDirection: number | null;
  uvIndex: number | null;
}

export interface CurrentConditions {
  temperature: number;
  weatherCode: number;
  isDay: boolean;
  /** Humidité relative en % */
  humidity: number | null;
  /** Vitesse du vent à 10 m en km/h */
  windSpeed: number | null;
  /** Rafales à 10 m en km/h */
  windGusts: number | null;
  /** Direction d'où vient le vent, en degrés (0 = nord, 90 = est) */
  windDirection: number | null;
  /** Indice UV actuel */
  uvIndex: number | null;
}

export interface Forecast {
  rainSlots: RainSlot[];
  hours: HourForecast[];
  current: CurrentConditions | null;
  /** Fuseau IANA du lieu (ex. « Europe/Paris »), fourni par Open-Meteo */
  timezone: string | undefined;
  /** Indice UV maximal prévu aujourd'hui (jour du lieu) */
  uvMaxToday: number | null;
}

export type RainLevel = 'none' | 'light' | 'moderate' | 'heavy';

type Nums = (number | null)[];

interface OpenMeteoResponse {
  timezone?: string;
  current?: {
    temperature_2m: number | null;
    weather_code: number | null;
    is_day: number | null;
    relative_humidity_2m?: number | null;
    wind_speed_10m?: number | null;
    wind_gusts_10m?: number | null;
    wind_direction_10m?: number | null;
    uv_index?: number | null;
  };
  daily?: {
    uv_index_max?: Nums;
  };
  hourly?: {
    time: number[];
    temperature_2m: Nums;
    precipitation_probability?: Nums;
    precipitation: Nums;
    weather_code: Nums;
    is_day: Nums;
    wind_speed_10m?: Nums;
    wind_direction_10m?: Nums;
    uv_index?: Nums;
  };
  minutely_15?: {
    time: number[];
    precipitation: Nums;
  };
}

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const SLOT_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Nombre d'heures de prévision conservées à partir de l'heure en cours. */
export const FORECAST_HOURS = 48;

export function buildUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    minutely_15: 'precipitation',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day,wind_speed_10m,wind_direction_10m,uv_index',
    current:
      'temperature_2m,weather_code,is_day,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index',
    daily: 'uv_index_max',
    forecast_days: '3', // assez pour couvrir 48 h à partir de maintenant
    timeformat: 'unixtime', // horodatages UTC, convertis ensuite dans le fuseau local
    timezone: 'auto',
  });
  return `${BASE_URL}?${params.toString()}`;
}

/**
 * Open-Meteo donne, pour chaque horodatage, la somme des précipitations
 * des 15 minutes PRÉCÉDENTES : le créneau se termine donc à l'horodatage indiqué.
 * On ne garde que les créneaux pas encore terminés à l'instant `now`.
 */
export function parseForecast(json: OpenMeteoResponse, now: Date = new Date()): RainSlot[] {
  const data = json.minutely_15;
  if (!data || !Array.isArray(data.time) || !Array.isArray(data.precipitation)) {
    throw new Error('Réponse Open-Meteo inattendue.');
  }

  const slots: RainSlot[] = [];
  for (let i = 0; i < data.time.length; i++) {
    const end = new Date(data.time[i] * 1000);
    const mm = data.precipitation[i];
    if (mm === null || mm === undefined) continue;
    if (end.getTime() <= now.getTime()) continue;
    slots.push({ start: new Date(end.getTime() - SLOT_MS), end, mm });
  }
  return slots;
}

/**
 * Pour les données horaires, l'horodatage est le DÉBUT de l'heure
 * (sauf la pluie, qui est le cumul de l'heure précédente : on l'aligne ici sur l'heure suivante).
 * On garde l'heure en cours et les suivantes, jusqu'à FORECAST_HOURS.
 */
export function parseHours(
  json: OpenMeteoResponse,
  now: Date = new Date(),
  count: number = FORECAST_HOURS,
): HourForecast[] {
  const data = json.hourly;
  if (!data || !Array.isArray(data.time)) return [];

  const hours: HourForecast[] = [];
  for (let i = 0; i < data.time.length && hours.length < count; i++) {
    const time = new Date(data.time[i] * 1000);
    if (time.getTime() + HOUR_MS <= now.getTime()) continue;

    const temperature = data.temperature_2m?.[i];
    const weatherCode = data.weather_code?.[i];
    if (temperature === null || temperature === undefined) continue;
    if (weatherCode === null || weatherCode === undefined) continue;

    // Le cumul de précipitations d'Open-Meteo à l'heure H couvre l'heure H-1 → H :
    // la pluie « de » l'heure H est donc lue à l'index suivant.
    const nextPrecip = data.precipitation?.[i + 1];
    hours.push({
      time,
      temperature,
      precipProbability: data.precipitation_probability?.[i] ?? null,
      precipitation: nextPrecip ?? 0,
      weatherCode,
      isDay: (data.is_day?.[i] ?? 1) === 1,
      windSpeed: data.wind_speed_10m?.[i] ?? null,
      windDirection: data.wind_direction_10m?.[i] ?? null,
      uvIndex: data.uv_index?.[i] ?? null,
    });
  }
  return hours;
}

export function parseCurrent(json: OpenMeteoResponse): CurrentConditions | null {
  const c = json.current;
  if (!c || c.temperature_2m === null || c.weather_code === null) return null;
  return {
    temperature: c.temperature_2m,
    weatherCode: c.weather_code,
    isDay: c.is_day !== 0,
    humidity: c.relative_humidity_2m ?? null,
    windSpeed: c.wind_speed_10m ?? null,
    windGusts: c.wind_gusts_10m ?? null,
    windDirection: c.wind_direction_10m ?? null,
    uvIndex: c.uv_index ?? null,
  };
}

/** Indice UV maximal du premier jour des prévisions (aujourd'hui, jour du lieu). */
export function parseUvMax(json: OpenMeteoResponse): number | null {
  return json.daily?.uv_index_max?.[0] ?? null;
}

export async function fetchForecast(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<Forecast> {
  const res = await fetch(buildUrl(lat, lon), { signal });
  if (!res.ok) {
    throw new Error(`Open-Meteo a répondu ${res.status}.`);
  }
  const json = (await res.json()) as OpenMeteoResponse;
  return {
    rainSlots: parseForecast(json),
    hours: parseHours(json),
    current: parseCurrent(json),
    timezone: typeof json.timezone === 'string' ? json.timezone : undefined,
    uvMaxToday: parseUvMax(json),
  };
}

/** Classe l'intensité à partir du débit horaire équivalent (mm sur 15 min x 4). */
export function rainLevel(mm15: number): RainLevel {
  const mmPerHour = mm15 * 4;
  if (mmPerHour < 0.1) return 'none';
  if (mmPerHour < 2.5) return 'light';
  if (mmPerHour < 7.6) return 'moderate';
  return 'heavy';
}

export const RAIN_LABELS: Record<RainLevel, string> = {
  none: 'Sec',
  light: 'Pluie faible',
  moderate: 'Pluie modérée',
  heavy: 'Forte pluie',
};
