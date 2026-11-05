import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { LEDGER_SCHEMA_VERSION } from '../src/shared/ledger/contract';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Ledger com prova (item 19) — persisted data a channel could erase, and the two rules that live in code:
// no delivery without proof, and whoever delivered never accepts. Through the MCP port, round trip on disk.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(): { file: string; dir: string; service: () => ReturnType<typeof createLedgerService> } {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  let clock = Date.UTC(2026, 10, 5, 12);
  return { file, dir, service: () => createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) }) };
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const board = ['place:lider', 'place:dev', 'place:revisor'];
const lider: LedgerCaller = { projectPath: 'C:/p', placeId: 'place:lider', roleId: 'lider', boardPlaceIds: board };
const dev: LedgerCaller = { projectPath: 'C:/p', placeId: 'place:dev', roleId: 'dev', boardPlaceIds: board };
const revisor: LedgerCaller = { projectPath: 'C:/p', placeId: 'place:revisor', roleId: 'revisor', boardPlaceIds: board };

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
