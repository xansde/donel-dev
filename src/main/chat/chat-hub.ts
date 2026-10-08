// T048 (014-chat) - the chat hub: per tab (`ptyId`), the conversation source
// (the tab's transcript_path, re-pointed on `/clear`/`/resume`/fork), the
// backward pager, the forward follower, the adapter (T029) and a basic
// LiveState fed by the hook bridge. It owns no Electron API: events leave
// through the injected `ChatHubEvents` and everything else is injected too, so
// it is tested with a fake bridge and real temp transcripts (T047).
//
// Row patches are about the GROUPED view (`viewOf`). The children of an
// `action-group` never travel in patches: the renderer asks for them with
// `chat:row-detail` (part `content` on the group id -> `RowDetail.rows`).

import { dirname } from 'node:path';
import { adapt, expandGroup, initAdapterState, viewOf, type AdapterState } from '../../shared/chat/adapter';
import type {
  ChatConversationSwitchedEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatSnapshot,
  ConversationSwitchReason,
  RowDetail,
  RowPatch,
} from '../../shared/chat/ipc';
import type {
  ChatPermissionMode,
  ChatReception,
  ConversationRow,
  ConversationSource,
  LiveState,
  LiveStatus,
  NoticeRow,
  RowScope,
  TranscriptEntry,
} from '../../shared/chat/rows';
import { classifyLine } from '../../shared/chat/transcriptEntry';
import type { BridgeEvent } from '../hook-bridge';
import { buildRowDetail } from './row-detail';
import { TranscriptFollower, type FollowBatch, type FollowedLine } from './transcript-follower';
import { readLineRef, readPageBackward, type PagedLine } from './transcript-pager';

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

export interface ChatSourceInfo {
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly cwd: string;
}

export interface ChatHubEvents {
  rows(event: ChatRowsEvent): void;
  live(event: ChatLiveEvent): void;
  conversationSwitched(event: ChatConversationSwitchedEvent): void;
  reception(event: ChatReceptionEvent): void;
}

export interface ChatHubDeps {
  readonly bridge: { onAny(listener: (event: BridgeEvent) => void): () => void };
  /** Where a tab's conversation lives when the hub first hears of it. `null` = not a chat tab. */
  getSource(ptyId: string): ChatSourceInfo | null;
  readonly events: ChatHubEvents;
  readonly diagnostics?: { unknownEntry(entry: { ptyId: string; entryType: string }): void };
  readonly now?: () => number;
  /** Activity without a transcript file for this long -> `missing`. Default 10 s. */
  readonly missingMs?: number;
  /** Activity without the file growing for this long -> `stale`. Default 8 s. */
  readonly staleMs?: number;
  /** Interval of the reception check; 0 = off (tests call `checkReception`). Default 2 s. */
  readonly receptionPollMs?: number;
  /** Folder of `chat:save-image` attachments; allowed for `chat:open-generated`. */
  readonly attachmentsRoot?: string;
  readonly follower?: { readonly debounceMs?: number; readonly pollMs?: number; readonly retryMs?: number };
}

export interface ChatHub {
  attach(ptyId: string): Promise<ChatSnapshot>;
  detach(ptyId: string): void;
  loadOlder(ptyId: string, scope: RowScope, cursor: string): Promise<ChatLoadOlderOutput>;
  rowDetail(input: ChatRowDetailInput): Promise<RowDetail>;
  /** `accounts:changed` -> an `account-switch` notice at the end of every open timeline. */
  notifyAccountSwitch(label: string): void;
  /** The PTY exited. */
  markEnded(ptyId: string): void;
  /** Extra "the PTY is doing something" signal (hooks already count). */
  noteActivity(ptyId: string): void;
  checkReception(): void;
  /** Folders the tab's transcript files (and sub-agent files) may be served from. */
  transcriptRoots(ptyId: string): readonly string[];
  /** Folders `chat:open-generated` may open from: the tab's `cwd` and the attachments folder. */
  generatedFileRoots(ptyId: string): readonly string[];
  dispose(): void;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

const ACTIVITY_EVENTS: ReadonlySet<string> = new Set(['UserPromptSubmit', 'PostToolUse', 'Stop']);
const WORKING_EVENTS: ReadonlySet<string> = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'PreCompact']);
const IDLE_EVENTS: ReadonlySet<string> = new Set(['Stop', 'StopFailure', 'SessionStart']);
const PERMISSION_MODES: ReadonlySet<string> = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto']);

type BaseStatus = 'starting' | 'idle' | 'working' | 'ended';

interface Session {
  /** Bumped on every re-point / detach: late batches of an old follower are dropped. */
  gen: number;
  state: AdapterState;
  follower: TranscriptFollower;
  /** Start offset of the oldest loaded page; `null` = start of the conversation loaded. */
  olderOffset: number | null;
  /** Serialises `load-older` so two calls never read the same page. */
  olderQueue: Promise<unknown>;
}

interface Rec {
  readonly ptyId: string;
  source: ChatSourceInfo | null;
  base: BaseStatus;
  reception: ChatReception;
  lastLiveKey: string;
  lastActivityAt: number;
  lastGrowthAt: number;
  fileSeen: boolean;
  session: Session | null;
  /** `conversation-switch` notice that opens the timeline after a switch. */
  topNotice: NoticeRow | null;
  /** App-born notices (`account-switch`): memory only, always at the end. */
  appNotices: NoticeRow[];
  /** Serialises attach / switch / detach for this tab. */
  chain: Promise<unknown>;
}

function toEntries(lines: readonly (FollowedLine | PagedLine)[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const l of lines) {
    if (l.tooLarge === true) {
      out.push({ k: 'invalid', reason: 'too-large', raw: l.ref });
      continue;
    }
    const entry = classifyLine(l.text, l.ref);
    if (entry !== null) out.push(entry);
  }
  return out;
}

const emptySource = (): ConversationSource => ({
  sessionId: '',
  transcriptPath: '',
  cwd: '',
  forward: { offset: 0, partial: '' },
  backward: { offset: 0, done: true },
  leafUuid: null,
  expectedParent: null,
});

export function createChatHub(deps: ChatHubDeps): ChatHub {
  const now = deps.now ?? Date.now;
  const missingMs = deps.missingMs ?? 10_000;
  const staleMs = deps.staleMs ?? 8_000;
  const recs = new Map<string, Rec>();
  let noticeSeq = 0;

  // ---- records -------------------------------------------------------------

  function recOf(ptyId: string): Rec {
    let rec = recs.get(ptyId);
    if (rec === undefined) {
      rec = {
        ptyId,
        source: null,
        base: 'starting',
        reception: 'ok',
        lastLiveKey: '',
        lastActivityAt: 0,
        lastGrowthAt: 0,
        fileSeen: false,
        session: null,
        topNotice: null,
        appNotices: [],
        chain: Promise.resolve(),
      };
      recs.set(ptyId, rec);
    }
    return rec;
  }

  const serial = <T>(rec: Rec, job: () => Promise<T>): Promise<T> => {
    const run = rec.chain.then(job, job);
    rec.chain = run.catch(() => undefined);
    return run;
  };

  function sourceOf(rec: Rec): ChatSourceInfo | null {
    if (rec.source === null) rec.source = deps.getSource(rec.ptyId);
    return rec.source;
  }

  // ---- live state ----------------------------------------------------------

  function liveOf(rec: Rec): LiveState {
    const status: LiveStatus = rec.base === 'ended' ? 'ended' : rec.reception !== 'ok' ? 'not-receiving' : rec.base;
    return { status, currentAction: null, pendings: [], sends: [], activeSubagents: [], terminalNeeded: null };
  }

  function emitLiveIfChanged(rec: Rec): void {
    const live = liveOf(rec);
    const key = live.status;
    if (key === rec.lastLiveKey) return;
    rec.lastLiveKey = key;
    deps.events.live({ ptyId: rec.ptyId, live });
  }

  function setBase(rec: Rec, base: BaseStatus): void {
    if (rec.base === 'ended' || rec.base === base) return;
    rec.base = base;
    emitLiveIfChanged(rec);
  }

  // ---- reception -----------------------------------------------------------

  function setReception(rec: Rec, reception: ChatReception): void {
    if (rec.reception === reception) return;
    rec.reception = reception;
    deps.events.reception({ ptyId: rec.ptyId, reception });
    emitLiveIfChanged(rec);
  }

  function checkRec(rec: Rec): void {
    if (rec.session === null || rec.base === 'ended') return;
    if (rec.lastActivityAt <= rec.lastGrowthAt) return; // nothing is waiting on the file
    const idle = now() - rec.lastActivityAt;
    if (!rec.fileSeen && idle >= missingMs) setReception(rec, 'missing');
    else if (rec.fileSeen && idle >= staleMs) setReception(rec, 'stale');
  }

  function checkReception(): void {
    for (const rec of recs.values()) checkRec(rec);
  }

  // ---- rows ----------------------------------------------------------------

  function withNotices(rec: Rec, rows: readonly ConversationRow[]): ConversationRow[] {
    return [...(rec.topNotice !== null ? [rec.topNotice] : []), ...rows, ...rec.appNotices];
  }

  /** `reset` patches carry the whole view: the app-born notices must ride along. */
  function decoratePatches(rec: Rec, patches: readonly RowPatch[]): RowPatch[] {
    return patches.map((p) => (p.op === 'reset' ? { op: 'reset', rows: withNotices(rec, p.rows) } : p));
  }

  function emitRows(rec: Rec, patches: readonly RowPatch[]): void {
    if (patches.length === 0) return;
    deps.events.rows({ ptyId: rec.ptyId, scope: 'main', patches });
  }

  function reportUnknown(rec: Rec, labels: readonly string[]): void {
    for (const entryType of labels) deps.diagnostics?.unknownEntry({ ptyId: rec.ptyId, entryType });
  }

  function onBatch(rec: Rec, session: Session, gen: number, batch: FollowBatch): void {
    if (rec.session !== session || session.gen !== gen) return;
    if (batch.reset) session.state = initAdapterState({ cwd: session.state.cwd });
    const result = adapt(session.state, toEntries(batch.lines));
    session.state = result.state;
    reportUnknown(rec, result.unknownLabels);
    if (batch.lines.length > 0) {
      rec.fileSeen = true;
      rec.lastGrowthAt = now();
      setReception(rec, 'ok');
    }
    emitRows(rec, batch.reset ? [{ op: 'reset', rows: withNotices(rec, viewOf(session.state)) }] : decoratePatches(rec, result.patches));
  }

  // ---- session (heavy part) --------------------------------------------------

  function startFollower(rec: Rec, session: Session, path: string, offset: number): void {
    const gen = session.gen;
    session.follower = new TranscriptFollower({
      path,
      offset,
      debounceMs: deps.follower?.debounceMs,
      pollMs: deps.follower?.pollMs,
      retryMs: deps.follower?.retryMs,
      onBatch: (batch) => onBatch(rec, session, gen, batch),
    });
    session.follower.start();
  }

  /** Loads the newest page of `source`'s transcript and starts following after it. */
  async function openSession(rec: Rec, source: ChatSourceInfo): Promise<Session> {
    const session: Session = {
      gen: 1,
      state: initAdapterState({ cwd: source.cwd }),
      follower: undefined as unknown as TranscriptFollower,
      olderOffset: null,
      olderQueue: Promise.resolve(),
    };
    let followFrom = 0;
    try {
      const page = await readPageBackward(source.transcriptPath);
      rec.fileSeen = true;
      followFrom = page.endOffset;
      if (page.lines.length > 0) {
        const result = adapt(session.state, toEntries(page.lines), { direction: 'backward' });
        session.state = result.state;
        reportUnknown(rec, result.unknownLabels);
      }
      session.olderOffset = page.done || session.state.backward.rootReached ? null : page.startOffset;
    } catch {
      rec.fileSeen = false; // not born yet: the follower waits for it
    }
    rec.session = session;
    startFollower(rec, session, source.transcriptPath, followFrom);
    return session;
  }

  function closeSession(rec: Rec): void {
    const session = rec.session;
    if (session === null) return;
    session.gen += 1;
    session.follower.stop();
    rec.session = null;
  }

  // ---- snapshot ------------------------------------------------------------

  function snapshotOf(rec: Rec): ChatSnapshot {
    const source = rec.source;
    const session = rec.session;
    if (source === null || session === null) {
      return { source: emptySource(), rows: [], cursor: null, live: liveOf(rec), permissionMode: 'default', reception: rec.reception };
    }
    const mode = session.state.meta.permissionMode;
    const permissionMode: ChatPermissionMode = mode !== undefined && PERMISSION_MODES.has(mode) ? (mode as ChatPermissionMode) : 'default';
    const conv: ConversationSource = {
      sessionId: source.sessionId,
      transcriptPath: source.transcriptPath,
      cwd: source.cwd,
      forward: session.follower.forward(),
      backward: { offset: session.olderOffset ?? 0, done: session.olderOffset === null },
      leafUuid: session.state.leafUuid,
      expectedParent: session.state.backward.expectedParent,
    };
    return {
      source: conv,
      rows: withNotices(rec, viewOf(session.state)),
      cursor: session.olderOffset === null ? null : String(session.olderOffset),
      live: liveOf(rec),
      permissionMode,
      reception: rec.reception,
    };
  }

  // ---- bridge --------------------------------------------------------------

  function handleSwitch(rec: Rec, event: Extract<BridgeEvent, { type: 'conversation-switched' }>): Promise<void> {
    return serial(rec, async () => {
      if (event.transcriptPath === null) return;
      const previous = sourceOf(rec);
      if (previous?.sessionId === event.sessionId) return;
      const next: ChatSourceInfo = { sessionId: event.sessionId, transcriptPath: event.transcriptPath, cwd: previous?.cwd ?? '' };
      const hadSession = rec.session !== null;
      closeSession(rec);
      rec.source = next;
      const reason: ConversationSwitchReason = event.source === 'resume' || event.source === 'fork' ? event.source : 'clear';
      rec.topNotice = noticeRow(`app:conversation-switch:${event.sessionId}`, 'conversation-switch', { source: reason });
      rec.appNotices = [];
      rec.fileSeen = false;
      rec.lastActivityAt = 0;
      rec.lastGrowthAt = 0;
      if (hadSession) await openSession(rec, next);
      setReception(rec, 'ok');
      deps.events.conversationSwitched({ ptyId: rec.ptyId, sessionId: event.sessionId, reason });
    });
  }

  function noticeRow(id: string, notice: NoticeRow['notice'], params: Record<string, unknown>): NoticeRow {
    return { id, kind: 'notice', notice, params, turnId: null, at: new Date(now()).toISOString(), scope: 'main' };
  }

  function onBridge(event: BridgeEvent): void {
    const rec = recOf(event.ptyId);
    if (event.type === 'conversation-switched') {
      void handleSwitch(rec, event);
    } else if (event.type === 'session-end') {
      setBase(rec, 'ended');
    } else if (event.type === 'hook') {
      if (ACTIVITY_EVENTS.has(event.event)) rec.lastActivityAt = now();
      if (WORKING_EVENTS.has(event.event)) setBase(rec, 'working');
      else if (IDLE_EVENTS.has(event.event) || rec.base === 'starting') setBase(rec, 'idle');
    }
  }

  const unsubscribeBridge = deps.bridge.onAny(onBridge);
  const pollMs = deps.receptionPollMs ?? 2_000;
  const pollTimer = pollMs > 0 ? setInterval(checkReception, pollMs) : null;
  pollTimer?.unref?.();

  // ---- api -----------------------------------------------------------------

  return {
    attach(ptyId) {
      const rec = recOf(ptyId);
      return serial(rec, async () => {
        const source = sourceOf(rec);
        if (source === null) return snapshotOf(rec);
        if (rec.session === null) await openSession(rec, source);
        return snapshotOf(rec);
      });
    },

    detach(ptyId) {
      const rec = recs.get(ptyId);
      if (rec === undefined) return;
      void serial(rec, async () => closeSession(rec));
    },

    loadOlder(ptyId, scope, cursor) {
      const rec = recs.get(ptyId);
      const session = rec?.session ?? null;
      if (rec === undefined || session === null || scope !== 'main') return Promise.resolve({ rows: [], cursor: null });
      const run = session.olderQueue.then(async (): Promise<ChatLoadOlderOutput> => {
        const gen = session.gen;
        const before = Number(cursor);
        if (!Number.isSafeInteger(before) || before < 0 || session.olderOffset === null) {
          return { rows: [], cursor: session.olderOffset === null ? null : String(session.olderOffset) };
        }
        const path = sourceOf(rec)?.transcriptPath;
        if (path === undefined) return { rows: [], cursor: null };
        let page;
        try {
          page = await readPageBackward(path, { beforeOffset: before });
        } catch {
          return { rows: [], cursor: String(session.olderOffset) };
        }
        if (rec.session !== session || session.gen !== gen) return { rows: [], cursor: null };
        const result = adapt(session.state, toEntries(page.lines), { direction: 'backward' });
        session.state = result.state;
        reportUnknown(rec, result.unknownLabels);
        session.olderOffset = page.done || session.state.backward.rootReached ? null : page.startOffset;
        // `prepend` rows answer this call; anything else (a rewind, a row that changed) goes as an event.
        const rows = result.patches.filter((p) => p.op === 'prepend' || p.op === 'append').flatMap((p) => [...p.rows]);
        emitRows(rec, decoratePatches(rec, result.patches.filter((p) => p.op !== 'prepend' && p.op !== 'append')));
        return { rows, cursor: session.olderOffset === null ? null : String(session.olderOffset) };
      });
      session.olderQueue = run.catch(() => undefined);
      return run;
    },

    async rowDetail(input) {
      const session = recs.get(input.ptyId)?.session ?? null;
      if (session === null || input.scope !== 'main') return { part: input.part, text: '', truncated: false };
      const flat = session.state.rows.find((r) => r.id === input.rowId);
      const row = flat ?? viewOf(session.state).find((r) => r.id === input.rowId);
      const children = row?.kind === 'action-group' ? expandGroup(session.state, row.id) : [];
      return buildRowDetail(row, children, input.part, readLineRef);
    },

    notifyAccountSwitch(label) {
      for (const rec of recs.values()) {
        if (rec.base === 'ended' || sourceOf(rec) === null) continue;
        noticeSeq += 1;
        const notice = noticeRow(`app:account-switch:${noticeSeq}`, 'account-switch', { label });
        rec.appNotices.push(notice);
        if (rec.session !== null) emitRows(rec, [{ op: 'append', rows: [notice] }]);
      }
    },

    markEnded(ptyId) {
      const rec = recOf(ptyId);
      setBase(rec, 'ended');
      const session = rec.session;
      if (session !== null) {
        // the CLI's last lines may land right at exit: one last read, then stop
        void session.follower.readNow().finally(() => {
          if (rec.session === session) session.follower.stop();
        });
      }
    },

    noteActivity(ptyId) {
      recOf(ptyId).lastActivityAt = now();
    },

    checkReception,

    transcriptRoots(ptyId) {
      const path = recs.get(ptyId)?.source?.transcriptPath ?? deps.getSource(ptyId)?.transcriptPath;
      return path === undefined ? [] : [dirname(path)];
    },

    generatedFileRoots(ptyId) {
      const cwd = recs.get(ptyId)?.source?.cwd ?? deps.getSource(ptyId)?.cwd;
      return [...(cwd !== undefined && cwd !== '' ? [cwd] : []), ...(deps.attachmentsRoot !== undefined ? [deps.attachmentsRoot] : [])];
    },

    dispose() {
      unsubscribeBridge();
      if (pollTimer !== null) clearInterval(pollTimer);
      for (const rec of recs.values()) closeSession(rec);
      recs.clear();
    },
  };
}
