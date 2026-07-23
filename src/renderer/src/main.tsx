import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Carrega tokens.css + fontes self-hosted como efeito colateral (README do
// design-system) — nenhum componente do pacote funciona sem este import.
import '@donel-dev/design-system';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
