// 014-chat (T065/T067/T071) - per-tab send plumbing: ONE `SendDriver` per tab wired to that tab's hidden
// terminal and to the chat store's acceptance signals, plus the in-memory draft of the composer.
// In memory only (survives switching tab/view and the end of the session, not an app restart).
//
// The Composer and the Esteira auto-start go through the same driver, so a message typed by the owner and a
// command fired by a phase share one FIFO and never interleave their pastes.

import type { TerminalPaneHandle } from '../../TerminalPane';
import { getChatStore, type ChatStore } from '../ChatStore';
import { markOpensScreen } from '../useTerminalNeededReporter';
import { SendDriver, type SendDriverPorts, type SendRequest } from '../sendDriver';
import type { DraftImage } from './attachmentsModel';

export interface TabTerminalSource {
  terminal(): TerminalPaneHandle | null;
}

interface Wired {
  readonly driver: SendDriver;
  readonly source: TabTerminalSource;
  handle: TerminalPaneHandle | null;
  ptyId: string | null;
  offScreen: (() => void) | null;
  offSignal: (() => void) | null;
  /** Polls until the pane mounts (an Esteira tab sends before its terminal exists). */
  poll: ReturnType<typeof setInterval> | null;
}

const wired = new Map<string, Wired>();

function buildPorts(w: () => Wired, store: ChatStore): SendDriverPorts {
  return {
    now: () => Date.now(),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    write: (data) => w().source.terminal()?.write(data) ?? false,
    readLines: () => w().source.terminal()?.readScreen().lines ?? [],
    ackLookup: (text, since) => {
      const ptyId = w().source.terminal()?.ptyId ?? w().ptyId;
      return ptyId === null ? Promise.resolve({ matched: false }) : store.ackLookup(ptyId, text, since);
    },
    opensScreen: () => {
      const ptyId = w().source.terminal()?.ptyId ?? w().ptyId;
      if (ptyId !== null) markOpensScreen(ptyId);
    },
  };
}

/** Re-attaches the screen and signal subscriptions after the PTY (or the pane) changed. */
function rewire(tabId: string, store: ChatStore): void {
  const w = wired.get(tabId);
  if (w === undefined) return;
  const handle = w.source.terminal();
  if (handle === null && w.poll === null) {
    w.poll = setInterval(() => {
      rewire(tabId, store);
      if (w.source.terminal() !== null && w.poll !== null) {
        clearInterval(w.poll);
        w.poll = null;
      }
    }, 250);
  }
  if (handle !== w.handle) {
    w.offScreen?.();
    w.handle = handle;
    w.offScreen = handle?.onScreenUpdate(() => {
      rewire(tabId, store);
      w.driver.onScreen();
    }) ?? null;
  }
  const ptyId = handle?.ptyId ?? null;
  if (ptyId !== w.ptyId) {
    w.offSignal?.();
    w.ptyId = ptyId;
    w.offSignal =
      ptyId === null
        ? null
        : store.onPromptSignal(ptyId, (event) =>
            w.driver.handleSignal({ signal: event.signal, text: event.text, at: event.at, origin: event.origin }),
          );
  }
}

/** The tab's driver, created on first use. */
export function sendDriverFor(tabId: string, source: TabTerminalSource, store: ChatStore = getChatStore()): SendDriver {
  let w = wired.get(tabId);
  if (w === undefined) {
    const holder: { current: Wired | null } = { current: null };
    const driver = new SendDriver(buildPorts(() => holder.current!, store));
    w = { driver, source, handle: null, ptyId: null, offScreen: null, offSignal: null, poll: null };
    holder.current = w;
    wired.set(tabId, w);
  }
  rewire(tabId, store);
  return w.driver;
}

/** Re-checks the wiring (call when the tab's PTY id changes). */
export function rewireTab(tabId: string, store: ChatStore = getChatStore()): void {
  rewire(tabId, store);
}

/** Sends through the tab's driver (rewires first: the PTY may have changed since the last call). */
export function sendToTab(tabId: string, source: TabTerminalSource, request: SendRequest, store?: ChatStore): string {
  const driver = sendDriverFor(tabId, source, store);
  return driver.enqueue(request);
}

export function disposeTabSend(tabId: string): void {
  const w = wired.get(tabId);
  if (w === undefined) return;
  w.offScreen?.();
  w.offSignal?.();
  if (w.poll !== null) clearInterval(w.poll);
  w.driver.dispose();
  wired.delete(tabId);
  drafts.delete(tabId);
  draftImages.delete(tabId);
}

// ---------------------------------------------------------------- drafts

const drafts = new Map<string, string>();
const draftListeners = new Map<string, Set<() => void>>();

export function getDraft(tabId: string): string {
  return drafts.get(tabId) ?? '';
}

export function setDraft(tabId: string, text: string): void {
  if (text === '') drafts.delete(tabId);
  else drafts.set(tabId, text);
  for (const l of [...(draftListeners.get(tabId) ?? [])]) l();
}

export function subscribeDraft(tabId: string, listener: () => void): () => void {
  let set = draftListeners.get(tabId);
  if (set === undefined) {
    set = new Set();
    draftListeners.set(tabId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

// ---------------------------------------------------------------- image drafts (T088)

const EMPTY_IMAGES: readonly DraftImage[] = [];
const draftImages = new Map<string, readonly DraftImage[]>();
const imageListeners = new Map<string, Set<() => void>>();

/** Stable reference while nothing changes (it feeds `useSyncExternalStore`). */
export function getDraftImages(tabId: string): readonly DraftImage[] {
  return draftImages.get(tabId) ?? EMPTY_IMAGES;
}

export function setDraftImages(tabId: string, images: readonly DraftImage[]): void {
  if (images.length === 0) draftImages.delete(tabId);
  else draftImages.set(tabId, images);
  for (const l of [...(imageListeners.get(tabId) ?? [])]) l();
}

export function subscribeDraftImages(tabId: string, listener: () => void): () => void {
  let set = imageListeners.get(tabId);
  if (set === undefined) {
    set = new Set();
    imageListeners.set(tabId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}
