// T010 (015-jobu-pet, C3/R6) - the main tells "the owner closed the tab" from "the process left
// on its own". `pty:kill` marks the intent before killing; the exit listener consumes it.
import { describe, expect, it } from 'vitest';
import { consumeKillRequested, markKillRequested } from '../src/main/pty-kill-intent';

// The module keeps a process-wide set, so each case uses ids of its own.
describe('pty kill intent', () => {
  it('a marked ptyId is consumed once: true, then false', () => {
    markKillRequested('t10-a');
    expect(consumeKillRequested('t10-a')).toBe(true);
    expect(consumeKillRequested('t10-a')).toBe(false);
  });

  it('a ptyId that was never marked is not a kill requested by the owner', () => {
    expect(consumeKillRequested('t10-never')).toBe(false);
  });

  it('marks are per ptyId: consuming one does not touch another', () => {
    markKillRequested('t10-b1');
    markKillRequested('t10-b2');
    expect(consumeKillRequested('t10-b2')).toBe(true);
    expect(consumeKillRequested('t10-b3')).toBe(false);
    expect(consumeKillRequested('t10-b1')).toBe(true);
  });

  it('marking twice is the same as marking once', () => {
    markKillRequested('t10-c');
    markKillRequested('t10-c');
    expect(consumeKillRequested('t10-c')).toBe(true);
    expect(consumeKillRequested('t10-c')).toBe(false);
  });

  it('a mark made after a consume starts a new cycle (Retomar kills the same tab again)', () => {
    markKillRequested('t10-d');
    expect(consumeKillRequested('t10-d')).toBe(true);
    markKillRequested('t10-d');
    expect(consumeKillRequested('t10-d')).toBe(true);
  });
});
