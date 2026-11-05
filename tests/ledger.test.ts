import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs, runLedgerTool, type LedgerCaller, type LedgerProofFs } from '../src/main/ledger-store';
import type { MindscapeBoard } from '../src/shared/mindscape/model';
import { LEDGER_SCHEMA_VERSION } from '../src/shared/ledger/contract';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Ledger com prova (item 19) — persisted data a channel could erase, and the two rules that live in code:
// no delivery without proof, and whoever delivered never accepts. Through the MCP port, round trip on disk.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(proofFs: LedgerProofFs = nodeLedgerProofFs): { file: string; dir: string; service: () => ReturnType<typeof createLedgerService> } {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  let clock = Date.UTC(2026, 10, 5, 12);
  // One service, as in the main: what a session saw with tarefa_ver lives in it.
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs, now: () => (clock += 60_000) });
  return { file, dir, service: () => service };
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const board = ['place:lider', 'place:dev', 'place:revisor', 'place:rev-do-dev'];
// The Líder opened the Dev and the Revisor; the Dev opened its own Revisor.
const opened = (from: string, to: string) => ({ id: `${from}>${to}`, from, to, arrow: true, by: 'session' as const, opened: true as const });
const mindscape: MindscapeBoard = {
  projectPath: 'C:/p',
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: {},
  links: [opened('place:lider', 'place:dev'), opened('place:lider', 'place:revisor'), opened('place:dev', 'place:rev-do-dev')],
  drawings: [],
};
const at = (placeId: string, roleId: string): LedgerCaller => ({ projectPath: 'C:/p', placeId, roleId, boardPlaceIds: board, board: mindscape });
const lider = at('place:lider', 'lider');
const dev = at('place:dev', 'dev');
const revisor = at('place:revisor', 'revisor');
const revisorDoDev = at('place:rev-do-dev', 'revisor');
const revisorDeOutroQuadro: LedgerCaller = { projectPath: 'C:/outro', placeId: 'place:rev-x', roleId: 'revisor', boardPlaceIds: ['place:rev-x'], board: { ...mindscape, projectPath: 'C:/outro', links: [] } };

describe('ledger com prova', () => {
  it('creates, refuses a delivery without proof, copies the proof in, refuses the self-accept and takes the Revisor accept', async () => {
    const { file, dir, service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'Põe o botão verde', criterio: 'print do botão', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }));
    expect(created.ok).toBe(true);
    const id = (JSON.parse(created.text) as { id: string }).id;
    expect((await runLedgerTool(service(), dev, call('tarefa_assumir', { id }))).ok).toBe(true);

    // No proof: refused by the tool and, below it, by the contract.
    expect(parseLedgerToolCall('tarefa_entregar', { id, provas: [] }).ok).toBe(false);
    expect(service().apply({ kind: 'lugar', placeId: 'place:dev' }, { op: 'entregar', id, proofs: [] })).toMatchObject({ ok: false });

    mkdirSync(join(dir, 'fora'));
    const print = join(dir, 'fora', 'print.png');
    writeFileSync(print, 'png-bytes');
    const delivered = await runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'arquivo', caminho: print }, { tipo: 'link', url: 'https://ci.example/run/1' }] }));
    expect(delivered.ok).toBe(true);

    expect(await runLedgerTool(service(), dev, call('tarefa_aceitar', { id }))).toMatchObject({ ok: false });
    // The Revisor reads the proof before deciding; one of another board, or in the Dev's chain, never decides.
    expect((await runLedgerTool(service(), revisor, call('tarefa_aceitar', { id }))).text).toContain('tarefa_ver');
    for (const [outsider, why] of [[revisorDeOutroQuadro, 'outro quadro'], [revisorDoDev, 'cadeia']] as const) {
      await runLedgerTool(service(), outsider, call('tarefa_ver', { id }));
      expect(await runLedgerTool(service(), outsider, call('tarefa_aceitar', { id }))).toMatchObject({ ok: false, text: expect.stringContaining(why) });
    }
    const seen = await runLedgerTool(service(), revisor, call('tarefa_ver', { id }));
    expect(seen.text).toContain('https://ci.example/run/1');
    expect(seen.image?.base64).toBe(Buffer.from('png-bytes').toString('base64'));
    expect(await runLedgerTool(service(), revisor, call('tarefa_aceitar', { id }))).toMatchObject({ ok: true });

    // Round trip on disk: a fresh service reads what the first one wrote.
    const task = service().load().doc.tasks[id]!;
    expect(task.state).toBe('aceita');
    expect(task.request).toBe('Põe o botão verde');
    expect(task.events.map((event) => event.kind)).toEqual(['criada', 'assumida', 'entregue', 'aceita']);
    expect(task.events[3]!.by).toEqual({ kind: 'lugar', placeId: 'place:revisor', roleId: 'revisor' });
    const proof = task.events[2]!.proofs![0]!;
    expect(proof.kind).toBe('arquivo');
    if (proof.kind !== 'arquivo') return;
    expect(proof.file).not.toContain('/');
    expect(readFileSync(join(ledgerProofsDir(file), proof.file), 'utf8')).toBe('png-bytes');
  });

  it('low risk waits for the owner when whoever creates is the owner of the work or was opened by it', async () => {
    const { service } = setup();
    for (const [who, owner] of [[dev, undefined], [revisorDoDev, 'place:dev']] as const) {
      const created = await runLedgerTool(service(), who, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'baixo', ...(owner ? { dono: owner } : {}) }));
      const id = (JSON.parse(created.text) as { id: string }).id;
      expect(service().load().doc.tasks[id]!.risk).toBe('alto');
    }
  });

  it('refuses a proof file that is a symbolic link', async () => {
    const { dir, service } = setup({ ...nodeLedgerProofFs, lstat: async () => ({ isSymbolicLink: () => true }) });
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const link = join(dir, 'segredo.png');
    writeFileSync(link, 'x');
    expect(await runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'arquivo', caminho: link }] }))).toMatchObject({ ok: false, text: expect.stringContaining('link simbólico') });
    expect(existsSync(ledgerProofsDir(join(dir, 'ledger.json')))).toBe(false);
  });

  it('reads a ledger written by a newer channel and never writes over it', async () => {
    const { file, service } = setup();
    const newer = JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION + 1, startedAt: null, tasks: {}, novo: true });
    writeFileSync(file, newer);
    expect(service().load().readOnly).toBe(true);
    expect(await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto' }))).toMatchObject({ ok: false });
    expect(readFileSync(file, 'utf8')).toBe(newer);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});
