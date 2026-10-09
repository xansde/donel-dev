// T089 (014-chat) - pure model of the large-paste chip: when a paste is too big to sit in the box ("texto colado
// - N linhas", FR-016), what its label says and how it goes back into the message when it is sent.

/** More than this many lines ... */
export const PASTE_MAX_LINES = 20;
/** ... or more than this many characters turns the paste into a chip. */
export const PASTE_MAX_CHARS = 2000;

/** A large paste kept aside from the text box (per tab, like the images). */
export interface DraftPaste {
  readonly id: string;
  readonly text: string;
  readonly lines: number;
}

/** Lines of a text, ignoring a trailing line break. */
export function countLines(text: string): number {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return body === '' ? 0 : body.split('\n').length;
}

export function isLargePaste(text: string): boolean {
  return text.length > PASTE_MAX_CHARS || countLines(text) > PASTE_MAX_LINES;
}

export function makePaste(id: string, text: string): DraftPaste {
  return { id, text, lines: countLines(text) };
}

/** "texto colado — 500 linhas" (numbered when there are several: the owner tells them apart in the modal). */
export function pasteLabel(paste: DraftPaste): string {
  return `texto colado — ${paste.lines} ${paste.lines === 1 ? 'linha' : 'linhas'}`;
}

/**
 * The message that really goes out: what was typed, then each pasted text back in full, separated by a blank
 * line. The typed text stays FIRST so a leading `/skill` or `!` still decides what kind of message it is.
 */
export function expandPastes(text: string, pastes: readonly DraftPaste[]): string {
  if (pastes.length === 0) return text;
  const parts = [text.trim() === '' ? null : text.trimEnd(), ...pastes.map((paste) => paste.text.replace(/\s+$/, ''))];
  return parts.filter((part): part is string => part !== null).join('\n\n');
}
