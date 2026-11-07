// Oráculo na VPS (t-d7a974d0), fatia 3 — the relay of what only the PC can deliver (the owner's words on a card,
// his decision, a "Pedir" to the Líder único) while the phone talks to the VPS. What breaks without the owner
// noticing: a message that vanishes with the PC off (or a daemon restart), or one that arrives twice when the
// phone's queue retries.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createCardWriter } from '../src/main/ledger-card-writer';
import type { LedgerForOwner } from '../src/shared/ledger/contract';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createRelay } from '../src/oraculo/relay';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createOracleApiHandler } from '../src/oraculo/api';
import { createOracleAdminRoutes } from '../src/oraculo/admin';
import { createRemoteOracleHost } from '../src/main/ledger-remote-host';
import { createSwitchableLedger } from '../src/main/ledger-remote';
import type { CelularCore } from '../src/main/celular/service';
import type { OwnerMessage } from '../src/main/ledger-card-writer';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const message = { projectPath: '/p', placeId: 'place:dev', text: '◆ Do dono, na carta «X»: refaz', leaderText: '◆ para o Líder: refaz' };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fila-'));
  dirs.push(dir);
  const file = join(dir, 'fila.json');
  let clock = Date.UTC(2026, 10, 7, 20);
  let notified = 0;
  const open = () => createRelay({ filePath: file, io, now: () => clock, notify: () => notified++ });
  return { open, notified: () => notified, advance: (ms: number) => (clock += ms) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Fila do Oráculo na VPS para o PC', () => {
  it('com o PC desligado, o recado espera em disco (inclusive depois de reiniciar o daemon) e sai uma vez quando o PC confirma', async () => {
    const { open, notified } = setup();
    const relay = open();
    expect(await relay.send(message, 0)).toBe('pendente');
    expect(notified()).toBe(1);
    const restarted = open();
    const pending = restarted.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.message).toEqual(message);
    expect(restarted.ack(pending[0]!.id, { placeId: 'place:dev' })).toBe(true);
    expect(restarted.pending()).toHaveLength(0);
    expect(restarted.ack(pending[0]!.id, { placeId: 'place:dev' }), 'um ack repetido não faz nada').toBe(false);
    expect(open().pending()).toHaveLength(0);
  });

  it('com o PC ligado, espera o ack e devolve para onde foi', async () => {
    const { open } = setup();
    const relay = open();
    const sent = relay.send(message, 5_000);
    const [item] = relay.pending();
    relay.ack(item!.id, 'lider');
    expect(await sent).toEqual('lider');
  });

  it('a nova tentativa do MESMO pedido não duplica: pendente vira o mesmo item; já entregue responde onde foi', async () => {
    const { open } = setup();
    const relay = open();
    const once = { ...message, key: 'comentario:t-1:pedido-0001' };
    await relay.send(once, 0);
    await relay.send(once, 0);
    expect(relay.pending()).toHaveLength(1);
    relay.ack(relay.pending()[0]!.id, { placeId: 'place:dev' });
    expect(await relay.send(once, 0)).toEqual({ placeId: 'place:dev' });
    expect(relay.pending()).toHaveLength(0);
  });

  it('mensagens de texto igual mas de pedidos diferentes entram as duas (revisão do #299)', async () => {
    const { open } = setup();
    const relay = open();
    await relay.send({ ...message, key: 'decisao:t-1:1000' }, 0);
    relay.ack(relay.pending()[0]!.id, { placeId: 'place:dev' });
    expect(await relay.send({ ...message, key: 'decisao:t-1:2000' }, 0)).toBe('pendente');
    expect(relay.pending()).toHaveLength(1);
    // Without a key, every send is its own message.
    await relay.send(message, 0);
    await relay.send(message, 0);
    expect(relay.pending()).toHaveLength(3);
  });

  it('duas rejeições "Refazer" da mesma tarefa, em rodadas diferentes, chegam as duas ao Dev', async () => {
    const { open } = setup();
    const relay = open();
    const dir = mkdtempSync(join(tmpdir(), 'fila-carta-'));
    dirs.push(dir);
    let clock = Date.UTC(2026, 10, 7, 21);
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
    const writer = createCardWriter({
      service: () => ledger,
      deliver: async (m) => {
        const to = await relay.send(m, 0);
        return to === 'pendente' ? null : to;
      },
    });
    const dev = { kind: 'lugar' as const, placeId: 'place:dev' };
    const created = await ledger.apply({ kind: 'lugar', placeId: 'place:lider', roleId: 'lider' }, { op: 'criar', projectPath: '/p', request: 'faz', doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'alto' });
    if (!created.ok) throw new Error(created.reason);
    const id = created.task.id;
    const forOwner: LedgerForOwner = {
      question: 'Aceito?',
      summary: 'Feito.',
      options: [
        { label: 'Aceitar', effect: 'Fecha.', closes: 'aceita', recommended: true },
        { label: 'Refazer', effect: 'Volta.', closes: 'rejeitada' },
      ],
      why: 'ok',
      risk: 'baixo',
    };
    for (let round = 1; round <= 2; round++) {
      expect((await ledger.apply(dev, { op: 'assumir', id })).ok).toBe(true);
      expect((await ledger.apply(dev, { op: 'entregar', id, proofs: [{ kind: 'texto', text: `rodada ${round}` }], forOwner })).ok).toBe(true);
      const rejected = await ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: '', option: 'Refazer' });
      if (!rejected.ok) throw new Error(rejected.reason);
      expect(await writer.tellDecision(rejected.task), `rodada ${round}`).toBeNull();
      const pending = relay.pending();
      expect(pending, `rodada ${round}`).toHaveLength(1);
      expect(pending[0]!.message.text).toMatch(/rejeitou a tarefa/);
      relay.ack(pending[0]!.id, { placeId: 'place:dev' });
    }
  });

  it('uma fila.json ilegível fica guardada à parte, não é sobrescrita', async () => {
    const { open } = setup();
    const relay = open();
    const dir = dirs.at(-1)!;
    writeFileSync(join(dir, 'fila.json'), '{ isto não é json');
    await relay.send({ ...message, key: 'k-1' }, 0);
    const kept = readdirSync(dir).filter((name) => name.startsWith('fila.ilegivel-'));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, kept[0]!), 'utf8')).toBe('{ isto não é json');
    expect(relay.pending()).toHaveLength(1);
  });

  it('um ack de "ninguém aberto" não tira da fila', async () => {
    const { open } = setup();
    const relay = open();
    await relay.send(message, 0);
    expect(relay.ack(relay.pending()[0]!.id, null)).toBe(false);
    expect(relay.pending()).toHaveLength(1);
  });

  it('o PC que volta entrega pelo próprio motor o que esperava na VPS, uma vez só, e confirma', async () => {
    const vpsDir = mkdtempSync(join(tmpdir(), 'fila-vps-'));
    const pcDir = mkdtempSync(join(tmpdir(), 'fila-pc-'));
    dirs.push(vpsDir, pcDir);
    const vpsFile = join(vpsDir, 'ledger.json');
    let hash: string | null = null;
    const relay = createRelay({ filePath: join(vpsDir, 'fila.json'), io });
    const daemon = createOracleApiHandler({
      ledger: createLedgerService({ filePath: vpsFile, io, proofFs: nodeLedgerProofFs }),
      ledgerFile: vpsFile,
      tokenHash: () => hash,
      extra: createOracleAdminRoutes({ celular: {} as CelularCore, relay }),
    });
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const { pathname, search } = new URL(url);
      const body = init.body;
      const res = await daemon({ method: init.method ?? 'GET', url: pathname + search, authorization: (init.headers as Record<string, string>).Authorization, body: typeof body === 'string' ? body : '', ...(body instanceof Uint8Array ? { bytes: body } : {}) });
      return new Response(typeof res.body === 'string' ? res.body : readFileSync(res.body.filePath), { status: res.status });
    }) as unknown as typeof fetch;
    // With the PC off: the owner's words on a card wait on the VPS.
    expect(await relay.send(message, 0)).toBe('pendente');

    const delivered: OwnerMessage[] = [];
    const pcFile = join(pcDir, 'ledger.json');
    const local = () => createLedgerService({ filePath: pcFile, io, proofFs: nodeLedgerProofFs });
    const held = createSwitchableLedger(local());
    const host = createRemoteOracleHost({
      userDataDir: pcDir,
      ledgerFile: pcFile,
      io,
      proofFs: nodeLedgerProofFs,
      remotes: () => [{ id: 'vps', label: 'VPS', sshTarget: 'eu@vps' }],
      runScript: async (_target, script) => {
        hash = /'([0-9a-f]{64})'/.exec(script)![1]!;
        return { code: 0, stdout: 'http://100.64.0.9:47816\n', stderr: '' };
      },
      localService: local,
      setService: (next) => held.set(next),
      freeze: (reason) => held.freeze(reason),
      onChange: () => undefined,
      fetchImpl,
      deliver: () => async (m) => {
        delivered.push(m);
        return { placeId: m.placeId };
      },
    });
    try {
      expect((await host.move('vps')).ok).toBe(true);
      await host.drain();
      await host.drain();
      expect(delivered).toEqual([message]);
      expect(relay.pending()).toHaveLength(0);
    } finally {
      host.dispose();
    }
  });
});
