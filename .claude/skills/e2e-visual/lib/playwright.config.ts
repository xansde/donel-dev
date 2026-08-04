import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Config dos ROTEIROS da skill `e2e-visual`. Separada da suíte de smoke
// (`tests/smoke/`) de propósito: aqui o objetivo não é passar ou falhar, é
// FOTOGRAFAR o que a tela diz em cada estado. Um roteiro que morre no meio
// ainda entrega valor — o relatório mostra até onde foi.
export default defineConfig({
  testDir: path.resolve(__dirname, '../roteiros'),
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
