import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Mindscape V1, fatia 03 — the post-it written by the session at each end of
// turn: text from the `Stop` hook (`last_assistant_message`), or from the
// `.jsonl` tail when the field is missing; overwritten every turn; it stays
// when the tab closes, until "Arquivar". Project `vega` in a temp root.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/session-note.json');

let root: string;
let userDataDir: string;
let mindscapeFile: string;
let launched: LaunchedApp | undefined;

function env(): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: mindscapeFile };
}

/** Kinds of the cards saved for `vega` (sorted). */
function savedCardKinds(): string[] {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, { cards?: Record<string, { kind: string }> }> };
    const board = Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === 'vega')?.[1];
    return Object.values(board?.cards ?? {})
      .map((card) => card.kind)
      .sort();
  } catch {
    return [];
  }
}

async function setMode(window: Page, label: 'Uso geral' | 'Dev' | 'Mindscape'): Promise<void> {
  await window.getByRole('radiogroup', { name: 'Modo' }).getByRole('radio', { name: label, exact: true }).click();
}

function screen(window: Page): Locator {
  return window.getByTestId('mindscape-screen');
}

function terminalTab(window: Page): Locator {
  return window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'vega' }).first();
}

async function sendOnVega(window: Page, prompt: string): Promise<void> {
  await setMode(window, 'Uso geral');
  await terminalTab(window).click();
  const pane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect(await pane.innerText()).toContain('shortcuts');
  }).toPass({ timeout: 30_000 });
  await pane.click();
  await window.keyboard.type(prompt);
  await window.keyboard.press('Enter');
  await expect(terminalTab(window).getByRole('img')).toHaveAttribute('aria-label', 'Aguardando resposta', { timeout: 20_000 });
  await setMode(window, 'Mindscape');
}

test.beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-note-smoke-root-'));
  mkdirSync(path.join(root, 'vega'));
  writeFileSync(path.join(root, 'vega', 'CLAUDE.md'), '# vega\n', 'utf8');
  mindscapeFile = path.join(root, 'mindscape.json');
  userDataDir = createIsolatedUserDataDir('mindscape-note');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  removeIsolatedUserDataDir(userDataDir);
  rmSync(root, { recursive: true, force: true });
});

test('Mindscape: post-it escrito pela sessão a cada fim de turno, que fica até arquivar @mindscape', async () => {
  test.setTimeout(180_000);
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'vega');
  await expect(terminalTab(window)).toHaveAttribute('aria-selected', 'true');

  const notes = screen(window).getByTestId('mindscape-note-card');
  const noteText = notes.first().getByTestId('mindscape-note-text');

  // 1. First turn: the text of the Stop hook and the hour.
  await sendOnVega(window, 'primeiro');
  await expect(notes).toHaveCount(1, { timeout: 10_000 });
  await expect(noteText).toHaveText('Primeira resposta (hook).');
  await expect(notes.first().getByTestId('mindscape-note-time')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(notes.first()).toContainText('escrito pela sessão');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1);

  // 2. Second turn overwrites the same post-it.
  await sendOnVega(window, 'segundo');
  await expect(noteText).toHaveText('Segunda resposta (hook).', { timeout: 10_000 });
  await expect(notes).toHaveCount(1);

  // 3. Stop without the field → the text comes from the `.jsonl` tail.
  await sendOnVega(window, 'cauda');
  await expect(noteText).toHaveText('Resposta só na cauda.', { timeout: 10_000 });
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-session-note.png') });

  // 4. Close the tab: the session post-it goes away, the one written by it stays.
  await setMode(window, 'Uso geral');
  await terminalTab(window).getByRole('button', { name: /^Fechar aba/ }).click();
  const closeModal = window.getByRole('dialog', { name: 'Fechar sessão?' });
  if (await closeModal.isVisible().catch(() => false)) await closeModal.getByRole('button', { name: 'Fechar' }).click();
  await expect(window.locator('[role="tab"]:not([data-testid="mindscape-tab"])')).toHaveCount(0);
  await setMode(window, 'Mindscape');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(0);
  await expect(notes).toHaveCount(1);
  await expect(noteText).toHaveText('Resposta só na cauda.');

  // 5. Relaunch with the same file → the post-it is still there, as left.
  await expect.poll(savedCardKinds, { timeout: 10_000 }).toEqual(['session', 'session-note']);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const relaunched = launched.window;
  await setMode(relaunched, 'Mindscape');
  const notesAfter = screen(relaunched).getByTestId('mindscape-note-card');
  await expect(notesAfter).toHaveCount(1);
  await expect(notesAfter.first().getByTestId('mindscape-note-text')).toHaveText('Resposta só na cauda.');
  await expect(notesAfter.first()).toContainText('vega');

  // 6. "Arquivar" → it goes away, and the file no longer has it.
  await notesAfter.first().getByRole('button', { name: 'Arquivar' }).click();
  await expect(notesAfter).toHaveCount(0);
  await expect.poll(savedCardKinds, { timeout: 10_000 }).toEqual(['session']);
});
