/**
 * Qualité de l'air : API Air Quality d'Open-Meteo (données CAMS, sans clé).
 * Indice européen (EAQI) de l'Agence européenne pour l'environnement.
 */

export interface AirQuality {
  /** Indice européen de qualité de l'air (0 = excellent, > 100 = extrêmement mauvais) */
  aqi: number;
  /** Particules fines PM2.5 en µg/m³ */
  pm25: number | null;
  /** Particules PM10 en µg/m³ */
  pm10: number | null;
}

export type AirLevel = 'good' | 'fair' | 'moderate' | 'poor' | 'very-poor' | 'extreme';

export const AIR_LABELS: Record<AirLevel, string> = {
  good: 'Bon',
  fair: 'Correct',
  moderate: 'Moyen',
  poor: 'Médiocre',
  'very-poor': 'Très mauvais',
  extreme: 'Extrêmement mauvais',
};

/** Seuils de l'indice européen : 0-20, 20-40, 40-60, 60-80, 80-100, au-delà de 100. */
export function airLevel(aqi: number): AirLevel {
  if (aqi < 20) return 'good';
  if (aqi < 40) return 'fair';
  if (aqi < 60) return 'moderate';
  if (aqi < 80) return 'poor';
  if (aqi <= 100) return 'very-poor';
  return 'extreme';
}

interface AirResponse {
  current?: {
    european_aqi?: number | null;
    pm2_5?: number | null;
    pm10?: number | null;
  };
}

const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export function buildAirUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'european_aqi,pm2_5,pm10',
    timezone: 'auto',
  });
  return `${AIR_URL}?${params.toString()}`;
}

/** null si l'indice est absent (zone non couverte par le modèle, par exemple). */
export function parseAirQuality(json: AirResponse): AirQuality | null {
  const c = json.current;
  if (!c || c.european_aqi === null || c.european_aqi === undefined || !Number.isFinite(c.european_aqi)) {
    return null;
  }
  return { aqi: c.european_aqi, pm25: c.pm2_5 ?? null, pm10: c.pm10 ?? null };
}

/** Ne lève jamais d'erreur : la qualité de l'air est un bonus, elle ne doit pas bloquer la météo. */
export async function fetchAirQuality(lat: number, lon: number, signal?: AbortSignal): Promise<AirQuality | null> {
  try {
    const res = await fetch(buildAirUrl(lat, lon), { signal });
    if (!res.ok) return null;
    return parseAirQuality((await res.json()) as AirResponse);
  } catch {
    return null;
  }
}
