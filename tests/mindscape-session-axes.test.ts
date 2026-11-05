import { describe, expect, it } from 'vitest';
import { deriveSessionAxes, isStalledWithNeed } from '../src/shared/mindscape/sessionAxes';

// Item 04 — the three axes of the card. They would lie without the owner noticing: a session born
// "working" before any hook, a stopped one that needs him reading as calm, a closed one promising a
// resume that is not there. Refinement: docs/refinamentos/mindscape-cartao-rico.md.

describe('deriveSessionAxes', () => {
  it('the working of the birth is "desconhecido" until a hook is heard', () => {
    expect(deriveSessionAxes({ tabOpen: true, state: 'working', unconfirmed: true })).toMatchObject({
      process: 'aberta',
      activity: 'desconhecido',
      resume: 'viva',
      needs: [],
    });
    expect(deriveSessionAxes({ tabOpen: true, state: 'working' }).activity).toBe('trabalhando');
  });

  it('"precisa de você" is a count with reasons, and makes a stopped session "parada com pendência"', () => {
    const asking = deriveSessionAxes({ tabOpen: true, state: 'permission', pendingKinds: ['question', 'permission'] });
    expect(asking).toMatchObject({ activity: 'parada', needs: ['permissão', 'pergunta'] });
    expect(isStalledWithNeed(asking)).toBe(true);
    // a permission prompt seen only by the hook (no chat pending) still names a reason
    expect(deriveSessionAxes({ tabOpen: true, state: 'permission' }).needs).toEqual(['permissão']);
    const limited = deriveSessionAxes({ tabOpen: true, state: 'waiting', turnFailure: 'rate_limit' });
    expect(limited.needs).toEqual(['limite de uso']);
    expect(isStalledWithNeed(deriveSessionAxes({ tabOpen: true, state: 'waiting' }))).toBe(false);
  });

  it('a closed session is stopped; it is resumable only when its conversation is in the folder', () => {
    expect(deriveSessionAxes({ tabOpen: false, transcriptFound: true })).toMatchObject({ process: 'fechada', activity: 'parada', resume: 'retomável' });
    expect(deriveSessionAxes({ tabOpen: false, transcriptFound: false }).resume).toBe('sem retomada');
    expect(deriveSessionAxes({ tabOpen: false }).resume).toBe('desconhecido');
    // the process left with an error while the tab is still open
    expect(deriveSessionAxes({ tabOpen: true, state: 'error' })).toMatchObject({ process: 'fechada', activity: 'parada', needs: ['erro'] });
  });
});
