// T047 (015-jobu-pet, US5, R13) - from the menu MODEL (src/shared/pet/menu.ts) to the template of Electron's
// native menu. This layer carries the labels, the check marks and the separator over and hands the chosen
// ACTION back to whoever asked for the menu; what the menu says is decided in the model and what an action
// does is decided in the service. Kept apart from pet-window.ts so it can be tested without a window.

import type { MenuItemConstructorOptions } from 'electron';
import type { PetMenuAction, PetMenuEntry } from '../../shared/pet/menu';

export function toMenuTemplate(entries: readonly PetMenuEntry[], onChoose: (action: PetMenuAction) => void): MenuItemConstructorOptions[] {
  return entries.map((entry): MenuItemConstructorOptions => {
    switch (entry.type) {
      case 'separator':
        return { type: 'separator' };
      case 'submenu':
        return {
          label: entry.label,
          // The mark says which size is in use. The menu is built again every time it opens, so the item that
          // Electron toggles by itself when it is clicked never has to be reconciled.
          submenu: entry.items.map((item) => ({ label: item.label, type: 'checkbox', checked: item.checked, click: () => onChoose(item.action) })),
        };
      case 'item':
        return { label: entry.label, click: () => onChoose(entry.action) };
    }
  });
}

/**
 * Runs the chosen action once, and only after BOTH things happened: the owner chose an item and the native menu
 * closed - in either order, because the order between the `click` of the item and the `callback` of `popup` is
 * Electron's. "Esconder" destroys the very window that owns the menu, so the action must never run inside the
 * activation of the menu. A menu closed with no choice runs nothing; after the run, later events are ignored.
 */
export function deferUntilMenuClosed<A>(run: (action: A) => void): { readonly choose: (action: A) => void; readonly closed: () => void } {
  let chosen: { readonly action: A } | null = null;
  let closed = false;
  let done = false;
  const settle = (): void => {
    if (done || !closed || chosen === null) return;
    done = true;
    run(chosen.action);
  };
  return {
    choose: (action) => {
      if (done) return;
      chosen = { action };
      settle();
    },
    closed: () => {
      closed = true;
      settle();
    },
  };
}
