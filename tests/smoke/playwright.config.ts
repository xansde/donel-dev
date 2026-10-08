import { defineConfig } from '@playwright/test';

// Smoke roteirizado da T004 (PTY + xterm) — plan.md "Testes": vitest nos
// módulos puros, smoke manual/roteirizado pra PTY/UI. `_electron.launch`
// dirige o app já buildado (out/main/index.js); não precisa de browser
// baixado (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 no install).
export default defineConfig({
  testDir: '.',
  // Only Playwright specs: the folder also holds vitest files (*.test.ts), and
  // collecting them aborts the run ("Vitest cannot be imported in a CommonJS module").
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
