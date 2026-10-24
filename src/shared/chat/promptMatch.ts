// 014-chat (T063) — comparison between the text the chat sent and the text of an acceptance signal
// (`contracts/send-protocol.md` §5). Pure.

const PASTED_CONTENT_TAG = /<\/?pasted_content\b[^>]*>/g;
// An opening tag takes the line break after it; a closing tag takes the one before it.
const PASTED_CONTENT_OPEN = /<pasted_content\b[^>]*>\r?\n?/g;
const PASTED_CONTENT_CLOSE = /\r?\n?<\/pasted_content\b[^>]*>/g;
const IMAGE_MARKER = /\[Image #\d+\]/g;

/**
 * Removes the `<pasted_content id=…>…</pasted_content id=…>` wrapper the CLI puts around collapsed pastes in
 * the recorded prompt: only the tags and the line break glued to each one go. Inner spaces and `[Image #N]`
 * markers are kept, so the result is fit to display.
 */
export function unwrapPastedContent(text: string): string {
  return text.replace(PASTED_CONTENT_OPEN, '').replace(PASTED_CONTENT_CLOSE, '').replace(PASTED_CONTENT_TAG, '');
}

/**
 * Canonical form for comparison: unwraps `<pasted_content id=…>…</pasted_content id=…>` (the CLI wraps
 * collapsed pastes that way in the submitted prompt), `\r\n`/`\r` → `\n`, TAB → 4 spaces, drops `[Image #N]`
 * (any number — the chat never knows which one the CLI picked), collapses horizontal blanks and trims the
 * borders of the text and of each line.
 */
export function normalizePrompt(text: string): string {
  return text
    .replace(PASTED_CONTENT_TAG, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(IMAGE_MARKER, '')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .trim();
}

const BARE_SLASH_COMMAND = /^\/([^\s/]+)$/;

/**
 * The CLI completes a bare slash command on its own (`/mod` + Enter runs `/model`), so the transcript records
 * the full name. True only when BOTH are slash commands without argument and the recorded name starts with the
 * sent one; ordinary messages and commands with arguments stay exact.
 */
export function commandResolvesTo(sent: string, signalText: string): boolean {
  const a = BARE_SLASH_COMMAND.exec(normalizePrompt(sent))?.[1];
  const b = BARE_SLASH_COMMAND.exec(normalizePrompt(signalText))?.[1];
  return a !== undefined && b !== undefined && b !== a && b.startsWith(a);
}

/** True when the signal text is the message that was sent. */
export function matchesPrompt(sent: string, signalText: string): boolean {
  return normalizePrompt(sent) === normalizePrompt(signalText) || commandResolvesTo(sent, signalText);
}

export interface PendingPrompt {
  readonly text: string;
  /** Orders the pending sends; smaller = older. */
  readonly createdAt: number;
}

/**
 * Identical messages in a row are matched in order: each signal closes only the OLDEST pending send that
 * matches. The caller removes the returned send from its list before the next signal.
 */
export function matchOldestPending<T extends PendingPrompt>(pending: readonly T[], signalText: string): T | null {
  return oldestPending(pending, (p) => matchesPrompt(p.text, signalText));
}

/** Same rule for signals without usable text (`/clear`, `/compact`…): the oldest that satisfies `accepts`. */
export function oldestPending<T extends { readonly createdAt: number }>(
  pending: readonly T[],
  accepts: (candidate: T) => boolean,
): T | null {
  let best: T | null = null;
  for (const candidate of pending) {
    if (!accepts(candidate)) continue;
    if (best === null || candidate.createdAt < best.createdAt) best = candidate;
  }
  return best;
}
