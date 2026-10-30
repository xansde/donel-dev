import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Mindscape V1, fatia 04 — free canvas: drag any post-it, drag the background
// to move the view, and the owner's own post-its ("✎ você") with editable
// text, Sem cor/Azul/Dourado and "Arquivar". Everything survives a relaunch.
// Project `atlas` in a temp root.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');

let root: string;
let userDataDir: string;
let mindscapeFile: string;
let launched: LaunchedApp | undefined;

interface SavedCard {
  kind: string;
  x: number;
  y: number;
  text?: string;
  color?: string;
}

interface SavedBoard {
  pan: { x: number; y: number };
  cards: Record<string, SavedCard>;
}

function env(): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: mindscapeFile };
}

function savedAtlas(): SavedBoard | undefined {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, SavedBoard> };
    return Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === 'atlas')?.[1];
  } catch {
    return undefined;
  }
}

function savedCard(kind: string): SavedCard | undefined {
  return Object.values(savedAtlas()?.cards ?? {}).find((card) => card.kind === kind);
}

async function setMode(window: Page, label: 'Uso geral' | 'Dev' | 'Mindscape'): Promise<void> {
  await window.getByRole('radiogroup', { name: 'Modo' }).getByRole('radio', { name: label, exact: true }).click();
}

function screen(window: Page): Locator {
  return window.getByTestId('mindscape-screen');
}

/** `left`/`top` of a card in the plane (board coordinates, without the pan). */
async function planePosition(card: Locator): Promise<{ x: number; y: number }> {
  const [left, top] = await card.evaluate((el) => [(el as HTMLElement).style.left, (el as HTMLElement).style.top]);
  return { x: Number.parseFloat(left ?? ''), y: Number.parseFloat(top ?? '') };
}

async function screenPosition(card: Locator): Promise<{ x: number; y: number }> {
  const box = await card.boundingBox();
  if (!box) throw new Error('card not visible');
  return { x: box.x, y: box.y };
}

async function drag(window: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await window.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await window.mouse.up();
}

/** Drags a card by a point inside it that is not a button or a text field. */
async function dragCard(window: Page, grip: Locator, dx: number, dy: number): Promise<void> {
  const box = await grip.boundingBox();
  if (!box) throw new Error('grip not visible');
  await drag(window, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

test.beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-canvas-smoke-root-'));
  mkdirSync(path.join(root, 'atlas'));
  writeFileSync(path.join(root, 'atlas', 'CLAUDE.md'), '# atlas\n', 'utf8');
  mindscapeFile = path.join(root, 'mindscape.json');
  userDataDir = createIsolatedUserDataDir('mindscape-canvas');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  removeIsolatedUserDataDir(userDataDir);
  rmSync(root, { recursive: true, force: true });
});

test('Mindscape: canvas livre — arrastar, mover a visão e post-its do dono, que persistem @mindscape', async () => {
  test.setTimeout(240_000);
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  const sessionCard = screen(window).getByTestId('mindscape-session-card');
  await expect(sessionCard).toHaveCount(1, { timeout: 30_000 });

  // 1. "Novo post-it" → type → Dourado: "✎ você" and the golden stripe.
  await screen(window).getByRole('button', { name: 'Novo post-it' }).click();
  const owner = screen(window).getByTestId('mindscape-owner-card');
  await expect(owner).toHaveCount(1);
  const field = owner.getByRole('textbox', { name: 'Texto do post-it' });
  await expect(field).toBeFocused();
  await window.keyboard.type('Lembrar do deploy de quinta');
  await owner.getByRole('button', { name: 'Dourado' }).click();
  await expect(owner).toHaveAttribute('data-color', 'donel-accent');
  await expect(owner.getByRole('button', { name: 'Dourado' })).toHaveAttribute('aria-pressed', 'true');
  // Clicking the empty board ends the edit (the field loses the focus and saves).
  const boardForEdit = await screen(window).getByTestId('mindscape-board').boundingBox();
  if (!boardForEdit) throw new Error('board not visible');
  await window.mouse.click(boardForEdit.x + boardForEdit.width - 40, boardForEdit.y + boardForEdit.height - 40);
  await expect(owner.getByTestId('mindscape-owner-text')).toHaveText('Lembrar do deploy de quinta');
  await expect(owner).toContainText('✎ você');

  // 2. Drag the owner post-it and the session post-it to another spot.
  const ownerBefore = await planePosition(owner);
  await dragCard(window, owner.getByText('✎ você'), 260, 180);
  await expect.poll(() => planePosition(owner)).toEqual({ x: ownerBefore.x + 260, y: ownerBefore.y + 180 });
  const sessionBefore = await planePosition(sessionCard);
  await dragCard(window, sessionCard.getByTestId('mindscape-session-state'), 120, 300);
  await expect.poll(() => planePosition(sessionCard)).toEqual({ x: sessionBefore.x + 120, y: sessionBefore.y + 300 });
  // A drag is not a click: the session was not opened in the terminal.
  await expect(screen(window)).toBeVisible();

  // 3. H + drag the background: every card moves together on screen, the plane positions stay.
  //    (Desenho, fatia 03: with V the background draws the lasso; the view moves with H or space.)
  const board = screen(window).getByTestId('mindscape-board');
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error('board not visible');
  const ownerScreen = await screenPosition(owner);
  const sessionScreen = await screenPosition(sessionCard);
  await window.keyboard.press('h');
  await expect(board).toHaveAttribute('data-tool', 'hand');
  await drag(window, { x: boardBox.x + boardBox.width - 40, y: boardBox.y + boardBox.height - 40 }, -150, -90);
  await window.keyboard.press('v');
  await expect(board).toHaveAttribute('data-pan', '-150,-90');
  for (const [card, before] of [
    [owner, ownerScreen],
    [sessionCard, sessionScreen],
  ] as const) {
    const after = await screenPosition(card);
    expect(after.x).toBeCloseTo(before.x - 150, 0);
    expect(after.y).toBeCloseTo(before.y - 90, 0);
  }
  const ownerPlane = await planePosition(owner);
  const sessionPlane = await planePosition(sessionCard);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-canvas.png') });

  // 4. Relaunch: positions, pan, text and color are the same.
  await expect.poll(() => savedAtlas()?.pan, { timeout: 10_000 }).toEqual({ x: -150, y: -90 });
  await expect.poll(() => savedCard('owner'), { timeout: 10_000 }).toMatchObject({ ...ownerPlane, text: 'Lembrar do deploy de quinta', color: 'donel-accent' });
  await expect.poll(() => savedCard('session'), { timeout: 10_000 }).toMatchObject(sessionPlane);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const relaunched = launched.window;
  await setMode(relaunched, 'Mindscape');
  const ownerAfter = screen(relaunched).getByTestId('mindscape-owner-card');
  await expect(ownerAfter).toHaveCount(1);
  await expect(screen(relaunched).getByTestId('mindscape-board')).toHaveAttribute('data-pan', '-150,-90');
  expect(await planePosition(ownerAfter)).toEqual(ownerPlane);
  await expect(ownerAfter.getByTestId('mindscape-owner-text')).toHaveText('Lembrar do deploy de quinta');
  await expect(ownerAfter).toHaveAttribute('data-color', 'donel-accent');
  expect(savedCard('session')).toMatchObject(sessionPlane);

  // 5. "Arquivar" the owner post-it → gone, and it does not come back on relaunch.
  await ownerAfter.getByRole('button', { name: 'Arquivar' }).click();
  await expect(ownerAfter).toHaveCount(0);
  await expect.poll(() => savedCard('owner'), { timeout: 10_000 }).toBeUndefined();
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  await expect(screen(launched.window).getByTestId('mindscape-board')).toHaveAttribute('data-pan', '-150,-90');
  await expect(screen(launched.window).getByTestId('mindscape-owner-card')).toHaveCount(0);
});
