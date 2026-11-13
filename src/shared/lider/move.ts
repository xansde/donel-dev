// Líder único na VPS (docs/planos/lider-na-vps.md) — what the Jobu does with a message, and the move of the Líder
// from one place to another. The rule that keeps the conversation: the old Líder is closed only after the new one is
// alive and took a message, with the conversation already copied and checked (`lider:carry`). Any failure on the way
// leaves the old one where it was, and every message goes to it.

import type { SemaphoreState } from '../index';
import { folderKey, leaderMoves, leaderStopped, sameFolder } from '../leaderPrefs';
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
  | {
      readonly kind: 'move';
      readonly tabId: string;
      readonly sessionId: string;
      /** The folder it opens in after the move (the tab's own when only the place changes). */
      readonly cwd: string | undefined;
      /** The same remote place, only the folder changes: the tab itself changes folder (`LeaderMoveDeps.inPlace`). */
      readonly inPlace: boolean;
    }
  | { readonly kind: 'reconnect'; readonly tabId: string; readonly sessionId: string }
  | { readonly kind: 'open' };

/**
 * The key of one change of folder of the Líder: its conversation, the place it goes to (`undefined` = this computer)
 * and the folder. A change that failed (the folder does not exist there, the CLI did not start in it) is not tried again
 * while the app runs (`planLeaderDelivery`): every message would try it and warn again.
 */
export function leaderFolderMoveKey(sessionId: string, remoteId: string | undefined, cwd: string): string {
  return `${sessionId}|${remoteId ?? ''}|${folderKey(cwd)}`;
}

/**
 * Pure — what a message to the Líder does. A Líder whose process ended (the notebook slept and the ssh dropped) is
 * brought back with the same conversation, where it was: on a remote place that reattaches to the same CLI. Only with
 * no conversation to resume does a new Líder open. `wantedCwd` is the folder the live Líder moves to (`leaderMoveCwd`);
 * `failedFolderMoves` holds the changes of folder that failed in this run of the app (`leaderFolderMoveKey`).
 */
export function planLeaderDelivery(
  tab: LeaderTabView | undefined,
  wantedRemoteId: string | undefined,
  wantedCwd?: string,
  failedFolderMoves: ReadonlySet<string> = new Set(),
): LeaderPlan {
  if (!tab) return { kind: 'open' };
  if (tab.exited) return tab.claudeSessionId ? { kind: 'reconnect', tabId: tab.id, sessionId: tab.claudeSessionId } : { kind: 'open' };
  const sessionId = tab.claudeSessionId;
  if (!sessionId) return { kind: 'send', tabId: tab.id };
  // Another folder (the orchestrator's project, 12/11) is a move too, with the same rule: only while it is stopped.
  // Only from a known folder: without one the way back (`switchBack`, respawn without cwd) would start in the new folder.
  const folder =
    wantedCwd !== undefined &&
    tab.cwd !== undefined &&
    !sameFolder(tab.cwd, wantedCwd) &&
    !failedFolderMoves.has(leaderFolderMoveKey(sessionId, wantedRemoteId, wantedCwd))
      ? wantedCwd
      : undefined;
  const placeMoves = leaderMoves({ remoteId: tab.remoteId, state: tab.state }, wantedRemoteId);
  if (placeMoves || (folder !== undefined && leaderStopped(tab.state))) {
    return { kind: 'move', tabId: tab.id, sessionId, cwd: folder ?? tab.cwd, inPlace: !placeMoves && tab.remoteId !== undefined };
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
  /**
   * The same remote place, another folder (12/11): the tab itself changes folder, never a second Líder of the same id
   * on the place (its `run.sh` would attach to the old CLI's tmux, in the old folder). `openNew` and `close` are not
   * used; the first message goes to the same tab (`deliverFirst`).
   */
  inPlace?: {
    /** The tab takes the new folder and resumes the conversation there (its old CLI ends before the new one starts). */
    switchTo(): void;
    /** The tab takes the old folder back and resumes the conversation there, intact. */
    switchBack(): void;
    /** The first message again, after the way back: a send of it still on its way answers for it (never twice). */
    redeliver(tabId: string, text: string): void;
  };
}

export interface LeaderMove {
  /**
   * A message that arrived during the move: it goes, in order, to whichever Líder is left. `deliver` delivers it there
   * the way its sender would have (a notice of the board's sessions, `leaderLineRoute`); without it, `deps.send`.
   */
  enqueue(text: string, deliver?: (tabId: string) => void): void;
  readonly done: Promise<'moved' | 'stayed'>;
}

/**
 * Pure — where a line of the board's sessions to `tab` goes (12/11, Revisor do #413): while a move of the Líder único
 * lasts, every line to its tab (the old one, or the new one not adopted yet) waits in the move's queue. Delivered
 * straight, it would start a turn on the old tab that its close (or the respawn in the new folder) kills, and that the
 * copied conversation never had. A Líder de quadro, or any other session, is not the one moving: it gets it at once.
 */
export function leaderLineRoute(moving: boolean, tab: { readonly leaderOfAll?: boolean } | undefined): 'fila' | 'direto' {
  return moving && tab?.leaderOfAll === true ? 'fila' : 'direto';
}

/** Moves the Líder of `oldTabId`, carrying `firstText`. Never throws; never loses or repeats a message. */
export function startLeaderMove(oldTabId: string, firstText: string, deps: LeaderMoveDeps): LeaderMove {
  const queue: { readonly text: string; readonly deliver: ((tabId: string) => void) | undefined }[] = [];
  let target: string | null = null;

  const deliverTo = (tabId: string, text: string, deliver: ((tabId: string) => void) | undefined): void => {
    if (deliver) deliver(tabId);
    else deps.send(tabId, text);
  };

  const flushTo = (tabId: string): void => {
    target = tabId;
    for (const item of queue.splice(0)) deliverTo(tabId, item.text, item.deliver);
  };

  const stay = (reason: string, newTabId: string | null): 'stayed' => {
    if (newTabId !== null) deps.close(newTabId);
    deps.send(oldTabId, firstText);
    flushTo(oldTabId);
    deps.notify(`O Líder continua onde estava, com a conversa: ${reason}`);
    return 'stayed';
  };

  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  /** The same place, another folder: switch the tab, and on any failure switch it back with the conversation. */
  const runInPlace = async (inPlace: NonNullable<LeaderMoveDeps['inPlace']>): Promise<'moved' | 'stayed'> => {
    let reason = 'o Líder na pasta nova não subiu.';
    try {
      inPlace.switchTo();
      if (await deps.deliverFirst(oldTabId, firstText)) {
        deps.adopt(oldTabId);
        flushTo(oldTabId);
        return 'moved';
      }
    } catch (error) {
      reason = message(error);
    }
    try {
      inPlace.switchBack();
    } catch {
      // the tab is gone: the messages below go to it as they would to any Líder that ended
    }
    inPlace.redeliver(oldTabId, firstText);
    flushTo(oldTabId);
    deps.notify(`O Líder continua onde estava, com a conversa: ${reason}`);
    return 'stayed';
  };

  const run = async (): Promise<'moved' | 'stayed'> => {
    let carried: LiderSendResult;
    try {
      carried = await deps.carry();
    } catch (error) {
      carried = { ok: false, reason: message(error) };
    }
    if (!carried.ok) return stay(carried.reason, null);
    if (deps.inPlace) return runInPlace(deps.inPlace);

    let newTabId: string | null = null;
    try {
      newTabId = deps.openNew();
      const took = await deps.deliverFirst(newTabId, firstText);
      if (!took) return stay('o Líder no lugar novo não subiu.', newTabId);
    } catch (error) {
      return stay(message(error), newTabId);
    }
    deps.adopt(newTabId);
    deps.close(oldTabId);
    flushTo(newTabId);
    return 'moved';
  };

  return {
    enqueue: (text, deliver) => {
      if (target !== null) deliverTo(target, text, deliver);
      else queue.push({ text, deliver });
    },
    done: run(),
  };
}
