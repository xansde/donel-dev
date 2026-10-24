import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { APP_MAIN, PROJECT_NAME, REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// 014-chat, T041 — smoke da fundação do chat (Fase 1), contra o `claude` FALSO
// roteirizado (T040): nunca o CLI real, nenhum turno de API.
//
// Prova, de ponta a ponta no app buildado:
//  1. o semáforo da aba muda pela PONTE HTTP de hooks (trabalhando -> aguardando)
//     quando um prompt é enviado — o falso só fala com o app via hooks `http`;
//  2. depois de `/clear` na vista do terminal, o semáforo, o nome e a cor da aba
//     seguem a conversa nova (id novo): `session:switched` migra o que é da aba.
//
// Seams: `DONEL_CLAUDE_EXECUTABLE_FIXTURE` (qual `claude` abre) e
// `DONEL_FAKE_CLAUDE_*` (roteiro, raiz de transcripts isolada do `~/.claude`).

const FAKE_CLAUDE_CMD = path.join(__dirname, 'fixtures/fake-claude-chat/claude.cmd');

// Turno lento (>= 2 s trabalhando) para a asserção "trabalhando" não correr
// contra o polling do Playwright; o `default` serve ao turno pós-/clear.
const SCENARIO = {
  default: {
    steps: [
      { type: 'wait', ms: 2500 },
      { type: 'assistant', text: 'OK' },
      { type: 'hook', event: 'Stop' },
    ],
  },
};

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let fakeHome: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('chat-foundation');
  fakeHome = mkdtempSync(path.join(tmpdir(), 'donel-fake-claude-home-'));
  electronApp = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DONEL_CLAUDE_EXECUTABLE_FIXTURE: FAKE_CLAUDE_CMD,
      DONEL_FAKE_CLAUDE_SCENARIO: JSON.stringify(SCENARIO),
      DONEL_FAKE_CLAUDE_HOME: fakeHome,
    },
  });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    await electronApp.close();
  } finally {
    removeIsolatedUserDataDir(userDataDir);
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

/** The semaphore icon inside a tab: `role="img"` with the state label. */
const stateIcon = (tab: Locator): Locator => tab.getByRole('img');

async function typeInTerminal(text: string): Promise<void> {
  const pane = appWindow.locator('[data-testid="terminal-pane"]:visible');
  await pane.click();
  await appWindow.keyboard.type(text);
  await appWindow.keyboard.press('Enter');
}

test('T041 — semáforo pela ponte HTTP; /clear mantém semáforo, nome e cor da aba @chat', async () => {
  test.setTimeout(120_000);

  // Opens a claude tab through the project switcher (same path as the other smokes).
  await appWindow.getByRole('button', { name: 'Trocar de projeto' }).click();
  const popover = appWindow.getByRole('dialog', { name: 'Projetos' });
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: PROJECT_NAME, exact: true }).click();
  await expect(popover).toBeHidden();

  const tab = appWindow.locator('[role="tab"]').first();
  await expect(tab).toBeVisible();
  const pane = appWindow.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    const text = await pane.innerText();
    expect(text).toContain('shortcuts'); // fake claude drew its footer
  }).toPass({ timeout: 30_000 });

  // 1. Semaphore through the HTTP bridge: prompt -> working -> waiting.
  await typeInTerminal('primeiro pedido');
  await expect(stateIcon(tab)).toHaveAttribute('aria-label', 'Trabalhando', { timeout: 10_000 });
  await expect(stateIcon(tab)).toHaveAttribute('aria-label', 'Aguardando resposta', { timeout: 15_000 });

  // 2. Give the tab a name and a color before /clear.
  const uiName = `chat-${Date.now().toString(36)}`;
  await tab.getByText(PROJECT_NAME, { exact: true }).dblclick();
  const input = tab.getByRole('textbox');
  await expect(input).toBeVisible();
  await input.fill(uiName);
  await input.press('Enter');
  await expect(tab).toHaveAttribute('title', new RegExp(`^${uiName} —`));

  await tab.click({ button: 'right' });
  await appWindow.getByRole('menuitemradio', { name: 'Dourado' }).click();

  const before = await appWindow.evaluate(() => window.donel.config.get());
  const idsBefore = Object.keys(before.sessionNames);
  expect(idsBefore).toHaveLength(1);
  const oldSessionId = idsBefore[0];

  // 3. /clear in the terminal view: the fake emits SessionEnd(clear) + SessionStart(new id).
  await typeInTerminal('/clear');

  // The name is carried to the new conversation id (session:switched copies it;
  // the entry under the old id stays as history for that conversation).
  await expect(async () => {
    const cfg = await appWindow.evaluate(() => window.donel.config.get());
    const newIds = Object.keys(cfg.sessionNames).filter((id) => id !== oldSessionId);
    expect(newIds).toHaveLength(1);
    expect(cfg.sessionNames[newIds[0]].name).toBe(uiName);
  }).toPass({ timeout: 10_000 });

  // Name, color and semaphore are still the tab's after the switch.
  await expect(tab).toHaveAttribute('title', new RegExp(`^${uiName} —`));
  await tab.click({ button: 'right' });
  await expect(appWindow.getByRole('menuitemradio', { name: 'Dourado' })).toHaveAttribute('aria-checked', 'true');
  await appWindow.keyboard.press('Escape');
  await expect(stateIcon(tab)).toHaveAttribute('aria-label', 'Aguardando resposta');

  // 4. The semaphore still reacts, now with the new session id.
  await typeInTerminal('segundo pedido');
  await expect(stateIcon(tab)).toHaveAttribute('aria-label', 'Trabalhando', { timeout: 10_000 });
  await expect(stateIcon(tab)).toHaveAttribute('aria-label', 'Aguardando resposta', { timeout: 15_000 });

  // Close the tab (kills the PTY).
  await tab.getByRole('button', { name: new RegExp(`^Fechar aba ${uiName}`) }).click();
  const closeModal = appWindow.getByRole('dialog', { name: 'Fechar sessão?' });
  if (await closeModal.isVisible().catch(() => false)) {
    await closeModal.getByRole('button', { name: 'Fechar' }).click();
  }
  await expect(appWindow.locator('[role="tab"]')).toHaveCount(0);
});
