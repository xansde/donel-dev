import { defineConfig } from '@playwright/test';

// Config do roteiro de CAPTURA do tutorial (não é suíte de regressão — os
// smokes de verdade vivem em `tests/smoke/`). Fica fora de `tests/` de
// propósito: o glob do Playwright lá não deve pegar este arquivo, e o
// `npm test` (vitest) não deve nem enxergá-lo.
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
