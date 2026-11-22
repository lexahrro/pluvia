import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Position } from './location.ts';
import { formatTime } from './time.ts';
import { fetchNowcast, type Nowcast } from './nowcast.ts';

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

/** Libellé d'une image de prévision : début du créneau de 15 minutes et délai avant celui-ci. */
export function forecastLabel(startSec: number, now: Date = new Date()): string {
  const at = new Date(startSec * 1000);
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  const when = minutes < 2 ? 'maintenant' : `dans ${minutes} min`;
  return `Prévision · ${formatTime(at)} · ${when}`;
}

/** Deux cartes distinctes : le radar mesuré (2 dernières heures) et la prévision du modèle (4 prochaines heures). */
export type RadarKind = 'past' | 'forecast';

/** Données d'une carte : images radar (passé) ou images de prévision. */
export interface RadarData {
  index?: RadarIndex;
  nowcast?: Nowcast;
}

const DIALOG_TITLES: Record<RadarKind, string> = {
  past: 'Radar : les 2 dernières heures',
  forecast: 'Prévision : les 4 prochaines heures',
};

type Fade = { setOpacity(opacity: number): unknown };

export interface RadarHandle {
  destroy(): void;
}

interface RadarView extends RadarHandle {
  /** À appeler quand la taille du conteneur a changé (ouverture d'une fenêtre, par exemple). */
  invalidate(): void;
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
 * Une carte radar animée dans `container`.
 * `interactive: false` : aperçu fixe (ni déplacement, ni zoom), sans barre de défilement.
 * `interactive: true` : carte déplaçable / zoomable avec lecture, pause et barre de défilement.
 * Ne lève jamais d'erreur : en cas de problème, affiche un message.
 */
function createView(
  kind: RadarKind,
  container: HTMLElement,
  position: Position,
  dataPromise: Promise<RadarData>,
  interactive: boolean,
): RadarView {
  const mapEl = el('div', 'map');
  const label = el('span', interactive ? 'radar-time' : 'radar-badge', 'Chargement du radar…');
  const playBtn = el('button', 'radar-play', '▶');
  const slider = el('input', 'radar-slider');
  if (interactive) {
    playBtn.type = 'button';
    playBtn.setAttribute('aria-label', 'Lecture / pause');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '0';
    slider.value = '0';
    slider.disabled = true;
    slider.setAttribute('aria-label', 'Image du radar');
    const controls = el('div', 'radar-controls');
    controls.append(playBtn, slider, label);
    container.append(mapEl, controls);
  } else {
    container.append(mapEl, label);
  }

  const map = L.map(mapEl, {
    center: [position.lat, position.lon],
    zoom: MAP_ZOOM,
    minZoom: 4,
    maxZoom: 10,
    zoomControl: interactive,
    dragging: interactive,
    touchZoom: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
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

  map.attributionControl.addAttribution(
    kind === 'past'
      ? 'Radar © <a href="https://www.rainviewer.com/">RainViewer</a>'
      : 'Prévision du modèle © <a href="https://open-meteo.com/">Open-Meteo</a>',
  );

  let destroyed = false;
  let timer: number | undefined;
  let layers: Fade[] = [];
  let labels: string[] = [];
    let current = 0;
  let playing = false;

  function show(index: number): void {
    if (layers.length === 0) return;
    layers[current]?.setOpacity(0);
    current = index;
    layers[current].setOpacity(RADAR_OPACITY);
    slider.value = String(index);
    label.textContent = labels[index];
  }

  function schedule(): void {
    window.clearTimeout(timer);
    if (!playing || destroyed) return;
    const atEnd = current === layers.length - 1;
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

  if (interactive) {
    playBtn.addEventListener('click', () => setPlaying(!playing));
    slider.addEventListener('input', () => {
      setPlaying(false);
      show(Number(slider.value));
    });
  }

  dataPromise
    .then(({ index, nowcast }) => {
      if (destroyed) return;
      const now = new Date();
      if (kind === 'past' && index) {
        // Toutes les images sont préchargées, superposées et invisibles ; on n'affiche que l'active.
        layers = index.frames.map((frame) =>
          L.tileLayer(tileUrl(index.host, frame), {
            opacity: 0,
            maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
            maxZoom: 10,
            keepBuffer: 1,
            updateWhenZooming: false,
          }).addTo(map),
        );
        labels = index.frames.map((frame) => frameLabel(frame, now));
      } else if (kind === 'forecast' && nowcast) {
        layers = nowcast.frames.map((frame) =>
          L.imageOverlay(frame.url, nowcast.bounds, { opacity: 0, className: 'nowcast-image', interactive: false }).addTo(map),
        );
        labels = nowcast.frames.map((frame) => forecastLabel(frame.start, now));
      } else {
        throw new Error(kind === 'past' ? '' : 'Le modèle ne répond pas.');
      }
      slider.max = String(layers.length - 1);
      slider.disabled = false;
      // Radar passé : on s'arrête sur la plus récente ; prévision : on commence à « maintenant ».
      current = kind === 'past' ? layers.length - 1 : 0;
      layers[current].setOpacity(RADAR_OPACITY);
      slider.value = String(current);
      label.textContent = labels[current];

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotion) {
        show(0);
        setPlaying(true);
      }
    })
    .catch((err: unknown) => {
      if (destroyed) return;
      const what = kind === 'past' ? 'Radar' : 'Prévision';
      label.textContent = err instanceof Error && err.message ? `${what} indisponible. ${err.message}` : `${what} indisponible.`;
      playBtn.disabled = true;
    });

  // La carte suit les changements de taille de son conteneur (rotation de l'écran, redimensionnement).
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.invalidateSize()) : undefined;
  resizeObserver?.observe(mapEl);

  return {
    invalidate() {
      if (!destroyed) map.invalidateSize();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      resizeObserver?.disconnect();
      map.remove();
    },
  };
}

/**
 * Monte le radar dans `container` (déjà présent dans la page) : un aperçu fixe et peu haut
 * (le défilement de la page ne déplace pas la carte). Un clic ouvre une fenêtre avec la carte
 * interactive et la barre de défilement. Ne lève jamais d'erreur.
 */
export function mountRadar(container: HTMLElement, position: Position, kind: RadarKind = 'past'): RadarHandle {
  // Les données ne sont demandées qu'une fois, pour l'aperçu comme pour la fenêtre.
  const dataPromise: Promise<RadarData> =
    kind === 'past'
      ? fetchRadarIndex().then((index) => ({ index }))
      : fetchNowcast(position).then((nowcast) => (nowcast ? { nowcast } : {}));
  dataPromise.catch(() => undefined);

  // L'aperçu doit être dans la page AVANT de créer la carte : Leaflet mesure alors la bonne taille.
  const preview = el('div', 'radar-preview');
  container.append(preview);
  const previewView = createView(kind, preview, position, dataPromise, false);
  const openBtn = el('button', 'radar-open');
  openBtn.type = 'button';
  openBtn.setAttribute('aria-label', kind === 'past' ? 'Ouvrir le radar en grand' : 'Ouvrir la prévision en grand');
  openBtn.append(el('span', 'radar-open-hint', '⤢ Agrandir'));
  preview.append(openBtn);

  let modal: { dialog: HTMLDialogElement; view: RadarView } | undefined;

  function closeModal(): void {
    if (!modal) return;
    const { dialog, view } = modal;
    modal = undefined;
    view.destroy();
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    dialog.remove();
    document.documentElement.classList.remove('modal-open');
  }

  function openModal(): void {
    if (modal) return;
    const dialog = el('dialog', 'radar-dialog');
    dialog.setAttribute('aria-label', DIALOG_TITLES[kind]);
    const bar = el('div', 'radar-dialog-bar');
    const close = el('button', 'radar-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer le radar');
    bar.append(el('h2', undefined, DIALOG_TITLES[kind]), close);
    const body = el('div', 'radar-dialog-body');
    dialog.append(bar, body);
    document.body.append(dialog);
    document.documentElement.classList.add('modal-open');

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');

    const view = createView(kind, body, position, dataPromise, true);
    modal = { dialog, view };
    // Une fois la fenêtre affichée, Leaflet doit recalculer la taille de sa carte.
    window.requestAnimationFrame(() => view.invalidate());

    close.addEventListener('click', () => {
      closeModal();
      openBtn.focus();
    });
    // « Échap » ferme la fenêtre nativement : on nettoie ensuite la carte.
    dialog.addEventListener('close', () => closeModal());
    // Un clic sur le fond (hors de la fenêtre, sur grand écran) ferme aussi.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeModal();
    });
  }

  openBtn.addEventListener('click', openModal);

  return {
    destroy() {
      closeModal();
      previewView.destroy();
    },
  };
}
