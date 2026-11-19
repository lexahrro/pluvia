import {
  alertsSupport,
  currentSubscription,
  disableAlerts,
  enableAlerts,
  loadSavedPlace,
  moveAlerts,
  samePlace,
  sendTest,
} from './alerts.ts';
import type { AlertPlace } from './alerts.ts';

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
        note('Tu es prévenu quand la pluie commence dans les 30 minutes (une alerte par épisode de pluie).', 'alerts-sub');
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
        note('Reçois une notification quand la pluie commence dans les 30 minutes.');
        note('Ta position (arrondie à environ 1 km) est enregistrée sur un petit serveur gratuit pour surveiller la météo. Tu peux tout supprimer en désactivant les alertes.', 'alerts-sub');
        parts.push(button(`Activer pour ${current.name}`, () => void run(async () => (await enableAlerts(current), 'Alertes activées.'))));
      }
    }

    if (message) parts.push(el('p', 'alerts-message', message));
    card.replaceChildren(...parts);
    card.querySelectorAll('button').forEach((b) => (b.disabled = busy));
  }

  void refresh();
  return section;
}
