import './style.css';
import { getPosition, positionFromPlace } from './location.ts';
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
import { loadSelection, saveSelection, selectionKey } from './places.ts';
import type { Selection } from './places.ts';
import { createTopBar } from './picker.ts';
import type { TopBar } from './picker.ts';
import { renderConditions } from './metrics.ts';
import { formatDeviceTime, formatTime, setDisplayTimeZone } from './time.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

/** Carte radar en cours : à détruire avant chaque rechargement pour libérer la carte. */
let radar: RadarHandle | undefined;
/** Lieu consulté : la position de l'appareil ou une ville choisie. */
let selection: Selection = loadSelection();
/** Numéro du chargement en cours : un chargement plus ancien ne doit plus rien afficher. */
let loadToken = 0;

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

function selectionLabel(current: Selection, position?: Position): string {
  if (current.kind === 'place') return current.place.name;
  return position?.source === 'default' ? 'Paris (par défaut)' : 'Ma position';
}

function choose(next: Selection): void {
  selection = next;
  saveSelection(next);
  window.scrollTo(0, 0);
  void load();
}

function renderShell(): { content: HTMLElement; topBar: TopBar } {
  app.replaceChildren();
  const main = el('main', 'screen');
  const content = el('div', 'content');
  const topBar = createTopBar(selection, selectionLabel(selection), choose);
  main.append(
    topBar.element,
    content,
    el('footer', 'footer', 'Météo et lieux : Open-Meteo.com (CC BY 4.0)'),
  );
  app.append(main);
  return { content, topBar };
}

function renderDetails(slots: RainSlot[]): HTMLElement {
  const details = el('details', 'details');
  details.append(el('summary', undefined, 'Détail par créneau'));
  const list = el('ul', 'slots');
  for (const slot of slots) {
    const level = rainLevel(slot.mm);
    const li = el('li', `slot ${level}`);
    li.append(
      el('span', 'slot-time', `${formatTime(slot.start)} – ${formatTime(slot.end)}`),
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
  // Toutes les heures affichées sont celles du lieu, pas celles de l'appareil.
  setDisplayTimeZone(forecast.timezone);

  if (offlineSince) {
    content.append(
      el(
        'p',
        'offline',
        `Hors ligne : dernières données reçues à ${formatDeviceTime(offlineSince)}. Elles peuvent ne plus être à jour.`,
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

  content.append(hero, chartCard);
  const conditions = renderConditions(forecast.current, forecast.uvMaxToday);
  if (conditions) content.append(conditions);
  content.append(radarSection, hourlySection, renderDetails(slots));
  if (position.source === 'default') {
    content.append(
      el('p', 'where warn', `${position.reason ?? ''} Position par défaut : Paris. Choisis une ville pour changer.`),
    );
  }

  // La carte a besoin que son conteneur soit déjà dans la page.
  radar = mountRadar(radarSection, position);
}

async function load(): Promise<void> {
  const token = ++loadToken;
  radar?.destroy();
  radar = undefined;
  const { content, topBar } = renderShell();
  setMood('none');

  const key = selectionKey(selection);
  let position: Position;
  if (selection.kind === 'place') {
    position = positionFromPlace(selection.place);
  } else {
    content.append(el('p', 'status', 'Localisation en cours…'));
    position = await getPosition();
    if (token !== loadToken) return;
    topBar.setLabel(selectionLabel(selection, position));
  }
  content.replaceChildren(el('p', 'status', 'Chargement des prévisions…'));

  let updatedAt: Date | undefined;
  try {
    const forecast = await fetchForecast(position.lat, position.lon);
    if (token !== loadToken) return;
    content.replaceChildren();
    if (forecast.rainSlots.length === 0) {
      content.append(el('p', 'status', 'Aucune donnée disponible pour le moment.'));
    } else {
      saveForecast(key, position, forecast);
      renderForecast(content, position, forecast);
      updatedAt = new Date();
    }
  } catch (err) {
    if (token !== loadToken) return;
    // Pas de réseau ou service indisponible : on affiche la dernière prévision de CE lieu si on en a une.
    const cached = loadForecast(key);
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
    el('p', 'updated', updatedAt ? `Données de ${formatDeviceTime(updatedAt)}` : ''),
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
