import { icon } from './icons.ts';
import type { IconName } from './icons.ts';

export type View = 'today' | 'days';

export interface TabBar {
  element: HTMLElement;
  set(view: View): void;
}

const TABS: { view: View; label: string; icon: IconName }[] = [
  { view: 'today', label: 'Aujourd’hui', icon: 'drop' },
  { view: 'days', label: 'Jours', icon: 'calendar' },
];

/** Barre d'onglets fixée en bas de l'écran : « Aujourd'hui » (écran principal) et « Jours » (prévisions par jour). */
export function createTabBar(current: View, onChange: (view: View) => void): TabBar {
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', 'Navigation');
  const buttons = new Map<View, HTMLButtonElement>();

  for (const tab of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.append(icon(tab.icon, 'tab-icon'), tab.label);
    button.addEventListener('click', () => onChange(tab.view));
    buttons.set(tab.view, button);
    nav.append(button);
  }

  const set = (view: View): void => {
    for (const [v, button] of buttons) {
      if (v === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  };
  set(current);
  return { element: nav, set };
}
