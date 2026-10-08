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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { adapt, expandGroup, initAdapterState, viewOf, type AdapterState } from '../../shared/chat/adapter';
import type {
  ChatAckLookupOutput,
  ChatAnswerOutput,
  ChatConversationSwitchedEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatPromptSignalEvent,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatSnapshot,
  ConversationSwitchReason,
  PendingAnswer,
  RowDetail,
  RowPatch,
} from '../../shared/chat/ipc';
import type {
  ChatPermissionMode,
  ChatReception,
  ConversationRow,
  ConversationSource,
  LiveState,
  LiveAction,
  LiveStatus,
  NoticeRow,
  Pending,
  PendingScope,
  PendingState,
  RowScope,
  TerminalNeededReason,
  TranscriptEntry,
} from '../../shared/chat/rows';
import { classifyLine } from '../../shared/chat/transcriptEntry';
import type { BridgeEvent, PendingDecisionHandle } from '../hook-bridge';
import { closePending, pendingFromRequest, toHookDecision } from '../../shared/chat/pendingQueue';
import { summarizeTool } from '../../shared/chat/toolSummary';
import { createSubmitRing, lookupAck, signalsFromEntries, type PromptSignal } from './prompt-signals';
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
  promptSignal(event: ChatPromptSignalEvent): void;
  /** T079 - a pending just opened (the main decides whether to notify). */
  pendingOpened?(event: { readonly ptyId: string; readonly pending: Pending }): void;
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
  /** T064 - aceite tardio (chat:ack-lookup): UserPromptSubmit guardados + sinais do transcript desde since. */
  ackLookup(ptyId: string, text: string, since: string): Promise<ChatAckLookupOutput>;
  /** T070 - fonte de tela que pede o terminal (chat:screen-state); null = a caixa voltou. */
  reportScreenState(ptyId: string, terminalNeeded: TerminalNeededReason | null): void;
  /** T076 - the owner's answer to an open pending (chat:answer). */
  answer(ptyId: string, pendingId: string, answer: PendingAnswer): ChatAnswerOutput;
  /** Folders the tab's transcript files (and sub-agent files) may be served from. */
  transcriptRoots(ptyId: string): readonly string[];
  /** Id of the conversation the tab is on now (`null` until its first hook). */
  sessionIdOf(ptyId: string): string | null;
  /** Folders `chat:open-generated` may open from: the tab's `cwd` and the attachments folder. */
  generatedFileRoots(ptyId: string): readonly string[];
  dispose(): void;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

// Hooks after which the CLI owes the transcript new lines. `Stop` is NOT here: it is the end of the
// turn, and it lands after the follower already read the final line, so counting it as "activity
// newer than the last growth" flagged every finished turn as stale, with nothing left to arrive.
const ACTIVITY_EVENTS: ReadonlySet<string> = new Set(['UserPromptSubmit', 'PostToolUse']);
const WORKING_EVENTS: ReadonlySet<string> = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'PreCompact']);
const IDLE_EVENTS: ReadonlySet<string> = new Set(['Stop', 'StopFailure', 'SessionStart']);
const PERMISSION_MODES: ReadonlySet<string> = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto']);

/** Notification.notification_type que desenham um dialogo no terminal (research.md R16). */
const DIALOG_NOTIFICATIONS: Readonly<Record<string, TerminalNeededReason>> = {
  permission_prompt: 'permission-dialog',
  worker_permission_prompt: 'permission-dialog',
  elicitation_dialog: 'interactive-screen',
  agent_needs_input: 'interactive-screen',
};
/** Hooks que provam que o CLI voltou a andar: apagam o sinal de dialogo vindo de hook. */
const DIALOG_CLEARING_EVENTS: ReadonlySet<string> = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure']);
const SIGNAL_RING = 60;
const SUBMIT_RING = 20;

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

interface PendingEntry {
  pending: Pending;
  handle: PendingDecisionHandle;
}

/** Closed pendings kept per tab so a late `chat:answer` gets `not-open`, not `unknown`. */
const CLOSED_PENDINGS_KEPT = 30;

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
  /** Ultimos UserPromptSubmit (contrato de envio §5: 20). */
  readonly submits: ReturnType<typeof createSubmitRing>;
  /** Sinais recentes lidos do transcript (para o aceite tardio). */
  signals: PromptSignal[];
  /** Pendencias (PermissionRequest), em ordem de chegada; as fechadas ficam um tempo para o `not-open`. */
  readonly pendings: Map<string, PendingEntry>;
  hookTerminalNeeded: TerminalNeededReason | null;
  screenTerminalNeeded: TerminalNeededReason | null;
  currentAction: LiveAction | null;
  readonly activeSubagents: Set<string>;
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
        submits: createSubmitRing(SUBMIT_RING),
        signals: [],
        pendings: new Map(),
        hookTerminalNeeded: null,
        screenTerminalNeeded: null,
        currentAction: null,
        activeSubagents: new Set(),
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

  function openPendingsOf(rec: Rec): Pending[] {
    const out: Pending[] = [];
    for (const entry of rec.pendings.values()) if (entry.pending.state === 'open') out.push(entry.pending);
    return out;
  }

  function liveOf(rec: Rec): LiveState {
    const reason = rec.hookTerminalNeeded ?? rec.screenTerminalNeeded;
    const pendings = openPendingsOf(rec);
    const status: LiveStatus =
      rec.base === 'ended'
        ? 'ended'
        : rec.reception !== 'ok'
          ? 'not-receiving'
          : reason !== null
            ? 'terminal-needed'
            : pendings.length > 0
              ? 'waiting-you'
              : rec.base;
    return {
      status,
      currentAction: rec.currentAction,
      pendings,
      sends: [],
      activeSubagents: [...rec.activeSubagents],
      terminalNeeded: reason === null ? null : { reason },
    };
  }

  function emitLiveIfChanged(rec: Rec): void {
    const live = liveOf(rec);
    const key = `${live.status}|${live.currentAction?.toolUseId ?? ''}|${live.activeSubagents.join(',')}|${live.terminalNeeded?.reason ?? ''}|${live.pendings.map((p) => p.id).join(',')}`;
    if (key === rec.lastLiveKey) return;
    rec.lastLiveKey = key;
    deps.events.live({ ptyId: rec.ptyId, live });
  }

  function setBase(rec: Rec, base: BaseStatus): void {
    if (rec.base === 'ended' || rec.base === base) return;
    rec.base = base;
    emitLiveIfChanged(rec);
  }

  // ---- prompt signals (T064) -------------------------------------------------

  function emitSignal(rec: Rec, signal: PromptSignal): void {
    // hook submits live in their own ring (20, §5)
    if (!(signal.origin === 'hook' && signal.signal === 'submit')) rec.signals = [...rec.signals, signal].slice(-SIGNAL_RING);
    deps.events.promptSignal({
      ptyId: rec.ptyId,
      signal: signal.signal,
      ...(signal.text !== undefined ? { text: signal.text } : {}),
      at: signal.at,
      origin: signal.origin,
    });
  }

  function hookSignal(rec: Rec, signal: PromptSignal['signal'], text?: string): void {
    emitSignal(rec, { signal, ...(text !== undefined ? { text } : {}), at: new Date(now()).toISOString(), origin: 'hook' });
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
    if (!batch.reset && batch.lines.length > 0) {
      // a reset re-reads old lines: those are not new acceptances
      const signals = signalsFromEntries(toEntries(batch.lines), new Date(now()).toISOString());
      if (signals.length > 0) {
        for (const sig of signals) emitSignal(rec, sig);
      }
    }
    if (!batch.reset) closePendingsFromEntries(rec, toEntries(batch.lines));
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

  // ---- pendings (T076) ---------------------------------------------------------

  /** Description of the sub-agent that asked: adapter row, then `.meta.json`, then `agent_type`. */
  function subagentDescription(rec: Rec, agentId: string, payload: Record<string, unknown>): string {
    const row = rec.session?.state.rows.find((r) => r.kind === 'subagent' && r.agentId === agentId);
    if (row !== undefined && row.kind === 'subagent' && row.description !== '') return row.description;
    const source = sourceOf(rec);
    if (source !== null && source.sessionId !== '') {
      try {
        const metaPath = join(dirname(source.transcriptPath), source.sessionId, 'subagents', `agent-${agentId}.meta.json`);
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { description?: unknown };
        if (typeof meta.description === 'string' && meta.description.trim() !== '') return meta.description;
      } catch {
        // no meta file (yet): fall back to the agent type
      }
    }
    return typeof payload.agent_type === 'string' ? payload.agent_type : '';
  }

  function openPending(rec: Rec, event: Extract<BridgeEvent, { type: 'pending' }>): void {
    const agentId = typeof event.payload.agent_id === 'string' && event.payload.agent_id !== '' ? event.payload.agent_id : undefined;
    const scope: PendingScope = agentId === undefined ? 'main' : { agentId, description: subagentDescription(rec, agentId, event.payload) };
    const pending = pendingFromRequest({
      id: event.handle.id,
      payload: event.payload,
      toolUseId: event.toolUseId,
      arrivedAt: new Date(now()).toISOString(),
      scope,
    });
    rec.pendings.set(pending.id, { pending, handle: event.handle });
    rec.hookTerminalNeeded = null; // the dialog of an open pending is handled by the panel
    emitLiveIfChanged(rec);
    deps.events.pendingOpened?.({ ptyId: rec.ptyId, pending });
  }

  function prunePendings(rec: Rec): void {
    const closed = [...rec.pendings.values()].filter((e) => e.pending.state !== 'open');
    for (const e of closed.slice(0, Math.max(0, closed.length - CLOSED_PENDINGS_KEPT))) rec.pendings.delete(e.pending.id);
  }

  /** Marks an open pending as closed. `release` hands the held request back to the TUI (`{}`). */
  function closeOpenPending(rec: Rec, id: string, state: Exclude<PendingState, 'open'>, release: boolean): boolean {
    const entry = rec.pendings.get(id);
    if (entry === undefined || entry.pending.state !== 'open') return false;
    if (release) entry.handle.release();
    entry.pending = closePending(entry.pending, state);
    prunePendings(rec);
    return true;
  }

  function closeAllPendings(rec: Rec, state: Exclude<PendingState, 'open'>): void {
    let changed = false;
    for (const id of [...rec.pendings.keys()]) changed = closeOpenPending(rec, id, state, true) || changed;
    if (changed) emitLiveIfChanged(rec);
  }

  /** The transcript is the second witness: a result / permission decision for the same tool_use, or an interruption. */
  function closePendingsFromEntries(rec: Rec, entries: readonly TranscriptEntry[]): void {
    if (![...rec.pendings.values()].some((e) => e.pending.state === 'open')) return;
    const answered = new Set<string>();
    let interrupted = false;
    for (const entry of entries) {
      if (entry.k !== 'node') continue;
      const data = entry.data;
      if (entry.role === 'attachment') {
        const att = data.attachment;
        if (att !== null && typeof att === 'object' && (att as Record<string, unknown>).type === 'hook_permission_decision') {
          const a = att as Record<string, unknown>;
          for (const v of [a.toolUseID, a.tool_use_id, a.toolUseId]) if (typeof v === 'string') answered.add(v);
        }
        continue;
      }
      if (entry.role !== 'user') continue;
      const content = (data.message as { content?: unknown } | undefined)?.content;
      if (typeof content === 'string') {
        if (content.startsWith('[Request interrupted by user')) interrupted = true;
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const block of content as Record<string, unknown>[]) {
        if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') answered.add(block.tool_use_id);
        else if (block?.type === 'text' && typeof block.text === 'string' && block.text.startsWith('[Request interrupted by user')) interrupted = true;
      }
    }
    let changed = false;
    for (const entry of [...rec.pendings.values()]) {
      const p = entry.pending;
      if (p.state !== 'open') continue;
      if (p.toolUseId !== null && answered.has(p.toolUseId)) changed = closeOpenPending(rec, p.id, 'resolved-elsewhere', true) || changed;
      else if (interrupted) changed = closeOpenPending(rec, p.id, 'cancelled', true) || changed;
    }
    if (changed) emitLiveIfChanged(rec);
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
      rec.signals = [];
      rec.currentAction = null;
      rec.activeSubagents.clear();
      rec.hookTerminalNeeded = null;
      closeAllPendings(rec, 'cancelled');
      if (hadSession) await openSession(rec, next);
      setReception(rec, 'ok');
      deps.events.conversationSwitched({ ptyId: rec.ptyId, sessionId: event.sessionId, reason });
      hookSignal(rec, 'session-switch');
      emitLiveIfChanged(rec);
    });
  }

  function noticeRow(id: string, notice: NoticeRow['notice'], params: Record<string, unknown>): NoticeRow {
    return { id, kind: 'notice', notice, params, turnId: null, at: new Date(now()).toISOString(), scope: 'main' };
  }

  /** Efeitos dos hooks alem do semaforo: sinais de envio, acao atual, subagentes, dialogo (T064/T070). */
  function onHook(rec: Rec, name: string, payload: Record<string, unknown>): void {
    const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const agentId = text(payload.agent_id);
    if (name === 'UserPromptSubmit') {
      const prompt = text(payload.prompt);
      const at = new Date(now()).toISOString();
      if (prompt !== undefined) rec.submits.push({ text: prompt, at });
      emitSignal(rec, { signal: 'submit', ...(prompt !== undefined ? { text: prompt } : {}), at, origin: 'hook' });
    } else if (name === 'SessionStart' && payload.source === 'compact') {
      hookSignal(rec, 'compact');
    }

    if (name === 'PreToolUse' && agentId === undefined) {
      const tool = text(payload.tool_name);
      const toolUseId = text(payload.tool_use_id);
      if (tool !== undefined && toolUseId !== undefined) {
        const { summary } = summarizeTool({ name: tool, input: payload.tool_input, cwd: rec.source?.cwd ?? '' });
        rec.currentAction = { toolUseId, tool, summary, startedAt: new Date(now()).toISOString(), scope: 'main' };
      }
    } else if (name === 'PostToolUse' && agentId === undefined) {
      const id = text(payload.tool_use_id);
      if (id === undefined || rec.currentAction?.toolUseId === id) rec.currentAction = null;
    } else if (name === 'Stop' || name === 'StopFailure' || name === 'UserPromptSubmit' || name === 'SessionStart') {
      rec.currentAction = null;
    } else if (name === 'SubagentStart' && agentId !== undefined) {
      rec.activeSubagents.add(agentId);
    } else if (name === 'SubagentStop' && agentId !== undefined) {
      rec.activeSubagents.delete(agentId);
    }

    if (DIALOG_CLEARING_EVENTS.has(name)) {
      rec.hookTerminalNeeded = null;
    } else if (name === 'Notification' && openPendingsOf(rec).length === 0) {
      const reason = DIALOG_NOTIFICATIONS[text(payload.notification_type) ?? ''];
      if (reason !== undefined) rec.hookTerminalNeeded = reason;
    }
    emitLiveIfChanged(rec);
  }

  function onBridge(event: BridgeEvent): void {
    const rec = recOf(event.ptyId);
    if (event.type === 'conversation-switched') {
      void handleSwitch(rec, event);
    } else if (event.type === 'session-end') {
      closeAllPendings(rec, 'cancelled');
      setBase(rec, 'ended');
    } else if (event.type === 'pending') {
      openPending(rec, event);
    } else if (event.type === 'expired') {
      // the CLI gave up: nobody is waiting, the terminal must take over (FR-025)
      if (closeOpenPending(rec, event.requestId, 'expired', false)) {
        rec.hookTerminalNeeded = 'hook-timeout';
        emitLiveIfChanged(rec);
      }
    } else if (event.type === 'resolved-elsewhere' || event.type === 'cancelled') {
      if (closeOpenPending(rec, event.requestId, event.type, false)) emitLiveIfChanged(rec);
    } else if (event.type === 'hook') {
      if (ACTIVITY_EVENTS.has(event.event)) rec.lastActivityAt = now();
      if (WORKING_EVENTS.has(event.event)) setBase(rec, 'working');
      else if (IDLE_EVENTS.has(event.event) || rec.base === 'starting') setBase(rec, 'idle');
      onHook(rec, event.event, event.payload);
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
      closeAllPendings(rec, 'cancelled');
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

    async ackLookup(ptyId, text, since) {
      const rec = recs.get(ptyId) ?? (deps.getSource(ptyId) !== null ? recOf(ptyId) : undefined);
      if (rec === undefined) return { matched: false };
      const early = lookupAck(rec.submits.items(), rec.signals, text, since);
      if (early.matched) return early;
      // late acceptance may sit in lines read before the tab was attached: look at the file's tail
      const path = sourceOf(rec)?.transcriptPath;
      if (path === undefined) return { matched: false };
      try {
        const page = await readPageBackward(path);
        return lookupAck([], signalsFromEntries(toEntries(page.lines), new Date(now()).toISOString()), text, since);
      } catch {
        return { matched: false };
      }
    },

    reportScreenState(ptyId, terminalNeeded) {
      const rec = recOf(ptyId);
      rec.screenTerminalNeeded = terminalNeeded;
      emitLiveIfChanged(rec);
    },

    answer(ptyId, pendingId, answer) {
      const rec = recs.get(ptyId);
      const entry = rec?.pendings.get(pendingId);
      if (rec === undefined || entry === undefined) return { ok: false, reason: 'unknown' };
      if (entry.pending.state !== 'open') return { ok: false, reason: 'not-open' };
      let decision: Record<string, unknown>;
      try {
        decision = toHookDecision(entry.pending, answer);
      } catch {
        return { ok: false, reason: 'unknown' };
      }
      if (!entry.handle.respond(decision)) {
        closeOpenPending(rec, pendingId, 'resolved-elsewhere', false);
        emitLiveIfChanged(rec);
        return { ok: false, reason: 'not-open' };
      }
      closeOpenPending(rec, pendingId, 'answered', false);
      emitLiveIfChanged(rec);
      return { ok: true };
    },

    transcriptRoots(ptyId) {
      const path = recs.get(ptyId)?.source?.transcriptPath ?? deps.getSource(ptyId)?.transcriptPath;
      return path === undefined ? [] : [dirname(path)];
    },

    sessionIdOf(ptyId) {
      const source = recs.get(ptyId)?.source ?? deps.getSource(ptyId);
      return source !== undefined && source !== null && source.sessionId !== '' ? source.sessionId : null;
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
