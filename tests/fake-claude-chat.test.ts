// T040 — exercises the scripted fake `claude` (tests/smoke/fixtures/fake-claude-chat) as a real
// process against a local fake hook server. No node-pty: stdin/stdout are plain pipes.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionHooksSettings } from '../src/main/hooks-settings';

const SCRIPT = resolve(__dirname, 'smoke/fixtures/fake-claude-chat/fake-claude-chat.mjs');
const TOKEN = 'tok-0123456789abcdef';

interface Received {
  readonly event: string;
  readonly token: string | undefined;
  readonly body: Record<string, any>;
}

let server: Server;
let port: number;
let received: Received[];
let workDir: string;
let child: ChildProcessWithoutNullStreams | null;
let output: string;
let exitCode: number | null;

async function waitFor<T>(probe: () => T | undefined | false, label: string, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}\nscreen:\n${output.slice(-1500)}\nreceived: ${received.map((r) => r.event).join(',')}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function launch(args: string[], scenario?: unknown): void {
  const settingsPath = join(workDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(buildSessionHooksSettings({ port, token: TOKEN, chatEnabled: true, curlPath: 'curl' })));
  const env: NodeJS.ProcessEnv = { ...process.env, DONEL_FAKE_CLAUDE_HOME: join(workDir, 'home') };
  if (scenario !== undefined) env.DONEL_FAKE_CLAUDE_SCENARIO = JSON.stringify(scenario);
  child = spawn(process.execPath, [SCRIPT, '--settings', settingsPath, ...args], { cwd: workDir, env });
  child.stdout.on('data', (d: Buffer) => (output += d.toString('utf8')));
  child.on('exit', (code) => (exitCode = code));
}

const send = (text: string): void => void child!.stdin.write(text);
const hooks = (event: string): Received[] => received.filter((r) => r.event === event);

beforeEach(async () => {
  received = [];
  output = '';
  exitCode = null;
  child = null;
  workDir = mkdtempSync(join(tmpdir(), 'fake-claude-test-'));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, any> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // keep {}
      }
      received.push({ event: (req.url ?? '').replace('/h/', ''), token: req.headers['x-donel-token'] as string | undefined, body });
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  child?.kill();
  await new Promise<void>((ok) => server.close(() => ok()));
});

describe('fake-claude-chat', { timeout: 20000 }, () => {
  it('posts SessionStart through the settings command and creates the transcript', async () => {
    launch(['--session-id', 'aaaaaaaa-0000-4000-8000-000000000001']);
    const start = await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    expect(start.token).toBe(TOKEN);
    expect(start.body).toMatchObject({ session_id: 'aaaaaaaa-0000-4000-8000-000000000001', source: 'startup', hook_event_name: 'SessionStart' });
    expect(start.body.cwd).toBeTruthy();
    expect(existsSync(start.body.transcript_path)).toBe(true);
    await waitFor(() => output.includes('? for shortcuts'), 'idle footer');
    expect(output).toContain('\x1b[?2004h');
  });

  it('on Enter posts UserPromptSubmit with the token and appends the user line', async () => {
    launch(['--session-id', 'aaaaaaaa-0000-4000-8000-000000000002'], {
      default: { steps: [{ type: 'wait', ms: 400 }, { type: 'assistant', text: 'pronto' }, { type: 'hook', event: 'Stop' }] },
    });
    const start = await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    await waitFor(() => output.includes('? for shortcuts'), 'idle');
    send('oi mundo');
    await waitFor(() => output.includes('oi mundo'), 'echo of typing');
    send('\r');
    const submit = await waitFor(() => hooks('UserPromptSubmit')[0], 'UserPromptSubmit');
    expect(submit.token).toBe(TOKEN);
    expect(submit.body).toMatchObject({ prompt: 'oi mundo', session_id: start.body.session_id });
    await waitFor(() => output.includes('esc to interrupt'), 'working footer');
    await waitFor(() => hooks('Stop')[0], 'Stop');
    const lines = readFileSync(start.body.transcript_path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'user', sessionId: start.body.session_id, message: { role: 'user', content: 'oi mundo' } });
    expect(lines.some((l) => l.type === 'assistant' && l.message.content[0].text === 'pronto')).toBe(true);
  });

  it('plays tool steps in order: PreToolUse, PostToolUse, then Stop', async () => {
    launch([], {
      turns: [{ steps: [{ type: 'tool', name: 'Bash', input: { command: 'echo hi' }, result: 'hi', delayMs: 50 }, { type: 'hook', event: 'Stop' }] }],
    });
    await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    await waitFor(() => output.includes('? for shortcuts'), 'idle');
    send('roda\r');
    await waitFor(() => hooks('Stop')[0], 'Stop');
    const order = received.map((r) => r.event).filter((e) => e !== 'SessionStart');
    expect(order).toEqual(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
    const pre = hooks('PreToolUse')[0].body;
    expect(pre).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
    expect(hooks('PostToolUse')[0].body.tool_use_id).toBe(pre.tool_use_id);
  });

  it('collapses a big bracketed paste into a placeholder and submits the full text', async () => {
    launch([]);
    await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    await waitFor(() => output.includes('? for shortcuts'), 'idle');
    const big = Array.from({ length: 20 }, (_, i) => `linha ${i}`).join('\n');
    send(`\x1b[200~${big}\x1b[201~`);
    await waitFor(() => /\[Pasted text #1 \+\d+ lines\]/.test(output), 'placeholder');
    send('\r');
    const submit = await waitFor(() => hooks('UserPromptSubmit')[0], 'UserPromptSubmit');
    expect(submit.body.prompt).toBe(big);
  });

  it('/clear ends the session with reason clear and starts a new one', async () => {
    launch(['--session-id', 'aaaaaaaa-0000-4000-8000-000000000003']);
    const first = await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    await waitFor(() => output.includes('? for shortcuts'), 'idle');
    send('/clear\r');
    const end = await waitFor(() => hooks('SessionEnd')[0], 'SessionEnd');
    expect(end.body).toMatchObject({ reason: 'clear', session_id: first.body.session_id });
    const second = await waitFor(() => hooks('SessionStart')[1], 'second SessionStart');
    expect(second.body.source).toBe('clear');
    expect(second.body.session_id).not.toBe(first.body.session_id);
    expect(second.body.transcript_path).not.toBe(first.body.transcript_path);
    expect(existsSync(second.body.transcript_path)).toBe(true);
    expect(hooks('UserPromptSubmit')).toHaveLength(0);
  });

  it('/exit posts SessionEnd prompt_input_exit and exits', async () => {
    launch([]);
    await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    await waitFor(() => output.includes('? for shortcuts'), 'idle');
    send('/exit\r');
    const end = await waitFor(() => hooks('SessionEnd')[0], 'SessionEnd');
    expect(end.body.reason).toBe('prompt_input_exit');
    await waitFor(() => exitCode !== null, 'process exit');
    expect(exitCode).toBe(0);
  });

  it('-r <id> resumes with source resume and the given id', async () => {
    launch(['-r', 'bbbbbbbb-0000-4000-8000-000000000009']);
    const start = await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    expect(start.body).toMatchObject({ source: 'resume', session_id: 'bbbbbbbb-0000-4000-8000-000000000009' });
  });

  it('-r <id> sem transcript, com DONEL_FAKE_CLAUDE_RESUME_STRICT=1, falha como o CLI real (mensagem + exit 1)', async () => {
    process.env.DONEL_FAKE_CLAUDE_RESUME_STRICT = '1';
    try {
      launch(['-r', 'cccccccc-0000-4000-8000-000000000001']);
    } finally {
      delete process.env.DONEL_FAKE_CLAUDE_RESUME_STRICT;
    }
    await waitFor(() => exitCode !== null, 'process exit');
    expect(exitCode).toBe(1);
    expect(output).toContain('No conversation found with session ID: cccccccc-0000-4000-8000-000000000001');
    expect(hooks('SessionStart')).toHaveLength(0);
  });
});
