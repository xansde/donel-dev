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

  // A5 — o CUSTO: o payload carrega o que o arquivo declararia, e o snapshot preserva.
  it('o erro de ingestao guarda os fatos declarados — o CUSTO do arquivo recusado (A5)', () => {
    const snapshot = reduceEvents([
      evt('ingest.failed', {
        resultPath: 'C:/x/run-9.json',
        at: '2026-08-03T12:00:00.000Z',
        subject: { entity: 'plan', id: 'pln-1' },
        issues: [{ code: 'unknown_field', path: 'facts[3].fanout', message: 'x' }],
        declaredFacts: [{ factType: 'work_item.recorded', entity: 'work_item', id: 'wi-1', title: 'Instrumentar a fila' }],
      }),
    ]);

    expect(snapshot.ingestErrors[0].declaredFacts).toEqual([
      { factType: 'work_item.recorded', entity: 'work_item', id: 'wi-1', title: 'Instrumentar a fila' },
    ]);
  });

  it('erro sem declaredFacts no payload (evento antigo) devolve lista vazia, nunca quebra (A5)', () => {
    const snapshot = reduceEvents([evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-03T12:00:00.000Z', subject: null, issues: [] })]);
    expect(snapshot.ingestErrors[0].declaredFacts).toEqual([]);
  });

  // A6 — a recuperacao e um FATO proprio: o `ingest.failed` fica no LOG, so o
  // status DE AGORA (snapshot) para de mostrar aquele path como pendente.
  describe('ingest.recovered — o erro superado sai da lista, sem sumir do log (A6)', () => {
    it('o path recuperado sai de ingestErrors e entra em ingestRecoveries', () => {
      const snapshot = reduceEvents([
        evt('ingest.failed', {
          resultPath: 'C:/x/run-9.json',
          at: '2026-08-03T12:00:00.000Z',
          subject: { entity: 'discovery', id: 'dsc-1' },
          issues: [{ code: 'unknown_field', path: 'facts[0].fanout', message: 'x' }],
        }),
        evt('ingest.recovered', {
          resultPath: 'C:/x/run-9.json',
          at: '2026-08-05T09:00:00.000Z',
          runId: 'run-9',
          subject: { entity: 'discovery', id: 'dsc-1' },
          recoveredCodes: ['unknown_field'],
          how: 'o documento agora passa no contrato',
        }),
      ]);

      expect(snapshot.ingestErrors).toHaveLength(0);
      expect(snapshot.ingestRecoveries).toHaveLength(1);
      expect(snapshot.ingestRecoveries[0].how).toBe('o documento agora passa no contrato');
      expect(snapshot.ingestRecoveries[0].recoveredCodes).toEqual(['unknown_field']);
    });

    it('o ingest.failed ORIGINAL continua no LOG — a recuperacao nao apaga historia', () => {
      const events = [
        evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-03T12:00:00.000Z', subject: null, issues: [] }),
        evt('ingest.recovered', { resultPath: 'C:/x.json', at: '2026-08-05T09:00:00.000Z', runId: null, subject: null, recoveredCodes: [], how: 'sumiu' }),
      ];
      const snapshot = reduceEvents(events);

      // O log passado (a lista de eventos) continua tendo os dois — o
      // reducer so decide o que aparece no SNAPSHOT, nunca reescreve entrada.
      expect(events.some((event) => event.type === 'ingest.failed')).toBe(true);
      expect(snapshot.through_seq).toBe(events[events.length - 1].seq);
    });

    it('o sinal ingest-error do card SOME quando o path dele e recuperado', () => {
      const subject = { entity: 'discovery', id: 'dsc-1' };
      const snapshot = reduceEvents([
        discovery('dsc-1'),
        evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-03T12:00:00.000Z', subject, issues: [] }),
        evt('ingest.recovered', { resultPath: 'C:/x.json', at: '2026-08-05T09:00:00.000Z', runId: null, subject, recoveredCodes: [], how: 'x' }),
      ]);

      expect(snapshot.discoveries[0].stageSignals).not.toContain('ingest-error');
    });

    it('um SEGUNDO erro no mesmo path, depois de recuperado, volta a acender o sinal', () => {
      const subject = { entity: 'discovery', id: 'dsc-1' };
      const snapshot = reduceEvents([
        discovery('dsc-1'),
        evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-03T12:00:00.000Z', subject, issues: [] }),
        evt('ingest.recovered', { resultPath: 'C:/x.json', at: '2026-08-05T09:00:00.000Z', runId: null, subject, recoveredCodes: [], how: 'x' }),
        evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-06T09:00:00.000Z', subject, issues: [{ code: 'unknown_field', path: 'x', message: 'x' }] }),
      ]);

      // A ULTIMA palavra sobre o path e "falhou de novo" — nao fica preso no
      // status da primeira recuperacao.
      expect(snapshot.ingestErrors).toHaveLength(1);
      expect(snapshot.ingestRecoveries).toHaveLength(0);
      expect(snapshot.discoveries[0].stageSignals).toContain('ingest-error');
    });
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

  it('a fila guarda O QUE mandar — reenviar sem conteudo seria adivinhar (D-12)', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('mirror.queued', { subject, operation: 'column', payload: { column: 'Plano' }, queuedAt: '2026-08-03T12:00:00.000Z' }),
    ]);

    expect(snapshot.mirrorQueue[0].payload).toEqual({ column: 'Plano' });
  });

  it('re-enfileirar a mesma operacao atualiza o conteudo e PRESERVA as tentativas', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('mirror.queued', { subject, operation: 'column', payload: { column: 'Discovery' }, queuedAt: '2026-08-03T12:00:00.000Z' }),
      evt('mirror.failed', { subject, operation: 'column', error: 'sem rede' }),
      evt('mirror.queued', { subject, operation: 'column', payload: { column: 'Plano' }, queuedAt: '2026-08-03T13:00:00.000Z' }),
    ]);

    expect(snapshot.mirrorQueue).toHaveLength(1);
    // A intencao de AGORA: mandar a coluna velha seria espelhar um passado que ja nao existe.
    expect(snapshot.mirrorQueue[0].payload).toEqual({ column: 'Plano' });
    // Zerar a contagem a cada gesto faria o teto de tentativas nunca chegar.
    expect(snapshot.mirrorQueue[0].attempts).toBe(1);
    expect(snapshot.mirrorQueue[0].queuedAt).toBe('2026-08-03T12:00:00.000Z');
  });

  it('o que o board ja reflete fica REGISTRADO — sem isso, a mesma etiqueta voltaria para sempre', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('mirror.queued', { subject, operation: 'label', payload: { labels: ['esteira:em-andamento:plano'] } }),
      evt('mirror.synced', { subject, operation: 'label', at: '2026-08-03T12:05:00.000Z' }),
    ]);

    expect(snapshot.mirrorQueue).toHaveLength(0);
    expect(snapshot.mirrorSynced).toHaveLength(1);
    // O conteudo vem da fila quando o evento de sync nao o repete.
    expect(snapshot.mirrorSynced[0].payload).toEqual({ labels: ['esteira:em-andamento:plano'] });
    expect(snapshot.mirrorSynced[0].at).toBe('2026-08-03T12:05:00.000Z');
  });
});

// E2 — a LAPIDE: `work_item.discarded` tira o item de `workItems`, mas o card
// continua sabendo o que era, de quem era, quando e por que saiu.
describe('work_item.discarded — a lápide do item que saiu (E2)', () => {
  it('a entidade sai de workItems e a lápide entra em tombstones', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { itemType: 'spike', title: 'Medir onde o lote para' }),
      evt('work_item.discarded', { id: 'wi-1', at: '2026-08-05T14:22:00.000Z', reason: 'nasceu duplicado' }),
    ]);

    expect(snapshot.workItems).toHaveLength(0);
    expect(snapshot.tombstones).toHaveLength(1);
    expect(snapshot.tombstones[0]).toEqual({
      id: 'wi-1',
      discoveryId: 'dsc-1',
      title: 'Medir onde o lote para',
      itemType: 'spike',
      discardedAt: '2026-08-05T14:22:00.000Z',
      reason: 'nasceu duplicado',
    });
  });

  it('reason ausente vira null — o card nao inventa por que o item saiu', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), workItem('wi-1', 'dsc-1'), evt('work_item.discarded', { id: 'wi-1', at: '2026-08-05T14:22:00.000Z' })]);
    expect(snapshot.tombstones[0].reason).toBeNull();
  });

  it('descartar um id que nao existe nao cria lápide fantasma', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), evt('work_item.discarded', { id: 'wi-fantasma', at: '2026-08-05T14:22:00.000Z', reason: null })]);
    expect(snapshot.tombstones).toHaveLength(0);
  });

  it('a lápide do card mantém o sinal de erro ancorado no item — ela não vira órfã (E2)', () => {
    const subject = { entity: 'work_item', id: 'wi-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1'),
      evt('ingest.failed', { resultPath: 'C:/x.json', at: '2026-08-03T12:00:00.000Z', subject, issues: [] }),
      evt('work_item.discarded', { id: 'wi-1', at: '2026-08-05T14:22:00.000Z', reason: null }),
    ]);

    // O item saiu, mas o card continua contando o erro de ingestão que era dele.
    expect(snapshot.discoveries[0].stageSignals).toContain('ingest-error');
  });
});

// A7 — por que a sessão terminou, quando `session.ended` (não handoff) o disse.
describe('session.ended — o motivo fica legível no snapshot (A7)', () => {
  it('endReason carrega o motivo de UMA sessão encerrada sem handoff', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('session.started', { id: 'ses-1', subject, phase: 'discovery', startedAt: '2026-08-03T12:00:00.000Z' }),
      evt('session.ended', { id: 'ses-1', at: '2026-08-03T13:00:00.000Z', reason: 'o app reiniciou antes do result aparecer' }),
    ]);

    expect(snapshot.sessions[0].endReason).toBe('o app reiniciou antes do result aparecer');
  });

  it('session.handed-off NAO grava em endReason — ele tem sucessora, não é interrupção', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('session.started', { id: 'ses-1', subject, phase: 'discovery', startedAt: '2026-08-03T12:00:00.000Z' }),
      evt('session.handed-off', { id: 'ses-1', reason: 'orcamento de contexto', at: '2026-08-03T13:00:00.000Z' }),
    ]);

    expect(snapshot.sessions[0].endReason).toBeNull();
    expect(snapshot.sessions[0].handoffReason).toBe('orcamento de contexto');
  });

  it('sem reason declarado, endReason fica null — ninguem inventa motivo', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      evt('session.started', { id: 'ses-1', subject, phase: 'discovery', startedAt: '2026-08-03T12:00:00.000Z' }),
      evt('session.ended', { id: 'ses-1', at: '2026-08-03T13:00:00.000Z' }),
    ]);
    expect(snapshot.sessions[0].endReason).toBeNull();
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

  // Spec 010 (B7) — o erro de ingestao de um ITEM tambem e do card. Com as
  // fases de item na skill 3.0 (implementar, validar, documentar, concluir), a
  // maioria dos `result.json` recusados passa a vir ancorada num work item; se
  // o sinal so olhasse o discovery, o card ficaria LIMPO na lista enquanto um
  // documento foi recusado — o silencio que a spec inteira existe para acabar.
  it('erro de ingestao ancorado num item do card tambem acende o sinal do card', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      plan('pln-1', 'dsc-1'),
      workItem('wi-1', 'dsc-1', { planId: 'pln-1' }),
      evt('ingest.failed', {
        resultPath: 'C:/outbox/validar-sem-verificacao.json',
        at: '2026-08-03T12:00:00.000Z',
        subject: { entity: 'work_item', id: 'wi-1' },
        issues: [{ code: 'missing_required_fact', path: 'facts', message: 'x' }],
      }),
    ]);

    expect(snapshot.discoveries[0].stageSignals).toContain('ingest-error');
  });

  it('erro de ingestao de um item de OUTRO card nao acende o sinal deste', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      discovery('dsc-2'),
      workItem('wi-2', 'dsc-2'),
      evt('ingest.failed', {
        resultPath: 'C:/outbox/x.json',
        at: '2026-08-03T12:00:00.000Z',
        subject: { entity: 'work_item', id: 'wi-2' },
        issues: [],
      }),
    ]);

    expect(snapshot.discoveries[0].stageSignals).not.toContain('ingest-error');
    expect(snapshot.discoveries[1].stageSignals).toContain('ingest-error');
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

describe('a trava cai quando a fase termina — nunca fica órfã', () => {
  it('phase.completed libera a trava daquela fase e encerra a sessão', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      evt('lock.acquired', { subject, phase: 'discovery', holderKind: 'app', acquiredAt: '2026-08-03T12:00:00.000Z' }),
      evt('session.started', { id: 'ses-1', subject, phase: 'discovery', startedAt: '2026-08-03T12:00:00.000Z' }),
      phaseCompleted('discovery', 'dsc-1', 'discovery', 'done'),
    ]);

    expect(snapshot.locks).toHaveLength(0);
    expect(snapshot.sessions[0].endedAt).not.toBeNull();
  });

  it('phase.failed também libera — o card volta a aceitar disparo, e a falha fica visível', () => {
    const subject = { entity: 'work_item', id: 'wi-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1'),
      evt('lock.acquired', { subject, phase: 'implementar', holderKind: 'skill', acquiredAt: '2026-08-03T12:00:00.000Z' }),
      evt('phase.failed', { subject, phase: 'implementar', failure: { code: 'worktree-dirty', message: 'x' }, at: '2026-08-03T12:30:00.000Z' }),
    ]);

    expect(snapshot.locks).toHaveLength(0);
    expect(snapshot.phases.find((phase) => phase.phase === 'implementar')?.failure?.code).toBe('worktree-dirty');
  });

  it('a trava de OUTRA fase do mesmo assunto não é afetada', () => {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      evt('lock.acquired', { subject, phase: 'plano', holderKind: 'app', acquiredAt: '2026-08-03T12:00:00.000Z' }),
      phaseCompleted('discovery', 'dsc-1', 'discovery', 'done'),
    ]);

    expect(snapshot.locks).toHaveLength(1);
    expect(snapshot.locks[0].phase).toBe('plano');
  });
});

// Batch B1 — a sessão preparada passa a ser assumida DE VERDADE quando o CLI
// devolve o id dela. Antes disso, o card diz "preparada"; depois, "em
// andamento" — e a diferença entre as duas é um fato, não uma suposição.
describe('session.claimed — a sessão ganha dono', () => {
  const subject = { entity: 'discovery', id: 'dsc-1' };

  function preparada(): StoreEvent[] {
    return [
      discovery('dsc-1'),
      evt('lock.acquired', { subject, phase: 'discovery', holderKind: 'app', acquiredAt: '2026-08-03T12:00:00.000Z', cliSessionId: null }),
      evt('session.started', { id: 'ses-1', subject, phase: 'discovery', startedAt: '2026-08-03T12:00:00.000Z' }),
    ];
  }

  it('a sessão nasce NÃO assumida — disparar não é começar', () => {
    const snapshot = reduceEvents(preparada());
    expect(snapshot.sessions[0].claimed).toBe(false);
    expect(snapshot.sessions[0].cliSessionId).toBeNull();
  });

  it('o id do CLI vira o dono da sessão E da trava (D-11: dono, hora e sessão)', () => {
    const snapshot = reduceEvents([
      ...preparada(),
      evt('session.claimed', { id: 'ses-1', cliSessionId: 'cli-abc', at: '2026-08-03T12:01:00.000Z' }),
    ]);

    expect(snapshot.sessions[0].claimed).toBe(true);
    expect(snapshot.sessions[0].cliSessionId).toBe('cli-abc');
    expect(snapshot.locks[0].cliSessionId).toBe('cli-abc');
  });

  it('assumir sessão que não existe não inventa sessão nenhuma', () => {
    const snapshot = reduceEvents([...preparada(), evt('session.claimed', { id: 'ses-fantasma', cliSessionId: 'cli-abc' })]);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].claimed).toBe(false);
  });

  it('a trava de outra fase não ganha dono por tabela', () => {
    const snapshot = reduceEvents([
      ...preparada(),
      evt('lock.acquired', { subject, phase: 'plano', holderKind: 'app', acquiredAt: '2026-08-03T12:00:00.000Z' }),
      evt('session.claimed', { id: 'ses-1', cliSessionId: 'cli-abc' }),
    ]);

    expect(snapshot.locks.find((lock) => lock.phase === 'plano')?.cliSessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Proveniencia (D-2) — semeado x declarado
// ---------------------------------------------------------------------------

/** O mesmo `evt`, mas com `source: { kind: 'seed' }` — a afirmacao humana. */
function semeado(type: string, payload: Record<string, unknown>): StoreEvent {
  return { ...evt(type, payload), source: { kind: 'seed' } };
}

describe('reduceEvents — proveniencia do que foi SEMEADO (D-2)', () => {
  it('discovery, plano e item plantados por seed saem marcados', () => {
    const snapshot = reduceEvents([
      semeado('discovery.created', { id: 'dsc-1', title: 'Semeado', createdAt: '2026-08-03T12:00:00.000Z' }),
      semeado('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Plano semeado' }),
      semeado('work_item.created', { id: 'wi-1', discoveryId: 'dsc-1', itemType: 'issue', title: 'Item semeado', state: 'in-progress' }),
    ]);

    expect(snapshot.discoveries[0].seeded).toBe(true);
    expect(snapshot.plans[0].seeded).toBe(true);
    expect(snapshot.workItems[0].seeded).toBe(true);
  });

  it('o que veio declarado por skill NAO ganha a marca', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), plan('pln-1', 'dsc-1'), workItem('wi-1', 'dsc-1')]);

    expect(snapshot.discoveries[0].seeded).toBe(false);
    expect(snapshot.plans[0].seeded).toBe(false);
    expect(snapshot.workItems[0].seeded).toBe(false);
  });

  it('a marca da ENTIDADE e da origem e nao se apaga: skill declarando fato novo nao reescreve como foi plantada', () => {
    // O corpus da skill faz upsert de `discovery.recorded` a cada run. Se a
    // marca seguisse o ultimo evento, o card semeado se disfarcaria de card
    // observado no primeiro disparo — que e justamente o que ela existe para
    // impedir.
    const snapshot = reduceEvents([
      semeado('discovery.created', { id: 'dsc-1', title: 'Semeado', createdAt: '2026-08-03T12:00:00.000Z' }),
      discovery('dsc-1', { title: 'Mesmo card, agora com fato da skill' }),
    ]);

    expect(snapshot.discoveries[0].title).toBe('Mesmo card, agora com fato da skill');
    expect(snapshot.discoveries[0].seeded).toBe(true);
  });

  it('a marca da FASE segue o ultimo fato: um run de verdade em cima da fase semeada tira a marca', () => {
    // A fase e um estado de AGORA, nao uma origem: o que vale e quem afirmou o
    // ultimo desfecho. Semeada e depois de fato executada = observada.
    const semeada = reduceEvents([
      semeado('discovery.created', { id: 'dsc-1', title: 'Semeado' }),
      semeado('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done' }),
    ]);
    expect(semeada.phases[0].seeded).toBe(true);

    const reexecutada = reduceEvents([
      semeado('discovery.created', { id: 'dsc-1', title: 'Semeado' }),
      semeado('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done' }),
      phaseCompleted('discovery', 'dsc-1', 'discovery', 'done'),
    ]);
    expect(reexecutada.phases[0].seeded).toBe(false);
  });

  it('a etapa de um card semeado e DERIVADA dos fatos semeados, como qualquer outra', () => {
    const snapshot = reduceEvents([
      semeado('discovery.created', { id: 'dsc-1', title: 'Semeado' }),
      semeado('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done' }),
      semeado('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Plano' }),
      semeado('work_item.created', { id: 'wi-1', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'issue', title: 'A', state: 'in-progress' }),
      semeado('work_item.created', { id: 'wi-2', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'spike', title: 'B', state: 'open' }),
    ]);

    expect(snapshot.discoveries[0].derivedStage).toBe('execution');
    expect(snapshot.discoveries[0].stageOverride).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O estado do item sai do grafo (D-13 aplicado ao item)
// ---------------------------------------------------------------------------
//
// Achado do roteiro e2e `ciclo-completo-de-item` (04/08/2026, batch B7): o print
// mostrava seis fases concluídas, "PR mergeado e verificado" — e, logo abaixo,
// o item "aberto" e a etapa "Planejado". A tela afirmava que ninguém tinha
// começado um trabalho que ela mesma mostrava terminado.
//
// A causa não era a tela: `work_item.recorded` nascia `open` e NADA movia o
// estado depois. `open` não era afirmação de ninguém — era default de
// nascimento inventado na ingestão, exatamente o "estado digitado" que D-13
// proíbe. Agora o estado é derivado das fases que tomam o item por assunto.

describe('o estado do item sai do grafo — nenhum default finge saber', () => {
  function itemState(snapshot: ReturnType<typeof reduceEvents>, id: string): string | undefined {
    return snapshot.workItems.find((item) => item.id === id)?.state;
  }

  it('item recém-declarado pela skill nasce aberto — nenhuma fase o tomou ainda', () => {
    const snapshot = reduceEvents([discovery('dsc-1'), workItem('wi-1', 'dsc-1', { state: undefined })]);
    expect(itemState(snapshot, 'wi-1')).toBe('open');
  });

  it('DISPARAR a fase não move o item — o app grava phase.started ao preparar, e preparar não é começar', () => {
    // O disparo real grava os três de uma vez, e a tela lê "Preparada — ninguém
    // assumiu ainda". O primeiro roteiro deste batch fotografou essa frase com
    // o item "em curso" logo abaixo: a mesma contradição de sempre, agora entre
    // duas linhas da MESMA tela.
    const subject = { entity: 'work_item', id: 'wi-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      evt('lock.acquired', { subject, phase: 'implementar', holderKind: 'app', acquiredAt: '2026-08-03T12:00:00.000Z' }),
      evt('phase.started', { subject, phase: 'implementar', at: '2026-08-03T12:00:00.000Z' }),
      evt('session.started', { id: 'ses-1', subject, phase: 'implementar', cliSessionId: null, startedAt: '2026-08-03T12:00:00.000Z' }),
    ]);

    expect(itemState(snapshot, 'wi-1')).toBe('open');
  });

  it('sessão ASSUMIDA vira "em curso" — aí existe alguém trabalhando', () => {
    const subject = { entity: 'work_item', id: 'wi-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      evt('session.started', { id: 'ses-1', subject, phase: 'implementar', cliSessionId: 'cli-9', startedAt: '2026-08-03T12:10:00.000Z' }),
    ]);

    expect(itemState(snapshot, 'wi-1')).toBe('in-progress');
  });

  it('implementar concluída deixa o item em curso — o ciclo não fechou ainda', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      phaseCompleted('work_item', 'wi-1', 'implementar', 'done'),
    ]);

    expect(itemState(snapshot, 'wi-1')).toBe('in-progress');
  });

  it('concluir com desfecho "done" fecha o item', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      phaseCompleted('work_item', 'wi-1', 'implementar', 'done'),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'done'),
    ]);

    expect(itemState(snapshot, 'wi-1')).toBe('done');
  });

  it('concluir "abandoned" abandona; "inconclusive" NÃO fecha — desfecho ruim não é desfecho falso', () => {
    const abandonado = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'abandoned'),
    ]);
    expect(itemState(abandonado, 'wi-1')).toBe('abandoned');

    const inconclusivo = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'inconclusive'),
    ]);
    expect(itemState(inconclusivo, 'wi-1')).toBe('in-progress');
  });

  it('fase que falha deixa o item em curso — falhar não é não ter começado', () => {
    const subject = { entity: 'work_item', id: 'wi-1' };
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      evt('phase.failed', { subject, phase: 'implementar', failure: { code: 'worktree-dirty', message: 'x' }, at: '2026-08-03T12:30:00.000Z' }),
    ]);

    expect(itemState(snapshot, 'wi-1')).toBe('in-progress');
  });

  it('o gesto humano vence o que veio antes — e uma fase nova depois dele volta a valer', () => {
    const declarado = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'done'),
      evt('work_item.updated', { id: 'wi-1', state: 'open' }),
    ]);
    expect(itemState(declarado, 'wi-1')).toBe('open');

    const refeito = reduceEvents([
      discovery('dsc-1'),
      workItem('wi-1', 'dsc-1', { state: undefined }),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'done'),
      evt('work_item.updated', { id: 'wi-1', state: 'open' }),
      phaseCompleted('work_item', 'wi-1', 'implementar', 'done'),
    ]);
    expect(itemState(refeito, 'wi-1')).toBe('in-progress');
  });

  it('o ciclo inteiro move a ETAPA do card: Planejado → Execução → Concluído', () => {
    const base = [discovery('dsc-1'), plan('pln-1', 'dsc-1'), workItem('wi-1', 'dsc-1', { planId: 'pln-1', state: undefined }), phaseCompleted('discovery', 'dsc-1', 'discovery', 'done')];

    expect(reduceEvents(base).discoveries[0].derivedStage).toBe('planned');

    const emExecucao = reduceEvents([...base, phaseCompleted('work_item', 'wi-1', 'implementar', 'done')]);
    expect(emExecucao.discoveries[0].derivedStage).toBe('execution');

    const concluido = reduceEvents([
      ...base,
      phaseCompleted('work_item', 'wi-1', 'implementar', 'done'),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'done'),
    ]);
    expect(concluido.discoveries[0].derivedStage).toBe('done');
  });

  it('item reaberto por gesto depois de concluído faz a etapa RETROCEDER para Execução', () => {
    const snapshot = reduceEvents([
      discovery('dsc-1'),
      plan('pln-1', 'dsc-1'),
      workItem('wi-1', 'dsc-1', { planId: 'pln-1', state: undefined }),
      phaseCompleted('discovery', 'dsc-1', 'discovery', 'done'),
      phaseCompleted('work_item', 'wi-1', 'concluir', 'done'),
      evt('work_item.updated', { id: 'wi-1', state: 'open' }),
    ]);

    expect(snapshot.discoveries[0].derivedStage).toBe('execution');
  });
});

// ---------------------------------------------------------------------------
// F26 — `knownIngestRunIds`: todo run_id que ja passou pela ingestao, mesmo
// SEM `run.ingested` (os runs pre-ledger do incidente de 05/08).
// ---------------------------------------------------------------------------

/** Um fato qualquer com origem `ingest` — o shape que `EventSource` promete carregar o run_id. */
function ingerido(type: string, payload: Record<string, unknown>, runId: string, resultPath = 'C:/outbox/run.json'): StoreEvent {
  return { ...evt(type, payload), source: { kind: 'ingest', run_id: runId, result_path: resultPath } };
}

describe('reduceEvents — knownIngestRunIds (F26)', () => {
  it('um run com run.ingested aparece no set — o caso comum', () => {
    const snapshot = reduceEvents([
      ingerido('run.ingested', { runId: 'run-1', contentHash: 'abc' }, 'run-1'),
      discovery('dsc-1'),
    ]);

    expect(snapshot.knownIngestRunIds.has('run-1')).toBe(true);
  });

  it('um run PRE-LEDGER (fato com source.run_id, sem run.ingested nenhum) tambem aparece no set', () => {
    // Simula os 10 runs do incidente de 05/08: entraram ANTES do evento
    // `run.ingested` existir, entao so tem o fato em si com a origem.
    const snapshot = reduceEvents([ingerido('discovery.created', { id: 'dsc-1', title: 'Pre-ledger' }, 'run-pre-ledger')]);

    expect(snapshot.knownIngestRunIds.has('run-pre-ledger')).toBe(true);
    expect(snapshot.runs).toHaveLength(0); // o livro continua vazio — so o set enxerga este run
  });

  it('run_id que nunca apareceu em evento nenhum NAO esta no set', () => {
    const snapshot = reduceEvents([discovery('dsc-1')]); // source: app, sem run_id
    expect(snapshot.knownIngestRunIds.has('run-desconhecido')).toBe(false);
  });
});
