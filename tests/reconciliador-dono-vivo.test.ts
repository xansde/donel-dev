// t-d461e003 (19/11) — the reconciliador handed the Líder único, three times, the task of a session alive in this VPS's
// tmux (session:5c1a55e7, opened from the VPS): the PC's picture lists it "fechada". A task whose owner session lives in
// this machine's tmux (or in a fresh picture of another machine) is never orphan; a tmux that failed decides nothing.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import type { OracleRequest } from '../src/oraculo/api';
import { createGateToolRoutes, GATE_TOOL_PATH } from '../src/oraculo/portoes';
import type { PictureSession } from '../src/oraculo/portao';

const PROJECT = '/home/u/seazone/Donel Dev';
const SID = '5c1a55e7-5603-404b-8a61-5a58297fa18e';
const OWNER = `session:${SID}`;
const OTHER = 'place:reconciliador-sessao';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const picture = (lugar: string, ownerState: string): PictureSession => ({
  quemSou: { nome: 'Dev', pasta: PROJECT, lugar, papel: 'dev' },
  listar: [
    { id: OWNER, papel: 'dev', estado: ownerState },
    { id: OTHER, papel: 'dev', estado: 'trabalhando' },
  ],
});

/** The registro's gate route with this machine's tmux as `tmux()` gives it (`null` = `tmux ls` failed). */
function routes(tmux: () => ReadonlySet<string> | null) {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-dono-vivo-'));
  dirs.push(dir);
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  const route = createGateToolRoutes({ ledger: () => ledger, liveOwner: { tmux } });
  const call = async (sessao: PictureSession, name: string, args: unknown): Promise<{ ok: boolean; text: string }> => {
    const request: OracleRequest = { method: 'POST', url: GATE_TOOL_PATH, body: JSON.stringify({ sessao, call: { name, arguments: args } }) };
    const answer = await route('vps', request, GATE_TOOL_PATH);
    return JSON.parse(answer!.body as string) as { ok: boolean; text: string };
  };
  return { call };
}

async function orphansSeenByAnother(tmux: () => ReadonlySet<string> | null, ownerState: string): Promise<string[]> {
  const r = routes(tmux);
  const created = await r.call(picture(OWNER, 'trabalhando'), 'tarefa_criar', { titulo: 'Contas', pedido: 'cadastrar', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
  expect(created.ok).toBe(true);
  const listed = await r.call(picture(OTHER, ownerState), 'tarefa_listar', { situacao: 'orfas', todos: true });
  expect(listed.ok).toBe(true);
  return (JSON.parse(listed.text) as { tarefas: { id: string }[] }).tarefas.map((task) => task.id);
}

describe('reconciliador: dono vivo no tmux da VPS não é órfão', () => {
  it('session:<sid> vivo no tmux desta máquina não é órfã, mesmo com o PC dizendo "fechada"', async () => {
    expect(await orphansSeenByAnother(() => new Set([SID]), 'fechada')).toEqual([]);
  });

  it('session:<sid> vivo no tmux e fora da lista do quadro também não é órfã', async () => {
    const r = routes(() => new Set([SID]));
    await r.call(picture(OWNER, 'trabalhando'), 'tarefa_criar', { titulo: 'Contas', pedido: 'cadastrar', criterio: 'feito', prazo: '2026-11-20', risco: 'baixo' });
    const off: PictureSession = { quemSou: { nome: 'Dev', pasta: PROJECT, lugar: OTHER, papel: 'dev' }, listar: [{ id: OTHER, papel: 'dev', estado: 'trabalhando' }] };
    const listed = await r.call(off, 'tarefa_listar', { situacao: 'orfas' });
    expect((JSON.parse(listed.text) as { tarefas: unknown[] }).tarefas).toEqual([]);
  });

  it('sid morto no tmux e fechado no quadro segue órfã, como antes', async () => {
    expect(await orphansSeenByAnother(() => new Set(['outra-sessao']), 'fechada')).toHaveLength(1);
  });

  it('tmux que falhou não decide: nada é órfão por ele', async () => {
    expect(await orphansSeenByAnother(() => null, 'fechada')).toEqual([]);
  });
});
