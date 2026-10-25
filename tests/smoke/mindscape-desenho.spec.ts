import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp, type LaunchedApp } from './helpers/launch';
import { openProjectClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir } from './userDataIsolation';

// Mindscape desenho — the drawing tools of the board. One `test` per fatia.
// Fatia 01: the bar (V H A L R O), rect/ellipse/loose line and arrow with the
// chosen color and stroke, A/L from post-it to post-it make a link, "Ligar" is
// gone, Esc cancels, a key in the post-it text goes to the text, and everything
// comes back after a relaunch (mindscape.json v2). Project `atlas` in a temp root.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');

let root: string;
let userDataDir: string;
let mindscapeFile: string;
let launched: LaunchedApp | undefined;

interface SavedDrawing {
  kind: string;
  id: string;
  color: string;
  stroke: string;
  arrow?: boolean;
  w?: number;
  h?: number;
}

interface SavedBoard {
  schemaVersion?: number;
  drawings: SavedDrawing[];
  links: { from: string; to: string; arrow: boolean }[];
}

function env(): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, DONEL_MINDSCAPE_FILE: mindscapeFile };
}

function saved(): SavedBoard {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { schemaVersion?: number; boards?: Record<string, Partial<SavedBoard>> };
    const board = Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === 'atlas')?.[1];
    return { schemaVersion: doc.schemaVersion, drawings: board?.drawings ?? [], links: board?.links ?? [] };
  } catch {
    return { drawings: [], links: [] };
  }
}

async function setMode(window: Page, label: 'Uso geral' | 'Dev' | 'Mindscape'): Promise<void> {
  await window.getByRole('radiogroup', { name: 'Modo' }).getByRole('radio', { name: label, exact: true }).click();
}

function screen(window: Page): Locator {
  return window.getByTestId('mindscape-screen');
}

function toolButton(window: Page, name: string): Locator {
  return screen(window).getByRole('group', { name: 'Ferramentas' }).getByRole('button', { name: new RegExp(`^${name}\\b`) });
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragScreen(window: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await window.mouse.move(to.x, to.y, { steps: 6 });
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

test.beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mindscape-desenho-smoke-root-'));
  mkdirSync(path.join(root, 'atlas'));
  writeFileSync(path.join(root, 'atlas', 'CLAUDE.md'), '# atlas\n', 'utf8');
  mindscapeFile = path.join(root, 'mindscape.json');
  userDataDir = createIsolatedUserDataDir('mindscape-desenho');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ projectRoots: [root] }), 'utf8');
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (launched) await closeIsolatedApp(launched, false);
  removeIsolatedUserDataDir(userDataDir);
  rmSync(root, { recursive: true, force: true });
});

test('Mindscape desenho 01: barra de ferramentas, formas, setas soltas e seta de post-it a post-it vira Ligação @mindscape', async () => {
  test.setTimeout(240_000);
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  const sessionCard = screen(window).getByTestId('mindscape-session-card');
  await expect(sessionCard).toHaveCount(1, { timeout: 30_000 });
  const owner = await newOwnerCard(window, 'Ver o deploy');
  // Away from the session card, to the right: the left half of the board stays free to draw.
  const grip = await center(owner.getByText('✎ você'));
  await dragScreen(window, grip, { x: grip.x + 260, y: grip.y + 220 });

  const boardBox = await screen(window).getByTestId('mindscape-board').boundingBox();
  if (!boardBox) throw new Error('board not visible');
  expect(boardBox.height).toBeGreaterThan(450);
  const H = boardBox.height;
  // Board point (pan is 0 all along) → screen point.
  const at = (x: number, y: number) => ({ x: boardBox.x + x, y: boardBox.y + y });
  const drawings = screen(window).getByTestId('mindscape-drawing');
  const links = screen(window).getByTestId('mindscape-link');

  // "Ligar" is gone from the bar.
  await expect(screen(window).getByRole('button', { name: 'Ligar' })).toHaveCount(0);
  await expect(toolButton(window, 'Seleção')).toHaveAttribute('aria-pressed', 'true');

  // 1. R → the bar marks "Retângulo"; a drag on the background → the rect, and the tool goes back to V.
  await window.keyboard.press('r');
  await expect(toolButton(window, 'Retângulo')).toHaveAttribute('aria-pressed', 'true');
  await dragScreen(window, at(30, H - 240), at(150, H - 160));
  await expect(drawings).toHaveCount(1);
  await expect(drawings.first()).toHaveAttribute('data-kind', 'rect');
  await expect(toolButton(window, 'Seleção')).toHaveAttribute('aria-pressed', 'true');

  // 2. O, L (both ends off post-its) and A (from the owner's post-it to the background) → loose drawings.
  await window.keyboard.press('o');
  await dragScreen(window, at(180, H - 240), at(300, H - 160));
  await window.keyboard.press('l');
  await dragScreen(window, at(330, H - 240), at(480, H - 160));
  await window.keyboard.press('a');
  await dragScreen(window, await center(owner.getByText('✎ você')), at(330, H - 60));
  await expect(drawings).toHaveCount(4);
  await expect.poll(() => saved().drawings.map((drawing) => [drawing.kind, drawing.arrow ?? null]), { timeout: 10_000 }).toEqual([
    ['rect', null],
    ['ellipse', null],
    ['line', false],
    ['line', true],
  ]);
  await expect(links).toHaveCount(0);

  // 3. Dourado + Grosso before R → the new rect comes out with that color and stroke.
  await screen(window).getByRole('group', { name: 'Cor do desenho' }).getByRole('button', { name: 'Dourado' }).click();
  await screen(window).getByRole('group', { name: 'Espessura do desenho' }).getByRole('button', { name: 'Grosso' }).click();
  await window.keyboard.press('r');
  await dragScreen(window, at(30, H - 120), at(150, H - 40));
  await expect(drawings).toHaveCount(5);
  await expect(drawings.last()).toHaveAttribute('data-color', 'donel-accent');
  await expect(drawings.last()).toHaveAttribute('data-stroke', 'thick');
  await expect.poll(() => saved().drawings[4], { timeout: 10_000 }).toMatchObject({ kind: 'rect', color: 'donel-accent', stroke: 'thick' });
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-desenho-formas.png') });

  // 4. A from the owner's post-it to the session's → a link with the arrow, nothing in drawings.
  const ownerId = await owner.getAttribute('data-card-id');
  const sessionId = await sessionCard.getAttribute('data-card-id');
  await window.keyboard.press('a');
  await dragScreen(window, await center(owner.getByText('✎ você')), await center(sessionCard.getByTestId('mindscape-session-state')));
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('data-arrow', 'true');
  await expect(links).toHaveAttribute('data-from', ownerId ?? '');
  await expect(links).toHaveAttribute('data-to', sessionId ?? '');
  await expect(drawings).toHaveCount(5);
  await expect.poll(() => saved().links, { timeout: 10_000 }).toEqual([expect.objectContaining({ from: ownerId, to: sessionId, arrow: true })]);
  // The click that ends the gesture did not select the session card.
  await expect(sessionCard).toHaveAttribute('data-selected', 'false');

  // 5. L between the same two → nothing new (pair already linked).
  await window.keyboard.press('l');
  await dragScreen(window, await center(sessionCard.getByTestId('mindscape-session-state')), await center(owner.getByText('✎ você')));
  await expect(toolButton(window, 'Seleção')).toHaveAttribute('aria-pressed', 'true');
  await expect(links).toHaveCount(1);
  await expect(drawings).toHaveCount(5);

  // 6. Esc in the middle of a gesture → nothing is created and the tool goes back to V.
  await window.keyboard.press('r');
  const escFrom = at(180, H - 120);
  await window.mouse.move(escFrom.x, escFrom.y);
  await window.mouse.down();
  await window.mouse.move(escFrom.x + 60, escFrom.y + 40, { steps: 6 });
  await window.mouse.move(escFrom.x + 120, escFrom.y + 80, { steps: 6 });
  await expect(screen(window).getByTestId('mindscape-drawing-draft')).toHaveCount(1);
  await window.keyboard.press('Escape');
  await window.mouse.up();
  await expect(screen(window).getByTestId('mindscape-drawing-draft')).toHaveCount(0);
  await expect(toolButton(window, 'Seleção')).toHaveAttribute('aria-pressed', 'true');
  await expect(drawings).toHaveCount(5);

  // 7. The key "r" with the focus in the owner's post-it text goes to the text (a new post-it opens in edit).
  await newOwnerCard(window, 'rascunho');
  await expect(toolButton(window, 'Seleção')).toHaveAttribute('aria-pressed', 'true');
  await expect(drawings).toHaveCount(5);

  // 8. Relaunch → the same drawings and link, and the file is v2.
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(5);
  const before = saved();
  expect(before.schemaVersion).toBe(2);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  const after = screen(launched.window);
  await expect(after.getByTestId('mindscape-drawing')).toHaveCount(5);
  await expect(after.getByTestId('mindscape-drawing').last()).toHaveAttribute('data-color', 'donel-accent');
  // The link waits for the session card (no tab open after the relaunch) but stays saved.
  expect(saved()).toEqual(before);
});
