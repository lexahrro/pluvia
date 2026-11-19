import { formatTime } from './time.ts';

export interface SunTimes {
  /** Lever et coucher du jour en cours (jour du lieu) */
  sunrise: Date;
  sunset: Date;
  /** Prochain lever (lendemain), pour l'affichage après le coucher */
  nextSunrise: Date | null;
}

export type SunPhase = 'before-sunrise' | 'day' | 'after-sunset';

export interface SunState {
  phase: SunPhase;
  /** Avancement du soleil entre le lever (0) et le coucher (1), borné à [0, 1] */
  progress: number;
  /** Durée avant le prochain événement (lever ou coucher), en ms ; null si inconnue */
  untilNext: number | null;
}

export function sunState(sun: SunTimes, now: Date): SunState {
  const t = now.getTime();
  const rise = sun.sunrise.getTime();
  const set = sun.sunset.getTime();
  if (t < rise) return { phase: 'before-sunrise', progress: 0, untilNext: rise - t };
  if (t >= set) {
    return { phase: 'after-sunset', progress: 1, untilNext: sun.nextSunrise ? sun.nextSunrise.getTime() - t : null };
  }
  return { phase: 'day', progress: (t - rise) / (set - rise), untilNext: set - t };
}

/** « 3 h 12 », « 45 min ». */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

function headline(sun: SunTimes, state: SunState): string {
  const wait = state.untilNext !== null ? formatDuration(state.untilNext) : null;
  switch (state.phase) {
    case 'before-sunrise':
      return `Lever du soleil dans ${wait}`;
    case 'day':
      return `Coucher du soleil dans ${wait}`;
    default:
      return sun.nextSunrise
        ? `Soleil couché · prochain lever à ${formatTime(sun.nextSunrise)} (dans ${wait})`
        : 'Soleil couché';
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
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

const CX = 150;
const CY = 90;
const RX = 120;
const RY = 70;

/** Arc du soleil avec sa position actuelle entre le lever et le coucher. */
function renderArc(state: SunState): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 300 110', class: 'sun-arc', role: 'img' });
  root.setAttribute('aria-label', 'Position du soleil entre le lever et le coucher');
  root.append(
    svg('line', { x1: '10', y1: String(CY), x2: '290', y2: String(CY), class: 'sun-horizon' }),
    svg('path', { d: `M ${CX - RX} ${CY} A ${RX} ${RY} 0 0 1 ${CX + RX} ${CY}`, class: 'sun-path' }),
  );
  // Le marqueur suit l'arc le jour ; la nuit, il reste à l'horizon, côté lever ou côté coucher.
  const angle = Math.PI * state.progress;
  const x = CX - RX * Math.cos(angle);
  const y = CY - RY * Math.sin(angle);
  const night = state.phase !== 'day';
  root.append(
    svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: '8', class: night ? 'sun-dot sun-night' : 'sun-dot' }),
  );
  return root;
}

function stat(label: string, value: string): HTMLElement {
  const box = el('div', 'sun-stat');
  box.append(el('span', 'sun-stat-label', label), el('span', 'sun-stat-value', value));
  return box;
}

/** Section « Soleil » : lever, coucher, midi solaire, durée du jour et position actuelle. */
export function renderSun(sun: SunTimes | null, now: Date = new Date()): HTMLElement | null {
  if (!sun || sun.sunset.getTime() <= sun.sunrise.getTime()) return null;
  const state = sunState(sun, now);
  const rise = sun.sunrise.getTime();
  const set = sun.sunset.getTime();

  const card = el('div', 'sun-card');
  const stats = el('div', 'sun-stats');
  stats.append(
    stat('Lever', formatTime(sun.sunrise)),
    stat('Midi solaire', formatTime(new Date((rise + set) / 2))),
    stat('Coucher', formatTime(sun.sunset)),
    stat('Durée du jour', formatDuration(set - rise)),
  );
  card.append(renderArc(state), el('p', 'sun-headline', headline(sun, state)), stats);

  const section = el('section', 'sun');
  section.append(el('h2', undefined, 'Soleil'), card);
  return section;
}
