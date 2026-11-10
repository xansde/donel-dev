// T049 (014-chat) - the renderer's single chat store. The preload allows ONE
// subscriber per channel (preload/subscribeChannel.ts), so this store subscribes
// to each chat event once and fans it out by `ptyId`. Framework-free (React
// reads it through `useChatSession`); the IPC surface is injected, so it is
// tested with a fake `DonelChatApi`.
//
// Lifecycle per tab: the first subscriber for a `ptyId` attaches (first page
// from the end), the last one detaches. `chat:conversation-switched` wipes the
// timeline and attaches again. Events that arrive while the attach reply is
// still in flight are held and replayed after the snapshot; applying a patch is
// idempotent by row id, so a row that is both in the snapshot and in a replayed
// `append` is not duplicated.

import type { DonelChatApi } from '../../../shared/chat/api';
import type { SendFailureDetail } from '../../../shared/chat/sendDiagnostics';
import type {
  ChatConversationSwitchedEvent,
  ChatAckLookupOutput,
  ChatAnswerOutput,
  ChatLiveEvent,
  CommandEntry,
  ChatPromptSignalEvent,
  ChatReceptionEvent,
  ChatRowsEvent,
  ChatSnapshot,
  PendingAnswer,
  RowDetail,
  RowDetailPart,
  RowPatch,
} from '../../../shared/chat/ipc';
import { backgroundKey } from '../../../shared/chat/backgroundTasks';
import type {
  BackgroundTask,
  ChatPermissionMode,
  ChatReception,
  ConversationRow,
  ConversationSource,
  LiveState,
  RowScope,
  TerminalNeededReason,
} from '../../../shared/chat/rows';

export type ChatSessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ChatSessionState {
  readonly ptyId: string;
  readonly status: ChatSessionStatus;
  /** The grouped view (action groups are single rows), notices included. */
  readonly rows: readonly ConversationRow[];
  /** Cursor of the next older page; `null` = the start of the conversation is loaded. */
  readonly cursor: string | null;
  readonly loadingOlder: boolean;
  readonly live: LiveState | null;
  readonly reception: ChatReception;
  readonly permissionMode: ChatPermissionMode;
  readonly source: ConversationSource | null;
  readonly error: string | null;
  /** Bumped on every conversation switch (`/clear`, `/resume`, fork): lets the UI reset scroll. */
  readonly conversationVersion: number;
}

const idleState = (ptyId: string): ChatSessionState => ({
  ptyId,
  status: 'idle',
  rows: [],
  cursor: null,
  loadingOlder: false,
  live: null,
  reception: 'ok',
  permissionMode: 'default',
  source: null,
  error: null,
  conversationVersion: 0,
});

/** Notices that open a timeline stay on top: older history is inserted below them. */
const isTopNotice = (row: ConversationRow): boolean => row.id.startsWith('app:conversation-switch');

function insertOlder(rows: readonly ConversationRow[], older: readonly ConversationRow[]): ConversationRow[] {
  const have = new Set(rows.map((r) => r.id));
  const fresh = older.filter((r) => !have.has(r.id));
  if (fresh.length === 0) return [...rows];
  let top = 0;
  while (top < rows.length && isTopNotice(rows[top]!)) top += 1;
  return [...rows.slice(0, top), ...fresh, ...rows.slice(top)];
}

/** Pure and idempotent by row id (see the header). */
export function applyRowPatches(rows: readonly ConversationRow[], patches: readonly RowPatch[]): ConversationRow[] {
  let out: ConversationRow[] = [...rows];
  for (const p of patches) {
    if (p.op === 'reset') {
      out = [...p.rows];
    } else if (p.op === 'prepend') {
      out = insertOlder(out, p.rows);
    } else if (p.op === 'append') {
      const index = new Map(out.map((r, i) => [r.id, i]));
      for (const r of p.rows) {
        const at = index.get(r.id);
        if (at === undefined) {
          index.set(r.id, out.length);
          out.push(r);
        } else {
          out[at] = r;
        }
      }
    } else {
      const byId = new Map(p.rows.map((r) => [r.id, r]));
      out = out.map((r) => byId.get(r.id) ?? r);
    }
  }
  return out;
}

type Listener = () => void;
type Held = { kind: 'rows'; event: ChatRowsEvent } | { kind: 'live'; event: ChatLiveEvent } | { kind: 'reception'; event: ChatReceptionEvent };

interface Entry {
  state: ChatSessionState;
  readonly listeners: Set<Listener>;
  /** Bumped whenever a reply in flight became stale (switch / detach). */
  attachGen: number;
  attaching: boolean;
  held: Held[];
  /** `backgroundKey` of the last background list published to `getBackground()`. */
  bgKey: string;
}

/** Segundo plano visível — background tasks of every attached tab, by `ptyId` (a new object on every change). */
export type BackgroundByPty = Readonly<Record<string, readonly BackgroundTask[]>>;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class ChatStore {
  private readonly entries = new Map<string, Entry>();
  private unsubscribers: (() => void)[] = [];
  /** T064: prompt-signal listeners by tab; they are not tied to the timeline attach. */
  private readonly signalListeners = new Map<string, Set<(event: ChatPromptSignalEvent) => void>>();
  private readonly bgListeners = new Set<Listener>();
  private bgSnapshot: BackgroundByPty = {};

  constructor(private readonly api: DonelChatApi) {}

  // ---- subscription (useSyncExternalStore shape) ---------------------------

  getState(ptyId: string): ChatSessionState {
    return this.entries.get(ptyId)?.state ?? idleState(ptyId);
  }

  /** The first subscriber of a tab attaches; the last one to leave detaches. */
  subscribe(ptyId: string, listener: Listener): () => void {
    let entry = this.entries.get(ptyId);
    if (entry === undefined) {
      entry = { state: idleState(ptyId), listeners: new Set(), attachGen: 0, attaching: false, held: [], bgKey: '' };
      this.entries.set(ptyId, entry);
    }
    entry.listeners.add(listener);
    this.ensureChannels();
    if (entry.state.status === 'idle') void this.attach(ptyId, entry);
    return () => this.unsubscribe(ptyId, listener);
  }

  private unsubscribe(ptyId: string, listener: Listener): void {
    const entry = this.entries.get(ptyId);
    if (entry === undefined) return;
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0) return;
    entry.attachGen += 1;
    this.entries.delete(ptyId);
    this.publishBackground(ptyId, null);
    void Promise.resolve(this.api.detach(ptyId)).catch(() => undefined);
    if (this.entries.size === 0 && this.signalListeners.size === 0) this.dropChannels();
  }

  // ---- segundo plano visível: every tab's background tasks, for the tab bar and the status bar ----

  /** `useSyncExternalStore` shape; the snapshot is a new object only when some tab's list changed. */
  subscribeBackground(listener: Listener): () => void {
    this.bgListeners.add(listener);
    return () => this.bgListeners.delete(listener);
  }

  getBackground(): BackgroundByPty {
    return this.bgSnapshot;
  }

  private publishBackground(ptyId: string, tasks: readonly BackgroundTask[] | null): void {
    const has = ptyId in this.bgSnapshot;
    if (tasks === null || tasks.length === 0) {
      if (!has) return;
      const next = { ...this.bgSnapshot };
      delete next[ptyId];
      this.bgSnapshot = next;
    } else {
      this.bgSnapshot = { ...this.bgSnapshot, [ptyId]: tasks };
    }
    for (const l of [...this.bgListeners]) l();
  }

  dispose(): void {
    for (const ptyId of [...this.entries.keys()]) {
      const entry = this.entries.get(ptyId);
      if (entry !== undefined) entry.attachGen += 1;
      this.entries.delete(ptyId);
      void Promise.resolve(this.api.detach(ptyId)).catch(() => undefined);
    }
    this.signalListeners.clear();
    this.dropChannels();
  }

  // ---- T064/T070: send acceptance signals and screen state -------------------

  /** Acceptance signals of one tab (contracts/send-protocol.md §5). Returns the unsubscribe function. */
  onPromptSignal(ptyId: string, listener: (event: ChatPromptSignalEvent) => void): () => void {
    let set = this.signalListeners.get(ptyId);
    if (set === undefined) {
      set = new Set();
      this.signalListeners.set(ptyId, set);
    }
    set.add(listener);
    this.ensureChannels();
    return () => {
      const current = this.signalListeners.get(ptyId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.signalListeners.delete(ptyId);
      if (this.entries.size === 0 && this.signalListeners.size === 0) this.dropChannels();
    };
  }

  /** Late acceptance lookup (contracts/send-protocol.md §7). */
  ackLookup(ptyId: string, text: string, since: string): Promise<ChatAckLookupOutput> {
    return this.api.ackLookup(ptyId, text, since);
  }

  /** T076 - answers an open pending; the main builds the hook decision (the renderer never does). */
  answer(ptyId: string, pendingId: string, answer: PendingAnswer): Promise<ChatAnswerOutput> {
    return Promise.resolve(this.api.answer(ptyId, pendingId, answer)).catch((): ChatAnswerOutput => ({ ok: false, reason: 'unknown' }));
  }

  /** T079 - active tab and tab names for the notification rule (the main reads the window focus itself). */
  reportFocusState(activePtyId: string | null, tabNames?: Readonly<Record<string, string>>): void {
    void Promise.resolve(this.api.focusState(activePtyId, tabNames)).catch(() => undefined);
  }

  /** T088 - saves a pasted/dropped image through the main (which validates it) and returns its absolute path. */
  saveImage(ptyId: string, bytes: ArrayBuffer, mediaType: string): Promise<{ readonly id: string; readonly path: string }> {
    return this.api.saveImage(ptyId, bytes, mediaType);
  }

  /** T087 - entries of the `/` menu (the main caches by folder). Empty when the call fails: the menu just stays closed. */
  catalog(ptyId: string): Promise<readonly CommandEntry[]> {
    return Promise.resolve(this.api.catalog(ptyId)).catch((): readonly CommandEntry[] => []);
  }

  /** T087 - project files for the `@` menu, relative to the tab's cwd, already ranked. */
  files(ptyId: string, query: string, limit: number): Promise<readonly string[]> {
    return Promise.resolve(this.api.files(ptyId, query, limit)).catch((): readonly string[] => []);
  }

  /** T088 - disk path of a `File` from the picker or a drop (`''` when it has none). */
  pathForFile(file: unknown): string {
    return this.api.pathForFile(file);
  }

  /** A send ended in "não foi": its gate detail goes to the main's `chat-diagnostics.log` (fire and forget). */
  reportSendFailure(ptyId: string, detail: SendFailureDetail): void {
    void Promise.resolve(this.api.sendFailed(ptyId, detail)).catch(() => undefined);
  }

  /** 08/11 — the app erased text from the terminal box (Esc Esc): the main keeps it for the owner (fire and forget). */
  reportBoxCleared(ptyId: string, text: string): void {
    void Promise.resolve(this.api.boxCleared?.(ptyId, text)).catch(() => undefined);
  }

  /** The renderer's screen detectors report what needs the terminal (`null` = the input box is back). */
  reportScreenState(ptyId: string, terminalNeeded: TerminalNeededReason | null): void {
    void Promise.resolve(this.api.screenState(ptyId, terminalNeeded)).catch(() => undefined);
  }

  private onPromptSignal_(event: ChatPromptSignalEvent): void {
    for (const listener of [...(this.signalListeners.get(event.ptyId) ?? [])]) {
      try {
        listener(event);
      } catch {
        // a faulty listener must not break the others
      }
    }
  }

  // ---- channels: ONE subscription per event, distributed by ptyId ----------

  private ensureChannels(): void {
    if (this.unsubscribers.length > 0) return;
    this.unsubscribers = [
      this.api.onRows((event) => this.onRows(event)),
      this.api.onLive((event) => this.onLive(event)),
      this.api.onReception((event) => this.onReception(event)),
      this.api.onConversationSwitched((event) => this.onSwitched(event)),
      this.api.onPromptSignal((event) => this.onPromptSignal_(event)),
    ];
  }

  private dropChannels(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  private onRows(event: ChatRowsEvent): void {
    const entry = this.entries.get(event.ptyId);
    if (entry === undefined || event.scope !== 'main') return;
    if (entry.attaching) {
      entry.held.push({ kind: 'rows', event });
      return;
    }
    this.applyRows(entry, event);
  }

  private onLive(event: ChatLiveEvent): void {
    const entry = this.entries.get(event.ptyId);
    if (entry === undefined) return;
    if (entry.attaching) {
      entry.held.push({ kind: 'live', event });
      return;
    }
    this.set(entry, { live: event.live });
  }

  private onReception(event: ChatReceptionEvent): void {
    const entry = this.entries.get(event.ptyId);
    if (entry === undefined) return;
    if (entry.attaching) {
      entry.held.push({ kind: 'reception', event });
      return;
    }
    this.set(entry, { reception: event.reception });
  }

  private onSwitched(event: ChatConversationSwitchedEvent): void {
    const entry = this.entries.get(event.ptyId);
    if (entry === undefined) return;
    entry.attachGen += 1; // any reply in flight belongs to the old conversation
    entry.held = [];
    const version = entry.state.conversationVersion + 1;
    entry.state = { ...idleState(event.ptyId), status: 'loading', conversationVersion: version };
    this.emit(entry);
    void this.attach(event.ptyId, entry);
  }

  // ---- attach ---------------------------------------------------------------

  private async attach(ptyId: string, entry: Entry): Promise<void> {
    const gen = ++entry.attachGen;
    entry.attaching = true;
    entry.held = [];
    if (entry.state.status !== 'loading') this.set(entry, { status: 'loading', error: null });
    let snapshot: ChatSnapshot;
    try {
      snapshot = await this.api.attach(ptyId);
    } catch (err) {
      if (gen !== entry.attachGen) return;
      entry.attaching = false;
      entry.held = [];
      this.set(entry, { status: 'error', error: messageOf(err) });
      return;
    }
    if (gen !== entry.attachGen) return; // switched / detached meanwhile
    entry.attaching = false;
    entry.state = {
      ...entry.state,
      status: 'ready',
      rows: [...snapshot.rows],
      cursor: snapshot.cursor,
      live: snapshot.live,
      reception: snapshot.reception,
      permissionMode: snapshot.permissionMode,
      source: snapshot.source,
      loadingOlder: false,
      error: null,
    };
    const held = entry.held;
    entry.held = [];
    for (const h of held) {
      if (h.kind === 'rows') entry.state = { ...entry.state, rows: applyRowPatches(entry.state.rows, h.event.patches) };
      else if (h.kind === 'live') entry.state = { ...entry.state, live: h.event.live };
      else entry.state = { ...entry.state, reception: h.event.reception };
    }
    this.emit(entry);
  }

  // ---- actions --------------------------------------------------------------

  /** Loads the next older page and prepends it. No-op while loading or at the start. */
  async loadOlder(ptyId: string): Promise<void> {
    const entry = this.entries.get(ptyId);
    if (entry === undefined) return;
    const { cursor, loadingOlder, status } = entry.state;
    if (status !== 'ready' || cursor === null || loadingOlder) return;
    const gen = entry.attachGen;
    this.set(entry, { loadingOlder: true });
    try {
      const page = await this.api.loadOlder(ptyId, 'main', cursor);
      if (gen !== entry.attachGen) return;
      this.set(entry, { rows: insertOlder(entry.state.rows, page.rows), cursor: page.cursor, loadingOlder: false });
    } catch (err) {
      if (gen !== entry.attachGen) return;
      this.set(entry, { loadingOlder: false, error: messageOf(err) });
    }
  }

  /** Heavy part of a row (tool output, diff, files, raw line). Re-read from disk by the main. */
  rowDetail(ptyId: string, rowId: string, part: RowDetailPart, scope: RowScope = 'main'): Promise<RowDetail> {
    return this.api.rowDetail({ ptyId, scope, rowId, part });
  }

  /** The actions folded inside an `action-group` row (they never travel in patches). */
  async groupChildren(ptyId: string, groupId: string): Promise<readonly ConversationRow[]> {
    const detail = await this.api.rowDetail({ ptyId, scope: 'main', rowId: groupId, part: 'content' });
    return detail.rows ?? [];
  }

  openExternal(url: string): Promise<void> {
    return this.api.openExternal(url);
  }

  openGenerated(ptyId: string, path: string): Promise<void> {
    return this.api.openGenerated(ptyId, path);
  }

  // ---- internals ------------------------------------------------------------

  private applyRows(entry: Entry, event: ChatRowsEvent): void {
    if (entry.state.status !== 'ready') return;
    this.set(entry, { rows: applyRowPatches(entry.state.rows, event.patches) });
  }

  private set(entry: Entry, patch: Partial<ChatSessionState>): void {
    entry.state = { ...entry.state, ...patch };
    this.emit(entry);
  }

  private emit(entry: Entry): void {
    const tasks = entry.state.live?.background ?? [];
    const key = backgroundKey(tasks);
    if (key !== entry.bgKey) {
      entry.bgKey = key;
      this.publishBackground(entry.state.ptyId, tasks);
    }
    for (const l of [...entry.listeners]) l();
  }
}

let shared: ChatStore | null = null;

/** The app-wide store over `window.donel.chat`. */
export function getChatStore(): ChatStore {
  if (shared === null) shared = new ChatStore(window.donel.chat);
  return shared;
}
