// 014-chat (T065/T067/T071) - per-tab send plumbing: ONE `SendDriver` per tab wired to that tab's hidden
// terminal and to the chat store's acceptance signals, plus the in-memory draft of the composer.
// In memory only (survives switching tab/view and the end of the session, not an app restart).
//
// The Composer and the Esteira auto-start go through the same driver, so a message typed by the owner and a
// command fired by a phase share one FIFO and never interleave their pastes.

import type { TerminalPaneHandle } from '../../TerminalPane';
import { getChatStore, type ChatStore } from '../ChatStore';
import { markOpensScreen } from '../useTerminalNeededReporter';
import { SendDriver, type SendDriverPorts, type SendItemView, type SendRequest } from '../sendDriver';
import type { DraftImage } from './attachmentsModel';
import type { DraftPaste } from './pastedText';

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
    boxCleared: (text) => {
      const ptyId = w().source.terminal()?.ptyId ?? w().ptyId;
      if (ptyId !== null) store.reportBoxCleared(ptyId, text);
    },
    reportFailure: (detail) => {
      const ptyId = w().source.terminal()?.ptyId ?? w().ptyId;
      if (ptyId !== null) store.reportSendFailure(ptyId, detail);
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

/** How a send to another session ended, for the one that sent it (`sessao_enviar`). */
export type SendOutcome =
  | { readonly kind: 'entrou' }
  | { readonly kind: 'na-fila' }
  | { readonly kind: 'nao-foi'; readonly reason: string }
  | { readonly kind: 'enviando'; readonly reason?: string };

/**
 * 05/11 — sends and waits for the destination's CLI to take it: `entrou` (submitted), `na-fila` (the CLI queued it
 * mid-turn), `nao-foi` (the machine gave up, with its reason) or, past `waitMs`, `enviando` (still trying). Before,
 * the sender heard "Entregue" while the message sat unsubmitted in the box.
 */
export function sendToTabAndWait(tabId: string, source: TabTerminalSource, request: SendRequest, waitMs: number, store?: ChatStore): Promise<SendOutcome> {
  const driver = sendDriverFor(tabId, source, store);
  return new Promise<SendOutcome>((resolve) => {
    let last: SendItemView | undefined;
    let off: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (outcome: SendOutcome): void => {
      off();
      if (timer !== undefined) clearTimeout(timer);
      resolve(outcome);
    };
    const check = (): boolean => {
      // A notice merged into another while the owner typed is answered for by the one that carries it.
      const carrier = driver.carrierOf(id);
      const item = driver.getItems().find((candidate) => candidate.id === carrier);
      if (item === undefined) {
        // A finished send leaves the list once the transcript row takes over: it went in.
        if ((last !== undefined && last.state !== 'failed') || driver.wasDelivered(id)) {
          done({ kind: 'entrou' });
          return true;
        }
        return last !== undefined;
      }
      last = item;
      if (item.state === 'accepted') done({ kind: 'entrou' });
      else if (item.state === 'queued') done({ kind: 'na-fila' });
      else if (item.state === 'failed') done({ kind: 'nao-foi', reason: item.reason ?? 'não foi' });
      else return false;
      return true;
    };
    // A resend of the same text (the sender heard a timeout) answers for the first one: never twice in the box.
    const id = driver.enqueue({ ...request, dedupe: true });
    if (check()) return;
    off = driver.subscribe(() => {
      check();
    });
    timer = setTimeout(() => done({ kind: 'enviando', ...(last?.reason ? { reason: last.reason } : {}) }), waitMs);
  });
}

/** 07/11 — the CLI of this tab took some message (seen by a hook, the transcript or a lookup): it started. */
export function tabTookMessage(tabId: string): boolean {
  return wired.get(tabId)?.driver.tookMessage() === true;
}

/** 07/11 — why the oldest send of this tab is still on its way (`null`: none is): the board's "não começou" says it. */
export function pendingSendReason(tabId: string): string | null {
  const item = wired.get(tabId)?.driver.getItems().find((candidate) => candidate.state !== 'accepted' && candidate.state !== 'failed');
  if (item === undefined) return null;
  return item.reason ?? item.queuedReason ?? 'enviando';
}

/**
 * 06/11 - a key (or paste) of the owner in the tab's terminal, on its way to the PTY: the tab's driver writes it now,
 * or right after the Enter of a notice from another session that is being written at this moment, and holds the
 * notices while he types. A tab with no driver yet just writes it.
 */
export function ownerTerminalInput(tabId: string, data: string, forward: (data: string) => void): void {
  const w = wired.get(tabId);
  if (w === undefined) forward(data);
  else w.driver.ownerInput(data, forward);
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
  draftPastes.delete(tabId);
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

// ---------------------------------------------------------------- large-paste drafts (T089)

const EMPTY_PASTES: readonly DraftPaste[] = [];
const draftPastes = new Map<string, readonly DraftPaste[]>();
const pasteListeners = new Map<string, Set<() => void>>();

/** Stable reference while nothing changes (it feeds `useSyncExternalStore`). */
export function getDraftPastes(tabId: string): readonly DraftPaste[] {
  return draftPastes.get(tabId) ?? EMPTY_PASTES;
}

export function setDraftPastes(tabId: string, pastes: readonly DraftPaste[]): void {
  if (pastes.length === 0) draftPastes.delete(tabId);
  else draftPastes.set(tabId, pastes);
  for (const l of [...(pasteListeners.get(tabId) ?? [])]) l();
}

export function subscribeDraftPastes(tabId: string, listener: () => void): () => void {
  let set = pasteListeners.get(tabId);
  if (set === undefined) {
    set = new Set();
    pasteListeners.set(tabId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}
