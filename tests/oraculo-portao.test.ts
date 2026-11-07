// Oráculo na VPS (t-d7a974d0), fatia 4 — the MCP gate of the VPS's sessions. With the PC on it only passes the call
// on (the app answers as today); with the PC off it answers who the session is and the `tarefa_*` tools from the
// last picture of the board the PC left. What breaks without the owner noticing: another session's token getting
// through, or a task written under the wrong place.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createGateHandler, type GateForward } from '../src/oraculo/portao';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const SID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'd'.repeat(43);
const PROJECT = 'C:\\Users\\dono\\seazone\\atlas';
const ME = 'place:dev-vps';

function setup(forward: GateForward) {
  const dir = mkdtempSync(join(tmpdir(), 'portao-'));
  dirs.push(dir);
  const sessions = join(dir, 's');
  mkdirSync(join(sessions, SID), { recursive: true });
  writeFileSync(join(sessions, SID, 'meta.json'), JSON.stringify({ sid: SID, mcpToken: TOKEN, mcpPort: 25710 }));
  const ledgerFile = join(dir, 'ledger.json');
  const ledger = createLedgerService({ filePath: ledgerFile, io, proofFs: nodeLedgerProofFs });
  const picture = {
    at: Date.UTC(2026, 10, 7, 21),
    sessoes: {
      [SID]: {
        quemSou: { nome: 'Dev · atlas', projeto: 'atlas', pasta: PROJECT, lugar: ME, papel: 'dev', roda: 'VPS' },
        listar: [
          { id: ME, papel: 'dev', estado: 'trabalhando', podeMandar: false },
          { id: 'place:revisor', papel: 'revisor', estado: 'parada', podeMandar: true },
        ],
      },
    },
  };
  const handle = createGateHandler({ sessionsDir: sessions, ledger: () => ledger, picture: () => picture, forward, serverVersion: 'teste' });
  const rpc = async (method: string, params: unknown, token = TOKEN, sid = SID) => {
    const res = await handle({ method: 'POST', path: `/s/${sid}/mcp`, authorization: `Bearer ${token}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { status: res.status, json: res.body ? (JSON.parse(res.body) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } }) : null };
  };
  const tool = async (name: string, args: unknown) => {
    const answer = await rpc('tools/call', { name, arguments: args });
    const result = answer.json!.result!;
    return { error: result.isError === true, text: result.content![0]!.text };
  };
  return { dir, ledgerFile, ledger, rpc, tool, handle };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PC_OFF: GateForward = async () => 'desligado';

describe('Portão MCP das sessões da VPS', () => {
  it('com o PC ligado só repassa ao túnel da própria sessão, com o token dela', async () => {
    const seen: { port: number; authorization?: string; body: string }[] = [];
    const g = setup(async (port, request) => {
      seen.push({ port, authorization: request.authorization, body: request.body });
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"do":"PC"}}' };
    });
    const answer = await g.rpc('tools/call', { name: 'sessao_quem_sou', arguments: {} });
    expect(answer.json).toEqual({ jsonrpc: '2.0', id: 1, result: { do: 'PC' } });
    expect(seen).toEqual([{ port: 25710, authorization: `Bearer ${TOKEN}`, body: expect.stringContaining('sessao_quem_sou') }]);
  });

  it('recusa token de outra sessão, sessão desconhecida e id que não é de sessão', async () => {
    const g = setup(PC_OFF);
    expect((await g.rpc('tools/list', {}, 'e'.repeat(43))).status).toBe(401);
    expect((await g.rpc('tools/list', {}, TOKEN, '99999999-2222-4333-8444-555555555555')).status).toBe(401);
    expect((await g.rpc('tools/list', {}, TOKEN, '../../etc')).status).toBe(404);
  });

  it('com o PC desligado: quem sou, a lista e as ferramentas de sempre, pelo retrato', async () => {
    const g = setup(PC_OFF);
    const tools = (await g.rpc('tools/list', {})).json!.result!.tools!.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['sessao_quem_sou', 'sessao_listar', 'tarefa_criar', 'tarefa_entregar', 'tarefa_listar']));
    const who = await g.tool('sessao_quem_sou', {});
    expect(JSON.parse(who.text)).toMatchObject({ lugar: ME, papel: 'dev', pasta: PROJECT, pc: expect.stringMatching(/desligado/) });
    expect(JSON.parse((await g.tool('sessao_listar', {})).text)).toHaveLength(2);
    expect(await g.tool('quadro_ler', {})).toMatchObject({ error: true, text: expect.stringMatching(/PC está desligado/) });
  });

  it('com o PC desligado: cria e entrega com prova em arquivo da VPS, gravando no lugar da sessão', async () => {
    const g = setup(PC_OFF);
    const created = await g.tool('tarefa_criar', { titulo: 'Prova sem PC', pedido: 'faz sem o PC', criterio: 'x', prazo: '2026-11-10', risco: 'alto' });
    expect(created.error).toBe(false);
    const id = (JSON.parse(created.text) as { id: string }).id;
    expect(g.ledger.load().doc.tasks[id]).toMatchObject({ projectPath: PROJECT, ownerPlaceId: ME, state: 'aberta' });
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    const shot = join(g.dir, 'print.png');
    writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 5]));
    const delivered = await g.tool('tarefa_entregar', {
      id,
      provas: [{ tipo: 'arquivo', caminho: shot }],
      paraODono: {
        pergunta: 'Aceito?',
        resumo: 'Feito sem o PC.',
        opcoes: [
          { rotulo: 'Aceitar', efeito: 'Fecha.', fecha: 'aceita', recomendada: true },
          { rotulo: 'Refazer', efeito: 'Volta.', fecha: 'rejeitada' },
        ],
        porque: 'Funciona.',
        risco: 'Baixo.',
        visual: { prova: 1 },
      },
    });
    expect(delivered).toMatchObject({ error: false });
    const task = g.ledger.load().doc.tasks[id]!;
    expect(task.state).toBe('entregue');
    const proof = task.events.at(-1)!.proofs![0]! as { file: string };
    expect(readFileSync(join(ledgerProofsDir(g.ledgerFile), proof.file))).toEqual(readFileSync(shot));
    expect(JSON.parse((await g.tool('tarefa_listar', {})).text).tarefas.map((t: { id: string }) => t.id)).toContain(id);
  });

  it('sem retrato da sessão, não inventa quem ela é', async () => {
    const g = setup(PC_OFF);
    const handle = createGateHandler({ sessionsDir: join(g.dir, 's'), ledger: () => g.ledger, picture: () => null, forward: PC_OFF, serverVersion: 'teste' });
    const res = await handle({ method: 'POST', path: `/s/${SID}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tarefa_criar', arguments: { pedido: 'x', criterio: 'x', prazo: '2026-11-10', risco: 'baixo' } } }) });
    const result = (JSON.parse(res.body) as { result: { isError: boolean; content: { text: string }[] } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/retrato/);
    expect(Object.keys(g.ledger.load().doc.tasks)).toHaveLength(0);
  });
});
