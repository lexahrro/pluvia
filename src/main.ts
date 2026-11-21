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
import { renderAlerts } from './alerts-ui.ts';
import { renderConditions } from './metrics.ts';
import { renderSun } from './sun.ts';
import { formatDeviceTime, formatTime, setDisplayTimeZone } from './time.ts';
import { fetchDays } from './days.ts';
import { loadDays, saveDays } from './days-cache.ts';
import { renderDays } from './days-ui.ts';
import { createTabBar } from './tabs.ts';
import type { TabBar, View } from './tabs.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

/** Carte radar en cours : à détruire avant chaque rechargement pour libérer la carte. */
let radar: RadarHandle | undefined;
/** Lieu consulté : la position de l'appareil ou une ville choisie. */
let selection: Selection = loadSelection();
/** Numéro du chargement en cours : un chargement plus ancien ne doit plus rien afficher. */
let loadToken = 0;
/** Écran affiché : « Aujourd'hui » (prévision de pluie) ou « Jours » (prévisions par jour). */
let view: View = 'today';

/** Lieu de l'écran en cours, pour charger l'écran « Jours » seulement quand on l'ouvre. */
interface DaysContext {
  position: Position;
  key: string;
  loaded: boolean;
}
let daysContext: DaysContext | undefined;
let todayPane: HTMLElement | undefined;
let daysPane: HTMLElement | undefined;
let alertsPane: HTMLElement | undefined;
let tabBar: TabBar | undefined;

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

function showView(next: View): void {
  view = next;
  if (todayPane) todayPane.hidden = next !== 'today';
  if (daysPane) daysPane.hidden = next !== 'days';
  if (alertsPane) alertsPane.hidden = next !== 'alerts';
  tabBar?.set(next);
  window.scrollTo(0, 0);
  if (next === 'days') void ensureDays();
}

function renderShell(): { content: HTMLElement; topBar: TopBar } {
  app.replaceChildren();
  const main = el('main', 'screen');
  const content = el('div', 'content');
  const days = el('div', 'content');
  days.append(el('p', 'status', 'Chargement des prévisions…'));
  const alerts = el('div', 'content');
  alerts.append(el('p', 'status', 'Chargement…'));
  const topBar = createTopBar(selection, selectionLabel(selection), choose);
  todayPane = content;
  daysPane = days;
  alertsPane = alerts;
  tabBar = createTabBar(view, showView);
  content.hidden = view !== 'today';
  days.hidden = view !== 'days';
  alerts.hidden = view !== 'alerts';
  main.append(
    topBar.element,
    content,
    days,
    alerts,
    el('footer', 'footer', 'Météo, lieux et qualité de l\u2019air : Open-Meteo.com (CC BY 4.0) · données air : CAMS'),
  );
  app.append(main, tabBar.element);
  return { content, topBar };
}

/** Charge et affiche l'écran « Jours » pour le lieu en cours (une seule fois par chargement du lieu). */
async function ensureDays(): Promise<void> {
  const context = daysContext;
  const pane = daysPane;
  if (!context || !pane || context.loaded) return;
  context.loaded = true;
  pane.replaceChildren(el('p', 'status', 'Chargement des prévisions…'));

  const refresh = el('button', 'retry', 'Actualiser');
  refresh.addEventListener('click', () => void load());

  try {
    const data = await fetchDays(context.position.lat, context.position.lon);
    if (context !== daysContext) return;
    saveDays(context.key, data);
    pane.replaceChildren(renderDays(data), refresh);
  } catch (err) {
    if (context !== daysContext) return;
    const cached = loadDays(context.key);
    if (cached) {
      pane.replaceChildren(
        el('p', 'offline', `Hors ligne : dernières données reçues à ${formatDeviceTime(cached.savedAt)}. Elles peuvent ne plus être à jour.`),
        renderDays(cached.forecast),
        refresh,
      );
    } else {
      const isNetwork = (err as Error | undefined)?.name === 'TypeError';
      const message = isNetwork ? 'Vérifie ta connexion internet.' : err instanceof Error ? err.message : 'Erreur inconnue.';
      pane.replaceChildren(el('p', 'status error', `Impossible de charger les prévisions. ${message}`), refresh);
    }
  }
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

  // Ordre d'affichage : pluie prévue, radar, conditions actuelles, prochaines 48 h, soleil.
  content.append(hero, chartCard, radarSection);
  const conditions = renderConditions(forecast.current, forecast.uvMaxToday, forecast.hours, forecast.rainTodayMm, forecast.air);
  if (conditions) content.append(conditions);
  content.append(hourlySection);
  const sun = renderSun(forecast.sun);
  if (sun) content.append(sun);
  content.append(renderDetails(slots));
  // Les alertes vivent dans leur propre onglet ; elles ont besoin du fuseau du lieu, connu avec la prévision.
  alertsPane?.replaceChildren(
    renderAlerts({
      lat: position.lat,
      lon: position.lon,
      name: selectionLabel(selection, position),
      city: selection.kind === 'place' ? selection.place.name : undefined,
      timezone: forecast.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );
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
  daysContext = undefined;
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
  // L'écran « Jours » ne se charge que si on l'ouvre (tout de suite s'il est déjà affiché).
  daysContext = { position, key, loaded: false };
  if (view === 'days') void ensureDays();

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

  // Sans prévision (ni réseau ni cache), on ne connaît pas le fuseau du lieu : pas d'alertes pour l'instant.
  if (alertsPane && alertsPane.querySelector('.alerts') === null) {
    const again = el('button', 'retry', 'Actualiser');
    again.addEventListener('click', () => void load());
    alertsPane.replaceChildren(
      el('p', 'status', 'Les alertes seront disponibles dès que les prévisions auront pu être chargées.'),
      again,
    );
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
