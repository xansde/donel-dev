// t-af678813 — the owner typing in the chat or the terminal lost the caret whenever an agent drove the internal
// browser. Measured in Electron 43 (xvfb, 15/11): every main-frame, cross-document navigation of a panel view
// (`navegador_abrir`, a click on a link, Enter that submits a form, reload, back) moves the keyboard focus to the
// view at commit, even while the view is hidden. CDP clicks, typing and keys do not; same-document navigations
// do not; nothing moves while the window is inactive. The guard gives the focus back to whoever had it.

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { keepFocusOnNavigation, type FocusHolder } from '../src/main/browser/panel-focus';

class FakePage extends EventEmitter implements FocusHolder {
  focusCalls = 0;
  destroyed = false;
  constructor(private readonly hasFocus: () => boolean = () => false) {
    super();
  }
  isFocused(): boolean {
    return this.hasFocus();
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  focus(): void {
    this.focusCalls += 1;
  }
}

function setup() {
  let focused: FocusHolder | null = null;
  const page = new FakePage(() => focused === page);
  const chat = new FakePage();
  focused = chat;
  const later: Array<() => void> = [];
  keepFocusOnNavigation(page, { focused: () => focused, defer: (fn) => later.push(fn) });
  /** The next tick: what was deferred runs. */
  const tick = (): void => {
    for (const fn of later.splice(0)) fn();
  };
  const startNavigation = (opts: { sameDocument?: boolean; mainFrame?: boolean } = {}): void => {
    page.emit('did-start-navigation', {}, 'https://example.com/', opts.sameDocument ?? false, opts.mainFrame ?? true);
  };
  /** What Chromium does at commit: the view takes the keyboard focus. */
  const stealFocus = (): void => {
    focused = page;
    page.emit('focus');
  };
  return { page, chat, startNavigation, stealFocus, tick, setFocused: (holder: FocusHolder | null) => (focused = holder) };
}

describe('the internal browser does not take the focus of the owner (t-af678813)', () => {
  it('a navigation the agent starts gives the focus back to the chat it took it from', () => {
    const { page, chat, startNavigation, stealFocus, tick } = setup();
    startNavigation();
    stealFocus();
    stealFocus(); // Chromium blurs and focuses the new document twice on a same-site navigation
    expect(chat.focusCalls).toBe(0); // a focus() inside the focus event is undone by Chromium: one tick later
    page.emit('did-navigate');
    tick();
    expect(chat.focusCalls).toBeGreaterThan(0);
  });

  it('the owner clicking somewhere else before the tick keeps that choice', () => {
    const { chat, startNavigation, stealFocus, tick, setFocused } = setup();
    const terminal = new FakePage();
    startNavigation();
    stealFocus();
    setFocused(terminal);
    tick();
    expect(chat.focusCalls).toBe(0);
  });

  it('a click of the owner on the page after the navigation keeps the focus on the page', () => {
    const { page, chat, startNavigation, stealFocus, tick } = setup();
    startNavigation();
    page.emit('did-navigate');
    stealFocus();
    tick();
    expect(chat.focusCalls).toBe(0);
  });

  it('a navigation that started with the focus already on the page leaves it there', () => {
    const { page, chat, startNavigation, stealFocus, tick, setFocused } = setup();
    setFocused(page);
    startNavigation();
    stealFocus();
    tick();
    expect(chat.focusCalls).toBe(0);
  });

  it('same-document navigations and frames do not arm the guard', () => {
    const { chat, startNavigation, stealFocus, tick } = setup();
    startNavigation({ sameDocument: true });
    stealFocus();
    startNavigation({ mainFrame: false });
    stealFocus();
    tick();
    expect(chat.focusCalls).toBe(0);
  });

  it('a navigation that fails or stops without committing disarms the guard', () => {
    const { page, chat, startNavigation, stealFocus, tick } = setup();
    startNavigation();
    page.emit('did-stop-loading');
    stealFocus();
    tick();
    startNavigation();
    page.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/', true);
    stealFocus();
    tick();
    expect(chat.focusCalls).toBe(0);
  });

  it('with the window inactive or the old holder gone, nothing is focused', () => {
    const { chat, startNavigation, stealFocus, tick, setFocused } = setup();
    setFocused(null);
    startNavigation();
    stealFocus();
    tick();
    setFocused(chat);
    startNavigation();
    chat.destroyed = true;
    stealFocus();
    tick();
    expect(chat.focusCalls).toBe(0);
  });
});
