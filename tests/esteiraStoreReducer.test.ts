import { describe, expect, it } from 'vitest';
import { reduceEvents, deriveStage, type StageInput } from '../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (D-9/D-13), vertical pequeno passo 2 — o reducer. Duas promessas
// sao testadas aqui, e as duas nasceram de um bug real:
//
// 1. DEDUPE por `dedupe_key`: reingerir o mesmo `result.json` nao duplica fato.
// 2. MACRO ETAPA DERIVADA (a tabela de passo-zero.md §2): a etapa nunca e
//    digitada, e "discovery concluido sem plano" e um estado LEGITIMO com sinal
//    proprio — nao "nao realizada" (a inverdade da evidencia 1).

let seq = 0;

function evt(type: string, payload: Record<string, unknown>, dedupeKey: string | null = null): StoreEvent {
  seq += 1;
  return {
    seq,
    event_id: `evt-${seq}`,
    at: '2026-08-03T12:00:00.000Z',
    type,
    source: { kind: 'app' },
    dedupe_key: dedupeKey,
    payload,
  };
}

function discovery(id: string, extra: Record<string, unknown> = {}): StoreEvent {
  return evt('discovery.created', {
    id,
    title: `Discovery ${id}`,
    problem: null,
    tracker: null,
    targetRepo: null,
    scopeRepos: [],
    createdAt: '2026-08-03T12:00:00.000Z',
    ...extra,
  });
}

function plan(id: string, discoveryId: string): StoreEvent {
  return evt('plan.created', {
    id,
    discoveryId,
    title: `Plano ${id}`,
    summary: null,
    createdAt: '2026-08-03T12:00:00.000Z',
  });
}

function workItem(id: string, discoveryId: string, extra: Record<string, unknown> = {}): StoreEvent {
  return evt('work_item.created', {
    id,
    discoveryId,
    planId: null,
    itemType: 'issue',
    title: `Item ${id}`,
    targetRepo: 'xansde/donel-dev',
    scopeRepos: [],
    state: 'open',
    createdBySkill: true,
    createdAt: '2026-08-03T12:00:00.000Z',
    ...extra,
  });
}

function phaseCompleted(entity: 'discovery' | 'plan' | 'work_item', id: string, phase: string, outcome: string): StoreEvent {
  return evt('phase.completed', {
    subject: { entity, id },
    phase,
    outcome,
    summary: null,
    at: '2026-08-03T12:30:00.000Z',
  });
}

describe('reduceEvents — entidades', () => {
  it('monta discoveries, planos e itens a partir dos eventos', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), plan('pln-1', 'dsc-1'), workItem('wi-1', 'dsc-1', { planId: 'pln-1' })]);

    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.discoveries[0].title).toBe('Discovery dsc-1');
    expect(snapshot.plans[0].discoveryId).toBe('dsc-1');
    expect(snapshot.workItems[0].planId).toBe('pln-1');
    // D-4: o ciclo de vida vem do tipo, nunca digitado por quem grava o evento.
    expect(snapshot.workItems[0].lifecycle).toBe('code-delivery');
  });

  it('through_seq registra ate onde o snapshot foi derivado', () => {
    const events = [discovery('dsc-1'), plan('pln-1', 'dsc-1')];
    expect(reduceEvents(events).through_seq).toBe(events[events.length - 1].seq);
    expect(reduceEvents([]).through_seq).toBe(0);
  });

  it('discovery.created repetido para o mesmo id ATUALIZA, nao duplica', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), discovery('dsc-1', { title: 'Titulo corrigido', targetRepo: 'xansde/donel' })]);

    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.discoveries[0].title).toBe('Titulo corrigido');
    expect(snapshot.discoveries[0].targetRepo).toBe('xansde/donel');
  });

  it('work_item.updated altera o estado do item existente', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1'),
      evt('work_item.updated', { id: 'wi-1', state: 'in-progress' }),
    ]);

    expect(snapshot.workItems[0].state).toBe('in-progress');
  });

  it('evento para entidade inexistente e ignorado, nunca cria fantasma', () => {
    const snapshot = reduceEvents([evt('work_item.updated', { id: 'wi-fantasma', state: 'done' })]);
    expect(snapshot.workItems).toHaveLength(0);
  });

  it('relacoes viram lista propria (D-5), e relation.removed tira da lista', () => {
    const from = { entity: 'discovery', id: 'dsc-1' };
    const to = { entity: 'work_item', id: 'wi-1' };
    const snapshot = reduceEvents([
      evt('relation.added', { relation: 'originated', from, to, recordedAt: '2026-08-03T12:00:00.000Z' }),
      evt('relation.added', { relation: 'flows_into', from, to, recordedAt: '2026-08-03T12:00:00.000Z' }),
      evt('relation.removed', { relation: 'originated', from, to }),
    ]);

    expect(snapshot.relations).toHaveLength(1);
    expect(snapshot.relations[0].relation).toBe('flows_into');
  });

  it('a trava e fato: lock.acquired entra com dono e hora, lock.released some (D-11)', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const acquired = evt('lock.acquired', {
      subject,
      phase: 'plano',
      holderKind: 'skill',
      acquiredAt: '2026-08-03T12:10:00.000Z',
      cliSessionId: 'cli-1',
      mirroredLabel: null,
    });

    const held = reduceEvents([acquired]);
    expect(held.locks).toHaveLength(1);
    expect(held.locks[0].cliSessionId).toBe('cli-1');
    expect(held.locks[0].acquiredAt).toBe('2026-08-03T12:10:00.000Z');

    const released = reduceEvents([acquired, evt('lock.released', { subject, phase: 'plano' })]);
    expect(released.locks).toHaveLength(0);
  });

  it('sessoes encadeiam por continuesSessionId dentro da mesma fase (P-6)', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('session.started', { id: 'ses-1', cliSessionId: 'cli-1', subject, phase: 'discovery', startedAt: '2026-08-03T12:00:00.000Z' }),
      evt('session.handed-off', { id: 'ses-1', reason: 'orcamento de contexto', at: '2026-08-03T13:00:00.000Z' }),
      evt('session.started', {
        id: 'ses-2',
        cliSessionId: 'cli-2',
        subject,
        phase: 'discovery',
        continuesSessionId: 'ses-1',
        handoffReason: 'orcamento de contexto',
        startedAt: '2026-08-03T13:00:00.000Z',
      }),
    ]);

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions[1].continuesSessionId).toBe('ses-1');
    expect(snapshot.sessions[0].endedAt).toBe('2026-08-03T13:00:00.000Z');
  });

  it('erro de ingestao e entidade de primeira classe, com os issues do parser (D-10)', () => {
    const snapshot = reduceEvents([
      evt('ingest.failed', {
        resultPath: 'C:/x/run-9.json',
        at: '2026-08-03T12:00:00.000Z',
        subject: { entity: 'discovery', id: 'dsc-1' },
        issues: [{ code: 'unknown_field', path: 'facts[0].fanout', message: 'unknown field "fanout"' }],
      }),
    ]);

    expect(snapshot.ingestErrors).toHaveLength(1);
    expect(snapshot.ingestErrors[0].issues[0].path).toBe('facts[0].fanout');
  });

  it('espelho que falhou vai para fila e nunca trava o trabalho local (D-12)', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('mirror.queued', { subject, operation: 'label:em-andamento', queuedAt: '2026-08-03T12:00:00.000Z' }),
      evt('mirror.failed', { subject, operation: 'label:em-andamento', error: 'timeout' }),
    ]);

    expect(snapshot.mirrorQueue).toHaveLength(1);
    expect(snapshot.mirrorQueue[0].attempts).toBe(1);
    expect(snapshot.mirrorQueue[0].lastError).toBe('timeout');

    const synced = reduceEvents([
      evt('mirror.queued', { subject, operation: 'label:em-andamento', queuedAt: '2026-08-03T12:00:00.000Z' }),
      evt('mirror.synced', { subject, operation: 'label:em-andamento' }),
    ]);
    expect(synced.mirrorQueue).toHaveLength(0);
  });
});

describe('reduceEvents — dedupe (a idempotencia da ingestao)', () => {
  it('dois eventos com a mesma dedupe_key sao o MESMO fato: o segundo e descartado', () => {
    const first = evt('discovery.created', { id: 'dsc-1', title: 'Original', createdAt: '2026-08-03T12:00:00.000Z' }, 'run-1:discovery.recorded:dsc-1');
    const again = evt('discovery.created', { id: 'dsc-1', title: 'Reprocessado', createdAt: '2026-08-03T12:00:00.000Z' }, 'run-1:discovery.recorded:dsc-1');

    const snapshot = reduceEvents([first, again]);
    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.discoveries[0].title).toBe('Original');
  });

  it('dedupe_key null nunca deduplica — sao gestos distintos', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      evt('note.added', { subject, text: 'primeira', at: '2026-08-03T12:00:00.000Z' }),
      evt('note.added', { subject, text: 'segunda', at: '2026-08-03T12:01:00.000Z' }),
    ]);
    expect(snapshot.notes).toHaveLength(2);
  });
});

describe('reduceEvents — o formato preserva o que nao entende', () => {
  it('evento de tipo desconhecido nao derruba a leitura nem some do historico', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), evt('tipo.do.canal.futuro', { qualquer: 'coisa' }), plan('pln-1', 'dsc-1')]);

    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.plans).toHaveLength(1);
  });

  it('payload malformado e ignorado sem lancar', () => {
    expect(() => reduceEvents([evt('discovery.created', {}), evt('plan.created', { id: 'pln-1' })])).not.toThrow();
    expect(reduceEvents([evt('discovery.created', {})]).discoveries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D-13 — a tabela de derivacao de macro etapa (passo-zero.md §2)
// ---------------------------------------------------------------------------

function stageOf(input: Partial<StageInput>): ReturnType<typeof deriveStage> {
  return deriveStage({ discoveryConcluded: false, discoveryOutcome: null, planCount: 0, items: [], ...input });
}

describe('deriveStage', () => {
  it('discovery em curso: etapa discovery, sem sinal', () => {
    expect(stageOf({})).toEqual({ stage: 'discovery', signals: [] });
  });

  it('discovery concluido e ZERO plano: etapa discovery com o sinal completed-without-plan (o card F3)', () => {
    expect(stageOf({ discoveryConcluded: true, discoveryOutcome: 'done' })).toEqual({
      stage: 'discovery',
      signals: ['completed-without-plan'],
    });
  });

  it('discovery abandonado sem plano NAO ganha o sinal — abandonar nao e concluir sem planejar', () => {
    expect(stageOf({ discoveryConcluded: true, discoveryOutcome: 'abandoned' }).signals).toEqual([]);
  });

  it('ao menos um plano e nenhum item iniciado: planned', () => {
    expect(stageOf({ discoveryConcluded: true, discoveryOutcome: 'done', planCount: 1 }).stage).toBe('planned');
    expect(stageOf({ discoveryConcluded: true, discoveryOutcome: 'done', planCount: 1, items: [{ state: 'open', everConcluded: false }] }).stage).toBe('planned');
  });

  it('item em curso: execution', () => {
    expect(
      stageOf({ discoveryConcluded: true, discoveryOutcome: 'done', planCount: 1, items: [{ state: 'in-progress', everConcluded: false }] }).stage,
    ).toBe('execution');
  });

  it('todos os itens done ou abandoned: done', () => {
    expect(
      stageOf({
        discoveryConcluded: true,
        discoveryOutcome: 'done',
        planCount: 1,
        items: [
          { state: 'done', everConcluded: true },
          { state: 'abandoned', everConcluded: true },
        ],
      }).stage,
    ).toBe('done');
  });

  it('item REABERTO depois de concluido faz a etapa RETROCEDER para execution', () => {
    expect(
      stageOf({
        discoveryConcluded: true,
        discoveryOutcome: 'done',
        planCount: 1,
        items: [
          { state: 'done', everConcluded: true },
          { state: 'open', everConcluded: true },
        ],
      }).stage,
    ).toBe('execution');
  });

  it('discovery ainda em curso vence, mesmo com plano ja registrado (a tabela e ordenada)', () => {
    expect(stageOf({ planCount: 2, items: [{ state: 'in-progress', everConcluded: false }] }).stage).toBe('discovery');
  });
});

describe('reduceEvents — a etapa sai do grafo, nunca do teclado', () => {
  it('deriva a etapa de cada discovery a partir dos seus proprios eventos', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      phaseCompleted('discovery', 'dsc-1', 'discovery', 'done'),
      discovery('dsc-2'),
      phaseCompleted('discovery', 'dsc-2', 'discovery', 'done'),
      plan('pln-2', 'dsc-2'),
      workItem('wi-2', 'dsc-2', { planId: 'pln-2' }),
      evt('work_item.updated', { id: 'wi-2', state: 'in-progress' }),
    ]);

    const [first, second] = snapshot.discoveries;
    expect(first.derivedStage).toBe('discovery');
    expect(first.stageSignals).toContain('completed-without-plan');
    expect(second.derivedStage).toBe('execution');
    expect(second.stageSignals).not.toContain('completed-without-plan');
  });

  it('item sem plano marca orphan-item no discovery de origem', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      phaseCompleted('discovery', 'dsc-1', 'discovery', 'done'),
      workItem('wi-1', 'dsc-1'),
    ]);

    expect(snapshot.discoveries[0].stageSignals).toContain('orphan-item');
  });

  it('erro de ingestao e espelho pendente aparecem como sinal no card', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-03T12:00:00.000Z', subject, issues: [] }),
      evt('mirror.queued', { subject, operation: 'label', queuedAt: '2026-08-03T12:00:00.000Z' }),
    ]);

    expect(snapshot.discoveries[0].stageSignals).toContain('ingest-error');
    expect(snapshot.discoveries[0].stageSignals).toContain('mirror-pending');
  });

  it('override manual e marcado como tal, e a etapa derivada continua visivel ao lado', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      evt('stage.overridden', { discoveryId: 'dsc-1', value: 'done', by: 'alexandre', at: '2026-08-03T13:00:00.000Z', reason: 'entregue fora do app' }),
    ]);

    expect(snapshot.discoveries[0].stageOverride?.value).toBe('done');
    expect(snapshot.discoveries[0].stageOverride?.by).toBe('alexandre');
    // A derivada NAO e sobrescrita — o ajuste manual nunca engana quem le.
    expect(snapshot.discoveries[0].derivedStage).toBe('discovery');
  });

  it('stage.override.cleared devolve o card a etapa derivada', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      evt('stage.overridden', { discoveryId: 'dsc-1', value: 'done', by: 'alexandre', at: '2026-08-03T13:00:00.000Z', reason: null }),
      evt('stage.override.cleared', { discoveryId: 'dsc-1' }),
    ]);

    expect(snapshot.discoveries[0].stageOverride).toBeNull();
  });
});
