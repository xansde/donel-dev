// T080 — the fake `claude` holds PermissionRequest hooks (permission / ask / plan / parallel subagents) until the
// app (here: a local HTTP server) decides, or until the TUI dialog is keyed. Real process, plain pipes, no node-pty.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionHooksSettings } from '../src/main/hooks-settings';

const SCRIPT = resolve(__dirname, 'smoke/fixtures/fake-claude-chat/fake-claude-chat.mjs');

interface Received {
  readonly event: string;
  readonly body: Record<string, any>;
}
type Decision = Record<string, unknown>;
type Responder = (body: Record<string, any>) => Promise<Decision | undefined>;

let server: Server;
let port: number;
let received: Received[];
let workDir: string;
let child: ChildProcessWithoutNullStreams | null;
let output: string;
let responder: Responder;

const decide = (decision: Decision): Decision => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
const answerNow = (decision: Decision): Responder => async () => decide(decision);
/** Holds the PermissionRequest response open until `release` is called. */
function hold(): { responder: Responder; release: (value?: Decision) => void } {
  let release: (value?: Decision) => void = () => {};
  const gate = new Promise<Decision | undefined>((ok) => (release = ok));
  return { responder: () => gate, release };
}

async function waitFor<T>(probe: () => T | undefined | false, label: string, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}\nscreen:\n${screen().slice(-800)}\nreceived: ${received.map((r) => r.event).join(',')}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const hooks = (event: string): Received[] => received.filter((r) => r.event === event);
const screen = (): string => output.split('\x1b[2J').pop() ?? '';
const send = (text: string): void => void child!.stdin.write(text);
const logPath = (): string => join(workDir, 'calls.log');
const logEntries = (): Record<string, any>[] => (existsSync(logPath()) ? readFileSync(logPath(), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const transcript = (): Record<string, any>[] => {
  const path = hooks('SessionStart')[0].body.transcript_path as string;
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const toolResults = (): Record<string, any>[] =>
  transcript().flatMap((l) => (l.type === 'user' && Array.isArray(l.message?.content) ? l.message.content.filter((b: any) => b.type === 'tool_result') : []));

async function boot(steps: unknown[]): Promise<void> {
  const settingsPath = join(workDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(buildSessionHooksSettings({ port, token: 'tok-perm', chatEnabled: true, curlPath: 'curl' })));
  const scenario = { turns: [{ steps: [...steps, { type: 'hook', event: 'Stop' }] }] };
  const env = { ...process.env, DONEL_FAKE_CLAUDE_HOME: join(workDir, 'home'), DONEL_FAKE_CLAUDE_LOG: logPath(), DONEL_FAKE_CLAUDE_SCENARIO: JSON.stringify(scenario) };
  child = spawn(process.execPath, [SCRIPT, '--settings', settingsPath], { cwd: workDir, env });
  child.stdout.on('data', (d: Buffer) => (output += d.toString('utf8')));
  await waitFor(() => hooks('SessionStart')[0] && output.includes('? for shortcuts'), 'idle');
  send('vai\r');
}

beforeEach(async () => {
  received = [];
  output = '';
  child = null;
  responder = async () => undefined;
  workDir = mkdtempSync(join(tmpdir(), 'fake-claude-perm-'));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const event = (req.url ?? '').replace('/h/', '');
      received.push({ event, body });
      const answer = event === 'PermissionRequest' ? await responder(body) : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  child?.kill();
  server.closeAllConnections();
  await new Promise<void>((ok) => server.close(() => ok()));
});

const bash = { type: 'bash_permission', command: 'npm install left-pad', description: 'Install a package', id: 'toolu_bash' };

describe('fake-claude-chat held permissions', { timeout: 25000 }, () => {
  it('holds a Bash permission and applies allow + updatedPermissions (settings.local.json, tool_result, PostToolUse)', async () => {
    const gate = hold();
    responder = gate.responder;
    await boot([bash]);
    const request = await waitFor(() => hooks('PermissionRequest')[0], 'PermissionRequest');
    expect(request.body).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'npm install left-pad' } });
    expect(request.body.permission_suggestions[0].rules[0]).toEqual({ toolName: 'Bash', ruleContent: 'npm install:*' });
    expect(request.body.tool_use_id).toBeUndefined();
    expect(received.map((r) => r.event)).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest']);
    expect(screen()).toContain('Do you want to proceed?');
    await new Promise((r) => setTimeout(r, 300));
    expect(hooks('PostToolUse')).toHaveLength(0);
    expect(hooks('Stop')).toHaveLength(0);

    gate.release(decide({ behavior: 'allow', updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm install:*' }], behavior: 'allow', destination: 'localSettings' }] }));
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()).toEqual([expect.objectContaining({ tool_use_id: 'toolu_bash', content: 'ok' })]);
    expect(hooks('PostToolUse')[0].body.tool_use_id).toBe('toolu_bash');
    const local = JSON.parse(readFileSync(join(workDir, '.claude', 'settings.local.json'), 'utf8'));
    expect(local.permissions.allow).toEqual(['Bash(npm install:*)']);
    expect(logEntries().find((e) => e.hookResponse === 'PermissionRequest')).toMatchObject({ effective: true });
    expect(screen()).not.toContain('Do you want to proceed?');
  });

  it('merges a tool-wide rule into an existing settings.local.json', async () => {
    mkdirSync(join(workDir, '.claude'), { recursive: true });
    writeFileSync(join(workDir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read'] }, other: 1 }));
    responder = answerNow({ behavior: 'allow', updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'localSettings' }] });
    await boot([{ type: 'edit_permission', file_path: 'a.ts', old_string: 'a', new_string: 'b' }]);
    await waitFor(() => hooks('Stop')[0], 'Stop');
    const local = JSON.parse(readFileSync(join(workDir, '.claude', 'settings.local.json'), 'utf8'));
    expect(local).toEqual({ permissions: { allow: ['Read', 'Edit'] }, other: 1 });
  });

  it('AskUserQuestion: allow with updatedInput puts the answers in the tool_result', async () => {
    responder = async (body) => decide({ behavior: 'allow', updatedInput: { ...body.tool_input, answers: { 'Which db?': 'Postgres' } } });
    await boot([{ type: 'ask', questions: [{ question: 'Which db?', header: 'DB', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false }] }]);
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0].content).toContain('"Which db?"="Postgres"');
    expect(hooks('PostToolUse')[0].body.tool_input.answers).toEqual({ 'Which db?': 'Postgres' });
  });

  it('AskUserQuestion: a note in updatedInput.annotations reaches the tool_result as the real CLI renders it', async () => {
    responder = async (body) =>
      decide({
        behavior: 'allow',
        updatedInput: { ...body.tool_input, answers: { 'Which db?': 'SQLite' }, annotations: { 'Which db?': { notes: 'só em dev' } } },
      });
    await boot([{ type: 'ask', questions: [{ question: 'Which db?', header: 'DB', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false }] }]);
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0].content).toContain('"Which db?"="SQLite" notes: só em dev');
    expect(toolResults()[0].content).toContain('Read the answers carefully');
    expect(hooks('PostToolUse')[0].body.tool_input.annotations).toEqual({ 'Which db?': { notes: 'só em dev' } });
  });

  it('ExitPlanMode: allow without updatedInput is ignored (keeps waiting, TUI dialog stays); with updatedInput it proceeds', async () => {
    const calls: Decision[] = [{ behavior: 'allow' }];
    responder = async (body) => decide(calls.shift() ?? { behavior: 'allow', updatedInput: body.tool_input });
    await boot([{ type: 'plan', plan: '# Plan\n- a', planFilePath: 'C:/x/plan.md' }]);
    await waitFor(() => logEntries().find((e) => e.hookResponse === 'PermissionRequest'), 'first response logged');
    expect(logEntries().find((e) => e.hookResponse === 'PermissionRequest')).toMatchObject({ effective: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(hooks('Stop')).toHaveLength(0);
    expect(screen()).toContain('Would you like to proceed?');
    send('1'); // TUI answers
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0].content).toContain('approved your plan');
  });

  it('ExitPlanMode: allow with updatedInput proceeds straight away', async () => {
    responder = async (body) => decide({ behavior: 'allow', updatedInput: body.tool_input });
    await boot([{ type: 'plan', plan: '# Plan', planFilePath: 'C:/x/plan.md' }]);
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0].content).toContain('approved your plan');
  });

  it('deny with message: error tool_result, no PostToolUse, the turn goes on', async () => {
    responder = answerNow({ behavior: 'deny', message: 'Negado pelo dono no Donel.' });
    await boot([{ ...bash, denyReply: 'Ok, nao instalo.' }]);
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()).toEqual([expect.objectContaining({ content: 'Negado pelo dono no Donel.', is_error: true })]);
    expect(hooks('PostToolUse')).toHaveLength(0);
    expect(transcript().some((l) => l.type === 'assistant' && l.message.content[0].text === 'Ok, nao instalo.')).toBe(true);
  });

  it('deny + interrupt: [Request interrupted by user], no Stop', async () => {
    responder = answerNow({ behavior: 'deny', interrupt: true });
    await boot([bash]);
    await waitFor(() => transcript().some((l) => JSON.stringify(l).includes('[Request interrupted by user]')), 'interrupt line');
    expect(toolResults()).toHaveLength(0);
    expect(hooks('Stop')).toHaveLength(0);
    expect(hooks('PostToolUse')).toHaveLength(0);
  });

  it('empty {} response falls back to the TUI; key 1 allows, and a late hook answer is ignored', async () => {
    const gate = hold();
    responder = gate.responder;
    await boot([bash]);
    await waitFor(() => hooks('PermissionRequest')[0], 'PermissionRequest');
    send('1');
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0]).toMatchObject({ tool_use_id: 'toolu_bash', content: 'ok' });
    expect(hooks('PostToolUse')).toHaveLength(1);
    gate.release(decide({ behavior: 'deny', message: 'too late' }));
    await waitFor(() => logEntries().find((e) => e.lateHookResponse), 'late response logged');
    expect(toolResults()).toHaveLength(1);
  });

  it('empty {} from the app leaves the dialog up; key 3 denies (error tool_result, no PostToolUse)', async () => {
    responder = async () => ({});
    await boot([bash]);
    await waitFor(() => logEntries().find((e) => e.hookResponse === 'PermissionRequest'), 'response logged');
    await new Promise((r) => setTimeout(r, 200));
    expect(screen()).toContain('Do you want to proceed?');
    send('3');
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0]).toMatchObject({ is_error: true });
    expect(hooks('PostToolUse')).toHaveLength(0);
  });

  it('key 2 on the TUI allows and records the suggested rule; Esc denies', async () => {
    responder = async () => undefined;
    await boot([bash, { ...bash, id: 'toolu_bash2' }]);
    await waitFor(() => screen().includes('Do you want to proceed?'), 'dialog');
    send('2');
    await waitFor(() => hooks('PermissionRequest').length === 2 && screen().includes('Do you want to proceed?') && toolResults().length === 1, 'second dialog');
    send('\x1b');
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(JSON.parse(readFileSync(join(workDir, '.claude', 'settings.local.json'), 'utf8')).permissions.allow).toEqual(['Bash(npm install:*)']);
    expect(toolResults()[1]).toMatchObject({ is_error: true });
  });

  it('AskUserQuestion on the TUI: pressing 2 picks the second option', async () => {
    await boot([{ type: 'ask', questions: [{ question: 'Which db?', header: 'DB', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false }] }]);
    await waitFor(() => screen().includes('2. SQLite'), 'ask dialog');
    send('2');
    await waitFor(() => hooks('Stop')[0], 'Stop');
    expect(toolResults()[0].content).toContain('"Which db?"="SQLite"');
  });

  it('two simultaneous subagent requests are held in parallel, each with its own answer', async () => {
    const gates = [hold(), hold()];
    responder = (body) => (body.agent_id === 'agent-1' ? gates[0].responder(body) : gates[1].responder(body));
    await boot([
      {
        type: 'subagent_permissions',
        requests: [
          { type: 'bash_permission', command: 'npm test', agentType: 'tester' },
          { type: 'edit_permission', file_path: 'b.ts', old_string: 'x', new_string: 'y', agentType: 'coder' },
        ],
      },
    ]);
    await waitFor(() => hooks('PermissionRequest').length === 2, 'both requests');
    expect(hooks('SubagentStart').map((r) => r.body.agent_id)).toEqual(['agent-1', 'agent-2']);
    expect(hooks('PermissionRequest').map((r) => [r.body.agent_id, r.body.agent_type, r.body.tool_name])).toEqual([
      ['agent-1', 'tester', 'Bash'],
      ['agent-2', 'coder', 'Edit'],
    ]);
    gates[1].release(decide({ behavior: 'deny', message: 'no edit' }));
    await waitFor(() => logEntries().find((e) => e.permissionOutcome === 'deny'), 'second decided first');
    expect(hooks('Stop')).toHaveLength(0);
    gates[0].release(decide({ behavior: 'allow' }));
    await waitFor(() => hooks('Stop')[0], 'Stop');
    const outcomes = logEntries().filter((e) => e.permissionOutcome).map((e) => [e.agent_id, e.permissionOutcome]);
    expect(outcomes).toEqual([['agent-2', 'deny'], ['agent-1', 'allow']]);
    expect(hooks('PostToolUse').map((r) => r.body.agent_id)).toEqual(['agent-1']);
  });
});
