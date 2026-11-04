import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './global.css';
import '@donel-dev/design-system';
// T010 (achado ao testar o dropdown do "＋ Nova sessão") — o import acima
// carrega só o JS. `design-system/package.json` builda tokens.css/fontes num
// `dist/style.css` SEPARADO (vite library mode não inlina CSS no bundle JS);
// sem este import explícito, `--sidebar-width`/`--right-panel-width`/
// `--accent`/etc. nunca existem no documento — `grid-template-columns: var(--sidebar-width) 1fr var(--right-panel-width)`
// (App.module.css `.body`) vira inválido e colapsa pra 1 coluna só, empilhando
// sidebar/centro/painel direito no mesmo espaço (bug pré-existente desde o
// T003/T007, nunca pego pelos smokes anteriores porque nenhum clicava em algo
// cuja hit-area dependesse da largura real das colunas — o dropdown do
// SplitButton foi o primeiro a esbarrar nisso, T010).
import '@donel-dev/design-system/style.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

/**
 * T017 (015-jobu-pet, R18) — one `index.html`, two screens. The main window loads the page
 * without a hash and mounts the `App`; the Jobu window loads the same page at `#pet` and mounts the `PetApp`.
 * Both imports are DYNAMIC on purpose: the pet never evaluates the `App` module (which brings up the
 * whole app), and the main window never loads the pet code.
 */
async function boot(root: HTMLElement): Promise<void> {
  if (window.location.hash === '#pet') {
    const { mountPet } = await import('./pet/mountPet');
    mountPet(root);
    return;
  }
  // Item 18 (PDA mindscape-openrig) — the floating window of the conversation with the Jobu as Líder.
  if (window.location.hash === '#lider') {
    document.title = 'Jobu · Líder';
    const { LiderApp } = await import('./lider/LiderApp');
    createRoot(root).render(
      <StrictMode>
        <LiderApp />
      </StrictMode>,
    );
    return;
  }
  const { App } = await import('./App');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot(container).catch((error: unknown) => {
  console.error('[donel-dev] a tela não montou:', error);
});
