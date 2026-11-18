// Canal do Donel fora do PC (t-e195b35c, PR 1) — the gate answers the `tarefa_*` tools on the VPS with the PC on or
// off, never waits minutes on a hung tunnel, and a session repeating a write gets the first one back. What breaks
// without the owner noticing: a VPS session stuck while the PC's app is frozen (18/11, 08h13–08h45), a task or a
// progress line written twice, and a "precisa do dono" that reaches the owner with no reason he must act on.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { progressOf } from '../src/shared/ledger/andamento';
import { createGateHandler, createTunnelForward, type GateForward } from '../src/oraculo/portao';
import { createThrottle } from '../src/oraculo/server';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const SID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'd'.repeat(43);
const PROJECT = '/home/dono/seazone/atlas';
const ME = 'place:dev-vps';

/** A tunnel whose app froze: the connection is taken and nothing ever comes back. */
const HUNG: GateForward = () => new Promise(() => undefined);

function setup(forward: GateForward) {
  const dir = mkdtempSync(join(tmpdir(), 'portao-vps-'));
  dirs.push(dir);
  const sessions = join(dir, 's');
  mkdirSync(join(sessions, SID), { recursive: true });
  writeFileSync(join(sessions, SID, 'meta.json'), JSON.stringify({ sid: SID, mcpToken: TOKEN, mcpPort: 25710 }));
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs });
  const picture = {
    at: Date.UTC(2026, 10, 18, 11),
    sessoes: {
      [SID]: {
        quemSou: { nome: 'Dev · atlas', projeto: 'atlas', pasta: PROJECT, lugar: ME, papel: 'dev', roda: 'VPS' },
        listar: [
          { id: ME, papel: 'dev', estado: 'trabalhando', podeMandar: false },
          { id: 'place:lider', papel: 'lider', estado: 'parada', podeMandar: true },
        ],
      },
    },
  };
  let forwarded = 0;
  const handle = createGateHandler({
    sessionsDir: sessions,
    ledger: () => ledger,
    picture: () => picture,
    forward: (port, request) => {
      forwarded++;
      return forward(port, request);
    },
    serverVersion: 'teste',
    timeouts: { localAnswerMs: 30 },
  });
  const rpc = async (method: string, params: unknown) => {
    const res = await handle({ method: 'POST', path: `/s/${SID}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { status: res.status, json: res.body ? (JSON.parse(res.body) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } }) : null };
  };
  const tool = async (name: string, args: unknown) => {
    const result = (await rpc('tools/call', { name, arguments: args })).json!.result!;
    return { error: result.isError === true, text: result.content![0]!.text };
  };
  return { ledger, rpc, tool, forwarded: () => forwarded };
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function newTask(g: ReturnType<typeof setup>): Promise<string> {
  const created = await g.tool('tarefa_criar', { titulo: 'Canal fora do PC', pedido: 'faz na VPS', criterio: 'x', prazo: '2026-11-19', risco: 'baixo' });
  expect(created.error).toBe(false);
  return (JSON.parse(created.text) as { id: string }).id;
}

describe('Portão: tarefas sempre na VPS', () => {
  it('com o app do PC travado (túnel pendurado), tarefa_listar e tarefa_andamento respondem pelo portão, sem passar no PC', async () => {
    const g = setup(HUNG);
    const id = await newTask(g);
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    const progress = await g.tool('tarefa_andamento', { id, estado: 'trabalhando', proximo: 'seguir' });
    expect(progress.error).toBe(false);
    expect(JSON.parse(progress.text)).toMatchObject({ registrado: true, tarefa: { id, estado: 'em-execucao', dono: ME, ultimoEvento: { tipo: 'comentada' } } });
    expect(JSON.parse((await g.tool('tarefa_listar', {})).text).tarefas.map((t: { id: string }) => t.id)).toEqual([id]);
    expect(g.forwarded()).toBe(0);
  });

  it('tools/list e quem sou respondem local depois do prazo curto, com o túnel pendurado; a lista traz os campos novos', async () => {
    const g = setup(HUNG);
    const listed = await g.rpc('tools/list', {});
    const tools = listed.json!.result!.tools!;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['sessao_quem_sou', 'sessao_enviar', 'tarefa_andamento', 'navegador_abrir']));
    expect(Object.keys(tools.find((t) => t.name === 'tarefa_andamento')!.inputSchema.properties)).toEqual(expect.arrayContaining(['motivo', 'chave']));
    expect(JSON.parse((await g.tool('sessao_quem_sou', {})).text)).toMatchObject({ lugar: ME, pc: expect.stringMatching(/não respondeu/) });
    expect(g.forwarded()).toBe(2);
  });

  it('a lista que o PC (app atual) devolve ganha as tarefa_* deste portão, com chave e motivo', async () => {
    const g = setup(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"tarefa_andamento","inputSchema":{"properties":{}}},{"name":"navegador_abrir","inputSchema":{"properties":{}}}]}}' }));
    const tools = (await g.rpc('tools/list', {})).json!.result!.tools!;
    expect(tools.map((t) => t.name)).toEqual(['tarefa_andamento', 'navegador_abrir']);
    expect(Object.keys(tools[0]!.inputSchema.properties)).toEqual(expect.arrayContaining(['motivo', 'chave']));
  });

  it('conexão ao túnel que não completa no prazo é o PC fora (nada foi enviado)', async () => {
    const forward = createTunnelForward({ connectMs: 30, connect: () => new Socket() });
    expect(await forward(25710, { method: 'POST', path: '/s/x/mcp', headers: {}, body: '{}' })).toBe('desligado');
  });
});

describe('precisa-do-dono com motivo', () => {
  it('sem motivo (ou fora da lista) é recusado com a lista; com motivo grava o motivo à frente do que precisa', async () => {
    const g = setup(HUNG);
    const id = await newTask(g);
    const without = await g.tool('tarefa_andamento', { id, estado: 'precisa-do-dono', precisa: 'decidir a cor' });
    expect(without.error).toBe(true);
    expect(without.text).toMatch(/credencial-nova.*pagamento.*dado-do-dono.*main-ou-producao-sem-pedido.*repo-publico/);
    expect((await g.tool('tarefa_andamento', { id, estado: 'precisa-do-dono', motivo: 'gosto', precisa: 'x' })).error).toBe(true);
    const ok = await g.tool('tarefa_andamento', { id, estado: 'precisa-do-dono', motivo: 'credencial-nova', precisa: 'a chave da API nova' });
    expect(ok.error).toBe(false);
    const records = g.ledger.load().doc.tasks[id]!.events.map(progressOf).filter(Boolean);
    expect(records).toEqual([{ estado: 'precisa-do-dono', precisa: '[credencial-nova] a chave da API nova' }]);
  });
});

describe('chave contra duplicata', () => {
  it('a mesma chave duas vezes grava uma vez só e devolve repetida com o estado atual', async () => {
    const g = setup(HUNG);
    const first = await g.tool('tarefa_criar', { pedido: 'uma vez', criterio: 'x', prazo: '2026-11-19', risco: 'baixo', chave: 'criar-1' });
    const again = await g.tool('tarefa_criar', { pedido: 'uma vez (de novo)', criterio: 'x', prazo: '2026-11-19', risco: 'baixo', chave: 'criar-1' });
    const id = (JSON.parse(first.text) as { id: string }).id;
    expect(JSON.parse(again.text)).toMatchObject({ id, repetida: true, tarefa: { id, estado: 'aberta' } });
    expect(Object.keys(g.ledger.load().doc.tasks)).toHaveLength(1);

    for (const [name, args] of [
      ['tarefa_assumir', { id }],
      ['tarefa_andamento', { id, estado: 'trabalhando', proximo: 'testar' }],
    ] as const) {
      const a = await g.tool(name, { ...args, chave: `k-${name}` });
      const b = await g.tool(name, { ...args, chave: `k-${name}` });
      expect(a.error, `${name}: ${a.text}`).toBe(false);
      expect(JSON.parse(b.text), name).toMatchObject({ repetida: true, tarefa: { id } });
    }
    const delivery = { id, provas: [{ tipo: 'texto', texto: 'npm run verify: verde' }], chave: 'entrega-1' };
    expect((await g.tool('tarefa_entregar', delivery)).error).toBe(false);
    expect(JSON.parse((await g.tool('tarefa_entregar', delivery)).text)).toMatchObject({ repetida: true, tarefa: { id, estado: 'entregue' } });

    const kinds = g.ledger.load().doc.tasks[id]!.events.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === 'assumida')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'entregue')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'comentada')).toHaveLength(1);
  });

  it('sem chave, assumir de novo a tarefa já assumida devolve repetida em vez de erro', async () => {
    const g = setup(HUNG);
    const id = await newTask(g);
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    const again = await g.tool('tarefa_assumir', { id });
    expect(again.error).toBe(false);
    expect(JSON.parse(again.text)).toMatchObject({ repetida: true });
    expect(g.ledger.load().doc.tasks[id]!.events.filter((event) => event.kind === 'assumida')).toHaveLength(1);
  });
});

describe('SSE do Oráculo agrupado', () => {
  it('o primeiro aviso sai na hora; os seguintes dentro da janela viram um só no fim dela', () => {
    vi.useFakeTimers();
    let sent = 0;
    const throttle = createThrottle(() => sent++, 2_000);
    throttle.fire();
    expect(sent).toBe(1);
    for (let i = 0; i < 50; i++) throttle.fire();
    expect(sent).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(sent).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(sent).toBe(2);
    throttle.fire();
    expect(sent).toBe(3);
    throttle.dispose();
  });
});
