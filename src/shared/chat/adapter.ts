// T029 (014-chat) - transcript -> conversation rows adapter,
// specs/014-chat/contracts/conversation-rows.md. Pure and incremental:
//
//   adapt(state, entries, opts?) -> { state, patches, unknownLabels }
//
// - `entries` are classified lines (T021 `classifyLine`, nulls already removed).
//   Forward: file order. Backward (`direction: 'backward'`): REVERSE file order,
//   exactly what the pager returns.
// - `state` is plain data (JSON round-trips). The chain trackers of T023 are
//   rebuilt from `state.recs` when they are not cached (see `RUNTIME`).
// - Heavy content never stays in memory: every line is slimmed on entry
//   (images, tool outputs, diffs and account data are dropped or reduced to
//   what the summaries need). Account attachments never get here at all
//   (the classifier keeps only their uuid link).
// - `state.rows` are the FLAT rows; the view sent to the screen is
//   `viewOf(state)` = `groupActions(rows)` (T027). Patches are about the view.

import {
  BackwardChain,
  buildActiveChain,
  ForwardChain,
  type BackwardCursor,
  type ChainLine,
} from './activeChain';
import { groupActions } from './grouping';
import type { RowPatch } from './ipc';
import type {
  ActionRow,
  ConversationRow,
  LineRef,
  NoticeKind,
  NoticeRow,
  PlanRow,
  Question,
  QuestionRow,
  RowAttachment,
  RowScope,
  SubagentRow,
  SubagentStatus,
  TranscriptEntry,
  Turn,
  UnknownRow,
} from './rows';
import { summarizeTool } from './toolSummary';

// ---------------------------------------------------------------------------
// public types
// ---------------------------------------------------------------------------

/** Content of `<session>/subagents/agent-<agentId>.meta.json` plus the agentId from the file name. */
export interface SubagentMeta {
  readonly agentId?: string;
  readonly toolUseId: string;
  readonly agentType?: string;
  readonly description?: string;
  readonly model?: string;
  readonly requestShape?: string;
  readonly spawnDepth?: number;
  readonly parentAgentId?: string;
}

export interface AdaptOptions {
  /** `forward` (default): file order. `backward`: older page, entries in REVERSE file order. */
  readonly direction?: 'forward' | 'backward';
  /** `.meta.json` files already read; linked by `toolUseId`. May arrive after the rows exist. */
  readonly subagentMetas?: readonly SubagentMeta[];
}

export interface AdaptResult {
  readonly state: AdapterState;
  readonly patches: readonly RowPatch[];
  /** Type labels seen for the first time in this session (feed `diagnostics.unknownEntry`; no content). */
  readonly unknownLabels: readonly string[];
}

interface ToolMemo {
  readonly rowId: string;
  readonly name: string;
  readonly input: Json;
  readonly backgroundTaskId?: string;
}

interface ResultInfo {
  readonly isError: boolean;
  readonly denied: boolean;
  readonly interrupted: boolean;
  readonly result: unknown;
  readonly content: string;
  readonly ref: LineRef;
}

interface SubPending {
  readonly status?: SubagentStatus;
  readonly durationMs?: number;
}

interface TurnMeta {
  readonly opener: Turn['opener'];
  readonly complete: boolean;
}

/** Everything the fold needs between calls (all plain data). */
export interface FoldAux {
  readonly tools: Readonly<Record<string, ToolMemo>>;
  readonly turnMeta: Readonly<Record<string, TurnMeta>>;
  readonly cur: string | null;
  readonly queued: readonly { readonly rowId: string; readonly text: string }[];
  readonly lastCommand: string | null;
  readonly heldLocal: string | null;
  readonly pendingShell: string | null;
  readonly orphans: Readonly<Record<string, ResultInfo>>;
  readonly subPending: Readonly<Record<string, SubPending>>;
}

export interface InvalidMark {
  /** uuid of the chain line the invalid line followed (null = before any line). */
  readonly anchor: string | null;
  readonly row: UnknownRow;
}

export interface AdapterState {
  readonly version: 1;
  readonly scope: RowScope;
  readonly cwd: string;
  /** Slim lines in FILE order (chain links included); needed to recompute the chain. */
  readonly recs: readonly ChainLine[];
  readonly invalid: readonly InvalidMark[];
  /** Flat rows in chain order. */
  readonly rows: readonly ConversationRow[];
  /** Derived from `rows` after every call. */
  readonly turns: readonly Turn[];
  readonly fold: FoldAux;
  readonly meta: { readonly permissionMode?: string; readonly title?: string };
  /** Backward paging cursor (`rootReached` = the whole conversation is loaded). */
  readonly backward: BackwardCursor & { readonly rootReached: boolean };
  readonly leafUuid: string | null;
  readonly seenUnknown: readonly string[];
  readonly subMeta: Readonly<Record<string, SubagentMeta>>;
}

export function initAdapterState(init: { cwd?: string; scope?: RowScope } = {}): AdapterState {
  return {
    version: 1,
    scope: init.scope ?? 'main',
    cwd: init.cwd ?? '',
    recs: [],
    invalid: [],
    rows: [],
    turns: [],
    fold: { tools: {}, turnMeta: {}, cur: null, queued: [], lastCommand: null, heldLocal: null, pendingShell: null, orphans: {}, subPending: {} },
    meta: {},
    backward: { leafUuid: null, expectedParent: null, rootReached: false },
    leafUuid: null,
    seenUnknown: [],
    subMeta: {},
  };
}

/** The rows the screen shows: flat rows with runs of actions grouped (T027). */
export function viewOf(state: AdapterState): ConversationRow[] {
  return groupActions(state.rows);
}

/** Rows hidden inside an `action-group` of the view. */
export function expandGroup(state: AdapterState, groupId: string): ConversationRow[] {
  const group = viewOf(state).find((r) => r.id === groupId);
  if (group === undefined || group.kind !== 'action-group') return [];
  const byId = new Map(state.rows.map((r) => [r.id, r]));
  return group.children.map((id) => byId.get(id)).filter((r): r is ConversationRow => r !== undefined);
}

// ---------------------------------------------------------------------------
// json helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function obj(v: unknown): Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}
function jsonSize(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// ---------------------------------------------------------------------------
// slimming (what stays in memory)
// ---------------------------------------------------------------------------

const KEEP_TOP: readonly string[] = [
  'type', 'subtype', 'isMeta', 'isCompactSummary', 'isApiErrorMessage', 'isAbortedMidStream', 'error', 'apiErrorStatus',
  'apiBlockIndex', 'thinkingDurationMs', 'promptId', 'turnOrigin', 'promptSource', 'origin', 'toolDenialKind', 'level',
  'commandRun', 'compactMetadata', 'durationMs', 'pendingBackgroundAgentCount', 'preventedContinuation', 'stopReason',
  'cwd', 'timestamp',
];

const PLAN_MAX = 100_000;
const SMALL_JSON = 20_000;

function slimInput(input: unknown): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj(input))) {
    if (typeof v === 'string') out[k] = cut(v, k === 'plan' ? PLAN_MAX : 2000);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (v !== null && typeof v === 'object' && jsonSize(v) <= SMALL_JSON) out[k] = v;
  }
  return out;
}

function slimBlock(b: unknown): unknown {
  const block = obj(b);
  switch (block.type) {
    case 'text':
      return { type: 'text', text: str(block.text) ?? '' };
    case 'thinking':
      return { type: 'thinking', thinking: (str(block.thinking) ?? '').trim() === '' ? '' : 'x' };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: slimInput(block.input) };
    case 'tool_result': {
      let content = '';
      if (typeof block.content === 'string') content = block.content;
      else {
        const first = arr(block.content).map(obj).find((x) => x.type === 'text');
        content = str(first?.text) ?? '';
      }
      return { type: 'tool_result', tool_use_id: block.tool_use_id, is_error: block.is_error === true, content: cut(content, 200) };
    }
    case 'image':
      return { type: 'image' };
    default:
      return { type: str(block.type) ?? '?' };
  }
}

function slimMessage(m: unknown): Json {
  const msg = obj(m);
  const out: Json = {};
  if (msg.id !== undefined) out.id = msg.id;
  if (msg.role !== undefined) out.role = msg.role;
  if (msg.model !== undefined) out.model = msg.model;
  out.content = typeof msg.content === 'string' ? msg.content : arr(msg.content).map(slimBlock);
  return out;
}

function lineCountPlaceholder(text: string): string {
  return text === '' ? '' : '\n'.repeat(text.split('\n').length - 1);
}

function slimResult(r: unknown): unknown {
  if (typeof r === 'string') return cut(r, 300);
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return undefined;
  const src = obj(r);
  const out: Json = {};
  for (const k of ['type', 'filePath', 'numFiles', 'taskId', 'task_id', 'workflowName', 'agentId', 'status', 'isAsync', 'resolvedModel',
    'commandName', 'interrupted', 'backgroundTaskId', 'success', 'totalDurationMs', 'totalTokens', 'totalToolUseCount']) {
    if (src[k] !== undefined && (typeof src[k] !== 'object' || src[k] === null)) out[k] = src[k];
  }
  if (typeof src.plan === 'string') out.plan = cut(src.plan, PLAN_MAX);
  if (typeof src.content === 'string') out.content = lineCountPlaceholder(src.content);
  for (const k of ['questions', 'answers']) {
    if (src[k] !== undefined && jsonSize(src[k]) <= SMALL_JSON) out[k] = src[k];
  }
  const file = obj(src.file);
  if (Object.keys(file).length > 0) out.file = { startLine: file.startLine, numLines: file.numLines, totalLines: file.totalLines };
  if (Array.isArray(src.structuredPatch)) {
    out.structuredPatch = src.structuredPatch.map((h) => ({
      lines: arr(obj(h).lines).map((l) => (typeof l === 'string' ? l.slice(0, 1) : '')),
    }));
  }
  return out;
}

function slimAttachment(a: unknown): Json {
  const att = obj(a);
  const type = str(att.type) ?? '?';
  const out: Json = { type };
  switch (type) {
    case 'queued_command':
      out.prompt = cut(str(att.prompt) ?? '', 20_000);
      out.commandMode = att.commandMode;
      out.humanTurn = att.humanTurn;
      out.origin = att.origin;
      out.usage = att.usage;
      break;
    case 'file':
      out.filename = att.filename;
      out.displayPath = att.displayPath;
      break;
    case 'edited_text_file':
      out.filename = att.filename;
      break;
    case 'task_status':
      out.taskId = att.taskId;
      out.status = att.status;
      break;
    case 'hook_non_blocking_error':
    case 'hook_system_message':
    case 'hook_permission_decision':
      out.hookName = att.hookName;
      break;
    default:
      break;
  }
  return out;
}

function slimData(d: Json): Json {
  const out: Json = {};
  for (const k of KEEP_TOP) if (d[k] !== undefined) out[k] = d[k];
  if (typeof d.content === 'string') out.content = cut(d.content, 500);
  if (Array.isArray(d.hookErrors)) out.hookErrors = d.hookErrors.slice(0, 5).map((e) => cut(String(e), 200));
  if (d.message !== undefined) out.message = slimMessage(d.message);
  if (d.toolUseResult !== undefined) out.toolUseResult = slimResult(d.toolUseResult);
  if (d.attachment !== undefined) out.attachment = slimAttachment(d.attachment);
  return out;
}

function slimLine(e: Extract<TranscriptEntry, { k: 'node' | 'unknown' }>): ChainLine {
  if (e.k === 'unknown') return { ...e, data: { timestamp: str(e.data.timestamp) ?? '' } };
  if (e.noise === true) return e;
  return { ...e, data: slimData(e.data) };
}

// ---------------------------------------------------------------------------
// work area (mutable, private to one adapt call)
// ---------------------------------------------------------------------------

interface Work {
  rows: ConversationRow[];
  idx: Map<string, number>;
  tools: Record<string, ToolMemo>;
  turnMeta: Record<string, TurnMeta>;
  cur: string | null;
  queued: { rowId: string; text: string }[];
  lastCommand: string | null;
  heldLocal: string | null;
  pendingShell: string | null;
  orphans: Record<string, ResultInfo>;
  subPending: Record<string, SubPending>;
  metas: Record<string, SubagentMeta>;
  seen: Set<string>;
  newUnknown: string[];
  cwd: string;
  scope: RowScope;
}

function freshWork(
  base: { cwd: string; scope: RowScope; metas: Record<string, SubagentMeta> },
  seen: Set<string>,
  newUnknown: string[],
): Work {
  return {
    rows: [], idx: new Map(), tools: {}, turnMeta: {}, cur: null, queued: [], lastCommand: null, heldLocal: null,
    pendingShell: null, orphans: {}, subPending: {}, metas: base.metas, seen, newUnknown, cwd: base.cwd, scope: base.scope,
  };
}

function workFrom(state: AdapterState, seen: Set<string>, newUnknown: string[]): Work {
  const w = freshWork({ cwd: state.cwd, scope: state.scope, metas: { ...state.subMeta } }, seen, newUnknown);
  w.rows = [...state.rows];
  w.rows.forEach((r, i) => w.idx.set(r.id, i));
  const f = state.fold;
  w.tools = { ...f.tools };
  w.turnMeta = { ...f.turnMeta };
  w.cur = f.cur;
  w.queued = [...f.queued];
  w.lastCommand = f.lastCommand;
  w.heldLocal = f.heldLocal;
  w.pendingShell = f.pendingShell;
  w.orphans = { ...f.orphans };
  w.subPending = { ...f.subPending };
  return w;
}

function foldAuxOf(w: Work): FoldAux {
  return {
    tools: w.tools, turnMeta: w.turnMeta, cur: w.cur, queued: w.queued, lastCommand: w.lastCommand, heldLocal: w.heldLocal,
    pendingShell: w.pendingShell, orphans: w.orphans, subPending: w.subPending,
  };
}

function put(w: Work, row: ConversationRow): void {
  w.idx.set(row.id, w.rows.length);
  w.rows.push(row);
}

function getRow(w: Work, id: string): ConversationRow | undefined {
  const i = w.idx.get(id);
  return i === undefined ? undefined : w.rows[i];
}

function setRow(w: Work, row: ConversationRow): void {
  const i = w.idx.get(row.id);
  if (i !== undefined) w.rows[i] = row;
}

function base(w: Work, id: string, at: string): { id: string; turnId: string | null; at: string; scope: RowScope } {
  return { id, turnId: w.cur, at, scope: w.scope };
}

function openTurn(w: Work, turnId: string, opener: Turn['opener']): void {
  if (w.cur !== null) {
    const prev = w.turnMeta[w.cur];
    if (prev !== undefined && !prev.complete) w.turnMeta[w.cur] = { ...prev, complete: true };
  }
  w.cur = turnId;
  w.turnMeta[turnId] = { opener, complete: false };
}

function closeTurn(w: Work): void {
  if (w.cur === null) return;
  const prev = w.turnMeta[w.cur];
  if (prev !== undefined) w.turnMeta[w.cur] = { ...prev, complete: true };
}

function unknownRow(w: Work, label: string, id: string, raw: LineRef, at: string): void {
  put(w, { kind: 'unknown', ...base(w, id, at), typeLabel: label, raw });
  if (!w.seen.has(label)) {
    w.seen.add(label);
    w.newUnknown.push(label);
  }
}

function notice(w: Work, id: string, at: string, kind: NoticeKind, params: Record<string, unknown>): void {
  const row: NoticeRow = { kind: 'notice', ...base(w, id, at), notice: kind, params };
  put(w, row);
}

// ---------------------------------------------------------------------------
// subagents
// ---------------------------------------------------------------------------

const SUB_STATUS: Readonly<Record<string, SubagentStatus>> = {
  completed: 'completed', failed: 'failed', error: 'failed', killed: 'killed', stopped: 'stopped',
};

function agentRowId(toolUseId: string): string {
  return `agent:${toolUseId}`;
}

function applyMeta(row: SubagentRow, meta: SubagentMeta | undefined): SubagentRow {
  if (meta === undefined) return row;
  if (meta.agentId !== undefined && row.agentId !== '' && meta.agentId !== row.agentId) return row;
  return {
    ...row,
    agentType: meta.agentType ?? row.agentType,
    description: meta.description ?? row.description,
    ...(meta.model !== undefined ? { model: meta.model } : {}),
    background: meta.requestShape !== undefined ? meta.requestShape === 'background' : row.background,
    depth: meta.spawnDepth ?? row.depth,
    agentId: row.agentId === '' && meta.agentId !== undefined ? meta.agentId : row.agentId,
  };
}

function applySub(row: SubagentRow, p: SubPending | undefined): SubagentRow {
  if (p === undefined) return row;
  return {
    ...row,
    ...(p.status !== undefined ? { status: p.status } : {}),
    ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
  };
}

function notify(w: Work, toolUseId: string, p: SubPending): void {
  const row = getRow(w, agentRowId(toolUseId));
  if (row !== undefined && row.kind === 'subagent') setRow(w, applySub(row, p));
  else w.subPending[toolUseId] = { ...w.subPending[toolUseId], ...p };
}

function tagText(text: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return m === null ? undefined : m[1]!;
}

function parseNotification(text: string): { toolUseId: string; pending: SubPending } | null {
  const toolUseId = tagText(text, 'tool-use-id');
  if (toolUseId === undefined) return null;
  const status = tagText(text, 'status');
  const dur = Number(tagText(text, 'duration_ms'));
  return {
    toolUseId: toolUseId.trim(),
    pending: {
      status: status === undefined ? 'unknown' : SUB_STATUS[status.trim()] ?? 'unknown',
      ...(Number.isFinite(dur) && tagText(text, 'duration_ms') !== undefined ? { durationMs: dur } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// tools: open (tool_use) and close (tool_result)
// ---------------------------------------------------------------------------

function parseQuestions(v: unknown): Question[] {
  return arr(v).map((q) => {
    const x = obj(q);
    return {
      question: str(x.question) ?? '',
      ...(str(x.header) !== undefined ? { header: str(x.header) } : {}),
      ...(typeof x.multiSelect === 'boolean' ? { multiSelect: x.multiSelect } : {}),
      options: arr(x.options).map((o) => {
        const op = obj(o);
        return {
          label: str(op.label) ?? '',
          ...(str(op.description) !== undefined ? { description: str(op.description) } : {}),
          ...(str(op.preview) !== undefined ? { preview: str(op.preview) } : {}),
        };
      }),
    } as Question;
  });
}

function openTool(w: Work, id: string, name: string, input: Json, at: string): void {
  let rowId = id;
  if (name === 'Agent' || name === 'Task') {
    rowId = agentRowId(id);
    let row: SubagentRow = {
      kind: 'subagent', ...base(w, rowId, at), agentId: '', toolUseId: id, description: str(input.description) ?? '',
      agentType: str(input.subagent_type) ?? 'general-purpose', status: 'running', startedAt: at,
      background: input.run_in_background === true, depth: 0,
    };
    row = applySub(applyMeta(row, w.metas[id]), w.subPending[id]);
    delete w.subPending[id];
    put(w, row);
  } else if (name === 'Skill') {
    put(w, { kind: 'skill', ...base(w, id, at), name: str(input.skill) ?? str(input.command) ?? '', how: 'used-by-claude' });
  } else if (name === 'AskUserQuestion') {
    put(w, { kind: 'question', ...base(w, id, at), questions: parseQuestions(input.questions), answers: {} } satisfies QuestionRow);
  } else if (name === 'ExitPlanMode') {
    put(w, { kind: 'plan', ...base(w, id, at), markdown: str(input.plan) ?? '', outcome: 'pending' } satisfies PlanRow);
  } else {
    const s = summarizeTool({ name, input, cwd: w.cwd });
    put(w, {
      kind: 'action', ...base(w, id, at), toolUseId: id, tool: name, category: s.category, summary: s.summary, status: 'running',
    } satisfies ActionRow);
  }
  w.tools[id] = { rowId, name, input };
  const orphan = w.orphans[id];
  if (orphan !== undefined) {
    delete w.orphans[id];
    closeTool(w, id, orphan);
  }
}

const DOC_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'md', 'pdf', 'png', 'jpg', 'svg', 'csv', 'txt']);

function closeTool(w: Work, id: string, res: ResultInfo): void {
  const memo = w.tools[id];
  if (memo === undefined) {
    w.orphans[id] = res;
    return;
  }
  const row = getRow(w, memo.rowId);
  if (row === undefined) return;
  const result = obj(res.result);

  if (row.kind === 'action') {
    const s = summarizeTool({ name: memo.name, input: memo.input, result: res.result, cwd: w.cwd });
    const status: ActionRow['status'] = res.denied ? 'denied' : res.interrupted ? 'interrupted' : res.isError ? 'error' : 'ok';
    setRow(w, { ...row, category: s.category, summary: s.summary, status, detail: res.ref });
    const bg = str(result.backgroundTaskId);
    if (bg !== undefined) w.tools[id] = { ...memo, backgroundTaskId: bg };
    if (memo.name === 'Write' && status === 'ok') {
      const path = str(memo.input.file_path) ?? str(result.filePath);
      const ext = path?.split('.').pop()?.toLowerCase();
      if (path !== undefined && ext !== undefined && DOC_EXTENSIONS.has(ext)) {
        notice(w, `${id}:generated`, row.at, 'generated-file', { path, name: path.replace(/\\/g, '/').split('/').pop() });
      }
    }
  } else if (row.kind === 'subagent') {
    const agentId = str(result.agentId);
    let next: SubagentRow = { ...row, ...(agentId !== undefined ? { agentId } : {}) };
    if (result.isAsync === true) next = { ...next, background: true };
    const model = str(result.resolvedModel);
    if (model !== undefined && next.model === undefined) next = { ...next, model };
    if (res.isError) next = { ...next, status: 'failed' };
    else if (result.status !== 'async_launched' && str(result.status) !== undefined) {
      next = { ...next, status: SUB_STATUS[str(result.status) as string] ?? next.status };
      const d = num(result.totalDurationMs);
      if (d !== undefined) next = { ...next, durationMs: d };
    }
    setRow(w, applyMeta(next, w.metas[row.toolUseId]));
  } else if (row.kind === 'question') {
    const answers = obj(result.answers);
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) if (typeof v === 'string') clean[k] = v;
    setRow(w, { ...row, answers: clean });
  } else if (row.kind === 'plan') {
    const markdown = row.markdown !== '' ? row.markdown : str(result.plan) ?? '';
    setRow(w, { ...row, markdown, outcome: res.isError || res.denied ? 'adjust-requested' : 'approved' });
  }
}

function resultInfoOf(block: Json, data: Json, ref: LineRef): ResultInfo {
  const result = data.toolUseResult;
  return {
    isError: block.is_error === true,
    denied: typeof data.toolDenialKind === 'string',
    interrupted: obj(result).interrupted === true,
    result,
    content: str(block.content) ?? '',
    ref,
  };
}

// ---------------------------------------------------------------------------
// folding one line
// ---------------------------------------------------------------------------

function messageContent(data: Json): { text: string; blocks: unknown[] } {
  const c = obj(data.message).content;
  if (typeof c === 'string') return { text: c, blocks: [] };
  const blocks = arr(c);
  const text = blocks.map(obj).filter((b) => b.type === 'text').map((b) => str(b.text) ?? '').join('\n');
  return { text, blocks };
}

function foldAssistant(w: Work, line: Extract<ChainLine, { k: 'node' }>): void {
  const data = line.data;
  const msg = obj(data.message);
  const { uuid, at } = line;
  const { text, blocks } = messageContent(data);

  if (data.isApiErrorMessage === true || msg.model === '<synthetic>') {
    const limit = data.error === 'rate_limit' || /hit your limit|usage limit/i.test(text);
    notice(w, uuid, at, limit ? 'limit' : 'api-error', {
      text: cut(text, 300),
      ...(num(data.apiErrorStatus) !== undefined ? { status: num(data.apiErrorStatus) } : {}),
    });
    return;
  }

  const messageId = str(msg.id) ?? uuid;
  blocks.forEach((b, i) => {
    const block = obj(b);
    const id = i === 0 ? uuid : `${uuid}#${i}`;
    switch (block.type) {
      case 'text': {
        const markdown = str(block.text) ?? '';
        if (markdown.trim() === '') return;
        put(w, { kind: 'assistant', ...base(w, id, at), markdown, blockIndex: num(data.apiBlockIndex) ?? i, messageId });
        return;
      }
      case 'thinking':
        put(w, {
          kind: 'thinking', ...base(w, id, at), hasText: (str(block.thinking) ?? '') !== '',
          ...(num(data.thinkingDurationMs) !== undefined ? { durationMs: num(data.thinkingDurationMs) } : {}),
        });
        return;
      case 'tool_use':
        openTool(w, str(block.id) ?? id, str(block.name) ?? '?', obj(block.input), at);
        return;
      default:
        unknownRow(w, `block:${str(block.type) ?? '?'}`, id, line.raw, at);
    }
  });
  w.lastCommand = null;
  if (data.isAbortedMidStream === true) notice(w, `${uuid}:interrupted`, at, 'interrupted', {});
}

function foldUser(w: Work, line: Extract<ChainLine, { k: 'node' }>): void {
  const data = line.data;
  const { uuid, at } = line;
  const { text, blocks } = messageContent(data);

  // 1. tool results close their action
  let hadResult = false;
  for (const b of blocks) {
    const block = obj(b);
    if (block.type !== 'tool_result') continue;
    hadResult = true;
    closeTool(w, str(block.tool_use_id) ?? '', resultInfoOf(block, data, line.raw));
  }
  if (hadResult) return;

  // 2. notifications / other origins
  const origin = str(obj(data.origin).kind);
  if (origin === 'task-notification') {
    const n = parseNotification(text);
    if (n !== null) notify(w, n.toolUseId, n.pending);
    openTurn(w, uuid, 'notification');
    return;
  }
  if (origin === 'peer' || origin === 'coordinator') {
    notice(w, uuid, at, 'informational', { text: cut(text, 300) });
    return;
  }

  // 3-4. meta lines; a skill typed by the owner announces itself by the body
  if (data.isMeta === true) {
    if (w.lastCommand !== null && text.startsWith('Base directory for this skill')) {
      put(w, { kind: 'skill', ...base(w, `skill:${uuid}`, at), name: w.lastCommand, how: 'loaded-by-user' });
      w.lastCommand = null;
    }
    return;
  }
  if (data.isCompactSummary === true) return;

  // 5. commands
  if (text.includes('<local-command-caveat>')) return;
  const stdout = tagText(text, 'local-command-stdout');
  if (stdout !== undefined) {
    w.heldLocal = stdout;
    return;
  }
  const cmdName = tagText(text, 'command-name');
  if (cmdName !== undefined) {
    const args = (tagText(text, 'command-args') ?? '').trim();
    const name = cmdName.trim().replace(/^\//, '');
    openTurn(w, str(data.promptId) ?? uuid, 'human');
    put(w, {
      kind: 'user', ...base(w, uuid, at), text: `/${name}${args !== '' ? ` ${args}` : ''}`, attachments: [], command: { name, args },
    });
    w.lastCommand = name;
    return;
  }

  // 6. shell mode
  const bashIn = tagText(text, 'bash-input');
  if (bashIn !== undefined) {
    openTurn(w, str(data.promptId) ?? uuid, 'human');
    put(w, { kind: 'shell', ...base(w, uuid, at), command: bashIn });
    w.pendingShell = uuid;
    return;
  }
  const bashOut = tagText(text, 'bash-stdout');
  const bashErr = tagText(text, 'bash-stderr');
  if (bashOut !== undefined || bashErr !== undefined) {
    const row = w.pendingShell === null ? undefined : getRow(w, w.pendingShell);
    if (row !== undefined && row.kind === 'shell') {
      setRow(w, {
        ...row,
        ...(bashOut !== undefined && bashOut !== '' ? { stdout: bashOut } : {}),
        ...(bashErr !== undefined && bashErr !== '' ? { stderr: bashErr } : {}),
      });
    }
    w.pendingShell = null;
    return;
  }

  // 7. interruption marker
  if (text.startsWith('[Request interrupted by user')) {
    notice(w, uuid, at, 'interrupted', { forToolUse: text.includes('for tool use') });
    return;
  }

  // 8. a prompt
  const attachments: RowAttachment[] = [];
  blocks.forEach((b, i) => {
    if (obj(b).type === 'image') attachments.push({ kind: 'image', ref: line.raw, blockIndex: i });
  });
  const turnId = str(data.promptId) ?? uuid;
  w.heldLocal = null;
  w.lastCommand = null;
  const q = w.queued.findIndex((x) => x.text === text);
  if (q >= 0) {
    const entry = w.queued[q]!;
    w.queued.splice(q, 1);
    openTurn(w, turnId, 'human');
    const row = getRow(w, entry.rowId);
    if (row !== undefined) setRow(w, { ...row, turnId });
    return;
  }
  openTurn(w, turnId, 'human');
  put(w, { kind: 'user', ...base(w, uuid, at), text, attachments });
}

function lastUserIndex(w: Work): number {
  for (let i = w.rows.length - 1; i >= 0; i -= 1) if (w.rows[i]!.kind === 'user') return i;
  return -1;
}

function foldAttachment(w: Work, line: Extract<ChainLine, { k: 'node' }>): void {
  const a = obj(line.data.attachment);
  const { uuid, at } = line;
  switch (a.type) {
    case 'queued_command': {
      const prompt = str(a.prompt) ?? '';
      if (a.commandMode === 'task-notification') {
        const n = parseNotification(prompt);
        if (n !== null) {
          const usage = obj(a.usage);
          const fallback = num(usage.durationMs);
          const pending: SubPending = n.pending.durationMs === undefined && fallback !== undefined ? { ...n.pending, durationMs: fallback } : n.pending;
          notify(w, n.toolUseId, pending);
        }
      } else if (a.commandMode === 'prompt' && a.humanTurn === true) {
        put(w, { kind: 'user', ...base(w, uuid, at), text: prompt, attachments: [], queued: true });
        w.queued.push({ rowId: uuid, text: prompt });
      }
      return;
    }
    case 'file': {
      const path = str(a.filename);
      const i = lastUserIndex(w);
      if (path === undefined || i < 0) return;
      const row = w.rows[i] as Extract<ConversationRow, { kind: 'user' }>;
      w.rows[i] = { ...row, attachments: [...row.attachments, { kind: 'mention', path }] };
      return;
    }
    case 'plan_mode':
      notice(w, uuid, at, 'informational', { text: 'entrou no modo plano' });
      return;
    case 'edited_text_file': {
      const file = (str(a.filename) ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
      notice(w, uuid, at, 'informational', { text: `arquivo alterado fora da conversa: ${file}` });
      return;
    }
    case 'task_status': {
      const id = Object.keys(w.tools).find((k) => w.tools[k]!.backgroundTaskId === str(a.taskId));
      const status = str(a.status);
      const row = id === undefined ? undefined : getRow(w, w.tools[id]!.rowId);
      if (row !== undefined && row.kind === 'action' && status !== undefined && status !== 'running') {
        setRow(w, { ...row, status: status === 'completed' ? 'ok' : 'error' });
      }
      return;
    }
    case 'hook_non_blocking_error':
    case 'hook_system_message':
    case 'hook_permission_decision':
      notice(w, uuid, at, 'informational', { text: `hook ${str(a.hookName) ?? ''}`.trim(), hook: str(a.hookName) ?? '' });
      return;
    case 'skill_listing':
      return;
    default:
      unknownRow(w, line.unknownLabel ?? `attachment:${str(a.type) ?? '?'}`, uuid, line.raw, at);
  }
}

function foldSystem(w: Work, line: Extract<ChainLine, { k: 'node' }>): void {
  const d = line.data;
  const { uuid, at } = line;
  switch (d.subtype) {
    case 'compact_boundary': {
      const m = obj(d.compactMetadata);
      notice(w, uuid, at, 'compact', { preTokens: num(m.preTokens), postTokens: num(m.postTokens), trigger: str(m.trigger) });
      return;
    }
    case 'turn_duration':
      closeTurn(w);
      return;
    case 'local_command': {
      const run = obj(d.commandRun);
      const args = str(run.args);
      put(w, {
        kind: 'local-command', ...base(w, uuid, at), command: str(run.command) ?? str(d.content) ?? '',
        ...(args !== undefined && args !== '' ? { args } : {}),
        ...(w.heldLocal !== null ? { output: w.heldLocal } : {}),
      });
      w.heldLocal = null;
      return;
    }
    case 'informational':
      notice(w, uuid, at, 'informational', { text: str(d.content) ?? '', level: str(d.level) });
      return;
    case 'stop_hook_summary': {
      const errors = arr(d.hookErrors).map(String);
      if (d.preventedContinuation === true || errors.length > 0) {
        notice(w, uuid, at, 'informational', { text: [str(d.stopReason), ...errors].filter((x) => x).join(': '), level: 'warning' });
      }
      return;
    }
    default:
      unknownRow(w, line.unknownLabel ?? `system:${str(d.subtype) ?? '?'}`, uuid, line.raw, at);
  }
}

function foldLine(w: Work, line: ChainLine): void {
  if (line.k === 'unknown') {
    unknownRow(w, line.typeLabel, line.uuid ?? `unknown:${line.raw.offset}`, line.raw, str(line.data.timestamp) ?? '');
    return;
  }
  if (line.noise === true) return;
  if (w.cwd === '' && typeof line.data.cwd === 'string') w.cwd = line.data.cwd;
  switch (line.role) {
    case 'assistant':
      foldAssistant(w, line);
      return;
    case 'user':
      foldUser(w, line);
      return;
    case 'system':
      foldSystem(w, line);
      return;
    case 'attachment':
      foldAttachment(w, line);
      return;
  }
}

function invalidRow(w: Work, e: Extract<TranscriptEntry, { k: 'invalid' }>): UnknownRow {
  return { kind: 'unknown', ...base(w, `unknown:${e.raw.offset}`, ''), typeLabel: `invalid:${e.reason}`, raw: e.raw };
}

// ---------------------------------------------------------------------------
// runtime cache (chain trackers are classes; the state stays plain data)
// ---------------------------------------------------------------------------

interface Runtime {
  forward?: ForwardChain;
  backward?: BackwardChain;
}
const RUNTIME = new WeakMap<AdapterState, Runtime>();

function forwardOf(state: AdapterState, rt: Runtime): ForwardChain {
  if (rt.forward === undefined) {
    const f = new ForwardChain();
    for (const r of state.recs) f.push(r);
    rt.forward = f;
  }
  return rt.forward;
}


/**
 * `buildActiveChain` only lists attachments chained AFTER the leaf. A prompt queued mid-round
 * (`queued_command`) hangs from a chain line as a SIDE leaf, and the forward follower does show it
 * (it extends the tip). So that every path agrees, side attachments whose parent is on the chain
 * are inserted right after the parent (and the parent's own completions already listed).
 */
function withSideAttachments(recs: readonly ChainLine[], lines: readonly ChainLine[]): ChainLine[] {
  const listed = new Set(lines.map((l) => l.uuid));
  const byParent = new Map<string, ChainLine[]>();
  for (const r of recs) {
    if (r.k !== 'node' || r.role !== 'attachment' || r.noise === true || listed.has(r.uuid)) continue;
    if (r.parentUuid === null) continue;
    const list = byParent.get(r.parentUuid) ?? [];
    list.push(r);
    byParent.set(r.parentUuid, list);
  }
  if (byParent.size === 0) return [...lines];
  const out: ChainLine[] = [];
  for (const l of lines) {
    out.push(l);
    const extra = l.uuid === null ? undefined : byParent.get(l.uuid);
    if (extra !== undefined) out.push(...extra);
  }
  return out;
}

/** Full recomputation from the retained slim lines (rewind, late blocks). */
function refold(
  recs: readonly ChainLine[],
  invalid: readonly InvalidMark[],
  w0: Work,
): Work {
  const w = freshWork({ cwd: w0.cwd, scope: w0.scope, metas: w0.metas }, w0.seen, w0.newUnknown);
  const byAnchor = new Map<string | null, UnknownRow[]>();
  for (const m of invalid) {
    const list = byAnchor.get(m.anchor) ?? [];
    list.push(m.row);
    byAnchor.set(m.anchor, list);
  }
  const emitMarks = (anchor: string | null): void => {
    for (const r of byAnchor.get(anchor) ?? []) put(w, { ...r, turnId: w.cur });
  };
  emitMarks(null);
  for (const line of withSideAttachments(recs, buildActiveChain(recs).lines)) {
    foldLine(w, line);
    if (line.uuid !== null) emitMarks(line.uuid);
  }
  return w;
}

// ---------------------------------------------------------------------------
// turns and patches
// ---------------------------------------------------------------------------

function turnsOf(rows: readonly ConversationRow[], meta: Readonly<Record<string, TurnMeta>>): Turn[] {
  const order: string[] = [];
  const byId = new Map<string, ConversationRow[]>();
  for (const r of rows) {
    if (r.turnId === null) continue;
    let list = byId.get(r.turnId);
    if (list === undefined) {
      list = [];
      byId.set(r.turnId, list);
      order.push(r.turnId);
    }
    list.push(r);
  }
  return order.map((turnId) => {
    const list = byId.get(turnId)!;
    const m = meta[turnId];
    const complete = m?.complete ?? false;
    let finalRowId: string | null = null;
    if (complete) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const r = list[i]!;
        if (r.kind === 'assistant' && r.markdown.trim() !== '') {
          finalRowId = r.id;
          break;
        }
      }
    }
    return { turnId, opener: m?.opener ?? 'resume', rows: list.map((r) => r.id), complete, finalRowId };
  });
}

function same(a: ConversationRow, b: ConversationRow): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function diffForward(oldV: readonly ConversationRow[], newV: readonly ConversationRow[], forceReset: boolean): RowPatch[] {
  if (oldV.length === 0 && newV.length === 0) return [];
  if (forceReset) return [{ op: 'reset', rows: newV }];
  if (oldV.length === 0) return [{ op: 'append', rows: newV }];
  if (newV.length < oldV.length) return [{ op: 'reset', rows: newV }];
  const changed: ConversationRow[] = [];
  for (let i = 0; i < oldV.length; i += 1) {
    if (oldV[i]!.id !== newV[i]!.id) return [{ op: 'reset', rows: newV }];
    if (!same(oldV[i]!, newV[i]!)) changed.push(newV[i]!);
  }
  const patches: RowPatch[] = [];
  if (changed.length > 0) patches.push({ op: 'replace', rows: changed });
  if (newV.length > oldV.length) patches.push({ op: 'append', rows: newV.slice(oldV.length) });
  return patches;
}

function diffBackward(oldV: readonly ConversationRow[], newV: readonly ConversationRow[]): RowPatch[] {
  if (oldV.length === 0) return newV.length === 0 ? [] : [{ op: 'append', rows: newV }];
  const head = newV.length - oldV.length;
  if (head < 0) return [{ op: 'reset', rows: newV }];
  const changed: ConversationRow[] = [];
  for (let i = 0; i < oldV.length; i += 1) {
    const n = newV[head + i]!;
    if (oldV[i]!.id !== n.id) return [{ op: 'reset', rows: newV }];
    if (!same(oldV[i]!, n)) changed.push(n);
  }
  const patches: RowPatch[] = [];
  if (changed.length > 0) patches.push({ op: 'replace', rows: changed });
  if (head > 0) patches.push({ op: 'prepend', rows: newV.slice(0, head) });
  return patches;
}

// ---------------------------------------------------------------------------
// adapt
// ---------------------------------------------------------------------------

function metaOf(prev: AdapterState['meta'], e: Extract<TranscriptEntry, { k: 'meta' }>, onlyIfMissing: boolean): AdapterState['meta'] {
  const p = obj(e.payload);
  let next = prev;
  const set = (key: 'permissionMode' | 'title', value: string | undefined): void => {
    if (value === undefined || (onlyIfMissing && next[key] !== undefined)) return;
    next = { ...next, [key]: value };
  };
  if (e.type === 'permission-mode') set('permissionMode', str(p.permissionMode));
  else if (e.type === 'ai-title') set('title', str(p.aiTitle));
  else if (e.type === 'custom-title') set('title', str(p.customTitle));
  return next;
}

function buildState(
  prev: AdapterState,
  w: Work,
  extra: Pick<AdapterState, 'recs' | 'invalid' | 'meta' | 'backward' | 'leafUuid'>,
): AdapterState {
  return {
    version: 1,
    scope: prev.scope,
    cwd: w.cwd,
    recs: extra.recs,
    invalid: extra.invalid,
    rows: w.rows,
    turns: turnsOf(w.rows, w.turnMeta),
    fold: foldAuxOf(w),
    meta: extra.meta,
    backward: extra.backward,
    leafUuid: extra.leafUuid,
    seenUnknown: [...w.seen],
    subMeta: w.metas,
  };
}

function applyMetas(w: Work, metas: readonly SubagentMeta[] | undefined): void {
  for (const m of metas ?? []) {
    w.metas[m.toolUseId] = { ...w.metas[m.toolUseId], ...m };
    const row = getRow(w, agentRowId(m.toolUseId));
    if (row !== undefined && row.kind === 'subagent') setRow(w, applyMeta(row, w.metas[m.toolUseId]));
  }
}

export function adapt(state: AdapterState, entries: readonly TranscriptEntry[], opts: AdaptOptions = {}): AdaptResult {
  const seen = new Set(state.seenUnknown);
  const newUnknown: string[] = [];
  const oldView = viewOf(state);
  const rt: Runtime = RUNTIME.get(state) ?? {};
  RUNTIME.delete(state); // ownership of the trackers moves to the new state
  const w = workFrom(state, seen, newUnknown);

  let result: AdaptResult;
  if (opts.direction === 'backward') {
    result = adaptBackward(state, entries, opts, w, rt, oldView);
  } else {
    result = adaptForward(state, entries, opts, w, rt, oldView);
  }
  RUNTIME.set(result.state, rt);
  return result;
}

function adaptForward(
  state: AdapterState,
  entries: readonly TranscriptEntry[],
  opts: AdaptOptions,
  w: Work,
  rt: Runtime,
  oldView: readonly ConversationRow[],
): AdaptResult {
  const fwd = forwardOf(state, rt);
  const recs = [...state.recs];
  const invalid = [...state.invalid];
  let meta = state.meta;
  let needRefold = false;
  let forceReset = false;
  applyMetas(w, opts.subagentMetas);

  for (const e of entries) {
    if (e.k === 'invalid') {
      const row = invalidRow(w, e);
      invalid.push({ anchor: fwd.leafUuid, row });
      put(w, row);
      continue;
    }
    if (e.k === 'meta') {
      meta = metaOf(meta, e, false);
      continue;
    }
    const line = slimLine(e);
    const verdict = fwd.push(line);
    recs.push(line);
    if (verdict.kind === 'extend') {
      foldLine(w, line);
    } else if (verdict.kind === 'side') {
      if (verdict.reason === 'tool-result') foldLine(w, line);
      else if (verdict.reason === 'completion') needRefold = true;
    } else {
      needRefold = true;
      forceReset = true;
    }
  }

  const final = needRefold ? refold(recs, invalid, w) : w;
  if (needRefold) applyMetas(final, Object.values(final.metas));
  const next = buildState(state, final, { recs, invalid, meta, backward: state.backward, leafUuid: fwd.leafUuid });
  return {
    state: next,
    patches: diffForward(oldView, viewOf(next), forceReset),
    unknownLabels: w.newUnknown,
  };
}

function adaptBackward(
  state: AdapterState,
  entries: readonly TranscriptEntry[],
  opts: AdaptOptions,
  w: Work,
  rt: Runtime,
  oldView: readonly ConversationRow[],
): AdaptResult {
  if (rt.backward === undefined) rt.backward = new BackwardChain(state.backward);
  const bw = rt.backward;
  let meta = state.meta;
  const accepted: ChainLine[] = [];
  const sideAtts: ChainLine[] = [];
  for (const e of entries) {
    if (e.k === 'meta') {
      meta = metaOf(meta, e, true);
      continue;
    }
    if (e.k === 'invalid') continue;
    const line = slimLine(e);
    const verdict = bw.push(line);
    if (verdict.kind === 'chain') accepted.push(line, ...verdict.released);
    else if (verdict.kind === 'extra') accepted.push(line);
    else if (line.k === 'node' && line.role === 'attachment' && line.noise !== true) sideAtts.push(line);
  }
  const have = new Set(accepted.map((l) => l.uuid));
  for (const a of sideAtts) if (a.parentUuid !== null && have.has(a.parentUuid)) accepted.push(a);
  accepted.sort((a, b) => a.raw.offset - b.raw.offset);

  // Fold the page on its own, seeded with what the newer rows are still waiting for.
  const page = freshWork({ cwd: w.cwd, scope: w.scope, metas: w.metas }, w.seen, w.newUnknown);
  page.orphans = { ...w.orphans };
  page.subPending = { ...w.subPending };
  applyMetas(page, opts.subagentMetas);
  for (const line of accepted) foldLine(page, line);

  const merged = freshWork({ cwd: page.cwd, scope: w.scope, metas: page.metas }, w.seen, w.newUnknown);
  // A prompt queued in this (older) page is delivered by a twin user line already shown in a newer page:
  // keep ONE row, at the queued position, now owned by the twin's turn (same result as reading forward).
  const newer = [...w.rows];
  const pageRows = [...page.rows];
  for (const q of page.queued) {
    const j = newer.findIndex((r) => r.kind === 'user' && r.queued !== true && r.text === q.text && r.turnId !== null);
    const k = pageRows.findIndex((r) => r.id === q.rowId);
    if (j < 0 || k < 0) continue;
    pageRows[k] = { ...pageRows[k]!, turnId: newer[j]!.turnId };
    newer.splice(j, 1);
    page.queued = page.queued.filter((x) => x !== q);
  }
  merged.rows = [...pageRows, ...newer];
  merged.tools = { ...page.tools, ...w.tools };
  merged.turnMeta = { ...page.turnMeta, ...w.turnMeta };
  merged.cur = w.rows.length > 0 ? w.cur : page.cur;
  merged.queued = w.queued;
  merged.lastCommand = w.lastCommand;
  merged.heldLocal = w.heldLocal;
  merged.pendingShell = w.pendingShell;
  merged.orphans = page.orphans;
  merged.subPending = page.subPending;
  merged.rows.forEach((r, i) => merged.idx.set(r.id, i));

  const recs = [...accepted, ...state.recs];
  const next = buildState(state, merged, {
    recs,
    invalid: state.invalid,
    meta,
    backward: { leafUuid: bw.leafUuid, expectedParent: bw.expectedParent, rootReached: bw.rootReached },
    leafUuid: state.leafUuid ?? bw.leafUuid,
  });
  const newView = viewOf(next);
  return {
    state: next,
    patches: state.rows.length === 0 ? diffForward([], newView, false) : diffBackward(oldView, newView),
    unknownLabels: w.newUnknown,
  };
}
