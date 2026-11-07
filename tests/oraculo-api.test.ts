// Oráculo na VPS (t-d7a974d0) — the daemon's API is the only writer of the ledger once the PC is in remote mode.
// What breaks without the owner noticing: a call without the token that writes, a write that does not land in the
// file as today's ledger would write it, or the move of the PC's ledger that loses a task or a proof.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';

const TOKEN = 'a'.repeat(64);
const dirs: string[] = [];

function setup(tokenHash: string | null = createHash('sha256').update(TOKEN).digest('hex')) {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  let changed = 0;
  const handle = createOracleApiHandler({ ledger: service, ledgerFile: file, tokenHash: () => tokenHash, changed: () => changed++ });
  return { dir, file, service, handle, changes: () => changed };
}

const auth = `Bearer ${TOKEN}`;
const criar = {
  actor: { kind: 'lugar', placeId: 'place:a' },
  op: { op: 'criar', projectPath: '/p', request: 'faz X', doneWhen: 'X feito', due: '2026-11-10', ownerPlaceId: 'place:a', risk: 'baixo' },
};
const req = (r: Partial<OracleRequest>): OracleRequest => ({ method: 'GET', url: '/', body: '', ...r });
const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

/** A PC ledger as the app writes it today: one delivered task with a print. */
function pcLedger(proof = '2026-11-01-abcdef012345.png'): string {
  return JSON.stringify(
    {
      schemaVersion: 4,
      startedAt: 1,
      tasks: {
        't-1': {
          id: 't-1',
          projectPath: '/p',
          request: 'faz X',
          doneWhen: 'X feito',
          due: '2026-11-10',
          ownerPlaceId: 'place:a',
          risk: 'baixo',
          state: 'entregue',
          createdAt: 1,
          events: [
            { kind: 'criada', at: 1, by: { kind: 'lugar', placeId: 'place:a' } },
            { kind: 'entregue', at: 2, by: { kind: 'lugar', placeId: 'place:a' }, proofs: [{ kind: 'arquivo', file: proof, mediaType: 'image/png' }] },
          ],
        },
      },
    },
    null,
    2,
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('API do Oráculo na VPS', () => {
  it('sem o token certo, nada lê nem grava; sem hash gravado pelo PC, nenhum token vale', async () => {
    const { file, handle } = setup();
    for (const authorization of [undefined, 'Bearer errado', `Bearer ${'b'.repeat(64)}`, TOKEN]) {
      expect((await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(criar), authorization }))).status).toBe(401);
      expect((await handle(req({ url: '/v1/ledger', authorization }))).status).toBe(401);
    }
    const none = setup(null);
    expect((await none.handle(req({ url: '/v1/ledger', authorization: auth }))).status).toBe(401);
    expect(existsSync(file)).toBe(false);
  });

  it('grava pelo apply de hoje e devolve o registro novo', async () => {
    const { file, handle } = setup();
    const res = await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(criar), authorization: auth }));
    expect(res.status).toBe(200);
    const answer = JSON.parse(res.body as string);
    expect(answer.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.schemaVersion).toBe(4);
    expect(onDisk.tasks[answer.task.id].request).toBe('faz X');
    expect(answer.snapshot.doc).toEqual(onDisk);
    const read = JSON.parse((await handle(req({ url: '/v1/ledger', authorization: auth }))).body as string);
    expect(read.doc).toEqual(onDisk);
  });

  it('recusa operação inválida sem gravar nem cair', async () => {
    const { file, handle } = setup();
    for (const body of ['nada', '{}', JSON.stringify({ actor: { kind: 'x' }, op: criar.op }), JSON.stringify({ actor: criar.actor, op: { op: 'criar' } })]) {
      const res = await handle(req({ method: 'POST', url: '/v1/apply', body, authorization: auth }));
      expect(res.status).toBe(400);
    }
    expect(existsSync(file)).toBe(false);
    expect((await handle(req({ url: '/v1/provas/%E0%A4%A', authorization: auth }))).status).toBe(404);
  });

  it('guarda a prova enviada em bytes, a devolve pelo nome e só apaga a que nenhuma entrega cita', async () => {
    const { file, handle } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const res = await handle(req({ method: 'PUT', url: '/v1/provas?ext=png', bytes: png, authorization: auth }));
    expect(res.status).toBe(200);
    const proof = JSON.parse(res.body as string);
    expect(proof).toMatchObject({ kind: 'arquivo', mediaType: 'image/png' });
    const path = join(ledgerProofsDir(file), proof.file);
    expect(new Uint8Array(readFileSync(path))).toEqual(png);
    expect((await handle(req({ url: `/v1/provas/${proof.file}`, authorization: auth }))).body).toEqual({ filePath: path });
    expect((await handle(req({ method: 'PUT', url: '/v1/provas?ext=exe', bytes: png, authorization: auth }))).status).toBe(400);
    expect((await handle(req({ url: '/v1/provas/..%2Fledger.json', authorization: auth }))).status).toBe(404);

    // Cited by a delivery: stays. Not cited (a refused delivery left it): goes.
    const created = JSON.parse((await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(criar), authorization: auth }))).body as string);
    const take = { actor: criar.actor, op: { op: 'assumir', id: created.task.id } };
    expect(JSON.parse((await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(take), authorization: auth }))).body as string).ok).toBe(true);
    const deliver = { actor: criar.actor, op: { op: 'entregar', id: created.task.id, proofs: [proof] } };
    expect(JSON.parse((await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(deliver), authorization: auth }))).body as string).ok).toBe(true);
    expect((await handle(req({ method: 'DELETE', url: `/v1/provas/${proof.file}`, authorization: auth }))).status).toBe(409);
    expect(existsSync(path)).toBe(true);
    const orphan = JSON.parse((await handle(req({ method: 'PUT', url: '/v1/provas?ext=png', bytes: png, authorization: auth }))).body as string);
    expect((await handle(req({ method: 'DELETE', url: `/v1/provas/${orphan.file}`, authorization: auth }))).status).toBe(200);
    expect(existsSync(join(ledgerProofsDir(file), orphan.file))).toBe(false);
  });

  it('importa o ledger.json do PC byte a byte, com as provas pelo mesmo nome, e devolve os mesmos bytes', async () => {
    const { file, handle, changes } = setup();
    const name = '2026-11-01-abcdef012345.png';
    const text = pcLedger(name);
    // Without the proof on the VPS: refused, nothing written.
    let res = await handle(req({ method: 'POST', url: '/v1/importar', bytes: bytesOf(text), authorization: auth }));
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).error).toMatch(/faltam 1 prova/);
    expect(existsSync(file)).toBe(false);

    const png = new Uint8Array([9, 9, 9]);
    expect((await handle(req({ method: 'PUT', url: `/v1/provas/${name}`, bytes: png, authorization: auth }))).status).toBe(200);
    expect(await handle(req({ method: 'PUT', url: `/v1/provas/${name}`, bytes: png, authorization: auth })), 'reenvio igual').toMatchObject({ status: 200 });
    expect((await handle(req({ method: 'PUT', url: `/v1/provas/${name}`, bytes: new Uint8Array([1]), authorization: auth }))).status).toBe(409);

    res = await handle(req({ method: 'POST', url: '/v1/importar', bytes: bytesOf(text), authorization: auth }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({ ok: true, tarefas: 1, eventos: 2 });
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(changes()).toBe(1);
    expect((await handle(req({ url: '/v1/ledger/arquivo', authorization: auth }))).body).toEqual({ filePath: file });

    // A VPS that already has tasks is never written over.
    res = await handle(req({ method: 'POST', url: '/v1/importar', bytes: bytesOf(text), authorization: auth }));
    expect(res.status).toBe(409);
  });

  it('recusa importar o que o parse perderia ou o espelho marcado do modo remoto', async () => {
    const { dir, file, handle } = setup();
    mkdirSync(ledgerProofsDir(file), { recursive: true });
    writeFileSync(join(dir, 'x'), '');
    const broken = JSON.parse(pcLedger());
    broken.tasks['t-2'] = { id: 't-2', nada: true };
    let res = await handle(req({ method: 'POST', url: '/v1/importar', bytes: bytesOf(JSON.stringify(broken)), authorization: auth }));
    expect(JSON.parse(res.body as string).error).toMatch(/perderia 1 tarefa/);
    const mirror = { ...JSON.parse(pcLedger()), schemaVersion: 1000 };
    res = await handle(req({ method: 'POST', url: '/v1/importar', bytes: bytesOf(JSON.stringify(mirror)), authorization: auth }));
    expect(res.status).toBe(409);
    expect(existsSync(file)).toBe(false);
  });
});
