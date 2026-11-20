import { describeWeather } from './conditions.ts';
import { DAYS_SHOWN, PERIOD_HOURS, PERIOD_LABELS } from './days.ts';
import type { DayForecast, DaysForecast, PeriodForecast } from './days.ts';
import { compassLabel, uvCategory } from './metrics.ts';
import { dayDifference, formatDayMonth, formatWeekdayLong, setDisplayTimeZone } from './time.ts';

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

const MM = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * « Aujourd'hui », « Demain », puis le jour de la semaine (« Vendredi »).
 * Une journée déjà passée dont la nuit n'est pas finie (il est 3 h, la nuit de la veille se termine à 6 h) : « Cette nuit ».
 */
export function dayTitle(date: Date, now: Date): string {
  const diff = dayDifference(date, now);
  if (diff < 0) return 'Cette nuit';
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  const weekday = formatWeekdayLong(date);
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

/** Plage affichée sous le nom de la période : « 6–12 h » ; la nuit se passe le lendemain, de 0 h à 6 h. */
export function periodRange(period: PeriodForecast): string {
  const [from, to] = PERIOD_HOURS[period.id];
  return period.id === 'night' ? `lendemain ${from}–${to} h` : `${from}–${to} h`;
}

function line(className: string, text: string): HTMLElement {
  return el('span', className, text);
}

function renderPeriod(period: PeriodForecast, now: Date): HTMLElement {
  const info = describeWeather(period.weatherCode, period.isDay);
  const inProgress = period.start <= now.getTime() && now.getTime() < period.end;
  const card = el('li', inProgress ? 'period current' : 'period');
  card.title = `${PERIOD_LABELS[period.id]} : ${info.label}`;

  const temperature = Math.round(period.temperature);
  const feels = period.feelsLike !== null ? Math.round(period.feelsLike) : null;

  const rain = el('span', 'period-rain');
  rain.append(
    line('period-mm', period.rainMm >= 0.1 ? `${MM.format(period.rainMm)} mm` : 'Sec'),
    line('period-prob', period.rainProbability !== null && period.rainProbability >= 10 ? `${Math.round(period.rainProbability)} %` : ''),
  );

  const wind = el('span', 'period-wind');
  if (period.windSpeed !== null) {
    if (period.windDirection !== null) {
      const direction = el('span', 'period-wind-dir');
      const arrow = el('span', 'wind-arrow', '↑');
      arrow.style.transform = `rotate(${Math.round(period.windDirection + 180)}deg)`;
      arrow.setAttribute('aria-hidden', 'true');
      direction.append(arrow, ` ${compassLabel(period.windDirection)}`);
      wind.append(direction);
    }
    wind.append(line('period-wind-speed', `${Math.round(period.windSpeed)} km/h`));
    const gust = period.windGusts !== null ? Math.round(period.windGusts) : null;
    // Les rafales ne comptent que si elles sont nettement plus fortes que le vent moyen.
    if (gust !== null && gust - period.windSpeed >= 10) wind.append(line('period-gust', `raf. ${gust}`));
  }

  // L'UV n'a de sens que de jour : on masque les valeurs qui arrondissent à 0.
  const uvValue = period.uvMax !== null ? Math.round(period.uvMax) : 0;
  const uv = el(
    'span',
    uvValue >= 1 ? `period-uv uv-${uvCategory(period.uvMax ?? 0)}` : 'period-uv',
    uvValue >= 1 ? `UV ${uvValue}` : '',
  );
  const clouds = el('span', 'period-clouds', period.cloudCover !== null ? `☁ ${Math.round(period.cloudCover)} %` : '');

  card.append(
    el('span', 'period-name', PERIOD_LABELS[period.id]),
    el('span', 'period-range', periodRange(period)),
    el('span', 'period-icon', info.emoji),
    el('span', 'period-temp', `${temperature}°`),
    el('span', 'period-feels', feels !== null && Math.abs(feels - temperature) >= 1 ? `ress. ${feels}°` : ''),
    rain,
    wind,
    uv,
    clouds,
  );
  return card;
}

function renderDay(day: DayForecast, periods: PeriodForecast[], now: Date): HTMLElement {
  const date = new Date(day.date);
  const card = el('article', 'day-card');

  const code = day.weatherCode ?? periods[Math.min(1, periods.length - 1)]?.weatherCode ?? 3;
  const info = describeWeather(code, true);

  const title = el('div', 'day-title');
  title.append(el('strong', undefined, dayTitle(date, now)), el('span', 'day-date', formatDayMonth(date)));

  const temps = el('div', 'day-temps');
  temps.append(
    el('strong', undefined, day.tempMax !== null ? `${Math.round(day.tempMax)}°` : '–'),
    el('span', 'day-min', day.tempMin !== null ? `${Math.round(day.tempMin)}°` : ''),
  );

  const rainParts: string[] = [];
  if (day.rainMm !== null && day.rainMm >= 0.1) rainParts.push(`${MM.format(day.rainMm)} mm`);
  if (day.rainProbability !== null && day.rainProbability >= 10) rainParts.push(`${Math.round(day.rainProbability)} %`);

  const head = el('header', 'day-head');
  const summary = el('div', 'day-summary');
  summary.append(el('span', 'day-icon', info.emoji), el('span', 'day-label', info.label));
  head.append(title, summary, temps);
  if (rainParts.length > 0) head.append(el('p', 'day-rain', `Pluie : ${rainParts.join(' · ')}`));

  const list = el('ol', 'periods');
  list.style.setProperty('--n', String(periods.length));
  list.setAttribute('aria-label', 'Matin, après-midi, soir et nuit');
  for (const period of periods) list.append(renderPeriod(period, now));

  card.append(head, list);
  return card;
}

/** Page « Jours » : une carte par jour, avec ses quatre périodes. Les périodes déjà terminées sont masquées. */
export function renderDays(data: DaysForecast, now: Date = new Date()): HTMLElement {
  setDisplayTimeZone(data.timezone);
  const section = el('section', 'days');
  section.append(el('h2', undefined, `Prévisions sur ${DAYS_SHOWN} jours`));

  let shown = 0;
  for (const day of data.days) {
    const periods = day.periods.filter((p) => p.end > now.getTime());
    if (periods.length === 0) continue;
    section.append(renderDay(day, periods, now));
    shown++;
  }
  if (shown === 0) section.append(el('p', 'status', 'Aucune donnée disponible pour le moment.'));
  else section.append(el('p', 'caption', 'Matin 6–12 h, après-midi 12–18 h, soir 18–24 h, nuit 0–6 h. Températures moyennes de chaque période.'));
  return section;
}
