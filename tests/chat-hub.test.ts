// T047 (014-chat) - chat hub: per-tab source + follower + pager + adapter + basic
// live state, with a fake hook bridge and real temp transcripts.
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatHub, type ChatHub, type ChatHubEvents } from '../src/main/chat/chat-hub';
import { registerChatIpcHandlers } from '../src/main/chat/chat-ipc';
import type { BridgeEvent } from '../src/main/hook-bridge';
import { CHAT_CHANNELS } from '../src/shared/chat/ipc';
import type { ChatConversationSwitchedEvent, ChatLiveEvent, ChatPromptSignalEvent, ChatReceptionEvent, ChatRowsEvent } from '../src/shared/chat/ipc';
import type { ConversationRow, NoticeRow } from '../src/shared/chat/rows';
import { pollUntil } from './helpers/fsWatchWait';

let dir: string;
let hubs: ChatHub[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-chat-hub-'));
});
afterEach(() => {
  for (const h of hubs) h.dispose();
  hubs = [];
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Round n = user line (2n-1) + assistant text line (2n), chained by parentUuid. */
function roundLines(from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const parent = n === 1 ? null : uid(2 * (n - 1));
    out.push(
      JSON.stringify({
        parentUuid: parent,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: `prompt ${n}` },
        turnOrigin: 'human',
        promptSource: 'typed',
        uuid: uid(2 * n - 1),
        timestamp: '2026-10-01T10:00:00.000Z',
      }),
      JSON.stringify({
        parentUuid: uid(2 * n - 1),
        isSidechain: false,
        type: 'assistant',
        message: { id: `msg_${n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: `resp ${n}` }] },
        uuid: uid(2 * n),
        timestamp: '2026-10-01T10:00:01.000Z',
      }),
    );
  }
  return out;
}

const writeRounds = (path: string, from: number, to: number): void => writeFileSync(path, `${roundLines(from, to).join('\n')}\n`);
const appendRounds = (path: string, from: number, to: number): void => appendFileSync(path, `${roundLines(from, to).join('\n')}\n`);

class FakeBridge {
  private readonly listeners = new Set<(e: BridgeEvent) => void>();
  onAny(l: (e: BridgeEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(e: BridgeEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
  hook(ptyId: string, event: string, extra: Record<string, unknown> = {}): void {
    this.emit({ type: 'hook', ptyId, event, payload: { hook_event_name: event, ...extra } });
  }
}

interface Harness {
  hub: ChatHub;
  bridge: FakeBridge;
  rows: ChatRowsEvent[];
  live: ChatLiveEvent[];
  switched: ChatConversationSwitchedEvent[];
  reception: ChatReceptionEvent[];
  signals: ChatPromptSignalEvent[];
  unknown: { ptyId: string; entryType: string }[];
  clock: { t: number };
}

function harness(sources: Record<string, { sessionId: string; transcriptPath: string; cwd: string }>, opts: { missingMs?: number; staleMs?: number } = {}): Harness {
  const bridge = new FakeBridge();
  const rows: ChatRowsEvent[] = [];
  const live: ChatLiveEvent[] = [];
  const switched: ChatConversationSwitchedEvent[] = [];
  const reception: ChatReceptionEvent[] = [];
  const signals: ChatPromptSignalEvent[] = [];
  const unknown: { ptyId: string; entryType: string }[] = [];
  const clock = { t: 1_000_000 };
  const events: ChatHubEvents = {
    rows: (e) => rows.push(e),
    live: (e) => live.push(e),
    conversationSwitched: (e) => switched.push(e),
    reception: (e) => reception.push(e),
    promptSignal: (e) => signals.push(e),
  };
  const hub = createChatHub({
    bridge,
    getSource: (ptyId) => sources[ptyId] ?? null,
    events,
    diagnostics: { unknownEntry: (e) => unknown.push(e) },
    now: () => clock.t,
    missingMs: opts.missingMs ?? 10_000,
    staleMs: opts.staleMs ?? 8_000,
    receptionPollMs: 0,
    follower: { debounceMs: 10, pollMs: 50, retryMs: 20 },
  });
  hubs.push(hub);
  return { hub, bridge, rows, live, switched, reception, signals, unknown, clock };
}

const src = (path: string, sessionId = 's1') => ({ sessionId, transcriptPath: path, cwd: dir });
const ids = (rows: readonly ConversationRow[]): string[] => rows.map((r) => r.id);

// ---------------------------------------------------------------------------

describe('attach / load-older', () => {
  it('returns the first page from the end and load-older pages backwards to the start', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 70);
    const h = harness({ 'pty-1': src(path) });

    const snap = await h.hub.attach('pty-1');
    expect(snap.source.sessionId).toBe('s1');
    const last = snap.rows[snap.rows.length - 1];
    expect(last.kind).toBe('assistant');
    expect(last.kind === 'assistant' && last.markdown).toBe('resp 70');
    expect(snap.rows.length).toBeGreaterThan(0);
    expect(snap.rows.length).toBeLessThan(140); // not the whole file
    expect(snap.cursor).not.toBeNull();

    let all = [...snap.rows];
    let cursor = snap.cursor;
    let guard = 0;
    while (cursor !== null && guard < 10) {
      const page = await h.hub.loadOlder('pty-1', 'main', cursor);
      all = [...page.rows, ...all];
      cursor = page.cursor;
      guard += 1;
    }
    expect(cursor).toBeNull();
    expect(all).toHaveLength(140);
    expect(new Set(ids(all)).size).toBe(140);
    expect(all[0]!.kind).toBe('user');
    expect(all[0]!.kind === 'user' && all[0]!.text).toBe('prompt 1');
  });

  it('is idempotent and follows appended lines with row patches', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 2);
    const h = harness({ 'pty-1': src(path) });
    const a = await h.hub.attach('pty-1');
    const b = await h.hub.attach('pty-1');
    expect(ids(b.rows)).toEqual(ids(a.rows));

    appendRounds(path, 3, 3);
    await pollUntil(() => h.rows.some((e) => e.patches.some((p) => p.op === 'append')));
    const appended = h.rows.flatMap((e) => e.patches).filter((p) => p.op === 'append').flatMap((p) => [...p.rows]);
    expect(appended.map((r) => r.id)).toEqual([uid(5), uid(6)]);
    expect(h.rows[0]!.ptyId).toBe('pty-1');
    expect(h.rows[0]!.scope).toBe('main');
  });

  it('waits for a transcript that is born later', async () => {
    const path = join(dir, 'later.jsonl');
    const h = harness({ 'pty-1': src(path) });
    const snap = await h.hub.attach('pty-1');
    expect(snap.rows).toEqual([]);
    expect(snap.cursor).toBeNull();
    writeRounds(path, 1, 1);
    await pollUntil(() => h.rows.length > 0);
    expect(h.rows[0]!.patches[0]!.op).toBe('append');
  });

  it('stops following after detach', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) });
    await h.hub.attach('pty-1');
    h.hub.detach('pty-1');
    appendRounds(path, 2, 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(h.rows).toEqual([]);
  });
});

describe('row-detail', () => {
  it('re-reads the LineRef: tool output, raw line and group children', async () => {
    const path = join(dir, 's1.jsonl');
    copyFileSync(join(__dirname, 'fixtures', 'chat', 'basic-round.jsonl'), path);
    const h = harness({ 'pty-1': src(path) });
    const snap = await h.hub.attach('pty-1');
    const action = snap.rows.find((r) => r.kind === 'action');
    expect(action).toBeDefined();

    const out = await h.hub.rowDetail({ ptyId: 'pty-1', scope: 'main', rowId: action!.id, part: 'output' });
    expect(out.part).toBe('output');
    expect(out.text).toContain('Beacon service.');
    expect(out.truncated).toBe(false);

    const raw = await h.hub.rowDetail({ ptyId: 'pty-1', scope: 'main', rowId: action!.id, part: 'raw' });
    expect(raw.text).toContain('toolu_b1');

    const none = await h.hub.rowDetail({ ptyId: 'pty-1', scope: 'main', rowId: 'nope', part: 'output' });
    expect(none.text).toBe('');
  });

  it('truncates long output unless output-full is asked', async () => {
    const path = join(dir, 's1.jsonl');
    const big = 'x'.repeat(50_000);
    const lines = [
      JSON.stringify({ parentUuid: null, type: 'user', message: { role: 'user', content: 'run' }, turnOrigin: 'human', promptSource: 'typed', uuid: uid(1), timestamp: '2026-10-01T10:00:00.000Z' }),
      JSON.stringify({ parentUuid: uid(1), type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_big', name: 'Bash', input: { command: 'echo big' } }] }, uuid: uid(2), timestamp: '2026-10-01T10:00:01.000Z' }),
      JSON.stringify({ parentUuid: uid(2), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_big', content: big }] }, toolUseResult: { stdout: big, stderr: '' }, uuid: uid(3), timestamp: '2026-10-01T10:00:02.000Z' }),
    ];
    writeFileSync(path, `${lines.join('\n')}\n`);
    const h = harness({ 'pty-1': src(path) });
    const snap = await h.hub.attach('pty-1');
    const action = snap.rows.find((r) => r.kind === 'action')!;
    const cut = await h.hub.rowDetail({ ptyId: 'pty-1', scope: 'main', rowId: action.id, part: 'output' });
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThan(big.length);
    const full = await h.hub.rowDetail({ ptyId: 'pty-1', scope: 'main', rowId: action.id, part: 'output-full' });
    expect(full.truncated).toBe(false);
    expect(full.text.length).toBe(big.length);
  });
});

describe('conversation switch', () => {
  it('restarts on the new transcript with the notice on top and tells the renderer', async () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeRounds(a, 1, 3);
    const h = harness({ 'pty-1': src(a, 'sa') });
    await h.hub.attach('pty-1');

    h.bridge.emit({ type: 'conversation-switched', ptyId: 'pty-1', sessionId: 'sb', transcriptPath: b, source: 'clear' });
    await pollUntil(() => h.switched.length > 0);
    expect(h.switched[0]).toEqual({ ptyId: 'pty-1', sessionId: 'sb', reason: 'clear' });

    const snap = await h.hub.attach('pty-1');
    expect(snap.source.sessionId).toBe('sb');
    expect(snap.source.transcriptPath).toBe(b);
    expect(snap.rows).toHaveLength(1);
    const notice = snap.rows[0] as NoticeRow;
    expect(notice.kind).toBe('notice');
    expect(notice.notice).toBe('conversation-switch');
    expect(notice.params.source).toBe('clear');

    // the new file is followed; the old one is not
    h.rows.length = 0;
    writeRounds(b, 1, 1);
    appendRounds(a, 4, 4);
    await pollUntil(() => h.rows.length > 0);
    const seen = h.rows.flatMap((e) => e.patches).flatMap((p) => [...p.rows]);
    expect(seen.some((r) => r.kind === 'user' && r.text === 'prompt 1')).toBe(true);
    expect(seen.some((r) => r.kind === 'user' && r.text === 'prompt 4')).toBe(false);
  });

  it('ignores a switch to the conversation it already follows', async () => {
    const a = join(dir, 'a.jsonl');
    writeRounds(a, 1, 1);
    const h = harness({ 'pty-1': src(a, 'sa') });
    await h.hub.attach('pty-1');
    h.bridge.emit({ type: 'conversation-switched', ptyId: 'pty-1', sessionId: 'sa', transcriptPath: a, source: 'resume' });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.switched).toEqual([]);
  });
});

describe('account switch', () => {
  it('adds an account-switch notice at the end, live and in later snapshots', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) });
    await h.hub.attach('pty-1');
    h.hub.notifyAccountSwitch('Conta B');

    expect(h.rows).toHaveLength(1);
    const patch = h.rows[0]!.patches[0]!;
    expect(patch.op).toBe('append');
    const notice = patch.rows[0] as NoticeRow;
    expect(notice.notice).toBe('account-switch');
    expect(notice.id.startsWith('app:')).toBe(true);
    expect(notice.params).toEqual({ label: 'Conta B' });

    const snap = await h.hub.attach('pty-1');
    const tail = snap.rows[snap.rows.length - 1] as NoticeRow;
    expect(tail.notice).toBe('account-switch');
  });
});

describe('reception', () => {
  it('becomes missing when the file is not born after activity, then ok when it appears', async () => {
    const path = join(dir, 'never.jsonl');
    const h = harness({ 'pty-1': src(path) }, { missingMs: 10_000 });
    await h.hub.attach('pty-1');
    h.bridge.hook('pty-1', 'UserPromptSubmit');

    h.clock.t += 5_000;
    h.hub.checkReception();
    expect(h.reception).toEqual([]);

    h.clock.t += 6_000;
    h.hub.checkReception();
    expect(h.reception).toEqual([{ ptyId: 'pty-1', reception: 'missing' }]);
    h.hub.checkReception(); // no repeat
    expect(h.reception).toHaveLength(1);
    expect((await h.hub.attach('pty-1')).live.status).toBe('not-receiving');

    writeRounds(path, 1, 1);
    await pollUntil(() => h.reception.length > 1);
    expect(h.reception[1]).toEqual({ ptyId: 'pty-1', reception: 'ok' });
  });

  it('becomes stale when there is activity but the file does not grow', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) }, { staleMs: 8_000 });
    await h.hub.attach('pty-1');
    h.bridge.hook('pty-1', 'UserPromptSubmit');
    h.clock.t += 9_000;
    h.hub.checkReception();
    expect(h.reception).toEqual([{ ptyId: 'pty-1', reception: 'stale' }]);

    appendRounds(path, 2, 2);
    await pollUntil(() => h.reception.length > 1);
    expect(h.reception[1]!.reception).toBe('ok');
  });

  it('does not flag an idle tab with no transcript yet', async () => {
    const h = harness({ 'pty-1': src(join(dir, 'idle.jsonl')) });
    await h.hub.attach('pty-1');
    h.clock.t += 60_000;
    h.hub.checkReception();
    expect(h.reception).toEqual([]);
  });
});

describe('live state', () => {
  it('follows the bridge: starting -> idle -> working -> idle -> ended', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) });
    expect((await h.hub.attach('pty-1')).live.status).toBe('starting');

    h.bridge.hook('pty-1', 'SessionStart');
    h.bridge.hook('pty-1', 'UserPromptSubmit');
    h.bridge.hook('pty-1', 'Stop');
    expect(h.live.map((e) => e.live.status)).toEqual(['idle', 'working', 'idle']);
    expect(h.live[0]!.ptyId).toBe('pty-1');
    expect(h.live[0]!.live).toMatchObject({ currentAction: null, pendings: [], sends: [], activeSubagents: [], terminalNeeded: null });

    h.bridge.emit({ type: 'session-end', ptyId: 'pty-1', reason: 'logout', payload: {} });
    expect(h.live[h.live.length - 1]!.live.status).toBe('ended');
    expect((await h.hub.attach('pty-1')).live.status).toBe('ended');
  });

  it('keeps live state for a tab that was not attached yet', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) });
    h.bridge.hook('pty-1', 'UserPromptSubmit');
    expect((await h.hub.attach('pty-1')).live.status).toBe('working');
  });
});

describe('diagnostics', () => {
  it('reports unknown top-level types by label only', async () => {
    const path = join(dir, 's1.jsonl');
    const lines = [
      ...roundLines(1, 1),
      JSON.stringify({ parentUuid: uid(2), type: 'brand-new-thing', uuid: uid(99), secret: 'do-not-log', timestamp: '2026-10-01T10:00:02.000Z' }),
      // a tail unknown line is not a leaf of the chain: a later node links through it
      JSON.stringify({ parentUuid: uid(99), type: 'assistant', message: { id: 'msg_z', role: 'assistant', content: [{ type: 'text', text: 'after' }] }, uuid: uid(100), timestamp: '2026-10-01T10:00:03.000Z' }),
    ];
    writeFileSync(path, `${lines.join('\n')}\n`);
    const h = harness({ 'pty-1': src(path) });
    await h.hub.attach('pty-1');
    expect(h.unknown).toEqual([{ ptyId: 'pty-1', entryType: 'brand-new-thing' }]);
  });
});

describe('registerChatIpcHandlers', () => {
  function fakeIpc(): { handle: (c: string, fn: unknown) => void; handlers: Map<string, unknown>; removeHandler: (c: string) => void } {
    const handlers = new Map<string, unknown>();
    return { handlers, handle: (c, fn) => void handlers.set(c, fn), removeHandler: (c) => void handlers.delete(c) };
  }

  it('registers nothing with chat.enabled = false', () => {
    const ipc = fakeIpc();
    const h = harness({});
    const result = registerChatIpcHandlers({ ipcMain: ipc, enabled: false, hub: h.hub, openExternal: async () => undefined, openPath: async () => '' });
    expect(ipc.handlers.size).toBe(0);
    expect(result.registered).toBe(false);
  });

  it('routes ack-lookup and screen-state, ignoring malformed input and unknown reasons', async () => {
    const ipc = fakeIpc();
    const h = harness({ 'pty-1': src(join(dir, 'x.jsonl')) });
    registerChatIpcHandlers({ ipcMain: ipc, enabled: true, hub: h.hub, openExternal: async () => undefined, openPath: async () => '' });
    const lookup = ipc.handlers.get(CHAT_CHANNELS.ackLookup) as (e: unknown, i: unknown) => Promise<{ matched: boolean }>;
    const screen = ipc.handlers.get(CHAT_CHANNELS.screenState) as (e: unknown, i: unknown) => void;
    h.bridge.hook('pty-1', 'UserPromptSubmit', { prompt: 'oi' });
    expect(await lookup({}, { ptyId: 'pty-1', text: 'oi', since: '1969-01-01T00:00:00.000Z' })).toMatchObject({ matched: true });
    expect(await lookup({}, { ptyId: 1, text: 'oi' })).toEqual({ matched: false });
    screen({}, { ptyId: 'pty-1', terminalNeeded: 'interactive-screen' });
    expect(h.live[h.live.length - 1]!.live.terminalNeeded).toEqual({ reason: 'interactive-screen' });
    screen({}, { ptyId: 'pty-1', terminalNeeded: 'bogus' });
    expect(h.live[h.live.length - 1]!.live.terminalNeeded).toEqual({ reason: 'interactive-screen' });
    screen({}, { ptyId: 'pty-1', terminalNeeded: null });
    expect(h.live[h.live.length - 1]!.live.terminalNeeded).toBeNull();
  });

  it('registers the attach/detach/load-older/row-detail/open-* handlers when enabled', async () => {
    const ipc = fakeIpc();
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) });
    const opened: string[] = [];
    registerChatIpcHandlers({ ipcMain: ipc, enabled: true, hub: h.hub, openExternal: async (u) => void opened.push(u), openPath: async (p) => (opened.push(p), '') });
    for (const c of [CHAT_CHANNELS.attach, CHAT_CHANNELS.detach, CHAT_CHANNELS.loadOlder, CHAT_CHANNELS.rowDetail, CHAT_CHANNELS.openExternal, CHAT_CHANNELS.openGenerated]) {
      expect(ipc.handlers.has(c)).toBe(true);
    }
    const attach = ipc.handlers.get(CHAT_CHANNELS.attach) as (e: unknown, i: { ptyId: string }) => Promise<{ rows: unknown[] }>;
    expect((await attach({}, { ptyId: 'pty-1' })).rows).toHaveLength(2);

    const openExternal = ipc.handlers.get(CHAT_CHANNELS.openExternal) as (e: unknown, i: { url: string }) => Promise<void>;
    await openExternal({}, { url: 'https://example.com' });
    await openExternal({}, { url: 'file:///C:/Windows/System32/calc.exe' });
    expect(opened).toEqual(['https://example.com']);

    const openGenerated = ipc.handlers.get(CHAT_CHANNELS.openGenerated) as (e: unknown, i: { ptyId: string; path: string }) => Promise<void>;
    mkdirSync(join(dir, 'out'));
    await openGenerated({}, { ptyId: 'pty-1', path: join(dir, 'out', 'r.html') });
    await openGenerated({}, { ptyId: 'pty-1', path: join(dir, 'out', 'r.exe') });
    await openGenerated({}, { ptyId: 'pty-1', path: join(tmpdir(), 'outside.html') });
    expect(opened).toEqual(['https://example.com', join(dir, 'out', 'r.html')]);
  });
});

// ---------------------------------------------------------------------------
// T064 - sinais de aceite
// ---------------------------------------------------------------------------

describe('prompt signals (T064)', () => {
  const line = (o: Record<string, unknown>): string => JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...o });

  it('emits submit from the UserPromptSubmit hook and keeps only the last 20 for ack-lookup', async () => {
    const h = harness({ 'pty-1': src(join(dir, 'none.jsonl')) });
    h.bridge.hook('pty-1', 'UserPromptSubmit', { prompt: 'ola mundo' });
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0]).toMatchObject({ ptyId: 'pty-1', signal: 'submit', text: 'ola mundo', origin: 'hook' });
    expect(typeof h.signals[0]!.at).toBe('string');
    expect(await h.hub.ackLookup('pty-1', 'ola mundo', '1969-01-01T00:00:00.000Z')).toEqual({ matched: true, via: 'UserPromptSubmit' });
    for (let i = 0; i < 25; i += 1) h.bridge.hook('pty-1', 'UserPromptSubmit', { prompt: `p${i}` });
    expect((await h.hub.ackLookup('pty-1', 'ola mundo', '1969-01-01T00:00:00.000Z')).matched).toBe(false);
    expect((await h.hub.ackLookup('pty-1', 'p24', '1969-01-01T00:00:00.000Z')).matched).toBe(true);
  });

  it('emits enqueue / deliver / command / unknown-command from appended transcript lines', async () => {
    const path = join(dir, 's1.jsonl');
    writeRounds(path, 1, 1);
    const h = harness({ 'pty-1': src(path) });
    await h.hub.attach('pty-1');
    appendFileSync(
      path,
      [
        JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-08T10:00:00.000Z', sessionId: 's1', content: 'depois' }),
        JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: '2026-10-08T10:00:05.000Z', sessionId: 's1' }),
        line({ type: 'attachment', uuid: uid(10), parentUuid: uid(2), attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'depois', humanTurn: true } }),
        line({ type: 'user', uuid: uid(11), parentUuid: uid(10), message: { role: 'user', content: '<command-name>/model</command-name><command-args>opus</command-args>' }, turnOrigin: 'human' }),
        line({ type: 'system', subtype: 'informational', uuid: uid(12), parentUuid: uid(11), content: 'Unknown command: /naoexiste', level: 'warning' }),
      ].join('\n') + '\n',
    );
    await pollUntil(() => h.signals.length >= 4);
    expect(h.signals.map((s) => s.signal)).toEqual(['enqueue', 'deliver', 'command', 'unknown-command']);
    expect(h.signals[2]!.text).toBe('/model opus');
    expect(h.signals.every((s) => s.origin === 'transcript')).toBe(true);
    // nothing is replayed for what was already in the file at attach time
    expect(h.signals.some((s) => s.text === 'prompt 1')).toBe(false);
  });

  it('answers ack-lookup from the transcript tail even when the tab was never attached', async () => {
    const path = join(dir, 's1.jsonl');
    writeFileSync(path, line({ type: 'user', uuid: uid(1), parentUuid: null, message: { role: 'user', content: 'fila' }, turnOrigin: 'human', timestamp: '2026-10-08T10:00:00.000Z' }) + '\n');
    const h = harness({ 'pty-1': src(path) });
    expect(await h.hub.ackLookup('pty-1', 'fila', '2026-10-08T09:00:00.000Z')).toEqual({ matched: true, via: 'submit' });
    expect((await h.hub.ackLookup('pty-1', 'fila', '2026-10-08T11:00:00.000Z')).matched).toBe(false);
    expect((await h.hub.ackLookup('pty-9', 'fila', '1969-01-01T00:00:00.000Z')).matched).toBe(false);
  });

  it('emits session-switch on a conversation switch and compact on SessionStart(compact)', async () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeRounds(a, 1, 1);
    writeRounds(b, 1, 1);
    const h = harness({ 'pty-1': src(a, 'sa') });
    await h.hub.attach('pty-1');
    h.bridge.emit({ type: 'conversation-switched', ptyId: 'pty-1', sessionId: 'sb', transcriptPath: b, source: 'clear' });
    await pollUntil(() => h.switched.length === 1);
    h.bridge.hook('pty-1', 'SessionStart', { source: 'compact' });
    expect(h.signals.map((s) => s.signal)).toEqual(['session-switch', 'compact']);
    expect((await h.hub.ackLookup('pty-1', '/clear', '1969-01-01T00:00:00.000Z')).via).toBe('session-switch');
  });
});

// ---------------------------------------------------------------------------
// T070 (main) - terminalNeeded, currentAction, activeSubagents
// ---------------------------------------------------------------------------

describe('live extras (T070 main)', () => {
  const lastLive = (h: Harness) => h.live[h.live.length - 1]!.live;

  it('lights terminalNeeded from a dialog Notification without an open pending, and clears on activity hooks', () => {
    const h = harness({ 'pty-1': src(join(dir, 'x.jsonl')) });
    h.bridge.hook('pty-1', 'SessionStart');
    h.bridge.hook('pty-1', 'Notification', { notification_type: 'idle_prompt' });
    expect(lastLive(h).terminalNeeded).toBeNull();
    h.bridge.hook('pty-1', 'Notification', { notification_type: 'permission_prompt' });
    expect(lastLive(h).terminalNeeded).toEqual({ reason: 'permission-dialog' });
    expect(lastLive(h).status).toBe('terminal-needed');
    h.bridge.hook('pty-1', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' }, tool_use_id: 't1' });
    expect(lastLive(h).terminalNeeded).toBeNull();
    h.bridge.hook('pty-1', 'Notification', { notification_type: 'elicitation_dialog' });
    expect(lastLive(h).terminalNeeded).toEqual({ reason: 'interactive-screen' });
    h.bridge.hook('pty-1', 'Stop');
    expect(lastLive(h).terminalNeeded).toBeNull();
  });

  it('does not light terminalNeeded while a pending is open', () => {
    const h = harness({ 'pty-1': src(join(dir, 'x.jsonl')) });
    const handle = { id: 'r1', ptyId: 'pty-1', respond: () => true, release: () => true };
    h.bridge.emit({ type: 'pending', ptyId: 'pty-1', handle, payload: {}, toolUseId: null });
    h.bridge.hook('pty-1', 'Notification', { notification_type: 'permission_prompt' });
    expect(h.live.some((e) => e.live.terminalNeeded !== null)).toBe(false);
    h.bridge.emit({ type: 'resolved-elsewhere', ptyId: 'pty-1', requestId: 'r1' });
    h.bridge.hook('pty-1', 'Notification', { notification_type: 'permission_prompt' });
    expect(lastLive(h).terminalNeeded).not.toBeNull();
  });

  it('combines the renderer screen reason with the hook one', () => {
    const h = harness({ 'pty-1': src(join(dir, 'x.jsonl')) });
    h.bridge.hook('pty-1', 'SessionStart');
    h.hub.reportScreenState('pty-1', 'interactive-screen');
    expect(lastLive(h).terminalNeeded).toEqual({ reason: 'interactive-screen' });
    h.bridge.hook('pty-1', 'Notification', { notification_type: 'permission_prompt' });
    expect(lastLive(h).terminalNeeded).toEqual({ reason: 'permission-dialog' }); // hook wins
    h.bridge.hook('pty-1', 'PostToolUse', { tool_name: 'Read', tool_use_id: 't1' });
    expect(lastLive(h).terminalNeeded).toEqual({ reason: 'interactive-screen' }); // screen source stays
    h.hub.reportScreenState('pty-1', null);
    expect(lastLive(h).terminalNeeded).toBeNull();
  });

  it('feeds currentAction from Pre/PostToolUse and activeSubagents from SubagentStart/Stop', () => {
    const h = harness({ 'pty-1': src(join(dir, 'x.jsonl')) });
    h.bridge.hook('pty-1', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' }, tool_use_id: 't1' });
    expect(lastLive(h).currentAction).toMatchObject({ toolUseId: 't1', tool: 'Read', scope: 'main' });
    expect(lastLive(h).currentAction!.summary.verb).toBeTruthy();
    h.bridge.hook('pty-1', 'PreToolUse', { tool_name: 'Grep', tool_input: {}, tool_use_id: 't2', agent_id: 'ag1' });
    expect(lastLive(h).currentAction!.toolUseId).toBe('t1'); // sub-agent tools are not the main action
    h.bridge.hook('pty-1', 'SubagentStart', { agent_id: 'ag1' });
    h.bridge.hook('pty-1', 'SubagentStart', { agent_id: 'ag2' });
    expect(lastLive(h).activeSubagents).toEqual(['ag1', 'ag2']);
    h.bridge.hook('pty-1', 'SubagentStop', { agent_id: 'ag1' });
    expect(lastLive(h).activeSubagents).toEqual(['ag2']);
    h.bridge.hook('pty-1', 'PostToolUse', { tool_name: 'Read', tool_use_id: 't1' });
    expect(lastLive(h).currentAction).toBeNull();
  });
});
