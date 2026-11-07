// Oráculo na VPS (t-d7a974d0), fatia 1 — the daemon's API is the only writer of the ledger once the PC is in remote
// mode. What breaks without the owner noticing: a call without the token that writes, or a write that does not land
// in the file as today's ledger would write it.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';

const TOKEN = 'a'.repeat(64);
const dirs: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  return { file, service, handle: createOracleApiHandler({ ledger: service, token: TOKEN }) };
}

const auth = `Bearer ${TOKEN}`;
const criar = {
  actor: { kind: 'lugar', placeId: 'place:a' },
  op: { op: 'criar', projectPath: '/p', request: 'faz X', doneWhen: 'X feito', due: '2026-11-10', ownerPlaceId: 'place:a', risk: 'baixo' },
};
const req = (r: Partial<OracleRequest>): OracleRequest => ({ method: 'GET', url: '/', body: '', ...r });

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('API do Oráculo na VPS', () => {
  it('sem o token certo, nada lê nem grava', async () => {
    const { file, handle } = setup();
    for (const authorization of [undefined, 'Bearer errado', `Bearer ${'b'.repeat(64)}`, TOKEN]) {
      expect((await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(criar), authorization }))).status).toBe(401);
      expect((await handle(req({ url: '/v1/ledger', authorization }))).status).toBe(401);
    }
    expect(() => readFileSync(file)).toThrow();
  });

  it('grava pelo apply de hoje e devolve o registro novo', async () => {
    const { file, handle } = setup();
    const res = await handle(req({ method: 'POST', url: '/v1/apply', body: JSON.stringify(criar), authorization: auth }));
    expect(res.status).toBe(200);
    const answer = JSON.parse(res.body as string);
    expect(answer.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
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
    expect(() => readFileSync(file)).toThrow();
  });

  it('guarda a prova enviada em bytes e a devolve pelo nome', async () => {
    const { file, handle } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const res = await handle(req({ method: 'PUT', url: '/v1/provas?ext=png', bytes: png, authorization: auth }));
    expect(res.status).toBe(200);
    const proof = JSON.parse(res.body as string);
    expect(proof).toMatchObject({ kind: 'arquivo', mediaType: 'image/png' });
    expect(new Uint8Array(readFileSync(join(ledgerProofsDir(file), proof.file)))).toEqual(png);
    const back = await handle(req({ url: `/v1/provas/${proof.file}`, authorization: auth }));
    expect(back.status).toBe(200);
    expect(back.body).toEqual({ filePath: join(ledgerProofsDir(file), proof.file) });
    expect((await handle(req({ method: 'PUT', url: '/v1/provas?ext=exe', bytes: png, authorization: auth }))).status).toBe(400);
    expect((await handle(req({ url: '/v1/provas/..%2Fledger.json', authorization: auth }))).status).toBe(404);
  });
});
