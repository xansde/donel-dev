import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHookBridge } from '../src/main/hook-bridge';
import { buildSessionHooksSettings, buildSlackOfflineGuardScript, SLACK_OFFLINE_GUARD_MATCHER } from '../src/main/hooks-settings';

// Slack só com carta, fatia 4 — falha fechada: a remote session outlives the app; with the app down (or not
// knowing the session), a post to Slack is REFUSED by the command hook, never let through. The real script, run
// by `sh`, as the CLI runs it on the remote place.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Async on purpose: a sync spawn would freeze this process, and the bridge of the "app up" case lives in it. */
async function runGuard(port: number, token: string, payload: unknown): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'slack-offline-'));
  dirs.push(dir);
  const script = join(dir, 'slack-guard.sh');
  writeFileSync(script, buildSlackOfflineGuardScript({ port, token }));
  const child = spawn('sh', [script], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stdin.end(JSON.stringify(payload));
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  expect(code).toBe(0);
  return out.trim();
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const pre = (tool_name: string, tool_input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input });
const slackMcp = pre('mcp__claude_ai_Slack__slack_send_message', { channel_id: 'C0123ABC', message: 'oi' });
const composio = pre('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: { channel: '#produto', text: 'oi' } }] });
const curl = pre('Bash', { command: 'curl -s -X POST https://slack.com/api/chat.postMessage -d \'{"channel":"C0123ABC","text":"oi"}\'' });
const script = pre('Bash', { command: 'node scripts/canal-produto.js postar C0123ABC "oi"' });

describe.skipIf(process.platform === 'win32')('Slack só com carta — app fora do ar', () => {
  it('app down: every way of posting to Slack is refused, saying why; the rest goes on', async () => {
    const port = await closedPort();
    for (const payload of [slackMcp, composio, curl, script]) {
      const out = JSON.parse((await runGuard(port, 'a'.repeat(32), payload))) as { hookSpecificOutput: Record<string, string> };
      expect(out.hookSpecificOutput.permissionDecision, payload.tool_name).toBe('deny');
      expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/fora do ar.*carta/);
    }
    expect(await runGuard(port, 'a'.repeat(32), pre('Bash', { command: 'git status' }))).toBe('');
    expect(await runGuard(port, 'a'.repeat(32), pre('mcp__donel__tarefa_listar', {}))).toBe('');
  });

  it('app up and knowing the session: the hook says nothing (the bridge checks the letter); unknown session: refused', async () => {
    const bridge = createHookBridge();
    const { port } = await bridge.start();
    const token = bridge.registerSession('pty-vps');
    try {
      expect(await runGuard(port, token, slackMcp)).toBe('');
      expect(await runGuard(port, 'b'.repeat(32), slackMcp)).toContain('"permissionDecision":"deny"');
    } finally {
      await bridge.close();
    }
  });

  it('the remote settings carry the guard on PreToolUse, next to the http hook', () => {
    const settings = buildSessionHooksSettings({ port: 30000, token: 't', curlPath: 'curl', slackOfflineGuardCommand: 'sh "$HOME/.donel/s/x/slack-guard.sh"' });
    expect(settings.hooks.PreToolUse).toEqual([
      { hooks: [expect.objectContaining({ type: 'http' })] },
      { matcher: SLACK_OFFLINE_GUARD_MATCHER, hooks: [{ type: 'command', command: 'sh "$HOME/.donel/s/x/slack-guard.sh"', timeout: 10 }] },
    ]);
  });
});
