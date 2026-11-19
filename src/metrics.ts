import type { CurrentConditions, HourForecast } from './weather.ts';

/** Les 16 points de la rose des vents, dans l'ordre à partir du nord (convention française : O = ouest). */
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** Direction d'où vient le vent, par exemple 270° → « O ». */
export function compassLabel(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}

/** Description de la force du vent à partir de l'échelle de Beaufort (vitesse en km/h). */
export function windLevel(kmh: number): string {
  if (kmh < 12) return 'Faible';
  if (kmh < 29) return 'Modéré';
  if (kmh < 50) return 'Soutenu';
  if (kmh < 75) return 'Fort';
  return 'Très fort';
}

export function humidityLevel(percent: number): string {
  if (percent < 30) return 'Air sec';
  if (percent < 60) return 'Confortable';
  if (percent < 80) return 'Humide';
  return 'Très humide';
}

export type UvCategory = 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';

/** Catégories de l'indice UV de l'OMS, appliquées à l'indice arrondi. */
export function uvCategory(index: number): UvCategory {
  const rounded = Math.round(index);
  if (rounded <= 2) return 'low';
  if (rounded <= 5) return 'moderate';
  if (rounded <= 7) return 'high';
  if (rounded <= 10) return 'very-high';
  return 'extreme';
}

export const UV_LABELS: Record<UvCategory, string> = {
  low: 'Faible',
  moderate: 'Modéré',
  high: 'Élevé',
  'very-high': 'Très élevé',
  extreme: 'Extrême',
};

/** Les valeurs peuvent manquer (modèle qui ne les fournit pas, ancienne donnée en cache) : null ou undefined. */
function has(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
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

function tile(title: string, value: string, className = ''): { root: HTMLElement; sub: HTMLElement } {
  const root = el('div', `metric ${className}`.trim());
  const sub = el('p', 'metric-sub');
  root.append(el('p', 'metric-title', title), el('p', 'metric-value', value), sub);
  return { root, sub };
}

const KMH = (value: number): string => `${Math.round(value)} km/h`;

/** Bloc « Conditions » : vent, humidité, UV. Renvoie null si aucune des trois mesures n'est disponible. */
/** Cumul de pluie (mm) sur les `count` premières heures de la prévision. */
export function rainTotal(hours: HourForecast[], count: number): number {
  return hours.slice(0, count).reduce((sum, hour) => sum + (hour.precipitation || 0), 0);
}

function formatMm(mm: number): string {
  return mm < 0.05 ? '0 mm' : `${mm.toFixed(1).replace('.', ',')} mm`;
}

export function renderConditions(
  current: CurrentConditions | null,
  uvMaxToday: number | null | undefined,
  hours: HourForecast[] = [],
): HTMLElement | null {
  const tiles: HTMLElement[] = [];

  if (current && has(current.apparentTemperature)) {
    const feels = tile('Ressenti', `${Math.round(current.apparentTemperature)}°`);
    const gap = Math.round(current.apparentTemperature) - Math.round(current.temperature);
    feels.sub.textContent =
      gap === 0 ? 'Comme la température réelle' : `${Math.abs(gap)}° de ${gap < 0 ? 'moins' : 'plus'} que le réel`;
    tiles.push(feels.root);
  }

  if (current && has(current.windSpeed)) {
    const wind = tile('Vent', KMH(current.windSpeed));
    const parts: string[] = [];
    if (has(current.windDirection)) {
      // Le vent « vient de » la direction indiquée : la flèche pointe là où il souffle.
      const arrow = el('span', 'wind-arrow', '↑');
      arrow.style.transform = `rotate(${Math.round(current.windDirection + 180)}deg)`;
      arrow.setAttribute('aria-hidden', 'true');
      wind.root.querySelector('.metric-value')?.append(' ', arrow);
      parts.push(`depuis ${compassLabel(current.windDirection)}`);
    }
    parts.push(windLevel(current.windSpeed));
    if (has(current.windGusts) && current.windGusts >= current.windSpeed + 10) {
      parts.push(`rafales ${KMH(current.windGusts)}`);
    }
    wind.sub.textContent = parts.join(' · ');
    tiles.push(wind.root);
  }

  if (current && has(current.humidity)) {
    const humidity = tile('Humidité', `${Math.round(current.humidity)} %`);
    humidity.sub.textContent = humidityLevel(current.humidity);
    tiles.push(humidity.root);
  }

  if (current && has(current.uvIndex)) {
    const category = uvCategory(current.uvIndex);
    const uv = tile('Indice UV', String(Math.round(current.uvIndex)), `uv-${category}`);
    const parts = [UV_LABELS[category]];
    if (has(uvMaxToday)) parts.push(`max ${Math.round(uvMaxToday)} aujourd'hui`);
    uv.sub.textContent = parts.join(' · ');
    tiles.push(uv.root);
  }

  if (hours.length > 0) {
    const next24 = hours.slice(0, 24);
    const rain = tile('Cumul de pluie', formatMm(rainTotal(hours, 24)));
    const parts = [`sur ${next24.length < 24 ? `les ${next24.length}` : 'les 24'} prochaines heures`];
    if (hours.length > 24) parts.push(`${formatMm(rainTotal(hours, 48))} sur 48 h`);
    rain.sub.textContent = parts.join(' · ');
    tiles.push(rain.root);
  }

  if (tiles.length === 0) return null;
  const grid = el('div', 'metrics');
  grid.append(...tiles);
  const section = el('section', 'conditions');
  section.append(el('h2', undefined, 'Conditions actuelles'), grid);
  return section;
}
