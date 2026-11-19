/** Un lieu choisi par l'utilisateur (ville trouvée via la recherche). */
export interface Place {
  id: string;
  name: string;
  /** Région et pays, pour distinguer les homonymes (ex. « Île-de-France, France ») */
  subtitle: string;
  lat: number;
  lon: number;
}

export type Selection = { kind: 'gps' } | { kind: 'place'; place: Place };

const SELECTION_KEY = 'pluvia:selection:v1';
const PLACES_KEY = 'pluvia:places:v1';
const MAX_PLACES = 8;
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

function isPlace(value: unknown): value is Place {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.subtitle === 'string' &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number'
  );
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée, plein) : on s'en passe
  }
}

/** Identifiant stable de la sélection, utilisé pour associer une prévision à son lieu. */
export function selectionKey(selection: Selection): string {
  return selection.kind === 'gps' ? 'gps' : `place:${selection.place.id}`;
}

export function loadSelection(): Selection {
  const value = readJson(SELECTION_KEY) as { kind?: string; place?: unknown } | null;
  if (value?.kind === 'place' && isPlace(value.place)) {
    return { kind: 'place', place: value.place };
  }
  return { kind: 'gps' };
}

export function saveSelection(selection: Selection): void {
  writeJson(SELECTION_KEY, selection);
}

export function loadPlaces(): Place[] {
  const value = readJson(PLACES_KEY);
  return Array.isArray(value) ? value.filter(isPlace) : [];
}

/** Ajoute un lieu en tête de liste (sans doublon, limité à MAX_PLACES) et renvoie la liste à jour. */
export function addPlace(place: Place): Place[] {
  const places = [place, ...loadPlaces().filter((p) => p.id !== place.id)].slice(0, MAX_PLACES);
  writeJson(PLACES_KEY, places);
  return places;
}

export function removePlace(id: string): Place[] {
  const places = loadPlaces().filter((p) => p.id !== id);
  writeJson(PLACES_KEY, places);
  return places;
}

interface GeocodingResult {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  admin1?: string;
}

/** La réponse ne contient pas `results` quand rien n'est trouvé. */
export function parsePlaces(json: { results?: GeocodingResult[] }): Place[] {
  const places: Place[] = [];
  for (const r of json.results ?? []) {
    if (typeof r.name !== 'string' || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
    const subtitle = [r.admin1 && r.admin1 !== r.name ? r.admin1 : '', r.country ?? '']
      .filter(Boolean)
      .join(', ');
    places.push({
      id: typeof r.id === 'number' ? String(r.id) : `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`,
      name: r.name,
      subtitle,
      lat: r.latitude,
      lon: r.longitude,
    });
  }
  return places;
}

export const MIN_QUERY_LENGTH = 2;

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const name = query.trim();
  if (name.length < MIN_QUERY_LENGTH) return [];
  const params = new URLSearchParams({ name, count: '8', language: 'fr', format: 'json' });
  const res = await fetch(`${GEOCODING_URL}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`La recherche a répondu ${res.status}.`);
  return parsePlaces((await res.json()) as { results?: GeocodingResult[] });
}
