// T049 (014-chat) - ChatStore: one subscription per channel, fan-out by ptyId,
// attach/detach lifecycle, idempotent patches, conversation switch.
import { describe, expect, it } from 'vitest';
import type { DonelChatApi } from '../src/shared/chat/api';
import type {
  ChatConversationSwitchedEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatPromptSignalEvent,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatSnapshot,
  RowDetail,
} from '../src/shared/chat/ipc';
import type { ConversationRow, LiveState, RowScope } from '../src/shared/chat/rows';
import { applyRowPatches, ChatStore } from '../src/renderer/src/chat/ChatStore';

const row = (id: string, text = id): ConversationRow => ({ id, kind: 'user', text, attachments: [], turnId: null, at: '', scope: 'main' });
const notice = (id: string): ConversationRow => ({ id, kind: 'notice', notice: 'conversation-switch', params: {}, turnId: null, at: '', scope: 'main' });
const live = (status: LiveState['status']): LiveState => ({ status, currentAction: null, pendings: [], sends: [], activeSubagents: [], terminalNeeded: null });
const snap = (rows: ConversationRow[], cursor: string | null = null): ChatSnapshot => ({
  source: { sessionId: 's', transcriptPath: 'p', cwd: 'c', forward: { offset: 0, partial: '' }, backward: { offset: 0, done: true }, leafUuid: null, expectedParent: null },
  rows,
  cursor,
  live: live('idle'),
  permissionMode: 'default',
  reception: 'ok',
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class FakeApi implements DonelChatApi {
  subs = { rows: 0, live: 0, switched: 0, reception: 0, signal: 0 };
  ackCalls: { ptyId: string; text: string; since: string }[] = [];
  screenCalls: { ptyId: string; reason: string | null }[] = [];
  attached: string[] = [];
  detached: string[] = [];
  attachReplies: Promise<ChatSnapshot>[] = [];
  olderCalls: { ptyId: string; scope: RowScope; cursor: string }[] = [];
  olderReply: Promise<ChatLoadOlderOutput> = Promise.resolve({ rows: [], cursor: null });
  detail: RowDetail = { part: 'content', text: '', truncated: false };
  private rowsL: ((e: ChatRowsEvent) => void)[] = [];
  private liveL: ((e: ChatLiveEvent) => void)[] = [];
  private switchedL: ((e: ChatConversationSwitchedEvent) => void)[] = [];
  private receptionL: ((e: ChatReceptionEvent) => void)[] = [];
  private signalL: ((e: ChatPromptSignalEvent) => void)[] = [];

  attach(ptyId: string): Promise<ChatSnapshot> {
    this.attached.push(ptyId);
    return this.attachReplies.shift() ?? Promise.resolve(snap([]));
  }
  detach(ptyId: string): Promise<void> {
    this.detached.push(ptyId);
    return Promise.resolve();
  }
  loadOlder(ptyId: string, scope: RowScope, cursor: string): Promise<ChatLoadOlderOutput> {
    this.olderCalls.push({ ptyId, scope, cursor });
    return this.olderReply;
  }
  rowDetail(_input: ChatRowDetailInput): Promise<RowDetail> {
    return Promise.resolve(this.detail);
  }
  openExternal(): Promise<void> {
    return Promise.resolve();
  }
  openGenerated(): Promise<void> {
    return Promise.resolve();
  }
  onRows(l: (e: ChatRowsEvent) => void): () => void {
    this.subs.rows += 1;
    this.rowsL.push(l);
    return () => void (this.subs.rows -= 1);
  }
  onLive(l: (e: ChatLiveEvent) => void): () => void {
    this.subs.live += 1;
    this.liveL.push(l);
    return () => void (this.subs.live -= 1);
  }
  onConversationSwitched(l: (e: ChatConversationSwitchedEvent) => void): () => void {
    this.subs.switched += 1;
    this.switchedL.push(l);
    return () => void (this.subs.switched -= 1);
  }
  onReception(l: (e: ChatReceptionEvent) => void): () => void {
    this.subs.reception += 1;
    this.receptionL.push(l);
    return () => void (this.subs.reception -= 1);
  }
  ackLookup(ptyId: string, text: string, since: string): Promise<{ matched: boolean }> {
    this.ackCalls.push({ ptyId, text, since });
    return Promise.resolve({ matched: true });
  }
  saveImage(): Promise<{ id: string; path: string }> {
    return Promise.resolve({ id: 'img.png', path: 'C:/ud/chat-attachments/s/img.png' });
  }
  pathForFile(): string {
    return '';
  }
  screenState(ptyId: string, reason: string | null): Promise<void> {
    this.screenCalls.push({ ptyId, reason });
    return Promise.resolve();
  }
  onPromptSignal(l: (e: ChatPromptSignalEvent) => void): () => void {
    this.subs.signal += 1;
    this.signalL.push(l);
    return () => void (this.subs.signal -= 1);
  }
  emitSignal(e: ChatPromptSignalEvent): void {
    this.signalL.forEach((l) => l(e));
  }
  emitRows(e: ChatRowsEvent): void {
    this.rowsL.forEach((l) => l(e));
  }
  emitLive(e: ChatLiveEvent): void {
    this.liveL.forEach((l) => l(e));
  }
  emitSwitched(e: ChatConversationSwitchedEvent): void {
    this.switchedL.forEach((l) => l(e));
  }
  emitReception(e: ChatReceptionEvent): void {
    this.receptionL.forEach((l) => l(e));
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('applyRowPatches', () => {
  it('handles append / replace / prepend / reset, idempotent by id', () => {
    let rows = applyRowPatches([], [{ op: 'append', rows: [row('a'), row('b')] }]);
    rows = applyRowPatches(rows, [{ op: 'append', rows: [row('b', 'B2'), row('c')] }]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toMatchObject({ text: 'B2' });
    rows = applyRowPatches(rows, [{ op: 'replace', rows: [row('a', 'A2')] }]);
    expect(rows[0]).toMatchObject({ text: 'A2' });
    rows = applyRowPatches(rows, [{ op: 'prepend', rows: [row('z'), row('a')] }]);
    expect(rows.map((r) => r.id)).toEqual(['z', 'a', 'b', 'c']);
    rows = applyRowPatches(rows, [{ op: 'reset', rows: [row('only')] }]);
    expect(rows.map((r) => r.id)).toEqual(['only']);
  });

  it('keeps the conversation-switch notice on top when older rows are prepended', () => {
    const rows = applyRowPatches([notice('app:conversation-switch:s2'), row('b')], [{ op: 'prepend', rows: [row('a')] }]);
    expect(rows.map((r) => r.id)).toEqual(['app:conversation-switch:s2', 'a', 'b']);
  });
});

describe('ChatStore', () => {
  it('subscribes to each event channel once, however many tabs are open', () => {
    const api = new FakeApi();
    const store = new ChatStore(api);
    const off1 = store.subscribe('p1', () => undefined);
    const off2 = store.subscribe('p2', () => undefined);
    const off3 = store.subscribe('p1', () => undefined);
    expect(api.subs).toEqual({ rows: 1, live: 1, switched: 1, reception: 1, signal: 1 });
    off1();
    off2();
    off3();
    expect(api.subs).toEqual({ rows: 0, live: 0, switched: 0, reception: 0, signal: 0 });
  });

  it('fans prompt signals out by ptyId with a single channel subscription', () => {
    const api = new FakeApi();
    const store = new ChatStore(api);
    const got1: string[] = [];
    const got2: string[] = [];
    const off1 = store.onPromptSignal('p1', (e) => got1.push(e.signal));
    const off2 = store.onPromptSignal('p2', (e) => got2.push(e.signal));
    expect(api.subs.signal).toBe(1);
    api.emitSignal({ ptyId: 'p1', signal: 'submit', text: 'a', at: 'x' });
    api.emitSignal({ ptyId: 'p2', signal: 'enqueue', at: 'x' });
    api.emitSignal({ ptyId: 'p3', signal: 'deliver', at: 'x' });
    expect(got1).toEqual(['submit']);
    expect(got2).toEqual(['enqueue']);
    off1();
    api.emitSignal({ ptyId: 'p1', signal: 'submit', at: 'x' });
    expect(got1).toEqual(['submit']);
    expect(api.subs.signal).toBe(1);
    off2();
    expect(api.subs.signal).toBe(0);
  });

  it('passes ack-lookup and screen-state through to the api', async () => {
    const api = new FakeApi();
    const store = new ChatStore(api);
    expect(await store.ackLookup('p1', 'oi', 'since')).toEqual({ matched: true });
    store.reportScreenState('p1', 'interactive-screen');
    expect(api.ackCalls).toEqual([{ ptyId: 'p1', text: 'oi', since: 'since' }]);
    expect(api.screenCalls).toEqual([{ ptyId: 'p1', reason: 'interactive-screen' }]);
  });

  it('attaches on the first subscriber, detaches on the last, and exposes the snapshot', async () => {
    const api = new FakeApi();
    api.attachReplies.push(Promise.resolve(snap([row('a')], 'cur')));
    const store = new ChatStore(api);
    expect(store.getState('p1').status).toBe('idle');
    const off1 = store.subscribe('p1', () => undefined);
    const off2 = store.subscribe('p1', () => undefined);
    expect(store.getState('p1').status).toBe('loading');
    await tick();
    expect(api.attached).toEqual(['p1']);
    const s = store.getState('p1');
    expect(s.status).toBe('ready');
    expect(s.rows.map((r) => r.id)).toEqual(['a']);
    expect(s.cursor).toBe('cur');
    expect(s.live?.status).toBe('idle');
    off1();
    expect(api.detached).toEqual([]);
    off2();
    expect(api.detached).toEqual(['p1']);
    expect(store.getState('p1').status).toBe('idle');
  });

  it('distributes events by ptyId and keeps the state reference stable when nothing changed', async () => {
    const api = new FakeApi();
    const store = new ChatStore(api);
    let changes = 0;
    store.subscribe('p1', () => (changes += 1));
    store.subscribe('p2', () => undefined);
    await tick();
    const before2 = store.getState('p2');
    api.emitRows({ ptyId: 'p1', scope: 'main', patches: [{ op: 'append', rows: [row('x')] }] });
    api.emitLive({ ptyId: 'p1', live: live('working') });
    api.emitReception({ ptyId: 'p1', reception: 'stale' });
    expect(store.getState('p1').rows.map((r) => r.id)).toEqual(['x']);
    expect(store.getState('p1').live?.status).toBe('working');
    expect(store.getState('p1').reception).toBe('stale');
    expect(store.getState('p2')).toBe(before2);
    expect(store.getState('p1')).toBe(store.getState('p1'));
    expect(changes).toBeGreaterThan(0);
    api.emitRows({ ptyId: 'unknown', scope: 'main', patches: [{ op: 'append', rows: [row('y')] }] }); // ignored
  });

  it('replays events that arrived before the attach reply without duplicating rows', async () => {
    const api = new FakeApi();
    const reply = deferred<ChatSnapshot>();
    api.attachReplies.push(reply.promise);
    const store = new ChatStore(api);
    store.subscribe('p1', () => undefined);
    api.emitRows({ ptyId: 'p1', scope: 'main', patches: [{ op: 'append', rows: [row('b'), row('c')] }] });
    api.emitLive({ ptyId: 'p1', live: live('working') });
    reply.resolve(snap([row('a'), row('b')]));
    await tick();
    const s = store.getState('p1');
    expect(s.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(s.live?.status).toBe('working');
  });

  it('wipes the timeline on a conversation switch, attaches again and drops the stale reply', async () => {
    const api = new FakeApi();
    const oldReply = deferred<ChatSnapshot>();
    api.attachReplies.push(oldReply.promise, Promise.resolve(snap([notice('app:conversation-switch:s2')])));
    const store = new ChatStore(api);
    store.subscribe('p1', () => undefined);
    api.emitSwitched({ ptyId: 'p1', sessionId: 's2', reason: 'clear' });
    expect(store.getState('p1').rows).toEqual([]);
    expect(store.getState('p1').conversationVersion).toBe(1);
    await tick();
    oldReply.resolve(snap([row('old')])); // late reply of the previous conversation
    await tick();
    expect(api.attached).toEqual(['p1', 'p1']);
    expect(store.getState('p1').rows.map((r) => r.id)).toEqual(['app:conversation-switch:s2']);
  });

  it('loads older pages once at a time and prepends them', async () => {
    const api = new FakeApi();
    api.attachReplies.push(Promise.resolve(snap([row('c')], '100')));
    const older = deferred<ChatLoadOlderOutput>();
    api.olderReply = older.promise;
    const store = new ChatStore(api);
    store.subscribe('p1', () => undefined);
    await tick();
    const first = store.loadOlder('p1');
    void store.loadOlder('p1'); // ignored: already loading
    expect(store.getState('p1').loadingOlder).toBe(true);
    older.resolve({ rows: [row('a'), row('b')], cursor: null });
    await first;
    expect(api.olderCalls).toEqual([{ ptyId: 'p1', scope: 'main', cursor: '100' }]);
    const s = store.getState('p1');
    expect(s.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(s.cursor).toBeNull();
    expect(s.loadingOlder).toBe(false);
    await store.loadOlder('p1'); // start reached: no call
    expect(api.olderCalls).toHaveLength(1);
  });

  it('reports an attach failure (chat disabled: no handler) as an error state', async () => {
    const api = new FakeApi();
    api.attach = () => Promise.reject(new Error('No handler registered for chat:attach'));
    const store = new ChatStore(api);
    store.subscribe('p1', () => undefined);
    await tick();
    expect(store.getState('p1')).toMatchObject({ status: 'error', error: 'No handler registered for chat:attach' });
  });

  it('returns the folded children of an action group', async () => {
    const api = new FakeApi();
    api.detail = { part: 'content', text: '', truncated: false, rows: [row('child')] };
    const store = new ChatStore(api);
    expect((await store.groupChildren('p1', 'group:x')).map((r) => r.id)).toEqual(['child']);
  });
});
