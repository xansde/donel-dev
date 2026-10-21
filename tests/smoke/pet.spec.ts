import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { launchChatApp } from './chatSmoke';
import type { ChatApp } from './chatSmoke';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import type { LaunchedApp } from './helpers/launch';
import { launchClaudeTab, openFreeTerminalTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir } from './userDataIsolation';

// 015-jobu-pet, T029 (US1), T035 (US2) and T041 (US3) - smoke of the Jobu's face, badge, bubble and clicks,
// against the FAKE `claude` (never the real CLI). The pet is a second window of the same app: the main window is still
// `firstWindow()` (R21) and the pet is found by its URL, which ends in `#pet`. What the test reads is the
// `data-*` surface of the pet root (`data-pose` = the LOGICAL pose, `data-badge`, `data-bubble`,
// `data-interactive`...), which mirrors the view.
//
// The scenario `waiting-turn.json` holds the turn of the prompt `pedido` for 9 s before the `Stop` and the
// one of `rapido` for 6 s: time to move the owner to another tab and minimize the Donel. Test tab names
// are `atlas`, `beacon` and `vega` (never the real project name: the fence in tests/smoke-project-name.test.ts).
//
// The mouse is the one of Playwright, which reaches the page straight through the debugger: it proves what
// the page does with a click and what it asks of the main, not the OS-level click-through of the
// transparent window (that one needs a real mouse: `SetCursorPos` does not feed the hook of Electron).
//
// Two blocks, two apps: the first one with the chat off (the semaphore alone drives the Jobu) and the
// second with the chat on (a pending carries its kind and a Windows notification could be raised).

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/pet/scenarios/waiting-turn.json');
const NOTIFICATION_BODY = 'Esperando você — permissão para rodar um comando';

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
      JSON.stringify({ pet: { enabled: true, placement: null, size: 140 }, notificationPreference: 'all' }),
      'utf8',
    );
    launched = await launchIsolatedApp({ userDataDir, env: { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO } });
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
    // this is the main telling the screen (`pet:close-list`, from the `blur` of the window).
    await setDonelWindow('focused');
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
      env: { DONEL_SMOKE_NOTIFICATIONS_LOG: notificationsLog },
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
      rmSync(tmp, { recursive: true, force: true });
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
