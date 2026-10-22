import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PetApp } from './PetApp';

/**
 * T017 (015-jobu-pet) — mounts the Jobu screen. The window is transparent (`transparent: true` on the
 * `BrowserWindow`), and what decides whether it shows up that way is the document background: the global reset and the
 * design system do not paint `html`/`body`, but `!important` guarantees that no stylesheet,
 * today or later, paints a rectangle around the drawing.
 */
export function mountPet(container: HTMLElement): void {
  document.title = 'Jobu Donel';
  document.documentElement.dataset.window = 'pet';

  const transparent = document.createElement('style');
  transparent.textContent = 'html, body, #root { background: transparent !important; }';
  document.head.appendChild(transparent);

  createRoot(container).render(
    <StrictMode>
      <PetApp />
    </StrictMode>,
  );
}
