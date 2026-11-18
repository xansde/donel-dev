// t-fe46929a — the boot asks a silent remote place again for minutes. A live session must come back as ONE tab: a
// second tab on the same tmux would be a second client of the same CLI, and closing either would end it under the
// other. The tmux keeps the id it was born with (`donel-<sid>`), while a tab's `claudeSessionId` arrives only once its
// ssh setup is done and changes on `/clear`, so neither is enough alone.

import { resumedSessionIdFromArgs } from './resumeFailure';

export interface RemoteBootTab {
  readonly claudeSessionId?: string;
  readonly launchArgs?: readonly string[];
  /** t-205b44c8 — the tmux the tab attached to when it is not its conversation's own (a resume past a `/clear`). */
  readonly remoteAttachFolder?: string;
}

/**
 * Whether the live session `sid` already has (or had, during this boot) a tab: the boot already brought it back once
 * (`broughtBack`), or a tab runs it, or a tab is still connecting to it (`-r <sid>` in its args, before the id comes).
 */
export function remoteSessionAlreadyOpen(sid: string, tabs: readonly RemoteBootTab[], broughtBack: ReadonlySet<string>): boolean {
  if (broughtBack.has(sid)) return true;
  return tabs.some((tab) => tab.claudeSessionId === sid || tab.remoteAttachFolder === sid || resumedSessionIdFromArgs(tab.launchArgs) === sid);
}

/** t-1a3f7150 — every live-session id a remote tab stands for (its conversation, the tmux it attached to, its `-r`). */
export function remoteTabSessionIds(tab: RemoteBootTab): string[] {
  const resumed = resumedSessionIdFromArgs(tab.launchArgs);
  return [tab.claudeSessionId, tab.remoteAttachFolder, resumed].filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * t-1a3f7150 — the boot asks again later (every few minutes and when a place relinks), so a session the place opened
 * while the PC was off becomes a tab. Only the ones with no tab yet, each once: `known` holds every id that had a tab
 * in this run (a tab the owner closed may still find its tmux alive for a few seconds) and the ones already brought.
 */
export function remoteSessionsToOpen<T extends { readonly sessionId: string }>(alive: readonly T[], tabs: readonly RemoteBootTab[], known: ReadonlySet<string>): T[] {
  const taken = new Set<string>();
  return alive.filter((entry) => {
    if (taken.has(entry.sessionId) || remoteSessionAlreadyOpen(entry.sessionId, tabs, known)) return false;
    taken.add(entry.sessionId);
    return true;
  });
}
