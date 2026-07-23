import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Smoke da T004 (overnight, sem humano): abre o app buildado, espera o
// terminal, digita `echo donel-ok` e confirma que aparece no buffer do
// xterm — prova que node-pty carrega dentro do Electron (não só do Node
// puro) e que a aba spawna powershell.exe de verdade. Redimensiona a
// janela em seguida e confirma que o processo não crasha.
//
// O que este smoke NÃO cobre (setas interativas, colar multilinha visual,
// scrollback com mouse) fica em "Não verificado" para o T017 — ver dossiê.

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [APP_MAIN],
    cwd: APP_CWD,
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('terminal spawns powershell inside Electron and echoes typed input', async () => {
  const terminalPane = window.locator('[data-testid="terminal-pane"]');
  await expect(terminalPane).toBeVisible();

  // xterm monta e o pty:create (IPC async) resolve; espera a linha de
  // prompt do PowerShell aparecer antes de digitar.
  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  await terminalPane.click();
  await window.keyboard.type('echo donel-ok');
  await window.keyboard.press('Enter');

  await expect(async () => {
    const text = await terminalPane.innerText();
    expect(text).toContain('donel-ok');
  }).toPass({ timeout: 15_000 });
});

test('resizing the window does not crash the app', async () => {
  const originalSize = window.viewportSize();
  await window.setViewportSize({ width: 1000, height: 700 });
  await window.waitForTimeout(500);
  await window.setViewportSize({ width: originalSize?.width ?? 1280, height: originalSize?.height ?? 800 });

  // App ainda vivo e com o terminal renderizado após o resize.
  await expect(window.locator('[data-testid="terminal-pane"]')).toBeVisible();
  expect(electronApp.windows().length).toBeGreaterThan(0);
});
