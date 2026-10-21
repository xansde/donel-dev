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
