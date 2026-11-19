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
      return `Lever dans ${wait}`;
    case 'day':
      return `Coucher dans ${wait}`;
    default:
      return sun.nextSunrise ? `Soleil couché · lever à ${formatTime(sun.nextSunrise)} (dans ${wait})` : 'Soleil couché';
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

// Géométrie : un segment de cercle (moins qu'un demi-cercle), posé sur la ligne d'horizon.
const CX = 150;
const HORIZON_Y = 76;
const HALF_CHORD = 110; // demi-largeur de l'arc à l'horizon
const SAGITTA = 46; // hauteur du sommet de l'arc au-dessus de l'horizon
const RADIUS = (HALF_CHORD * HALF_CHORD + SAGITTA * SAGITTA) / (2 * SAGITTA);
const CENTER_Y = HORIZON_Y + RADIUS - SAGITTA;
const HALF_ANGLE = Math.asin(HALF_CHORD / RADIUS);

function gradient(
  tag: 'linearGradient' | 'radialGradient',
  attrs: Record<string, string>,
  stops: [string, string, string][],
): SVGElement {
  const g = svg(tag, attrs);
  for (const [offset, color, opacity] of stops) {
    g.append(svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
  }
  return g;
}

/** Arc du soleil avec dégradé, et position actuelle entre le lever et le coucher. */
function renderArc(state: SunState): SVGSVGElement {
  const root = svg('svg', { viewBox: '24 0 252 92', class: 'sun-arc', role: 'img' });
  root.setAttribute('aria-label', 'Position du soleil entre le lever et le coucher');

  const x0 = CX - HALF_CHORD;
  const x1 = CX + HALF_CHORD;
  const arc = `M ${x0} ${HORIZON_Y} A ${RADIUS.toFixed(1)} ${RADIUS.toFixed(1)} 0 0 1 ${x1} ${HORIZON_Y}`;

  const defs = svg('defs', {});
  defs.append(
    // Remplissage sous l'arc : léger voile clair qui s'estompe vers l'horizon.
    gradient('linearGradient', { id: 'sun-fill', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      ['0', '#ffffff', '0.28'],
      ['1', '#ffffff', '0'],
    ]),
    // Trait de l'arc : plus net au sommet, qui s'efface vers les extrémités.
    gradient('linearGradient', { id: 'sun-stroke', x1: '0', y1: '0', x2: '1', y2: '0' }, [
      ['0', '#ffffff', '0'],
      ['0.5', '#ffffff', '0.6'],
      ['1', '#ffffff', '0'],
    ]),
    gradient('radialGradient', { id: 'sun-core' }, [
      ['0', '#ffb347', '1'],
      ['1', '#ff6a00', '1'],
    ]),
    gradient('radialGradient', { id: 'sun-glow' }, [
      ['0', '#ff8a1f', '0.55'],
      ['1', '#ff8a1f', '0'],
    ]),
  );

  root.append(
    defs,
    svg('path', { d: `${arc} Z`, fill: 'url(#sun-fill)', stroke: 'none' }),
    svg('path', { d: arc, class: 'sun-path', stroke: 'url(#sun-stroke)' }),
  );

  // Le marqueur suit l'arc le jour ; la nuit, il reste à l'horizon, côté lever ou côté coucher.
  const phi = -HALF_ANGLE + 2 * HALF_ANGLE * state.progress;
  const x = CX + RADIUS * Math.sin(phi);
  const y = CENTER_Y - RADIUS * Math.cos(phi);
  const cx = x.toFixed(1);
  const cy = y.toFixed(1);
  if (state.phase === 'day') {
    root.append(
      svg('circle', { cx, cy, r: '15', fill: 'url(#sun-glow)' }),
      svg('circle', { cx, cy, r: '8', fill: 'url(#sun-core)', class: 'sun-dot' }),
    );
  } else {
    root.append(svg('circle', { cx, cy, r: '7', class: 'sun-dot sun-night' }));
  }
  return root;
}

/** Petite icône lever / coucher : demi-soleil sur l'horizon et flèche. */
function icon(kind: 'rise' | 'set'): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 24 24', class: 'sun-icon', 'aria-hidden': 'true' });
  const arrow = kind === 'rise' ? 'M12 8 V3 M9.5 5.5 L12 3 L14.5 5.5' : 'M12 3 V8 M9.5 5.5 L12 8 L14.5 5.5';
  for (const d of ['M3 19 H21', 'M7 19 A5 5 0 0 1 17 19', 'M4.6 12.6 L6 14', 'M19.4 12.6 L18 14', arrow]) {
    root.append(svg('path', { d }));
  }
  return root;
}

function event(kind: 'rise' | 'set', label: string, time: string): HTMLElement {
  const box = el('div', `sun-event sun-${kind}`);
  box.append(icon(kind), el('span', 'sun-event-label', label), el('span', 'sun-event-time', time));
  return box;
}

/** Section « Soleil » : lever, coucher, position actuelle, midi solaire et durée du jour. */
export function renderSun(sun: SunTimes | null, now: Date = new Date()): HTMLElement | null {
  if (!sun || sun.sunset.getTime() <= sun.sunrise.getTime()) return null;
  const state = sunState(sun, now);
  const rise = sun.sunrise.getTime();
  const set = sun.sunset.getTime();

  const card = el('div', 'sun-card');
  const row = el('div', 'sun-row');
  row.append(
    event('rise', 'Lever', formatTime(sun.sunrise)),
    renderArc(state),
    event('set', 'Coucher', formatTime(sun.sunset)),
  );
  card.append(
    row,
    el(
      'p',
      'sun-meta',
      `${headline(sun, state)} · Midi solaire ${formatTime(new Date((rise + set) / 2))} · Jour ${formatDuration(set - rise)}`,
    ),
  );

  const section = el('section', 'sun');
  section.append(el('h2', undefined, 'Soleil'), card);
  return section;
}
