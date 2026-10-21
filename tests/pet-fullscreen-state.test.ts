// T045 (015-jobu-pet, US5, R10/FR-007) - the parser of what the full-screen helper prints. The helper is a
// long-lived PowerShell that asks `SHQueryUserNotificationState` every 1.5 s and prints the state as a number,
// one per line. 2 (a full-screen app, or Presentation Settings), 3 (a D3D full-screen game) and 4 (presentation
// mode) hide the Jobu; anything else shows him, garbage and a failed call (-1) included: a helper that does not
// know must never leave the Jobu hidden.
import { describe, expect, it } from 'vitest';
import { FULLSCREEN_STATES, createFullscreenParser, parseFullscreenLine } from '../src/shared/pet/fullscreenState';

describe('parseFullscreenLine: 2, 3 and 4 hide the Jobu, the rest leaves him free', () => {
  it('the three states of SHQueryUserNotificationState that mean "an app has the whole screen"', () => {
    expect([...FULLSCREEN_STATES]).toEqual([2, 3, 4]);
    expect(parseFullscreenLine('2')).toBe(true); // QUNS_BUSY
    expect(parseFullscreenLine('3')).toBe(true); // QUNS_RUNNING_D3D_FULL_SCREEN
    expect(parseFullscreenLine('4')).toBe(true); // QUNS_PRESENTATION_MODE
  });

  it.each(['0', '1', '5', '6', '7', '8', '-1'])('the state %s leaves the Jobu free (not present, accepts notifications, quiet time, an app...)', (line) => {
    expect(parseFullscreenLine(line)).toBe(false);
  });

  it('the line is trimmed: a CR from the Windows line break, spaces and a tab do not matter', () => {
    expect(parseFullscreenLine('3\r')).toBe(true);
    expect(parseFullscreenLine('  4  ')).toBe(true);
    expect(parseFullscreenLine('\t2\r\n')).toBe(true);
    expect(parseFullscreenLine('5\r')).toBe(false);
  });

  it('garbage is free: empty, words, decimals, two numbers, hex, a number glued to text', () => {
    for (const line of ['', '   ', 'abc', 'QUNS_BUSY', '3.5', '2 3', '0x2', '2abc', 'a2', '+2', '02', '23', '2,3', 'null', 'undefined', 'NaN']) {
      expect(parseFullscreenLine(line)).toBe(false);
    }
  });

  it('only a whole line that is exactly a hiding number counts, so a number inside a longer message never hides the Jobu', () => {
    expect(parseFullscreenLine('error 3')).toBe(false);
    expect(parseFullscreenLine('3 error')).toBe(false);
    expect(parseFullscreenLine('HRESULT 0x80004005 state 4')).toBe(false);
  });
});

describe('createFullscreenParser: the helper writes a stream, and a chunk is not a line', () => {
  it('gives one answer per complete line, in order', () => {
    const parser = createFullscreenParser();
    expect(parser.push('5\r\n3\r\n5\r\n')).toEqual([false, true, false]);
  });

  it('keeps the tail of a line that is not finished until its break arrives', () => {
    const parser = createFullscreenParser();
    expect(parser.push('3')).toEqual([]);
    expect(parser.push('\r\n')).toEqual([true]);
    expect(parser.push('5\r')).toEqual([]);
    expect(parser.push('\n4')).toEqual([false]);
    expect(parser.push('\r\n')).toEqual([true]);
  });

  it('a chunk can end in the middle of the number that follows a break', () => {
    const parser = createFullscreenParser();
    expect(parser.push('5\n3')).toEqual([false]);
    expect(parser.push('\n')).toEqual([true]);
  });

  it('accepts both line breaks: LF and CRLF', () => {
    const parser = createFullscreenParser();
    expect(parser.push('2\n5\r\n4\n')).toEqual([true, false, true]);
  });

  it('a blank line is not an event (an extra break is no news), but a line of garbage is "free"', () => {
    const parser = createFullscreenParser();
    expect(parser.push('\r\n\r\n')).toEqual([]);
    expect(parser.push('lixo\r\n')).toEqual([false]);
    expect(parser.push('   \r\n')).toEqual([]);
  });

  it('takes a Buffer-like chunk as text too (the stdout of a child process)', () => {
    const parser = createFullscreenParser();
    expect(parser.push(Buffer.from('3\r\n5\r\n'))).toEqual([true, false]);
  });

  it('never grows without bound when the helper sends a flood with no line break', () => {
    const parser = createFullscreenParser();
    expect(parser.push('x'.repeat(100_000))).toEqual([]);
    // The flood was dropped: the next honest line is read on its own.
    expect(parser.push('\r\n3\r\n')).toEqual([false, true]);
  });

  it('each parser has its own buffer', () => {
    const a = createFullscreenParser();
    const b = createFullscreenParser();
    a.push('3');
    expect(b.push('\n')).toEqual([]);
    expect(a.push('\n')).toEqual([true]);
  });
});
