// 014-chat (T034/T036) — a screen line as read from the xterm buffer, with the
// *dim* attribute preserved. The CLI draws the input-box placeholder, the
// ghost suggestion and the footer hints in dim; they must never be read as
// text typed by the user (research R6/R8).

/** Half-open `[start, end)` range of indices into `ScreenLine.text` (UTF-16 code units, NOT terminal columns). */
export type DimRange = readonly [number, number];

/**
 * Dim mask of a line, in either of two equivalent shapes (both index `text` by UTF-16 position):
 * - `DimRange[]`: runs of consecutive dim characters (the fixtures' format; `[]` = none);
 * - `boolean[]`: one flag per character (the shape `contracts/ipc-chat.md` §3 sketches for `readScreen()`).
 */
export type DimMask = readonly DimRange[] | readonly boolean[];

/** One rendered line: `text` is `IBufferLine.translateToString(true)`; `dim` marks the cells where `IBufferCell.isDim()` is true. */
export interface ScreenLine {
  readonly text: string;
  readonly dim: DimMask;
  /**
   * Read from the buffer's cells only: whether the line's last non-blank cell is the row's last column. `text` drops the
   * trailing blanks, and a wide char takes two columns, so its length says nothing about the right margin (tmux draws
   * its copy-mode position there; 4ª rodada do #414). Absent = not known.
   */
  readonly toLastColumn?: boolean;
}

/** Detectors accept plain strings (legacy callers, no dim information) or `ScreenLine`s. */
export type LineInput = string | ScreenLine;

/** Full text of a line, dim characters included. */
export function lineText(line: LineInput): string {
  return typeof line === 'string' ? line : line.text;
}

/** Normalises a mask to sorted, half-open ranges. */
export function dimRanges(line: LineInput): DimRange[] {
  if (typeof line === 'string' || line.dim.length === 0) return [];
  const mask = line.dim;
  if (typeof mask[0] === 'boolean') {
    const flags = mask as readonly boolean[];
    const ranges: DimRange[] = [];
    let start = -1;
    for (let i = 0; i <= flags.length; i += 1) {
      const on = i < flags.length && flags[i];
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        ranges.push([start, i]);
        start = -1;
      }
    }
    return ranges;
  }
  return [...(mask as readonly DimRange[])].sort((a, b) => a[0] - b[0]);
}

/** Text of a line WITHOUT the dim runs (placeholder, ghost suggestion and hints removed). */
export function visibleText(line: LineInput): string {
  return visibleTextFrom(line, 0);
}

/** `visibleText` of the characters from index `start` on (UTF-16 index into `text`). */
export function visibleTextFrom(line: LineInput, start: number): string {
  const text = lineText(line);
  const ranges = dimRanges(line);
  if (ranges.length === 0) return text.slice(start);
  let out = '';
  let cursor = start;
  for (const [from, to] of ranges) {
    if (from > cursor) out += text.slice(cursor, from);
    cursor = Math.max(cursor, to);
  }
  return out + text.slice(cursor);
}

export function toPlainLines(lines: readonly LineInput[]): string[] {
  return lines.map(lineText);
}
