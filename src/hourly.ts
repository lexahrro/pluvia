import { describeWeather } from './conditions.ts';
import type { HourForecast } from './weather.ts';

const hourFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** « Auj. », « Demain » ou le jour de la semaine (ven., sam., …). */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / dayMs);
  if (diffDays === 0) return 'Auj.';
  if (diffDays === 1) return 'Demain';
  return weekdayFormat.format(date);
}

export function renderHourly(hours: HourForecast[], now: Date = new Date()): HTMLElement {
  const strip = el('ol', 'hours');
  strip.setAttribute('aria-label', 'Prévisions heure par heure');

  hours.forEach((hour, i) => {
    const info = describeWeather(hour.weatherCode, hour.isDay);
    const isNewDay = i === 0 || hour.time.getHours() === 0;

    const card = el('li', 'hour');
    card.title = info.label;

    const probability =
      hour.precipProbability !== null && hour.precipProbability >= 10
        ? `${Math.round(hour.precipProbability)} %`
        : '';
    const amount = hour.precipitation >= 0.1 ? `${hour.precipitation.toFixed(1)} mm` : '';

    card.append(
      el('span', 'hour-day', isNewDay ? dayLabel(hour.time, now) : ''),
      el('span', 'hour-time', i === 0 ? 'Maint.' : hourFormat.format(hour.time)),
      el('span', 'hour-icon', info.emoji),
      el('span', 'hour-temp', `${Math.round(hour.temperature)}°`),
      el('span', 'hour-prob', probability),
      el('span', 'hour-mm', amount),
    );
    strip.append(card);
  });

  return strip;
}
