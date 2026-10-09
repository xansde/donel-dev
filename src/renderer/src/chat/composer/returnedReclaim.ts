// 014-chat (alfa-4) - decides whether the text left in the CLI box is the owner's last message coming back after
// an Esc before the first answer, and which send it was. Shared by the composer (leftover seen by a waiting
// message) and the stop window (box read right after a stop confirmed by the screen). Pure.

import { matchesPrompt } from '../../../../shared/chat/promptMatch';
import { isReturnedPrompt, lastTurnOf, userRowText } from '../../../../shared/chat/returnedPrompt';
import type { ConversationRow } from '../../../../shared/chat/rows';
import type { SendItemView } from '../sendDriver';

export interface ReturnedReclaim {
  /** The text of the user card (exact, with its line breaks): goes back to the chat box. */
  readonly text: string;
  /** The accepted send that carried it (to mark "interrompida"); `null` when it was typed in the terminal. */
  readonly sourceId: string | null;
}

export function planReturned(
  leftover: string,
  rows: readonly ConversationRow[],
  items: readonly SendItemView[],
  exceptId?: string,
): ReturnedReclaim | null {
  const turn = lastTurnOf(rows);
  if (turn === null || !isReturnedPrompt(leftover, turn.user, turn.hasAssistantOutput)) return null;
  const text = userRowText(turn.user);
  const source = [...items].reverse().find((item) => item.id !== exceptId && item.state === 'accepted' && item.kind === 'prompt' && matchesPrompt(item.text, text));
  return { text, sourceId: source?.id ?? null };
}
