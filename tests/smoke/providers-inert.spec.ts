import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// T1322 (011-contas-e-provedores, etapa 3, D6/C14) — registry VAZIO: o
// launcher renderiza SEM o campo "Provedor" e uma sessão claude nasce com o
// mesmo env/config dir de hoje (`pty:create` sem `providerId` nunca devolve
// `provider` no resultado). `userData` isolado (temp), nunca toca o
// `%APPDATA%` real.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('providers-inert');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
});

test('T1322 — providers:list devolve [] num app novo (registry inerte por default)', async () => {
  const list = await appWindow.evaluate(() => window.donel.providers.list());
  expect(list).toEqual([]);
});

test('T1322 — Launcher não mostra o campo "Provedor" com registry vazio', async () => {
  const trigger = appWindow.locator('button', { hasText: '＋ Nova sessão' }).first();
  if (await trigger.count()) await trigger.click();
  await expect(appWindow.locator('[data-testid="provider-picker"]')).toHaveCount(0);
});

test('T1322 — pty:create sem providerId nunca devolve `provider` no resultado (comportamento de hoje)', async () => {
  test.setTimeout(60_000);
  const result = await appWindow.evaluate(() => window.donel.pty.create({ cols: 80, rows: 24, sessionType: 'claude' }));
  expect(result.provider).toBeUndefined();
  await appWindow.evaluate((ptyId) => window.donel.pty.kill(ptyId), result.ptyId);
});
