// t-e195b35c — the brake on the PC's remote ledger (the freeze of 18/11, 08h13–08h45): each write on the VPS made the
// PC re-read, rewrite and send to the windows the whole ledger (10 MB) two or three times. What breaks without the
// owner noticing: a burst that still floods the windows, and a delayed mirror that loses the last version.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createRemoteLedgerService, moveLedgerToRemote, type OracleHttp } from '../src/main/ledger-remote';
import { createOracleApiHandler } from '../src/oraculo/api';
import { createReturnGuard } from '../src/oraculo/devolvido';
import type { LedgerSnapshot } from '../src/shared/ledger/channels';

const TOKEN = 'c'.repeat(64);
const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const marker = { lugar: 'vps-pessoal', desde: '2026-11-18T08:00:00.000Z' };
const LIDER = { kind: 'lugar' as const, placeId: 'place:lider', roleId: 'lider' };

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The daemon in process, counting the whole-ledger reads. */
function vps() {
  const dir = tempDir('vps-');
  const file = join(dir, 'ledger.json');
  const guard = createReturnGuard(createLedgerService({ filePath: file, io, proofFs: nodeLedgerProofFs }), dir);
  const handle = createOracleApiHandler({ ledger: guard.ledger, ledgerFile: file, tokenHash: () => createHash('sha256').update(TOKEN).digest('hex'), returned: guard });
  const reads = { count: 0 };
  const http: OracleHttp = async (method, path, body) => {
    if (method === 'GET' && path === '/v1/ledger') reads.count++;
    const res = await handle({ method, url: path, authorization: `Bearer ${TOKEN}`, body: typeof body === 'string' ? body : '', ...(body instanceof Uint8Array ? { bytes: body } : {}) });
    const raw = typeof res.body === 'string' ? Buffer.from(res.body) : readFileSync(res.body.filePath);
    return { status: res.status, text: async () => raw.toString('utf8'), bytes: async () => new Uint8Array(raw) };
  };
  return { ledger: guard.ledger, http, reads };
}

async function remoteMode(opts: { changeEveryMs: number; mirrorDelayMs: number }) {
  const pcDir = tempDir('pc-');
  const pcFile = join(pcDir, 'ledger.json');
  const remote = vps();
  expect((await moveLedgerToRemote({ http: remote.http, ledgerFile: pcFile, io, proofFs: nodeLedgerProofFs, marker })).ok).toBe(true);
  const changes: LedgerSnapshot[] = [];
  const service = createRemoteLedgerService({ http: () => remote.http, ledgerFile: pcFile, io, proofFs: nodeLedgerProofFs, marker, onChange: (s) => changes.push(s), ...opts });
  return { pcFile, remote, changes, service };
}

const criar = (request: string) => ({ op: 'criar' as const, projectPath: '/p', request, doneWhen: 'x', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' as const });

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('freio do ledger remoto no PC', { timeout: 30_000 }, () => {
  it('uma rajada de escritas manda o documento às janelas 1 ou 2 vezes, sem reler o ledger inteiro a cada resposta', async () => {
    const { remote, changes, service } = await remoteMode({ changeEveryMs: 1000, mirrorDelayMs: 50 });
    expect(await service.refresh()).toBe(true);
    await sleep(1100);
    changes.length = 0;
    const readsBefore = remote.reads.count;
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const created = await service.apply(LIDER, criar(`rajada ${i}`));
      if (!created.ok) throw new Error(created.reason);
      ids.push(created.task.id);
    }
    expect(remote.reads.count, 'a resposta leve já trouxe a tarefa: nada de reler o ledger inteiro').toBe(readsBefore);
    await sleep(1200);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.length).toBeLessThanOrEqual(2);
    for (const id of ids) expect(changes.at(-1)!.doc.tasks[id], 'a última mudança traz tudo').toBeDefined();

    // The same ledger read again: nothing changed, nothing goes to the windows.
    await service.refresh();
    const settled = changes.length;
    await service.refresh();
    await sleep(1200);
    expect(changes.length).toBe(settled);
    service.retire();
  });

  it('o espelho gravado com atraso é sempre o último documento, e fechar o app grava o que estava pendente', async () => {
    const { pcFile, remote, service } = await remoteMode({ changeEveryMs: 0, mirrorDelayMs: 100 });
    expect(await service.refresh()).toBe(true);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const created = await remote.ledger.apply(LIDER, criar(`na vps ${i}`));
      if (!created.ok) throw new Error(created.reason);
      ids.push(created.task.id);
      await service.refresh();
    }
    await sleep(400);
    const mirror = JSON.parse(readFileSync(pcFile, 'utf8')) as { schemaVersion: number; tasks: Record<string, unknown> };
    expect(mirror.schemaVersion).toBe(1000);
    for (const id of ids) expect(mirror.tasks[id]).toBeDefined();

    // One more write, and the app closes before the delay: the flush writes it.
    const last = await remote.ledger.apply(LIDER, criar('antes de fechar'));
    if (!last.ok) throw new Error(last.reason);
    await service.refresh();
    service.flush();
    expect((JSON.parse(readFileSync(pcFile, 'utf8')) as { tasks: Record<string, unknown> }).tasks[last.task.id]).toBeDefined();
    service.retire();
    await sleep(200);
    expect((JSON.parse(readFileSync(pcFile, 'utf8')) as { tasks: Record<string, unknown> }).tasks[last.task.id]).toBeDefined();
  });
  it('depois que o app larga o serviço (a volta ao PC), um espelho pendente não grava por cima do ledger do PC', async () => {
    const { pcFile, remote, service } = await remoteMode({ changeEveryMs: 0, mirrorDelayMs: 100 });
    expect(await service.refresh()).toBe(true);
    await sleep(200);
    const created = await remote.ledger.apply(LIDER, criar('pendente'));
    if (!created.ok) throw new Error(created.reason);
    await service.refresh();
    // The way back wrote the PC's own ledger, then the app retired the remote service.
    io.writeFileText(pcFile, '{"schemaVersion":4,"startedAt":null,"tasks":{}}');
    service.retire();
    await sleep(300);
    expect(readFileSync(pcFile, 'utf8')).toBe('{"schemaVersion":4,"startedAt":null,"tasks":{}}');
  });
});
