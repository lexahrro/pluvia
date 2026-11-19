export interface ConditionInfo {
  emoji: string;
  label: string;
}

/** Codes météo WMO utilisés par Open-Meteo, traduits en français. */
export function describeWeather(code: number, isDay: boolean): ConditionInfo {
  switch (code) {
    case 0:
      return isDay ? { emoji: '☀️', label: 'Ensoleillé' } : { emoji: '🌙', label: 'Ciel dégagé' };
    case 1:
      return isDay ? { emoji: '🌤️', label: 'Peu nuageux' } : { emoji: '🌙', label: 'Peu nuageux' };
    case 2:
      return { emoji: '⛅', label: 'Éclaircies' };
    case 3:
      return { emoji: '☁️', label: 'Couvert' };
    case 45:
    case 48:
      return { emoji: '🌫️', label: 'Brouillard' };
    case 51:
    case 53:
    case 55:
      return { emoji: '🌦️', label: 'Bruine' };
    case 56:
    case 57:
      return { emoji: '🌧️', label: 'Bruine verglaçante' };
    case 61:
      return { emoji: '🌦️', label: 'Pluie faible' };
    case 63:
      return { emoji: '🌧️', label: 'Pluie modérée' };
    case 65:
      return { emoji: '🌧️', label: 'Forte pluie' };
    case 66:
    case 67:
      return { emoji: '🌧️', label: 'Pluie verglaçante' };
    case 71:
    case 73:
    case 75:
    case 77:
      return { emoji: '❄️', label: 'Neige' };
    case 80:
    case 81:
      return { emoji: '🌦️', label: 'Averses' };
    case 82:
      return { emoji: '🌧️', label: 'Fortes averses' };
    case 85:
    case 86:
      return { emoji: '🌨️', label: 'Averses de neige' };
    case 95:
      return { emoji: '⛈️', label: 'Orage' };
    case 96:
    case 99:
      return { emoji: '⛈️', label: 'Orage et grêle' };
    default:
      return { emoji: '❔', label: 'Inconnu' };
  }
}
