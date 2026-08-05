import { describe, expect, it } from 'vitest';
import { orphanedSessionCandidates } from '../src/shared/esteira/store/reconcile';
import { emptySnapshot } from '../src/shared/esteira/store/reducer';
import type { SessionSnapshot, StoreSnapshot } from '../src/shared/esteira/store/storeFormat';

// A7 — a parte PURA da reconciliação manifesto-sem-result: SÓ decide quais
// sessões são candidatas a "a fase morreu entre o manifesto e o result do
// outbox". O lado que pergunta ao disco (`main/esteira-dispatch.ts`) é quem
// decide o que fazer com cada candidata.

function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: 'ses-1',
    cliSessionId: null,
    subject: { entity: 'discovery', id: 'dsc-1' },
    phase: 'discovery',
    continuesSessionId: null,
    handoffReason: null,
    cwd: null,
    model: null,
    effort: null,
    modelEffortAssumed: false,
    startedAt: '2026-08-05T12:00:00.000Z',
    endedAt: null,
    endReason: null,
    inputPath: 'C:/inbox/run-1.json',
    resultPath: 'C:/outbox/run-1.json',
    claimed: false,
    ...overrides,
  };
}

function snapshotWith(sessions: readonly SessionSnapshot[]): StoreSnapshot {
  return { ...emptySnapshot(), sessions };
}

describe('orphanedSessionCandidates', () => {
  it('sessao aberta com resultPath e candidata', () => {
    const candidates = orphanedSessionCandidates(snapshotWith([session()]));
    expect(candidates.map((entry) => entry.id)).toEqual(['ses-1']);
  });

  it('sessao ja encerrada NAO e candidata — ela ja tem desfecho', () => {
    const candidates = orphanedSessionCandidates(snapshotWith([session({ endedAt: '2026-08-05T13:00:00.000Z' })]));
    expect(candidates).toHaveLength(0);
  });

  it('sessao sem resultPath NAO e candidata — nao ha "manifesto sem result" para checar', () => {
    const candidates = orphanedSessionCandidates(snapshotWith([session({ resultPath: null })]));
    expect(candidates).toHaveLength(0);
  });

  it('sessao HANDED-OFF (encerrada com sucessora) nao e candidata; a sucessora e', () => {
    const anterior = session({ id: 'ses-1', endedAt: '2026-08-05T12:30:00.000Z', handoffReason: 'orcamento de contexto' });
    const sucessora = session({ id: 'ses-2', continuesSessionId: 'ses-1', resultPath: 'C:/outbox/run-2.json' });
    const candidates = orphanedSessionCandidates(snapshotWith([anterior, sucessora]));
    expect(candidates.map((entry) => entry.id)).toEqual(['ses-2']);
  });

  it('lista vazia sem sessoes', () => {
    expect(orphanedSessionCandidates(emptySnapshot())).toEqual([]);
  });
});
