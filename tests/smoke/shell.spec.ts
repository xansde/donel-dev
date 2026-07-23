import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Smoke do feedback E2E rodada 2 ("app inteiro tem scrollbar vertical" —
// item 7 do roteiro batch 2): prova que o documento (body) nunca tem
// overflow, mesmo com o shell inteiro carregado (sidebar + tabs + terminal +
// painel direito). `scrollHeight` só bate com `clientHeight` quando não há
// NADA pra rolar no nível do documento — scroll continua existindo, mas
// sempre interno aos painéis (sidebar/terminal), nunca na janela.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('shell');
  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
});

test('o shell inteiro não tem scrollbar no documento (body.scrollHeight === body.clientHeight)', async () => {
  const shell = window.locator('[data-testid="terminal-pane"]');
  await expect(shell).toBeVisible();

  const dimensions = await window.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    clientHeight: document.body.clientHeight,
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));

  expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test('redimensionar a janela continua sem criar scrollbar no documento', async () => {
  const originalSize = window.viewportSize();
  await window.setViewportSize({ width: 1000, height: 650 });
  await window.waitForTimeout(300);

  const dimensions = await window.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    clientHeight: document.body.clientHeight,
  }));
  expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);

  await window.setViewportSize({ width: originalSize?.width ?? 1280, height: originalSize?.height ?? 800 });
});
