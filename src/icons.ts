/**
 * Petites icônes SVG intégrées (pas de police d'icônes à charger, donc rien de plus à télécharger
 * ni à mettre en cache pour le mode hors ligne). Elles héritent de la couleur du texte.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconName = 'location-arrow' | 'bars' | 'chevron-down' | 'drop' | 'calendar';

/** Tracés dans une grille de 24 x 24. */
const PATHS: Record<IconName, { d: string; filled: boolean }> = {
  // Flèche de navigation inclinée, pleine : « ma position ».
  'location-arrow': { d: 'M21 3 L3 10.5 L11 13 L13.5 21 Z', filled: true },
  // Trois barres horizontales : « choisir un lieu dans la liste ».
  bars: { d: 'M4 6 H20 M4 12 H20 M4 18 H20', filled: false },
  // Chevron pointant vers le bas : « déplier ».
  'chevron-down': { d: 'M6 9.5 L12 15.5 L18 9.5', filled: false },
  // Goutte : l'écran « Aujourd'hui » (pluie prévue).
  drop: { d: 'M12 3 C8 8.5 5.5 11.5 5.5 15 a6.5 6.5 0 0 0 13 0 C18.5 11.5 16 8.5 12 3 Z', filled: true },
  // Calendrier : l'écran « Jours ».
  calendar: { d: 'M4 6 H20 V20 H4 Z M4 10.5 H20 M8.5 3.5 V7.5 M15.5 3.5 V7.5', filled: false },
};

export function icon(name: IconName, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon icon-${name}${className ? ` ${className}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const { d, filled } = PATHS[name];
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  if (filled) path.setAttribute('class', 'icon-fill');
  svg.append(path);
  return svg;
}
