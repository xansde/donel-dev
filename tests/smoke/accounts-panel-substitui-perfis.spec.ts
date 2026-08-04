import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// T1227 (011-contas-e-provedores, etapa 2, Fase 4) — o dropdown de perfis
// (`ProfileSwitcher`) morreu na demolição (T1225): não existe mais nenhum
// gatilho de perfil no titlebar. A tela de contas (`AccountsPanel`, T1221)
// ocupa o lugar dela, com UMA unidade de cota (C25, achado A3 fechado). Este
// smoke prova o negativo (dropdown de perfis não existe) e o positivo
// (AccountsPanel está lá, funcional) no mesmo lugar da tela.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('accounts-panel-substitui-perfis');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
});

test('T1227 — não existe mais dropdown de perfis; a tela de contas está no lugar dele', async () => {
  // Negativo: nenhum elemento do ProfileSwitcher morto sobrevive no DOM.
  await expect(appWindow.locator('[data-testid="profile-switcher-trigger"]')).toHaveCount(0);
  await expect(appWindow.locator('text=Tecnologia Claude')).toHaveCount(0);

  // Positivo: AccountsPanel ocupa o titlebar — nasce inerte (accounts.mod = null,
  // C2), sem provedor conectado nesta árvore de teste isolada.
  const trigger = appWindow.locator('[data-testid="accounts-panel-trigger"]');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText('Contas');

  await trigger.click();
  const panel = appWindow.locator('[data-testid="accounts-panel"]');
  await expect(panel).toBeVisible();
  await expect(appWindow.locator('[data-testid="accounts-connect-form"]')).toBeVisible();
  await appWindow.keyboard.press('Escape');
});

test('T1227 — window.donel.profiles não existe mais (ponte do preload removida)', async () => {
  const hasProfilesBridge = await appWindow.evaluate(() => 'profiles' in window.donel);
  expect(hasProfilesBridge).toBe(false);
});
