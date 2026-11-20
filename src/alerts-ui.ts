import {
  alertsSupport,
  currentSubscription,
  DEFAULT_QUIET,
  describeSettings,
  disableAlerts,
  enableAlerts,
  loadSavedPlace,
  loadSettings,
  moveAlerts,
  samePlace,
  sendTest,
  updateSettings,
} from './alerts.ts';
import type { AlertPlace, AlertSettings } from './alerts.ts';

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

function button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = el('button', secondary ? 'alert-btn secondary' : 'alert-btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function select<T extends string>(
  label: string,
  options: [T, string][],
  value: T,
  onChange: (value: T) => void,
): HTMLElement {
  const row = el('label', 'alerts-field');
  const field = el('select');
  for (const [v, text] of options) {
    const option = el('option', undefined, text);
    option.value = v;
    field.append(option);
  }
  field.value = value;
  field.addEventListener('change', () => onChange(field.value as T));
  row.append(el('span', undefined, label), field);
  return row;
}

/** Bloc de réglages : délai, intensité minimale, plage « ne pas déranger ». */
function settingsBlock(settings: AlertSettings, apply: (next: AlertSettings) => void): HTMLElement {
  const block = el('div', 'alerts-settings');
  block.append(
    select<'15' | '30' | '60'>(
      'Prévenir',
      [['15', '15 min avant'], ['30', '30 min avant'], ['60', '1 h avant']],
      String(settings.leadMin) as '15' | '30' | '60',
      (v) => apply({ ...settings, leadMin: Number(v) as AlertSettings['leadMin'] }),
    ),
    select(
      'Pluie à partir de',
      [['any', 'Toute pluie'], ['moderate', 'Modérée'], ['heavy', 'Forte']],
      settings.minLevel,
      (minLevel) => apply({ ...settings, minLevel }),
    ),
  );

  const quiet = el('div', 'alerts-quiet');
  const toggle = el('label', 'alerts-field');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = settings.quiet !== null;
  box.addEventListener('change', () => apply({ ...settings, quiet: box.checked ? { ...DEFAULT_QUIET } : null }));
  toggle.append(el('span', undefined, 'Ne pas déranger'), box);
  quiet.append(toggle);
  if (settings.quiet) {
    const current = settings.quiet;
    const time = (label: string, key: 'from' | 'to'): HTMLElement => {
      const row = el('label', 'alerts-field');
      const input = el('input');
      input.type = 'time';
      input.required = true;
      input.value = current[key];
      input.addEventListener('change', () => {
        if (input.value) apply({ ...settings, quiet: { ...current, [key]: input.value } });
      });
      row.append(el('span', undefined, label), input);
      return row;
    };
    quiet.append(time('De', 'from'), time('À', 'to'));
  }
  block.append(quiet);
  return block;
}

/** Section « Alertes de pluie » : activer, tester, changer de lieu, désactiver. */
export function renderAlerts(current: AlertPlace): HTMLElement {
  const section = el('section', 'alerts');
  const card = el('div', 'alerts-card');
  section.append(el('h2', undefined, 'Alertes de pluie'), card);

  let busy = false;
  let message = '';

  async function run(action: () => Promise<string | void>): Promise<void> {
    if (busy) return;
    busy = true;
    message = 'Un instant…';
    void refresh();
    try {
      message = (await action()) ?? '';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Une erreur est survenue.';
    }
    busy = false;
    void refresh();
  }

  async function refresh(): Promise<void> {
    const parts: HTMLElement[] = [];
    const note = (text: string, className = 'alerts-text'): void => void parts.push(el('p', className, text));
    const support = alertsSupport();

    if (support === 'ios-install') {
      note('Sur iPhone, ajoute d’abord Pluvia à l’écran d’accueil (bouton Partager, puis « Sur l’écran d’accueil »), puis ouvre l’application depuis son icône.');
    } else if (support === 'unsupported') {
      note('Ce navigateur ne gère pas les notifications de l’application.');
    } else if (Notification.permission === 'denied') {
      note('Les notifications sont bloquées pour Pluvia. Autorise-les dans les réglages du navigateur (paramètres du site), puis recharge la page.');
    } else {
      const saved = loadSavedPlace();
      const subscription = await currentSubscription();
      if (saved && subscription) {
        note(`Alertes actives pour : ${saved.name}.`);
        const settings = loadSettings();
        note(describeSettings(settings), 'alerts-sub');
        parts.push(
          settingsBlock(settings, (next) =>
            void run(async () => (await updateSettings(next), 'Réglages enregistrés.')),
          ),
        );
        const row = el('div', 'alerts-actions');
        if (!samePlace(saved, current)) {
          row.append(button(`Surveiller ${current.name}`, () => void run(async () => (await moveAlerts(current), `Alertes déplacées vers ${current.name}.`))));
        }
        row.append(
          button('Envoyer un test', () => void run(async () => ((await sendTest()) ? 'Notification de test envoyée.' : 'Le test a échoué. Réessaie dans un instant.')), true),
          button('Désactiver', () => void run(async () => (await disableAlerts(), 'Alertes désactivées.')), true),
        );
        parts.push(row);
      } else {
        note('Reçois une notification quand la pluie commence bientôt. Tu pourras régler le délai, l’intensité et les heures de silence.');
        note('Ta position (arrondie à environ 1 km) et, si tu as choisi une ville, son nom sont enregistrés sur un petit serveur gratuit pour surveiller la météo. Tu peux tout supprimer en désactivant les alertes.', 'alerts-sub');
        parts.push(button(`Activer pour ${current.name}`, () => void run(async () => (await enableAlerts(current), 'Alertes activées.'))));
      }
    }

    if (message) parts.push(el('p', 'alerts-message', message));
    card.replaceChildren(...parts);
    card.querySelectorAll('button, select, input').forEach((b) => ((b as HTMLButtonElement).disabled = busy));
  }

  void refresh();
  return section;
}
