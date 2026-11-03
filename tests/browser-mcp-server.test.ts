// Navegador integrado — the local MCP server `donel` over real loopback HTTP: who may call (token per PTY,
// no Origin, loopback Host) and the JSON-RPC contract any agent CLI relies on (docs/design/navegador-interno.md, D9/D10).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserMcpUrl, createBrowserMcpServer, type BrowserMcpServer } from '../src/main/browser/browser-mcp-server';
import { checkMcpHttpRequest, type BrowserToolCall, type BrowserToolOutcome } from '../src/shared/browser/mcp';

let server: BrowserMcpServer;
let url: string;
const execute = vi.fn<(ptyId: string, call: BrowserToolCall) => Promise<BrowserToolOutcome>>();

function post(body: unknown, token: string | null, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  execute.mockReset();
  execute.mockImplementation(async (ptyId, call) => ({ kind: 'text', text: `${ptyId}:${call.tool}` }));
  server = createBrowserMcpServer({ execute, serverVersion: '9.9.9' });
  url = browserMcpUrl(await server.start());
});

afterEach(async () => {
  await server.stop();
});

describe('browser MCP server', () => {
  it('initialize names the server "donel"; a tool call runs on the PTY that owns the token', async () => {
    server.registerSession('pty-a');
    const tokenB = server.registerSession('pty-b');
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, tokenB);
    expect(await init.json()).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'donel' } } });

    const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'navegador_clicar', arguments: { n: 3 } } }, tokenB);
    expect(await call.json()).toMatchObject({ id: 2, result: { content: [{ type: 'text', text: 'pty-b:navegador_clicar' }] } });
    expect(execute).toHaveBeenCalledWith('pty-b', { tool: 'navegador_clicar', n: 3 });
  });

  it('bad arguments come back as a tool error and never reach the browser', async () => {
    const token = server.registerSession('pty-a');
    const res = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'navegador_clicar', arguments: { n: 'dois' } } }, token);
    expect(await res.json()).toMatchObject({ result: { isError: true } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses no token, a revoked token, and any Origin (a web page never reaches the server)', async () => {
    const old = server.registerSession('pty-a');
    const fresh = server.registerSession('pty-a');
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, null)).status).toBe(401);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, old)).status).toBe(401);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, fresh, { Origin: 'http://127.0.0.1:5173' })).status).toBe(403);
    server.unregisterSession('pty-a');
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, fresh)).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a Host that is not our loopback port (DNS rebinding)', () => {
    const token = 'a'.repeat(32);
    const gate = (host: string) =>
      checkMcpHttpRequest({ method: 'POST', url: '/mcp', headers: { host, authorization: `Bearer ${token}` } }, 5000, (t) => (t === token ? 'pty' : null));
    expect(gate('127.0.0.1:5000')).toEqual({ ok: true, ptyId: 'pty' });
    expect(gate('evil.example:5000')).toMatchObject({ ok: false, status: 403 });
    expect(gate('127.0.0.1:1')).toMatchObject({ ok: false, status: 403 });
  });
});
