// 014-chat (T039) — pure helpers behind TerminalPane's `readScreen()` and its
// hidden-spawn sizing. Kept free of xterm/DOM types so they run under vitest.

import type { ScreenLine } from './screenLine';

/** Minimal view of an xterm `IBufferCell`. */
export interface CellLike {
  /** `IBufferCell.getChars()`; `''` for an empty cell or for the trailing half of a wide char. */
  readonly chars: string;
  /** `IBufferCell.getWidth()`: 1 normal, 2 wide, 0 = continuation of the wide cell before it. */
  readonly width: number;
  /** `IBufferCell.isDim()`. */
  readonly dim: boolean;
}

/** Minimal view of an xterm `IBufferLine`. */
export interface RowLike {
  readonly cols: number;
  getCell(x: number): CellLike | undefined;
}

/**
 * Buffer row -> `ScreenLine`. `text` equals `translateToString(true)`
 * (trailing blanks trimmed; empty interior cells are spaces); `dim` has one
 * flag per UTF-16 unit of `text`. Width-0 cells are skipped (their wide
 * neighbour already carries the glyph), so mask indices always match `text`.
 */
export function bufferLineToScreenLine(row: RowLike): ScreenLine {
  let text = '';
  const dim: boolean[] = [];
  for (let x = 0; x < row.cols; x += 1) {
    const cell = row.getCell(x);
    if (!cell || cell.width === 0) continue;
    const chars = cell.chars === '' ? ' ' : cell.chars;
    text += chars;
    for (let i = 0; i < chars.length; i += 1) dim.push(cell.dim);
  }
  const trimmed = text.replace(/ +$/, '');
  return { text: trimmed, dim: dim.slice(0, trimmed.length) };
}

export interface GridArea {
  /** Pixel size of the (nearest visible) area the terminal will occupy. */
  readonly width: number;
  readonly height: number;
  /** CSS pixel size of one terminal cell. */
  readonly cellWidth: number;
  readonly cellHeight: number;
}

export const FALLBACK_GRID = { cols: 80, rows: 24 } as const;

/**
 * Grid for a terminal whose element has no layout (hidden tab, `fit()` is a
 * no-op): area / cell metrics, minus the scrollbar like addon-fit does.
 * Unusable inputs fall back to 80x24.
 */
export function estimateGridSize(area: GridArea, scrollbarWidth: number): { cols: number; rows: number } {
  const { width, height, cellWidth, cellHeight } = area;
  if (!(width > 0 && height > 0 && cellWidth > 0 && cellHeight > 0)) return { ...FALLBACK_GRID };
  return {
    cols: Math.max(2, Math.floor((width - scrollbarWidth) / cellWidth)),
    rows: Math.max(1, Math.floor(height / cellHeight)),
  };
}

/** Argv for a respawn that resumes `sessionId`: same model/mode flags, any previous `-r`/`--fork-session`/`-c`/`--session-id` replaced. */
export function withResumeArgs(args: readonly string[] | undefined, sessionId: string): string[] {
  const out: string[] = [];
  const source = args ?? [];
  for (let i = 0; i < source.length; i += 1) {
    const arg = source[i];
    if (arg === '-r' || arg === '--session-id') {
      i += 1;
      continue;
    }
    if (arg === '--fork-session' || arg === '-c') continue;
    out.push(arg);
  }
  out.push('-r', sessionId);
  return out;
}
