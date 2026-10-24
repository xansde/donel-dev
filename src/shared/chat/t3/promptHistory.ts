// Adapted from pingdotgg/t3code@9f48092 apps/web/src/components/chat/composerPromptHistory.ts — MIT, (c) 2026 T3 Tools Inc.
// Local changes: renamed (Composer* → Prompt*); dropped the t3-only imports and the cleanup of send-time
// appends (review comments, terminal/element context, ultrathink prefix, plan prompts); `stepPromptHistory`
// gained `cursorAtTopEdge`/`cursorAtBottomEdge` so ↑/↓ only recall when the caret is on the first/last line
// while browsing. License text in ./LICENSE.

/**
 * Terminal-style prompt recall for the composer. ArrowUp on an empty composer walks back through the
 * conversation's sent prompts, ArrowDown walks forward and empties the composer past the newest entry.
 *
 * History is text only and derived from the user messages on every keypress, so there is no store.
 */

export interface PromptHistoryMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
}

export interface PromptHistoryEntry {
  readonly id: string;
  readonly prompt: string;
}

/**
 * Active recall. `entryId` is resolved against the current entries on every step, so an optimistic message
 * replaced by the real one cannot move the position. `recalled` is the text put in the composer; once the
 * composer no longer matches it, the user edited or sent and browsing is over.
 */
export interface PromptHistoryPosition {
  readonly entryId: string;
  readonly recalled: string;
}

export interface PromptHistoryStep {
  readonly position: PromptHistoryPosition | null;
  readonly prompt: string;
}

/** Prefer the id; a consecutive-duplicate collapse can retire it, so fall back to the newest entry with the same text. */
function findActive(entries: ReadonlyArray<PromptHistoryEntry>, position: PromptHistoryPosition): number {
  const byId = entries.findIndex((entry) => entry.id === position.entryId);
  if (byId >= 0) return byId;
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].prompt === position.recalled) return i;
  return -1;
}

/**
 * Oldest first. Consecutive identical prompts collapse into the newest one (shell `HISTCONTROL=ignoredups`).
 * Messages without text (image-only) are skipped.
 */
export function buildPromptHistoryEntries(messages: ReadonlyArray<PromptHistoryMessage>): PromptHistoryEntry[] {
  const entries: PromptHistoryEntry[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const prompt = message.text.trim();
    if (prompt.length === 0) continue;
    const previous = entries[entries.length - 1];
    if (previous && previous.prompt === prompt) {
      entries[entries.length - 1] = { id: message.id, prompt };
      continue;
    }
    entries.push({ id: message.id, prompt });
  }
  return entries;
}

/**
 * Returns null when the key should fall through to normal caret movement. Backward starts only from an
 * empty composer (or continues while browsing with the caret on the first line) and stops at the oldest
 * entry. Forward needs an active recall and the caret on the last line; past the newest entry it empties
 * the composer and ends browsing. An edited or sent recall no longer matches `recalled`.
 */
export function stepPromptHistory(input: {
  readonly direction: 'backward' | 'forward';
  readonly entries: ReadonlyArray<PromptHistoryEntry>;
  readonly position: PromptHistoryPosition | null;
  readonly currentPrompt: string;
  /** Caret on the first line of the composer. Default true. */
  readonly cursorAtTopEdge?: boolean;
  /** Caret on the last line of the composer. Default true. */
  readonly cursorAtBottomEdge?: boolean;
}): PromptHistoryStep | null {
  const { entries, position, currentPrompt } = input;
  const activeIndex = position && position.recalled === currentPrompt ? findActive(entries, position) : -1;

  if (input.direction === 'backward') {
    if (activeIndex < 0 && currentPrompt.length > 0) return null;
    if (activeIndex >= 0 && input.cursorAtTopEdge === false) return null;
    const entry = entries[activeIndex < 0 ? entries.length - 1 : activeIndex - 1];
    if (!entry) return null;
    return { position: { entryId: entry.id, recalled: entry.prompt }, prompt: entry.prompt };
  }

  if (activeIndex < 0) return null;
  if (input.cursorAtBottomEdge === false) return null;
  const entry = entries[activeIndex + 1];
  if (!entry) return { position: null, prompt: '' };
  return { position: { entryId: entry.id, recalled: entry.prompt }, prompt: entry.prompt };
}
