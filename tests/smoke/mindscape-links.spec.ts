import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir, removeTempDir } from './userDataIsolation';

// Mindscape V1, fatia 05 — links with an arrow, in a hand-made stroke: drawn
// with A from a post-it to another (mindscape-desenho, fatia 01: the "Ligar"
// mode is gone — this step used to click it), arrow on/off and "Remover ligação" on the
// selected link; the link follows a moved card; a link to a session without
// an open tab stays saved and is not drawn. Project `atlas` in a temp root.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');

let root: string;
let userDataDir: string;
let mindscapeFile: string;
let launched: LaunchedApp | undefined;

interface SavedLink {
  id: string;
  from: string;
  to: string;
  arrow: boolean;
}

function env(): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: mindscapeFile };
}

function savedLinks(): SavedLink[] {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, { links?: SavedLink[] }> };
    return Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === 'atlas')?.[1].links ?? [];
  } catch {
    return [];
  }
}

function savedOwnerTexts(): string[] {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, { cards?: Record<string, { kind: string; text?: string }> }> };
    const board = Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === 'atlas')?.[1];
    return Object.values(board?.cards ?? {})
      .filter((card) => card.kind === 'owner')
      .map((card) => card.text ?? '')
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

async function drag(window: Page, grip: Locator, dx: number, dy: number): Promise<void> {
  const box = await grip.boundingBox();
  if (!box) throw new Error('grip not visible');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await window.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await window.mouse.up();
}

/** "Novo post-it" → type → click the empty corner of the board to save. */
async function newOwnerCard(window: Page, text: string): Promise<Locator> {
  await screen(window).getByRole('button', { name: 'Novo post-it' }).click();
  await window.keyboard.type(text);
  const board = await screen(window).getByTestId('mindscape-board').boundingBox();
  if (!board) throw new Error('board not visible');
  await window.mouse.click(board.x + board.width - 30, board.y + board.height - 30);
  const card = screen(window).getByTestId('mindscape-owner-card').filter({ hasText: text });
  await expect(card.getByTestId('mindscape-owner-text')).toHaveText(text);
  return card;
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A (arrow tool) → drag from the origin to the destination; the tool goes back to V. */
async function link(window: Page, from: Locator, to: Locator): Promise<void> {
  const start = await center(from);
  const end = await center(to);
  await window.keyboard.press('a');
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 6 });
  await window.mouse.move(end.x, end.y, { steps: 6 });
  await window.mouse.up();
  await expect(screen(window).getByTestId('mindscape-board')).toHaveAttribute('data-tool', 'select');
}

test.beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-links-smoke-root-'));
  mkdirSync(path.join(root, 'atlas'));
  writeFileSync(path.join(root, 'atlas', 'CLAUDE.md'), '# atlas\n', 'utf8');
  mindscapeFile = path.join(root, 'mindscape.json');
  userDataDir = createIsolatedUserDataDir('mindscape-links');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  removeIsolatedUserDataDir(userDataDir);
  removeTempDir(root);
});

test('Mindscape: ligações com seta em traço à mão — ligar, seta, acompanhar, esconder e remover @mindscape', async () => {
  test.setTimeout(240_000);
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  const sessionCard = screen(window).getByTestId('mindscape-session-card');
  await expect(sessionCard).toHaveCount(1, { timeout: 30_000 });

  // The owner post-it, moved away from the session so the link has room.
  const owner = await newOwnerCard(window, 'Ver o deploy');
  await drag(window, owner.getByText('✎ você'), 260, 220);

  // 1. A: owner → session → the link appears, with the arrow, in the rough stroke.
  await link(window, owner.getByText('✎ você'), sessionCard.getByTestId('mindscape-session-state'));
  const links = screen(window).getByTestId('mindscape-link');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('data-arrow', 'true');
  await expect(links.getByTestId('mindscape-link-head')).toHaveCount(1);
  const ownerId = await owner.getAttribute('data-card-id');
  const sessionId = await sessionCard.getAttribute('data-card-id');
  await expect(links).toHaveAttribute('data-from', ownerId ?? '');
  await expect(links).toHaveAttribute('data-to', sessionId ?? '');
  await expect.poll(() => savedLinks(), { timeout: 10_000 }).toEqual([expect.objectContaining({ from: ownerId, to: sessionId, arrow: true })]);
  // The session card was not selected by the click that ends the gesture.
  await expect(sessionCard).toHaveAttribute('data-selected', 'false');
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-links-seta.png') });

  // 2. Select the link → "Seta" off → the head goes away.
  await links.getByTestId('mindscape-link-hit').click({ force: true });
  await expect(links).toHaveAttribute('data-selected', 'true');
  // `exact`: the arrow tool of the bar is "Seta A".
  const arrowButton = screen(window).getByRole('button', { name: 'Seta', exact: true });
  await expect(arrowButton).toHaveAttribute('aria-pressed', 'true');
  await arrowButton.click();
  await expect(links).toHaveAttribute('data-arrow', 'false');
  await expect(links.getByTestId('mindscape-link-head')).toHaveCount(0);
  await expect.poll(() => savedLinks()[0]?.arrow, { timeout: 10_000 }).toBe(false);

  // 3. Move a card → the link follows (the line is redrawn), and the stroke is stable while nothing moves.
  const line = links.getByTestId('mindscape-link-line');
  const before = await line.getAttribute('d');
  await window.waitForTimeout(300);
  expect(await line.getAttribute('d')).toBe(before);
  await drag(window, owner.getByText('✎ você'), 180, 60);
  await expect.poll(() => line.getAttribute('d')).not.toBe(before);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-links.png') });

  // 4. A link between two owner post-its, then "Remover ligação" → gone.
  const second = await newOwnerCard(window, 'Segundo');
  await link(window, owner.getByText('✎ você'), second.getByText('✎ você'));
  await expect(links).toHaveCount(2);
  await expect.poll(() => savedLinks().length, { timeout: 10_000 }).toBe(2);
  const secondId = await second.getAttribute('data-card-id');
  const toSecond = screen(window).locator(`[data-testid="mindscape-link"][data-to="${secondId}"]`);
  await toSecond.getByTestId('mindscape-link-hit').click({ force: true });
  await screen(window).getByRole('button', { name: 'Remover ligação' }).click();
  await expect(links).toHaveCount(1);
  await expect.poll(() => savedLinks().map((saved) => saved.to), { timeout: 10_000 }).toEqual([sessionId]);

  // 5. Close the session tab → the link is not drawn, but stays saved.
  await setMode(window, 'Uso geral');
  const terminalTab = window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'atlas' }).first();
  await terminalTab.getByRole('button', { name: /^Fechar aba/ }).click();
  const closeModal = window.getByRole('dialog', { name: 'Fechar sessão?' });
  if (await closeModal.isVisible().catch(() => false)) await closeModal.getByRole('button', { name: 'Fechar' }).click();
  await expect(window.locator('[role="tab"]:not([data-testid="mindscape-tab"])')).toHaveCount(0);
  await setMode(window, 'Mindscape');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(0);
  await expect(links).toHaveCount(0);
  expect(savedLinks().map((saved) => saved.to)).toEqual([sessionId]);

  // 6. Relaunch: the removed link does not come back; the hidden one is still saved.
  await expect.poll(() => savedOwnerTexts(), { timeout: 10_000 }).toEqual(['Segundo', 'Ver o deploy']);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  await expect(screen(launched.window).getByTestId('mindscape-owner-card')).toHaveCount(2);
  await expect(screen(launched.window).getByTestId('mindscape-link')).toHaveCount(0);
  expect(savedLinks()).toEqual([expect.objectContaining({ from: ownerId, to: sessionId, arrow: false })]);
});
