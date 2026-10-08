import { describe, expect, it } from 'vitest';
import { dimRanges, visibleText } from '../src/shared/screenLine';
import { bufferLineToScreenLine, estimateGridSize, withResumeArgs } from '../src/shared/terminalScreen';
import type { CellLike } from '../src/shared/terminalScreen';

// Builds a row of `cols` cells from a compact spec: [chars, width, dim].
function row(cells: Array<[string, number, boolean?]>, cols = cells.length) {
  const all: CellLike[] = cells.map(([chars, width, dim]) => ({ chars, width, dim: dim === true }));
  while (all.length < cols) all.push({ chars: '', width: 1, dim: false });
  return { cols, getCell: (x: number): CellLike | undefined => all[x] };
}

describe('bufferLineToScreenLine', () => {
  it('returns empty text and no dim for a blank line', () => {
    const line = bufferLineToScreenLine(row([], 10));
    expect(line.text).toBe('');
    expect(dimRanges(line)).toEqual([]);
  });

  it('marks dim cells with one flag per UTF-16 unit and trims trailing blanks', () => {
    const line = bufferLineToScreenLine(
      row(
        [
          ['>', 1],
          [' ', 1],
          ['t', 1, true],
          ['r', 1, true],
          ['y', 1, true],
        ],
        12
      )
    );
    expect(line.text).toBe('> try');
    expect(dimRanges(line)).toEqual([[2, 5]]);
    expect(visibleText(line)).toBe('> ');
  });

  it('keeps indices aligned with text across wide cells (width 2 + width 0)', () => {
    const line = bufferLineToScreenLine(
      row(
        [
          ['日', 2],
          ['', 0],
          ['a', 1, true],
          ['本', 2, true],
          ['', 0, true],
          ['b', 1],
        ],
        8
      )
    );
    expect(line.text).toBe('日a本b');
    expect(dimRanges(line)).toEqual([[1, 3]]);
  });

  it('counts surrogate pairs as two UTF-16 units in the mask', () => {
    const line = bufferLineToScreenLine(
      row(
        [
          ['x', 1],
          ['😀', 2, true],
          ['', 0, true],
          ['y', 1],
        ],
        6
      )
    );
    expect(line.text).toBe('x😀y');
    expect(line.text.length).toBe(4);
    expect(dimRanges(line)).toEqual([[1, 3]]);
  });

  it('renders empty interior cells as spaces', () => {
    const line = bufferLineToScreenLine(
      row([['a', 1], ['', 1], ['b', 1]], 5)
    );
    expect(line.text).toBe('a b');
  });
});

describe('estimateGridSize', () => {
  it('derives cols/rows from the area and cell metrics, minus the scrollbar', () => {
    expect(estimateGridSize({ width: 814, height: 480, cellWidth: 7, cellHeight: 16 }, 14)).toEqual({
      cols: 114,
      rows: 30,
    });
  });

  it('falls back to 80x24 when the area or the metrics are unusable', () => {
    expect(estimateGridSize({ width: 0, height: 0, cellWidth: 7, cellHeight: 16 }, 14)).toEqual({ cols: 80, rows: 24 });
    expect(estimateGridSize({ width: 800, height: 400, cellWidth: 0, cellHeight: 0 }, 14)).toEqual({
      cols: 80,
      rows: 24,
    });
  });

  it('never goes below a sane minimum', () => {
    expect(estimateGridSize({ width: 30, height: 20, cellWidth: 7, cellHeight: 16 }, 14)).toEqual({ cols: 2, rows: 1 });
  });
});

describe('withResumeArgs', () => {
  it('appends -r <id> keeping model/mode flags', () => {
    expect(withResumeArgs(['--model', 'opus', '--permission-mode', 'plan'], 'abc')).toEqual([
      '--model',
      'opus',
      '--permission-mode',
      'plan',
      '-r',
      'abc',
    ]);
  });

  it('replaces a previous resume/fork/continue', () => {
    expect(withResumeArgs(['--model', 'opus', '-r', 'old', '--fork-session'], 'new')).toEqual([
      '--model',
      'opus',
      '-r',
      'new',
    ]);
    expect(withResumeArgs(['-c'], 'x')).toEqual(['-r', 'x']);
  });

  it('handles undefined args', () => {
    expect(withResumeArgs(undefined, 'x')).toEqual(['-r', 'x']);
  });
});
