import './style.css';
import { getPosition } from './location.ts';
import type { Position } from './location.ts';
import { fetchForecast, rainLevel, RAIN_LABELS } from './weather.ts';
import type { Forecast, RainSlot } from './weather.ts';
import { renderChart } from './chart.ts';
import { describeWeather } from './conditions.ts';
import { renderHourly } from './hourly.ts';
import { HORIZON_SLOTS, summarize } from './summary.ts';
import { mountRadar } from './radar.ts';
import type { RadarHandle } from './radar.ts';
import { loadForecast, saveForecast } from './cache.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

/** Carte radar en cours : à détruire avant chaque rechargement pour libérer la carte. */
let radar: RadarHandle | undefined;

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

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

function setMood(mood: string): void {
  document.documentElement.dataset.mood = mood;
}

function renderShell(): HTMLElement {
  app.replaceChildren();
  const main = el('main', 'screen');
  const content = el('div', 'content');
  main.append(el('h1', undefined, 'Pluvia'), content, el('footer', 'footer', 'Données météo : Open-Meteo.com (CC BY 4.0)'));
  app.append(main);
  return content;
}

function positionText(position: Position): string {
  const where = `${position.lat.toFixed(3)}, ${position.lon.toFixed(3)}`;
  return position.source === 'gps'
    ? `Ma position : ${where}`
    : `${position.reason ?? ''} Position par défaut : Paris (${where}).`;
}

function renderDetails(slots: RainSlot[]): HTMLElement {
  const details = el('details', 'details');
  details.append(el('summary', undefined, 'Détail par créneau'));
  const list = el('ul', 'slots');
  for (const slot of slots) {
    const level = rainLevel(slot.mm);
    const li = el('li', `slot ${level}`);
    li.append(
      el('span', 'slot-time', `${timeFormat.format(slot.start)} – ${timeFormat.format(slot.end)}`),
      el('span', 'slot-label', RAIN_LABELS[level]),
      el('span', 'slot-mm', `${slot.mm.toFixed(2)} mm`),
    );
    list.append(li);
  }
  details.append(list);
  return details;
}

function renderForecast(
  content: HTMLElement,
  position: Position,
  forecast: Forecast,
  offlineSince?: Date,
): void {
  if (offlineSince) {
    content.append(
      el(
        'p',
        'offline',
        `Hors ligne : dernières données reçues à ${timeFormat.format(offlineSince)}. Elles peuvent ne plus être à jour.`,
      ),
    );
  }

  const allSlots = forecast.rainSlots;
  const slots = allSlots.slice(0, HORIZON_SLOTS);
  const summary = summarize(allSlots);
  setMood(summary.mood);

  const hero = el('section', 'hero');
  if (forecast.current) {
    const info = describeWeather(forecast.current.weatherCode, forecast.current.isDay);
    hero.append(
      el('p', 'current', `${info.emoji} ${Math.round(forecast.current.temperature)}° · ${info.label}`),
    );
  }
  hero.append(el('p', 'headline', summary.headline), el('p', 'detail', summary.detail));

  const chartCard = el('section', 'chart-card');
  chartCard.append(renderChart(slots), el('p', 'caption', 'Pluie prévue, par tranches de 15 minutes'));

  const hourlySection = el('section', 'hourly');
  hourlySection.append(el('h2', undefined, 'Prochaines 48 heures'), renderHourly(forecast.hours));

  const radarSection = el('section', 'radar');
  radarSection.append(el('h2', undefined, 'Radar : les 2 dernières heures'));

  content.append(
    hero,
    chartCard,
    radarSection,
    hourlySection,
    renderDetails(slots),
    el('p', `where${position.source === 'default' ? ' warn' : ''}`, positionText(position)),
  );

  // La carte a besoin que son conteneur soit déjà dans la page.
  radar = mountRadar(radarSection, position);
}

async function load(): Promise<void> {
  radar?.destroy();
  radar = undefined;
  const content = renderShell();
  setMood('none');
  content.append(el('p', 'status', 'Localisation en cours…'));

  const position = await getPosition();
  content.replaceChildren(el('p', 'status', 'Chargement des prévisions…'));

  let updatedAt: Date | undefined;
  try {
    const forecast = await fetchForecast(position.lat, position.lon);
    content.replaceChildren();
    if (forecast.rainSlots.length === 0) {
      content.append(el('p', 'status', 'Aucune donnée disponible pour le moment.'));
    } else {
      saveForecast(position, forecast);
      renderForecast(content, position, forecast);
      updatedAt = new Date();
    }
  } catch (err) {
    // Pas de réseau ou service indisponible : on affiche la dernière prévision mémorisée si on en a une.
    const cached = loadForecast();
    if (cached) {
      content.replaceChildren();
      renderForecast(content, cached.position, cached.forecast, cached.savedAt);
      updatedAt = cached.savedAt;
    } else {
      // Un TypeError signale en pratique un échec réseau (« Failed to fetch »), peu parlant en l'état.
      const isNetwork = (err as Error | undefined)?.name === 'TypeError';
      const message = isNetwork
        ? 'Vérifie ta connexion internet.'
        : err instanceof Error
          ? err.message
          : 'Erreur inconnue.';
      content.replaceChildren(el('p', 'status error', `Impossible de charger les prévisions. ${message}`));
    }
  }

  lastLoadAt = Date.now();
  const retry = el('button', 'retry', 'Actualiser');
  retry.addEventListener('click', () => void load());
  content.append(
    retry,
    el('p', 'updated', updatedAt ? `Données de ${timeFormat.format(updatedAt)}` : ''),
  );
}

// L'app reste ouverte longtemps sur un téléphone : on rafraîchit quand elle revient au premier plan
// après un moment, et dès que le réseau revient.
const STALE_AFTER_MS = 10 * 60 * 1000;
let lastLoadAt = 0;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastLoadAt > STALE_AFTER_MS) {
    void load();
  }
});
window.addEventListener('online', () => void load());

void load();
