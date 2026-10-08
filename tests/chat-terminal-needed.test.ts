import { describe, expect, it } from 'vitest';
import {
  INITIAL_TERMINAL_NEEDED,
  SCREEN_DIALOG_DELAY_MS,
  evaluateTerminalNeeded,
  type ScreenFacts,
  type TerminalNeededState,
} from '../src/renderer/src/chat/terminalNeededModel';

const base: ScreenFacts = { blocking: null, modelDialog: false, transcriptSavingOff: false, inputReady: true, hasOpenPending: false };
const facts = (patch: Partial<ScreenFacts> = {}): ScreenFacts => ({ ...base, ...patch });
const dialog = (patch: Partial<ScreenFacts> = {}): Partial<ScreenFacts> => ({ blocking: 'question', inputReady: false, ...patch });

function run(steps: ReadonlyArray<{ at: number; facts?: Partial<ScreenFacts>; opens?: boolean }>) {
  let state: TerminalNeededState = INITIAL_TERMINAL_NEEDED;
  const results: Array<ReturnType<typeof evaluateTerminalNeeded>> = [];
  for (const step of steps) {
    const r = evaluateTerminalNeeded(state, facts(step.facts), step.at, step.opens === true);
    state = r.state;
    results.push(r);
  }
  return results;
}

describe('evaluateTerminalNeeded', () => {
  it('stays null on a ready input box', () => {
    expect(run([{ at: 0 }])[0]!.reason).toBeNull();
  });

  it('a blocking screen only counts after more than 2 s', () => {
    const r = run([
      { at: 0, facts: dialog() },
      { at: SCREEN_DIALOG_DELAY_MS, facts: dialog() },
      { at: SCREEN_DIALOG_DELAY_MS + 1, facts: dialog() },
    ]);
    expect(r[0]!.reason).toBeNull();
    expect(r[0]!.recheckInMs).toBe(SCREEN_DIALOG_DELAY_MS + 1);
    expect(r[1]!.reason).toBeNull();
    expect(r[2]!.reason).toBe('interactive-screen');
  });

  it('a permission screen maps to permission-dialog', () => {
    const r = run([
      { at: 0, facts: dialog({ blocking: 'permission' }) },
      { at: 2500, facts: dialog({ blocking: 'permission' }) },
    ]);
    expect(r[1]!.reason).toBe('permission-dialog');
  });

  it('the model dialog counts as an interactive screen', () => {
    const r = run([
      { at: 0, facts: { modelDialog: true, inputReady: false } },
      { at: 3000, facts: { modelDialog: true, inputReady: false } },
    ]);
    expect(r[1]!.reason).toBe('interactive-screen');
  });

  it('an open pending suppresses the strip (the panel handles it) and resets the timer', () => {
    const r = run([
      { at: 0, facts: dialog({ blocking: 'permission', hasOpenPending: true }) },
      { at: 5000, facts: dialog({ blocking: 'permission', hasOpenPending: true }) },
      { at: 5100, facts: dialog({ blocking: 'permission' }) },
      { at: 6000, facts: dialog({ blocking: 'permission' }) },
    ]);
    expect(r[1]!.reason).toBeNull();
    expect(r[3]!.reason).toBeNull();
  });

  it('a flicker (dialog gone, then back) restarts the 2 s window', () => {
    const r = run([{ at: 0, facts: dialog() }, { at: 1500 }, { at: 2200, facts: dialog() }, { at: 3000, facts: dialog() }]);
    expect(r[3]!.reason).toBeNull();
  });

  it('transcript saving off shows right away', () => {
    expect(run([{ at: 0, facts: { transcriptSavingOff: true } }])[0]!.reason).toBe('unrecognized');
  });

  it('clears when the input box is back without a dialog', () => {
    const r = run([{ at: 0, facts: dialog() }, { at: 2500, facts: dialog() }, { at: 2600 }]);
    expect(r[1]!.reason).toBe('interactive-screen');
    expect(r[2]!.reason).toBeNull();
  });

  it('keeps the reported reason while the box is not back (even if the dialog detector blinks)', () => {
    const r = run([{ at: 0, facts: dialog() }, { at: 2500, facts: dialog() }, { at: 2600, facts: { inputReady: false } }]);
    expect(r[2]!.reason).toBe('interactive-screen');
  });

  describe('opensScreen mark', () => {
    it('shows at once and holds through the grace period while the box is still ready', () => {
      const r = run([{ at: 0, opens: true }, { at: 500 }, { at: 1500 }]);
      expect(r.map((x) => x.reason)).toEqual(['interactive-screen', 'interactive-screen', 'interactive-screen']);
    });

    it('clears once the screen appeared and the box came back', () => {
      const r = run([
        { at: 0, opens: true },
        { at: 300, facts: { modelDialog: true, inputReady: false } },
        { at: 900, facts: { modelDialog: true, inputReady: false } },
        { at: 1000 },
      ]);
      expect(r[1]!.reason).toBe('interactive-screen');
      expect(r[3]!.reason).toBeNull();
    });

    it('clears after the grace period if the command opened nothing', () => {
      const r = run([{ at: 0, opens: true }, { at: 6000 }]);
      expect(r[1]!.reason).toBeNull();
    });
  });
});
