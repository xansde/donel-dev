import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir, removeTempDir } from './userDataIsolation';

// Mindscape V1, fatia 01 — the third mode of the shell: one board per project,
// one post-it per live `claude` session, following the semaphore live; the
// boards survive a restart (mindscape.json, isolated by DONEL_MINDSCAPE_FILE).
// Projects are `atlas` and `beacon` in a temp root (never the real project name).

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');

let root: string;
let userDataDir: string;
let mindscapeFile: string;
let launched: LaunchedApp | undefined;

function env(): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: mindscapeFile };
}

function boardNames(): string[] {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, unknown> };
    return Object.keys(doc.boards ?? {})
      .map((key) => path.basename(key))
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

function mindscapeTab(window: Page, name: string): Locator {
  return screen(window).getByRole('tab', { name: new RegExp(`${name}$`) });
}

/** The state label the terminal tab shows for a session (its `role="img"` icon). */
async function terminalTabState(window: Page, name: string): Promise<string | null> {
  return window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: name }).first().getByRole('img').getAttribute('aria-label');
}

test.beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-smoke-root-'));
  for (const name of ['atlas', 'beacon']) {
    mkdirSync(path.join(root, name));
    writeFileSync(path.join(root, name, 'CLAUDE.md'), `# ${name}\n`, 'utf8');
  }
  mindscapeFile = path.join(root, 'mindscape.json');
  userDataDir = createIsolatedUserDataDir('mindscape');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  removeIsolatedUserDataDir(userDataDir);
  removeTempDir(root);
});

test('Mindscape: post-its de sessão vivos por projeto, que sobrevivem ao relançar o app @mindscape', async () => {
  test.setTimeout(180_000);
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await expect(window.locator('[role="tab"]', { hasText: 'atlas' })).toHaveCount(1);
  await openProjectClaudeTab(window, 'beacon');
  await expect(window.locator('[role="tab"]', { hasText: 'beacon' })).toHaveAttribute('aria-selected', 'true');

  // The terminal of `beacon` (in front) — its first line must survive the mode round trip.
  const pane = window.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect(await pane.innerText()).toContain('shortcuts');
  }).toPass({ timeout: 30_000 });
  const paneText = await pane.innerText();

  // 1. Mindscape: one tab per project.
  await setMode(window, 'Mindscape');
  await expect(screen(window)).toBeVisible();
  await expect(mindscapeTab(window, 'atlas')).toBeVisible();
  await expect(mindscapeTab(window, 'beacon')).toBeVisible();

  // 2. `atlas`: only its session, with the tab name and the same state as the tab.
  await mindscapeTab(window, 'atlas').click();
  const cards = screen(window).getByTestId('mindscape-session-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByTestId('mindscape-session-name')).toHaveText('atlas');
  await expect(cards.first().getByText('Sessão', { exact: true })).toBeVisible();
  await expect(async () => {
    expect(await cards.first().getByTestId('mindscape-session-state').innerText()).toBe(await terminalTabState(window, 'atlas'));
  }).toPass({ timeout: 15_000 });

  // 3. Turns on `atlas` (sent from the Uso geral). A quick one first: the post-it goes to
  //    "Aguardando resposta" (the semaphore starts at working until the first Stop).
  const sendOnAtlas = async (prompt: string): Promise<void> => {
    await setMode(window, 'Uso geral');
    await window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'atlas' }).first().click();
    const atlasPane = window.locator('[data-testid="terminal-pane"]:visible');
    await expect(async () => {
      expect(await atlasPane.innerText()).toContain('shortcuts');
    }).toPass({ timeout: 30_000 });
    await atlasPane.click();
    await window.keyboard.type(prompt);
    await window.keyboard.press('Enter');
    await setMode(window, 'Mindscape');
    await mindscapeTab(window, 'atlas').click();
  };
  const atlasCard = screen(window).getByTestId('mindscape-session-card').first();
  await sendOnAtlas('oi');
  await expect(atlasCard).toHaveAttribute('data-state', 'waiting', { timeout: 20_000 });
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-atlas.png') });

  //    Then the slow one: working, and back to waiting without reloading anything.
  await sendOnAtlas('pedido');
  await expect(atlasCard).toHaveAttribute('data-state', 'working', { timeout: 10_000 });
  await expect(atlasCard).toHaveAttribute('data-state', 'waiting', { timeout: 20_000 });
  expect(await atlasCard.getByTestId('mindscape-session-state').innerText()).toBe(await terminalTabState(window, 'atlas'));

  // 4. `beacon` shows only the session of there.
  await mindscapeTab(window, 'beacon').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByTestId('mindscape-session-name')).toHaveText('beacon');

  // 5. Back to Uso geral and Dev: the terminal did not restart (same content still there).
  await setMode(window, 'Dev');
  await expect(screen(window)).toHaveCount(0);
  await setMode(window, 'Uso geral');
  await window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'beacon' }).first().click();
  const beaconPane = window.locator('[data-testid="terminal-pane"]:visible');
  expect(await beaconPane.innerText()).toContain(paneText.split('\n').find((line) => line.trim().length > 0) ?? '');
  await expect(window.locator('[role="tab"]:not([data-testid="mindscape-tab"])')).toHaveCount(2);

  // 6. The two boards are on disk; after a relaunch with the same file they come back.
  await expect.poll(boardNames, { timeout: 10_000 }).toEqual(['atlas', 'beacon']);
  await closeIsolatedApp(launched, false);
  launched = undefined;

  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  await expect(mindscapeTab(launched.window, 'atlas')).toBeVisible();
  await expect(mindscapeTab(launched.window, 'beacon')).toBeVisible();
  await launched.window.waitForTimeout(1_000);
  expect(boardNames()).toEqual(['atlas', 'beacon']);
});
