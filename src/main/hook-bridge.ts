import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { autoApprovalVerdict, nextClassifierBlocks, NO_CLASSIFIER_BLOCKS, type ClassifierBlocks } from '../shared/chat/pendingQueue';

// T013 — HTTP hook bridge (contracts/hook-bridge.md). The claude CLI posts
// hook events to 127.0.0.1:<ephemeral port>/h/<Event> with a per-tab token in
// `X-Donel-Token`. Non-blocking events are answered `{}` at once;
// `PermissionRequest` is held until the owner decides (or the CLI gives up).
// Payloads are never logged; only (event, ptyId, duration) reach diagnostics.

export const MAX_BODY_BYTES = 32 * 1024 * 1024;
export const PRE_TOOL_USE_TTL_MS = 10_000;
/** Rota `/h/StatusLine` — o comando `statusLine` injetado no `--settings` da sessão posta aqui (hooks-settings.ts). */
export const STATUS_LINE_EVENT = 'StatusLine';

export type HookPayload = Record<string, unknown>;

/** The `decision` object of a `PermissionRequest` answer (contract §3). */
export type PermissionDecision = Record<string, unknown>;

export interface PendingDecisionHandle {
  readonly id: string;
  readonly ptyId: string;
  /** Answers the held request with `D`. Returns false if it was already settled. */
  respond(decision: PermissionDecision): boolean;
  /** Answers `{}`: the TUI dialog keeps being valid. Returns false if already settled. */
  release(): boolean;
}

export type BridgeEvent =
  | { readonly type: 'hook'; readonly ptyId: string; readonly event: string; readonly payload: HookPayload }
  | { readonly type: 'pending'; readonly ptyId: string; readonly handle: PendingDecisionHandle; readonly payload: HookPayload; readonly toolUseId: string | null }
  /** Modo auto or Modo YOLO: the bridge already answered `allow`; nobody decides anything, this is only the trail. */
  | { readonly type: 'auto-approved'; readonly ptyId: string; readonly payload: HookPayload; readonly yolo: boolean }
  | { readonly type: 'expired'; readonly ptyId: string; readonly requestId: string }
  | { readonly type: 'resolved-elsewhere'; readonly ptyId: string; readonly requestId: string }
  | { readonly type: 'cancelled'; readonly ptyId: string; readonly requestId: string }
  | { readonly type: 'conversation-switched'; readonly ptyId: string; readonly sessionId: string; readonly transcriptPath: string | null; readonly source: string }
  | { readonly type: 'session-end'; readonly ptyId: string; readonly reason: string | null; readonly payload: HookPayload }
  /** Ponte da statusline: o JSON do stdin do comando `statusLine` (não é hook — semáforo e chat ignoram). */
  | { readonly type: 'statusline'; readonly ptyId: string; readonly payload: HookPayload };

export type BridgeListener = (event: BridgeEvent) => void;

/** The `notification_type` values of the CLI (2.1.3xx): the only ones that reach the diagnostics log. */
const LOGGED_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'permission_prompt',
  'idle_prompt',
  'auth_success',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
  'agent_completed',
  'worker_permission_prompt',
  'push_notification',
  'computer_use_enter',
  'computer_use_exit',
  'quota_auto_resume',
]);

/** t-45e87762 — which kind of `Notification` arrived, so a wrong "esperando você" can be traced in the log. */
function notificationTypeForLog(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'none';
  return LOGGED_NOTIFICATION_TYPES.has(value) ? value : 'other';
}

export interface HookBridgeOptions {
  readonly now?: () => number;
  /** Receives measurements only: event name, ptyId and duration. */
  readonly diagnostics?: {
    /** `notificationType`: only on `Notification`, and only a value of the CLI's fixed list (never message text). */
    hook(entry: { event: string; ptyId: string; durationMs: number; notificationType?: string }): void;
    autoApproval?(entry: { ptyId: string; tool: string; outcome: 'approved' | 'yolo' | 'after-blocks' }): void;
  };
  /** "Modo auto nunca pede permissão" (Preferências); read at each request. Absent = off. */
  readonly autoNeverAsks?: () => boolean;
  /** Is this tab's project in Modo YOLO? Read at each request, so it reaches sessions already open. Absent = no. */
  readonly projectYolo?: (ptyId: string) => boolean;
  /** Is there a chat to show a pending? `false` answers `{}` at once and the terminal asks. Absent = yes. */
  readonly holdsPendings?: () => boolean;
}

export interface HookBridge {
  start(): Promise<{ port: number }>;
  close(): Promise<void>;
  readonly port: number | null;
  /** Returns the new 128-bit token for this tab (re-registering replaces the old one). */
  /** `token` = reuse a known token (a remote session reattached after a restart keeps the one its CLI holds). */
  registerSession(ptyId: string, token?: string): string;
  /** Forgets the token and cancels the tab's open decisions (each is answered `{}`). */
  unregisterSession(ptyId: string): void;
  /** Subscribes to a tab's events. Returns the unsubscribe function. */
  on(ptyId: string, listener: BridgeListener): () => void;
  /** Subscribes to every tab's events. Returns the unsubscribe function. */
  onAny(listener: BridgeListener): () => void;
}

interface PreToolUseRecord {
  readonly key: string;
  readonly toolUseId: string | null;
  readonly at: number;
}

interface OpenDecision {
  readonly id: string;
  readonly ptyId: string;
  readonly tripleKey: string;
  readonly res: ServerResponse;
  settled: boolean;
  settle(body: string): boolean;
}

interface SessionState {
  readonly ptyId: string;
  token: string;
  readonly preToolUse: PreToolUseRecord[];
  readonly open: Map<string, OpenDecision>;
  sessionId: string | null;
  classifierBlocks: ClassifierBlocks;
}

/** Key-order independent serialization, so `tool_input` compares structurally. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

function tripleKey(payload: HookPayload): string {
  const agent = typeof payload.agent_id === 'string' ? payload.agent_id : '';
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  return `${agent}\u0000${tool}\u0000${canonical(payload.tool_input)}`;
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function permissionAnswer(decision: PermissionDecision): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
}

export function createHookBridge(options: HookBridgeOptions = {}): HookBridge {
  const now = options.now ?? Date.now;
  const byToken = new Map<string, SessionState>();
  const byPty = new Map<string, SessionState>();
  const listeners = new Map<string, Set<BridgeListener>>();
  const anyListeners = new Set<BridgeListener>();
  let server: Server | null = null;
  let port: number | null = null;
  let nextRequestId = 1;

  function emit(event: BridgeEvent): void {
    for (const l of [...(listeners.get(event.ptyId) ?? []), ...anyListeners]) {
      try {
        l(event);
      } catch {
        // a faulty subscriber must not take the bridge down
      }
    }
  }

  function endJson(res: ServerResponse, status: number, body: string): void {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  function readBody(req: IncomingMessage): Promise<{ tooLarge: boolean; raw: string }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          chunks.length = 0; // keep draining, stop buffering
        } else if (!tooLarge) {
          chunks.push(chunk);
        }
      });
      req.on('end', () => resolve({ tooLarge, raw: tooLarge ? '' : Buffer.concat(chunks).toString('utf8') }));
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('aborted')));
    });
  }

  function recentPreToolUse(state: SessionState, key: string): string | null {
    const cutoff = now() - PRE_TOOL_USE_TTL_MS;
    // prune lazily; no timers to leak
    for (let i = state.preToolUse.length - 1; i >= 0; i--) if (state.preToolUse[i].at < cutoff) state.preToolUse.splice(i, 1);
    for (let i = state.preToolUse.length - 1; i >= 0; i--) if (state.preToolUse[i].key === key) return state.preToolUse[i].toolUseId;
    return null;
  }

  function openDecision(state: SessionState, payload: HookPayload, res: ServerResponse, finish: () => void): void {
    const id = `${state.ptyId}:${nextRequestId++}`;
    const key = tripleKey(payload);
    const decision: OpenDecision = {
      id,
      ptyId: state.ptyId,
      tripleKey: key,
      res,
      settled: false,
      settle(body) {
        if (decision.settled) return false;
        decision.settled = true;
        state.open.delete(id);
        endJson(res, 200, body);
        finish();
        return true;
      },
    };
    state.open.set(id, decision);

    // The CLI gave up (timeout/abort): nobody is waiting for an answer anymore.
    res.on('close', () => {
      if (decision.settled || res.writableFinished) return;
      decision.settled = true;
      state.open.delete(id);
      emit({ type: 'expired', ptyId: state.ptyId, requestId: id });
    });

    const handle: PendingDecisionHandle = {
      id,
      ptyId: state.ptyId,
      respond: (d) => decision.settle(permissionAnswer(d)),
      release: () => decision.settle('{}'),
    };
    emit({ type: 'pending', ptyId: state.ptyId, handle, payload, toolUseId: recentPreToolUse(state, key) });
  }

  function dispatch(state: SessionState, event: string, payload: HookPayload): void {
    const sessionId = asString(payload.session_id);
    state.classifierBlocks = nextClassifierBlocks(state.classifierBlocks, event, payload);

    switch (event) {
      case 'PreToolUse':
        state.preToolUse.push({ key: tripleKey(payload), toolUseId: asString(payload.tool_use_id), at: now() });
        break;
      case 'PostToolUse': {
        const key = tripleKey(payload);
        for (const d of [...state.open.values()]) {
          if (d.tripleKey === key && d.settle('{}')) emit({ type: 'resolved-elsewhere', ptyId: state.ptyId, requestId: d.id });
        }
        break;
      }
      case 'SessionStart': {
        const source = asString(payload.source);
        if (sessionId !== null && (source === 'clear' || source === 'resume' || source === 'fork') && sessionId !== state.sessionId) {
          emit({ type: 'conversation-switched', ptyId: state.ptyId, sessionId, transcriptPath: asString(payload.transcript_path), source });
        }
        break;
      }
      case 'SessionEnd': {
        const reason = asString(payload.reason);
        if (sessionId !== null) state.sessionId = sessionId;
        // clear/resume swap the conversation, they do not end the tab's work
        if (reason !== 'clear' && reason !== 'resume') emit({ type: 'session-end', ptyId: state.ptyId, reason, payload });
        return;
      }
      default:
        break;
    }

    if (sessionId !== null) state.sessionId = sessionId;
    emit({ type: 'hook', ptyId: state.ptyId, event, payload });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = now();
    const match = /^\/h\/([A-Za-z]+)$/.exec((req.url ?? '').split('?')[0]);
    if (!match || req.method !== 'POST') {
      req.resume();
      endJson(res, match ? 405 : 404, '');
      return;
    }
    const event = match[1];

    const header = req.headers['x-donel-token'];
    const token = Array.isArray(header) ? header[0] : header;
    const state = token ? byToken.get(token) : undefined;
    if (!state) {
      req.resume();
      res.writeHead(401, { 'Content-Length': 0 });
      res.end();
      return;
    }

    let body: { tooLarge: boolean; raw: string };
    try {
      body = await readBody(req);
    } catch {
      return; // client went away mid-body
    }
    if (body.tooLarge) {
      endJson(res, 413, '');
      return;
    }

    let payload: HookPayload;
    try {
      const parsed: unknown = JSON.parse(body.raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      payload = parsed as HookPayload;
    } catch {
      endJson(res, 400, '');
      return;
    }

    const measure = (): void => {
      const type = event === 'Notification' ? notificationTypeForLog(payload.notification_type) : undefined;
      options.diagnostics?.hook({ event, ptyId: state.ptyId, durationMs: Math.max(0, now() - startedAt), ...(type !== undefined ? { notificationType: type } : {}) });
    };

    if (event === 'PermissionRequest') {
      const verdict = autoApprovalVerdict({
        enabled: options.autoNeverAsks?.() ?? false,
        yolo: options.projectYolo?.(state.ptyId) ?? false,
        payload,
        blocks: state.classifierBlocks,
      });
      const tool = asString(payload.tool_name) ?? '';
      if (verdict === 'approve' || verdict === 'yolo') {
        endJson(res, 200, permissionAnswer({ behavior: 'allow' }));
        measure();
        options.diagnostics?.autoApproval?.({ ptyId: state.ptyId, tool, outcome: verdict === 'yolo' ? 'yolo' : 'approved' });
        emit({ type: 'auto-approved', ptyId: state.ptyId, payload, yolo: verdict === 'yolo' });
        return;
      }
      if (verdict === 'after-blocks') options.diagnostics?.autoApproval?.({ ptyId: state.ptyId, tool, outcome: 'after-blocks' });
      if (options.holdsPendings?.() === false) {
        endJson(res, 200, '{}');
        measure();
        return;
      }
      openDecision(state, payload, res, measure);
      return;
    }

    // Ponte da statusline: o corpo da resposta é o que o `curl` do comando
    // imprime na statusline do CLI, então vai VAZIO. Sem diagnóstico: o CLI
    // roda a statusline a cada resposta e o log é dos hooks.
    if (event === STATUS_LINE_EVENT) {
      res.writeHead(200, { 'Content-Length': 0 });
      res.end();
      emit({ type: 'statusline', ptyId: state.ptyId, payload });
      return;
    }

    endJson(res, 200, '{}'); // answer first: the CLI waits on this hook
    measure();
    dispatch(state, event, payload);
  }

  return {
    get port() {
      return port;
    },

    start() {
      if (server) return Promise.resolve({ port: port as number });
      const s = createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) endJson(res, 500, '');
        });
      });
      s.on('clientError', (_err, socket) => socket.destroy());
      server = s;
      return new Promise((resolve, reject) => {
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
          port = (s.address() as AddressInfo).port;
          resolve({ port });
        });
      });
    },

    close() {
      const s = server;
      server = null;
      port = null;
      for (const state of [...byPty.values()]) this.unregisterSession(state.ptyId);
      if (!s) return Promise.resolve();
      return new Promise((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections();
      });
    },

    registerSession(ptyId, knownToken) {
      const previous = byPty.get(ptyId);
      if (previous) byToken.delete(previous.token);
      const token = knownToken ?? randomBytes(16).toString('hex');
      const state: SessionState = previous ?? { ptyId, token, preToolUse: [], open: new Map(), sessionId: null, classifierBlocks: NO_CLASSIFIER_BLOCKS };
      state.token = token;
      byToken.set(token, state);
      byPty.set(ptyId, state);
      return token;
    },

    unregisterSession(ptyId) {
      const state = byPty.get(ptyId);
      if (!state) return;
      byPty.delete(ptyId);
      byToken.delete(state.token);
      for (const d of [...state.open.values()]) {
        if (d.settle('{}')) emit({ type: 'cancelled', ptyId, requestId: d.id });
      }
    },

    on(ptyId, listener) {
      let set = listeners.get(ptyId);
      if (!set) listeners.set(ptyId, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(ptyId);
      };
    },

    onAny(listener) {
      anyListeners.add(listener);
      return () => anyListeners.delete(listener);
    },
  };
}
