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
// Fatia 02: Ctrl+Z / Ctrl+Shift+Z undo and redo the owner's actions one by one,
// while the post-it written by the session keeps its new text; Ctrl+Z in the
// post-it text is the field's own; the history survives a mode change and is
// empty after a relaunch. Same `atlas`, its own mindscape file.
// Fatia 03: with V, click / Shift+click / lasso / Ctrl+A select drawings and
// post-its; the selection moves together (one Ctrl+Z), takes the color of the
// bar, grows by a handle, changes layer, goes away with Delete (the owner's
// post-it is archived, the session's stays); Delete removes a selected link;
// space + drag and H + drag move the view; "Ir ao terminal" needs exactly one
// session post-it selected. Same `atlas`, its own mindscape file.

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/slow-turn.json');
/** Stop hook with `last_assistant_message` after "primeiro" / "segundo" (the turn ends in the middle of the owner's actions). */
const NOTE_SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/mindscape/scenarios/session-note.json');

let root: string;
let userDataDir: string;
let mindscapeFile: string;
let launched: LaunchedApp | undefined;
let scenario = SCENARIO;

interface SavedDrawing {
  kind: string;
  id: string;
  color: string;
  stroke: string;
  arrow?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

interface SavedBoard {
  schemaVersion?: number;
  drawings: SavedDrawing[];
  links: { from: string; to: string; arrow: boolean }[];
}

function env(): Record<string, string | undefined> {
  return { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: scenario, DONEL_MINDSCAPE_FILE: mindscapeFile };
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

/** Fatia 03 — the cards and the pan of the saved atlas board. */
function savedCardsAndPan(): { cards: Record<string, { kind: string }>; pan?: { x: number; y: number } } {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, { cards?: Record<string, { kind: string }>; pan?: { x: number; y: number } }> };
    const board = Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === 'atlas')?.[1];
    return { cards: board?.cards ?? {}, pan: board?.pan };
  } catch {
    return { cards: {} };
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

function terminalTab(window: Page): Locator {
  return window.locator('[role="tab"]:not([data-testid="mindscape-tab"])', { hasText: 'atlas' }).first();
}

/** Uso geral → type the prompt in the atlas tab → back to the Mindscape (unmounts and remounts the screen). */
async function sendOnAtlas(window: Page, prompt: string): Promise<void> {
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

/** Board position of a card, from its inline style (left/top are board units). */
async function cardSpot(card: Locator): Promise<{ x: number; y: number }> {
  return card.evaluate((element) => ({ x: Number.parseFloat((element as HTMLElement).style.left), y: Number.parseFloat((element as HTMLElement).style.top) }));
}

test('Mindscape desenho 02: Ctrl+Z e Ctrl+Shift+Z no quadro, sem desfazer o que a sessão fez @mindscape', async () => {
  test.setTimeout(240_000);
  if (launched) await closeIsolatedApp(launched, false);
  launched = undefined;
  mindscapeFile = path.join(root, 'mindscape-02.json');
  scenario = NOTE_SCENARIO;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await expect(terminalTab(window)).toHaveAttribute('aria-selected', 'true');
  // A first turn: the post-it written by the session exists before the owner's actions.
  await sendOnAtlas(window, 'primeiro');
  const notes = screen(window).getByTestId('mindscape-note-card');
  const noteText = notes.first().getByTestId('mindscape-note-text');
  await expect(notes).toHaveCount(1, { timeout: 15_000 });
  await expect(noteText).toHaveText('Primeira resposta (hook).');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1);

  const boardBox = await screen(window).getByTestId('mindscape-board').boundingBox();
  if (!boardBox) throw new Error('board not visible');
  const H = boardBox.height;
  const at = (x: number, y: number) => ({ x: boardBox.x + x, y: boardBox.y + y });
  const drawings = screen(window).getByTestId('mindscape-drawing');
  const owners = screen(window).getByTestId('mindscape-owner-card');

  // 1. Three owner actions: a rect, an (empty) owner post-it, and a drag of it.
  await window.keyboard.press('r');
  await dragScreen(window, at(30, H - 200), at(150, H - 120));
  await expect(drawings).toHaveCount(1);
  await screen(window).getByRole('button', { name: 'Novo post-it' }).click();
  await expect(owners.getByRole('textbox', { name: 'Texto do post-it' })).toBeFocused();
  // Click on the empty corner: the field closes with the same (empty) text, so no entry.
  await window.mouse.click(boardBox.x + boardBox.width - 30, boardBox.y + H - 30);
  await expect(owners).toHaveCount(1);
  await expect(owners.getByRole('textbox')).toHaveCount(0);
  const born = await cardSpot(owners);
  const grip = await center(owners.getByText('✎ você'));
  await dragScreen(window, grip, { x: grip.x, y: grip.y + 200 });
  await expect.poll(() => cardSpot(owners)).toEqual({ x: born.x, y: born.y + 200 });
  const moved = await cardSpot(owners);

  // 2. The session ends a turn now: its post-it gets the new text.
  await sendOnAtlas(window, 'segundo');
  await expect(noteText).toHaveText('Segunda resposta (hook).', { timeout: 15_000 });

  // 3. Ctrl+Z three times: the post-it goes back to where it was born, then goes away, then the rect goes away;
  //    the post-it written by the session keeps the new text all along.
  await window.keyboard.press('Control+z');
  await expect.poll(() => cardSpot(owners)).toEqual(born);
  await expect(drawings).toHaveCount(1);
  await window.keyboard.press('Control+z');
  await expect(owners).toHaveCount(0);
  await expect(drawings).toHaveCount(1);
  await window.keyboard.press('Control+z');
  await expect(drawings).toHaveCount(0);
  await expect(notes).toHaveCount(1);
  await expect(noteText).toHaveText('Segunda resposta (hook).');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1);
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(0);

  // 4. Ctrl+Shift+Z → the rect comes back.
  await window.keyboard.press('Control+Shift+z');
  await expect(drawings).toHaveCount(1);
  await expect(owners).toHaveCount(0);

  // 5. Ctrl+Z in the middle of a gesture is ignored (Esc then cancels the gesture: nothing new).
  await window.keyboard.press('r');
  const from = at(200, H - 200);
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move(from.x + 60, from.y + 40, { steps: 6 });
  await expect(screen(window).getByTestId('mindscape-drawing-draft')).toHaveCount(1);
  await window.keyboard.press('Control+z');
  await expect(drawings).toHaveCount(1);
  await window.keyboard.press('Escape');
  await window.mouse.up();
  await expect(drawings).toHaveCount(1);

  // 6. Uso geral and back → the redo stack is still there: the post-it comes back, then its drag.
  await setMode(window, 'Uso geral');
  await setMode(window, 'Mindscape');
  await window.keyboard.press('Control+Shift+z');
  await expect(owners).toHaveCount(1);
  await expect.poll(() => cardSpot(owners)).toEqual(born);
  // It comes back as it was, not in edit mode.
  await expect(owners.getByRole('textbox')).toHaveCount(0);
  await window.keyboard.press('Control+Shift+z');
  await expect.poll(() => cardSpot(owners)).toEqual(moved);

  // 7. With the focus in the post-it text, Ctrl+Z undoes only the typing.
  await owners.getByTestId('mindscape-owner-text').dblclick();
  const field = owners.getByRole('textbox', { name: 'Texto do post-it' });
  await expect(field).toBeFocused();
  await window.keyboard.type('abc');
  await expect(field).toHaveValue('abc');
  await window.keyboard.press('Control+z');
  // The field's own undo (how much of the typing one step takes is Chromium's grouping); the board is untouched.
  await expect.poll(() => field.inputValue()).toMatch(/^a?b?$/);
  await expect(field).toBeFocused();
  await expect(owners).toHaveCount(1);
  await expect(drawings).toHaveCount(1);
  expect(await cardSpot(owners)).toEqual(moved);
  await window.keyboard.press('Escape');
  await expect(owners.getByRole('textbox')).toHaveCount(0);

  // 8. Relaunch → Ctrl+Z does nothing (the history starts empty).
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(1);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  const before = readFileSync(mindscapeFile, 'utf8');
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  const after = screen(launched.window);
  await expect(after.getByTestId('mindscape-drawing')).toHaveCount(1);
  await expect(after.getByTestId('mindscape-owner-card')).toHaveCount(1);
  await launched.window.keyboard.press('Control+z');
  await launched.window.keyboard.press('Control+Shift+z');
  await expect(after.getByTestId('mindscape-drawing')).toHaveCount(1);
  await expect(after.getByTestId('mindscape-owner-card')).toHaveCount(1);
  expect(await cardSpot(after.getByTestId('mindscape-owner-card'))).toEqual(moved);
  await expect(after.getByTestId('mindscape-note-card').getByTestId('mindscape-note-text')).toHaveText('Segunda resposta (hook).');
  // Nothing was written: the file is the one left before the relaunch.
  await launched.window.waitForTimeout(800);
  expect(readFileSync(mindscapeFile, 'utf8')).toBe(before);
});

/** Shift held around a plain click (Shift+clique adds to / takes from the selection). */
async function shiftClick(window: Page, point: { x: number; y: number }): Promise<void> {
  await window.keyboard.down('Shift');
  await window.mouse.click(point.x, point.y);
  await window.keyboard.up('Shift');
}

test('Mindscape desenho 03: seleção múltipla, alças, estilo e camadas @mindscape', async () => {
  test.setTimeout(240_000);
  if (launched) await closeIsolatedApp(launched, false);
  launched = undefined;
  mindscapeFile = path.join(root, 'mindscape-03.json');
  scenario = SCENARIO;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  const sessionCard = screen(window).getByTestId('mindscape-session-card');
  await expect(sessionCard).toHaveCount(1, { timeout: 30_000 });
  const owner = await newOwnerCard(window, 'Ver o deploy');
  const ownerId = (await owner.getAttribute('data-card-id')) ?? '';
  const board = screen(window).getByTestId('mindscape-board');
  const boardBox = await board.boundingBox();
  const ownerBox = await owner.boundingBox();
  if (!boardBox || !ownerBox) throw new Error('board not visible');
  // Screen coordinates: rect 1 right under the owner post-it, rect 2 at the left edge of the board (away from both post-its).
  const oL = ownerBox.x;
  const oT = ownerBox.y;
  const oR = ownerBox.x + ownerBox.width;
  const oB = ownerBox.y + ownerBox.height;
  const bx = boardBox.x;
  const drawings = screen(window).getByTestId('mindscape-drawing');
  const drawing = (id: string) => screen(window).locator(`[data-testid="mindscape-drawing"][data-drawing-id="${id}"]`);
  const byId = (id: string) => saved().drawings.find((candidate) => candidate.id === id);

  // 1. Two rects.
  await window.keyboard.press('r');
  await dragScreen(window, { x: oL, y: oB + 30 }, { x: oL + 120, y: oB + 110 });
  await window.keyboard.press('r');
  await dragScreen(window, { x: bx + 30, y: oB + 30 }, { x: bx + 150, y: oB + 110 });
  await expect(drawings).toHaveCount(2);
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(2);
  const [first, second] = saved().drawings.map((candidate) => candidate.id) as [string, string];
  const firstBefore = byId(first)!;
  const secondBefore = byId(second)!;

  // 2. Click on the first (its contour), Shift+click on the second → both selected.
  await window.mouse.click(oL, oB + 70);
  await expect(drawing(first)).toHaveAttribute('data-selected', 'true');
  await expect(drawing(second)).toHaveAttribute('data-selected', 'false');
  await shiftClick(window, { x: bx + 150, y: oB + 70 });
  await expect(drawing(first)).toHaveAttribute('data-selected', 'true');
  await expect(drawing(second)).toHaveAttribute('data-selected', 'true');

  // 3. Drag one → both move; Ctrl+Z brings both back at once.
  await dragScreen(window, { x: oL + 60, y: oB + 30 }, { x: oL + 100, y: oB + 80 });
  await expect.poll(() => [byId(first)?.x, byId(first)?.y, byId(second)?.x, byId(second)?.y], { timeout: 10_000 }).toEqual([
    firstBefore.x! + 40,
    firstBefore.y! + 50,
    secondBefore.x! + 40,
    secondBefore.y! + 50,
  ]);
  await window.keyboard.press('Control+z');
  await expect.poll(() => [byId(first), byId(second)], { timeout: 10_000 }).toEqual([firstBefore, secondBefore]);

  // 4. Lasso around the first rect and the owner post-it → both selected (the second rect and the session post-it stay out).
  await dragScreen(window, { x: oL - 10, y: oT - 10 }, { x: oR + 10, y: oB + 120 });
  await expect(drawing(first)).toHaveAttribute('data-selected', 'true');
  await expect(drawing(second)).toHaveAttribute('data-selected', 'false');
  await expect(screen(window).locator(`[data-testid="mindscape-selection-outline"][data-item-id="${ownerId}"]`)).toHaveCount(1);
  await expect(sessionCard).toHaveAttribute('data-selected', 'false');

  // 5. Azul → only the selected rect changes (the owner post-it keeps its color, the other rect too).
  await screen(window).getByRole('group', { name: 'Cor do desenho' }).getByRole('button', { name: 'Azul' }).click();
  await expect(drawing(first)).toHaveAttribute('data-color', 'accent');
  await expect(drawing(second)).toHaveAttribute('data-color', 'none');
  await expect(owner).toHaveAttribute('data-color', 'none');
  await expect.poll(() => [byId(first)?.color, byId(second)?.color], { timeout: 10_000 }).toEqual(['accent', 'none']);

  // 6. Select the second alone → 4 handles; pull the bottom-right one → it grows.
  await window.mouse.click(bx + 150, oB + 70);
  await expect(drawing(second)).toHaveAttribute('data-selected', 'true');
  await expect(drawing(first)).toHaveAttribute('data-selected', 'false');
  const handles = screen(window).getByTestId('mindscape-handle');
  await expect(handles).toHaveCount(4);
  const corner = await center(screen(window).locator('[data-testid="mindscape-handle"][data-handle="se"]'));
  await dragScreen(window, corner, { x: corner.x + 60, y: corner.y + 40 });
  await expect.poll(() => byId(second)?.w ?? 0, { timeout: 10_000 }).toBeGreaterThan(secondBefore.w! + 55);
  expect(byId(second)!.w).toBeCloseTo(secondBefore.w! + 60, 0);
  expect(byId(second)!.h).toBeCloseTo(secondBefore.h! + 40, 0);
  expect(byId(second)!.x).toBe(secondBefore.x);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-desenho-alcas.png') });

  // 7. "Mandar para trás" → the order in drawings flips; Ctrl+Shift+] brings it back to the top.
  await screen(window).getByRole('group', { name: 'Camada' }).getByRole('button', { name: 'Mandar para trás' }).click();
  await expect.poll(() => saved().drawings.map((candidate) => candidate.id), { timeout: 10_000 }).toEqual([second, first]);
  await window.keyboard.press('Control+Shift+BracketRight');
  await expect.poll(() => saved().drawings.map((candidate) => candidate.id), { timeout: 10_000 }).toEqual([first, second]);

  // 8. Ctrl+A and Delete → the drawings go away, the owner post-it is archived, the session post-it stays.
  await window.keyboard.press('Control+a');
  await expect(drawing(first)).toHaveAttribute('data-selected', 'true');
  await expect(sessionCard).toHaveAttribute('data-selected', 'true');
  await window.keyboard.press('Delete');
  await expect(drawings).toHaveCount(0);
  await expect(owner).toHaveCount(0);
  await expect(sessionCard).toHaveCount(1);
  await expect.poll(() => [saved().drawings.length, Object.values(savedCardsAndPan().cards).map((card) => card.kind)], { timeout: 10_000 }).toEqual([0, ['session']]);

  // 9. A link between a new owner post-it and the session one; click on it and Delete → gone.
  const secondOwner = await newOwnerCard(window, 'Segundo');
  await window.keyboard.press('a');
  await dragScreen(window, await center(secondOwner.getByText('✎ você')), await center(sessionCard.getByTestId('mindscape-session-state')));
  const links = screen(window).getByTestId('mindscape-link');
  await expect(links).toHaveCount(1);
  await links.getByTestId('mindscape-link-hit').click({ force: true });
  await expect(links).toHaveAttribute('data-selected', 'true');
  await window.keyboard.press('Delete');
  await expect(links).toHaveCount(0);
  await expect(secondOwner).toHaveCount(1);
  await expect.poll(() => saved().links, { timeout: 10_000 }).toEqual([]);

  // 10. Only the session post-it selected → "Ir ao terminal" on; with the owner post-it too → off.
  const goToTerminal = screen(window).getByRole('button', { name: 'Ir ao terminal' });
  await expect(goToTerminal).toBeDisabled();
  await sessionCard.getByTestId('mindscape-session-state').click();
  await expect(sessionCard).toHaveAttribute('data-selected', 'true');
  await expect(goToTerminal).toBeEnabled();
  await shiftClick(window, await center(secondOwner.getByText('✎ você')));
  await expect(goToTerminal).toBeDisabled();
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-desenho-selecao.png') });

  // 11. Space + drag and H + drag move the view (V stays the tool under space).
  const empty = { x: bx + boardBox.width - 40, y: boardBox.y + boardBox.height - 40 };
  await window.keyboard.down('Space');
  await dragScreen(window, empty, { x: empty.x - 100, y: empty.y - 50 });
  await window.keyboard.up('Space');
  await expect(board).toHaveAttribute('data-pan', '-100,-50');
  await expect(board).toHaveAttribute('data-tool', 'select');
  await expect(screen(window).getByTestId('mindscape-lasso')).toHaveCount(0);
  await window.keyboard.press('h');
  await dragScreen(window, empty, { x: empty.x + 30, y: empty.y + 20 });
  await expect(board).toHaveAttribute('data-pan', '-70,-30');
  await window.keyboard.press('v');
  await expect.poll(() => savedCardsAndPan().pan, { timeout: 10_000 }).toEqual({ x: -70, y: -30 });
});
