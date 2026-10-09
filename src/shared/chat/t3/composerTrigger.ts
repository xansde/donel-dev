// Adapted from pingdotgg/t3code@9f48092 packages/shared/src/composerTrigger.ts — MIT, (c) 2026 T3 Tools Inc.
// Local changes: only the `/` and `@` triggers survive (dropped `#` pull-request, `$` skill and the `/model`
// sub-menu); `/` opens only at the very start of the message, as the Claude CLI does; `serializeComposerFileLink`
// was replaced by `formatFileMention` (the CLI takes `@path`, not a markdown link). License text in ./LICENSE.

export type ComposerTriggerKind = 'slash-command' | 'path';

export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

/** `@path`, quoted when the path has whitespace (the CLI reads `@"a b/c.md"`). */
export function formatFileMention(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r';
}

/**
 * Detect an active trigger (`@path`, `/command`) at the cursor position.
 *
 * The slash menu exists only while the caret is still inside the command name that opens the message
 * (`/mo|`); once a space follows, the rest is the command's arguments. Accepts an optional
 * `isWhitespaceChar` override so callers with inline placeholder characters can treat them as token boundaries.
 */
export function detectComposerTrigger(
  text: string,
  cursorInput: number,
  isWhitespaceChar?: (char: string) => boolean,
): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const linePrefix = text.slice(lineStart, cursor);

  if (lineStart === 0 && linePrefix.startsWith('/')) {
    const commandMatch = /^\/(\S*)$/.exec(linePrefix);
    if (commandMatch) {
      return { kind: 'slash-command', query: commandMatch[1] ?? '', rangeStart: lineStart, rangeEnd: cursor };
    }
  }

  const wsCheck = isWhitespaceChar ?? isWhitespace;
  let tokenIdx = cursor - 1;
  while (tokenIdx >= 0 && !wsCheck(text[tokenIdx] ?? '')) {
    tokenIdx -= 1;
  }
  const tokenStart = tokenIdx + 1;

  const token = text.slice(tokenStart, cursor);
  if (!token.startsWith('@')) return null;
  return { kind: 'path', query: token.slice(1), rangeStart: tokenStart, rangeEnd: cursor };
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
}
