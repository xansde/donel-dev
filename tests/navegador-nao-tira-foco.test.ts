// t-af678813 — the owner typing in the chat or the terminal lost the caret whenever an agent drove the internal
// browser. Measured in Electron 43 (xvfb, 15/11): every main-frame, cross-document navigation of a panel view
// (`navegador_abrir`, a click on a link, Enter that submits a form, reload, back) moves the keyboard focus to the
// view before `did-navigate`, even while the view is hidden. The keeper gives it back to where the owner had it,
// and leaves alone the focus the owner gives the page with a click.

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PanelFocusKeeper, type FocusPage } from '../src/main/browser/panel-focus';

/** The pages of one window; `focusOn` is what Chromium does: the page gets the focus and says so. */
function setup() {
  let focused: FakePage | null = null;
  let clock = 0;
  class FakePage extends EventEmitter implements FocusPage {
    focusCalls = 0;
    destroyed = false;
    isDestroyed(): boolean {
      return this.destroyed;
    }
    isFocused(): boolean {
      return focused === this;
    }
    focus(): void {
      this.focusCalls += 1;
      focusOn(this);
    }
  }
  const focusOn = (page: FakePage): void => {
    focused = page;
    page.emit('focus');
  };
  /** A real click: the focus first, then the mouse press reaches the page (measured order). */
  const click = (page: FakePage): void => {
    focusOn(page);
    page.emit('input-event', {}, { type: 'mouseDown' });
    page.emit('input-event', {}, { type: 'mouseUp' });
  };
  const later: Array<() => void> = [];
  const keeper = new PanelFocusKeeper({ defer: (fn) => later.push(fn), now: () => clock });
  const chat = new FakePage();
  focused = chat;
  keeper.watchWindow(chat);
  const panel = (): FakePage => {
    const page = new FakePage();
    keeper.watchPanel(page);
    return page;
  };
  const startNavigation = (page: FakePage, opts: { sameDocument?: boolean; mainFrame?: boolean } = {}): void => {
    page.emit('did-start-navigation', {}, 'https://example.com/', opts.sameDocument ?? false, opts.mainFrame ?? true);
  };
  /** The commit: Chromium focuses the new document (twice, on a same-site navigation), then `did-navigate`. */
  const commit = (page: FakePage): void => {
    focusOn(page);
    focusOn(page);
    page.emit('did-navigate');
  };
  /** The next tick: what was deferred runs. */
  const tick = (): void => {
    for (const fn of later.splice(0)) fn();
  };
  const wait = (ms: number): void => {
    clock += ms;
  };
  return { keeper, chat, panel, focusOn, click, startNavigation, commit, tick, wait, focused: () => focused };
}

describe('the internal browser does not take the focus of the owner (t-af678813)', () => {
  it("an agent's navigation, hidden or not, gives the focus back to the chat", () => {
    const { chat, panel, startNavigation, commit, tick, focused } = setup();
    const page = panel();
    startNavigation(page);
    commit(page);
    expect(focused()).toBe(page); // a focus() inside the focus event is undone by Chromium: one tick later
    tick();
    expect(focused()).toBe(chat);
  });

  it('a busy page that commits long after taking the focus still gives it back', () => {
    const { chat, panel, focusOn, startNavigation, tick, wait, focused } = setup();
    const page = panel();
    startNavigation(page);
    focusOn(page);
    wait(600); // measured: a renderer with long tasks commits up to 600 ms after the focus
    page.emit('did-navigate');
    tick();
    expect(focused()).toBe(chat);
  });

  it('the owner typing while the focus is stolen does not hand it to the page', () => {
    const { chat, panel, focusOn, startNavigation, tick, focused } = setup();
    const page = panel();
    startNavigation(page);
    focusOn(page);
    page.emit('input-event', {}, { type: 'rawKeyDown' });
    page.emit('input-event', {}, { type: 'char' });
    page.emit('did-navigate');
    tick();
    expect(focused()).toBe(chat);
  });

  it('the owner clicking the page while it loads keeps the focus on the page', () => {
    const { chat, panel, click, startNavigation, commit, tick, focused } = setup();
    const page = panel();
    startNavigation(page);
    click(page);
    commit(page);
    tick();
    expect(focused()).toBe(page);
    expect(chat.focusCalls).toBe(0);
  });

  it('the owner coming back to the chat while the page loads gets the focus back at the commit', () => {
    const { chat, panel, click, startNavigation, commit, tick, focused } = setup();
    const page = panel();
    click(page); // the navigation starts with the owner on the page
    startNavigation(page);
    click(chat);
    commit(page);
    tick();
    expect(focused()).toBe(chat);
  });

  it('the focus goes back to the panel the owner is using, not to the one that navigates', () => {
    const { panel, click, startNavigation, commit, tick, focused } = setup();
    const used = panel();
    const driven = panel();
    startNavigation(driven);
    click(used);
    commit(driven);
    tick();
    expect(focused()).toBe(used);
  });

  it("a navigation the owner asks from the panel's bar lets the page take the focus", () => {
    const { keeper, chat, panel, startNavigation, commit, tick, focused } = setup();
    const page = panel();
    keeper.ownerNavigates(page);
    startNavigation(page);
    commit(page);
    tick();
    expect(focused()).toBe(page);
    expect(chat.focusCalls).toBe(0);
  });

  it("a mark of the owner that no navigation used (stop, an anchor) does not free the agent's next one", () => {
    const { keeper, chat, panel, startNavigation, commit, tick, focused } = setup();
    const page = panel();
    keeper.ownerNavigates(page);
    page.emit('did-stop-loading'); // the owner pressed stop
    startNavigation(page);
    commit(page);
    tick();
    expect(focused()).toBe(chat);

    keeper.ownerNavigates(page);
    startNavigation(page, { sameDocument: true }); // the owner typed #section
    startNavigation(page);
    commit(page);
    tick();
    expect(focused()).toBe(chat);
  });

  it('same-document navigations and frames do not move anything back', () => {
    const { chat, panel, startNavigation, focusOn, tick, focused } = setup();
    const page = panel();
    startNavigation(page, { sameDocument: true });
    startNavigation(page, { mainFrame: false });
    focusOn(page);
    page.emit('did-navigate');
    tick();
    expect(focused()).toBe(page);
    expect(chat.focusCalls).toBe(0);
  });

  it('a failed navigation that took the focus gives it back too', () => {
    const { chat, panel, focusOn, startNavigation, tick, focused } = setup();
    const page = panel();
    startNavigation(page);
    focusOn(page); // the error page commits
    page.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://example.invalid/', true);
    tick();
    expect(focused()).toBe(chat);
  });

  it('nothing is focused when the owner already moved, or the old place is gone', () => {
    const { chat, panel, click, startNavigation, commit, tick, focused } = setup();
    const page = panel();
    const other = panel();
    startNavigation(page);
    commit(page);
    click(other); // the owner clicked elsewhere before the tick
    tick();
    expect(focused()).toBe(other);
    expect(chat.focusCalls).toBe(0);

    click(chat);
    startNavigation(page);
    chat.destroyed = true;
    commit(page);
    tick();
    expect(focused()).toBe(page);
  });
});
