import type { Position } from './location.ts';

/**
 * Prévision de pluie en images pour le radar : les 4 prochaines heures, par pas de 15 minutes.
 *
 * RainViewer ne fournit plus de radar prévisionnel (arrêté le 1er janvier 2026). On le remplace par les
 * prévisions des modèles météo d'Open-Meteo, interrogées sur une grille de points autour de la position
 * (une seule requête), puis dessinées comme des images semi-transparentes posées sur la carte.
 * C'est une prévision de modèle, pas une mesure : moins nette qu'un radar, et les averses peuvent être décalées.
 */

/** La grille fait GRID_N x GRID_N points, espacés de GRID_SPACING_KM : environ 160 km autour de la position. */
export const GRID_N = 16;
export const GRID_SPACING_KM = 20;
/** 16 créneaux de 15 minutes = 4 heures. */
export const NOWCAST_SLOTS = 16;
const IMAGE_SIZE = 256;
const SLOT_SECONDS = 15 * 60;
const KM_PER_DEGREE = 111.32;
const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'pluvia:nowcast:v1';
/** Les mêmes données sont réutilisées pendant 15 minutes : on ménage le quota gratuit d'Open-Meteo. */
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

export interface GridPoint {
  lat: number;
  lon: number;
}

/** Image de prévision d'un créneau de 15 minutes. `start` : début du créneau, en secondes UNIX. */
export interface NowcastFrame {
  start: number;
  url: string;
}

export interface Nowcast {
  /** Emprise de la grille : [[sud, ouest], [nord, est]] */
  bounds: [[number, number], [number, number]];
  frames: NowcastFrame[];
}

/** Valeurs brutes : `frames[i][ligne * GRID_N + colonne]` en mm sur 15 minutes. */
export interface NowcastValues {
  starts: number[];
  frames: number[][];
}

function degrees(lat: number): { dLat: number; dLon: number } {
  const dLat = GRID_SPACING_KM / KM_PER_DEGREE;
  const dLon = GRID_SPACING_KM / (KM_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  return { dLat, dLon };
}

/** Points de la grille, ligne par ligne du nord au sud, chaque ligne d'ouest en est. */
export function gridPoints(lat: number, lon: number): GridPoint[] {
  const { dLat, dLon } = degrees(lat);
  const half = (GRID_N - 1) / 2;
  const points: GridPoint[] = [];
  for (let row = 0; row < GRID_N; row++) {
    for (let col = 0; col < GRID_N; col++) {
      points.push({ lat: lat + (half - row) * dLat, lon: lon + (col - half) * dLon });
    }
  }
  return points;
}

/** Emprise de l'image : les centres des points sont au milieu des cases, donc la grille déborde d'une demi-case. */
export function gridBounds(lat: number, lon: number): [[number, number], [number, number]] {
  const { dLat, dLon } = degrees(lat);
  const halfLat = (GRID_N * dLat) / 2;
  const halfLon = (GRID_N * dLon) / 2;
  return [
    [lat - halfLat, lon - halfLon],
    [lat + halfLat, lon + halfLon],
  ];
}

export function buildNowcastUrl(points: GridPoint[]): string {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lon.toFixed(3)).join(','),
    minutely_15: 'precipitation',
    forecast_days: '2', // assez pour toujours couvrir 4 h à partir de maintenant
    timeformat: 'unixtime',
    timezone: 'UTC',
  });
  return `${URL_BASE}?${params.toString()}`;
}

interface PointResponse {
  minutely_15?: { time?: number[]; precipitation?: (number | null)[] };
}

/**
 * Extrait les NOWCAST_SLOTS prochains créneaux de la réponse (un objet par point de la grille).
 * L'heure d'Open-Meteo est la FIN du créneau de 15 minutes : le début est 15 minutes plus tôt.
 * Le premier créneau retenu est celui qui contient « maintenant ».
 */
export function parseNowcast(json: unknown, pointCount: number, nowMs: number): NowcastValues {
  const list: PointResponse[] = Array.isArray(json) ? (json as PointResponse[]) : [json as PointResponse];
  if (list.length !== pointCount) throw new Error('Réponse Open-Meteo inattendue.');
  const times = list[0]?.minutely_15?.time;
  if (!Array.isArray(times)) throw new Error('Réponse Open-Meteo inattendue.');

  const nowSec = nowMs / 1000;
  const first = times.findIndex((end) => end > nowSec);
  if (first === -1) throw new Error('Aucune prévision disponible.');
  const indexes = times.slice(first, first + NOWCAST_SLOTS).map((_, k) => first + k);
  if (indexes.length < 2) throw new Error('Aucune prévision disponible.');

  return {
    starts: indexes.map((i) => times[i] - SLOT_SECONDS),
    frames: indexes.map((i) => list.map((point) => point.minutely_15?.precipitation?.[i] ?? 0)),
  };
}

/** Couleurs selon le débit (mm/h) : du bleu clair au bleu foncé, puis violet, rose et rouge. [débit, r, g, b, alpha] */
const STOPS: [number, number, number, number, number][] = [
  [0.05, 173, 216, 255, 0],
  [0.15, 173, 216, 255, 120],
  [0.5, 110, 175, 255, 175],
  [1, 55, 125, 245, 205],
  [2.5, 30, 85, 205, 225],
  [5, 125, 65, 205, 235],
  [10, 205, 45, 165, 240],
  [20, 255, 70, 70, 245],
];

/** Couleur [r, g, b, alpha 0-255] d'un débit en mm/h ; transparente en dessous de 0,05 mm/h. */
export function rateColor(rate: number): [number, number, number, number] {
  if (!(rate > STOPS[0][0])) return [0, 0, 0, 0];
  const last = STOPS[STOPS.length - 1];
  if (rate >= last[0]) return [last[1], last[2], last[3], last[4]];
  let k = 1;
  while (STOPS[k][0] < rate) k++;
  const [r0, ...c0] = STOPS[k - 1];
  const [r1, ...c1] = STOPS[k];
  const t = (rate - r0) / (r1 - r0);
  const mix = (i: number): number => Math.round(c0[i] + (c1[i] - c0[i]) * t);
  return [mix(0), mix(1), mix(2), mix(3)];
}

/** Valeur interpolée (bilinéaire) de la grille au point (gx, gy), en unités de cases ; les bords sont prolongés. */
export function sampleGrid(values: number[], n: number, gx: number, gy: number): number {
  const clamp = (v: number): number => Math.min(Math.max(v, 0), n - 1);
  const x = clamp(gx);
  const y = clamp(gy);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (col: number, row: number): number => values[row * n + col] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Dessine une image RGBA de `size` x `size` pixels. Les bords s'estompent pour ne pas montrer un cadre net. */
export function renderFrame(values: number[], n: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const cell = size / n;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rate = sampleGrid(values, n, (x + 0.5) / cell - 0.5, (y + 0.5) / cell - 0.5) * 4;
      const [r, g, b, a] = rateColor(rate);
      if (a === 0) continue;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y) / cell;
      const i = (y * size + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = Math.round(a * Math.min(edge / 0.75, 1));
    }
  }
  return out;
}

function toDataUrl(rgba: Uint8ClampedArray, size: number): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(size, size);
    image.data.set(rgba);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

interface Cached extends NowcastValues {
  lat: number;
  lon: number;
  savedAt: number;
}

function loadCached(position: Position, nowMs: number): NowcastValues | null {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null;
    if (!stored || nowMs - stored.savedAt > CACHE_MAX_AGE_MS) return null;
    if (Math.abs(stored.lat - position.lat) > 0.02 || Math.abs(stored.lon - position.lon) > 0.02) return null;
    if (!Array.isArray(stored.starts) || !Array.isArray(stored.frames) || stored.starts.length !== stored.frames.length) return null;
    // Les créneaux déjà terminés ne servent plus.
    const keep = stored.starts.map((_, i) => i).filter((i) => stored.starts[i] + SLOT_SECONDS > nowMs / 1000);
    if (keep.length < 2) return null;
    return { starts: keep.map((i) => stored.starts[i]), frames: keep.map((i) => stored.frames[i]) };
  } catch {
    return null;
  }
}

function saveCached(position: Position, values: NowcastValues, nowMs: number): void {
  try {
    const stored: Cached = { lat: position.lat, lon: position.lon, savedAt: nowMs, ...values };
    localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
  } catch {
    // stockage plein ou indisponible : on s'en passe
  }
}

/** Récupère la prévision (ou la relit de la mémoire) et la transforme en images. Ne lève jamais d'erreur : null si indisponible. */
export async function fetchNowcast(position: Position, now: Date = new Date()): Promise<Nowcast | null> {
  try {
    const nowMs = now.getTime();
    let values = loadCached(position, nowMs);
    if (!values) {
      const points = gridPoints(position.lat, position.lon);
      const res = await fetch(buildNowcastUrl(points));
      if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}.`);
      values = parseNowcast(await res.json(), points.length, nowMs);
      saveCached(position, values, nowMs);
    }
    const frames: NowcastFrame[] = [];
    for (let i = 0; i < values.frames.length; i++) {
      const url = toDataUrl(renderFrame(values.frames[i], GRID_N, IMAGE_SIZE), IMAGE_SIZE);
      if (url === null) return null; // pas de canvas : pas de prévision en images
      frames.push({ start: values.starts[i], url });
    }
    return { bounds: gridBounds(position.lat, position.lon), frames };
  } catch {
    return null;
  }
}
