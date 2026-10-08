import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHookBridge, type BridgeEvent, type HookBridge } from '../src/main/hook-bridge';

// Contract test (contracts/hook-bridge.md): real server on loopback + an HTTP
// client that imitates the claude CLI.

interface Reply {
  status: number;
  body: string;
}

function post(port: number, event: string, token: string | null, body: string | Buffer): { promise: Promise<Reply>; abort: () => void } {
  let abort = () => {};
  const promise = new Promise<Reply>((resolve, reject) => {
    const headers: Record<string, string | number> = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (token !== null) headers['X-Donel-Token'] = token;
    const req = request({ host: '127.0.0.1', port, path: `/h/${event}`, method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    abort = () => req.destroy();
    req.on('error', reject);
    req.end(body);
  });
  // an aborted request rejects; callers that abort ignore this promise
  promise.catch(() => {});
  return { promise, abort };
}

const send = (port: number, event: string, token: string | null, payload: unknown) => post(port, event, token, JSON.stringify(payload)).promise;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let now = 1_000_000;
let bridge: HookBridge;
let port: number;
let token: string;
let events: BridgeEvent[];
const durations: Array<{ event: string; ptyId: string; durationMs: number }> = [];

function pendingEvent() {
  const ev = events.find((e) => e.type === 'pending');
  if (ev?.type !== 'pending') throw new Error('no pending event');
  return ev;
}

beforeEach(async () => {
  now = 1_000_000;
  durations.length = 0;
  bridge = createHookBridge({ now: () => now, diagnostics: { hook: (e) => durations.push(e) } });
  port = (await bridge.start()).port;
  token = bridge.registerSession('pty-1');
  events = [];
  bridge.on('pty-1', (e) => events.push(e));
});

afterEach(async () => {
  await bridge.close();
});

describe('authentication and parsing', () => {
  it('returns 401 without a token', async () => {
    const r = await send(port, 'Stop', null, {});
    expect(r.status).toBe(401);
    expect(r.body).toBe('');
  });

  it('returns 401 with an unknown token and after unregister', async () => {
    expect((await send(port, 'Stop', 'nope', {})).status).toBe(401);
    bridge.unregisterSession('pty-1');
    expect((await send(port, 'Stop', token, {})).status).toBe(401);
  });

  it('returns 400 on invalid JSON and keeps serving', async () => {
    expect((await post(port, 'Stop', token, '{not json').promise).status).toBe(400);
    expect((await send(port, 'Stop', token, { session_id: 's' })).status).toBe(200);
  });

  it('returns 413 above 32 MB', async () => {
    const big = Buffer.alloc(32 * 1024 * 1024 + 1024, 0x20);
    const r = await post(port, 'Stop', token, big).promise;
    expect(r.status).toBe(413);
    expect((await send(port, 'Stop', token, {})).status).toBe(200);
  });

  it('accepts a large payload under the limit', async () => {
    const r = await send(port, 'PostToolUse', token, { tool_input: { content: 'x'.repeat(5 * 1024 * 1024) } });
    expect(r.status).toBe(200);
  });
});

describe('non-blocking events', () => {
  it('answers {} within 10 ms and emits a hook event for the right ptyId', async () => {
    const t0 = performance.now();
    const r = await send(port, 'Stop', token, { session_id: 's1', transcript_path: 'C:/t.jsonl' });
    const elapsed = performance.now() - t0;
    expect(r).toEqual({ status: 200, body: '{}' });
    expect(elapsed).toBeLessThan(10);
    await tick();
    expect(events).toEqual([expect.objectContaining({ type: 'hook', ptyId: 'pty-1', event: 'Stop' })]);
  });

  it('routes events to the subscriber of the token owner only', async () => {
    const t2 = bridge.registerSession('pty-2');
    const other: BridgeEvent[] = [];
    bridge.on('pty-2', (e) => other.push(e));
    await send(port, 'Stop', t2, { session_id: 'b' });
    await tick();
    expect(events).toHaveLength(0);
    expect(other).toHaveLength(1);
  });

  it('reports measurements (event, ptyId, duration) without payload', async () => {
    await send(port, 'Notification', token, { message: 'secret conversation text' });
    await tick();
    expect(durations).toHaveLength(1);
    expect(Object.keys(durations[0]).sort()).toEqual(['durationMs', 'event', 'ptyId']);
    expect(durations[0]).toMatchObject({ event: 'Notification', ptyId: 'pty-1' });
  });
});

const perm = { session_id: 's1', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' }, permission_suggestions: [] };

describe('PermissionRequest', () => {
  it('holds the response until respond(decision)', async () => {
    let done = false;
    const pending = send(port, 'PermissionRequest', token, perm).then((r) => {
      done = true;
      return r;
    });
    await tick(80);
    expect(done).toBe(false);
    const ev = pendingEvent();
    expect(ev.handle.respond({ behavior: 'allow' })).toBe(true);
    const r = await pending;
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    expect(ev.handle.respond({ behavior: 'deny' })).toBe(false);
  });

  it('release answers {} so the TUI dialog stays valid', async () => {
    const pending = send(port, 'PermissionRequest', token, perm);
    await tick();
    pendingEvent().handle.release();
    expect(await pending).toEqual({ status: 200, body: '{}' });
  });

  it('emits expired when the client closes the connection', async () => {
    const { abort } = post(port, 'PermissionRequest', token, JSON.stringify(perm));
    await tick();
    const ev = pendingEvent();
    abort();
    await tick(80);
    expect(events).toContainEqual({ type: 'expired', ptyId: 'pty-1', requestId: ev.handle.id });
    expect(ev.handle.respond({ behavior: 'allow' })).toBe(false);
  });

  it('links the pending to the latest PreToolUse by (agent_id, tool_name, tool_input) within 10 s', async () => {
    await send(port, 'PreToolUse', token, { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_old' });
    now += 2000;
    await send(port, 'PreToolUse', token, { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_new' });
    await send(port, 'PreToolUse', token, { agent_id: 'a2', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_other_agent' });
    now += 3000;
    void send(port, 'PermissionRequest', token, perm);
    await tick();
    expect(pendingEvent().toolUseId).toBe('toolu_new');
  });

  it('does not link a PreToolUse older than 10 s', async () => {
    await send(port, 'PreToolUse', token, { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_x' });
    now += 10_001;
    void send(port, 'PermissionRequest', token, perm);
    await tick();
    expect(pendingEvent().toolUseId).toBeNull();
  });

  it('PostToolUse with the same triple releases the held decision and emits resolved-elsewhere', async () => {
    const pending = send(port, 'PermissionRequest', token, perm);
    await tick();
    const ev = pendingEvent();
    // key order differs on purpose: the triple compares structurally
    const post1 = await send(port, 'PostToolUse', token, { tool_input: { command: 'ls' }, tool_name: 'Bash', agent_id: 'a1', tool_use_id: 'toolu_1' });
    expect(post1).toEqual({ status: 200, body: '{}' });
    expect(await pending).toEqual({ status: 200, body: '{}' });
    await tick();
    expect(events).toContainEqual({ type: 'resolved-elsewhere', ptyId: 'pty-1', requestId: ev.handle.id });
  });

  it('PostToolUse with a different triple leaves the decision open', async () => {
    let done = false;
    void send(port, 'PermissionRequest', token, perm).then(() => {
      done = true;
    });
    await tick();
    await send(port, 'PostToolUse', token, { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'pwd' } });
    await tick();
    expect(done).toBe(false);
    expect(events.some((e) => e.type === 'resolved-elsewhere')).toBe(false);
  });

  it('unregisterSession cancels open pendings and answers {}', async () => {
    const pending = send(port, 'PermissionRequest', token, perm);
    await tick();
    const ev = pendingEvent();
    bridge.unregisterSession('pty-1');
    expect(await pending).toEqual({ status: 200, body: '{}' });
    expect(events).toContainEqual({ type: 'cancelled', ptyId: 'pty-1', requestId: ev.handle.id });
  });
});

describe('conversation switching', () => {
  it.each(['clear', 'resume', 'fork'])('SessionStart source=%s with a new session_id emits conversation-switched', async (source) => {
    await send(port, 'SessionStart', token, { session_id: 'old', transcript_path: 'C:/old.jsonl', source: 'startup' });
    await send(port, 'SessionStart', token, { session_id: 'new', transcript_path: 'C:/new.jsonl', source });
    await tick();
    expect(events).toContainEqual({ type: 'conversation-switched', ptyId: 'pty-1', sessionId: 'new', transcriptPath: 'C:/new.jsonl', source });
  });

  it('SessionStart startup does not emit conversation-switched', async () => {
    await send(port, 'SessionStart', token, { session_id: 'old', transcript_path: 'C:/old.jsonl', source: 'startup' });
    await tick();
    expect(events.some((e) => e.type === 'conversation-switched')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'hook', event: 'SessionStart' }));
  });

  it.each(['clear', 'resume'])('SessionEnd reason=%s does not signal the end', async (reason) => {
    await send(port, 'SessionEnd', token, { session_id: 's', reason });
    await tick();
    expect(events.some((e) => e.type === 'session-end' || (e.type === 'hook' && e.event === 'SessionEnd'))).toBe(false);
  });

  it('SessionEnd with another reason signals the end', async () => {
    await send(port, 'SessionEnd', token, { session_id: 's', reason: 'prompt_input_exit' });
    await tick();
    expect(events).toContainEqual(expect.objectContaining({ type: 'session-end', ptyId: 'pty-1', reason: 'prompt_input_exit' }));
  });
});
