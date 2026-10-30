import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { refuseIfRealClaudeHome } from './accountsCredentialGuard';
import { launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import type { LaunchedApp } from './helpers/launch';
import { listPidsByCommandLine, waitForNewPids, waitForPidsGone } from './helpers/processes';
import { launchClaudeTab, openFreeTerminalTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir, removeTempDir } from './userDataIsolation';

// 015-jobu-pet, T029 (US1), T035 (US2), T041 (US3), T044 (US4), T051 (US5) and T062 (FR-034) - smoke of the
// Jobu's face, badge, bubble, clicks, account bubble, gestures and screen-capture protection, against the FAKE
// `claude` (never the real CLI). The pet is a second window of the same app: the main window is still
// `firstWindow()` (R21) and the pet is found by its URL, which ends in `#pet`. What the test reads is the
// `data-*` surface of the pet root (`data-pose` = the LOGICAL pose, `data-badge`, `data-bubble`,
// `data-interactive`...), which mirrors the view.
//
// THE JOBU OF A TEST IS A GHOST (`DONEL_PET_SMOKE_INVISIBLE=1`, src/main/pet/pet-seams.ts): someone is working on
// this machine while the smokes run, and a Jobu that appears over that work, steals a click, takes the keyboard for the
// list or opens a native menu under the pointer is an interruption, not a test. The ghost has no opacity on the screen,
// never receives the mouse from the OS, never takes the focus, and its right-click menu is published in
// `globalThis.__donelPetSmoke` of the main process for the test to read and to choose from (the same callback a click
// on an item runs). The page, the CDP and the whole state go on exactly the same. The prints of the documentation are
// made with the seam OFF and `DONEL_PET_CAPTURABLE=1`, over an opaque background of their own.
//
// The scenario `waiting-turn.json` holds the turn of the prompt `pedido` for 9 s before the `Stop` and the
// one of `rapido` for 6 s: time to move the owner to another tab and minimize the Donel. `agentes` (#109) plays
// two background sub-agents: three `Stop`s, the first two with sub-agents still alive in `background_tasks`. Test tab names
// are `atlas`, `beacon` and `vega` (never the real project name: the fence in tests/smoke-project-name.test.ts).
//
// The mouse is the one of Playwright, which reaches the page straight through the debugger: it proves what
// the page does with a click and what it asks of the main, not the OS-level click-through of the
// transparent window (that one needs a real mouse: `SetCursorPos` does not feed the hook of Electron).
//
// Blocks, apps: the first one with the chat off (the semaphore alone drives the Jobu), the second with the chat on (a
// pending carries its kind and a Windows notification could be raised), the third with a fake account mod (US4) and
// the fourth for the gestures of US5 (menu, drag, size, capture, full screen, hiding, remembering).

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/pet/scenarios/waiting-turn.json');
const NOTIFICATION_BODY = 'Esperando você — permissão para rodar um comando';
/** The ghost: nothing of the Jobu of a test shows, steals a click or takes the keyboard of whoever is using the machine. */
const GHOST_ENV = { DONEL_PET_SMOKE_INVISIBLE: '1' };

let launched: LaunchedApp;
let main: Page;
let pet: Page;

/** The pet window: the one that loads the `#pet` route. */
async function findPetWindow(app: ElectronApplication): Promise<Page> {
  const isPet = (page: Page): boolean => page.url().endsWith('#pet');
  await expect.poll(() => app.windows().some(isPet), { timeout: 20_000, message: 'the pet window did not open' }).toBe(true);
  const page = app.windows().find(isPet);
  if (page === undefined) throw new Error('the pet window vanished right after opening');
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const root = (): Locator => pet.getByTestId('pet-root');

/** The whole Donel window: minimized, or back and holding the system focus. */
async function setDonelWindow(state: 'minimized' | 'focused'): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }, wanted) => {
    const donel = BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith('#pet'));
    if (donel === undefined) throw new Error('the main window is gone');
    if (wanted === 'minimized') {
      donel.minimize();
    } else {
      donel.restore();
      donel.show();
      donel.focus();
    }
  }, state);
}

/** The tab of a session, by the name it shows. */
const tabNamed = (name: string): Locator => main.locator('[role="tab"]', { hasText: name }).first();

/** The `blur` the OS would raise on the pet window when the owner clicks elsewhere (the ghost never has the focus to lose). */
async function emitPetBlur(): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }) => {
    const petWindow = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('#pet'));
    if (petWindow === undefined) throw new Error('the pet window is gone');
    petWindow.emit('blur');
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The gestures of US5, read and driven through the ghost (`DONEL_PET_SMOKE_INVISIBLE=1`).
// ---------------------------------------------------------------------------------------------------------------

/** One entry of the right-click menu as the ghost publishes it (src/shared/pet/menu.ts). */
interface MenuEntryView {
  readonly type: 'item' | 'submenu' | 'separator';
  readonly label?: string;
  readonly items?: readonly { readonly label: string; readonly checked: boolean }[];
}

/** What the ghost leaves in the global object of the main process (src/main/pet/pet-seams.ts). */
type GhostGlobal = typeof globalThis & {
  __donelPetSmoke?: {
    menu?: { entries: MenuEntryView[]; choose: (action: unknown) => void } | null;
    setFullscreen?: (active: boolean) => void;
  };
};

const menuLabels = (entries: readonly MenuEntryView[]): string[] => entries.map((entry) => (entry.type === 'separator' ? '---' : (entry.label ?? '')));

/**
 * Right-clicks the Jobu (the mouse of Playwright: the page gets the real `contextmenu` event with the screen
 * coordinates, and asks the main for the menu) and returns the entries the owner would have seen. The native menu is
 * not shown in a test: it would take the mouse of the whole desktop and open under the pointer of whoever is working.
 */
async function openMenu(): Promise<MenuEntryView[]> {
  await launched.app.evaluate(() => {
    const hooks = (globalThis as GhostGlobal).__donelPetSmoke;
    if (hooks !== undefined) hooks.menu = null; // a menu from before must never be read as this one
  });
  const chest = await chestPoint();
  await pet.mouse.move(chest.x, chest.y);
  await expect(root()).toHaveAttribute('data-interactive', 'true');
  await pet.mouse.click(chest.x, chest.y, { button: 'right' });
  await expect
    .poll(() => launched.app.evaluate(() => (globalThis as GhostGlobal).__donelPetSmoke?.menu != null), { timeout: 10_000, message: 'the right-click menu did not come' })
    .toBe(true);
  return launched.app.evaluate(() => (globalThis as GhostGlobal).__donelPetSmoke?.menu?.entries ?? []);
}

/** Chooses an action in the menu that was opened last: the very callback a click on an item runs. */
async function chooseFromMenu(action: unknown): Promise<void> {
  await launched.app.evaluate((_electron, wanted) => {
    (globalThis as GhostGlobal).__donelPetSmoke?.menu?.choose(wanted);
  }, action);
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The pet window, in DIP, as the OS has it. */
async function petBounds(): Promise<Rect> {
  return launched.app.evaluate(({ BrowserWindow }) => {
    const petWindow = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('#pet'));
    if (petWindow === undefined) throw new Error('the pet window is gone');
    return petWindow.getBounds();
  });
}

/** The base of the drawing, in screen DIP: the middle of the bottom edge of the window. */
async function petAnchor(): Promise<{ x: number; y: number }> {
  const bounds = await petBounds();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
}

/** The taskbar edge of the primary monitor lives at the bottom of its work area. */
async function primaryWorkArea(): Promise<Rect> {
  return launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
}

/** `max(480, 3.4 x size)` wide: the rule of the window, repeated here on purpose (a smoke never imports from src/). */
const petWindowWidth = (size: number): number => Math.max(480, Math.round(3.4 * size));

/**
 * Drags the Jobu by (dx, dy) DIP the way a hand does: the pointer stays put on the screen and the window follows it.
 * The Playwright mouse reports `screenX/Y` as the position of the pointer in the window PLUS the position of the
 * window (measured), so after every step the pointer is placed again where it was on the screen: for the page,
 * back on the same spot of the drawing, exactly as with a real mouse.
 */
async function dragJobuBy(dx: number, dy: number): Promise<void> {
  const chest = await chestPoint();
  await pet.mouse.move(chest.x, chest.y);
  await expect(root()).toHaveAttribute('data-interactive', 'true');
  const start = await petBounds();
  await pet.mouse.down();
  // The chest is near the bottom of a 340 px window: a step down has to stay inside it, a step up or sideways has room.
  const steps = Math.max(1, Math.ceil(Math.abs(dx) / 200), Math.ceil(dy > 0 ? dy / 20 : Math.abs(dy) / 200));
  for (let step = 1; step <= steps; step += 1) {
    const wantX = start.x + Math.round((dx * step) / steps);
    const wantY = start.y + Math.round((dy * step) / steps);
    const now = await petBounds();
    await pet.mouse.move(chest.x + (wantX - now.x), chest.y + (wantY - now.y));
    await expect
      .poll(
        async () => {
          const bounds = await petBounds();
          return Math.abs(bounds.x - wantX) <= 1 && Math.abs(bounds.y - wantY) <= 1;
        },
        { timeout: 8_000, message: `the Jobu did not follow the pointer (step ${step} of ${steps})` },
      )
      .toBe(true);
  }
  await pet.mouse.move(chest.x, chest.y); // the pointer did not move on the screen: in the window that followed, it is where it went down
  await pet.mouse.up();
}

/** One notch of Ctrl + wheel over the Jobu: up grows, down shrinks. */
async function wheelOverJobu(direction: 1 | -1): Promise<void> {
  const chest = await chestPoint();
  await pet.mouse.move(chest.x, chest.y);
  await expect(root()).toHaveAttribute('data-interactive', 'true');
  await pet.keyboard.down('Control');
  await pet.mouse.wheel(0, direction > 0 ? -100 : 100);
  await pet.keyboard.up('Control');
}

/** `GetWindowDisplayAffinity` of the pet window, read from the OS (user32): 0x11 is excluded from capture, 0x0 is not. */
async function petDisplayAffinity(): Promise<number> {
  const handle = await launched.app.evaluate(({ BrowserWindow }) => {
    const petWindow = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('#pet'));
    if (petWindow === undefined) throw new Error('the pet window is gone');
    return petWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
  });
  const script = [
    "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);'",
    '$a = 0',
    `[W.U]::GetWindowDisplayAffinity([IntPtr]::new([int64]${handle}), [ref]$a) | Out-Null`,
    '$a',
  ].join('; ');
  return Number(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim());
}

/** Is the pet window shown by the OS? (A ghost is shown, with no opacity.) */
async function petWindowVisible(): Promise<boolean | null> {
  return launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('#pet'))?.isVisible() ?? null);
}

/** The switch of the Preferences that turns the Jobu on and off. The dialog stays open: the caller closes it with Escape. */
async function openPetToggle(): Promise<Locator> {
  await main.getByRole('button', { name: 'Preferências' }).click();
  const dialog = main.getByRole('dialog', { name: 'Preferências' });
  await expect(dialog).toBeVisible();
  return dialog.getByTestId('preferences-pet-toggle').getByRole('switch');
}

/**
 * The full-screen watcher is a PowerShell started with `-EncodedCommand`, so it is told apart by the base64 of the
 * beginning of its script ("$ErrorActionPreference =", 24 characters = 48 bytes of UTF-16LE = a whole number of base64
 * groups, so the text is a stable prefix of the argument).
 */
const WATCHER_COMMAND_PREFIX = Buffer.from('$ErrorActionPreference =', 'utf16le').toString('base64');
const watcherPids = (): Set<number> => listPidsByCommandLine('powershell.exe', WATCHER_COMMAND_PREFIX);

/** Turns the Jobu off or on the way the Preferences do, and follows his window: it goes away, or it is a new one. */
async function setPetEnabled(enabled: boolean): Promise<void> {
  await main.evaluate((value) => window.donel.config.setPetPrefs({ enabled: value }).then(() => undefined), enabled);
  if (enabled) {
    pet = await findPetWindow(launched.app);
    return;
  }
  await expect.poll(() => launched.app.windows().some((page) => page.url().endsWith('#pet')), { timeout: 10_000, message: 'the pet window did not close' }).toBe(false);
}

/** A claude session with that name: the first tab of the app picks the project, the others keep the one the Launcher remembers. */
async function ensureSession(name: string): Promise<void> {
  if ((await tabNamed(name).count()) > 0) return;
  const noTabsYet = (await main.locator('[role="tab"]').count()) === 0;
  await launchClaudeTab(main, noTabsYet ? { name } : { project: null, name });
}

/** Types a prompt in the claude session that is in front (terminal view): waits for the fake's footer, then types and sends. */
async function sendPrompt(text: string): Promise<void> {
  const pane = main.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect(await pane.innerText()).toContain('shortcuts'); // the fake claude drew its footer
  }).toPass({ timeout: 30_000 });
  await pane.click();
  await main.keyboard.type(text);
  await main.keyboard.press('Enter');
}

/** The state of the Donel window as the OS sees it, from the main process. */
async function donelWindowState(): Promise<{ minimized: boolean; visible: boolean; focused: boolean }> {
  return launched.app.evaluate(({ BrowserWindow }) => {
    const donel = BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith('#pet'));
    if (donel === undefined) throw new Error('the main window is gone');
    return { minimized: donel.isMinimized(), visible: donel.isVisible(), focused: donel.isFocused() };
  });
}

/** A point on the chest of the drawing: inside the Jobu in every pose, and the one the click test turns the window interactive on. */
async function chestPoint(): Promise<{ x: number; y: number }> {
  const box = await pet.getByTestId('pet-figure').boundingBox();
  if (box === null) throw new Error('the drawing has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.8 };
}

/** Moves the mouse onto the Jobu (waiting for the window to take it) and clicks. */
async function clickTheJobu(): Promise<void> {
  const chest = await chestPoint();
  await pet.mouse.move(chest.x, chest.y);
  await expect(root()).toHaveAttribute('data-interactive', 'true');
  await pet.mouse.click(chest.x, chest.y);
}

/** The owner got the Donel focused again and looks at `name`: whatever waits on it is seen. */
async function lookAt(name: string): Promise<void> {
  await setDonelWindow('focused');
  await expect.poll(() => main.evaluate(() => document.hasFocus()), { timeout: 10_000 }).toBe(true);
  await tabNamed(name).click();
}

test.describe('o Jobu sem o chat', () => {
  test.beforeAll(async () => {
    const userDataDir = createIsolatedUserDataDir('pet');
    writeFileSync(
      path.join(userDataDir, 'config.json'),
      // `notificationPreference: 'all'` makes the toast of the renderer fire on any session that waits, so that
      // its silence with the Jobu on (T035) is a real result and not "the default preference never asked".
      // `projectRoots`: the folder that holds the repo under test, as in chatSmoke.ts, so the Launcher lists it from a worktree too.
      JSON.stringify({ pet: { enabled: true, placement: null, size: 140 }, notificationPreference: 'all', projectRoots: [path.dirname(REPO_ROOT)] }),
      'utf8',
    );
    launched = await launchIsolatedApp({ userDataDir, env: { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, ...GHOST_ENV } });
    main = launched.window;
    pet = await findPetWindow(launched.app);
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    await closeIsolatedApp(launched);
  });

  test('T029 - the drawing sits on the base of the window and only the drawing takes the mouse (alpha click test) @pet', async () => {
    test.setTimeout(60_000);
    // No session at all: asleep, in the corner, sitting on the taskbar edge.
    await expect(root()).toHaveAttribute('data-pose', 'sleeping');
    await expect(root()).toHaveAttribute('data-art', 'sleeping');
    await expect(root()).toHaveAttribute('data-size', '140');
    await expect(root()).not.toHaveAttribute('data-badge');

    const size = Number(await root().getAttribute('data-size'));
    const box = await pet.getByTestId('pet-figure').boundingBox();
    if (box === null) throw new Error('the drawing has no box');
    const viewport = await pet.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

    // The height of the PNG as drawn is the size; the anchor (row 312 of 320) lands EXACTLY on the bottom
    // edge of the window, so the 8/320 of the size in transparent padding stays outside; and it is centered.
    expect(box.height).toBeCloseTo(size, 1);
    expect(box.y + box.height - viewport.height).toBeCloseTo((size * 8) / 320, 1);
    expect(box.x + box.width / 2).toBeCloseTo(viewport.width / 2, 0);

    // The mouse. The click test decides from the pixel under the pointer: the chest and the base (2 px above
    // the edge, in the anchor column) are the Jobu; the window corner, the corner of the drawing box, the
    // sides and the top are void. Every void point comes right after a Jobu point, so a `data-interactive`
    // stuck on `true` (or one that never turns on) fails: the assertion waits for the CHANGE.
    const centerX = box.x + box.width / 2;
    const chest = { x: centerX, y: box.y + box.height * 0.8 };
    const base = { x: centerX, y: viewport.height - 2 };
    const move = async (point: { x: number; y: number }, interactive: boolean): Promise<void> => {
      await pet.mouse.move(point.x, point.y);
      await expect(root()).toHaveAttribute('data-interactive', String(interactive));
    };
    await move({ x: 4, y: 4 }, false);
    await move(chest, true);
    await move({ x: 4, y: 4 }, false); // the window corner
    await move(base, true);
    await move({ x: box.x + 3, y: box.y + 3 }, false); // the corner of the drawing box, transparent
    await move(chest, true);
    await move({ x: box.x - 30, y: box.y + box.height * 0.6 }, false); // beside the drawing
    await move(base, true);
    await move({ x: centerX, y: box.y - 20 }, false); // above the head
    await move(chest, true);
    await move({ x: box.x + box.width + 30, y: box.y + box.height * 0.6 }, false); // the other side
  });

  test('T029 - asleep, incense, reading; a turn that ends with the Donel minimized: impatient and badge 1; opening the tab clears the badge @pet', async () => {
    test.setTimeout(180_000);

    // 1. Two open, quiet sessions: the Jobu wakes up and is serene, with the incense (a new tab is idle, R2).
    await launchClaudeTab(main, { name: 'atlas' });
    await expect(root()).toHaveAttribute('data-pose', 'incense', { timeout: 20_000 });
    await launchClaudeTab(main, { project: null, name: 'beacon' }); // the Launcher remembers the project of the first tab
    await expect(root()).toHaveAttribute('data-pose', 'incense');
    await expect(root()).not.toHaveAttribute('data-badge');

    // 2. A prompt on `atlas`: the semaphore turns `working` and the Jobu reads.
    await tabNamed('atlas').click();
    await sendPrompt('pedido');
    await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });

    // 3. The owner goes to `beacon` and minimizes the Donel: `atlas` ends its turn out of sight. The
    //    bubble of that turn is in front of the face for 6 s (T035); what this test reads is what stays.
    await tabNamed('beacon').click();
    await setDonelWindow('minimized');
    await expect(root()).toHaveAttribute('data-badge', '1', { timeout: 40_000 });
    await expect(root()).toHaveAttribute('data-pose', 'impatient', { timeout: 15_000 });
    // `impatient` is the logical pose; until the new art exists the one drawn is the skeptical one (FR-029).
    await expect(root()).toHaveAttribute('data-art', 'skeptical');

    // 4. The Donel comes back with the focus, but the tab in front is `beacon`: `atlas` still waits.
    await setDonelWindow('focused');
    await expect.poll(() => main.evaluate(() => document.hasFocus()), { timeout: 10_000 }).toBe(true);
    await pet.waitForTimeout(1_500);
    await expect(root()).toHaveAttribute('data-badge', '1');
    await expect(root()).toHaveAttribute('data-pose', 'impatient');

    // 5. The owner opens the `atlas` tab (active tab + Donel focused = seen): the badge goes away and the
    //    Jobu laughs for a moment before going back to the incense.
    await tabNamed('atlas').click();
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
    await expect(root()).toHaveAttribute('data-pose', 'laughing');
    await expect(root()).toHaveAttribute('data-pose', 'incense', { timeout: 10_000 });
  });

  test('T035 - a turn that ends with the Donel minimized: the bubble "atlas · terminou", above the head, with the pose of the event, and it goes after 6 s @pet', async () => {
    test.setTimeout(180_000);
    await ensureSession('atlas');
    await ensureSession('beacon');

    await tabNamed('atlas').click();
    await sendPrompt('rapido');
    await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });
    await tabNamed('beacon').click();
    await setDonelWindow('minimized');

    // The bubble: the text of FR-015, the pose of FR-016 (calling, with the stand-in art of FR-029), the badge beside it.
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · terminou', { timeout: 40_000 });
    await expect(root()).toHaveAttribute('data-pose', 'calling');
    await expect(root()).toHaveAttribute('data-art', 'talking');
    await expect(root()).toHaveAttribute('data-badge', '1');
    const bubble = pet.getByTestId('pet-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveText('atlas · terminou');

    // Where it is: above the drawing, anchored to its right edge (the default corner, `align = right`), inside
    // the window and not wider than 300 px. The hop of the new bubble (520 ms) is over before it is measured.
    await pet.waitForTimeout(700);
    await expect(root()).toHaveAttribute('data-align', 'right');
    const figure = await pet.getByTestId('pet-figure').boundingBox();
    const box = await bubble.boundingBox();
    const viewport = await pet.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (figure === null || box === null) throw new Error('the drawing or the bubble has no box');
    expect(box.y + box.height).toBeLessThanOrEqual(figure.y + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.width).toBeLessThanOrEqual(300);
    expect(box.x + box.width).toBeCloseTo(figure.x + figure.width, 0);

    // It is the bubble that is clickable: moving the mouse over it turns the window interactive.
    await pet.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(root()).toHaveAttribute('data-interactive', 'true');
    await pet.mouse.move(4, 4);
    await expect(root()).toHaveAttribute('data-interactive', 'false');

    // After about 6 s the bubble goes and the face goes back to what the sessions ask for: still impatient.
    await expect(root()).not.toHaveAttribute('data-bubble', { timeout: 10_000 });
    await expect(pet.getByTestId('pet-bubble')).toHaveCount(0);
    await expect(root()).toHaveAttribute('data-pose', 'impatient');
    await expect(root()).toHaveAttribute('data-badge', '1');

    // Clean up: the owner opens `atlas`, which was the one waiting.
    await lookAt('atlas');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });

  test('#109 - background sub-agents that wake the session give no notice each: only the turn that ends with none alive is "terminou" @pet', async () => {
    test.setTimeout(180_000);
    await ensureSession('atlas');
    await ensureSession('beacon');

    await tabNamed('atlas').click();
    await sendPrompt('agentes');
    await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });
    await tabNamed('beacon').click();
    await setDonelWindow('minimized');

    // Every time a wait is born out of sight the badge appears: count the births, from here to the end of the turn.
    await expect(root()).not.toHaveAttribute('data-badge');
    await pet.evaluate(() => {
      const el = document.querySelector('[data-testid="pet-root"]');
      if (el === null) throw new Error('no pet root');
      const counter = window as unknown as { __badgeBirths: number };
      counter.__badgeBirths = 0;
      let had = el.hasAttribute('data-badge');
      new MutationObserver(() => {
        const has = el.hasAttribute('data-badge');
        if (has && !had) counter.__badgeBirths += 1;
        had = has;
      }).observe(el, { attributes: true, attributeFilter: ['data-badge'] });
    });

    // The scenario ends its turn three times, 3.5 s apart, working in between (the woken session and the agents use
    // tools). The bubble only comes for the last one: sub-agents done, session stopped. Waiting past the length of the
    // whole turn after the bubble proves no other wait was born (before the fix, the first `Stop` already gave one,
    // and each later one gave another).
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · terminou', { timeout: 60_000 });
    await pet.waitForTimeout(9_000);
    await expect(root()).toHaveAttribute('data-badge', '1');
    expect(await pet.evaluate(() => (window as unknown as { __badgeBirths: number }).__badgeBirths)).toBe(1);

    // Clean up: the owner opens `atlas`, which was the one waiting.
    await lookAt('atlas');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });

  test('T035 - with the Jobu on the Windows does not repeat the notice; with him hidden it is back (FR-020, SC-004) @pet', async () => {
    test.setTimeout(240_000);
    await ensureSession('atlas');
    await ensureSession('beacon');
    // The toast of the renderer, recorded instead of shown: a stand-in for `Notification` that keeps what it was asked.
    await main.evaluate(() => {
      const toasts: { title: string; body: string | undefined }[] = [];
      const holder = window as unknown as { __toasts: typeof toasts; Notification: unknown };
      holder.__toasts = toasts;
      holder.Notification = class {
        onclick: (() => void) | null = null;
        constructor(title: string, options?: { body?: string }) {
          toasts.push({ title, body: options?.body });
        }
      };
    });
    const toasts = (): Promise<{ title: string; body: string | undefined }[]> => main.evaluate(() => (window as unknown as { __toasts: { title: string; body: string | undefined }[] }).__toasts);

    // With the Jobu on: the turn of `atlas` ends out of sight, the bubble says so, and no toast was raised.
    await tabNamed('atlas').click();
    await sendPrompt('rapido');
    await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });
    await tabNamed('beacon').click();
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · terminou', { timeout: 40_000 });
    await pet.waitForTimeout(1_500);
    expect(await toasts()).toEqual([]);
    await lookAt('atlas');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });

    // With him hidden (the same path the Preferences and "Esconder" take) the same turn raises the toast.
    await setPetEnabled(false);
    await sendPrompt('rapido');
    await tabNamed('beacon').click();
    await expect.poll(async () => (await toasts()).length, { timeout: 40_000, message: 'the toast did not come back with the Jobu hidden' }).toBe(1);
    expect(await toasts()).toEqual([{ title: 'Aguardando sua resposta', body: 'Sessão "atlas" terminou o turno.' }]);

    // And on again: he comes back with the state of the sessions as it is (`atlas` still waits, unseen).
    await setPetEnabled(true);
    await expect(root()).toHaveAttribute('data-badge', '1', { timeout: 10_000 });
    await lookAt('atlas');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });

  test('T041 - a click on the drawing, with one session waiting, brings the Donel back to the front on its tab @pet', async () => {
    test.setTimeout(180_000);
    await ensureSession('atlas');
    await ensureSession('beacon');

    // `atlas` ends a turn out of sight with the Donel minimized: exactly one waiting, and a bubble about it.
    await tabNamed('atlas').click();
    await sendPrompt('rapido');
    await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });
    await tabNamed('beacon').click();
    await setDonelWindow('minimized');
    await expect(root()).toHaveAttribute('data-badge', '1', { timeout: 40_000 });
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · terminou');
    expect(await donelWindowState()).toMatchObject({ minimized: true });

    await clickTheJobu();

    // The Donel is back (restored, visible) and the tab in front is the one that waited (FR-022). The click also
    // dismisses the bubble: it has served.
    await expect.poll(async () => (await donelWindowState()).minimized, { timeout: 10_000, message: 'the Donel stayed minimized' }).toBe(false);
    expect(await donelWindowState()).toMatchObject({ visible: true });
    await expect(tabNamed('atlas')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    await expect(root()).not.toHaveAttribute('data-bubble', { timeout: 5_000 });

    // Whether the OS gave the focus is its decision (the foreground lock): it is recorded, and the owner looks at the tab.
    test.info().annotations.push({ type: 'donel-focused-after-click', description: String((await donelWindowState()).focused) });
    await lookAt('atlas');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });

  test('T041 - with two waiting a click opens the list (the oldest on top); Esc or another window taking the focus closes it; a click on the second item brings its tab @pet', async () => {
    test.setTimeout(240_000);
    await ensureSession('atlas');
    await ensureSession('beacon');
    await ensureSession('vega');

    // `atlas` and then `beacon` end a turn out of sight; the owner is on `vega`, with the Donel minimized.
    await tabNamed('atlas').click();
    await sendPrompt('rapido');
    await main.waitForTimeout(1_200);
    await tabNamed('beacon').click();
    await sendPrompt('rapido');
    await main.waitForTimeout(1_200);
    await tabNamed('vega').click();
    await setDonelWindow('minimized');
    await expect(root()).toHaveAttribute('data-badge', '2', { timeout: 40_000 });
    await expect(root()).toHaveAttribute('data-list', 'closed');

    // One click opens the list, and nothing is brought to the front: the list belongs to the screen (FR-023).
    await clickTheJobu();
    const list = pet.getByTestId('pet-list');
    await expect(list).toBeVisible();
    await expect(root()).toHaveAttribute('data-list', 'open');
    expect((await donelWindowState()).minimized).toBe(true);
    const items = pet.getByTestId('pet-list-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('atlas'); // the oldest wait on top
    await expect(items.nth(1)).toContainText('beacon');
    await expect(items.nth(0)).toContainText(/agora|há \d+ min/);

    // It sits above the drawing, inside the window, anchored to its right edge, and it is something the mouse can take.
    const figure = await pet.getByTestId('pet-figure').boundingBox();
    const box = await list.boundingBox();
    const viewport = await pet.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (figure === null || box === null) throw new Error('the drawing or the list has no box');
    expect(box.y + box.height).toBeLessThanOrEqual(figure.y + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.x + box.width).toBeCloseTo(figure.x + figure.width, 0);
    await pet.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(root()).toHaveAttribute('data-interactive', 'true');

    // Esc closes it and does nothing else.
    await pet.keyboard.press('Escape');
    await expect(root()).toHaveAttribute('data-list', 'closed');
    await expect(list).toHaveCount(0);
    expect((await donelWindowState()).minimized).toBe(true);
    await expect(tabNamed('vega')).toHaveAttribute('aria-selected', 'true');

    // Clicking the Jobu again opens it, and the Jobu toggles it shut.
    await clickTheJobu();
    await expect(root()).toHaveAttribute('data-list', 'open');
    await clickTheJobu();
    await expect(root()).toHaveAttribute('data-list', 'closed');
    await clickTheJobu();
    await expect(root()).toHaveAttribute('data-list', 'open');

    // Another window of the app taking the focus stands for "a click anywhere else": it closes the list too, and
    // does nothing else (the tab in front stays `vega`). The page itself hears nothing of it (no DOM `blur`), so
    // this is the main telling the screen (`pet:close-list`, from the `blur` of the window). The ghost never takes
    // the focus (it would swallow the typing of whoever is using the machine), so there is no OS focus to lose: the
    // test emits the `blur` of the pet window itself, which is the very event the OS would have raised.
    await setDonelWindow('focused');
    await emitPetBlur();
    await expect(root()).toHaveAttribute('data-list', 'closed', { timeout: 5_000 });
    await expect(list).toHaveCount(0);
    await expect(tabNamed('vega')).toHaveAttribute('aria-selected', 'true');
    await setDonelWindow('minimized');
    await clickTheJobu();
    await expect(root()).toHaveAttribute('data-list', 'open');

    // The second item leads to ITS tab (FR-023), and the list goes.
    await items.nth(1).click();
    await expect.poll(async () => (await donelWindowState()).minimized, { timeout: 10_000, message: 'the Donel stayed minimized' }).toBe(false);
    await expect(tabNamed('beacon')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    await expect(root()).toHaveAttribute('data-list', 'closed');

    // Clean up: the owner opens both.
    await lookAt('atlas');
    await lookAt('beacon');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });

  test('T041 - opening another waiting session from the list does not mark the active waiting tab as seen (S1) @pet', async () => {
    test.setTimeout(240_000);
    await ensureSession('atlas');
    await ensureSession('beacon');

    // `atlas` ends a turn out of sight; then `beacon` ends one too and stays the ACTIVE tab, with the Donel minimized:
    // two are owed, and the one in front is itself waiting (so the old active tab is a session that can be wrongly "seen").
    await tabNamed('atlas').click();
    await sendPrompt('rapido');
    await main.waitForTimeout(1_200);
    await tabNamed('beacon').click();
    await sendPrompt('rapido');
    await main.waitForTimeout(1_200);
    await setDonelWindow('minimized');
    await expect(root()).toHaveAttribute('data-badge', '2', { timeout: 40_000 });

    await clickTheJobu();
    const items = pet.getByTestId('pet-list-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('atlas');
    await items.nth(0).click();

    // `atlas` is in front and seen; `beacon`, the old active tab, still owes the owner a look. Raising the window
    // must not have counted it as visited.
    await expect.poll(async () => (await donelWindowState()).minimized, { timeout: 10_000, message: 'the Donel stayed minimized' }).toBe(false);
    await expect(tabNamed('atlas')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    await main.waitForTimeout(1_500);
    await expect(root()).toHaveAttribute('data-badge', '1');

    // Clean up.
    await lookAt('beacon');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });

  test('T035 - a session that ends by itself: the bubble "vega · encerrou", sad, and a click on it leads to the tab that ended @pet', async () => {
    test.setTimeout(120_000);
    await ensureSession('vega');
    await ensureSession('beacon');

    // The terminal of `vega` has the keyboard, then the Donel is minimized: the owner is not looking, and keys
    // still reach the page through the debugger. `/exit` makes the fake end its process by itself (no tab is closed).
    await tabNamed('vega').click();
    const pane = main.locator('[data-testid="terminal-pane"]:visible');
    await expect(async () => {
      expect(await pane.innerText()).toContain('shortcuts');
    }).toPass({ timeout: 30_000 });
    await pane.click();
    await setDonelWindow('minimized');
    await main.keyboard.type('/exit');
    // The slash menu of the fake is still drawing for a moment, and an Enter that lands on it only completes the
    // command: let it settle, send, and if the process is still there a second later send once more (a dead
    // terminal ignores it).
    await main.waitForTimeout(400);
    await main.keyboard.press('Enter');
    await main.waitForTimeout(1_500);
    if ((await root().getAttribute('data-bubble')) === null) await main.keyboard.press('Enter');

    await expect(root()).toHaveAttribute('data-bubble', 'vega · encerrou', { timeout: 20_000 });
    await expect(root()).toHaveAttribute('data-pose', 'sad');
    await expect(root()).toHaveAttribute('data-art', 'sad');
    await expect(root()).not.toHaveAttribute('data-badge'); // nothing is owed to a process that is gone

    // Clicking the bubble leads to the tab of the session that ended: the one in front was `vega`'s own, so the
    // owner moves first, to be sure that it is the click that brings it back.
    await tabNamed('beacon').click();
    await expect(tabNamed('beacon')).toHaveAttribute('aria-selected', 'true');
    await pet.getByTestId('pet-bubble').click();
    await expect.poll(async () => (await donelWindowState()).minimized, { timeout: 10_000, message: 'the Donel stayed minimized' }).toBe(false);
    await expect(tabNamed('vega')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    await expect(root()).not.toHaveAttribute('data-bubble', { timeout: 5_000 });
  });

  test('T047 - "Silenciar por 1 hora": nenhum balão nasce, o rosto e o selo seguem mudando, e o menu passa a oferecer "Retomar avisos" (US5, FR-026, FR-027) @pet', async () => {
    test.setTimeout(240_000);
    await ensureSession('atlas');
    await ensureSession('beacon');

    // The menu offers to silence, and the choice shows on the screen.
    expect(menuLabels(await openMenu())[0]).toBe('Silenciar por 1 hora');
    await expect(root()).toHaveAttribute('data-silenced', 'false');
    await chooseFromMenu({ kind: 'silence' });
    await expect(root()).toHaveAttribute('data-silenced', 'true');
    expect(menuLabels(await openMenu())[0]).toBe('Retomar avisos');

    // A turn that ends out of the owner's sight: no bubble, but the face and the badge change all the same.
    await tabNamed('atlas').click();
    await sendPrompt('rapido');
    await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });
    await tabNamed('beacon').click();
    await setDonelWindow('minimized');
    await expect(root()).toHaveAttribute('data-badge', '1', { timeout: 40_000 });
    await expect(root()).toHaveAttribute('data-pose', 'impatient');
    await pet.waitForTimeout(1_500);
    await expect(root()).not.toHaveAttribute('data-bubble');
    await expect(pet.getByTestId('pet-bubble')).toHaveCount(0);

    // "Retomar avisos" lifts it at once, and the screen says so.
    await openMenu();
    await chooseFromMenu({ kind: 'resume' });
    await expect(root()).toHaveAttribute('data-silenced', 'false');
    expect(menuLabels(await openMenu())[0]).toBe('Silenciar por 1 hora');

    // Clean up: the owner opens `atlas`, which was the one waiting.
    await lookAt('atlas');
    await expect(root()).not.toHaveAttribute('data-badge', { timeout: 10_000 });
  });
});

// With the chat on a pending is real: the semaphore turns `permission` and the hub then says what it is, and
// the main would raise a Windows notification for it (the stub `DONEL_SMOKE_NOTIFICATIONS_LOG` records it).
const CHAT_SCENARIO = {
  turns: [
    {
      match: 'permitir',
      steps: [
        { type: 'wait', ms: 4000 },
        { type: 'bash_permission', command: 'echo SEGREDO-JOBU', result: 'ok' },
        { type: 'assistant', text: 'Feito.' },
        { type: 'hook', event: 'Stop' },
      ],
    },
    {
      match: 'pergunta',
      steps: [
        { type: 'wait', ms: 4000 },
        { type: 'ask', questions: [{ question: 'Which db?', header: 'DB', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false }] },
        { type: 'assistant', text: 'Resposta recebida.' },
        { type: 'hook', event: 'Stop' },
      ],
    },
    {
      match: 'aprovar',
      steps: [
        { type: 'wait', ms: 4000 },
        { type: 'plan', plan: '# Plano\n- passo um\n- passo dois', planFilePath: 'C:/x/plan.md' },
        { type: 'assistant', text: 'Executando o plano.' },
        { type: 'hook', event: 'Stop' },
      ],
    },
  ],
};

test.describe('o Jobu com o chat ligado', () => {
  let chat: ChatApp;
  let tmp: string;
  let notificationsLog: string;

  const readNotifications = (): { title: string; body: string }[] => {
    if (!existsSync(notificationsLog)) return [];
    return readFileSync(notificationsLog, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { title: string; body: string });
  };

  test.beforeAll(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'donel-pet-chat-'));
    notificationsLog = path.join(tmp, 'notifications.log');
    const scenarioFile = path.join(tmp, 'scenario.json');
    writeFileSync(scenarioFile, JSON.stringify(CHAT_SCENARIO), 'utf8');
    chat = await launchChatApp({
      name: 'pet-chat',
      scenario: scenarioFile,
      config: { pet: { enabled: true, placement: null, size: 140 } },
      env: { DONEL_SMOKE_NOTIFICATIONS_LOG: notificationsLog, ...GHOST_ENV },
    });
    launched = chat;
    main = chat.window;
    pet = await findPetWindow(chat.app);
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    try {
      await chat?.dispose();
    } finally {
      removeTempDir(tmp);
    }
  });

  test('T035 - with the chat on, a permission gets its bubble and no Windows notice while the Jobu is on; hidden, the notice is back @pet', async () => {
    test.setTimeout(300_000);
    const composer = (): Locator => main.locator('[data-testid="chat-composer-input"]:visible');
    const send = async (text: string): Promise<void> => {
      // The previous round must be over, or the message would only be queued.
      await expect
        .poll(() => main.evaluate(() => document.querySelector('[data-testid="working-footer"]')?.getAttribute('data-state') === 'working'), { timeout: 30_000 })
        .toBe(false);
      await composer().fill(text);
      await composer().press('Enter');
    };

    // `atlas` is the session; a free terminal is the "other tab" where the owner is, so `atlas` is out of sight.
    await launchClaudeTab(main, { name: 'atlas' });
    await expect(main.locator('[data-testid="chat-view"]:visible')).toBeVisible({ timeout: 20_000 });
    await expect(composer()).toBeVisible({ timeout: 20_000 });
    const atlas = tabNamed('atlas');
    await openFreeTerminalTab(main);
    const elsewhere = main.locator('[role="tab"]').last();
    await atlas.click();
    await expect(composer()).toBeVisible({ timeout: 20_000 });
    const answerAllow = async (): Promise<void> => {
      await atlas.click();
      await expect(main.getByTestId('pending-permission')).toBeVisible({ timeout: 15_000 });
      await main.getByTestId('pending-allow').click();
      await expect(main.locator('[data-testid="pending-panel"]:visible')).toHaveCount(0, { timeout: 15_000 });
    };

    // 1. A permission, the Jobu on: the bubble of FR-015, the surprised pose, and not one Windows notification.
    await send('permitir isso');
    await elsewhere.click();
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · quer permissão', { timeout: 40_000 });
    await expect(root()).toHaveAttribute('data-pose', 'surprised');
    await pet.waitForTimeout(1_500);
    expect(readNotifications()).toEqual([]);
    await answerAllow();

    // 2. A question: the semaphore says `permission` first and the chat then says what it is: the same
    //    bubble, refined (R3). Still no Windows notification.
    await send('pergunta sobre o banco');
    await elsewhere.click();
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · tem uma pergunta', { timeout: 40_000 });
    await pet.waitForTimeout(1_500);
    expect(readNotifications()).toEqual([]);
    await atlas.click();
    await expect(main.getByTestId('pending-question')).toBeVisible({ timeout: 15_000 });
    await main.getByTestId('pending-option').filter({ hasText: 'SQLite' }).click();
    await main.getByTestId('pending-answer').click();
    await expect(main.locator('[data-testid="pending-panel"]:visible')).toHaveCount(0, { timeout: 15_000 });

    // 3. A plan: the same refinement, into "plano para aprovar".
    await send('aprovar o plano');
    await elsewhere.click();
    await expect(root()).toHaveAttribute('data-bubble', 'atlas · plano para aprovar', { timeout: 40_000 });
    await pet.waitForTimeout(1_500);
    expect(readNotifications()).toEqual([]);
    await atlas.click();
    await expect(main.getByTestId('pending-plan')).toBeVisible({ timeout: 15_000 });
    await main.getByTestId('pending-plan-approve').click();
    await expect(main.locator('[data-testid="pending-panel"]:visible')).toHaveCount(0, { timeout: 15_000 });

    // 4. The Jobu hidden. With `atlas` in front and the Donel focused the owner is looking at it: no notification
    //    (C2: the focus state speaks in ptyIds, so the main finds that the tab in front is the one of the pending).
    await setPetEnabled(false);
    await lookAt('atlas');
    await send('permitir olhando');
    await expect(main.getByTestId('pending-permission')).toBeVisible({ timeout: 40_000 });
    await main.waitForTimeout(1_500);
    expect(readNotifications()).toEqual([]);
    await main.getByTestId('pending-allow').click();
    await expect(main.locator('[data-testid="pending-panel"]:visible')).toHaveCount(0, { timeout: 15_000 });

    // ...and the very same permission with the owner elsewhere raises it again, titled with the name of the tab
    // (not "Donel Dev") and without the command in it.
    await send('permitir de novo');
    await elsewhere.click();
    await expect.poll(() => readNotifications().length, { timeout: 40_000, message: 'the Windows notice did not come back with the Jobu hidden' }).toBe(1);
    const [notice] = readNotifications();
    expect(notice?.title).toBe('atlas');
    expect(notice?.body).toBe(NOTIFICATION_BODY);
    expect(JSON.stringify(notice)).not.toContain('SEGREDO-JOBU');
    await answerAllow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// US4 (T044): a change of account, in the mirror
// ---------------------------------------------------------------------------------------------------------------

// The same fake mod as the smokes of the accounts (`DONEL_ACCOUNTS_FAKE_MOD_FIXTURE`): everything in memory, no network,
// no vault, but through the SAME engine and the same `claude-state.ts` as the real path. The `claudeHome` of the test is
// a temp folder and NEVER the real `~/.claude`: a switch rewrites `.credentials.json` and drops `oauthAccount` there,
// and a past run of the accounts smoke was one edit away from erasing the real login (the guard below refuses it).
const ACCOUNTS_FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/accounts-fake-mod.json');

test.describe('o Jobu e a troca de conta', () => {
  test.describe.configure({ mode: 'serial' });
  let claudeHomeParent: string;

  test.beforeAll(async () => {
    const userDataDir = createIsolatedUserDataDir('pet-account');
    writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ pet: { enabled: true, placement: null, size: 140 } }), 'utf8');
    claudeHomeParent = mkdtempSync(path.join(tmpdir(), 'donel-pet-account-claude-'));
    const claudeHomeDir = path.join(claudeHomeParent, '.claude');
    refuseIfRealClaudeHome(claudeHomeDir);
    mkdirSync(claudeHomeParent, { recursive: true });
    writeFileSync(path.join(claudeHomeParent, '.claude.json'), JSON.stringify({ oauthAccount: { seeded: true }, machineID: 'pet-smoke-machine' }), 'utf8');
    launched = await launchIsolatedApp({ userDataDir, env: { ...process.env, DONEL_ACCOUNTS_FAKE_MOD_FIXTURE: ACCOUNTS_FIXTURE, ...GHOST_ENV } });
    main = launched.window;
    pet = await findPetWindow(launched.app);
    await main.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    try {
      await closeIsolatedApp(launched);
    } finally {
      removeTempDir(claudeHomeParent);
    }
  });

  test('T044 - trocar de conta: o Jobu olha o espelho e mostra "Conta → <rótulo>", sem e-mail nem id, e o clique no balão traz o Donel; a primeira conta ativa não é troca @pet', async () => {
    test.setTimeout(120_000);
    const connected = await main.evaluate(() =>
      window.donel.accounts.connectMod({ mod: 'local', label: 'Conta de teste', accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3_600_000 }),
    );
    expect(connected.kind).toBe('connected');

    // From no account to one is an activation, not a switch: the same rule as the notice of the chat. No bubble.
    const first = await main.evaluate(() => window.donel.accounts.switch('acc-alfa'));
    expect(first).toMatchObject({ kind: 'switched', to: 'acc-alfa' });
    await pet.waitForTimeout(1_500);
    await expect(root()).not.toHaveAttribute('data-bubble');
    await expect(root()).toHaveAttribute('data-pose', 'sleeping');

    // Alfa -> Beta: the mirror, and the label of the account that is in use now.
    const second = await main.evaluate(() => window.donel.accounts.switch('acc-beta'));
    expect(second).toMatchObject({ kind: 'switched', from: 'acc-alfa', to: 'acc-beta' });
    await expect(root()).toHaveAttribute('data-bubble', 'Conta → Conta Beta', { timeout: 10_000 });
    await expect(root()).toHaveAttribute('data-pose', 'mirror');
    await expect(root()).toHaveAttribute('data-art', 'mirror');
    const bubble = pet.getByTestId('pet-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveText('Conta → Conta Beta');
    await expect(bubble).toHaveAttribute('data-pose', 'mirror');
    // FR-018: a label, never an e-mail or the id of the account.
    expect(await bubble.innerText()).not.toMatch(/@|acc-/);
    const firstId = await bubble.getAttribute('data-bubble-id');

    // It goes after about 6 s, and with no session the face goes back to sleep.
    await expect(root()).not.toHaveAttribute('data-bubble', { timeout: 12_000 });
    await expect(root()).toHaveAttribute('data-pose', 'sleeping');

    // Another switch is another bubble, with its own id (the screen hops once per bubble).
    const third = await main.evaluate(() => window.donel.accounts.switch('acc-alfa'));
    expect(third).toMatchObject({ kind: 'switched', from: 'acc-beta', to: 'acc-alfa' });
    await expect(root()).toHaveAttribute('data-bubble', 'Conta → Conta Alfa', { timeout: 10_000 });
    expect(await pet.getByTestId('pet-bubble').getAttribute('data-bubble-id')).not.toBe(firstId);

    // A click on the account bubble brings the Donel to the front (FR-025) and activates no tab: there is none.
    await setDonelWindow('minimized');
    expect((await donelWindowState()).minimized).toBe(true);
    await pet.getByTestId('pet-bubble').click();
    await expect.poll(async () => (await donelWindowState()).minimized, { timeout: 10_000, message: 'the Donel stayed minimized' }).toBe(false);
    await expect(root()).not.toHaveAttribute('data-bubble', { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// US5 (T046-T051, T060-T062): the gestures, the menu, the size, the capture, the full screen, hiding and remembering
// ---------------------------------------------------------------------------------------------------------------

test.describe('o Jobu e os gestos', () => {
  test.describe.configure({ mode: 'serial' });
  let userDataDir: string;

  /** The app of this block, with the Jobu on in the default corner at the default size. */
  async function launchGestureApp(): Promise<void> {
    launched = await launchIsolatedApp({ userDataDir, env: { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO, ...GHOST_ENV } });
    main = launched.window;
    pet = await findPetWindow(launched.app);
  }

  test.beforeAll(async () => {
    userDataDir = createIsolatedUserDataDir('pet-gestures');
    writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ pet: { enabled: true, placement: null, size: 140 }, projectRoots: [path.dirname(REPO_ROOT)] }), 'utf8');
    await launchGestureApp();
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    await closeIsolatedApp(launched);
  });

  test('T047 - o menu do botão direito: Silenciar, Liberar print, Fazer faxina, Tamanho com a marca no atual, e "Voltar ao canto" e "Esconder" @pet', async () => {
    test.setTimeout(60_000);
    const entries = await openMenu();
    expect(menuLabels(entries)).toEqual(['Silenciar por 1 hora', 'Liberar print por 1 minuto', 'Fazer faxina', 'Tamanho', '---', 'Voltar ao canto', 'Esconder']);
    const size = entries.find((entry) => entry.type === 'submenu');
    expect(size?.items?.map((item) => item.label)).toEqual(['Pequeno', 'Médio', 'Grande', 'Muito grande']);
    expect(size?.items?.filter((item) => item.checked).map((item) => item.label)).toEqual(['Médio']); // 140 is the medium one

    // The menu follows the state: after "Liberar print" the same place offers "Bloquear print agora" (and then goes back).
    await chooseFromMenu({ kind: 'releaseCapture' });
    expect(menuLabels(await openMenu())[1]).toBe('Bloquear print agora');
    await chooseFromMenu({ kind: 'blockCapture' });
    expect(menuLabels(await openMenu())[1]).toBe('Liberar print por 1 minuto');
  });

  test('T062 - fora das capturas de tela (FR-034, FR-035): 0x11 de nascença, 0x0 ao liberar o print, 0x11 ao bloquear @pet', async () => {
    test.setTimeout(120_000);
    // Windows 11, Electron 43: `setContentProtection(true)` is WDA_EXCLUDEFROMCAPTURE (0x11) once the window is shown.
    expect(await petDisplayAffinity()).toBe(0x11);

    await openMenu();
    await chooseFromMenu({ kind: 'releaseCapture' });
    await expect.poll(petDisplayAffinity, { timeout: 15_000, message: 'a capture still could not see the Jobu after "Liberar print"' }).toBe(0x0);

    await openMenu();
    await chooseFromMenu({ kind: 'blockCapture' });
    await expect.poll(petDisplayAffinity, { timeout: 15_000, message: 'the Jobu stayed in the captures after "Bloquear print agora"' }).toBe(0x11);
  });

  test('T050 - um app toma a tela inteira: o Jobu esconde e volta quando a tela é devolvida (a verificação com tela cheia real é da bateria do dono) @pet', async () => {
    test.setTimeout(60_000);
    // The full-screen watcher is a real PowerShell that is polling the real Windows here; the hook of the ghost makes
    // the service hear what the watcher would say when an app takes the screen. No video or slideshow is opened.
    const setFullscreen = (active: boolean): Promise<void> =>
      launched.app.evaluate((_electron, value) => {
        (globalThis as GhostGlobal).__donelPetSmoke?.setFullscreen?.(value);
      }, active);
    await setFullscreen(true);
    await expect.poll(petWindowVisible, { timeout: 10_000, message: 'the Jobu stayed on screen with an app in full screen' }).toBe(false);
    await setFullscreen(false);
    await expect.poll(petWindowVisible, { timeout: 10_000, message: 'the Jobu did not come back when the screen was given back' }).toBe(true);
    // The whole state stayed: it is the same screen, asleep.
    await expect(root()).toHaveAttribute('data-pose', 'sleeping');
  });

  test('T046 - arrastar: a janela segue o ponteiro, solta perto da barra encaixa, solta no ar esmaece a base, e o lugar fica gravado @pet', async () => {
    test.setTimeout(180_000);
    const work = await primaryWorkArea();
    const edge = work.y + work.height; // the taskbar edge: where the base of the drawing sits when docked

    // Born in the corner: sitting on the edge, the base not faded.
    await expect(root()).toHaveAttribute('data-docked', 'true');
    const home = await petAnchor();
    expect(Math.abs(home.y - edge)).toBeLessThanOrEqual(1);

    // A drag well above the taskbar: it floats where it was let go, and the base fades.
    await dragJobuBy(-300, -200);
    const floating = await petAnchor();
    expect(Math.abs(floating.x - (home.x - 300))).toBeLessThanOrEqual(1);
    expect(Math.abs(floating.y - (home.y - 200))).toBeLessThanOrEqual(1);
    await expect(root()).toHaveAttribute('data-docked', 'false');
    await expect(root()).toHaveAttribute('data-align', 'center');
    // The size of the window did not drift on the way (on a scaled screen a `setPosition` makes it grow, by hundreds of
    // pixels over a drag). A pixel of difference is only the rounding between physical pixels and DIP (at 125% a window of
    // 480 DIP can read 481 at some positions).
    const afterFloat = await petBounds();
    expect(Math.abs(afterFloat.width - petWindowWidth(140))).toBeLessThanOrEqual(1);
    expect(Math.abs(afterFloat.height - (140 + 200))).toBeLessThanOrEqual(1);
    // The place is written down, as the base of the drawing.
    const saved = await main.evaluate(() => window.donel.config.get().then((config) => config.pet.placement));
    expect(saved).not.toBeNull();
    expect(Math.abs((saved?.x ?? 0) - floating.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((saved?.y ?? 0) - floating.y)).toBeLessThanOrEqual(1);

    // Let go 10 px above the edge: it snaps onto it and sits there again.
    await dragJobuBy(0, edge - 10 - floating.y);
    await expect(root()).toHaveAttribute('data-docked', 'true', { timeout: 10_000 });
    const snapped = await petAnchor();
    expect(Math.abs(snapped.y - edge)).toBeLessThanOrEqual(1);
    expect(Math.abs(snapped.x - floating.x)).toBeLessThanOrEqual(1);

    // A drop far outside every screen is refused: he goes back to where the drag began, and nothing is written.
    const before = await petAnchor();
    const savedBefore = await main.evaluate(() => window.donel.config.get().then((config) => config.pet.placement));
    await dragJobuBy(4_000, 0);
    await expect.poll(async () => Math.abs((await petAnchor()).x - before.x) <= 1, { timeout: 10_000, message: 'the Jobu did not come back from a drop outside the screens' }).toBe(true);
    expect(Math.abs((await petAnchor()).y - before.y)).toBeLessThanOrEqual(1);
    expect(await main.evaluate(() => window.donel.config.get().then((config) => config.pet.placement))).toEqual(savedBefore);

    // A click is not a drag: under 4 px nothing moves (the page asks the main for nothing).
    const still = await petBounds();
    const chest = await chestPoint();
    await pet.mouse.move(chest.x, chest.y);
    await expect(root()).toHaveAttribute('data-interactive', 'true');
    await pet.mouse.down();
    await pet.mouse.move(chest.x + 2, chest.y + 1);
    await pet.mouse.move(chest.x, chest.y);
    await pet.mouse.up();
    expect(await petBounds()).toEqual(still);
    await expect(root()).toHaveAttribute('data-dragging', 'false');
  });

  test('T048 - redimensionar: Ctrl + roda dá passos de 10, o menu dá os tamanhos, a base não sai do lugar e o desenho continua clicável @pet', async () => {
    test.setTimeout(120_000);
    const anchor = await petAnchor();
    await expect(root()).toHaveAttribute('data-size', '140');

    // Ctrl + wheel over the Jobu: one notch up is +10 and one down is -10.
    await wheelOverJobu(1);
    await expect(root()).toHaveAttribute('data-size', '150', { timeout: 10_000 });
    await wheelOverJobu(-1);
    await wheelOverJobu(-1);
    await expect(root()).toHaveAttribute('data-size', '130', { timeout: 10_000 });

    // The base of the drawing stayed exactly where it was, and the window is the one of that size.
    const afterWheel = await petAnchor();
    expect(Math.abs(afterWheel.x - anchor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterWheel.y - anchor.y)).toBeLessThanOrEqual(1);
    const bounds = await petBounds();
    expect(Math.abs(bounds.width - petWindowWidth(130))).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.height - (130 + 200))).toBeLessThanOrEqual(1);

    // A preset of the menu: "Grande" is 200, marked in the menu from then on, and the base is still there.
    await openMenu();
    await chooseFromMenu({ kind: 'size', size: 200 });
    await expect(root()).toHaveAttribute('data-size', '200', { timeout: 10_000 });
    const entries = await openMenu();
    expect(entries.find((entry) => entry.type === 'submenu')?.items?.filter((item) => item.checked).map((item) => item.label)).toEqual(['Grande']);
    const afterPreset = await petAnchor();
    expect(Math.abs(afterPreset.x - anchor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterPreset.y - anchor.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await petBounds()).width - petWindowWidth(200))).toBeLessThanOrEqual(1);

    // The drawing is as tall as the size says, still sits on the base of the window, and is still something the mouse takes.
    const figure = await pet.getByTestId('pet-figure').boundingBox();
    const viewport = await pet.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (figure === null) throw new Error('the drawing has no box');
    expect(figure.height).toBeCloseTo(200, 1);
    expect(figure.y + figure.height - viewport.height).toBeCloseTo((200 * 8) / 320, 1);
    await pet.mouse.move(4, 4);
    await expect(root()).toHaveAttribute('data-interactive', 'false');
    const chest = await chestPoint();
    await pet.mouse.move(chest.x, chest.y);
    await expect(root()).toHaveAttribute('data-interactive', 'true');

    // The limits: it stops at 320 and at 80 and writes nothing beyond them.
    await openMenu();
    await chooseFromMenu({ kind: 'size', size: 320 });
    await expect(root()).toHaveAttribute('data-size', '320', { timeout: 10_000 });
    await wheelOverJobu(1);
    await pet.waitForTimeout(500);
    await expect(root()).toHaveAttribute('data-size', '320');
    await openMenu();
    await chooseFromMenu({ kind: 'size', size: 140 });
    await expect(root()).toHaveAttribute('data-size', '140', { timeout: 10_000 });
    expect(await main.evaluate(() => window.donel.config.get().then((config) => config.pet.size))).toBe(140);
  });

  test('T051 - Esconder: a janela fecha, o interruptor das Preferências fica desligado, o auxiliar de tela cheia morre; religar traz tudo de volta @pet', async () => {
    test.setTimeout(180_000);
    // The helper of full screen is alive while the pet is on, and it is exactly one.
    const watchers = [...watcherPids()];
    expect(watchers.length).toBeGreaterThanOrEqual(1);

    await openMenu();
    await chooseFromMenu({ kind: 'hide' });
    await expect
      .poll(() => launched.app.windows().some((page) => page.url().endsWith('#pet')), { timeout: 10_000, message: 'the pet window did not close on "Esconder"' })
      .toBe(false);
    // The helper does not outlive the window.
    await waitForPidsGone('powershell.exe', watchers, 20_000, WATCHER_COMMAND_PREFIX);
    expect(await main.evaluate(() => window.donel.config.get().then((config) => config.pet.enabled))).toBe(false);

    // The Preferences say it is off, and turning it on there brings him back, in the place and at the size he had.
    const toggle = await openPetToggle();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    pet = await findPetWindow(launched.app);
    await expect(root()).toHaveAttribute('data-size', '140');
    await main.keyboard.press('Escape');

    // ...with a new helper, which is again exactly what is needed.
    await expect.poll(() => watcherPids().size, { timeout: 25_000, message: 'the full-screen helper did not come back with the Jobu' }).toBeGreaterThanOrEqual(1);
  });

  test('T051 - o lugar e o tamanho ficam lembrados: reabrir o Donel põe o Jobu onde o dono o deixou; fechar o Donel leva o Jobu e o auxiliar junto @pet', async () => {
    test.setTimeout(240_000);
    // Put him somewhere on purpose, at a size that is no preset.
    await dragJobuBy(-200, -120);
    await wheelOverJobu(1);
    await expect(root()).toHaveAttribute('data-size', '150', { timeout: 10_000 });
    const anchor = await petAnchor();
    const size = await root().getAttribute('data-size');

    // Close the Donel (the userData stays) and open it again: the Jobu is where he was left, of the size he had.
    const watchersBefore = [...watcherPids()];
    await closeIsolatedApp(launched, false);
    await waitForPidsGone('powershell.exe', watchersBefore, 20_000, WATCHER_COMMAND_PREFIX); // the helper left with the app
    await launchGestureApp();
    await expect(root()).toHaveAttribute('data-size', size ?? '150');
    const again = await petAnchor();
    expect(Math.abs(again.x - anchor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(again.y - anchor.y)).toBeLessThanOrEqual(1);
    await expect(root()).toHaveAttribute('data-docked', 'false');

    // "Voltar ao canto": the corner again, sitting on the taskbar, and the place is forgotten.
    await openMenu();
    await chooseFromMenu({ kind: 'home' });
    await expect(root()).toHaveAttribute('data-docked', 'true', { timeout: 10_000 });
    const work = await primaryWorkArea();
    expect(Math.abs((await petAnchor()).y - (work.y + work.height))).toBeLessThanOrEqual(1);
    expect(await main.evaluate(() => window.donel.config.get().then((config) => config.pet.placement))).toBeNull();

    // A new helper is born with the new window, and it is also the only one: nothing was left behind by the first.
    await waitForNewPids('powershell.exe', new Set(watchersBefore), 1, 25_000, false, WATCHER_COMMAND_PREFIX);
  });

  test('T052 - o balanço em repouso: lento e quase parado dormindo, leve acordado, nenhum com o sistema pedindo menos movimento (FR-030) @pet', async () => {
    test.setTimeout(120_000);
    // The sway lives in the first child of the figure (a class of a CSS module, so it is found by position).
    const swayOf = (): Promise<{ name: string; duration: string }> =>
      pet
        .getByTestId('pet-figure')
        .locator('> div')
        .first()
        .evaluate((element) => {
          const style = window.getComputedStyle(element);
          return { name: style.animationName, duration: style.animationDuration };
        });

    // Asleep (no session): a slow cycle of 6.5 s that hardly moves.
    await expect(root()).toHaveAttribute('data-pose', 'sleeping');
    const asleep = await swayOf();
    expect(asleep.duration).toBe('6.5s');
    expect(asleep.name).toContain('sway-sleep');

    // Awake (a session is open: the incense): the light sway of 3.5 s.
    await launchClaudeTab(main, { name: 'atlas' });
    await expect(root()).toHaveAttribute('data-pose', 'incense', { timeout: 20_000 });
    const awake = await swayOf();
    expect(awake.duration).toBe('3.5s');
    expect(awake.name).toContain('sway');
    expect(awake.name).not.toContain('sway-sleep');

    // How far it goes down: 4 px at the medium size, in proportion to the drawing (set on the stage, two levels above the figure).
    const size = Number(await root().getAttribute('data-size'));
    const reach = await pet
      .getByTestId('pet-figure')
      .evaluate((element) => window.getComputedStyle(element.parentElement?.parentElement ?? element).getPropertyValue('--sway'));
    expect(Number.parseFloat(reach)).toBeCloseTo((size / 140) * 4, 2);

    // The system asking for less motion: no sway at all. It comes back when the request is lifted.
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    expect((await swayOf()).name).toBe('none');
    await pet.emulateMedia({ reducedMotion: 'no-preference' });
    expect((await swayOf()).name).toContain('sway');
  });
});
