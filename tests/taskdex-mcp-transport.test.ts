import { describe, expect, it, vi } from 'vitest';
import { createJsonRpcCallTool, type HttpPostJson } from '../src/main/taskdex-mcp-transport';
import type { TaskdexServiceCredential } from '../src/main/taskdex-board-client';

// Transporte real do board (a peça que faltava desde T324/T330): JSON-RPC 2.0
// sobre HTTP POST no endpoint MCP do TaskDex, autenticado pelo header
// `X-MCP-Key` da credencial DE CADA USUÁRIO (`~/.claude/esteira-config/
// donel-board-credential.json`, nunca no repo).
//
// O `httpPost` é injetável — nenhum teste aqui toca a rede. O que se testa é
// exatamente o que quebrou o espelho antes: o SHAPE real do envelope
// (`result.content[0].text` com JSON stringificado) e a tradução dos nomes de
// parâmetro do app (`cardId`) para os da API (`taskId`).

const CREDENTIAL: TaskdexServiceCredential = {
  token: 'sk_fake_token',
  baseUrl: 'https://taskdex.example/api/mcp',
};

function envelope(payload: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
  });
}

function okPost(body: string): HttpPostJson {
  return async () => ({ status: 200, text: body });
}

describe('createJsonRpcCallTool', () => {
  it('monta o envelope JSON-RPC de tools/call e devolve o payload já desembrulhado', async () => {
    const post = vi.fn<HttpPostJson>(async () => ({ status: 200, text: envelope({ tasks: [{ id: 'c-1' }] }) }));
    const callTool = createJsonRpcCallTool(CREDENTIAL, post);

    const result = await callTool('list_tasks_by_team', { teamId: 'team-1', workspaceId: 'ws-1' });

    expect(result).toEqual({ tasks: [{ id: 'c-1' }] });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, headers, body] = post.mock.calls[0];
    expect(url).toBe(CREDENTIAL.baseUrl);
    expect(headers['X-MCP-Key']).toBe(CREDENTIAL.token);
    expect(headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(body);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('tools/call');
    expect(parsed.params.name).toBe('list_tasks_by_team');
    expect(parsed.params.arguments).toEqual({ teamId: 'team-1', workspaceId: 'ws-1' });
  });

  it('traduz `cardId` (nome do app) para `taskId` (nome da API) em get_task_details', async () => {
    const post = vi.fn<HttpPostJson>(async () => ({ status: 200, text: envelope({ id: 'c-1' }) }));
    const callTool = createJsonRpcCallTool(CREDENTIAL, post);

    await callTool('get_task_details', { cardId: 'c-1', workspaceId: 'ws-1' });

    const parsed = JSON.parse(post.mock.calls[0][2]);
    expect(parsed.params.arguments).toEqual({ taskId: 'c-1', workspaceId: 'ws-1' });
  });

  it('omite parâmetro vazio em vez de mandar string vazia para a API', async () => {
    const post = vi.fn<HttpPostJson>(async () => ({ status: 200, text: envelope({}) }));
    const callTool = createJsonRpcCallTool(CREDENTIAL, post);

    await callTool('get_task_details', { cardId: 'c-1', workspaceId: '' });

    expect(JSON.parse(post.mock.calls[0][2]).params.arguments).toEqual({ taskId: 'c-1' });
  });

  it('aceita resposta em SSE (text/event-stream) — o mesmo payload vem em linha `data:`', async () => {
    const sse = `event: message\ndata: ${envelope({ tasks: [] })}\n\n`;
    const callTool = createJsonRpcCallTool(CREDENTIAL, okPost(sse));

    await expect(callTool('list_tasks_by_team', { teamId: 't', workspaceId: 'w' })).resolves.toEqual({ tasks: [] });
  });

  it('resultado sem `content` textual volta como veio (não inventa formato)', async () => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tasks: [{ id: 'c-9' }] } });
    const callTool = createJsonRpcCallTool(CREDENTIAL, okPost(raw));

    await expect(callTool('list_tasks_by_team', { teamId: 't', workspaceId: 'w' })).resolves.toEqual({
      tasks: [{ id: 'c-9' }],
    });
  });

  it('HTTP != 200 lança erro SEM token, URL nem corpo na mensagem (o token nunca pode vazar em log)', async () => {
    const callTool = createJsonRpcCallTool(CREDENTIAL, async () => ({ status: 401, text: 'token sk_fake_token invalido' }));

    await expect(callTool('list_tasks_by_team', { teamId: 't', workspaceId: 'w' })).rejects.toThrow(/401/);
    await expect(callTool('list_tasks_by_team', { teamId: 't', workspaceId: 'w' })).rejects.not.toThrow(
      /sk_fake_token|taskdex\.example/,
    );
  });

  it('erro JSON-RPC vira exceção sem ecoar o corpo da resposta', async () => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'token sk_fake_token invalido' } });
    const callTool = createJsonRpcCallTool(CREDENTIAL, okPost(raw));

    await expect(callTool('get_task_details', { cardId: 'c-1' })).rejects.not.toThrow(/sk_fake_token/);
  });

  it('corpo que não é JSON lança — quem chama já degrada (nunca derruba a árvore)', async () => {
    const callTool = createJsonRpcCallTool(CREDENTIAL, okPost('<html>gateway</html>'));

    await expect(callTool('get_task_details', { cardId: 'c-1' })).rejects.toThrow();
  });

  it('cada chamada usa um id novo — resposta de uma não é confundida com a de outra', async () => {
    const post = vi.fn<HttpPostJson>(async () => ({ status: 200, text: envelope({}) }));
    const callTool = createJsonRpcCallTool(CREDENTIAL, post);

    await callTool('get_task_details', { cardId: 'c-1' });
    await callTool('get_task_details', { cardId: 'c-2' });

    const first = JSON.parse(post.mock.calls[0][2]).id;
    const second = JSON.parse(post.mock.calls[1][2]).id;
    expect(second).not.toBe(first);
  });
});
