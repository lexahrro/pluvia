import { describeWeather } from './conditions.ts';
import { dayDifference, formatTime, formatWeekday, localHour } from './time.ts';
import type { HourForecast } from './weather.ts';

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

/** « Auj. », « Demain » ou le jour de la semaine (ven., sam., …), dans le fuseau du lieu. */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const diff = dayDifference(date, now);
  if (diff === 0) return 'Auj.';
  if (diff === 1) return 'Demain';
  return formatWeekday(date);
}

export function renderHourly(hours: HourForecast[], now: Date = new Date()): HTMLElement {
  const strip = el('ol', 'hours');
  strip.setAttribute('aria-label', 'Prévisions heure par heure');

  hours.forEach((hour, i) => {
    const info = describeWeather(hour.weatherCode, hour.isDay);
    const isNewDay = i === 0 || localHour(hour.time) === 0;

    const card = el('li', 'hour');
    card.title = info.label;

    const probability =
      hour.precipProbability !== null && hour.precipProbability >= 10
        ? `${Math.round(hour.precipProbability)} %`
        : '';
    const amount = hour.precipitation >= 0.1 ? `${hour.precipitation.toFixed(1)} mm` : '';

    card.append(
      el('span', 'hour-day', isNewDay ? dayLabel(hour.time, now) : ''),
      el('span', 'hour-time', i === 0 ? 'Maint.' : formatTime(hour.time)),
      el('span', 'hour-icon', info.emoji),
      el('span', 'hour-temp', `${Math.round(hour.temperature)}°`),
      el('span', 'hour-prob', probability),
      el('span', 'hour-mm', amount),
    );
    strip.append(card);
  });

  return strip;
}
