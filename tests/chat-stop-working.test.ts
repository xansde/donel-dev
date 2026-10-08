import { describe, expect, it, vi } from 'vitest';
import { ESC, shouldStopOnEsc, stopWorking } from '../src/renderer/src/chat/stopWorking';

const bar = '─'.repeat(40);
const screen = (footer: string): string[] => ['Claude Code', '', bar, '❯ ', bar, footer];
const terminal = (lines: string[]) => ({ readScreen: () => ({ lines }), write: vi.fn(() => true) });

describe('stopWorking', () => {
  it('writes Esc only when the footer shows "esc to interrupt"', () => {
    const t = terminal(screen('  esc to interrupt'));
    expect(stopWorking(t)).toBe(true);
    expect(t.write).toHaveBeenCalledWith(ESC);
  });

  it('never writes Esc on an idle screen (it would clear the box or close a menu)', () => {
    const t = terminal(screen('  ? for shortcuts'));
    expect(stopWorking(t)).toBe(false);
    expect(t.write).not.toHaveBeenCalled();
  });

  it('is a no-op without a terminal', () => {
    expect(stopWorking(null)).toBe(false);
  });
});

describe('shouldStopOnEsc (FR-008 / D-C24, case 5)', () => {
  it('stops when working, nothing handled the key and no pending is open', () => {
    expect(shouldStopOnEsc({ defaultPrevented: false, working: true, openPendings: 0 })).toBe(true);
  });
  it('yields to an inner handler that already took the Esc', () => {
    expect(shouldStopOnEsc({ defaultPrevented: true, working: true, openPendings: 0 })).toBe(false);
  });
  it('yields to an open pending (phase 4: Esc denies)', () => {
    expect(shouldStopOnEsc({ defaultPrevented: false, working: true, openPendings: 1 })).toBe(false);
  });
  it('does nothing when not working', () => {
    expect(shouldStopOnEsc({ defaultPrevented: false, working: false, openPendings: 0 })).toBe(false);
  });
});
