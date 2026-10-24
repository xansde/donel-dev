// 014-chat (item 4 do lote alfa-4) - Esc before the first answer. The CLI cancels the request, drops the message
// from the conversation and PUTS ITS TEXT BACK in the terminal box. The chat sees that text as "unsent leftover";
// this module tells the two apart. Pure.

import { normalizePrompt } from './promptMatch';
import type { ConversationRow, UserRow } from './rows';

/** Rows of the chat itself that never made it to the transcript (`local:<sendId>`, see `optimistic.ts`). */
const LOCAL_ID_PREFIX = 'local:';

/** Row kinds that prove the Claude started answering the turn. */
const OUTPUT_KINDS: ReadonlySet<ConversationRow['kind']> = new Set([
  'assistant',
  'thinking',
  'action',
  'action-group',
  'skill',
  'subagent',
  'question',
  'plan',
  'shell',
  'local-command',
]);

/** What the owner typed, as the card shows it (`command` rows keep name and args apart). */
export function userRowText(row: UserRow): string {
  if (row.text !== '') return row.text;
  return row.command ? `/${row.command.name} ${row.command.args}`.trim() : '';
}

export interface LastTurn {
  readonly user: UserRow;
  /** Any row of the Claude (answer, thinking, action...) after the user card. */
  readonly hasAssistantOutput: boolean;
}

/** The last REAL user card and whether the Claude produced anything after it. `null` without one. */
export function lastTurnOf(rows: readonly ConversationRow[]): LastTurn | null {
  let userIndex = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.kind === 'user' && !row.id.startsWith(LOCAL_ID_PREFIX)) {
      userIndex = i;
      break;
    }
  }
  if (userIndex < 0) return null;
  const hasAssistantOutput = rows.slice(userIndex + 1).some((row) => OUTPUT_KINDS.has(row.kind));
  return { user: rows[userIndex] as UserRow, hasAssistantOutput };
}

/** The box joins wrapped lines with no separator, so only non-blank characters are comparable. */
const squash = (text: string): string => normalizePrompt(text).replace(/\s+/g, '');

/**
 * True when the text left in the terminal box is the last user card coming back: the turn has no output from
 * the Claude (the request was cancelled before the first answer) and the box holds exactly that message.
 */
export function isReturnedPrompt(leftover: string, lastUserRow: UserRow | null, turnHasAssistantOutput: boolean): boolean {
  if (lastUserRow === null || turnHasAssistantOutput) return false;
  const typed = squash(userRowText(lastUserRow));
  return typed !== '' && typed === squash(leftover);
}

/** The returned text goes back to the chat box; a draft already there stays, below it. */
export function restoreDraft(existing: string, returned: string): string {
  return existing.trim() === '' ? returned : `${returned}\n${existing}`;
}
