// F6 (docs/planos/ledger-bom.md) — crons, workflows and bots read the journal incrementally and append to it with
// the service credential. What breaks without the owner noticing: a retried cron that writes the same entry twice, a
// revoked token that still reads or writes, a read that skips or repeats an entry, a torn line after a crash, or the
// journal switched on in a daemon that did not ask for it.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { createLivroStore, LIVRO_PATH } from '../src/oraculo/livro';
import { readServiceHashes } from '../src/oraculo/servicos';
import { readJournal } from '../src/shared/livro/formato';

const PC = 'p'.repeat(64);
const SVC = 's'.repeat(64);
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(withLivro = true) {
  const dir = mkdtempSync(join(tmpdir(), 'livro-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'servicos'));
  writeFileSync(join(dir, 'servicos', 'cron-teste.sha256'), `${hash(SVC)}\n`);
  const file = join(dir, 'ledger.json');
  const ledger = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  const journal = join(dir, 'lancamentos.jsonl');
  const handle = createOracleApiHandler({ ledger, ledgerFile: file, tokenHash: () => hash(PC), services: () => readServiceHashes(dir), ...(withLivro ? { livro: createLivroStore({ filePath: journal }) } : {}) });
  return { dir, journal, handle };
}

const req = (r: Partial<OracleRequest>, token = SVC): OracleRequest => ({ method: 'GET', url: '/', body: '', authorization: `Bearer ${token}`, ...r });
const body = async (response: Promise<{ status: number; body: unknown }>) => {
  const { status, body: raw } = await response;
  return { status, ...JSON.parse(raw as string) };
};
const criar = (tarefa: string, ownerPlaceId = 'servico:cron-teste') => ({ projectPath: '/teste', request: `cron ${tarefa}`, doneWhen: 'lido', due: '2026-11-10', ownerPlaceId, risk: 'baixo' });
const lancar = (tarefa: string, chave = `k-${tarefa}`, dados: unknown = criar(tarefa)) => req({ method: 'POST', url: LIVRO_PATH, body: JSON.stringify({ tipo: 'criar', tarefa, chave, dados }) });
const lines = (journal: string) => readFileSync(journal, 'utf8').trim().split('\n');

describe('livro: leitura e escrita por todas as pontas (F6)', () => {
  it('reads the last entries and from a seq on, appends with a key once, and refuses a revoked token at once', async () => {
    const { dir, journal, handle } = setup();
    for (let n = 1; n <= 12; n += 1) expect(await body(handle(lancar(`t-${n}`)))).toMatchObject({ status: 200, novo: true, lancamento: { seq: n, quem: { kind: 'lugar', placeId: 'servico:cron-teste' } } });

    const last = await body(handle(req({ url: `${LIVRO_PATH}?ultimos=10` })));
    expect(last.lancamentos.map((each: { seq: number }) => each.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(last.ultimo).toBe(12);
    const since = await body(handle(req({ url: `${LIVRO_PATH}?desde=10` })));
    expect(since.lancamentos.map((each: { seq: number }) => each.seq)).toEqual([11, 12]);

    // The cron runs again: the same key is the same entry, not a new one; the same key with other content is refused.
    expect(await body(handle(lancar('t-12')))).toMatchObject({ status: 200, novo: false, lancamento: { seq: 12 } });
    expect(await body(handle(lancar('t-12', 'k-t-12', criar('t-99'))))).toMatchObject({ status: 409 });
    expect(lines(journal)).toHaveLength(12);
    // A service only creates, takes and delivers, by the same rule as its op route.
    expect((await handle(req({ method: 'POST', url: LIVRO_PATH, body: JSON.stringify({ tipo: 'cancelar', tarefa: 't-1', chave: 'c', dados: { reason: 'x' } }) }))).status).toBe(403);

    // A torn last line (the process died mid-write) is cut on the next load, never read nor chained onto.
    appendFileSync(journal, '{"seq":13,"tip');
    const reopened = createLivroStore({ filePath: journal });
    expect(reopened.ler({ ultimos: 1 }).ultimo).toBe(12);
    expect(reopened.lancar({ kind: 'lugar', placeId: 'servico:cron-teste' }, { tipo: 'criar', tarefa: 't-13', chave: 'k-t-13', dados: criar('t-13') })).toMatchObject({ ok: true, lancamento: { seq: 13 } });
    expect(readJournal(readFileSync(journal, 'utf8'))).toMatchObject({ problems: [] });
    expect(lines(journal)).toHaveLength(13);

    // Revoked: the hash file goes, the next call is refused, with no restart.
    unlinkSync(join(dir, 'servicos', 'cron-teste.sha256'));
    expect((await handle(req({ url: `${LIVRO_PATH}?ultimos=10` }))).status).toBe(401);
    expect((await handle(lancar('t-14'))).status).toBe(401);
  });

  it('an entry the rules refuse is answered with the reason and not appended; a daemon without the journal has no route', async () => {
    const { journal, handle } = setup();
    const pc = (tipo: string, tarefa: string, chave: string, dados: unknown) => req({ method: 'POST', url: LIVRO_PATH, body: JSON.stringify({ quem: { kind: 'dono' }, tipo, tarefa, chave, dados }) }, PC);
    for (const id of ['t-1', 't-2', 't-3']) expect((await handle(pc('criar', id, `k-${id}`, criar(id, 'place:a')))).status).toBe(200);
    expect((await handle(pc('agrupada', 't-2', 'agrupa-1', { pai: 't-1' }))).status).toBe(200);
    expect(await body(handle(pc('agrupada', 't-2', 'agrupa-3', { pai: 't-3' })))).toMatchObject({ status: 409, error: expect.stringMatching(/já está agrupada sob t-1/) });
    expect(lines(journal)).toHaveLength(4);

    const off = setup(false);
    expect((await off.handle(req({ url: `${LIVRO_PATH}?ultimos=10` }))).status).toBe(404);
  });
});
