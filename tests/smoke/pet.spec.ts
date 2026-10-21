import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import type { LaunchedApp } from './helpers/launch';
import { launchClaudeTab } from './helpers/ui';
import { REPO_ROOT } from './repoUnderTest';
import { createIsolatedUserDataDir } from './userDataIsolation';

// 015-jobu-pet, T029 (US1) - smoke of the Jobu's face and badge, against the FAKE `claude` (never the
// real CLI). The pet is a second window of the same app: the main window is still `firstWindow()` (R21)
// and the pet is found by its URL, which ends in `#pet`. What the test reads is the `data-*` surface of
// the pet root (`data-pose` = the LOGICAL pose, `data-badge`, `data-interactive`...), which mirrors the view.
//
// The scenario `waiting-turn.json` holds the turn of the prompt `pedido` for 9 s before the `Stop`:
// time to move the owner to another tab and minimize the Donel. Test tab names are `atlas` and `beacon`
// (never the real project name: the fence in tests/smoke-project-name.test.ts).

const SCENARIO = path.join(REPO_ROOT, 'tests/fixtures/pet/scenarios/waiting-turn.json');

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

test.beforeAll(async () => {
  const userDataDir = createIsolatedUserDataDir('pet');
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ pet: { enabled: true, placement: null, size: 140 } }), 'utf8');
  launched = await launchIsolatedApp({ userDataDir, env: { ...process.env, DONEL_FAKE_CLAUDE_SCENARIO: SCENARIO } });
  main = launched.window;
  pet = await findPetWindow(launched.app);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await closeIsolatedApp(launched);
});

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
  const pane = main.locator('[data-testid="terminal-pane"]:visible');
  await expect(async () => {
    expect(await pane.innerText()).toContain('shortcuts'); // the fake claude drew its footer
  }).toPass({ timeout: 30_000 });
  await pane.click();
  await main.keyboard.type('pedido');
  await main.keyboard.press('Enter');
  await expect(root()).toHaveAttribute('data-pose', 'reading', { timeout: 15_000 });

  // 3. The owner goes to `beacon` and minimizes the Donel: `atlas` ends its turn out of sight.
  await tabNamed('beacon').click();
  await setDonelWindow('minimized');
  await expect(root()).toHaveAttribute('data-pose', 'impatient', { timeout: 40_000 });
  await expect(root()).toHaveAttribute('data-badge', '1');
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
