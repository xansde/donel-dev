import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
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
// Fatia 04: P draws a pencil stroke and stays on; E erases only the touched
// piece (one stroke becomes two), takes a rect and a link away whole, never a
// post-it; Ctrl+Z brings the last pass back whole; with V a stroke is selected
// and moved; everything comes back after a relaunch. Same `atlas`, its own file.
// Fatia 05: Ctrl+wheel zooms on the mouse (the page zoom stays 1), "−" walks 10
// points, the number goes back to 100%, the wheel moves the view (Shift:
// horizontally), a rect drawn at 200% is born under the pointer, Ctrl+Z never
// undoes the zoom, `beacon` keeps its own zoom and `atlas` comes back at the
// same zoom after a relaunch. `atlas` and `beacon`, its own file.
// Fatia 06: an image written to the clipboard (`clipboard.writeImage`) and
// pasted with Ctrl+V is born under the mouse, at most 480 wide, with its file
// in `mindscape-images/`; a click selects it, the handle keeps the proportion,
// Delete takes it away and Ctrl+Z brings it back (file still there); a dropped
// image file is born on the drop point; more than 10 MB shows the warning; after
// a relaunch the prints are back, the old orphan planted before the boot is
// gone and the recent one stays. `atlas`, its own file.

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
  imageId?: string;
  arrow?: boolean;
  points?: number[];
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

test('Mindscape desenho 04: lápis e borracha que apaga o pedaço tocado @mindscape', async () => {
  test.setTimeout(240_000);
  if (launched) await closeIsolatedApp(launched, false);
  launched = undefined;
  mindscapeFile = path.join(root, 'mindscape-04.json');
  scenario = SCENARIO;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window } = launched;

  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  const sessionCard = screen(window).getByTestId('mindscape-session-card');
  await expect(sessionCard).toHaveCount(1, { timeout: 30_000 });
  const owner = await newOwnerCard(window, 'Ver o deploy');
  // Away from the session card, to the right: the bottom left of the board stays free to draw.
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
  const pencils = () => saved().drawings.filter((drawing) => drawing.kind === 'pencil');

  // A rect (bottom left) and a link from the owner's post-it to the session's, to erase later.
  await window.keyboard.press('r');
  await dragScreen(window, at(40, H - 200), at(160, H - 120));
  await window.keyboard.press('a');
  await dragScreen(window, await center(owner.getByText('✎ você')), await center(sessionCard.getByTestId('mindscape-session-state')));
  await expect(drawings).toHaveCount(1);
  await expect(links).toHaveCount(1);

  // 1. P → a horizontal stroke → one pencil stroke in drawings, and the tool stays P.
  await window.keyboard.press('p');
  await expect(toolButton(window, 'Lápis')).toHaveAttribute('aria-pressed', 'true');
  await dragScreen(window, at(40, H - 60), at(300, H - 60));
  await expect(drawings).toHaveCount(2);
  await expect(drawings.last()).toHaveAttribute('data-kind', 'pencil');
  await expect(toolButton(window, 'Lápis')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pencils().length, { timeout: 10_000 }).toBe(1);
  const stroke = pencils()[0]!;
  expect(stroke.points!.length).toBeGreaterThanOrEqual(4);
  expect(stroke.points![0]).toBeCloseTo(40, 0);
  expect(stroke.points![1]).toBeCloseTo(H - 60, 0);

  // 2. E → the eraser circle follows the pointer; a pass across the middle of the stroke → two pencil strokes.
  await window.keyboard.press('e');
  await expect(toolButton(window, 'Borracha')).toHaveAttribute('aria-pressed', 'true');
  const middle = at(170, H - 60);
  await window.mouse.move(middle.x, middle.y - 40);
  await expect(screen(window).getByTestId('mindscape-eraser-cursor')).toBeVisible();
  await dragScreen(window, { x: middle.x, y: middle.y - 30 }, { x: middle.x, y: middle.y + 30 });
  await expect.poll(() => pencils().length, { timeout: 10_000 }).toBe(2);
  const [left, right] = pencils() as [SavedDrawing, SavedDrawing];
  expect(left.id).toBe(stroke.id);
  expect(left.points!.slice(-2)[0]).toBeLessThan(170);
  expect(right.points![0]).toBeGreaterThan(170);
  await expect(drawings).toHaveCount(3);
  await expect(toolButton(window, 'Borracha')).toHaveAttribute('aria-pressed', 'true');

  // 3. A pass over the left edge of the rect → it goes whole.
  await dragScreen(window, at(20, H - 160), at(60, H - 160));
  await expect.poll(() => saved().drawings.map((drawing) => drawing.kind), { timeout: 10_000 }).toEqual(['pencil', 'pencil']);

  // 4. A pass across the link → it goes; the two post-its stay.
  const linkMid = await center(links.getByTestId('mindscape-link-hit'));
  await dragScreen(window, { x: linkMid.x - 25, y: linkMid.y + 25 }, { x: linkMid.x + 25, y: linkMid.y - 25 });
  await expect(links).toHaveCount(0);
  await expect.poll(() => saved().links, { timeout: 10_000 }).toEqual([]);

  // 5. A pass over the owner's post-it → it stays (a post-it never goes), and nothing else changes.
  const ownerMid = await center(owner.getByTestId('mindscape-owner-text'));
  await dragScreen(window, { x: ownerMid.x - 50, y: ownerMid.y }, { x: ownerMid.x + 50, y: ownerMid.y });
  await expect(owner).toHaveCount(1);
  await expect(sessionCard).toHaveCount(1);
  await expect(drawings).toHaveCount(2);

  // 6. A pass along both strokes, then Ctrl+Z → that whole pass comes back in one go; Ctrl+Z again → the link comes back.
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(2);
  const beforeLastPass = saved().drawings;
  await dragScreen(window, at(70, H - 60), at(280, H - 60));
  await expect.poll(() => JSON.stringify(saved().drawings), { timeout: 10_000 }).not.toBe(JSON.stringify(beforeLastPass));
  await window.keyboard.press('Control+z');
  await expect.poll(() => saved().drawings, { timeout: 10_000 }).toEqual(beforeLastPass);
  await expect(drawings).toHaveCount(2);
  await expect(links).toHaveCount(0);
  await window.keyboard.press('Control+z');
  await expect(links).toHaveCount(1);
  await expect(drawings).toHaveCount(2);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-desenho-borracha.png') });

  // 7. With V, a click on a stroke selects it and a drag moves it (no handle on a pencil stroke).
  await window.keyboard.press('v');
  const leftStroke = screen(window).locator(`[data-testid="mindscape-drawing"][data-drawing-id="${left.id}"]`);
  const onLeft = { x: (left.points![0]! + left.points!.slice(-2)[0]!) / 2, y: left.points![1]! };
  await window.mouse.click(at(onLeft.x, onLeft.y).x, at(onLeft.x, onLeft.y).y);
  await expect(leftStroke).toHaveAttribute('data-selected', 'true');
  await expect(screen(window).getByTestId('mindscape-handle')).toHaveCount(0);
  await dragScreen(window, at(onLeft.x, onLeft.y), at(onLeft.x + 40, onLeft.y - 30));
  await expect.poll(() => saved().drawings.find((drawing) => drawing.id === left.id)?.points?.slice(0, 2), { timeout: 10_000 }).toEqual([
    Math.round((left.points![0]! + 40) * 10) / 10,
    Math.round((left.points![1]! - 30) * 10) / 10,
  ]);

  // 8. Relaunch → as left.
  await expect.poll(() => saved().links.length, { timeout: 10_000 }).toBe(1);
  const before = saved();
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  const after = screen(launched.window);
  await expect(after.getByTestId('mindscape-drawing')).toHaveCount(2);
  await expect(after.getByTestId('mindscape-drawing').first()).toHaveAttribute('data-kind', 'pencil');
  expect(saved()).toEqual(before);
});

/** Fatia 05 — pan and zoom of a saved board, by project folder name. */
function savedView(name: string): { pan?: { x: number; y: number }; zoom?: number } {
  try {
    const doc = JSON.parse(readFileSync(mindscapeFile, 'utf8')) as { boards?: Record<string, { pan?: { x: number; y: number }; zoom?: number }> };
    const board = Object.entries(doc.boards ?? {}).find(([key]) => path.basename(key) === name)?.[1];
    return { pan: board?.pan, zoom: board?.zoom };
  } catch {
    return {};
  }
}

/** Fatia 05 — the view the board shows (`data-pan` = "x,y" in px of screen, `data-zoom`). */
async function viewOf(board: Locator): Promise<{ pan: { x: number; y: number }; zoom: number }> {
  const [pan, zoom] = await Promise.all([board.getAttribute('data-pan'), board.getAttribute('data-zoom')]);
  const [x, y] = (pan ?? '0,0').split(',').map(Number) as [number, number];
  return { pan: { x, y }, zoom: Number(zoom) };
}

/** Fatia 05 — the zoom factor of the page of every window (the Electron zoom, not the board's). */
async function pageZoomFactors(app: ElectronApplication): Promise<number[]> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((browserWindow) => browserWindow.webContents.getZoomFactor()));
}

async function ctrlWheel(window: Page, deltaY: number): Promise<void> {
  await window.keyboard.down('Control');
  await window.mouse.wheel(0, deltaY);
  await window.keyboard.up('Control');
}

function boardTab(window: Page, name: string): Locator {
  return screen(window).getByTestId('mindscape-tab').filter({ hasText: name });
}

test('Mindscape desenho 05: zoom de 25% a 400%, salvo por quadro @mindscape', async () => {
  test.setTimeout(240_000);
  if (launched) await closeIsolatedApp(launched, false);
  launched = undefined;
  mindscapeFile = path.join(root, 'mindscape-05.json');
  scenario = SCENARIO;
  // A second project: the zoom is per board.
  mkdirSync(path.join(root, 'beacon'), { recursive: true });
  writeFileSync(path.join(root, 'beacon', 'CLAUDE.md'), '# beacon\n', 'utf8');
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window, app } = launched;

  await openProjectClaudeTab(window, 'beacon');
  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  await boardTab(window, 'atlas').click();
  await expect(boardTab(window, 'atlas')).toHaveAttribute('aria-selected', 'true');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1, { timeout: 30_000 });
  const owner = await newOwnerCard(window, 'Perto do mouse');
  const board = screen(window).getByTestId('mindscape-board');
  const zoomValue = screen(window).getByTestId('mindscape-zoom-value');
  const drawings = screen(window).getByTestId('mindscape-drawing');
  await expect(zoomValue).toHaveText('100%');
  await expect(board).toHaveAttribute('data-zoom', '1');

  // 1. Ctrl+wheel up over the board, next to the owner's post-it → past 100%, the page zoom stays 1,
  //    and the board point under the mouse stays put (the post-it grows away from the mouse).
  const ownerBefore = await owner.boundingBox();
  if (!ownerBefore) throw new Error('owner post-it not visible');
  const mouse = { x: ownerBefore.x + ownerBefore.width + 30, y: ownerBefore.y + 20 };
  await window.mouse.move(mouse.x, mouse.y);
  await ctrlWheel(window, -100);
  await expect(zoomValue).toHaveText('110%');
  expect((await pageZoomFactors(app)).every((factor) => factor === 1)).toBe(true);
  const ownerAfter = await owner.boundingBox();
  if (!ownerAfter) throw new Error('owner post-it not visible');
  expect(Math.abs(ownerAfter.x - (mouse.x + (ownerBefore.x - mouse.x) * 1.1))).toBeLessThan(2);
  expect(Math.abs(ownerAfter.y - (mouse.y + (ownerBefore.y - mouse.y) * 1.1))).toBeLessThan(2);
  expect(Math.abs(ownerAfter.width - ownerBefore.width * 1.1)).toBeLessThan(2);
  // A second notch → 121%.
  await ctrlWheel(window, -100);
  await expect(zoomValue).toHaveText('121%');
  // Ctrl+wheel over the bar zooms neither the board nor the page.
  const onBar = await center(toolButton(window, 'Seleção'));
  await window.mouse.move(onBar.x, onBar.y);
  await ctrlWheel(window, -100);
  await expect(zoomValue).toHaveText('121%');
  expect((await pageZoomFactors(app)).every((factor) => factor === 1)).toBe(true);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-desenho-zoom.png') });

  // 2. "−" → down 10 points; a click on the number → back to 100%.
  await screen(window).getByRole('button', { name: 'Diminuir zoom' }).click();
  await expect(zoomValue).toHaveText('111%');
  await zoomValue.click();
  await expect(zoomValue).toHaveText('100%');
  await expect(board).toHaveAttribute('data-zoom', '1');

  // 3. The wheel without Ctrl moves the view vertically; Shift+wheel, horizontally.
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error('board not visible');
  const free = { x: boardBox.x + boardBox.width / 2, y: boardBox.y + boardBox.height / 2 };
  await window.mouse.move(free.x, free.y);
  const start = await viewOf(board);
  await window.mouse.wheel(0, 100);
  await expect.poll(async () => (await viewOf(board)).pan.y, { timeout: 10_000 }).toBeCloseTo(start.pan.y - 100, 5);
  expect((await viewOf(board)).pan.x).toBeCloseTo(start.pan.x, 5);
  await window.keyboard.down('Shift');
  await window.mouse.wheel(0, 100);
  await window.keyboard.up('Shift');
  await expect.poll(async () => (await viewOf(board)).pan.x, { timeout: 10_000 }).toBeCloseTo(start.pan.x - 100, 5);
  expect((await viewOf(board)).pan.y).toBeCloseTo(start.pan.y - 100, 5);
  await expect(zoomValue).toHaveText('100%');

  // 4. At 200% ("+" ten times), a rect is born under the pointer, and a click on its edge selects it.
  const plus = screen(window).getByRole('button', { name: 'Aumentar zoom' });
  for (let step = 0; step < 10; step += 1) await plus.click();
  await expect(zoomValue).toHaveText('200%');
  const view = await viewOf(board);
  expect(view.zoom).toBe(2);
  const from = { x: boardBox.x + 200, y: boardBox.y + boardBox.height - 240 };
  const to = { x: from.x + 160, y: from.y + 100 };
  await window.keyboard.press('r');
  await dragScreen(window, from, to);
  await expect(drawings).toHaveCount(1);
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(1);
  const rect = saved().drawings[0]!;
  const toBoard = (point: { x: number; y: number }) => ({ x: (point.x - boardBox.x - view.pan.x) / view.zoom, y: (point.y - boardBox.y - view.pan.y) / view.zoom });
  expect(rect.kind).toBe('rect');
  expect(Math.abs(rect.x! - toBoard(from).x)).toBeLessThan(1);
  expect(Math.abs(rect.y! - toBoard(from).y)).toBeLessThan(1);
  expect(Math.abs(rect.w! - 80)).toBeLessThan(1);
  expect(Math.abs(rect.h! - 50)).toBeLessThan(1);
  const drawnBox = await drawings.first().boundingBox();
  if (!drawnBox) throw new Error('rect not visible');
  expect(Math.abs(drawnBox.x - from.x)).toBeLessThan(12);
  expect(Math.abs(drawnBox.y - from.y)).toBeLessThan(12);
  expect(Math.abs(drawnBox.width - 160)).toBeLessThan(16);
  await expect(toolButton(window, 'Seleção')).toHaveAttribute('aria-pressed', 'true');
  await window.mouse.click(from.x, (from.y + to.y) / 2);
  await expect(drawings.first()).toHaveAttribute('data-selected', 'true');
  await window.keyboard.press('Escape');

  // 5. Ctrl+Z undoes the rect, never the zoom; Ctrl+Shift+Z brings the rect back.
  await window.keyboard.press('Control+z');
  await expect(drawings).toHaveCount(0);
  await expect(zoomValue).toHaveText('200%');
  await window.keyboard.press('Control+Shift+z');
  await expect(drawings).toHaveCount(1);
  await expect(zoomValue).toHaveText('200%');

  // 6. `beacon` stays at 100%; back on `atlas`, 200%.
  await boardTab(window, 'beacon').click();
  await expect(zoomValue).toHaveText('100%');
  await expect(board).toHaveAttribute('data-zoom', '1');
  await boardTab(window, 'atlas').click();
  await expect(zoomValue).toHaveText('200%');

  // 7. Relaunch → `atlas` comes back at the same zoom and pan, `beacon` at 100%.
  await expect.poll(() => savedView('atlas').zoom, { timeout: 10_000 }).toBe(2);
  const savedAtlas = savedView('atlas');
  expect(savedAtlas.pan).toEqual(view.pan);
  expect(savedView('beacon').zoom).toBe(1);
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  await boardTab(launched.window, 'atlas').click();
  const relaunched = screen(launched.window);
  await expect(relaunched.getByTestId('mindscape-zoom-value')).toHaveText('200%');
  expect(await viewOf(relaunched.getByTestId('mindscape-board'))).toEqual({ pan: savedAtlas.pan, zoom: 2 });
  await expect(relaunched.getByTestId('mindscape-drawing')).toHaveCount(1);
  await boardTab(launched.window, 'beacon').click();
  await expect(relaunched.getByTestId('mindscape-zoom-value')).toHaveText('100%');
});

/** Fatia 06 — writes a `width` × `height` image to the clipboard (made in the main, no real photo): flat color, or noise. */
async function writeClipboardImage(app: ElectronApplication, width: number, height: number, noise = false): Promise<void> {
  await app.evaluate(
    ({ clipboard, nativeImage }, size) => {
      const bitmap = Buffer.alloc(size.width * size.height * 4);
      for (let index = 0; index < bitmap.length; index += 4) {
        // BGRA: a teal, or random colors that no PNG can squeeze.
        bitmap[index] = size.noise ? Math.floor(Math.random() * 256) : 0x99;
        bitmap[index + 1] = size.noise ? Math.floor(Math.random() * 256) : 0x88;
        bitmap[index + 2] = size.noise ? Math.floor(Math.random() * 256) : 0x22;
        bitmap[index + 3] = 0xff;
      }
      clipboard.writeImage(nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height }));
    },
    { width, height, noise },
  );
}

/** Fatia 06 — drops a `width` × `height` PNG file (drawn on a canvas by the test) on the board at a screen point. */
async function dropImageFile(window: Page, at: { x: number; y: number }, width: number, height: number): Promise<void> {
  await window.evaluate(
    async ({ x, y, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c08a2e';
      context.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'print.png', { type: 'image/png' }));
      const target = document.elementFromPoint(x, y)!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      }
    },
    { ...at, width, height },
  );
}

test('Mindscape desenho 06: print colado ou arrastado para o quadro @mindscape', async () => {
  test.setTimeout(240_000);
  if (launched) await closeIsolatedApp(launched, false);
  launched = undefined;
  mindscapeFile = path.join(root, 'mindscape-06.json');
  scenario = SCENARIO;
  // The prints live beside the board file. Two orphans planted before the boot: one 2 hours old, one recent.
  const imagesDir = path.join(root, 'mindscape-images');
  rmSync(imagesDir, { recursive: true, force: true });
  mkdirSync(imagesDir, { recursive: true });
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const oldOrphan = path.join(imagesDir, 'img-1-0000000a.png');
  const recentOrphan = path.join(imagesDir, 'img-2-0000000b.png');
  writeFileSync(oldOrphan, PNG_HEADER);
  writeFileSync(recentOrphan, PNG_HEADER);
  const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  utimesSync(oldOrphan, twoHoursAgo, twoHoursAgo);

  launched = await launchIsolatedApp({ userDataDir, env: env() });
  const { window, app } = launched;
  await openProjectClaudeTab(window, 'atlas');
  await setMode(window, 'Mindscape');
  await expect(screen(window).getByTestId('mindscape-session-card')).toHaveCount(1, { timeout: 30_000 });
  // No mindscape-06.json yet at this boot: the sweep did not run, and the old orphan is still there.
  expect(existsSync(oldOrphan)).toBe(true);

  const board = screen(window).getByTestId('mindscape-board');
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error('board not visible');
  expect(boardBox.height).toBeGreaterThan(450);
  expect(boardBox.width).toBeGreaterThan(900);
  const H = boardBox.height;
  // Board point (pan 0, zoom 100% all along) → screen point.
  const at = (x: number, y: number) => ({ x: boardBox.x + x, y: boardBox.y + y });
  const prints = screen(window).locator('[data-testid="mindscape-drawing"][data-kind="image"]');

  // 1. clipboard.writeImage (600 × 300) + Ctrl+V with the mouse over the board → the print is born there, 480 wide.
  const mouse = at(300, H - 200);
  await writeClipboardImage(app, 600, 300);
  await window.mouse.click(mouse.x, mouse.y);
  await window.keyboard.press('Control+v');
  await expect(prints).toHaveCount(1);
  await expect(prints.first()).toHaveAttribute('data-image-status', 'ready');
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(1);
  const pasted = saved().drawings[0]!;
  expect(pasted.kind).toBe('image');
  expect([pasted.w, pasted.h]).toEqual([480, 240]);
  expect(Math.abs(pasted.x! + pasted.w! / 2 - 300)).toBeLessThan(1);
  expect(Math.abs(pasted.y! + pasted.h! / 2 - (H - 200))).toBeLessThan(1);
  expect(pasted.imageId).toMatch(/^img-[0-9a-z]+-[0-9a-f]{8}\.png$/);
  const pastedFile = path.join(imagesDir, pasted.imageId!);
  expect(existsSync(pastedFile)).toBe(true);
  const shown = await prints.first().boundingBox();
  if (!shown) throw new Error('print not visible');
  expect(Math.abs(shown.width - 480)).toBeLessThan(2);
  expect(Math.abs(shown.x + shown.width / 2 - mouse.x)).toBeLessThan(2);
  if (process.env.DONEL_SMOKE_SHOTS_DIR) await window.screenshot({ path: path.join(process.env.DONEL_SMOKE_SHOTS_DIR, 'mindscape-desenho-print.png') });

  // 2. A click in the middle of the print selects it (its whole area counts); the corner handle keeps the proportion.
  await window.mouse.click(mouse.x, mouse.y);
  await expect(prints.first()).toHaveAttribute('data-selected', 'true');
  await expect(screen(window).getByTestId('mindscape-handle')).toHaveCount(4);
  const corner = await center(screen(window).locator('[data-testid="mindscape-handle"][data-handle="se"]'));
  await dragScreen(window, corner, { x: corner.x + 120, y: corner.y + 10 });
  await expect.poll(() => saved().drawings[0]?.w, { timeout: 10_000 }).not.toBe(480);
  const resized = saved().drawings[0]!;
  expect(Math.abs(resized.w! - 600)).toBeLessThan(1);
  expect(Math.abs(resized.w! / resized.h! - 2)).toBeLessThan(0.01);
  expect([resized.x, resized.y]).toEqual([pasted.x, pasted.y]);

  // 3. Delete → it goes (the file stays); Ctrl+Z → it comes back, with the file.
  await window.keyboard.press('Delete');
  await expect(prints).toHaveCount(0);
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(0);
  expect(existsSync(pastedFile)).toBe(true);
  await window.keyboard.press('Control+z');
  await expect(prints).toHaveCount(1);
  await expect(prints.first()).toHaveAttribute('data-image-status', 'ready');
  await expect.poll(() => saved().drawings.map((drawing) => drawing.imageId), { timeout: 10_000 }).toEqual([pasted.imageId]);
  expect(saved().drawings[0]!.w).toBe(resized.w);
  await window.keyboard.press('Escape');

  // 4. A PNG file dropped on the board → born on the drop point, at its natural size (120 × 80).
  const dropAt = at(boardBox.width - 160, 140);
  await dropImageFile(window, dropAt, 120, 80);
  await expect(prints).toHaveCount(2);
  await expect.poll(() => saved().drawings.length, { timeout: 10_000 }).toBe(2);
  const dropped = saved().drawings[1]!;
  expect([dropped.kind, dropped.w, dropped.h]).toEqual(['image', 120, 80]);
  expect(Math.abs(dropped.x! + 60 - (boardBox.width - 160))).toBeLessThan(1);
  expect(Math.abs(dropped.y! + 40 - 140)).toBeLessThan(1);
  expect(existsSync(path.join(imagesDir, dropped.imageId!))).toBe(true);

  // 5. More than 10 MB (2.500 × 2.500 of noise) → the warning in the hint strip, and nothing new on the board.
  await writeClipboardImage(app, 2500, 2500, true);
  await window.mouse.move(mouse.x, mouse.y);
  await window.keyboard.press('Control+v');
  await expect(screen(window).getByTestId('mindscape-hint')).toHaveText('Imagem grande demais (limite de 10 MB)', { timeout: 30_000 });
  await expect(prints).toHaveCount(2);
  expect(saved().drawings).toHaveLength(2);

  // 6. Relaunch → both prints are back (files read again), the old orphan is gone, the recent one stays.
  const before = saved();
  await closeIsolatedApp(launched, false);
  launched = undefined;
  launched = await launchIsolatedApp({ userDataDir, env: env() });
  await setMode(launched.window, 'Mindscape');
  const after = screen(launched.window).locator('[data-testid="mindscape-drawing"][data-kind="image"]');
  await expect(after).toHaveCount(2);
  await expect(after.first()).toHaveAttribute('data-image-status', 'ready');
  await expect(after.nth(1)).toHaveAttribute('data-image-status', 'ready');
  await expect.poll(() => existsSync(oldOrphan), { timeout: 10_000 }).toBe(false);
  expect(existsSync(recentOrphan)).toBe(true);
  expect(existsSync(pastedFile)).toBe(true);
  expect(existsSync(path.join(imagesDir, dropped.imageId!))).toBe(true);
  expect(saved()).toEqual(before);
});
