import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Position } from './location.ts';
import { formatTime } from './time.ts';

/** Image radar : horodatage (secondes UNIX) et chemin fournis par RainViewer. */
export interface RadarFrame {
  time: number;
  path: string;
}

export interface RadarIndex {
  host: string;
  frames: RadarFrame[];
}

interface RainViewerResponse {
  host?: string;
  radar?: { past?: { time: number; path: string }[] };
}

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';
/** Au-delà de ce zoom, RainViewer ne fournit pas de tuiles : Leaflet agrandit celles du zoom 7. */
const RADAR_MAX_NATIVE_ZOOM = 7;
const MAP_ZOOM = 7;
const FRAME_DELAY_MS = 600;
const LAST_FRAME_DELAY_MS = 1600;
const RADAR_OPACITY = 0.75;
const RADAR_COLOR = 2; // schéma « Universal Blue »
const RADAR_OPTIONS = '1_0'; // lissé, sans couleurs neige


export function parseRadarIndex(json: RainViewerResponse): RadarIndex {
  const past = json.radar?.past;
  if (typeof json.host !== 'string' || !Array.isArray(past) || past.length === 0) {
    throw new Error('Réponse RainViewer inattendue.');
  }
  return { host: json.host, frames: [...past].sort((a, b) => a.time - b.time) };
}

export async function fetchRadarIndex(signal?: AbortSignal): Promise<RadarIndex> {
  const res = await fetch(INDEX_URL, { signal });
  if (!res.ok) throw new Error(`RainViewer a répondu ${res.status}.`);
  return parseRadarIndex((await res.json()) as RainViewerResponse);
}

/** Les chemins viennent de l'API : on les utilise tels quels, sans jamais les deviner. */
export function tileUrl(host: string, frame: RadarFrame): string {
  return `${host}${frame.path}/256/{z}/{x}/{y}/${RADAR_COLOR}/${RADAR_OPTIONS}.png`;
}

export function frameLabel(frame: RadarFrame, now: Date = new Date()): string {
  const at = new Date(frame.time * 1000);
  const minutesAgo = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  const ago = minutesAgo < 2 ? 'à l’instant' : `il y a ${minutesAgo} min`;
  return `${formatTime(at)} · ${ago}`;
}

export interface RadarHandle {
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Monte la carte radar dans `container` (déjà présent dans la page).
 * Ne lève jamais d'erreur : en cas de problème, affiche un message dans la carte.
 */
export function mountRadar(container: HTMLElement, position: Position): RadarHandle {
  const mapEl = el('div', 'map');
  const controls = el('div', 'radar-controls');
  const playBtn = el('button', 'radar-play', '▶');
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', 'Lecture / pause');
  const slider = el('input', 'radar-slider');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '0';
  slider.value = '0';
  slider.disabled = true;
  slider.setAttribute('aria-label', 'Image du radar');
  const label = el('span', 'radar-time', 'Chargement du radar…');
  controls.append(playBtn, slider, label);
  container.append(mapEl, controls);

  const map = L.map(mapEl, {
    center: [position.lat, position.lon],
    zoom: MAP_ZOOM,
    minZoom: 4,
    maxZoom: 10,
    zoomControl: true,
  });

  // Fond OpenStreetMap, assombri en CSS (classe map-base) pour s'accorder à l'interface.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 10,
    className: 'map-base',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  L.circleMarker([position.lat, position.lon], {
    radius: 6,
    color: '#ffffff',
    weight: 2,
    fillColor: '#4fc3f7',
    fillOpacity: 1,
  }).addTo(map);

  map.attributionControl.addAttribution('Radar © <a href="https://www.rainviewer.com/">RainViewer</a>');

  let destroyed = false;
  let timer: number | undefined;
  let layers: L.TileLayer[] = [];
  let frames: RadarFrame[] = [];
  let current = 0;
  let playing = false;

  function show(index: number): void {
    if (layers.length === 0) return;
    layers[current]?.setOpacity(0);
    current = index;
    layers[current].setOpacity(RADAR_OPACITY);
    slider.value = String(index);
    label.textContent = frameLabel(frames[index]);
  }

  function schedule(): void {
    window.clearTimeout(timer);
    if (!playing || destroyed) return;
    const atEnd = current === frames.length - 1;
    timer = window.setTimeout(() => {
      show(atEnd ? 0 : current + 1);
      schedule();
    }, atEnd ? LAST_FRAME_DELAY_MS : FRAME_DELAY_MS);
  }

  function setPlaying(value: boolean): void {
    playing = value;
    playBtn.textContent = playing ? '⏸' : '▶';
    schedule();
  }

  playBtn.addEventListener('click', () => setPlaying(!playing));
  slider.addEventListener('input', () => {
    setPlaying(false);
    show(Number(slider.value));
  });

  fetchRadarIndex()
    .then(({ host, frames: list }) => {
      if (destroyed) return;
      frames = list;
      // Toutes les images sont préchargées, superposées et invisibles ; on n'affiche que l'active.
      layers = frames.map((frame) =>
        L.tileLayer(tileUrl(host, frame), {
          opacity: 0,
          maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
          maxZoom: 10,
          keepBuffer: 1,
          updateWhenZooming: false,
        }).addTo(map),
      );
      slider.max = String(frames.length - 1);
      slider.disabled = false;
      current = frames.length - 1;
      layers[current].setOpacity(RADAR_OPACITY);
      slider.value = String(current);
      label.textContent = frameLabel(frames[current]);

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotion) {
        show(0);
        setPlaying(true);
      }
    })
    .catch((err: unknown) => {
      if (destroyed) return;
      label.textContent = err instanceof Error ? `Radar indisponible. ${err.message}` : 'Radar indisponible.';
      playBtn.disabled = true;
    });

  return {
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      map.remove();
    },
  };
}
