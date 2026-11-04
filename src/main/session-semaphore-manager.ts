import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  applyPermissionHeuristic,
  countBackgroundSubagents,
  defaultMatchesPermissionPrompt,
  INITIAL_SEMAPHORE_STATE,
  reduceSemaphoreState,
  type SemaphoreEvent,
  type SemaphoreMachineState,
} from './semaphore-state-machine';
import type { BridgeEvent, HookBridge } from './hook-bridge';

// T009 — camada de integração (I/O: servidor HTTP local + Maps + timer de
// heurística) sobre a máquina de estados pura (semaphore-state-machine.ts).
// Não é unit-testada isoladamente (mesmo padrão do PtyManager — a cobertura
// de verdade é a máquina pura + o teste manual documentado no addendum T009
// de specs/001-mvp/spike-t002-resultado.md, que validou o fluxo completo
// hook->HTTP->estado num node-pty real).
//
// "Falha/quota esgotada" (5º estado do FR-010) nasce AQUI, não na máquina
// pura: `onProcessExit` marca `error` quando o exit code é != 0, senão
// `done` — é só quem chama (main/index.ts, via PtyManager.onExit) que sabe o
// exit code real.

export type PublicSemaphoreState = 'working' | 'waiting' | 'permission' | 'error' | 'done';

export interface SemaphoreUpdate {
  readonly ptyId: string;
  readonly state: PublicSemaphoreState;
  /** Epoch ms de quando `state` passou a valer — ui-spec §3 (contador "há Xmin") e FR-010/CA-6 (desempate por idade entre permissões pendentes). */
  readonly stateEnteredAt: number;
  /**
   * #109 — presente (e `true`) só quando `state` é `waiting` e o turno fechou com subagente em
   * segundo plano vivo: a sessão vai ser acordada, então ainda não terminou. A aba mostra `waiting`
   * igual; o Jobu não anuncia "terminou" por isso. Ver `SemaphoreMachineState.awaitingBackgroundAgents`.
   */
  readonly awaitingBackgroundAgents?: true;
  /**
   * Item 04 (cartão rico) — no hook heard from this session yet: the `working` it was born with is a
   * guess, and the card says "desconhecido" instead of "trabalhando".
   */
  readonly unconfirmed?: true;
  /** Item 04 — what the open pendings of the chat are (`question`, `permission`, `plan`); only with `permission`. */
  readonly pendingKinds?: readonly string[];
  /**
   * Item 04 — the last turn ended in `StopFailure`: its code (`rate_limit`, `overloaded`…), or
   * `unknown`. Cleared by the next prompt or tool call.
   */
  readonly turnFailure?: string;
}

/**
 * `error` é o código do payload do hook `StopFailure` (`rate_limit`, `overloaded`, `authentication_failed`...; schema
 * do CLI 2.1.3xx), `null` quando falta. notificacoes-completas: vira o motivo curto do aviso "parou com erro".
 */
export type StopFailureListener = (ptyId: string, error: string | null) => void;

/** Mindscape, fatia 03 — see `SessionSemaphoreManager.onTurnEnded`. */
export type TurnEndedListener = (ptyId: string, lastAssistantMessage: string | null, transcriptPath: string | null) => void;
/** Diário de gestos — see `SessionSemaphoreManager.onPromptSubmitted`. */
export type PromptSubmittedListener = (ptyId: string, promptLength: number) => void;

export interface SessionSemaphoreManagerOptions {
  /** Intervalo do tick da heurística de fallback (spike: "a cada ~500ms"). */
  readonly tickIntervalMs?: number;
  /** Timeout da heurística (spike: "2-3s"), injetável por task/CLAUDE.md. */
  readonly permissionHeuristicTimeoutMs?: number;
  readonly now?: () => number;
  /** Ring buffer recente da sessão (ANSI-stripado) — normalmente `ptyManager.getPreview`. */
  readonly getRecentLines: (ptyId: string) => readonly string[];
}

/** Traduz `hook_event_name` do payload pro tipo de evento da máquina pura — `null` = evento que não nos interessa (o CLI pode disparar outros hooks configurados globalmente pelo usuário, ex. SubagentStop). */
export function mapHookEventName(name: unknown): SemaphoreEvent['type'] | null {
  switch (name) {
    case 'UserPromptSubmit':
      return 'userPromptSubmit';
    case 'PreToolUse':
      return 'preToolUse';
    case 'PostToolUse':
      return 'postToolUse';
    case 'Stop':
    case 'StopFailure': // turno encerrado por erro de API (ex. limite da conta) — fim de turno do mesmo jeito.
      return 'stop';
    case 'Notification':
      return 'notification';
    case 'SessionEnd':
      return 'sessionEnd';
    default:
      return null;
  }
}

export class SessionSemaphoreManager {
  private server: Server | null = null;
  private port = 0;
  /** claude `--session-id`/`-r <id>` (session-correlation.ts) -> ptyId do Donel Dev. */
  private readonly sessionToPty = new Map<string, string>();
  private readonly ptyState = new Map<string, SemaphoreMachineState>();
  /** ptyId cujo processo saiu com exit code != 0 — sobrepõe `done` -> `error` na emissão pública. */
  private readonly erroredPtyIds = new Set<string>();
  /** T079 (014-chat) - abas com pendencia aberta (PermissionRequest): o estado publico e `permission` enquanto durar. */
  private readonly pendingOpenPtyIds = new Set<string>();
  /** Item 04 — kinds of the open pendings, by pty (see `SemaphoreUpdate.pendingKinds`). */
  private readonly pendingKindsByPty = new Map<string, readonly string[]>();
  /** Item 04 — ptys from which at least one hook arrived (see `SemaphoreUpdate.unconfirmed`). */
  private readonly heardPtyIds = new Set<string>();
  /** Item 04 — `StopFailure` code of the last turn, by pty (see `SemaphoreUpdate.turnFailure`). */
  private readonly turnFailureByPty = new Map<string, string>();
  private readonly listeners = new Set<(update: SemaphoreUpdate) => void>();
  /**
   * Emenda 22/09 (011-contas-e-provedores, etapa 3, Fase 2, item 4) —
   * `mapHookEventName` funde `Stop` e `StopFailure` no mesmo evento `stop`
   * (fim de turno é fim de turno pro semáforo), então `onUpdate` sozinho não
   * distingue "encerrou por erro de API" de "encerrou normal". Este segundo
   * conjunto de ouvintes existe só pra isso: o gatilho imediato de
   * auto-switch (index.ts) precisa saber especificamente de `StopFailure`,
   * sem duplicar a máquina de estados pura.
   */
  private readonly stopFailureListeners = new Set<StopFailureListener>();
  /**
   * Mindscape, fatia 03 — end of turn (`Stop` and `StopFailure`) with the payload's
   * `last_assistant_message` (`null` when missing or empty) and `transcript_path`
   * (`null` when missing) — the `.jsonl` the CLI itself names, for the tail fallback.
   */
  private readonly turnEndedListeners = new Set<TurnEndedListener>();
  /** Diário de gestos — `UserPromptSubmit`, with the prompt length only (the text is never kept). */
  private readonly promptSubmittedListeners = new Set<PromptSubmittedListener>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private readonly tickIntervalMs: number;
  private readonly permissionHeuristicTimeoutMs: number;
  private readonly now: () => number;
  private readonly getRecentLines: (ptyId: string) => readonly string[];

  constructor(options: SessionSemaphoreManagerOptions) {
    this.tickIntervalMs = options.tickIntervalMs ?? 500;
    this.permissionHeuristicTimeoutMs = options.permissionHeuristicTimeoutMs ?? 2500;
    this.now = options.now ?? Date.now;
    this.getRecentLines = options.getRecentLines;
  }

  /** Sobe o servidor HTTP local (porta efêmera, 127.0.0.1) e o timer da heurística. Devolve a porta pra montar o `--settings` (hooks-settings.ts). */
  async start(): Promise<number> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.port = await new Promise<number>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('SessionSemaphoreManager.start chamado sem servidor'));
        return;
      }
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    this.startTicking();
    return this.port;
  }

  private startTicking(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  /**
   * T014 (014-chat) — transporte novo: o semáforo passa a receber os eventos da
   * ponte de hooks (HTTP + token por aba) já resolvidos por `ptyId`; o mapa por
   * `session_id` não participa. O servidor legado (`start()`) não sobe. Devolve o
   * cancelamento da assinatura.
   */
  attachBridge(bridge: HookBridge): () => void {
    this.startTicking();
    return bridge.onAny((event) => this.handleBridgeEvent(event));
  }

  dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.server?.close();
    this.server = null;
  }

  registerSession(ptyId: string, claudeSessionId: string): void {
    this.sessionToPty.set(claudeSessionId, ptyId);
    this.ptyState.set(ptyId, { ...INITIAL_SEMAPHORE_STATE, stateEnteredAt: this.now() });
    this.emit(ptyId);
  }

  unregisterSession(ptyId: string): void {
    this.ptyState.delete(ptyId);
    this.erroredPtyIds.delete(ptyId);
    this.pendingOpenPtyIds.delete(ptyId);
    this.pendingKindsByPty.delete(ptyId);
    this.heardPtyIds.delete(ptyId);
    this.turnFailureByPty.delete(ptyId);
    for (const [claudeSessionId, mappedPtyId] of this.sessionToPty) {
      if (mappedPtyId === ptyId) this.sessionToPty.delete(claudeSessionId);
    }
  }

  /** `PtyManager.onExit` (evento do SO) — prioridade máxima, spec.md FR-010 "falha/quota esgotada" = exit code != 0. */
  onProcessExit(ptyId: string, exitCode: number): void {
    const current = this.ptyState.get(ptyId) ?? INITIAL_SEMAPHORE_STATE;
    const next = reduceSemaphoreState(current, { type: 'processExit', at: this.now() });
    this.ptyState.set(ptyId, next);
    if (exitCode !== 0) this.erroredPtyIds.add(ptyId);
    this.emit(ptyId);
  }

  /** T079 (014-chat) - o hub do chat avisa quando a aba ganha/perde pendencia aberta. */
  setPendingOpen(ptyId: string, open: boolean, kinds: readonly string[] = []): void {
    // Item 04 — the kinds too (the card's "precisa de você" says why), in a stable order.
    const nextKinds = open ? [...new Set(kinds)].sort() : [];
    const prevKinds = this.pendingKindsByPty.get(ptyId) ?? [];
    const kindsChanged = nextKinds.join(',') !== prevKinds.join(',');
    if (this.pendingOpenPtyIds.has(ptyId) === open && !kindsChanged) return;
    if (open) this.pendingOpenPtyIds.add(ptyId);
    else this.pendingOpenPtyIds.delete(ptyId);
    if (nextKinds.length > 0) this.pendingKindsByPty.set(ptyId, nextKinds);
    else this.pendingKindsByPty.delete(ptyId);
    this.emit(ptyId);
  }

  onUpdate(listener: (update: SemaphoreUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Emenda 22/09 (item 4) — ver comentário do campo `stopFailureListeners`. Mesmo padrão de unsubscribe de `onUpdate`. */
  onStopFailure(listener: StopFailureListener): () => void {
    this.stopFailureListeners.add(listener);
    return () => this.stopFailureListeners.delete(listener);
  }

  /** Mindscape, fatia 03 — feeds the post-it written by the session. Same unsubscribe pattern as `onUpdate`. */
  onTurnEnded(listener: TurnEndedListener): () => void {
    this.turnEndedListeners.add(listener);
    return () => this.turnEndedListeners.delete(listener);
  }

  /** Diário de gestos — a prompt was sent in the session of `ptyId`. Same unsubscribe pattern as `onTurnEnded`. */
  onPromptSubmitted(listener: PromptSubmittedListener): () => void {
    this.promptSubmittedListeners.add(listener);
    return () => this.promptSubmittedListeners.delete(listener);
  }

  getSnapshot(ptyId: string): SemaphoreUpdate | undefined {
    const state = this.ptyState.get(ptyId);
    if (!state) return undefined;
    return this.updateFor(ptyId, state);
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk;
    });
    req.on('end', () => {
      this.handleHookBody(body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  }

  private handleHookBody(rawBody: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return; // hook malformado/vazio — nunca derruba o servidor.
    }
    if (typeof payload !== 'object' || payload === null) return;

    const claudeSessionId = (payload as Record<string, unknown>).session_id;
    if (typeof claudeSessionId !== 'string') return;

    const ptyId = this.sessionToPty.get(claudeSessionId);
    if (!ptyId) return; // sessão claude não rastreada por este app (ex.: settings globais do usuário rodando outra sessão em paralelo).

    const rawHookEventName = (payload as Record<string, unknown>).hook_event_name;
    this.applyHookEvent(ptyId, rawHookEventName, (payload as Record<string, unknown>).reason, payload as Record<string, unknown>);
  }

  private handleBridgeEvent(event: BridgeEvent): void {
    if (!this.ptyState.has(event.ptyId)) return; // aba sem semáforo (ou já encerrada): nada a mover.
    if (event.type === 'hook') {
      this.applyHookEvent(event.ptyId, event.event, undefined, event.payload);
    } else if (event.type === 'session-end') {
      // A ponte já filtra clear/resume; a máquina pura protege de novo (defesa em profundidade).
      this.applyHookEvent(event.ptyId, 'SessionEnd', event.reason, event.payload);
    }
    // 'conversation-switched' não mexe no estado: o semáforo é por aba (ptyId), não por conversa.
  }

  private applyHookEvent(ptyId: string, hookEventName: unknown, reason: unknown, payload: Record<string, unknown>): void {
    // Emenda 22/09 (item 4) — dispara ANTES do mapeamento genérico (que funde
    // StopFailure em 'stop'), pro gatilho imediato de auto-switch saber que este
    // fim de turno foi por erro de API.
    if (hookEventName === 'StopFailure') {
      const error = typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : null;
      for (const listener of this.stopFailureListeners) listener(ptyId, error);
    }
    const eventType = mapHookEventName(hookEventName);
    if (!eventType) return;
    // Item 04 — from now on the state is a fact, not the guess of the birth; and the failure of the
    // last turn lasts until the session moves again.
    this.heardPtyIds.add(ptyId);
    if (hookEventName === 'StopFailure') {
      this.turnFailureByPty.set(ptyId, typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : 'unknown');
    } else if (eventType === 'userPromptSubmit' || eventType === 'preToolUse') {
      this.turnFailureByPty.delete(ptyId);
    }
    const current = this.ptyState.get(ptyId) ?? INITIAL_SEMAPHORE_STATE;
    const event: SemaphoreEvent =
      eventType === 'sessionEnd'
        ? { type: 'sessionEnd', at: this.now(), reason: typeof reason === 'string' ? reason : null }
        : eventType === 'stop'
          ? { type: 'stop', at: this.now(), backgroundAgents: countBackgroundSubagents(payload) }
          : ({ type: eventType, at: this.now() } as SemaphoreEvent);
    const next = reduceSemaphoreState(current, event);
    this.ptyState.set(ptyId, next);
    this.emit(ptyId);
    if (hookEventName === 'UserPromptSubmit') {
      const length = typeof payload.prompt === 'string' ? payload.prompt.length : 0;
      for (const listener of this.promptSubmittedListeners) listener(ptyId, length);
    }
    if (hookEventName === 'Stop' || hookEventName === 'StopFailure') {
      const raw = payload.last_assistant_message;
      const text = typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
      const transcriptPath = typeof payload.transcript_path === 'string' && payload.transcript_path.length > 0 ? payload.transcript_path : null;
      for (const listener of this.turnEndedListeners) listener(ptyId, text, transcriptPath);
    }
  }

  private tick(): void {
    const now = this.now();
    for (const [ptyId, current] of this.ptyState) {
      if (current.state !== 'working' || current.pendingToolSince === null) continue;
      const recentLines = this.getRecentLines(ptyId);
      const next = applyPermissionHeuristic(current, now, this.permissionHeuristicTimeoutMs, recentLines, defaultMatchesPermissionPrompt);
      if (next !== current) {
        this.ptyState.set(ptyId, next);
        this.emit(ptyId);
      }
    }
  }

  private publicStateFor(ptyId: string, state: SemaphoreMachineState): PublicSemaphoreState {
    if (state.state === 'done' && this.erroredPtyIds.has(ptyId)) return 'error';
    if (state.state !== 'done' && this.pendingOpenPtyIds.has(ptyId)) return 'permission';
    return state.state;
  }

  private updateFor(ptyId: string, state: SemaphoreMachineState): SemaphoreUpdate {
    const publicState = this.publicStateFor(ptyId, state);
    const kinds = this.pendingKindsByPty.get(ptyId);
    const failure = this.turnFailureByPty.get(ptyId);
    return {
      ptyId,
      state: publicState,
      stateEnteredAt: state.stateEnteredAt,
      // #109 — a marca só vale sobre `waiting`: com pendência aberta o estado público é `permission`, e isso precisa do dono.
      ...(publicState === 'waiting' && state.awaitingBackgroundAgents === true ? { awaitingBackgroundAgents: true as const } : {}),
      // Item 04 — the extra facts of the rich card; whoever does not read them sees the same update.
      ...(publicState === 'working' && !this.heardPtyIds.has(ptyId) ? { unconfirmed: true as const } : {}),
      ...(publicState === 'permission' && kinds && kinds.length > 0 ? { pendingKinds: kinds } : {}),
      ...(failure && publicState !== 'working' ? { turnFailure: failure } : {}),
    };
  }

  private emit(ptyId: string): void {
    const state = this.ptyState.get(ptyId);
    if (!state) return;
    const update = this.updateFor(ptyId, state);
    for (const listener of this.listeners) listener(update);
  }
}
