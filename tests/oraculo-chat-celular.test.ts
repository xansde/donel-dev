// Chat do Líder pelo celular via Oráculo da VPS (t-cddc62fc) — o que quebraria sem o dono ver: a mensagem dele ao
// Líder único sumir (marcada sem chegar, ou perdida numa falha) ou chegar duas vezes (a reserva vence com o PC
// desligado e a linha é tomada de novo); e o aviso do reconciliador ao Líder sair por outra credencial.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps, type ConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { createChatCelularConsumer, DELIVERED_NOTE, type ChatCelularQueue, type ChatCelularRow } from '../src/oraculo/chat-celular';
import { createRelay, type Relay } from '../src/oraculo/relay';
import { readServiceHashes, SERVICE_PATH } from '../src/oraculo/servicos';

const FILA = 'C:/data/fila.json';
const ID = '9c4a90af-1111-4222-8333-444455556666';

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

/** The PC: on, it delivers what the relay tells it about to the Líder único right away. */
function setup() {
  let pcOn = true;
  const delivered: string[] = [];
  const relay: Relay = createRelay({
    filePath: FILA,
    io: memoryIo(),
    notify: () =>
      queueMicrotask(() => {
        if (pcOn) pcDelivers();
      }),
  });
  const pcDelivers = (): void => {
    for (const item of relay.pending()) {
      delivered.push(item.message.leaderText);
      relay.ack(item.id, 'lider');
    }
  };
  return { relay, delivered, pcDelivers, setPc: (on: boolean) => (pcOn = on) };
}

/** `celular.lider_mensagens` in memory: `tomar` hands what is not delivered yet (the reservation already ended). */
function memoryQueue(rows: ChatCelularRow[]) {
  const marked = new Map<string, string>();
  const fail = { tomar: false, entregue: false };
  const queue: ChatCelularQueue = {
    tomar: async () => {
      if (fail.tomar) throw new Error('sem rede');
      return rows.filter((row) => !marked.has(row.id));
    },
    entregue: async (id, resultado) => {
      if (fail.entregue) throw new Error('sem rede');
      if (marked.has(id)) return false;
      marked.set(id, resultado);
      return true;
    },
  };
  return { queue, marked, fail };
}

const row: ChatCelularRow = { id: ID, texto: 'Dê acesso a Raiza à VPS de homologação', criada_em: '2026-11-18T12:25:00Z' };

describe('chat do celular ao Líder único pelo Oráculo da VPS', () => {
  it('entrega ao Líder único e marca quando o PC responde que chegou', async () => {
    const pc = setup();
    const q = memoryQueue([row]);
    const consumer = createChatCelularConsumer({ queue: () => q.queue, relay: pc.relay, waitMs: 1_000 });
    await consumer.round();
    expect(pc.delivered).toHaveLength(1);
    expect(pc.delivered[0]).toContain('[celular #9c4a90af]');
    expect(pc.delivered[0]).toContain(row.texto);
    expect(q.marked.get(ID)).toBe(DELIVERED_NOTE);
  });

  it('com o PC desligado não marca, não duplica quando a linha volta, e marca quando o PC entrega', async () => {
    const pc = setup();
    pc.setPc(false);
    const q = memoryQueue([row]);
    const consumer = createChatCelularConsumer({ queue: () => q.queue, relay: pc.relay, waitMs: 5 });
    await consumer.round();
    await consumer.round(); // the reservation ended: the same row is taken again
    expect(q.marked.size).toBe(0);
    expect(pc.relay.pending()).toHaveLength(1);
    pc.setPc(true);
    pc.pcDelivers();
    await consumer.round();
    expect(pc.delivered).toHaveLength(1);
    expect(q.marked.get(ID)).toBe(DELIVERED_NOTE);
  });

  it('falha da fila não perde a mensagem nem a entrega duas vezes', async () => {
    const pc = setup();
    const q = memoryQueue([row]);
    const consumer = createChatCelularConsumer({ queue: () => q.queue, relay: pc.relay, waitMs: 1_000 });
    q.fail.tomar = true;
    await consumer.round();
    expect(pc.delivered).toHaveLength(0);
    q.fail.tomar = false;
    q.fail.entregue = true;
    await consumer.round();
    expect(q.marked.size).toBe(0);
    q.fail.entregue = false;
    await consumer.round();
    expect(q.marked.get(ID)).toBe(DELIVERED_NOTE);
    expect(pc.delivered).toHaveLength(1);
  });
});

describe('aviso do reconciliador ao Líder único', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

  it('só a credencial do reconciliador manda, e a mesma chave não vira dois avisos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oraculo-aviso-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'servicos'));
    writeFileSync(join(dir, 'servicos', 'mencoes.sha256'), hash('m'.repeat(64)));
    writeFileSync(join(dir, 'servicos', 'reconciliador.sha256'), hash('r'.repeat(64)));
    const file = join(dir, 'ledger.json');
    const relay = createRelay({ filePath: join(dir, 'fila.json'), io: createSystemConfigIoDeps() });
    const handle = createOracleApiHandler({
      ledger: createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs }),
      ledgerFile: file,
      tokenHash: () => hash('p'.repeat(64)),
      services: () => readServiceHashes(dir),
      avisarLider: (texto, chave) => relay.send({ projectPath: '', placeId: '', text: texto, leaderText: texto, key: `reconciliador:${chave}` }, 0),
    });
    const aviso = (token: string): OracleRequest => ({
      method: 'POST',
      url: SERVICE_PATH,
      authorization: `Bearer ${token}`,
      body: JSON.stringify({ op: { op: 'avisar-lider', texto: 'o lugar X fechou com tarefa viva', chave: 'mid-1' } }),
    });
    expect((await handle(aviso('m'.repeat(64)))).status).toBe(403);
    expect(relay.pending()).toHaveLength(0);
    for (let i = 0; i < 2; i += 1) {
      const res = await handle(aviso('r'.repeat(64)));
      expect(JSON.parse(res.body as string)).toEqual({ ok: true, para: 'pendente' });
    }
    expect(relay.pending().map((item) => item.message.placeId)).toEqual(['']);
  });
});
