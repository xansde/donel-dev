import { request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { browserMcpUrl, createBrowserMcpServer, type BrowserMcpServer } from '../src/main/browser/browser-mcp-server';
import { createHookBridge, type HookBridge } from '../src/main/hook-bridge';
import { SessionKeyRing } from '../src/main/session-keys';
import { parseBoardToolCall } from '../src/shared/mindscape/agent-tools';

// t-1293c818, item 4 — a live session that lost the app's keys ("Host not allowed" in the MCP, 401 in the hooks) only
// came back when the owner reopened its tab. `sessao_religar` puts back the keys the session's CLI already holds, on
// the same PTY, without touching the process there.

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const TOKEN = '0123456789abcdef0123456789abcdef';
const MCP_TOKEN = 'm'.repeat(32); // a fake per-session token of the app, not a secret
const TUNNEL = 35870;

it('religar devolve à sessão viva as chaves que o CLI dela já tem, no MCP e nos hooks; sessão encerrada não volta', async () => {
  const mcp: BrowserMcpServer = createBrowserMcpServer({ execute: async (ptyId) => ({ kind: 'text', text: ptyId }), serverVersion: 't' });
  const port = await mcp.start();
  closers.push(() => mcp.stop());
  const hooks: HookBridge = createHookBridge();
  const { port: hookPort } = await hooks.start();
  closers.push(() => hooks.close());

  const ring = new SessionKeyRing();
  hooks.registerSession('pty-1', TOKEN);
  mcp.registerSession('pty-1', MCP_TOKEN, TUNNEL);
  ring.remember('pty-1', { hookToken: TOKEN, mcp: { token: MCP_TOKEN, tunnelPort: TUNNEL } });

  // The CLI on the remote place calls through its tunnel: the Host carries the tunnel's port there (fetch would
  // overwrite it, so a plain request).
  const callMcp = () =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'navegador_abas', arguments: {} } });
      const req = request(browserMcpUrl(port), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MCP_TOKEN}`, Host: `127.0.0.1:${TUNNEL}` },
      }, (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on('error', reject);
      req.end(body);
    });
  const callHook = () => fetch(`http://127.0.0.1:${hookPort}/h/PreToolUse`, { method: 'POST', headers: { 'X-Donel-Token': TOKEN }, body: JSON.stringify({ tool_name: 'Read', tool_input: {} }) });

  // The keys go while the session lives (how they go does not matter here).
  mcp.unregisterSession('pty-1');
  hooks.unregisterSession('pty-1');
  expect((await callMcp()).status).toBe(403); // "Host not allowed"
  expect((await callHook()).status).toBe(401);

  expect(ring.restore('pty-1', { hooks, mcp })).toEqual({ hooks: true, mcp: true });
  const answer = await callMcp();
  expect(answer.status).toBe(200);
  expect(JSON.parse(answer.body)).toMatchObject({ result: { content: [{ type: 'text', text: 'pty-1' }] } });
  expect((await callHook()).status).toBe(200);

  // The session ended for real: nothing to put back.
  ring.forget('pty-1');
  expect(ring.restore('pty-1', { hooks, mcp })).toBeNull();
});

it('sessao_religar pede quem, como sessao_fechar', () => {
  expect(parseBoardToolCall('sessao_religar', { quem: 'place:dev', quadro: 'atlas' })).toEqual({ ok: true, call: { tool: 'sessao_religar', quem: 'place:dev', quadro: 'atlas' } });
  expect(parseBoardToolCall('sessao_religar', {}).ok).toBe(false);
});
