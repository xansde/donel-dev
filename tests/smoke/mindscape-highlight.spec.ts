import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { launchClaudeTab, openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir, removeTempDir } from './userDataIsolation';

// Mindscape V1, fatia 02 — the session post-it is highlighted when it has news
// since the owner's last visit, dimmed when it has none; double click or
// "Ir ao terminal" goes to the tab of the session in the Uso geral.
// Two `claude` tabs of the fake in the project `atlas` (temp root).

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');

let root: string;
let userDataDir: string;
let launched: LaunchedApp | undefined;

async function setMode(window: Page, label: 'Uso geral' | 'Dev' | 'Mindscape'): Promise<void> {
  await window.getByRole('radiogroup', { name: 'Modo' }).getByRole('radio', { name: label, exact: true }).click();
}

function terminalTab(window: Page, index: number): Locator {
  return window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'atlas' }).nth(index);
}

async function sendOnVisible(window: Page, prompt: string): Promise<void> {
  const pane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect(await pane.innerText()).toContain('shortcuts');
  }).toPass({ timeout: 30_000 });
  await pane.click();
  await window.keyboard.type(prompt);
  await window.keyboard.press('Enter');
}

test.beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-highlight-root-'));
  mkdirSync(path.join(root, 'atlas'));
  writeFileSync(path.join(root, 'atlas', 'CLAUDE.md'), '# atlas\n', 'utf8');
  userDataDir = createIsolatedUserDataDir('mindscape-highlight');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  removeIsolatedUserDataDir(userDataDir);
  removeTempDir(root);
});

test('Mindscape: destaque da sessão com novidade e "Ir ao terminal" @mindscape', async () => {
  test.setTimeout(180_000);
  launched = await launchIsolatedApp({
    userDataDir,
    env: { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: path.join(root, 'mindscape.json') },
  });
  const { window } = launched;

  // Session A: one quick turn, so it is "Aguardando resposta" (no longer working).
  await openProjectClaudeTab(window, 'atlas');
  await sendOnVisible(window, 'oi');
  // Session B: a second tab in the same project, by the Launcher.
  await launchClaudeTab(window, { project: null, name: 'atlas-b' });
  await expect(window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'atlas' })).toHaveCount(2);
  await expect(terminalTab(window, 1)).toHaveAttribute('aria-selected', 'true');
  // B gets a slow turn and the owner moves to A before it ends.
  await sendOnVisible(window, 'pedido');
  await terminalTab(window, 0).click();
  await expect(terminalTab(window, 0)).toHaveAttribute('aria-selected', 'true');

  const screen = window.getByTestId('mindscape-screen');
  const cards = screen.getByTestId('mindscape-session-card');
  const cardA = cards.filter({ has: window.getByTestId('mindscape-session-name').getByText('atlas', { exact: true }) });
  const cardB = cards.filter({ has: window.getByTestId('mindscape-session-name').getByText('atlas-b', { exact: true }) });

  // B ends its turn with A in focus → B highlighted; A (seen when the owner left the Uso geral) dimmed.
  await expect(terminalTab(window, 1).getByRole('img')).toHaveAttribute('aria-label', 'Aguardando resposta', { timeout: 20_000 });
  await setMode(window, 'Mindscape');
  await expect(cards).toHaveCount(2);
  await expect(cardB).toHaveAttribute('data-state', 'waiting');
  await expect(cardB).toHaveAttribute('data-highlight', 'highlighted');
  await expect(cardA).toHaveAttribute('data-highlight', 'dimmed');
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-highlight.png') });

  // Double click on B → Uso geral with tab B in focus.
  await cardB.dblclick();
  await expect(screen).toHaveCount(0);
  await expect(window.getByRole('radiogroup', { name: 'Modo' }).getByRole('radio', { name: 'Uso geral', exact: true })).toBeChecked();
  await expect(terminalTab(window, 1)).toHaveAttribute('aria-selected', 'true');

  // Back to the Mindscape → B dimmed (no news since this visit).
  await setMode(window, 'Mindscape');
  await expect(cardB).toHaveAttribute('data-highlight', 'dimmed');

  // Select A and "Ir ao terminal" → tab A in focus.
  const goToTerminal = screen.getByRole('button', { name: 'Ir ao terminal' });
  await expect(goToTerminal).toBeDisabled();
  await cardA.click();
  await expect(cardA).toHaveAttribute('data-selected', 'true');
  await goToTerminal.click();
  await expect(screen).toHaveCount(0);
  await expect(terminalTab(window, 0)).toHaveAttribute('aria-selected', 'true');
});
