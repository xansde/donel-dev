import { defineConfig } from '@playwright/test';

// Smoke permanente de MODO DEV (feedback E2E rodada 1 / diagnóstico do bug
// StrictMode) — variante de tests/smoke/playwright.config.ts que roda o app
// com o RENDERER servido por um Vite dev server de verdade
// (`ELECTRON_RENDERER_URL`, ver dev-mode.spec.ts), não o bundle de produção
// buildado em `out/renderer/`. É a única forma de exercitar o React 18
// <StrictMode> double-invoke de efeitos de verdade: `vite build` (produção)
// resolve `react-dom` pro build de produção, que NÃO double-invoca — só
// `npm run dev`/um Vite dev server usa o build de desenvolvimento do React,
// onde o StrictMode double-invoke acontece. Os smokes em tests/smoke/ rodam
// contra `out/main/index.js` + `out/renderer/index.html` (produção) — nunca
// pegariam uma regressão como a do StrictMode (achado real do diagnóstico
// 2026-07-23, ver feedback-e2e.md). `main`/`preload` continuam sendo o
// build de produção normal (`out/main`, `out/preload`) — StrictMode é
// conceito exclusivo do React no RENDERER, não afeta esses dois processos.
export default defineConfig({
  testDir: '.',
  // Only Playwright specs: the folder also holds vitest files (*.test.ts), and
  // collecting them aborts the run ("Vitest cannot be imported in a CommonJS module").
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
