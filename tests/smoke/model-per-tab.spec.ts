import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { APP_MAIN, PROJECT_NAME, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Investigação #21 (e2e-30-07, onda 2) — reproduz DUAS abas 'claude' com
// modelo/esforço DIFERENTES e alterna o foco entre elas, checando se a
// StatusBar acompanha a aba em foco (não só a única aba do model-injection.spec.ts).

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('model-per-tab');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: REPO_ROOT });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
  }
});

test('StatusBar acompanha o modelo/esforço da aba em foco, não só o da primeira aba lançada', async () => {
  test.setTimeout(120_000);

  const statusBar = window.locator('div:has(> [data-testid="statusbar-account"])');

  // Sessão A: sonnet/high
  await window.getByRole('button', { name: '＋ Nova sessão', exact: true }).click();
  let launcher = window.locator('aside[aria-label="Lançar sessão"]');
  await expect(launcher).toBeVisible();
  await launcher.getByRole('button', { name: 'Selecione um projeto' }).click();
  await window.getByRole('option', { name: PROJECT_NAME, exact: true }).click();
  await launcher.getByRole('radio', { name: 'sonnet', exact: true }).click();
  await launcher.getByRole('radio', { name: 'high', exact: true }).click();
  await launcher.getByLabel('Nome').fill('tab-sonnet-high');
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const tabA = window.locator('[role="tab"]', { hasText: 'tab-sonnet-high' });
  await expect(tabA).toBeVisible();
  await expect(tabA).toHaveAttribute('aria-selected', 'true');
  await expect(statusBar).toContainText('sonnet/high');

  // Sessão B: opus/low — nasce em foco (addTab sempre foca a aba nova).
  // FIX (T015, FR-007): o Launcher já abre com o projeto/modelo/esforço do
  // ÚLTIMO lançamento como default (`launcherDefaults`) — o Select de projeto
  // não mostra mais "Selecione um projeto" quando já houve um lançamento
  // anterior na sessão do app.
  await window.getByRole('button', { name: '＋ Nova sessão', exact: true }).click();
  launcher = window.locator('aside[aria-label="Lançar sessão"]');
  await expect(launcher).toBeVisible();
  await launcher.getByRole('radio', { name: 'opus', exact: true }).click();
  await launcher.getByRole('radio', { name: 'low', exact: true }).click();
  await launcher.getByLabel('Nome').fill('tab-opus-low');
  await launcher.getByRole('button', { name: '▶ Iniciar' }).click();

  const tabB = window.locator('[role="tab"]', { hasText: 'tab-opus-low' });
  await expect(tabB).toBeVisible();
  await expect(tabB).toHaveAttribute('aria-selected', 'true');
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
