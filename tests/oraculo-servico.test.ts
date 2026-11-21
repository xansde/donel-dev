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
import { progressOf } from '../src/shared/ledger/andamento';

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

  it('o reconciliador só passa ao Líder único a tarefa de lugar fechado; nenhum outro serviço transfere', async () => {
    const { dir, file, ledger, handle } = setup();
    const REC = 'r'.repeat(64);
    writeFileSync(join(dir, 'servicos', 'reconciliador.sha256'), `${hash(REC)}\n`);
    const created = await ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: '/p', request: 'x', doneWhen: 'y', due: '2026-11-20', ownerPlaceId: 'place:fechado', risk: 'baixo' });
    if (!created.ok) throw new Error(created.reason);
    const id = created.task.id;
    const as = (token: string, op: unknown) => handle(req({ method: 'POST', url: SERVICE_PATH, body: JSON.stringify({ op }), authorization: `Bearer ${token}` }));
    const passa = { op: 'transferir', id, to: 'lider', ownerGone: true, reason: 'lugar fechado' };
    expect((await as(SVC, passa)).status).toBe(400);
    expect((await as(REC, { ...passa, to: 'place:outro' })).status).toBe(400);
    expect((await as(REC, { ...passa, ownerGone: undefined })).status).toBe(400);
    expect((await as(REC, { op: 'cancelar', id, reason: 'x' })).status).toBe(400);
    expect((await as(REC, { ...passa, risk: 'alto' })).status).toBe(400);
    // Nem pelo contrato: o ramo do reconciliador não aceita mudar o risco.
    const pelaPorta = await ledger.apply({ kind: 'lugar', placeId: 'servico:reconciliador', roleId: 'servico' }, { op: 'transferir', id, to: 'lider', ownerGone: true, reason: 'x', risk: 'alto' });
    expect(pelaPorta.ok).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).tasks[id].ownerPlaceId).toBe('place:fechado');
    expect(JSON.parse((await as(REC, passa)).body as string)).toMatchObject({ ok: true, estado: 'aberta' });
    expect(JSON.parse(readFileSync(file, 'utf8')).tasks[id].ownerPlaceId).toBe('lider');
    // O alerta da SRE vira tarefa do Líder único pela mesma credencial.
    const alerta = JSON.parse((await as(REC, { ...criar, request: 'alerta SRE: disco cheio', ownerPlaceId: 'lider', requestedBy: 'SRE' })).body as string);
    expect(alerta).toMatchObject({ ok: true, estado: 'aberta' });
    expect(JSON.parse(readFileSync(file, 'utf8')).tasks[alerta.id].ownerPlaceId).toBe('lider');
  });

  // t-27340b98 — a cron routine (the faixa-preta's) records its daily lines on a task of its own, with no live session.
  // What breaks unseen: a service writing on someone else's task, or the same line twice on a retry.
  it('serviço registra andamento só na tarefa de que é dono; na alheia é recusado; a mesma chave não grava em dobro', async () => {
    const { file, ledger, handle } = setup();
    const lines = (id: string) => (JSON.parse(readFileSync(file, 'utf8')).tasks[id].events as { by: unknown; text?: string }[]).flatMap((e) => (progressOf(e as never) ? [{ by: e.by, progress: progressOf(e as never) }] : []));
    const own = JSON.parse((await handle(svc(criar))).body as string).id as string;
    await handle(svc({ op: 'assumir', id: own }));
    const progress = { estado: 'trabalhando', prova: 'linha 1 de 5 do dia 20/11', proximo: 'linha 2' };
    const op = { op: 'andamento', id: own, progress, requestId: 'fp-2026-11-20-l1' };
    expect(JSON.parse((await handle(svc(op))).body as string)).toMatchObject({ ok: true, id: own, estado: 'em-execucao' });
    expect(JSON.parse((await handle(svc(op))).body as string)).toMatchObject({ ok: true, id: own });
    expect(lines(own)).toEqual([{ by: { kind: 'lugar', placeId: 'servico:mencoes', roleId: 'servico' }, progress }]);

    const other = await ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: '/p', request: 'x', doneWhen: 'y', due: '2026-11-20', ownerPlaceId: 'place:e8e2842d-1111-4111-8111-111111111111', risk: 'baixo' });
    if (!other.ok) throw new Error(other.reason);
    await ledger.apply({ kind: 'lugar', placeId: other.task.ownerPlaceId }, { op: 'assumir', id: other.task.id });
    for (const bad of [
      { ...op, id: other.task.id },
      { ...op, id: other.task.id, requestId: undefined },
      { ...op, extra: 1 },
      { ...op, progress: { ...progress, resumo: 'x' } },
    ])
      expect((await handle(svc(bad))).status).toBe(400);
    expect(lines(other.task.id)).toEqual([]);
    expect(lines(own)).toHaveLength(1);
  });

  // t-e1e992ab — a real refusal of the VPS's limiter (a session waiting for a slot, a Workflow, a heavy run, a cron
  // routine) is a progress line of the task it belongs to, never a notice to the Líder. What breaks unseen: the line
  // on someone else's task, a "travada" that reaches the Líder at once, or a second line for the same series.
  describe('andamento do limitador', () => {
    const LIM = 'l'.repeat(64);
    const A = 'place:8be0d000-1111-4111-8111-111111111111';
    const B = 'place:ddb23b03-2222-4222-8222-222222222222';
    const esperando = { estado: 'esperando', precisa: 'vaga na VPS pessoal (limitador): teto de sessões', prova: 'eventos.jsonl, série desde 10:00', proximo: 'entra sozinho quando a vaga abrir' };

    async function limiter() {
      const t = setup();
      writeFileSync(join(t.dir, 'servicos', 'limitador.sha256'), `${hash(LIM)}\n`);
      const make = async (owner: string, take: boolean): Promise<string> => {
        const created = await t.ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: '/p', request: `trabalho de ${owner}`, doneWhen: 'y', due: '2026-11-20', ownerPlaceId: owner, risk: 'baixo' });
        if (!created.ok) throw new Error(created.reason);
        if (take) await t.ledger.apply({ kind: 'lugar', placeId: owner }, { op: 'assumir', id: created.task.id });
        return created.task.id;
      };
      const reserva = await make('place:dca45050-3333-4333-8333-333333333333', true);
      const as = (token: string, op: unknown) => t.handle(req({ method: 'POST', url: SERVICE_PATH, body: JSON.stringify({ op }), authorization: `Bearer ${token}` }));
      const lines = (id: string) => (JSON.parse(readFileSync(t.file, 'utf8')).tasks[id].events as { by: unknown; text?: string }[]).flatMap((e) => (progressOf(e as never) ? [{ by: e.by, progress: progressOf(e as never) }] : []));
      return { ...t, make, reserva, as, lines };
    }

    it('grava "esperando" na tarefa viva do lugar, assinado pelo serviço; outro estado ou outro serviço não grava', async () => {
      const t = await limiter();
      const id = await t.make(A, true);
      const op = { op: 'andamento', lugar: A, reserva: t.reserva, progress: esperando, requestId: 'lim-0123456789abcdef' };
      for (const estado of ['travada', 'precisa-do-dono']) expect((await t.as(LIM, { ...op, progress: { ...esperando, estado } })).status).toBe(400);
      expect((await t.as(SVC, op)).status).toBe(400);
      expect(t.lines(id)).toEqual([]);
      const done = await t.as(LIM, op);
      expect(JSON.parse(done.body as string)).toMatchObject({ ok: true, id, estado: 'em-execucao' });
      expect(t.lines(id)).toEqual([{ by: { kind: 'lugar', placeId: 'servico:limitador', roleId: 'servico' }, progress: esperando }]);
      // The same series sent again (the retry after 5 min) is the same line.
      expect(JSON.parse((await t.as(LIM, op)).body as string)).toMatchObject({ ok: true, id });
      expect(t.lines(id)).toHaveLength(1);
      expect(t.lines(t.reserva)).toEqual([]);
    });

    it('o prefixo do lugar acha o dono único e a tarefa em execução mais recente; ambíguo, sem tarefa ou sem lugar vai à reserva', async () => {
      const t = await limiter();
      const open = await t.make(A, false);
      const running = await t.make(A, true);
      const op = (lugar?: string) => ({ op: 'andamento', ...(lugar ? { lugar } : {}), reserva: t.reserva, progress: esperando });
      expect(JSON.parse((await t.as(LIM, op('place:8be0d000'))).body as string)).toMatchObject({ ok: true, id: running });
      expect(t.lines(open)).toEqual([]);
      // A place with no live task, and a routine of the cron (no place): the reserve.
      expect(JSON.parse((await t.as(LIM, op(B))).body as string)).toMatchObject({ ok: true, id: t.reserva });
      expect(JSON.parse((await t.as(LIM, { ...op(), progress: { ...esperando, precisa: 'rotina' } })).body as string)).toMatchObject({ ok: true, id: t.reserva });
      // Two owners under the same prefix: guessing would put the line on someone else's task.
      await t.make('place:8be0d000-9999-4999-8999-999999999999', true);
      expect(JSON.parse((await t.as(LIM, { ...op('place:8be0d000'), progress: { ...esperando, precisa: 'ambíguo' } })).body as string)).toMatchObject({ ok: true, id: t.reserva });
      expect(t.lines(t.reserva)).toHaveLength(3);
    });

    it('a mesma série repetida não grava 2a linha, nem depois de outra série na mesma tarefa, nem depois de o lugar assumir outra', async () => {
      const t = await limiter();
      const x = { op: 'andamento', reserva: t.reserva, progress: { ...esperando, precisa: 'rotina' }, requestId: 'lim-xxxxxxxxxxxxxxxx' };
      const y = { op: 'andamento', reserva: t.reserva, progress: { ...esperando, precisa: 'lider unico' }, requestId: 'lim-yyyyyyyyyyyyyyyy' };
      for (const op of [x, y, x]) expect(JSON.parse((await t.as(LIM, op)).body as string)).toMatchObject({ ok: true, id: t.reserva });
      expect(t.lines(t.reserva)).toHaveLength(2);
      // The place took another task between the two tries: the retry answers where the series was written.
      const first = await t.make(A, false);
      const z = { op: 'andamento', lugar: A, reserva: t.reserva, progress: esperando, requestId: 'lim-zzzzzzzzzzzzzzzz' };
      expect(JSON.parse((await t.as(LIM, z)).body as string)).toMatchObject({ ok: true, id: first });
      const second = await t.make(A, true);
      expect(JSON.parse((await t.as(LIM, z)).body as string)).toMatchObject({ ok: true, id: first });
      expect(t.lines(first)).toHaveLength(1);
      expect(t.lines(second)).toEqual([]);
    });

    it('reserva fechada, tarefa nomeada, lugar malformado ou campo estranho: 400 e nada gravado', async () => {
      const t = await limiter();
      const id = await t.make(A, true);
      await t.ledger.apply({ kind: 'dono' }, { op: 'cancelar', id: t.reserva, reason: 'fechou' });
      const op = { op: 'andamento', reserva: t.reserva, progress: esperando };
      for (const bad of [
        op,
        { ...op, id },
        { ...op, lugar: A, id },
        { ...op, lugar: 'lider' },
        { ...op, lugar: 'place:8be0' },
        { ...op, lugar: A, extra: 1 },
        { ...op, lugar: A, reserva: undefined },
        { ...op, lugar: A, progress: { ...esperando, resumo: 'x' } },
      ])
        expect((await t.as(LIM, bad)).status).toBe(400);
      expect([...t.lines(id), ...t.lines(t.reserva)]).toEqual([]);
      // The limiter's credential still has the rest of the API closed.
      expect((await t.handle(req({ url: '/v1/ledger', authorization: `Bearer ${LIM}` }))).status).toBe(403);
    });
  });
});
