import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PetApp } from './PetApp';

/**
 * T017 (015-jobu-pet) — monta a tela do Jobu. A janela é transparente (`transparent: true` no
 * `BrowserWindow`), e o que decide se ela aparece assim é o fundo do documento: o reset global e o
 * design system não pintam `html`/`body`, mas `!important` garante que nenhuma folha de estilo,
 * hoje ou depois, pinte um retângulo em volta do desenho.
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
