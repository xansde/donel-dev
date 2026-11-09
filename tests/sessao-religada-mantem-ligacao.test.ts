import { afterEach, expect, it } from 'vitest';
import { browserMcpUrl, createBrowserMcpServer, type BrowserMcpServer } from '../src/main/browser/browser-mcp-server';
import { createHookBridge, type HookBridge } from '../src/main/hook-bridge';

// 08/11 (Líder único) — uma sessão viva da VPS perdeu a ligação com o app: "Host not allowed" no MCP e 401 nos hooks,
// e depois apareceu fechada. Ao religar, o app põe a MESMA chave que o CLI de lá já tem num PTY novo; quando o PTY
// antigo da mesma sessão saía (a aba que o renderer perdeu, o ssh que caiu), a baixa dele apagava a chave inteira —
// que já era do PTY novo. As duas pontes passavam a recusar uma sessão viva.

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const TOKEN = '0123456789abcdef0123456789abcdef';
const TUNNEL = 35869;

it('a baixa do PTY antigo de uma sessão religada não tira a ligação do novo, no MCP e nos hooks', async () => {
  const mcp: BrowserMcpServer = createBrowserMcpServer({ execute: async (ptyId) => ({ kind: 'text', text: ptyId }), serverVersion: 't' });
  const port = await mcp.start();
  closers.push(() => mcp.stop());
  const hooks: HookBridge = createHookBridge();
  const { port: hookPort } = await hooks.start();
  closers.push(() => hooks.close());

  // The tab as it was, then the reattach of the same live session on a new PTY (same keys the CLI there holds).
  mcp.registerSession('pty-velho', TOKEN, TUNNEL);
  hooks.registerSession('pty-velho', TOKEN);
  mcp.registerSession('pty-novo', TOKEN, TUNNEL);
  hooks.registerSession('pty-novo', TOKEN);
  // The old PTY leaves.
  mcp.unregisterSession('pty-velho');
  hooks.unregisterSession('pty-velho');

  // The CLI there calls through its tunnel: the Host is the tunnel port on the remote place.
  const call = await fetch(browserMcpUrl(port), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Host: `127.0.0.1:${TUNNEL}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'navegador_abas', arguments: {} } }),
  });
  expect(call.status).toBe(200);
  expect(await call.json()).toMatchObject({ result: { content: [{ type: 'text', text: 'pty-novo' }] } });

  const hook = await fetch(`http://127.0.0.1:${hookPort}/h/PreToolUse`, {
    method: 'POST',
    headers: { 'X-Donel-Token': TOKEN },
    body: JSON.stringify({ tool_name: 'Read', tool_input: {} }),
  });
  expect(hook.status).toBe(200);

  // And when the new one leaves too, the key is gone for real.
  mcp.unregisterSession('pty-novo');
  hooks.unregisterSession('pty-novo');
  const after = await fetch(`http://127.0.0.1:${hookPort}/h/PreToolUse`, { method: 'POST', headers: { 'X-Donel-Token': TOKEN }, body: '{}' });
  expect(after.status).toBe(401);
});
