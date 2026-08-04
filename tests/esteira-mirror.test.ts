import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeBoardAdapter,
  drainMirrorQueue,
  fakeBoardCalls,
  MIRROR_FAKE_ENV_VAR,
  resolveBoardMirrorAdapter,
  type BoardMirrorAdapter,
} from '../src/main/esteira-mirror';
import { openEsteiraStore, type EsteiraStore } from '../src/main/esteira-store';
import { pendingMirrorDrafts } from '../src/shared/esteira/mirror/mirrorPlan';
import type { MirrorConfig } from '../src/shared/esteira/mirror/mirrorConfig';

// Spec 010 (D-12) — a FILA do espelho, do lado que fala com o board. Tudo aqui
// roda com adapter FAKE: sem rede, sem token. E de proposito — a fase 2 excluiu
// o board justamente para que falha de contrato nunca fosse confundida com
// falha de rede.
//
// A promessa que estes casos amarram: **nada aqui pode derrubar o gesto local**.
// Adapter que recusa, adapter que lanca, operacao que o app nao sabe espelhar —
// todos viram fato na fila, nenhum vira excecao.

const CONFIG: MirrorConfig = {
  enabled: true,
  provider: 'taskdex',
  columnByStage: { planned: 'Plano' },
  phaseLabelPrefix: 'esteira:em-andamento:',
  maxAttempts: 3,
};

let root: string;
let store: EsteiraStore;
let controlPath: string;

const SUBJECT = { entity: 'discovery', id: 'dsc-1' } as const;

/** O card de origem: e do `tracker` dele que sai o destino de toda operacao. */
function criaCard(tracker: { provider: string; cardId: string } | null = { provider: 'taskdex', cardId: 'card-4711' }): void {
  store.append([
    {
      type: 'discovery.created',
      at: '2026-08-04T12:00:00.000Z',
      dedupe_key: null,
      payload: { id: 'dsc-1', title: 'Card', tracker },
    },
  ]);
}

function queue(operation: string, payload: Record<string, unknown>): void {
  store.append([
    {
      type: 'mirror.queued',
      at: '2026-08-04T12:00:00.000Z',
      dedupe_key: null,
      payload: { subject: SUBJECT, operation, payload, provider: 'taskdex', cardId: 'card-4711', queuedAt: '2026-08-04T12:00:00.000Z' },
    },
  ]);
}

function control(mode: 'ok' | 'fail', error?: string): void {
  writeFileSync(controlPath, JSON.stringify({ mode, error: error ?? 'o board recusou' }), 'utf8');
}

function adapter(): BoardMirrorAdapter {
  return createFakeBoardAdapter({ provider: 'taskdex', controlPath });
}

function drain(over: Partial<{ force: boolean; adapter: BoardMirrorAdapter }> = {}) {
  return drainMirrorQueue(store, over.adapter ?? adapter(), {
    now: () => '2026-08-04T12:30:00.000Z',
    maxAttempts: CONFIG.maxAttempts,
    force: over.force ?? false,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'donel-esteira-mirror-'));
  store = openEsteiraStore({ dir: join(root, 'store'), channel: 'alfa' });
  controlPath = join(root, 'mirror-fake.json');
  control('ok');
  criaCard();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('adapter fake', () => {
  it('registra a chamada em disco em vez de falar com o board — nenhuma rede sai daqui', async () => {
    queue('column', { column: 'Plano' });

    await drain();

    const calls = fakeBoardCalls(controlPath);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ operation: 'moveColumn', cardId: 'card-4711', column: 'Plano' });
  });

  it('as tres operacoes do adapter chegam com o conteudo da fila', async () => {
    queue('label', { labels: ['esteira:em-andamento:plano'] });
    queue('comment:run-1', { text: 'Fase discovery concluída: 1 plano, 0 itens.' });
    queue('column', { column: 'Plano' });

    await drain();

    expect(fakeBoardCalls(controlPath).map((call) => call.operation).sort()).toEqual(['applyLabel', 'comment', 'moveColumn']);
  });

  it('so entra em cena quando o ambiente aponta para ele — sem fake e sem adapter real, o espelho fica desligado', () => {
    expect(resolveBoardMirrorAdapter({}, CONFIG)).toBeNull();
    expect(resolveBoardMirrorAdapter({ [MIRROR_FAKE_ENV_VAR]: controlPath }, CONFIG)?.provider).toBe('taskdex');
    expect(resolveBoardMirrorAdapter({ [MIRROR_FAKE_ENV_VAR]: controlPath }, { ...CONFIG, enabled: false })).toBeNull();
  });
});

describe('drenar a fila', () => {
  it('sucesso tira da fila e registra o que o board passou a refletir', async () => {
    queue('column', { column: 'Plano' });

    const summary = await drain();

    expect(summary).toMatchObject({ attempted: 1, synced: 1, failed: 0 });
    expect(store.snapshot().mirrorQueue).toHaveLength(0);
    expect(store.snapshot().mirrorSynced[0].payload).toEqual({ column: 'Plano' });
  });

  it('falha do board fica na fila com o MOTIVO, e a chamada nao lanca', async () => {
    control('fail', 'sem rede');
    queue('column', { column: 'Plano' });

    const summary = await drain();

    expect(summary).toMatchObject({ attempted: 1, synced: 0, failed: 1 });
    const [entry] = store.snapshot().mirrorQueue;
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe('sem rede');
    // O conteudo continua na fila: e com ele que o reenvio acontece.
    expect(entry.payload).toEqual({ column: 'Plano' });
  });

  it('adapter que LANCA vira falha registrada, nunca excecao para fora', async () => {
    queue('column', { column: 'Plano' });
    const explosivo: BoardMirrorAdapter = {
      provider: 'taskdex',
      applyLabel: () => Promise.reject(new Error('token expirado')),
      comment: () => Promise.reject(new Error('token expirado')),
      moveColumn: () => Promise.reject(new Error('token expirado')),
    };

    const summary = await drain({ adapter: explosivo });

    expect(summary.failed).toBe(1);
    expect(store.snapshot().mirrorQueue[0].lastError).toContain('token expirado');
  });

  it('operacao que o app nao sabe espelhar diz isso, em vez de fingir que mandou', async () => {
    queue('publicar-card', { cardId: 'x' });

    const summary = await drain();

    expect(summary.failed).toBe(1);
    expect(store.snapshot().mirrorQueue[0].lastError).toContain('publicar-card');
    expect(fakeBoardCalls(controlPath)).toHaveLength(0);
  });

  it('reenvio: o que falhou volta a ser tentado e sai da fila quando o board volta', async () => {
    control('fail', 'sem rede');
    queue('column', { column: 'Plano' });
    await drain();

    control('ok');
    const summary = await drain();

    expect(summary).toMatchObject({ synced: 1, failed: 0 });
    expect(store.snapshot().mirrorQueue).toHaveLength(0);
  });

  it('depois do teto de tentativas a fila para de insistir sozinha — mas o gesto humano forca', async () => {
    control('fail', 'sem rede');
    queue('column', { column: 'Plano' });
    await drain();
    await drain();
    await drain();

    // Teto batido: a varredura automatica nao tenta mais.
    const parada = await drain();
    expect(parada).toMatchObject({ attempted: 0, skipped: 1 });
    expect(store.snapshot().mirrorQueue[0].attempts).toBe(3);

    control('ok');
    const forcada = await drain({ force: true });
    expect(forcada).toMatchObject({ attempted: 1, synced: 1 });
  });

  it('fila vazia nao chama o board', async () => {
    const summary = await drain();

    expect(summary).toMatchObject({ attempted: 0, synced: 0, failed: 0 });
    expect(fakeBoardCalls(controlPath)).toHaveLength(0);
  });

  it('store que recusa escrita nao derruba a drenagem — o gesto local ja aconteceu', async () => {
    queue('column', { column: 'Plano' });
    const recusa: EsteiraStore = {
      ...store,
      compatibility: store.compatibility,
      header: store.header,
      events: store.events,
      snapshot: () => store.snapshot(),
      append: () => ({ ok: false, reason: 'read-only' }),
      persistSnapshot: () => ({ ok: false, reason: 'read-only' }),
      refresh: () => false,
    };

    const summary = await drainMirrorQueue(recusa, adapter(), {
      now: () => '2026-08-04T12:30:00.000Z',
      maxAttempts: 3,
      force: false,
    });

    // A chamada ao board aconteceu; o registro do resultado e que nao pode ser
    // gravado. Nada disso lanca, e a entrada continua na fila.
    expect(summary.attempted).toBe(1);
    expect(store.snapshot().mirrorQueue).toHaveLength(1);
  });
});

describe('o que entra na fila', () => {
  it('a trava local vira etiqueta no board — do fato a chamada, sem intervencao humana', async () => {
    store.append([
      {
        type: 'lock.acquired',
        at: '2026-08-04T12:00:00.000Z',
        dedupe_key: null,
        payload: { subject: SUBJECT, phase: 'plano', holderKind: 'app', acquiredAt: '2026-08-04T12:00:00.000Z' },
      },
    ]);

    store.append(pendingMirrorDrafts(store.snapshot(), CONFIG, '2026-08-04T12:01:00.000Z'));
    expect(store.snapshot().mirrorQueue.map((entry) => entry.operation)).toEqual(['label']);

    await drain();

    expect(fakeBoardCalls(controlPath)[0]).toMatchObject({
      operation: 'applyLabel',
      cardId: 'card-4711',
      labels: ['esteira:em-andamento:plano'],
    });
  });

  it('etapa sem coluna na configuracao nao enfileira movimento nenhum', () => {
    // A etapa derivada e `discovery`, que esta fora do `columnByStage` deste teste.
    store.append(pendingMirrorDrafts(store.snapshot(), CONFIG, '2026-08-04T12:01:00.000Z'));

    expect(store.snapshot().mirrorQueue).toHaveLength(0);
  });

  it('operacao para card sem referencia no tracker diz isso, em vez de chutar um destino', async () => {
    store.append([
      {
        type: 'discovery.created',
        at: '2026-08-04T12:02:00.000Z',
        dedupe_key: null,
        payload: { id: 'dsc-2', title: 'Sem card no board', tracker: null },
      },
      {
        type: 'mirror.queued',
        at: '2026-08-04T12:02:00.000Z',
        dedupe_key: null,
        payload: { subject: { entity: 'discovery', id: 'dsc-2' }, operation: 'column', payload: { column: 'Plano' } },
      },
    ]);

    const summary = await drain();

    expect(summary).toMatchObject({ attempted: 0, failed: 1 });
    expect(store.snapshot().mirrorQueue[0].lastError).toContain('não tem referência no tracker');
    expect(fakeBoardCalls(controlPath)).toHaveLength(0);
  });
});
