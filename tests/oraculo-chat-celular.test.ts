// Chat do Líder pelo celular via Oráculo da VPS (t-cddc62fc) — o que quebraria sem o dono ver: a mensagem dele ao
// Líder único sumir (marcada sem chegar, ou perdida numa falha) ou chegar duas vezes (o PC fica fora mais que a reserva
// de 10 min e o roteador do desktop, #470, toma a mesma linha que já espera no relay); e o aviso do reconciliador ao
// Líder sair por outra credencial.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps, type ConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createCelularLiderChat } from '../src/main/lider/celular-chat';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { chatCelularQueueOver, createChatCelularConsumer, DELIVERED_NOTE, PARKED } from '../src/oraculo/chat-celular';
import { createRelay, type Relay } from '../src/oraculo/relay';
import { readServiceHashes, SERVICE_PATH } from '../src/oraculo/servicos';

const FILA = 'C:/data/fila.json';
const ID = '9c4a90af-1111-4222-8333-444455556666';
const MIN = 60_000;

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

interface Row {
  id: string;
  texto: string;
  criada_em: string;
  autor: 'dono' | 'lider';
  entregue_em: number | null;
  resultado: string | null;
  tomada_em: number | null;
}

/** `celular.lider_mensagens` and its RPCs (014 + 019 of donel-celular) as the SQL does them, on a clock the test moves. */
function fakeSupabase(clock: { now: number }) {
  const rows: Row[] = [{ id: ID, texto: 'Dê acesso a Raiza à VPS de homologação', criada_em: '2026-11-18T12:25:00Z', autor: 'dono', entregue_em: null, resultado: null, tomada_em: null }];
  const fail = new Set<string>();
  const out = (row: Row) => ({ id: row.id, texto: row.texto, criada_em: row.criada_em });
  const rpc = async (fn: string, args: object): Promise<unknown> => {
    if (fail.has(fn)) throw new Error('a fila do celular não respondeu (ECONNRESET)');
    const a = args as Record<string, unknown>;
    const own = (row: Row) => row.autor === 'dono' && row.entregue_em === null;
    switch (fn) {
      case 'celular_lider_tomar': {
        const taken = rows
          .filter((row) => own(row) && row.resultado === null && (row.tomada_em === null || row.tomada_em < clock.now - 10 * MIN))
          .slice(0, Math.max(1, Math.min(a.p_limite as number, 50)));
        for (const row of taken) row.tomada_em = clock.now;
        return taken.map(out);
      }
      case 'celular_lider_entregue': {
        const row = rows.find((r) => r.id === a.p_id && own(r));
        if (!row) return null;
        row.entregue_em = clock.now;
        row.resultado = String(a.p_resultado).slice(0, 300);
        return true;
      }
      case 'celular_lider_estacionar': {
        const row = rows.find((r) => r.id === a.p_id && own(r) && r.resultado === null);
        if (!row) return null;
        row.resultado = String(a.p_resultado).slice(0, 300);
        return true;
      }
      case 'celular_lider_estacionadas':
        return rows.filter((row) => own(row) && row.resultado === a.p_resultado).map(out);
      default:
        throw new Error(`rpc desconhecida ${fn}`);
    }
  };
  return { rows, rpc, fail };
}

/** The PC (old app): on, it delivers what the relay holds to the Líder único and acks. The relay runs on the same clock. */
function world() {
  const clock = { now: Date.parse('2026-11-18T12:25:05Z') };
  const db = fakeSupabase(clock);
  const toLider: string[] = [];
  const relay: Relay = createRelay({ filePath: FILA, io: memoryIo(), now: () => clock.now });
  const pcDrains = (): void => {
    for (const item of relay.pending()) {
      toLider.push(item.message.leaderText);
      relay.ack(item.id, 'lider');
    }
  };
  const vps = createChatCelularConsumer({ queue: () => chatCelularQueueOver(db.rpc), relay, waitMs: 5 });
  // The desktop router (#470), on the same Supabase, delivering to the same Líder.
  const desktop = createCelularLiderChat({
    rpc: db.rpc,
    now: () => clock.now,
    deliver: async (text) => {
      toLider.push(text);
      return { ok: true };
    },
  });
  return { clock, db, relay, toLider, pcDrains, vps, desktop, row: db.rows[0]! };
}

describe('chat do celular ao Líder único pelo Oráculo da VPS', () => {
  it('entrega ao Líder único e marca quando o PC responde que chegou', async () => {
    const w = world();
    const vps = createChatCelularConsumer({
      queue: () => chatCelularQueueOver(w.db.rpc),
      relay: { pending: () => w.relay.pending(), send: (message, waitMs) => (queueMicrotask(w.pcDrains), w.relay.send(message, waitMs)) },
      waitMs: 1_000,
    });
    await vps.round();
    expect(w.toLider).toHaveLength(1);
    expect(w.toLider[0]).toContain('[celular #9c4a90af]');
    expect(w.toLider[0]).toContain(w.row.texto);
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
    expect(w.row.entregue_em).not.toBeNull();
  });

  it('PC fora mais que a reserva: o roteador do desktop não toma a linha que espera no relay, e ela chega uma vez só', async () => {
    const w = world();
    await w.vps.round(); // PC off: the message waits in the relay and the row is parked
    expect(w.row.resultado).toBe(PARKED);
    expect(w.row.entregue_em).toBeNull();
    w.clock.now += 11 * MIN; // the reservation ended
    await w.desktop.poll(); // the alfa 26.1118.428+ on the PC comes back
    await w.vps.round();
    expect(w.relay.pending()).toHaveLength(1);
    w.pcDrains(); // the relay's queue reaches the Líder
    await w.desktop.poll();
    await w.vps.round(); // the ack landed: the parked row is closed
    expect(w.toLider).toHaveLength(1);
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
    expect(w.row.entregue_em).not.toBeNull();
  });

  it('estacionar falha: a mensagem não sai pela VPS, e o desktop a entrega uma vez quando a reserva vence', async () => {
    const w = world();
    w.db.fail.add('celular_lider_estacionar');
    await w.vps.round();
    expect(w.row.resultado).toBeNull();
    expect(w.relay.pending()).toHaveLength(0);
    w.db.fail.delete('celular_lider_estacionar');
    w.clock.now += 11 * MIN;
    await w.desktop.poll(); // the desktop takes it first
    await w.vps.round();
    w.pcDrains();
    await w.vps.round();
    expect(w.toLider).toHaveLength(1);
    expect(w.row.entregue_em).not.toBeNull();
  });

  it('daemon morre entre estacionar e mandar: o novo manda a estacionada uma vez, e o desktop não a toma', async () => {
    const w = world();
    await w.db.rpc('celular_lider_tomar', { p_limite: 10 });
    await w.db.rpc('celular_lider_estacionar', { p_id: ID, p_resultado: PARKED }); // and then the process died
    await w.vps.round(); // the new daemon, PC off
    expect(w.relay.pending()).toHaveLength(1);
    w.clock.now += 11 * MIN;
    await w.desktop.poll();
    await w.vps.round();
    expect(w.relay.pending()).toHaveLength(1);
    w.pcDrains();
    await w.vps.round();
    expect(w.toLider).toHaveLength(1);
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
  });

  it('chegou mas a marca falhou: fica estacionada, ninguém reentrega, e a rodada seguinte fecha', async () => {
    const w = world();
    const vps = createChatCelularConsumer({
      queue: () => chatCelularQueueOver(w.db.rpc),
      relay: { pending: () => w.relay.pending(), send: (message, waitMs) => (queueMicrotask(w.pcDrains), w.relay.send(message, waitMs)) },
      waitMs: 1_000,
    });
    w.db.fail.add('celular_lider_entregue');
    await vps.round();
    expect(w.toLider).toHaveLength(1);
    expect(w.row.resultado).toBe(PARKED);
    w.db.fail.delete('celular_lider_entregue');
    w.clock.now += 11 * MIN;
    await w.desktop.poll();
    await vps.round();
    expect(w.toLider).toHaveLength(1);
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
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
