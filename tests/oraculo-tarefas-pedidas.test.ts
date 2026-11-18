import { describe, expect, it } from 'vitest';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createLedgerMobilePort } from '../src/main/celular/ledger-port';
import { createLedgerService, LEDGER_WRITE_FAILED, type LedgerProofFs } from '../src/main/ledger-store';
import { createdViaOf, lastDelivery, requestedByOf, type LedgerActor } from '../src/shared/ledger/contract';
import type { TarefaRow } from '../src/shared/ledger/mirror';
import { createDecisoesConsumer, type DecisaoRow, type DecisoesQueue } from '../src/oraculo/decisoes';
import { createTarefasPedidasConsumer, DEFAULT_CRITERIO, type TarefaPedidaRow, type TarefasPedidasQueue } from '../src/oraculo/tarefas-pedidas';

// Tarefas do celular (t-2eedda0d) — o que quebraria sem o dono ver: o pedido dele sumir, virar duas tarefas, ou a
// decisão dele numa entrega de risco baixo ser recusada.

const LEDGER = 'C:/data/ledger.json';
const LIDER: LedgerActor = { kind: 'lugar', placeId: 'p-lider', roleId: 'lider' };
const DEV: LedgerActor = { kind: 'lugar', placeId: 'p-dev', roleId: 'dev' };
const noProofFs: LedgerProofFs = {
  stat: () => Promise.reject(new Error('sem arquivo')),
  lstat: () => Promise.reject(new Error('sem arquivo')),
  realpath: () => Promise.reject(new Error('sem arquivo')),
  readFile: () => Promise.reject(new Error('sem arquivo')),
  mkdir: () => Promise.resolve(),
  copyFile: () => Promise.reject(new Error('sem arquivo')),
  writeFile: () => Promise.reject(new Error('sem arquivo')),
  unlink: () => Promise.resolve(),
};

function memoryIo(): ConfigIoDeps {
  const files: Record<string, string> = {};
  return {
    existsSync: (path) => path in files || path === 'C:/data',
    readFileText: (path) => files[path] ?? null,
    writeFileText: (path, content) => {
      files[path] = content;
    },
    renameFile: (from, to) => {
      files[to] = files[from]!;
      delete files[from];
    },
    mkdirSync: () => undefined,
    unlinkFile: (path) => {
      delete files[path];
    },
  };
}

function setup() {
  let seq = 0;
  let clock = Date.parse('2026-11-18T12:00:00Z');
  const ledger = createLedgerService({ filePath: LEDGER, io: memoryIo(), proofFs: noProofFs, newId: () => `t-${++seq}`, now: () => clock });
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { ledger, advance };
}

type QueueRow = TarefaPedidaRow & { resultado?: string; tarefa?: string | null };

/** The Supabase queue in memory: `tomar` hands what is not marked yet. */
function memoryQueue(rows: QueueRow[]) {
  let failMark = false;
  let taken = 0;
  const mirrored: TarefaRow[] = [];
  const queue: TarefasPedidasQueue = {
    tomar: async () => {
      taken += 1;
      return rows.filter((row) => row.resultado === undefined);
    },
    marcar: async (pedido, resultado, tarefa) => {
      if (failMark) {
        failMark = false;
        throw new Error('sem rede');
      }
      const row = rows.find((entry) => entry.pedido === pedido)!;
      if (row.resultado !== undefined) return false;
      row.resultado = resultado;
      row.tarefa = tarefa;
      return true;
    },
    espelhar: async (row) => {
      mirrored.push(row);
    },
  };
  return { queue, failNextMark: () => (failMark = true), mirrored, taken: () => taken };
}

const row = (n: number, rest: Partial<TarefaPedidaRow> = {}): TarefaPedidaRow => ({
  pedido: `00000000-0000-4000-8000-00000000000${n}`,
  titulo: 'Botão de pausar a VPS',
  texto: 'Quero um botão no celular para pausar a VPS quando eu sair.',
  criterio: null,
  prazo: null,
  frente: 'App do celular',
  criada_em: `2026-11-18T11:0${n}:00Z`,
  ...rest,
});

describe('tarefas pedidas no celular', () => {
  it('a linha válida vira uma tarefa e é marcada com o id; relida, não cria a segunda', async () => {
    const { ledger, advance } = setup();
    const rows: QueueRow[] = [row(1)];
    const { queue, failNextMark, mirrored } = memoryQueue(rows);
    const consumer = createTarefasPedidasConsumer({ queue: () => queue, ledger: () => ledger, returned: () => false, quadro: () => 'C:/proj/atlas' });

    // Created, but the mark fails: the row stays in the queue.
    failNextMark();
    await consumer.round();
    const tasks = Object.values(ledger.load().doc.tasks);
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task).toMatchObject({
      projectPath: 'C:/proj/atlas',
      title: 'Botão de pausar a VPS',
      request: 'Quero um botão no celular para pausar a VPS quando eu sair.',
      doneWhen: DEFAULT_CRITERIO,
      due: '2026-11-25',
      ownerPlaceId: 'lider',
      risk: 'baixo',
      state: 'aberta',
    });
    expect(task.events[0]).toMatchObject({ kind: 'criada', by: { kind: 'dono' }, requestId: rows[0]!.pedido });
    expect(requestedByOf(task)).toBe('dono');
    expect(createdViaOf(task)).toBe('celular');
    expect(rows[0]!.resultado).toBeUndefined();

    // Read again long after the ledger's repeat window: the task born with this pedido is found, nothing new.
    advance(2 * 60 * 60 * 1000);
    await consumer.round();
    expect(Object.keys(ledger.load().doc.tasks)).toEqual([task.id]);
    expect(rows[0]).toMatchObject({ resultado: 'criada', tarefa: task.id });
    // The phone's list (public.tarefas) gets the task with the PC off.
    expect(mirrored.map((entry) => [entry.id, entry.estado, entry.pedido])).toEqual([[task.id, 'aberta', rows[0]!.texto]]);

    // Marked: the queue no longer hands it, nothing changes.
    const before = JSON.stringify(ledger.load().doc);
    await consumer.round();
    expect(JSON.stringify(ledger.load().doc)).toBe(before);
  });

  it('a linha inválida é marcada com o motivo e não chega ao ledger', async () => {
    const { ledger } = setup();
    const rows: QueueRow[] = [row(1, { titulo: 'oi' }), row(2, { prazo: '18/11/2026' }), row(3, { texto: '   ' })];
    const { queue } = memoryQueue(rows);
    const consumer = createTarefasPedidasConsumer({ queue: () => queue, ledger: () => ledger, returned: () => false, quadro: () => 'C:/proj/atlas' });
    await consumer.round();
    expect(Object.keys(ledger.load().doc.tasks)).toEqual([]);
    expect(rows.map((entry) => entry.tarefa)).toEqual([null, null, null]);
    expect(rows[0]!.resultado).toMatch(/título/);
    expect(rows[1]!.resultado).toMatch(/prazo/);
    expect(rows[2]!.resultado).toMatch(/texto/);
  });

  it('sem quadro em decisoes.json a fila não é tomada: nada nasce fora de um quadro e nada é marcado', async () => {
    const { ledger } = setup();
    const rows: QueueRow[] = [row(1), row(2, { titulo: 'oi' })];
    const { queue, taken } = memoryQueue(rows);
    const consumer = createTarefasPedidasConsumer({ queue: () => queue, ledger: () => ledger, returned: () => false, quadro: () => '' });
    await consumer.round();
    expect(taken()).toBe(0);
    expect(Object.keys(ledger.load().doc.tasks)).toEqual([]);
    expect(rows.map((entry) => entry.resultado)).toEqual([undefined, undefined]);
  });

  it('a falha do ledger não marca: a linha volta e cria uma vez só', async () => {
    const { ledger } = setup();
    const rows: QueueRow[] = [row(1, { criterio: 'Pronto quando o botão pausar a VPS.', prazo: '2026-11-20' })];
    const { queue } = memoryQueue(rows);
    let failWrite = true;
    const flaky = {
      ...ledger,
      apply: async (...args: Parameters<typeof ledger.apply>) => (failWrite ? ((failWrite = false), { ok: false as const, reason: LEDGER_WRITE_FAILED }) : ledger.apply(...args)),
    };
    const consumer = createTarefasPedidasConsumer({ queue: () => queue, ledger: () => flaky, returned: () => false, quadro: () => 'C:/proj/atlas' });
    await consumer.round();
    expect(rows[0]!.resultado).toBeUndefined();
    expect(Object.keys(ledger.load().doc.tasks)).toEqual([]);

    await consumer.round();
    const tasks = Object.values(ledger.load().doc.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ doneWhen: 'Pronto quando o botão pausar a VPS.', due: '2026-11-20' });
    expect(rows[0]).toMatchObject({ resultado: 'criada', tarefa: tasks[0]!.id });
  });
});

describe('decisão do dono numa entrega de risco baixo', () => {
  it('o lado sim aceita e o lado nao rejeita a entrega que esperava o Revisor, como decisão do dono', async () => {
    const { ledger } = setup();
    const delivered = async (request: string): Promise<string> => {
      const created = await ledger.apply(LIDER, { op: 'criar', projectPath: 'C:/proj/atlas', request, doneWhen: 'pronto', due: '2026-11-20', ownerPlaceId: 'p-dev', risk: 'baixo' });
      if (!created.ok) throw new Error(created.reason);
      expect((await ledger.apply(DEV, { op: 'assumir', id: created.task.id })).ok).toBe(true);
      expect((await ledger.apply(DEV, { op: 'entregar', id: created.task.id, proofs: [{ kind: 'texto', text: '3 passed' }] })).ok).toBe(true);
      return created.task.id;
    };
    const accepted = await delivered('botão de pausar');
    const rejected = await delivered('tela de pods');
    const seen = (id: string): string => new Date(lastDelivery(ledger.load().doc.tasks[id]!)!.at).toISOString();
    const decision = (n: number, tarefa: string, lado: 'sim' | 'nao', comentario: string | null): DecisaoRow => ({
      pedido: `10000000-0000-4000-8000-00000000000${n}`,
      tarefa,
      lado,
      opcao: null,
      comentario,
      paginas: null,
      criada_em: `2026-11-18T12:0${n}:00Z`,
      entrega_vista: seen(tarefa),
      assinatura: 'ab',
    });
    const rows: (DecisaoRow & { resultado?: string })[] = [decision(1, accepted, 'sim', null), decision(2, rejected, 'nao', 'Falta o print')];
    const queue: DecisoesQueue = {
      tomar: async () => rows.filter((entry) => !entry.resultado),
      marcar: async (pedido, resultado) => {
        rows.find((entry) => entry.pedido === pedido)!.resultado = resultado;
        return true;
      },
      atualizarTarefa: async () => undefined,
    };
    const consumer = createDecisoesConsumer({
      queue: () => queue,
      port: createLedgerMobilePort(() => ledger),
      verifier: () => () => ({ deviceName: 'Android' }),
      ledger: () => ledger,
      returned: () => false,
    });
    await consumer.round();
    expect(rows.map((entry) => entry.resultado)).toEqual(['aplicada: aceita', 'aplicada: rejeitada']);
    const tasks = ledger.load().doc.tasks;
    expect(tasks[accepted]!.events.at(-1)).toMatchObject({ kind: 'aceita', by: { kind: 'dono' } });
    expect(tasks[rejected]!.events.at(-1)).toMatchObject({ kind: 'rejeitada', by: { kind: 'dono' }, text: 'Falta o print' });
  });
});
