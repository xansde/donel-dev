// 014-chat (T063) — comparison between the text the chat sent and the text of an acceptance signal
// (`contracts/send-protocol.md` §5). Pure.

const PASTED_CONTENT_TAG = /<\/?pasted_content\b[^>]*>/g;
const IMAGE_MARKER = /\[Image #\d+\]/g;

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

/** True when the signal text is the message that was sent. */
export function matchesPrompt(sent: string, signalText: string): boolean {
  return normalizePrompt(sent) === normalizePrompt(signalText);
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
