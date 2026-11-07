// t-a1ea2798 — a headless service (Slack mentions) creates and delivers tasks on the VPS's Oráculo with its own
// credential, with no session open. What breaks without the owner noticing: a service token that reads or rewrites
// the whole ledger (import, way back, phone admin), a service that signs as someone else, a revoked token that still
// writes, or the orphan rules passing a service's own task to the Líder because no board has that place.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, ownerGone } from '../src/main/ledger-store';
import { pickTailscaleAddress } from '../src/main/celular/tailscale';
import { callerOf, createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { startOracleServer } from '../src/oraculo/server';
import { readServiceHashes, SERVICE_PATH } from '../src/oraculo/servicos';

const PC = 'p'.repeat(64);
const SVC = 's'.repeat(64);
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const dirs: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-svc-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'servicos'));
  writeFileSync(join(dir, 'servicos', 'mencoes.sha256'), `${hash(SVC)}\n`);
  const file = join(dir, 'ledger.json');
  const ledger = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  const handle = createOracleApiHandler({ ledger, ledgerFile: file, tokenHash: () => hash(PC), services: () => readServiceHashes(dir) });
  return { dir, file, ledger, handle };
}

const req = (r: Partial<OracleRequest>): OracleRequest => ({ method: 'GET', url: '/', body: '', ...r });
const svc = (op: unknown, extra: Record<string, unknown> = {}): OracleRequest =>
  req({ method: 'POST', url: SERVICE_PATH, body: JSON.stringify({ op, ...extra }), authorization: `Bearer ${SVC}` });
const criar = { op: 'criar', projectPath: '/p', request: 'Ana marcou você no canal de obras', doneWhen: 'o dono leu', due: '2026-11-10', ownerPlaceId: 'servico:mencoes', risk: 'baixo' };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('carta de serviço no Oráculo da VPS', () => {
  it('cria, assume e entrega com a credencial própria, sempre assinando como o serviço', async () => {
    const { file, handle } = setup();
    // The actor in the body is ignored: the token says who it is.
    const created = JSON.parse((await handle(svc(criar, { actor: { kind: 'dono' } }))).body as string);
    expect(created).toMatchObject({ ok: true, estado: 'aberta' });
    expect(JSON.parse((await handle(svc({ op: 'assumir', id: created.id }))).body as string)).toMatchObject({ ok: true, estado: 'em-execucao' });
    const delivered = await handle(svc({ op: 'entregar', id: created.id, proofs: [{ kind: 'texto', text: 'mensagem e thread' }] }));
    expect(JSON.parse(delivered.body as string)).toMatchObject({ ok: true, estado: 'entregue' });
    const task = JSON.parse(readFileSync(file, 'utf8')).tasks[created.id];
    expect(task.events.map((e: { by: unknown }) => e.by)).toEqual(Array(3).fill({ kind: 'lugar', placeId: 'servico:mencoes', roleId: 'servico' }));
  });

  it('não lê o registro, não mexe no resto da API e não decide nem assina por outro', async () => {
    const { file, handle } = setup();
    const auth = `Bearer ${SVC}`;
    for (const r of [
      req({ url: '/v1/ledger', authorization: auth }),
      req({ url: '/v1/ledger/arquivo', authorization: auth }),
      req({ method: 'POST', url: '/v1/apply', body: JSON.stringify({ actor: { kind: 'dono' }, op: criar }), authorization: auth }),
      req({ method: 'POST', url: '/v1/importar', bytes: new Uint8Array(1), authorization: auth }),
      req({ method: 'POST', url: '/v1/devolver', authorization: auth }),
      req({ method: 'PUT', url: '/v1/provas?ext=png', bytes: new Uint8Array(1), authorization: auth }),
      req({ method: 'POST', url: '/v1/celular/ligar', body: '{"enabled":true}', authorization: auth }),
    ])
      expect((await handle(r)).status).toBe(403);
    const created = JSON.parse((await handle(svc(criar))).body as string);
    await handle(svc({ op: 'assumir', id: created.id }));
    for (const op of [
      { op: 'aceitar', id: created.id },
      { op: 'transferir', id: created.id, to: 'lider', reason: 'x' },
      { op: 'entregar', id: created.id, proofs: [{ kind: 'arquivo', file: '2026-11-01-abcdef012345.png', mediaType: 'image/png' }] },
      { op: 'entregar', id: created.id, proofs: [{ kind: 'texto', text: 'x' }], doneBy: 'place:outro' },
      // The owner's mark puts a task in the owner's progress (Jobu): a service never says the owner asked.
      { ...criar, requestedBy: 'dono' },
      { ...criar, requestedBy: ' Dono ' },
    ])
      expect((await handle(svc(op))).status).toBe(400);
    expect(JSON.parse(readFileSync(file, 'utf8')).tasks[created.id].state).toBe('em-execucao');
  });

  // The real socket, where there is a Tailscale address (the VPS, the PC): the events stream is the PC's only.
  const host = pickTailscaleAddress(networkInterfaces());
  it.skipIf(!host)('o canal de eventos do servidor real só abre para o PC', async () => {
    const { dir, file, ledger } = setup();
    const services = () => readServiceHashes(dir);
    const handler = createOracleApiHandler({ ledger, ledgerFile: file, tokenHash: () => hash(PC), services });
    const server = await startOracleServer({ host: host!, port: 0, caller: (a) => callerOf(a, hash(PC), services()), handler });
    try {
      const events = (token: string) => fetch(`${server.url}/v1/eventos`, { headers: { Authorization: `Bearer ${token}` } });
      expect((await events(SVC)).status).toBe(403);
      const pc = await events(PC);
      expect(pc.status).toBe(200);
      await pc.body?.cancel();
      const created = await fetch(`${server.url}${SERVICE_PATH}`, { method: 'POST', headers: { Authorization: `Bearer ${SVC}` }, body: JSON.stringify({ op: criar }) });
      expect(created.status).toBe(200);
      rmSync(join(dir, 'servicos', 'mencoes.sha256'));
      expect((await events(SVC)).status).toBe(401);
      expect((await fetch(`${server.url}${SERVICE_PATH}`, { method: 'POST', headers: { Authorization: `Bearer ${SVC}` }, body: JSON.stringify({ op: criar }) })).status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('token revogado (hash apagado) ou desconhecido não grava nada', async () => {
    const { dir, file, handle } = setup();
    rmSync(join(dir, 'servicos', 'mencoes.sha256'));
    expect((await handle(svc(criar))).status).toBe(401);
    writeFileSync(join(dir, 'servicos', 'NOME RUIM.sha256'), hash(SVC));
    expect((await handle(svc(criar))).status).toBe(401);
    expect(() => readFileSync(file)).toThrow();
  });

  it('tarefa aberta de um serviço não vira órfã por não haver lugar dele no quadro', () => {
    const task = { id: 't-1', projectPath: '/p', request: 'r', doneWhen: 'd', due: '2026-11-10', ownerPlaceId: 'servico:mencoes', risk: 'baixo' as const, state: 'aberta' as const, createdAt: 0, events: [] };
    expect(ownerGone({ projectPath: '/p', placeId: 'place:x', boardPlaceIds: [], placeStates: new Map([['/p', new Map()]]) }, task, 10 ** 12)).toBeNull();
  });
});
