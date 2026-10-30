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

// Every wait polls a condition, so the ceiling only matters when something is slow. Each hook goes
// through a spawned `curl` (the real settings command), and with the whole suite running in
// parallel a single SessionStart was seen taking more than 8 s to arrive. 15 s per wait, under a
// 45 s test budget, keeps a real miss failing with this message instead of a bare vitest timeout.
async function waitFor<T>(probe: () => T | undefined | false, label: string, timeoutMs = 15_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}\nscreen:\n${output.slice(-1500)}\nreceived: ${received.map((r) => r.event).join(',')}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function launch(args: string[], scenario?: unknown, extraEnv: Record<string, string> = {}): void {
  const settingsPath = join(workDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(buildSessionHooksSettings({ port, token: TOKEN, chatEnabled: true, curlPath: 'curl' })));
  // The fake gives up on an `http` hook after 5 s by default (fail-open, like the CLI) and the event
  // is lost. The server below answers at once, so only a starved test worker gets near that limit;
  // 15 s keeps a slow delivery from turning into a missing hook. A test can still override it.
  const env: NodeJS.ProcessEnv = { ...process.env, DONEL_FAKE_CLAUDE_HOME: join(workDir, 'home'), DONEL_FAKE_CLAUDE_HOOK_TIMEOUT_MS: '15000', ...extraEnv };
  if (scenario !== undefined) env.DONEL_FAKE_CLAUDE_SCENARIO = JSON.stringify(scenario);
  child = spawn(process.execPath, [SCRIPT, '--settings', settingsPath, ...args], { cwd: workDir, env });
  child.stdout.on('data', (d: Buffer) => (output += d.toString('utf8')));
  child.on('exit', (code) => (exitCode = code));
}

const send = (text: string): void => void child!.stdin.write(text);
/** The last painted screen (the fake repaints with a clear-screen). */
const screen = (): string => output.split('\x1b[2J').pop() ?? '';
const transcriptLines = (path: string): Record<string, any>[] =>
  readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
async function bootIdle(args: string[] = [], scenario?: unknown, extraEnv: Record<string, string> = {}): Promise<string> {
  launch(args, scenario, extraEnv);
  const start = await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
  await waitFor(() => output.includes('? for shortcuts'), 'idle');
  return start.body.transcript_path as string;
}
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

describe('fake-claude-chat', { timeout: 45_000 }, () => {
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

  it('draws the box like the real CLI: LF starts a row, long lines wrap at a space (dropped), continuation rows are indented by 2', async () => {
    launch([]); // piped stdout: no columns, so the fake assumes 100 and the text area is 98 wide
    await waitFor(() => hooks('SessionStart')[0], 'SessionStart');
    await waitFor(() => output.includes('? for shortcuts'), 'idle');
    const long = Array.from({ length: 30 }, (_, i) => `w${String(i).padStart(2, '0')}`).join(' '); // 119 chars
    send('linha um\n');
    send(long);
    await waitFor(() => screen().includes('w29'), 'long text drawn');
    const rows = screen().split('\r\n');
    const top = rows.findIndex((r) => /^─+$/.test(r));
    const bottom = rows.findIndex((r, i) => i > top && /^─+$/.test(r));
    const box = rows.slice(top + 1, bottom);
    expect(box[0]).toBe('❯ linha um');
    expect(box.length).toBe(3);
    expect(box[1]!.startsWith('  w00 ')).toBe(true);
    expect(box[2]!.startsWith('  w')).toBe(true);
    // the space at the wrap point is gone: the rows glued back together lose exactly one space
    expect(box[1]!.slice(2).length).toBeLessThanOrEqual(98);
    expect(box[1]!.slice(2) + box[2]!.slice(2)).toBe(long.replace(/ /g, (m, at: number) => (at === box[1]!.slice(2).length ? '' : m)));
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
  it('shows a 5+ line paste as a placeholder, keeps shorter pastes literal, and shows image paths as [Image #N]', async () => {
    await bootIdle();
    send('\x1b[200~um\ndois\ntres\x1b[201~');
    await waitFor(() => screen().includes('❯ um\r\n  dois\r\n  tres'), 'short paste literal, one row per LF');
    send('\x7f'.repeat(12));
    await waitFor(() => !screen().includes('dois'), 'cleared');
    send(`\x1b[200~${['a', 'b', 'c', 'd', 'e'].join('\n')}\x1b[201~`);
    await waitFor(() => screen().includes('[Pasted text #1 +4 lines]'), 'placeholder at 5 lines');
    send('\x1b[200~C:\\tmp\\foto.png\x1b[201~');
    await waitFor(() => screen().includes('[Image #1]'), 'image placeholder');
    // ConPTY drops the paste markers: the same path arriving as plain typed text is an image too.
    send('D:\\tmp\\outra.png');
    await waitFor(() => screen().includes('[Image #1][Image #2]'), 'image placeholder without paste markers');
  });

  it('queues a message submitted during a round: enqueue, then remove + queued_command, then processes it', async () => {
    // The second message must land, and its `enqueue` be observed, while the first round is still
    // running. At 700 ms a loaded machine lost that race (the round ended first: no enqueue, or the
    // queued message already submitted). 3 s is the fake's default slow round: the window is wide,
    // and every step below waits for a condition, so a fast machine is not slowed beyond the round.
    const SLOW_MS = 3000;
    const transcript = await bootIdle([], undefined, { DONEL_FAKE_CLAUDE_SLOW_MS: String(SLOW_MS) });
    send('primeira demorar');
    send('\r');
    await waitFor(() => screen().includes('esc to interrupt'), 'working footer');
    send('segunda');
    send('\r');
    await waitFor(() => transcriptLines(transcript).some((l) => l.type === 'queue-operation' && l.operation === 'enqueue'), 'enqueue');
    expect(hooks('UserPromptSubmit')).toHaveLength(1); // the queued one has not been submitted yet
    await waitFor(() => hooks('UserPromptSubmit').length === 2, 'queued message processed', SLOW_MS + 15_000);
    const lines = transcriptLines(transcript);
    const enqueue = lines.find((l) => l.type === 'queue-operation' && l.operation === 'enqueue')!;
    expect(enqueue).toMatchObject({ content: 'segunda', sessionId: expect.any(String), timestamp: expect.any(String) });
    expect(enqueue.uuid).toBeUndefined();
    const iRemove = lines.findIndex((l) => l.type === 'queue-operation' && l.operation === 'remove');
    const iQueued = lines.findIndex((l) => l.type === 'attachment' && l.attachment?.type === 'queued_command');
    expect(iRemove).toBeGreaterThan(-1);
    expect(iQueued).toBeGreaterThan(iRemove);
    expect(lines[iQueued].attachment).toMatchObject({ prompt: 'segunda', commandMode: 'prompt', humanTurn: true });
    expect(hooks('UserPromptSubmit')[1].body.prompt).toBe('segunda');
  });

  it('Esc during a round interrupts it and writes the interruption marker', async () => {
    const transcript = await bootIdle([], undefined, { DONEL_FAKE_CLAUDE_SLOW_MS: '5000' });
    send('longa demorar\r');
    await waitFor(() => screen().includes('esc to interrupt'), 'working footer');
    send('\x1b');
    await waitFor(() => screen().includes('? for shortcuts'), 'idle again');
    const marker = transcriptLines(transcript).find((l) => l.type === 'user' && JSON.stringify(l.message).includes('[Request interrupted by user]'));
    expect(marker).toBeTruthy();
  });

  it('opens the slash menu above the ruler, Esc closes it keeping the text, Enter with it open completes instead of sending', async () => {
    const transcript = await bootIdle();
    send('/mod');
    await waitFor(() => screen().includes('  ❯ /model'), 'menu');
    const lines = screen().split('\r\n');
    const iMenu = lines.findIndex((l) => l.includes('  ❯ /model'));
    const iRuler = lines.findIndex((l) => l.startsWith('───'));
    expect(iMenu).toBeLessThan(iRuler);
    send('\x1b');
    await waitFor(() => !screen().includes('  ❯ /model'), 'menu closed');
    expect(screen()).toContain('❯ /mod');
    send('\r'); // menu closed: Enter submits what is in the box ("/mod" is not a command)
    const line = await waitFor(() => transcriptLines(transcript).find((l) => l.subtype === 'informational'), 'closed menu lets Enter through');
    expect(line.content).toBe('Unknown command: /mod');
  });

  it('Enter with the slash menu open completes the command instead of sending it', async () => {
    const transcript = await bootIdle();
    send('/mod');
    await waitFor(() => screen().includes('  ❯ /model'), 'menu');
    send('\r');
    await waitFor(() => screen().includes('❯ /model'), 'completed');
    await new Promise((r) => setTimeout(r, 150));
    expect(hooks('UserPromptSubmit')).toHaveLength(0);
    expect(transcriptLines(transcript)).toHaveLength(0);
  });

  it('writes system/informational "Unknown command" for an unknown slash command', async () => {
    const transcript = await bootIdle();
    send('/naoexiste\r');
    const line = await waitFor(() => transcriptLines(transcript).find((l) => l.type === 'system' && l.subtype === 'informational'), 'informational');
    expect(line.content).toBe('Unknown command: /naoexiste');
    expect(hooks('UserPromptSubmit')).toHaveLength(0);
  });

  it('plays native commands: local_command with command tags, compact_boundary + SessionStart(compact), and ! shell mode', async () => {
    const transcript = await bootIdle();
    send('/cost\r');
    await waitFor(() => transcriptLines(transcript).some((l) => l.type === 'system' && l.subtype === 'local_command'), 'local_command');
    let lines = transcriptLines(transcript);
    expect(lines.some((l) => l.type === 'user' && String(l.message.content).includes('<command-name>/cost</command-name>'))).toBe(true);
    expect(lines.find((l) => l.subtype === 'local_command')!.commandRun).toMatchObject({ command: '/cost' });
    send('/compact\r');
    await waitFor(() => hooks('SessionStart').some((r) => r.body.source === 'compact'), 'SessionStart(compact)');
    expect(transcriptLines(transcript).some((l) => l.type === 'system' && l.subtype === 'compact_boundary')).toBe(true);
    send('!ls -la\r');
    await waitFor(() => transcriptLines(transcript).some((l) => l.type === 'user' && String(l.message.content).includes('<bash-input>ls -la</bash-input>')), 'bash-input');
    lines = transcriptLines(transcript);
    expect(lines.some((l) => l.type === 'user' && String(l.message.content).includes('<bash-stdout>'))).toBe(true);
  });

  it('Esc Esc in one write discards the box text when idle', async () => {
    await bootIdle();
    send('rascunho');
    await waitFor(() => screen().includes('rascunho'), 'typed');
    send('\x1b\x1b');
    await waitFor(() => !screen().includes('rascunho'), 'discarded');
  });

  it('DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER swallows the first Enter: the text stays in the box until a second one', async () => {
    await bootIdle([], undefined, { DONEL_FAKE_CLAUDE_DROP_FIRST_ENTER: '1' });
    send('oi');
    send('\r');
    await new Promise((r) => setTimeout(r, 300));
    expect(hooks('UserPromptSubmit')).toHaveLength(0);
    expect(screen()).toContain('❯ oi');
    send('\r');
    await waitFor(() => hooks('UserPromptSubmit')[0], 'UserPromptSubmit after the second Enter');
  });
});
