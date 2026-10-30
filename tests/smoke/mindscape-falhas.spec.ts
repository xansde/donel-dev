import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir, removeTempDir } from './userDataIsolation';

// Mindscape — a failed read or write of mindscape.json never loses the board
// (handoffs/mindscape-revisao.md, items 2 and 3). The failures are provoked
// through DONEL_MINDSCAPE_FILE: a broken file (load fails) and a path whose
// parent is a file, not a folder (every write fails, the load sees no file).
// Project `atlas` in a temp root (never the real project name).

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');
const LOAD_FAILED = 'Não consegui abrir o quadro — nada será gravado até reabrir.';
const SAVE_FAILED = 'Não consegui gravar o quadro — as mudanças seguem só na memória.';
/** Debounce (500 ms) + the three retries (1 + 3 + 8 s) of a failed save, with room. */
const SAVE_GIVES_UP_MS = 30_000;

let root: string;
let filesDir: string;
let userDataDir: string;
let launched: LaunchedApp | undefined;

function env(mindscapeFile: string): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: mindscapeFile };
}

function boardNames(mindscapeFile: string): string[] {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, unknown> };
    return Object.keys(doc.boards ?? {}).map((key) => path.basename(key));
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

function alertOf(window: Page): Locator {
  return screen(window).getByTestId('mindscape-alert');
}

test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-falhas-smoke-root-'));
  mkdirSync(path.join(root, 'atlas'));
  writeFileSync(path.join(root, 'atlas', 'CLAUDE.md'), '# atlas\n', 'utf8');
  filesDir = mkdtempSync(path.join(tmpdir(), 'mindscape-falhas-smoke-files-'));
  userDataDir = createIsolatedUserDataDir('mindscape-falhas');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterEach(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  launched = undefined;
  removeIsolatedUserDataDir(userDataDir);
  removeTempDir(root);
  removeTempDir(filesDir);
});

test('Mindscape: quadro que não abre fica só leitura, não sobrescreve o arquivo e lê de novo @mindscape', async () => {
  test.setTimeout(180_000);
  const mindscapeFile = path.join(filesDir, 'mindscape.json');
  const broken = '{"schemaVersion": 2, "boards": {"C:/x/atlas": {"cards": ';
  writeFileSync(mindscapeFile, broken, 'utf8');
  launched = await launchIsolatedApp({ userDataDir, env: env(mindscapeFile) });
  const { window } = launched;

  // A live session would place a post-it (and save) on a loaded board.
  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  await expect(alertOf(window)).toHaveText(new RegExp(`^${LOAD_FAILED}`));
  await expect(alertOf(window)).toHaveAttribute('data-kind', 'load-failed');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(0);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-falha-ao-abrir.png') });
  // Well past the save debounce: the broken file is still exactly as it was.
  await window.waitForTimeout(2_000);
  expect(readFileSync(mindscapeFile, 'utf8')).toBe(broken);

  // The owner fixes the file → "Tentar de novo" loads it, and the board works again.
  writeFileSync(mindscapeFile, JSON.stringify({ schemaVersion: 2, boards: {} }), 'utf8');
  await alertOf(window).getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(alertOf(window)).toHaveCount(0);
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1);
  await expect.poll(() => boardNames(mindscapeFile), { timeout: 10_000 }).toEqual(['atlas']);
});

test('Mindscape: gravação que falha é retentada, avisada na tela e não perde a última versão @mindscape', async () => {
  test.setTimeout(180_000);
  // The parent of the file is a FILE: the load sees no board file, every write fails.
  const blocker = path.join(filesDir, 'bloqueio');
  writeFileSync(blocker, 'não é pasta', 'utf8');
  const mindscapeFile = path.join(blocker, 'mindscape.json');
  launched = await launchIsolatedApp({ userDataDir, env: env(mindscapeFile) });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  // The board keeps working while the save retries; the warning comes after it gives up.
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1);
  await expect(alertOf(window)).toHaveText(new RegExp(`^${SAVE_FAILED}`), { timeout: SAVE_GIVES_UP_MS });
  await expect(alertOf(window)).toHaveAttribute('data-kind', 'save-failed');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-falha-ao-gravar.png') });

  // The folder becomes writable → "Tentar de novo" writes the version kept in memory.
  rmSync(blocker);
  mkdirSync(blocker);
  await alertOf(window).getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(alertOf(window)).toHaveCount(0);
  await expect.poll(() => boardNames(mindscapeFile), { timeout: 10_000 }).toEqual(['atlas']);
});

test('Mindscape: ao fechar o app, a versão que não conseguiu gravar vai para o arquivo @mindscape', async () => {
  test.setTimeout(180_000);
  const blocker = path.join(filesDir, 'bloqueio');
  writeFileSync(blocker, 'não é pasta', 'utf8');
  const mindscapeFile = path.join(blocker, 'mindscape.json');
  launched = await launchIsolatedApp({ userDataDir, env: env(mindscapeFile) });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  await expect(alertOf(window)).toHaveAttribute('data-kind', 'save-failed', { timeout: SAVE_GIVES_UP_MS });

  // Without touching "Tentar de novo": closing the app writes the pending version.
  rmSync(blocker);
  mkdirSync(blocker);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  expect(boardNames(mindscapeFile)).toEqual(['atlas']);
});
