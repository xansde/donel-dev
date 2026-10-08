// 014-chat (T034/T036) — a screen line as read from the xterm buffer, with the
// *dim* attribute preserved. The CLI draws the input-box placeholder, the
// ghost suggestion and the footer hints in dim; they must never be read as
// text typed by the user (research R6/R8).

/** Half-open `[start, end)` range of indices into `ScreenLine.text` (UTF-16 code units, NOT terminal columns). */
export type DimRange = readonly [number, number];

/**
 * One rendered line. `text` is `IBufferLine.translateToString(true)`; `dim` lists the runs of
 * consecutive cells whose `IBufferCell.isDim()` is true, as indices into `text`. `[]` = none.
 */
export interface ScreenLine {
  readonly text: string;
  readonly dim: readonly DimRange[];
}

/** Detectors accept plain strings (legacy callers, no dim information) or `ScreenLine`s. */
export type LineInput = string | ScreenLine;

/** Full text of a line, dim characters included. */
export function lineText(line: LineInput): string {
  return typeof line === 'string' ? line : line.text;
}

/** Text of a line WITHOUT the dim runs (placeholder, ghost suggestion and hints removed). */
export function visibleText(line: LineInput): string {
  if (typeof line === 'string' || line.dim.length === 0) return lineText(line);
  let out = '';
  let cursor = 0;
  const ranges = [...line.dim].sort((a, b) => a[0] - b[0]);
  for (const [start, end] of ranges) {
    if (start > cursor) out += line.text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  return out + line.text.slice(cursor);
}

export function toPlainLines(lines: readonly LineInput[]): string[] {
  return lines.map(lineText);
}
