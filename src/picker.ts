import { addPlace, loadPlaces, MIN_QUERY_LENGTH, removePlace, searchPlaces } from './places.ts';
import type { Place, Selection } from './places.ts';
import { icon } from './icons.ts';

export interface TopBar {
  element: HTMLElement;
  /** Met à jour le nom du lieu affiché sur le bouton. */
  setLabel(text: string): void;
}

const DEBOUNCE_MS = 300;

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

function placeButton(place: Place, className: string): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.append(el('span', 'place-name', place.name));
  if (place.subtitle) button.append(el('small', 'place-sub', place.subtitle));
  return button;
}

/**
 * Barre du haut : titre, bouton du lieu courant et panneau de choix
 * (ma position, recherche d'une ville, lieux enregistrés).
 */
export function createTopBar(
  selection: Selection,
  label: string,
  onSelect: (selection: Selection) => void,
): TopBar {
  const element = el('div', 'top');

  const row = el('header', 'top-row');
  const labelEl = el('span', 'place-label', label);
  const toggle = el('button', 'place-btn');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'picker');
  // Icône selon le choix : flèche pour « ma position », barres pour une ville de la liste.
  toggle.append(icon(selection.kind === 'gps' ? 'location-arrow' : 'bars', 'place-icon'), labelEl, icon('chevron-down', 'caret'));
  // Logo (le même fichier que l'icône de l'application) devant le nom, en blanc.
  const title = el('h1', 'brand');
  const logo = el('img', 'brand-logo');
  logo.src = `${import.meta.env.BASE_URL}favicon.svg`;
  logo.alt = '';
  logo.width = 32;
  logo.height = 32;
  title.append(logo, 'Pluvia');
  row.append(title, toggle);

  const panel = el('section', 'picker');
  panel.id = 'picker';
  panel.hidden = true;

  const gps = el('button', `picker-gps${selection.kind === 'gps' ? ' active' : ''}`);
  gps.type = 'button';
  const gpsContent = el('span', 'picker-gps-content');
  gpsContent.append(icon('location-arrow', 'place-icon'), 'Ma position');
  gps.append(gpsContent);
  gps.addEventListener('click', () => onSelect({ kind: 'gps' }));

  const input = el('input', 'picker-input');
  input.type = 'search';
  input.placeholder = 'Rechercher une ville…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Rechercher une ville');

  const status = el('p', 'picker-status');
  status.setAttribute('role', 'status');
  const results = el('ul', 'results');
  const savedTitle = el('h2', 'picker-title', 'Mes lieux');
  const saved = el('ul', 'saved');

  function choose(place: Place): void {
    addPlace(place);
    onSelect({ kind: 'place', place });
  }

  function renderResults(found: Place[]): void {
    results.replaceChildren(
      ...found.map((place) => {
        const li = el('li');
        const button = placeButton(place, 'place-item');
        button.addEventListener('click', () => choose(place));
        li.append(button);
        return li;
      }),
    );
  }

  function renderSaved(): void {
    const places = loadPlaces();
    savedTitle.hidden = places.length === 0;
    saved.replaceChildren(
      ...places.map((place) => {
        const isActive = selection.kind === 'place' && selection.place.id === place.id;
        const li = el('li', 'saved-row');
        const select = placeButton(place, `place-item${isActive ? ' active' : ''}`);
        select.addEventListener('click', () => choose(place));
        const remove = el('button', 'place-remove', '✕');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Retirer ${place.name} de mes lieux`);
        remove.addEventListener('click', () => {
          removePlace(place.id);
          if (isActive) onSelect({ kind: 'gps' });
          else renderSaved();
        });
        li.append(select, remove);
        return li;
      }),
    );
  }

  let timer: number | undefined;
  let controller: AbortController | undefined;

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    controller?.abort();
    results.replaceChildren();
    const query = input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      status.textContent = '';
      return;
    }
    status.textContent = 'Recherche…';
    timer = window.setTimeout(() => {
      const mine = new AbortController();
      controller = mine;
      searchPlaces(query, mine.signal)
        .then((found) => {
          if (mine.signal.aborted) return;
          status.textContent = found.length === 0 ? 'Aucun résultat.' : '';
          renderResults(found);
        })
        .catch(() => {
          if (mine.signal.aborted) return;
          status.textContent = 'Recherche impossible. Vérifie ta connexion.';
        });
    }, DEBOUNCE_MS);
  });

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderSaved();
      input.focus();
    }
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden !== false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    }
  });

  panel.append(gps, input, status, results, savedTitle, saved);
  renderSaved();
  element.append(row, panel);

  return {
    element,
    setLabel(text: string) {
      labelEl.textContent = text;
    },
  };
}
