import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { seededUserDataDir } from './helpers/projectRoots';
import { launchClaudeTab } from './helpers/ui';

// Investigação #21 (e2e-30-07, onda 2) — reproduz DUAS abas 'claude' com
// modelo/esforço DIFERENTES e alterna o foco entre elas, checando se a
// StatusBar acompanha a aba em foco (não só a única aba do model-injection.spec.ts).

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  // O scanner varre `~/seazone`, que não lista uma worktree em
  // `.claude/worktrees/`: aponta para a pasta-mãe REAL do repo (a mesma
  // `~/seazone` no checkout principal), como `favorite-sessions.spec.ts`.
  ({ app: electronApp, window, userDataDir } = await launchIsolatedApp({ userDataDir: seededUserDataDir('model-per-tab') }));
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await closeIsolatedApp({ app: electronApp, userDataDir });
});

test('StatusBar acompanha o modelo/esforço da aba em foco, não só o da primeira aba lançada @abas', async () => {
  test.setTimeout(120_000);

  const statusBar = window.locator('div:has(> [data-testid="statusbar-account"])');

  // Sessão A: sonnet/high
  const tabA = await launchClaudeTab(window, { model: 'sonnet', effort: 'high', name: 'tab-sonnet-high' });
  await expect(statusBar).toContainText('sonnet/high');

  // Sessão B: opus/low. O Launcher já abre com o projeto do último lançamento
  // (T015, FR-007), por isso `project: null`.
  const tabB = await launchClaudeTab(window, { project: null, model: 'opus', effort: 'low', name: 'tab-opus-low' });
  await expect(statusBar).toContainText('opus/low');

  // Volta o foco pra aba A (clique direto na aba) — a StatusBar tem que
  // voltar a mostrar sonnet/high, não continuar em opus/low (achado #21).
  await tabA.click();
  await expect(tabA).toHaveAttribute('aria-selected', 'true');
  await expect(statusBar).toContainText('sonnet/high');

  // E de volta pra B.
  await tabB.click();
  await expect(tabB).toHaveAttribute('aria-selected', 'true');
  await expect(statusBar).toContainText('opus/low');
});
