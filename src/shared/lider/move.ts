// Líder único na VPS (docs/planos/lider-na-vps.md) — what the Jobu does with a message, and the move of the Líder
// from one place to another. The rule that keeps the conversation: the old Líder is closed only after the new one is
// alive and took a message, with the conversation already copied and checked (`lider:carry`). Any failure on the way
// leaves the old one where it was, and every message goes to it.

import type { SemaphoreState } from '../index';
import { leaderMoves, leaderStopped, sameFolder } from '../leaderPrefs';
import type { LiderSendResult } from './ipc';

/** The Líder tab as the Jobu sees it. */
export interface LeaderTabView {
  readonly id: string;
  readonly remoteId: string | undefined;
  readonly claudeSessionId: string | undefined;
  readonly state: SemaphoreState | undefined;
  /** Its process ended (closed by itself, or the ssh dropped), but the tab is still there. */
  readonly exited: boolean;
  /** The folder it runs in. */
  readonly cwd: string | undefined;
}

export type LeaderPlan =
  | { readonly kind: 'send'; readonly tabId: string }
  | { readonly kind: 'move'; readonly tabId: string; readonly sessionId: string }
  | { readonly kind: 'reconnect'; readonly tabId: string; readonly sessionId: string }
  | { readonly kind: 'open' };

/**
 * Pure — what a message to the Líder does. A Líder whose process ended (the notebook slept and the ssh dropped) is
 * brought back with the same conversation, where it was: on a remote place that reattaches to the same CLI. Only with
 * no conversation to resume does a new Líder open.
 */
export function planLeaderDelivery(tab: LeaderTabView | undefined, wantedRemoteId: string | undefined, wantedCwd?: string): LeaderPlan {
  if (!tab) return { kind: 'open' };
  if (tab.exited) return tab.claudeSessionId ? { kind: 'reconnect', tabId: tab.id, sessionId: tab.claudeSessionId } : { kind: 'open' };
  if (!tab.claudeSessionId) return { kind: 'send', tabId: tab.id };
  // Another folder (the orchestrator's project, 12/11) is a move too, with the same rule: only while it is stopped.
  const otherFolder = wantedCwd !== undefined && !sameFolder(tab.cwd, wantedCwd);
  if (leaderMoves({ remoteId: tab.remoteId, state: tab.state }, wantedRemoteId) || (otherFolder && leaderStopped(tab.state))) {
    return { kind: 'move', tabId: tab.id, sessionId: tab.claudeSessionId };
  }
  return { kind: 'send', tabId: tab.id };
}

export interface LeaderMoveDeps {
  /** Copies the conversation to the new place and checks it there (size and hash). */
  carry(): Promise<LiderSendResult>;
  /** Opens the Líder on the new place (`-r` with the same id); answers its tab. */
  openNew(): string;
  /** Delivers the first message to the new Líder: `true` once its CLI took it (it is alive). */
  deliverFirst(tabId: string, text: string): Promise<boolean>;
  send(tabId: string, text: string): void;
  close(tabId: string): void;
  /** The tab is the Líder from now on (the Jobu reports it). */
  adopt(tabId: string): void;
  notify(message: string): void;
}

export interface LeaderMove {
  /** A message that arrived during the move: it goes, in order, to whichever Líder is left. */
  enqueue(text: string): void;
  readonly done: Promise<'moved' | 'stayed'>;
}

/** Moves the Líder of `oldTabId`, carrying `firstText`. Never throws; never loses or repeats a message. */
export function startLeaderMove(oldTabId: string, firstText: string, deps: LeaderMoveDeps): LeaderMove {
  const queue: string[] = [];
  let target: string | null = null;

  const flushTo = (tabId: string): void => {
    target = tabId;
    for (const text of queue.splice(0)) deps.send(tabId, text);
  };

  const stay = (reason: string, newTabId: string | null): 'stayed' => {
    if (newTabId !== null) deps.close(newTabId);
    deps.send(oldTabId, firstText);
    flushTo(oldTabId);
    deps.notify(`O Líder continua onde estava, com a conversa: ${reason}`);
    return 'stayed';
  };

  const run = async (): Promise<'moved' | 'stayed'> => {
    let carried: LiderSendResult;
    try {
      carried = await deps.carry();
    } catch (error) {
      carried = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (!carried.ok) return stay(carried.reason, null);

    let newTabId: string | null = null;
    try {
      newTabId = deps.openNew();
      const took = await deps.deliverFirst(newTabId, firstText);
      if (!took) return stay('o Líder no lugar novo não subiu.', newTabId);
    } catch (error) {
      return stay(error instanceof Error ? error.message : String(error), newTabId);
    }
    deps.adopt(newTabId);
    deps.close(oldTabId);
    flushTo(newTabId);
    return 'moved';
  };

  return {
    enqueue: (text) => {
      if (target !== null) deps.send(target, text);
      else queue.push(text);
    },
    done: run(),
  };
}
