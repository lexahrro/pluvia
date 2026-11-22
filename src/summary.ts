import { formatTime } from './time.ts';
import { RAIN_LABELS, rainLevel } from './weather.ts';
import type { RainLevel, RainSlot } from './weather.ts';

/** Nombre de créneaux de 15 minutes affichés et analysés (16 x 15 min = 4 h). */
export const HORIZON_SLOTS = 16;

export interface RainSummary {
  headline: string;
  detail: string;
  /** Niveau de pluie le plus fort sur l'horizon : sert à l'ambiance visuelle. */
  mood: RainLevel;
}

const LEVEL_ORDER: RainLevel[] = ['none', 'light', 'moderate', 'heavy'];

export function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export function summarize(allSlots: RainSlot[], now: Date = new Date()): RainSummary {
  const slots = allSlots.slice(0, HORIZON_SLOTS);
  const horizonText = `${(HORIZON_SLOTS * 15) / 60} prochaines heures`;

  if (slots.length === 0) {
    return { headline: 'Pas de données', detail: 'Réessaie dans un instant.', mood: 'none' };
  }

  const levels = slots.map((s) => rainLevel(s.mm));
  const mood = levels.reduce<RainLevel>(
    (max, l) => (LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(max) ? l : max),
    'none',
  );

  const first = slots[0];
  const rainingNow = levels[0] !== 'none' && first.start.getTime() <= now.getTime();

  if (rainingNow) {
    const stopIndex = levels.findIndex((l, i) => i > 0 && l === 'none');
    return {
      headline: `${RAIN_LABELS[levels[0]]} en ce moment`,
      detail:
        stopIndex === -1
          ? `La pluie continue sur les ${horizonText}.`
          : `Fin prévue vers ${formatTime(slots[stopIndex].start)}.`,
      mood,
    };
  }

  const rainIndex = levels.findIndex((l) => l !== 'none');
  if (rainIndex === -1) {
    return { headline: 'Pas de pluie prévue', detail: `Sur les ${horizonText}.`, mood };
  }

  const start = slots[rainIndex].start;
  const minutes = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60_000));
  return {
    headline: `${RAIN_LABELS[levels[rainIndex]]} dans ${formatDelay(minutes)}`,
    detail: `À partir de ${formatTime(start)}.`,
    mood,
  };
}
