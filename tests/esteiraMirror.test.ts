import { describe, expect, it } from 'vitest';
import { MIRROR_DISABLED, parseMirrorConfig, type MirrorConfig } from '../src/shared/esteira/mirror/mirrorConfig';
import {
  mirrorFailedDraft,
  mirrorIntents,
  mirrorOperationKind,
  mirrorSyncedDraft,
  pendingMirrorDrafts,
} from '../src/shared/esteira/mirror/mirrorPlan';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent, StoreSnapshot } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (D-11/D-12) — o ESPELHO no tracker, na camada pura. Duas promessas
// que estes casos existem para amarrar:
//
// 1. O mapeamento etapa → coluna vem de CONFIGURACAO. Coluna que o arquivo nao
//    declara nao vira movimento nenhum — o app nao inventa nome de coluna, do
//    mesmo jeito que nao inventa estado de fase.
// 2. O espelho e projecao de fato local. Nada que o board ja reflete e
//    reenviado; o que mudou desde o ultimo sync e enfileirado de novo.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at: '2026-08-04T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

const CONFIG: MirrorConfig = {
  enabled: true,
  provider: 'taskdex',
  columnByStage: { discovery: 'Discovery', planned: 'Plano', execution: 'Implementar', done: 'Concluído' },
  phaseLabelPrefix: 'esteira:em-andamento:',
  maxAttempts: 5,
};

const DISCOVERY_COM_TRACKER = {
  id: 'dsc-1',
  title: 'Fila de importacao trava sem sinal',
  tracker: { provider: 'taskdex', cardId: 'card-4711' },
};

/** Card de origem com tracker, discovery concluido e um plano — etapa derivada `planned`. */
function cardPlanejado(extra: readonly StoreEvent[] = []): StoreSnapshot {
  return reduceEvents([
    evt('discovery.created', DISCOVERY_COM_TRACKER),
    evt('phase.completed', {
      subject: { entity: 'discovery', id: 'dsc-1' },
      phase: 'discovery',
      outcome: 'done',
      summary: 'Um plano proposto.',
      runId: 'run-1',
    }),
    evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar o estado da fila observavel' }),
    ...extra,
  ]);
}

describe('configuracao do espelho', () => {
  it('arquivo ausente e espelho desligado — o tracker e plugue opcional, nao requisito', () => {
    expect(parseMirrorConfig(null)).toEqual(MIRROR_DISABLED);
    expect(parseMirrorConfig('   ')).toEqual(MIRROR_DISABLED);
  });

  it('JSON quebrado desliga o espelho em vez de lancar', () => {
    expect(parseMirrorConfig('{ isto nao e json').enabled).toBe(false);
  });

  it('sem provider nao ha espelho — nao da para espelhar num tracker que ninguem nomeou', () => {
    expect(parseMirrorConfig(JSON.stringify({ columnByStage: { planned: 'Plano' } })).enabled).toBe(false);
  });

  it('o mapeamento etapa → coluna sai do ARQUIVO, nunca do codigo', () => {
    const config = parseMirrorConfig(
      JSON.stringify({ provider: 'taskdex', columnByStage: { execution: 'Em progresso', done: 'Feito' } }),
    );

    expect(config.enabled).toBe(true);
    expect(config.columnByStage).toEqual({ execution: 'Em progresso', done: 'Feito' });
  });

  it('ignora etapa desconhecida e valor que nao e texto, sem derrubar o resto', () => {
    const config = parseMirrorConfig(
      JSON.stringify({ provider: 'taskdex', columnByStage: { planned: 'Plano', inexistente: 'X', done: 42 } }),
    );

    expect(config.columnByStage).toEqual({ planned: 'Plano' });
  });

  it('`enabled: false` desliga mesmo com o resto preenchido', () => {
    expect(parseMirrorConfig(JSON.stringify({ enabled: false, provider: 'taskdex' })).enabled).toBe(false);
  });

  it('teto de tentativas vem do arquivo; sem ele, um default declarado', () => {
    expect(parseMirrorConfig(JSON.stringify({ provider: 'taskdex' })).maxAttempts).toBe(5);
    expect(parseMirrorConfig(JSON.stringify({ provider: 'taskdex', maxAttempts: 2 })).maxAttempts).toBe(2);
  });
});

describe('o que se espelha', () => {
  it('espelha SO o card de origem que tem tracker', () => {
    const semTracker = reduceEvents([evt('discovery.created', { id: 'dsc-2', title: 'Sem card no board' })]);

    expect(mirrorIntents(semTracker, CONFIG)).toHaveLength(0);
  });

  it('espelho desligado nao produz intencao nenhuma', () => {
    expect(mirrorIntents(cardPlanejado(), MIRROR_DISABLED)).toHaveLength(0);
  });

  it('provider diferente do adapter nao e espelhado', () => {
    const outro = { ...CONFIG, provider: 'linear' };

    expect(mirrorIntents(cardPlanejado(), outro)).toHaveLength(0);
  });

  it('move o card para a coluna que a CONFIGURACAO associa a etapa derivada', () => {
    const column = mirrorIntents(cardPlanejado(), CONFIG).find((intent) => intent.kind === 'column');

    expect(column?.cardId).toBe('card-4711');
    expect(column?.payload).toEqual({ column: 'Plano' });
  });

  it('etapa sem coluna mapeada NAO vira movimento — o app nao inventa coluna', () => {
    const semPlanned = { ...CONFIG, columnByStage: { discovery: 'Discovery' } };
    const intents = mirrorIntents(cardPlanejado(), semPlanned);

    expect(intents.some((intent) => intent.kind === 'column')).toBe(false);
    // e o resto do espelho continua de pe
    expect(intents.some((intent) => intent.kind === 'comment')).toBe(true);
  });

  it('override manual de etapa manda no board — a coluna segue o que o humano decidiu', () => {
    const snapshot = cardPlanejado([
      evt('stage.overridden', { discoveryId: 'dsc-1', value: 'execution', by: 'alexandre' }),
    ]);
    const column = mirrorIntents(snapshot, CONFIG).find((intent) => intent.kind === 'column');

    expect(column?.payload).toEqual({ column: 'Implementar' });
  });

  it('a trava local vira etiqueta no board — espelho, nunca a trava em si', () => {
    const snapshot = cardPlanejado([
      evt('lock.acquired', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'plano', holderKind: 'app' }),
    ]);
    const label = mirrorIntents(snapshot, CONFIG).find((intent) => intent.kind === 'label');

    expect(label?.payload).toEqual({ labels: ['esteira:em-andamento:plano'] });
  });

  it('sem trava e sem etiqueta ja espelhada, nao ha o que limpar', () => {
    expect(mirrorIntents(cardPlanejado(), CONFIG).some((intent) => intent.kind === 'label')).toBe(false);
  });

  it('etiqueta espelhada e trava solta viram limpeza de etiqueta', () => {
    const snapshot = cardPlanejado([
      evt('mirror.synced', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        operation: 'label',
        payload: { labels: ['esteira:em-andamento:discovery'] },
      }),
    ]);
    const label = mirrorIntents(snapshot, CONFIG).find((intent) => intent.kind === 'label');

    expect(label?.payload).toEqual({ labels: [] });
  });

  it('comenta a conclusao da fase resumindo o que nasceu', () => {
    const comment = mirrorIntents(cardPlanejado(), CONFIG).find((intent) => intent.kind === 'comment');

    expect(comment?.operation).toBe('comment:discovery:dsc-1:discovery:2026-08-04T12:00:00.000Z');
    expect(String(comment?.payload.text)).toContain('discovery');
    expect(String(comment?.payload.text)).toContain('1 plano');
  });

  it('disparar de novo uma fase JA concluida nao duplica o comentario no board', () => {
    // `phase.started` atualiza o `lastRunId` sem mudar a conclusao: chavear o
    // comentario pelo run mandaria o MESMO texto duas vezes.
    const antes = mirrorIntents(cardPlanejado(), CONFIG).find((intent) => intent.kind === 'comment');
    const depois = mirrorIntents(
      cardPlanejado([
        evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', runId: 'run-2' }),
      ]),
      CONFIG,
    ).filter((intent) => intent.kind === 'comment');

    expect(depois).toHaveLength(1);
    expect(depois[0].operation).toBe(antes?.operation);
  });

  it('fase que FALHOU tambem vira comentario — o board nao pode achar que nada aconteceu', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', DISCOVERY_COM_TRACKER),
      evt('phase.failed', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        failure: { code: 'worktree-dirty', message: 'arvore suja' },
        runId: 'run-9',
      }),
    ]);
    const comment = mirrorIntents(snapshot, CONFIG).find((intent) => intent.kind === 'comment');

    expect(comment?.operation).toBe('comment:discovery:dsc-1:discovery:run-9');
    expect(String(comment?.payload.text)).toContain('worktree-dirty');
  });

  it('o que o board JA reflete nao volta para a fila', () => {
    const snapshot = cardPlanejado([
      evt('mirror.synced', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        operation: 'column',
        payload: { column: 'Plano' },
      }),
    ]);

    expect(mirrorIntents(snapshot, CONFIG).some((intent) => intent.kind === 'column')).toBe(false);
  });

  it('coluna sincronizada que MUDOU volta para a fila', () => {
    const snapshot = cardPlanejado([
      evt('mirror.synced', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        operation: 'column',
        payload: { column: 'Discovery' },
      }),
    ]);
    const column = mirrorIntents(snapshot, CONFIG).find((intent) => intent.kind === 'column');

    expect(column?.payload).toEqual({ column: 'Plano' });
  });
});

describe('a fila', () => {
  it('enfileira o que falta, uma linha por operacao', () => {
    const drafts = pendingMirrorDrafts(cardPlanejado(), CONFIG, '2026-08-04T13:00:00.000Z');

    expect(drafts.map((draft) => draft.type)).toEqual(['mirror.queued', 'mirror.queued']);
    expect(drafts.every((draft) => draft.at === '2026-08-04T13:00:00.000Z')).toBe(true);
  });

  it('nao reenfileira o que ja esta na fila com o MESMO conteudo', () => {
    const snapshot = cardPlanejado([
      evt('mirror.queued', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        operation: 'column',
        payload: { column: 'Plano' },
      }),
    ]);
    const drafts = pendingMirrorDrafts(snapshot, CONFIG, '2026-08-04T13:00:00.000Z');

    expect(drafts.map((draft) => draft.payload.operation)).toEqual(['comment:discovery:dsc-1:discovery:2026-08-04T12:00:00.000Z']);
  });

  it('reenfileira quando a intencao MUDOU — reenviar o passado seria espelhar o que ja nao existe', () => {
    const snapshot = cardPlanejado([
      evt('mirror.queued', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        operation: 'column',
        payload: { column: 'Discovery' },
      }),
    ]);
    const column = pendingMirrorDrafts(snapshot, CONFIG, '2026-08-04T13:00:00.000Z').find(
      (draft) => draft.payload.operation === 'column',
    );

    expect(column?.payload.payload).toEqual({ column: 'Plano' });
  });

  it('sync e falha viram evento com a operacao inteira — a fila e auditavel no log', () => {
    const entry = {
      subject: { entity: 'discovery', id: 'dsc-1' } as const,
      operation: 'column',
      payload: { column: 'Plano' },
      queuedAt: '2026-08-04T13:00:00.000Z',
      attempts: 0,
      lastError: null,
    };

    expect(mirrorSyncedDraft(entry, '2026-08-04T13:05:00.000Z')).toEqual({
      type: 'mirror.synced',
      at: '2026-08-04T13:05:00.000Z',
      dedupe_key: null,
      payload: { subject: entry.subject, operation: 'column', payload: { column: 'Plano' }, at: '2026-08-04T13:05:00.000Z' },
    });

    const failed = mirrorFailedDraft(entry, 'sem rede', '2026-08-04T13:05:00.000Z');
    expect(failed.type).toBe('mirror.failed');
    expect(failed.payload.error).toBe('sem rede');
  });

  it('a operacao diz o que fazer, e uma desconhecida diz que nao sabe', () => {
    expect(mirrorOperationKind('label')).toBe('label');
    expect(mirrorOperationKind('column')).toBe('column');
    expect(mirrorOperationKind('comment:run-1')).toBe('comment');
    expect(mirrorOperationKind('publicar-card')).toBeNull();
  });
});
