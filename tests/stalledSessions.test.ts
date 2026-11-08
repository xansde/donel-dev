import { describe, expect, it } from 'vitest';
import { emptyMindscapeDoc, placeSessionCard } from '../src/shared/mindscape/model';
import { findStalledSessions } from '../src/shared/rotinas/stalledSessions';

// Item 20 + item 04 (idea from OpenRig 80e568e9/983c80f3: an old sample no longer decides). If the `Stop` of a turn is
// lost, the semaphore stays `working` forever; the routine "sessão parada e ninguém vê" skipped every "trabalhando" and
// never found that place, so nobody would notice. A `working` with no hook for long and no call running is "sem sinal".

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 10 * 24 * HOUR;
const CONFIG = { stalledHours: 1, needsOwnerMinutes: 30 };

const doc = placeSessionCard(emptyMindscapeDoc(), '/atlas', 'beacon');

describe('findStalledSessions — old signal', () => {
  it('"working" with no hook for 2 h and no call running is "sem sinal" and becomes a finding', () => {
    const findings = findStalledSessions(doc, [{ sessionId: 'beacon', state: 'working', stateEnteredAt: NOW - 3 * HOUR, lastEventAt: NOW - 2 * HOUR, openCalls: 0 }], NOW, CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.summary).toBe('sem sinal há 2 h');
  });

  it('"working" with a long call still running stays "trabalhando": no finding', () => {
    const findings = findStalledSessions(doc, [{ sessionId: 'beacon', state: 'working', stateEnteredAt: NOW - 3 * HOUR, lastEventAt: NOW - 2 * HOUR, openCalls: 1 }], NOW, CONFIG);
    expect(findings).toEqual([]);
  });

  it('"working" with a recent hook stays "trabalhando": no finding', () => {
    const findings = findStalledSessions(doc, [{ sessionId: 'beacon', state: 'working', stateEnteredAt: NOW - 3 * HOUR, lastEventAt: NOW - 5 * MIN, openCalls: 0 }], NOW, CONFIG);
    expect(findings).toEqual([]);
  });
});
