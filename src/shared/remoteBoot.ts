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
