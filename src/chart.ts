import { formatTime } from './time.ts';
import { RAIN_LABELS, rainLevel } from './weather.ts';
import type { RainSlot } from './weather.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 320;
const HEIGHT = 108;
const TOP = 10;
const BASELINE = 76;
const PADDING_X = 8;
/** Débit (mm/h) à partir duquel la barre atteint la hauteur maximale. */
const MAX_MM_PER_HOUR = 10;
const MIN_RAIN_BAR = 8;
const DRY_STUB = 3;


function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

/** Hauteur d'une barre : échelle racine carrée pour que la pluie faible reste visible. */
function barHeight(mm15: number): number {
  if (rainLevel(mm15) === 'none') return DRY_STUB;
  const ratio = Math.min(mm15 * 4, MAX_MM_PER_HOUR) / MAX_MM_PER_HOUR;
  return Math.max(MIN_RAIN_BAR, Math.sqrt(ratio) * (BASELINE - TOP));
}

export function renderChart(slots: RainSlot[]): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: 'chart',
    role: 'img',
    'aria-label': 'Précipitations prévues par créneaux de 15 minutes',
  });

  const slotWidth = (WIDTH - 2 * PADDING_X) / Math.max(slots.length, 1);
  const barWidth = slotWidth * 0.7;
  // Une étiquette toutes les 30 min sur 2 h, toutes les heures au-delà (sinon les heures se chevauchent).
  const labelStep = slots.length > 8 ? 4 : 2;

  slots.forEach((slot, i) => {
    const level = rainLevel(slot.mm);
    const height = barHeight(slot.mm);
    const x = PADDING_X + i * slotWidth + (slotWidth - barWidth) / 2;

    const rect = svgEl('rect', {
      x: x.toFixed(1),
      y: (BASELINE - height).toFixed(1),
      width: barWidth.toFixed(1),
      height: height.toFixed(1),
      rx: 3,
      class: `bar ${level}`,
    });
    const title = svgEl('title');
    title.textContent = `${formatTime(slot.start)} – ${formatTime(slot.end)} : ${RAIN_LABELS[level]} (${slot.mm.toFixed(2)} mm)`;
    rect.append(title);
    svg.append(rect);

    if (i % labelStep === 0) {
      const label = svgEl('text', {
        x: (x + barWidth / 2).toFixed(1),
        y: BASELINE + 22,
        'text-anchor': 'middle',
        class: 'axis-label',
      });
      label.textContent = i === 0 ? 'Maint.' : formatTime(slot.start);
      svg.append(label);
    }
  });

  svg.append(
    svgEl('line', {
      x1: PADDING_X,
      x2: WIDTH - PADDING_X,
      y1: BASELINE + 0.5,
      y2: BASELINE + 0.5,
      class: 'baseline',
    }),
  );

  return svg;
}
