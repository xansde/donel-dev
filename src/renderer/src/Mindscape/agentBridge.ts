// Quadro por MCP — the renderer side of the board and session tools (PDA mindscape-openrig, items 08/13 +
// B37). The main relays each call of the MCP server `donel` here (main/board-bridge.ts) because the renderer
// owns the Mindscape document (ADR 0004) and the tabs. What lives here, in memory:
// - who opened whom (`sessao_abrir`), for the cap of 4 live sessions per caller;
// - the end-of-turn notices to the sessions that hold an arrow to the one that ended (with a guard against
//   two sessions pinging each other forever, and against the same notice twice).
// A message between sessions is never held here (B40, owner 04/11): it goes at once to the destination's send
// driver, which writes it into the CLI's own queue even mid-turn. The only wait is a real dialog drawn on that
// screen (permission, question): the driver waits it out by itself and then sends, nobody clicks.
// Decisions of the owner (04/11): docs/refinamentos/time-de-sessoes-v1.md.
// Líder único (ADR 0007): the session the Jobu opened (the mark on its tab) acts on every board, naming it with
// `quadro`; whom it reaches is the one rule of shared/mindscape/reach.ts. Every other session stays on its own board.
// Back to the Líder único (06/11): a session it opened, or one below that one, sends to `"lider"` (`canReachLeader`).
// Quem responde a quem (dono, 09/11: "não é nem configuração, é comportamento definido por nós nos mindscapes. Só mudar
// quem responde quem"): ONE rule, `whoHears` in reach.ts, read from the board at each notice — the first live place
// above the session by the arrows, else the Líder of its board, else the Líder único. It names who hears what cannot
// wait (`queueUrgent`: a permission open on its screen, a turn that failed, a delivery for acceptance, a record of
// "travada"/"precisa-do-dono") and who takes the tasks of a place that is gone (closed past PASS_ON_GRACE_MS, or never
// started). An arrow drawn or erased in the Mindscape counts at the next notice, with no new version.
// Andamento no ledger (dono, 08/11 and 09/11: "fim de turno e andamento vão só ao ledger"): with `turnNotices` 'ledger'
// (the default) an end of turn is recorded on the session's live task (`recordTurn`) and never sent to a chat, arrow or
// not; a passage of tasks is read in the ledger too. Nothing urgent is lost (Revisor, #324): it counts as told only
// once the CLI of there took it; with nobody to hear it waits and goes when one opens or comes back (`flushUrgent`).
// 'chat' is the old mode, kept for the owner to turn back on (Preferências).

import {
  LEADER_MESSAGE_REFUSAL,
  LEADER_PLACE_IS_THE_OWNERS,
  type LeaderMessageReason,
  applyBoardOps,
  describeBoard,
  hasArrowLink,
  placeState,
  type BoardScopedCall,
  type BoardToolCall,
} from '../../../shared/mindscape/agent-tools';
import { SEND_ANSWER_BY_MS, type MindscapeBoardResponse } from '../../../shared/mindscape/channels';
import { LEADER_OF_ALL, isLeaderOfAllTab, knownBoards, resolveBoard, type KnownBoard } from '../../../shared/mindscape/leader';
import { BOARD_LEADER, LEADER_OF_ALL_FROM, boardLeaders, canFaxineiroClose, canReach, canReachLeader, findPlace, isBoardLeader, isBoardOrchestrator, MY_OPENER, openersOf, whoHears } from '../../../shared/mindscape/reach';
import { FAXINEIRO_OPENER, PC_MACHINE_ID, type FaxineiroLogEntry, type OpeningRoom, type SessionView } from '../../../shared/faxineiro/triggers';
import type { FaxineiroWakeOrder } from '../../../shared/faxineiro/ipc';
import type { LedgerPassedOn, LedgerPassOnRequest, LedgerTurnRecord, LedgerTurnRecorded } from '../../../shared/ledger/channels';
import { failureReasonText } from '../../../shared/attention/rule';
import type { TurnNotices } from '../../../shared/teamPrefs';
import { routePlace, type RouteMachine, type RoutingRules } from '../../../shared/placeRouter';
import { addLink, addPlace, noteCardId, placeCardId, placeHasStarted, placeOfSession, type MindscapeBoard, type MindscapeDoc, type SessionPlaceCard } from '../../../shared/mindscape/model';
import type { SemaphoreState } from '../../../shared';
import { FAXINEIRO_ROLE_ID, LEADER_ROLE_ID, type SessionRole } from '../../../shared/roles';
import type { SendFrom } from '../chat/sendDriver';
import { returnReport, returnVerdict, type ReturnLine } from '../../../shared/sessionReturn';

/**
 * A session opened by `sessao_abrir` that sent no hook in this long did not start: the gate waits up to 30 s for
 * the CLI and the first paste up to 45 s more on a machine short of RAM.
 */
/** How long a tool call from a PTY not yet on a tab waits for it (a reattach after a restart), and how often it looks. */
const CALLER_WAIT_MS = 20_000;
const CALLER_POLL_MS = 500;
const START_GRACE_MS = 90_000;
/** t-d1f072fd — a session opened this long before a memory read still counts against that read's room: it had not grown yet. */
const LAUNCH_SETTLE_MS = 60_000;
/** `sessao_enviar` answers once the message went in, was queued, or failed; past this it says "ainda não entrou". */
const DELIVERY_WAIT_MS = 40_000;
/**
 * `sessao_enviar` answers by the `answerBy` the main stamped on the call (channels.ts, `SEND_ANSWER_BY_MS`), so the
 * sender hears it before the CLI's 60 s cut; this is the least it still waits for the destination when the call reached
 * the renderer late. 12/11 (t-58d7c191) — it waited 90 s (t-81ff5a82) plus the caller wait, past that cut.
 */
const SEND_MIN_WAIT_MS = 1_000;
/**
 * The end-of-turn notice carries the whole last turn up to this ceiling (06/11: at 600, squashed into one line, the
 * Líder acted on half of it). Past it, the cut is said in the notice, never a silent "…".
 */
export const NOTICE_CHARS = 8_000;

/** The body of the end-of-turn notice: the turn as written (lines and lists kept), cut only past `NOTICE_CHARS`, and then out loud. */
export function noticeBody(text: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  const chars = Array.from(body);
  if (chars.length <= NOTICE_CHARS) return body;
  const kept = chars.slice(0, NOTICE_CHARS).join('').trimEnd();
  return `${kept}\n[cortado: ${Array.from(kept).length} de ${chars.length} letras; o resto em sessao_ver_tela]`;
}
/** `sessao_fechar` waits at most this long for the destination's turn to end, then closes anyway. */
export const CLOSE_WAIT_MS = 20_000;
/**
 * A closed tab whose place did not come back in this long is gone: its live tasks pass on. Closing the app or an
 * update never gets here (the timer dies with the window, and a restored tab is not a close).
 */
export const PASS_ON_GRACE_MS = 60_000;
/**
 * Dono, 12/11 (t-5c0df1df) — turn failures that pass by themselves: on a remote place the watchdog (the despertador, in
 * the place's tmux) wakes the session after the reset. They go to the ledger and to whoever is above, or to the Líder
 * of the board, never to the Líder único. Only the usage limit: the despertador wakes no 529 nor 5xx.
 */
export const TRANSIENT_TURN_FAILURES: ReadonlySet<string> = new Set(['rate_limit']);
const CLOSE_POLL_MS = 500;
/** `sessao_fechar` with `recusarPermissao`: how many queued requests it refuses, and how long it waits for each to clear. */
const REFUSE_ROUNDS = 3;
const REFUSE_WAIT_MS = 3_000;

/** One line for the Líder: which tool and what it asks (never just "uma permissão"). */
function describeAsk(ask: PermissionAsk): string {
  const what = ask.what.replace(/\s+/g, ' ').trim();
  return ask.tool ? `${ask.tool}: ${what}` : what;
}

export interface BridgeTab {
  readonly id: string;
  readonly name: string;
  readonly cwd?: string;
  readonly projectName?: string;
  readonly roleId?: string;
  readonly placeId?: string;
  readonly remoteId?: string;
  readonly claudeSessionId?: string;
  readonly sessionType: 'claude' | 'shell';
  /** The Jobu's mark on the Líder único (ADR 0007). */
  readonly leaderOfAll?: boolean;
  /** The place (or `"lider"`) that opened this tab with `sessao_abrir`, kept on an update or a restart. */
  readonly openedBy?: string;
}

export interface OpenSessionRequest {
  readonly projectPath: string;
  readonly projectName?: string;
  readonly placeId: string;
  readonly role: SessionRole;
  readonly name: string;
  readonly remoteId?: string;
  /** The caller's place: the new session is its team, out of the tab bar, also after an update or a restart. */
  readonly openedBy: string;
  /** Sent as soon as the new tab exists (the chat's send driver waits for the session). */
  readonly firstMessage: string;
}

/**
 * `sessao_retomar` (t-1293c818) — what the owner's two clicks on a dormant place do: the conversation of the place again
 * (`sessionId`, resumed where it lives), or, for a place that never started, its first session. Never takes the focus.
 */
export interface ResumePlaceRequest {
  readonly projectPath: string;
  readonly projectName?: string;
  readonly placeId: string;
  /** The conversation to resume; absent = the place never started (it opens like a place of the board). */
  readonly sessionId?: string;
  readonly name: string;
  /** Who had opened the place with `sessao_abrir`, if known: kept on the new tab, like after a restart. */
  readonly openedBy?: string;
  /**
   * The RAM brake of `sessao_abrir` (#375), asked once the machine is known (where the conversation lives, or where a
   * new place opens): why it must not open there now, or `undefined`. Undefined = the app opens and the bridge counts it.
   */
  mayOpenOn(remoteId: string | undefined): string | undefined;
}

/**
 * Sessão durável (t-fb11c6cd) — a session that was open when the app closed to update, expected back on its
 * conversation. Local: the tab reopened at boot (`tabId`). Remote: no tab id; it reattaches by itself (`remote`).
 */
export interface ReturnExpectation {
  readonly tabId?: string;
  readonly sessionId: string;
  readonly projectPath: string;
  readonly name: string;
  readonly remote?: boolean;
  /** Came back with `--session-id` (no message before the update): no resume sign to wait for. */
  readonly fresh?: boolean;
}

export type ResumePlaceOutcome = { readonly ok: true; readonly tabId: string; readonly remoteId?: string } | { readonly ok: false; readonly reason: string };

/** A `sessao_abrir` waiting for room on a full machine (t-b3b26e60), or the launch of one that opened. */
interface QueuedOpen extends OpenSessionRequest {
  /** Opened by the Líder único: its place set and its "terminou" go to it. */
  readonly leader: boolean;
  readonly queuedAt: number;
}

/** How a `sessao_enviar` ended on the destination (`chat/composer/tabSend.ts`, `SendOutcome`). */
export type DeliveryOutcome =
  | { readonly kind: 'entrou' }
  | { readonly kind: 'na-fila' }
  | { readonly kind: 'nao-foi'; readonly reason: string }
  | { readonly kind: 'enviando'; readonly reason?: string }
  /** A tab without the chat view: the line went to its terminal, and nothing reads back whether it entered. */
  | { readonly kind: 'pelo-terminal' };

/**
 * t-1293c818 (3) — a permission request open on a session's screen, as the Líder reads it before answering. `id` names
 * THIS request (the held hook's pending, or the dialog as drawn): "permitir" answers only the id the Líder saw.
 */
export interface PermissionAsk {
  readonly id: string;
  /** `chat`: the hook the app holds (answered through it); `tela`: only drawn by the CLI (answered with a key). */
  readonly source: 'chat' | 'tela';
  /** The tool asked for, when the app knows it (the hook says; the screen only draws it inside `what`). */
  readonly tool?: string;
  /** What it asks: the command, the file, or the dialog as drawn. */
  readonly what: string;
  /** false = what was read is not all it asks (cut, or the dialog's top off the screen): only a refusal goes. */
  readonly complete?: boolean;
}

export type PermissionAnswer = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface AgentBridgePorts {
  readonly loaded: boolean;
  doc(): MindscapeDoc;
  /** One owner gesture (undoable): the reducer runs synchronously, or not at all when the board did not load. */
  applyGesture(projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc): void;
  tabs(): readonly BridgeTab[];
  tabOfPty(ptyId: string): BridgeTab | undefined;
  /** Live state of an open tab; `undefined` = the process left. */
  stateOf(tabId: string): SemaphoreState | undefined;
  /** Sessões remotas — the ssh of that tab dropped and its process lives on the place ("sem ligação"). */
  linkLost?(tabId: string): boolean;
  /** `sessao_religar` (t-1293c818) — the app registers again the keys (hooks, MCP) the CLI of that tab holds. */
  relinkTools?(tabId: string): Promise<{ readonly ok: boolean; readonly text: string }>;
  roles(): readonly SessionRole[];
  /** Opens the tab of a place without stealing the focus and sends its first message; returns the tab id. */
  openSession(request: OpenSessionRequest): string;
  /** `sessao_retomar`: reopens a closed (or never started) place, as the owner's two clicks do; absent = not here. */
  resumePlace?(request: ResumePlaceRequest): Promise<ResumePlaceOutcome>;
  /** Closes the tab the way the app does (kills the process through `pty:kill`); the place stays, "fechada". */
  closeTab(tabId: string): void;
  /** One notice of the app (another session ended, started, must pause) to the session of `tabId`: a `session` send. */
  sendLine(tabId: string, text: string): void;
  /**
   * One line to the session of `tabId`, waiting (up to `waitMs`) for the CLI of there to take it or give up. `from`
   * says whose it is (06/11): `owner` (what he wrote on a card or in "Pedir") goes first and is never glued to a
   * notice; `session` (`sessao_enviar`) waits for the owner and may go in with the other notices.
   */
  deliverLine(tabId: string, text: string, waitMs: number, from: SendFrom): Promise<DeliveryOutcome>;
  /** A permission prompt is drawn on that tab's screen right now (read from the screen, never from a mark). */
  permissionOnScreen(tabId: string): boolean;
  /** The permission request open on that tab (the held hook first, else the dialog read from its screen); `null` = none. */
  permissionAsk?(tabId: string): Promise<PermissionAsk | null>;
  /** Answers the request `askId` of that tab; refuses when what is open now is another one (never answers blind). */
  answerPermission?(tabId: string, askId: string, answer: 'allow' | 'deny'): Promise<PermissionAnswer>;
  /** No hook came from that session yet (no prompt submitted, no tool): its "working" is the birth guess, not a fact. */
  unconfirmed(tabId: string): boolean;
  /** Why that session is not taking its first message, read from its process and screen (`null` = nothing to see). */
  startTrouble(tabId: string): string | null;
  /**
   * Live sessions one caller may have opened with `sessao_abrir` before the owner is asked (Preferências, "Limite de
   * sessões abertas por um Líder"; the Líder único counts per board). `null` or absent = no limit.
   */
  openCap?(): number | null;
  /** The owner allows (true) or denies a session over the cap. */
  askOwner(question: { readonly caller: string; readonly role: string; readonly request: string; readonly open: number }): Promise<boolean>;
  remoteLabel(remoteId: string): string;
  /** The remote places the app knows (id + label), for `onde` of `sessao_abrir`. */
  remotes(): readonly { readonly id: string; readonly label: string }[];
  /** t-89f14324 — `team.routing` of the config: the fixed rule for a `sessao_abrir` without `onde`. Absent = off. */
  routing?(): RoutingRules | null | undefined;
  /** The projects of the sidebar (path + name): the Líder único may name one that has no board yet. */
  projects(): readonly { readonly path: string; readonly name: string }[];
  /** 06/11 — the live tasks of gone places pass on (the main writes the ledger); answers what moved. */
  passOn?(requests: readonly LedgerPassOnRequest[]): Promise<readonly LedgerPassedOn[]>;
  /** t-b3b26e60 — since when the tab is in its current state (epoch ms); `undefined` = no reading. */
  stateEnteredAt?(tabId: string): number | undefined;
  /** t-b3b26e60 — lines for `<userData>/rotinas/faxineiro.log` (each close the Faxineiro asks for, each wake). */
  logFaxineiro?(entries: readonly FaxineiroLogEntry[]): void;
  /** 08/11 — where the end of a turn goes (Preferências): 'ledger' (absent = this) or 'chat' (the old "◆ … terminou"). */
  turnNotices?(): TurnNotices;
  /** 08/11 — the end of a turn, recorded on the session's live task (the main writes the ledger). */
  recordTurn?(record: LedgerTurnRecord): Promise<LedgerTurnRecorded> | void;
  /** The `StopFailure` code of the last turn of that tab (`rate_limit`…), if it failed; read, never computed here. */
  turnFailureOf?(tabId: string): string | undefined;
}

/** Sessões remotas — the process lives on the place but its ssh dropped (main/remote-link.ts); never "fechada". */
const LINK_LOST = 'sem ligação';

const STATE_NAMES: Readonly<Record<SemaphoreState, string>> = {
  working: 'trabalhando',
  waiting: 'parada',
  done: 'parada',
  permission: 'precisa do dono',
  error: 'parou com erro',
};

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

type Answer = Omit<MindscapeBoardResponse, 'requestId'>;

/** How a message to the Líder único says why it came (`motivo` of `sessao_enviar`). */
const LEADER_REASON_WORDS: Readonly<Record<LeaderMessageReason, string>> = { 'tarefa-completa': 'tarefa completa', bloqueio: 'bloqueio' };

/** A chair that tried to go over the live Líder of its board (`boardLeader`) to the Líder único. */
function overBoardLeaderRefusal(boardLeader: string): string {
  return `Não mandei: este quadro tem Líder aberto (${boardLeader}). Fale com ele ("para": "${BOARD_LEADER}") ou registre no Oráculo (tarefa_andamento "travada"/"precisa-do-dono"); ao Líder único só vai o que o Líder do quadro não resolve.`;
}


/** Who calls a board-scoped tool, on which board. `self` is the caller's place; the Líder único has none. */
interface Scope {
  readonly projectPath: string;
  readonly projectName?: string;
  readonly leader: boolean;
  readonly self?: SessionPlaceCard;
}

export class AgentBridge {
  private ports: AgentBridgePorts;
  /** Tab opened by `sessao_abrir` → the caller's place. */
  private readonly openedBy = new Map<string, string>();
  /** Tab that last got an end-of-turn notice → the place that ended (the loop guard). */
  private readonly lastNoticeFrom = new Map<string, string>();
  /** Session → text of the last turn it was announced for: the same end of turn is announced once. */
  private readonly lastNoticeText = new Map<string, string>();
  /** Tab opened by `sessao_abrir` → when (its start is judged against START_GRACE_MS). */
  private readonly openedAt = new Map<string, number>();
  /** Tab opened by `sessao_abrir` → the pending check of its start (and the report it makes). */
  private readonly startChecks = new Map<string, { readonly timer: ReturnType<typeof setTimeout>; readonly report: () => boolean }>();
  /** Tabs the Líder único sent work to with `sessao_enviar`: their end-of-turn notices go to it, on any board. */
  private readonly leaderHears = new Set<string>();
  /** Places the Líder único opened in this run (`projectPath\nplaceId`); the tabs' `openedBy` covers a restart. */
  private readonly leaderOpened = new Set<string>();
  /** A closed place waiting PASS_ON_GRACE_MS before its tasks pass on (`projectPath\nplaceId` → timer). */
  private readonly passOnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Tab → the urgent situation already queued (permission, failure): queued once until it clears. */
  private readonly toldUrgent = new Map<string, string>();
  /** What cannot wait and was not taken yet by a Líder's CLI (`tab:<id>` for a situation, `n:<seq>` for the rest). */
  private readonly pendingUrgent = new Map<string, { readonly tabId: string; readonly words: string; readonly transient: boolean; sending: boolean }>();
  private urgentSeq = 0;
  /** t-b3b26e60 — machines where a new session waits for room (`pc` or a remote id → why), from the minute round. */
  private fullMachines = new Map<string, readonly string[]>();
  /** t-d1f072fd — new sessions each machine's last read has room for (`pc` or a remote id), from the minute round. */
  private openingRoom = new Map<string, OpeningRoom>();
  /** t-d1f072fd — when this bridge opened a session on each machine (`pc` or a remote id), to count against the room. */
  private readonly launchedOn = new Map<string, number[]>();
  /** t-b3b26e60 — the `sessao_abrir` waiting for room, oldest first. In memory: a restart leaves them "não começou". */
  private openQueue: QueuedOpen[] = [];
  /**
   * `sessao_retomar` in flight or just done (`projectPath\nplaceId` → its tab, `null` while the app locates the
   * conversation). The new tab reaches the list only on a later render, a remote one binds its conversation seconds
   * later: until the tab is seen, the place counts as open, so a second call never resumes the same conversation twice.
   */
  private readonly resuming = new Map<string, { readonly tabId: string | null; readonly at: number }>();
  /** t-b3b26e60 — what each tab opened by `sessao_abrir` was asked: a tab that never started can go back to the queue. */
  private readonly launched = new Map<string, QueuedOpen>();
  /** Sessão durável — the boards whose team is coming back from an update, until their Líder heard who did. */
  private readonly returning = new Map<string, { readonly since: number; readonly entries: readonly ReturnExpectation[]; sending: boolean }>();

  constructor(ports: AgentBridgePorts) {
    this.ports = ports;
  }

  setPorts(ports: AgentBridgePorts): void {
    this.ports = ports;
  }

  /**
   * Cartas forma A (Parte B) — what the owner wrote on a card: to the session of the place that owns the task, at
   * once (the same send driver as `sessao_enviar`); when it is closed, never started, or the message did not go in,
   * to the Líder único; with nobody open, nowhere (the card keeps it). No `placeId` (a request of the owner from
   * the Oráculo's "Pedir", answering no card): straight to the Líder único.
   */
  async deliverOwnerMessage(message: { readonly projectPath: string; readonly placeId: string; readonly text: string; readonly leaderText: string }): Promise<{ readonly placeId: string } | 'lider' | null> {
    const target = message.placeId ? this.tabOfPlace(message.projectPath, message.placeId) : undefined;
    if (target && !this.ports.unconfirmed(target.id)) {
      const outcome = await this.ports.deliverLine(target.id, message.text, DELIVERY_WAIT_MS, 'owner');
      if (outcome.kind !== 'nao-foi') return { placeId: message.placeId };
    }
    const leader = this.leaderTab();
    // A request with no card waits on the PC (its queue retries) while the Líder is still starting: sent to a CLI
    // that never sent a hook, it can fail half-way, stay in the box and go in twice with the retry (e2e 06/11).
    if (leader && (message.placeId || !this.ports.unconfirmed(leader.id))) {
      const outcome = await this.ports.deliverLine(leader.id, message.leaderText, DELIVERY_WAIT_MS, 'owner');
      if (outcome.kind !== 'nao-foi') return 'lider';
    }
    return null;
  }

  /** A tab reopened after an update or a restart that had been opened by `opener` (counts for its cap again). */
  adoptOpened(tabId: string, opener: string): void {
    this.openedBy.set(tabId, opener);
  }

  dispose(): void {
    this.toldUrgent.clear();
    this.pendingUrgent.clear();
    this.lastNoticeFrom.clear();
    this.lastNoticeText.clear();
    this.leaderHears.clear();
    for (const check of this.startChecks.values()) clearTimeout(check.timer);
    this.startChecks.clear();
    for (const timer of this.passOnTimers.values()) clearTimeout(timer);
    this.passOnTimers.clear();
  }

  // ---- a place that is gone passes its tasks on (t-e753b554) -------------------------------------------------

  /**
   * The tab of `tabId` is being closed (by the owner or `sessao_fechar`; never by closing the app). Called BEFORE it
   * leaves the tab list, so its place is still known. If the place has no live tab after PASS_ON_GRACE_MS, its live
   * tasks pass on.
   */
  placeClosed(tabId: string): void {
    this.launched.delete(tabId);
    this.passOnAfterGrace(tabId);
  }

  /**
   * The CLI of `tabId` exited and the tab stays on screen (App's `tabExits`): its live tasks pass on as from a closed
   * tab, unless its process is back within PASS_ON_GRACE_MS (it has a state again). Dono, 12/11 (t-5c0df1df).
   */
  placeExited(tabId: string): void {
    this.passOnAfterGrace(tabId);
  }

  /** If the place of `tabId` has no live tab after PASS_ON_GRACE_MS, its live tasks pass on (`gone: 'fechada'`). */
  private passOnAfterGrace(tabId: string): void {
    const tab = this.ports.tabs().find((candidate) => candidate.id === tabId);
    if (!tab?.cwd || isLeaderOfAllTab(tab)) return;
    const place = this.placeOfTab(tab);
    if (!place) return;
    const projectPath = tab.cwd;
    const key = `${projectPath}\n${place.id}`;
    clearTimeout(this.passOnTimers.get(key));
    this.passOnTimers.set(
      key,
      setTimeout(() => {
        this.passOnTimers.delete(key);
        if (this.tabOfPlace(projectPath, place.id) || this.isQueued(projectPath, place.id)) return; // it came back, or waits in the queue
        void this.passOn([{ projectPath, placeId: place.id, gone: 'fechada' }]);
      }, PASS_ON_GRACE_MS),
    );
  }

  /**
   * The state of every place of each board in `pastas` (`sessao_listar`'s `estado`), by the folder asked. A folder that
   * is no board stays out (unknown). The ledger's orphans read it: `tarefa_listar` through the main, the box directly.
   */
  placeStates(pastas: readonly string[]): Map<string, Map<string, string>> {
    const states = new Map<string, Map<string, string>>();
    for (const pasta of pastas) {
      const match = resolveBoard(this.boards(), pasta);
      if (!match.ok) continue;
      const board = this.board(match.board.projectPath);
      const places = board ? Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session') : [];
      states.set(pasta, new Map(places.map((place) => [place.id, this.stateName(match.board.projectPath, place)])));
    }
    return states;
  }

  /** Places of every board that never started: their tasks pass on once the main's grace is over (`ownerGone`). */
  checkNotStarted(): Promise<void> {
    if (!this.ports.loaded) return Promise.resolve();
    const gone: { projectPath: string; placeId: string; gone: 'nao-comecou' }[] = [];
    for (const [projectPath, board] of Object.entries(this.ports.doc().boards)) {
      for (const card of Object.values(board.cards))
        if (card.kind === 'session' && !placeHasStarted(card) && !this.isQueued(projectPath, card.id)) gone.push({ projectPath, placeId: card.id, gone: 'nao-comecou' });
    }
    return this.passOn(gone);
  }

  /** Names who takes the work of each gone place, has the main move it, and tells whoever got something. */
  private async passOn(gone: readonly Omit<LedgerPassOnRequest, 'to'>[]): Promise<void> {
    if (!this.ports.passOn || gone.length === 0) return;
    // Dono, 09/11: the same rule as the notices (`whoHears`): the first live place above by the arrows, else the Líder
    // of the board, else the Líder único.
    const requests = gone.map((request) => ({ ...request, to: whoHears(this.board(request.projectPath), request.placeId, (id) => this.hears(request.projectPath, id)) }));
    let passed: readonly LedgerPassedOn[] = [];
    try {
      passed = await this.ports.passOn(requests);
    } catch {
      return; // nothing moved; the next close or check tries again
    }
    // 08/11 — with the notices in the ledger, the passage is read there (tarefa_novidades), not in a chat.
    if (!this.chatMode()) return;
    for (const moved of passed) {
      const leader = moved.to === LEADER_OF_ALL;
      const target = leader ? this.leaderTab() : this.tabOfPlace(moved.projectPath, moved.to);
      if (!target) continue; // the Líder único closed: the tasks wait in its name, alive
      const card = this.board(moved.projectPath)?.cards[moved.placeId];
      const role = card?.kind === 'session' ? this.roleName(card.roleId) : undefined;
      const which = moved.tasks.map((task) => `${task.id}${task.title ? ` «${task.title}»` : ''}`).join(', ');
      const where = leader ? `, quadro ${this.boardName(moved.projectPath)}` : '';
      const why = gone.find((request) => request.projectPath === moved.projectPath && request.placeId === moved.placeId)?.gone === 'nao-comecou' ? 'não começou' : 'fechou';
      this.ports.sendLine(
        target.id,
        `◆ O lugar ${role ? `${role} ` : ''}(${moved.placeId}${where}) ${why}, e ${moved.tasks.length === 1 ? 'esta tarefa passou' : 'estas tarefas passaram'} para você: ${which}. Leia com tarefa_ver e assuma com tarefa_assumir (ou passe adiante com tarefa_transferir).`,
      );
    }
  }

  // ---- Faxineiro com gatilhos (t-b3b26e60) ----------------------------------------------------------------------

  /** The full machines of the last minute round (`pc` or a remote id → why), and the room each last read left. */
  setFullMachines(full: Readonly<Record<string, readonly string[]>>, room: Readonly<Record<string, OpeningRoom>> = {}): void {
    this.fullMachines = new Map(Object.entries(full));
    this.openingRoom = new Map(Object.entries(room));
  }

  /**
   * t-d1f072fd — why a new session waits on this machine (`pc` or a remote id), or `undefined` when it has room: full by
   * the last round, or already given, since its last read, as many sessions as that read had room for. A session that
   * opened up to `LAUNCH_SETTLE_MS` before the read still counts: it had not grown to its RAM yet.
   */
  private waitReasons(machine: string): readonly string[] | undefined {
    const full = this.fullMachines.get(machine);
    if (full) return full;
    const room = this.openingRoom.get(machine);
    if (!room) return undefined;
    const since = room.checkedAt - LAUNCH_SETTLE_MS;
    const recent = (this.launchedOn.get(machine) ?? []).filter((at) => at >= since);
    this.launchedOn.set(machine, recent);
    if (recent.length < room.sessions) return undefined;
    const where = machine === PC_MACHINE_ID ? 'este computador' : this.ports.remoteLabel(machine);
    if (room.sessions === 0) return [`${where}: sem vaga na última leitura de memória${machine === PC_MACHINE_ID ? ' (o PC guarda metade da RAM livre)' : ''}`];
    return [`${where}: ${recent.length} aberturas desde a última leitura de memória, e ela tinha vaga para ${room.sessions}`];
  }

  /** t-89f14324 — how many more sessions the last memory read left room for on this machine; `undefined` = no read. */
  private roomLeft(machine: string): number | undefined {
    const room = this.openingRoom.get(machine);
    if (!room) return undefined;
    const since = room.checkedAt - LAUNCH_SETTLE_MS;
    const recent = (this.launchedOn.get(machine) ?? []).filter((at) => at >= since).length;
    return Math.max(0, room.sessions - recent);
  }

  /**
   * Opens what waits in the queue on machines that have room again: oldest first, one per machine per call (the next
   * minute takes the next one, so a freed machine is not flooded at once). A place the owner deleted, or started by
   * hand meanwhile, leaves the queue.
   */
  drainQueue(): FaxineiroLogEntry[] {
    const out: FaxineiroLogEntry[] = [];
    const used = new Set<string>();
    const keep: QueuedOpen[] = [];
    for (const entry of this.openQueue) {
      const machine = entry.remoteId ?? PC_MACHINE_ID;
      const at = Date.now();
      if (this.board(entry.projectPath)?.cards[entry.placeId]?.kind !== 'session' || this.tabOfPlace(entry.projectPath, entry.placeId)) {
        out.push({ at, kind: 'saiu-da-fila', projectPath: entry.projectPath, placeId: entry.placeId, summary: `${entry.name}: o lugar foi apagado ou aberto à mão` });
        continue;
      }
      if (this.waitReasons(machine) || used.has(machine)) {
        keep.push(entry);
        continue;
      }
      used.add(machine);
      this.launch(entry);
      const waited = Math.round((at - entry.queuedAt) / 60_000);
      out.push({ at, kind: 'abriu-da-fila', projectPath: entry.projectPath, placeId: entry.placeId, summary: `${entry.name}: abriu depois de ${waited} min na fila` });
    }
    this.openQueue = keep;
    return out;
  }

  /** A `sessao_retomar` of this place is locating the conversation, or opened a tab the bridge has not seen bind yet. */
  private resumeInFlight(key: string): boolean {
    const entry = this.resuming.get(key);
    if (!entry) return false;
    if (entry.tabId === null) return true;
    const seen = this.ports.tabs().some((tab) => tab.id === entry.tabId);
    // Seen and bound (`tabOfPlace` answers for it now), seen and gone, or never seen in the grace: the mark is over.
    if ((seen && this.ports.stateOf(entry.tabId) === undefined) || (!seen && Date.now() - entry.at > START_GRACE_MS)) {
      this.resuming.delete(key);
      return false;
    }
    if (seen) {
      const [projectPath, placeId] = key.split('\n') as [string, string];
      if (this.tabOfPlace(projectPath, placeId)?.id === entry.tabId) {
        this.resuming.delete(key);
        return false;
      }
    }
    return true;
  }

  private isQueued(projectPath: string, placeId: string): boolean {
    return this.openQueue.some((entry) => entry.projectPath === projectPath && entry.placeId === placeId);
  }

  /** Opens the tab of a `sessao_abrir` (now, or out of the queue) and keeps what it was asked. */
  private launch(entry: QueuedOpen): string {
    const request: OpenSessionRequest = {
      projectPath: entry.projectPath,
      ...(entry.projectName ? { projectName: entry.projectName } : {}),
      placeId: entry.placeId,
      role: entry.role,
      name: entry.name,
      ...(entry.remoteId ? { remoteId: entry.remoteId } : {}),
      openedBy: entry.openedBy,
      firstMessage: entry.firstMessage,
    };
    const tabId = this.ports.openSession(request);
    const machine = entry.remoteId ?? PC_MACHINE_ID;
    this.launchedOn.set(machine, [...(this.launchedOn.get(machine) ?? []), Date.now()]);
    this.openedBy.set(tabId, entry.openedBy);
    this.openedAt.set(tabId, Date.now());
    this.launched.set(tabId, entry);
    if (entry.leader) this.leaderOpened.add(`${entry.projectPath}\n${entry.placeId}`);
    this.watchStart(tabId, entry.projectPath, entry.openedBy, entry.placeId, entry.name);
    return tabId;
  }

  /** The open session tabs of the boards, as the triggers read them (the Líder único has no board: left out). */
  faxineiroSessions(): SessionView[] {
    const out: SessionView[] = [];
    for (const tab of this.ports.tabs()) {
      if (tab.sessionType !== 'claude' || !tab.cwd || isLeaderOfAllTab(tab)) continue;
      const state = this.ports.stateOf(tab.id);
      const place = this.placeOfTab(tab);
      const enteredAt = this.ports.stateEnteredAt?.(tab.id);
      if (state === undefined || !place || enteredAt === undefined) continue;
      const openedBy = tab.openedBy ?? this.openedBy.get(tab.id);
      out.push({
        projectPath: tab.cwd,
        placeId: place.id,
        name: this.roleName(place.roleId) ?? tab.name,
        ...(place.roleId ? { roleId: place.roleId } : {}),
        machineId: tab.remoteId ?? PC_MACHINE_ID,
        // the birth guess (no hook yet) counts as working: never judged stopped by mistake
        working: state === 'working' || this.ports.unconfirmed(tab.id),
        needsOwner: state === 'permission' || state === 'error' || this.ports.permissionOnScreen(tab.id),
        stateEnteredAt: enteredAt,
        openedBySession: openedBy !== undefined,
        ...(openedBy !== undefined ? { openedBy } : {}),
      });
    }
    return out;
  }

  /**
   * Wakes the Faxineiro of a board: its chair with a tab open and stopped gets the message; a chair without a tab (or
   * no chair yet: it is born on the board, out of the arrows) gets a new session. One working is left alone.
   */
  async wakeFaxineiro(order: FaxineiroWakeOrder): Promise<FaxineiroLogEntry> {
    const at = Date.now();
    const entry = (kind: FaxineiroLogEntry['kind'], summary: string, placeId?: string): FaxineiroLogEntry => ({
      at,
      kind,
      projectPath: order.projectPath,
      ...(placeId ? { placeId } : {}),
      summary: `${order.reasons.join('; ')} → ${summary}`,
    });
    const role = this.ports.roles().find((candidate) => candidate.id === FAXINEIRO_ROLE_ID);
    if (!role) return entry('falhou', 'não existe o papel faxineiro');
    if (!this.ports.loaded) return entry('falhou', 'o quadro ainda não carregou');
    const board = this.board(order.projectPath);
    if (!board) return entry('falhou', 'o projeto não tem quadro');
    const chairs = Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session' && card.roleId === FAXINEIRO_ROLE_ID);
    for (const chair of chairs) {
      const tab = this.tabOfPlace(order.projectPath, chair.id);
      if (!tab) continue;
      if (this.ports.stateOf(tab.id) === 'working') return entry('segurou', 'o Faxineiro está trabalhando', chair.id);
      const outcome = await this.ports.deliverLine(tab.id, order.text, DELIVERY_WAIT_MS, 'session');
      return outcome.kind === 'nao-foi' ? entry('falhou', `a mensagem não entrou (${outcome.reason})`, chair.id) : entry('acordou', 'mensagem ao Faxineiro aberto', chair.id);
    }
    let placeId = chairs[0]?.id;
    if (placeId === undefined) {
      const made = placeCardId(crypto.randomUUID());
      let added = false;
      this.ports.applyGesture(order.projectPath, (doc) => {
        const next = addPlace(doc, order.projectPath, { id: made, roleId: role.id, by: 'session' });
        added = next !== doc;
        return next;
      });
      if (!added) return entry('falhou', 'o quadro não aceitou a cadeira');
      placeId = made;
    }
    const tabId = this.ports.openSession({
      projectPath: order.projectPath,
      placeId,
      role,
      name: role.name,
      ...(order.remoteId ? { remoteId: order.remoteId } : {}),
      openedBy: FAXINEIRO_OPENER,
      firstMessage: order.text,
    });
    this.openedBy.set(tabId, FAXINEIRO_OPENER);
    this.openedAt.set(tabId, Date.now());
    return entry('acordou', `abriu o Faxineiro em ${order.remoteId ? this.ports.remoteLabel(order.remoteId) : 'este computador'}`, placeId);
  }

  /** Closes a Faxineiro the app opened that finished its round (stopped, nothing for the owner); `null` = left open. */
  closeIdleFaxineiro(projectPath: string, placeId: string): FaxineiroLogEntry | null {
    const tab = this.tabOfPlace(projectPath, placeId);
    if (!tab || (tab.openedBy ?? this.openedBy.get(tab.id)) !== FAXINEIRO_OPENER) return null;
    if (this.ports.stateOf(tab.id) !== 'waiting' && this.ports.stateOf(tab.id) !== 'done') return null;
    if (this.ports.permissionOnScreen(tab.id)) return null;
    this.ports.closeTab(tab.id);
    this.openedBy.delete(tab.id);
    return { at: Date.now(), kind: 'fechou-faxineiro', projectPath, placeId, summary: 'a ronda acabou e o Faxineiro ficou parado' };
  }

  private boardName(projectPath: string): string {
    return this.boards().find((board) => board.projectPath === projectPath)?.name ?? lastSegment(projectPath);
  }

  // ---- helpers ------------------------------------------------------------------------------------------------

  private board(projectPath: string): MindscapeBoard | undefined {
    return this.ports.doc().boards[projectPath];
  }

  private placeOfTab(tab: BridgeTab): SessionPlaceCard | undefined {
    if (!tab.cwd) return undefined;
    const board = this.board(tab.cwd);
    if (!board) return undefined;
    if (tab.claudeSessionId) {
      const bound = placeOfSession(board, tab.claudeSessionId);
      if (bound) return bound;
    }
    const card = tab.placeId ? board.cards[tab.placeId] : undefined;
    return card?.kind === 'session' ? card : undefined;
  }

  private tabOfPlace(projectPath: string, placeId: string): BridgeTab | undefined {
    return this.ports.tabs().find((tab) => tab.cwd === projectPath && this.placeOfTab(tab)?.id === placeId && this.ports.stateOf(tab.id) !== undefined);
  }

  private roleName(roleId: string | undefined): string | undefined {
    return roleId ? (this.ports.roles().find((role) => role.id === roleId)?.name ?? roleId) : undefined;
  }

  private stateName(projectPath: string, card: SessionPlaceCard): string {
    return placeState(card, (sessionId) => {
      const tab = this.ports.tabs().find((candidate) => candidate.cwd === projectPath && candidate.claudeSessionId === sessionId);
      const state = tab ? this.ports.stateOf(tab.id) : undefined;
      if (tab && state !== undefined && this.ports.linkLost?.(tab.id)) return LINK_LOST;
      if (tab && state === 'working' && this.ports.unconfirmed(tab.id)) return this.startState(tab.id);
      return state ? STATE_NAMES[state] : undefined;
    });
  }

  /**
   * 08/11 (BizOps, item 11) — the PTY a tool call comes from is not on a tab yet: right after the app restarts, the
   * remote sessions are attached again and their calls arrive before the renderer has their new PTY. Wait for the tab
   * (up to CALLER_WAIT_MS) instead of answering at once that the session "is not a tab" (the Revisor stopped there).
   */
  private async callerTab(ptyId: string): Promise<BridgeTab | undefined> {
    const deadline = Date.now() + CALLER_WAIT_MS;
    for (;;) {
      const tab = this.ports.tabOfPty(ptyId);
      if (tab !== undefined || Date.now() >= deadline) return tab;
      await new Promise((resolve) => setTimeout(resolve, CALLER_POLL_MS));
    }
  }

  /**
   * Homologação, item 7 — a session no hook has come from since the app opened, but which ended turns before (its note
   * of the last turn is on the board, kept across restarts): its last real state, not "sem nenhum pedido".
   */
  private lastKnownState(tabId: string): string | undefined {
    const tab = this.ports.tabs().find((candidate) => candidate.id === tabId);
    if (!tab?.cwd || !tab.claudeSessionId) return undefined;
    const note = this.board(tab.cwd)?.cards[noteCardId(tab.claudeSessionId)];
    if (note?.kind !== 'session-note') return undefined;
    const at = new Date(note.writtenAt);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return `parada desde ${hhmm} (último fim de turno; o app reabriu e ainda não ouviu dela)`;
  }

  /**
   * 05/11 — a live process that never sent a hook is not "trabalhando": it has not taken any message yet. A session
   * opened by `sessao_abrir` that is still like that after START_GRACE_MS failed to start, and says why.
   */
  private startState(tabId: string): string {
    const openedAt = this.openedAt.get(tabId);
    if (openedAt === undefined) return this.lastKnownState(tabId) ?? 'aberta, sem nenhum pedido ainda';
    if (Date.now() - openedAt < START_GRACE_MS) return 'começando';
    return `não começou: ${this.ports.startTrouble(tabId) ?? 'o Claude de lá não recebeu o pedido'}`;
  }

  /**
   * Once START_GRACE_MS is over, a session that still took nothing is reported to whoever opened it. The check stays
   * after that notice: a remote setup can still fail later (ssh waiting on a check gives up at 180 s), and the
   * literal reason must reach the opener then too (`startFailed`).
   */
  private watchStart(tabId: string, projectPath: string, openerPlace: string, placeId: string, name: string): void {
    const report = (): boolean => {
      if (this.ports.stateOf(tabId) !== 'working' || !this.ports.unconfirmed(tabId)) return false;
      const opener = openerPlace === LEADER_OF_ALL ? this.leaderTab() : this.tabOfPlace(projectPath, openerPlace);
      if (!opener) return false;
      this.ports.sendLine(opener.id, `◆ ${name} (${placeId}) ${this.startState(tabId)}. Veja a tela dela com sessao_ver_tela ou peça ao dono.`);
      return true;
    };
    const timer = setTimeout(() => {
      if (!report()) this.startChecks.delete(tabId);
    }, START_GRACE_MS);
    this.startChecks.set(tabId, { timer, report });
  }

  /** 07/11 — the terminal of a tab failed to start: whoever opened it hears why now (before or after the grace notice). */
  startFailed(tabId: string): void {
    const check = this.startChecks.get(tabId);
    if (!check) return;
    clearTimeout(check.timer);
    this.startChecks.delete(tabId);
    this.openedAt.set(tabId, 0); // past the grace: `startState` gives the cause
    check.report();
  }

  /** Live sessions `placeId` opened; for the Líder único, only those of `projectPath` (its cap is per board). */
  private liveOpenedBy(placeId: string, projectPath?: string): number {
    let count = 0;
    for (const [tabId, opener] of this.openedBy) {
      if (opener !== placeId) continue;
      if (this.ports.stateOf(tabId) === undefined) {
        this.openedBy.delete(tabId);
        this.openedAt.delete(tabId);
        const check = this.startChecks.get(tabId);
        if (check) clearTimeout(check.timer);
        this.startChecks.delete(tabId);
      }
      else if (projectPath === undefined || this.ports.tabs().find((tab) => tab.id === tabId)?.cwd === projectPath) count += 1;
    }
    return count;
  }

  // ---- Líder único (ADR 0007) ---------------------------------------------------------------------------------

  /**
   * 08/11 (Homologação, item 8) — who opened a place with `sessao_abrir`, for `abertaPor` (the Atestador reads it). The
   * memory of this run, the mark the tab carries across a restart, then the opening arrow on the board (a closed place
   * keeps it), then the places the Líder único opened in this run (it has no card to draw the arrow from).
   */
  private openerOf(projectPath: string, placeId: string, tab: BridgeTab | undefined): string | undefined {
    const fromTab = tab ? (this.openedBy.get(tab.id) ?? tab.openedBy) : undefined;
    if (fromTab !== undefined) return fromTab;
    const arrow = this.board(projectPath)?.links.find((link) => link.opened === true && link.to === placeId);
    if (arrow) return arrow.from;
    return this.leaderOpened.has(`${projectPath}\n${placeId}`) ? LEADER_OF_ALL : undefined;
  }

  /** The open tab of the Líder único, if any. */
  private leaderTab(): BridgeTab | undefined {
    return this.ports.tabs().find((tab) => isLeaderOfAllTab(tab) && this.ports.stateOf(tab.id) !== undefined);
  }

  /** The Líder único reaches `placeId` of `projectPath` — the one rule (reach.ts). */
  private leaderReaches(projectPath: string, placeId: string): boolean {
    return canReach(this.ports.doc(), LEADER_OF_ALL_FROM, { projectPath, placeId }).ok;
  }

  /** The Líder único opened `placeId` (in this run, or a tab of it that carries the mark after a restart). */
  private openedByLeader(projectPath: string, placeId: string): boolean {
    if (this.leaderOpened.has(`${projectPath}\n${placeId}`)) return true;
    return this.ports.tabs().some((tab) => tab.cwd === projectPath && tab.openedBy === LEADER_OF_ALL && this.placeOfTab(tab)?.id === placeId);
  }

  /**
   * `sessao_fechar` of the Faxineiro (t-b3b26e60): its own board with no arrow, never a session working, waiting for
   * the owner or opened by his hand (`canFaxineiroClose`). Never cuts a turn. Every ask, closed or refused, is logged.
   */
  private faxineiroClose(doc: MindscapeDoc, from: { projectPath: string; placeId: string }, to: { projectPath: string; placeId: string }, callerTabId: string): Answer {
    const log = (kind: FaxineiroLogEntry['kind'], summary: string): void =>
      this.ports.logFaxineiro?.([{ at: Date.now(), kind, projectPath: to.projectPath, placeId: to.placeId, summary }]);
    const target = this.tabOfPlace(to.projectPath, to.placeId);
    if (!target) {
      log('recusou-fechar', 'não está aberta');
      return { ok: false, text: `Não fechei: "${to.placeId}" não está aberta agora.` };
    }
    if (target.id === callerTabId) {
      log('recusou-fechar', `${target.name}: esta é a sua própria sessão.`);
      return { ok: false, text: 'Não fechei: esta é a sua própria sessão.' };
    }
    const state = this.ports.stateOf(target.id);
    // A tab that never started, on a full machine, goes back to the queue with the same request (nothing is lost).
    const asked = this.launched.get(target.id);
    const machineFull = this.fullMachines.has(target.remoteId ?? PC_MACHINE_ID);
    if (asked && machineFull && state === 'working' && this.ports.unconfirmed(target.id) && !this.ports.permissionOnScreen(target.id)) {
      const verdict = canFaxineiroClose(doc, from, to, { working: false, needsOwner: false, openedBySession: true });
      if (!verdict.ok) {
        log('recusou-fechar', `${target.name}: ${verdict.reason}`);
        return { ok: false, text: `Não fechei: ${verdict.reason}` };
      }
      const check = this.startChecks.get(target.id);
      if (check) clearTimeout(check.timer);
      this.startChecks.delete(target.id);
      this.ports.closeTab(target.id);
      this.openedBy.delete(target.id);
      this.launched.delete(target.id);
      this.openQueue.push({ ...asked, queuedAt: Date.now() });
      log('fila', `${target.name}: não tinha começado; voltou à fila com o mesmo pedido`);
      return { ok: true, text: 'Fechada e devolvida à fila: ela não tinha começado e abre sozinha, com o mesmo pedido, quando a máquina tiver vaga.' };
    }
    const openedBy = target.openedBy ?? this.openedBy.get(target.id);
    const verdict = canFaxineiroClose(doc, from, to, {
      working: state === 'working' || this.ports.unconfirmed(target.id),
      needsOwner: state === 'permission' || state === 'error' || this.ports.permissionOnScreen(target.id),
      openedBySession: openedBy !== undefined,
    });
    const note = target.claudeSessionId ? doc.boards[to.projectPath]?.cards[noteCardId(target.claudeSessionId)] : undefined;
    const lastTurn = note?.kind === 'session-note' ? ` · último turno: ${note.text.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    if (!verdict.ok) {
      log('recusou-fechar', `${target.name}: ${verdict.reason}`);
      return { ok: false, text: `Não fechei: ${verdict.reason}` };
    }
    this.ports.closeTab(target.id);
    this.openedBy.delete(target.id);
    this.leaderHears.delete(target.id);
    log('fechar', `${target.name} (${STATE_NAMES[state ?? 'done']})${lastTurn}`);
    return { ok: true, text: 'Fechada.' };
  }

  /** Why sessao_fechar did not close a session with a permission open: what it asks, and how to answer it. */
  private async permissionRefusal(tabId: string): Promise<string> {
    const ask = await this.ports.permissionAsk?.(tabId).catch(() => null);
    const what = ask ? ` (${describeAsk(ask)})` : '';
    return `ela tem um pedido de permissão aberto na tela${what}. Responda com sessao_permissao, ou feche com "recusarPermissao": true.`;
  }

  /**
   * Refuses the permission requests open on that tab, one after another (parallel tool calls queue up), until its screen
   * is clear. Answers `null` when clear, else why not.
   */
  private async refuseOpenPermissions(tabId: string): Promise<string | null> {
    if (!this.ports.permissionAsk || !this.ports.answerPermission) return 'este app não sabe recusar permissões de outra sessão.';
    for (let round = 0; round < REFUSE_ROUNDS && this.ports.permissionOnScreen(tabId); round += 1) {
      const ask = await this.ports.permissionAsk(tabId);
      if (!ask) break;
      const result = await this.ports.answerPermission(tabId, ask.id, 'deny');
      if (!result.ok) return `não consegui recusar o pedido aberto (${describeAsk(ask)}): ${result.reason}.`;
      const deadline = Date.now() + REFUSE_WAIT_MS;
      while (this.ports.permissionOnScreen(tabId) && Date.now() < deadline) {
        const next = await this.ports.permissionAsk(tabId);
        if (next === null || next.id !== ask.id) break;
        await new Promise((resolve) => setTimeout(resolve, CLOSE_POLL_MS));
      }
    }
    return this.ports.permissionOnScreen(tabId) ? 'recusei, e a tela dela ainda mostra um pedido de permissão; veja com sessao_permissao.' : null;
  }

  /** What `sessao_enviar` answers once the line went (or not) to the tab of there. */
  private deliveryAnswer(outcome: DeliveryOutcome, targetId: string): Answer {
    if (outcome.kind === 'entrou') return { ok: true, text: 'Entregue: entrou no Claude de lá.' };
    if (outcome.kind === 'na-fila') return { ok: true, text: 'Entregue à fila do Claude de lá: ela está trabalhando e o próprio CLI a entrega no próximo passo.' };
    if (outcome.kind === 'nao-foi') return { ok: false, text: `Não entrou: ${outcome.reason}. Veja a tela dela com sessao_ver_tela, ou peça ao dono.` };
    if (outcome.kind === 'pelo-terminal') {
      return { ok: true, text: 'Enviada pelo terminal dela (a aba não tem a visão de chat), sem confirmação de que entrou. NÃO mande de novo; confira com sessao_ver_tela.' };
    }
    return {
      ok: true,
      text: this.ports.permissionOnScreen(targetId)
        ? 'Ainda não entrou: há uma permissão aberta na tela dela. A mensagem entra sozinha assim que ela fechar; NÃO mande de novo.'
        : `Ainda não entrou${outcome.reason ? ` (${outcome.reason})` : ''}; o app segue tentando sozinho. NÃO mande de novo (sairia duas vezes quando a primeira entrar); confira com sessao_ver_tela.`,
    };
  }

  /**
   * May the caller send to `placeId`: the Líder único by its reach, the Líder of the board to every place of it (reach.ts),
   * the others by an arrow of theirs.
   */
  private canSend(scope: Scope, board: MindscapeBoard | undefined, placeId: string): boolean {
    if (scope.leader) return this.leaderReaches(scope.projectPath, placeId);
    if (!scope.self) return false;
    if (hasArrowLink(board, scope.self.id, placeId)) return true;
    const here = scope.projectPath;
    return isBoardOrchestrator(board, scope.self.id) && canReach(this.ports.doc(), { projectPath: here, placeId: scope.self.id }, { projectPath: here, placeId }).ok;
  }

  private boards(): KnownBoard[] {
    return knownBoards(this.ports.doc(), this.ports.projects());
  }

  /** The boards as the Líder único sees them (the answer to a call without `quadro`). */
  private boardList(): unknown[] {
    return this.boards().map((known) => {
      const board = this.board(known.projectPath);
      const places = board ? Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session') : [];
      return {
        nome: known.name,
        pasta: known.projectPath,
        lugares: places.length,
        abertas: places.filter((place) => this.tabOfPlace(known.projectPath, place.id) !== undefined).length,
        voceAlcanca: places
          .filter((place) => this.leaderReaches(known.projectPath, place.id))
          .map((place) => ({ id: place.id, ...(place.roleId ? { papelNome: this.roleName(place.roleId) } : {}) })),
      };
    });
  }

  /** The board of a board-scoped call, or the answer when there is none to act on. */
  private scopeOf(caller: BridgeTab, call: BoardScopedCall): Scope | Answer {
    if (isLeaderOfAllTab(caller)) {
      if (!call.quadro) return { ok: true, text: json({ aviso: 'Você é o Líder único e não tem quadro: diga qual em "quadro" (nome ou pasta).', quadros: this.boardList() }) };
      const match = resolveBoard(this.boards(), call.quadro);
      if (!match.ok) return { ok: false, text: match.reason };
      return { projectPath: match.board.projectPath, projectName: match.board.name, leader: true };
    }
    if (!caller.cwd) return { ok: false, text: 'Esta sessão não é uma aba de projeto do Donel Dev.' };
    if (call.quadro) {
      const match = resolveBoard(this.boards(), call.quadro);
      if (!match.ok || match.board.projectPath !== caller.cwd) return { ok: false, text: 'Só o Líder único escolhe o quadro. Esta sessão usa sempre o próprio quadro (chame sem "quadro").' };
    }
    const self = this.placeOfTab(caller);
    return { projectPath: caller.cwd, ...(caller.projectName ? { projectName: caller.projectName } : {}), leader: false, ...(self ? { self } : {}) };
  }

  // ---- end-of-turn notice (D) --------------------------------------------------------------------------------

  private chatMode(): boolean {
    return this.ports.turnNotices?.() === 'chat';
  }

  /**
   * A session ended a turn. 'ledger' (default): recorded on its live task, nobody's chat hears it. 'chat' (the old
   * mode): each open session with an arrow to it (or that opened it) hears a short notice.
   */
  turnEnded(sessionId: string, text: string): void {
    const ended = this.ports.tabs().find((tab) => tab.claudeSessionId === sessionId);
    if (!ended?.cwd || isLeaderOfAllTab(ended)) return;
    const cwd = ended.cwd;
    // B40 — the same end of turn arriving twice (a repeated or late hook) is announced once.
    if (this.lastNoticeText.get(sessionId) === text) return;
    this.lastNoticeText.set(sessionId, text);
    const place = this.placeOfTab(ended);
    const board = this.board(ended.cwd);
    if (!place || !board) return;
    if (!this.chatMode()) {
      // Dono, 09/11 ("fim de turno e andamento vão só ao ledger"): recorded on the live task, nobody's chat, arrow or
      // not. With no live task the turn stays on the session's own note (sessao_ver_tela), never in a chat.
      void Promise.resolve(this.ports.recordTurn?.({ projectPath: ended.cwd, placeId: place.id, text })).catch(() => undefined);
      return;
    }
    this.chatTurnNotice(ended, cwd, place, board, text);
  }

  /**
   * The old "◆ … terminou": each open session with an arrow to it (or that opened it) hears it. With the notices in the
   * ledger (`toLeaderOfAll` false), the Líder único is never one of them (dono, 09/11), even when it opened the session.
   */
  private chatTurnNotice(ended: BridgeTab, cwd: string, place: SessionPlaceCard, board: MindscapeBoard, text: string): void {
    const listeners = new Set<string>();
    for (const link of board.links) if (link.arrow && link.to === place.id) listeners.add(link.from);
    const opener = this.openedBy.get(ended.id);
    if (opener) listeners.add(opener);
    // Líder único — it has no arrow to hear by: it hears the sessions it opened (above) and the ones it sent work to.
    if (this.leaderHears.has(ended.id)) listeners.add(LEADER_OF_ALL);
    const guard = this.lastNoticeFrom.get(ended.id);
    this.lastNoticeFrom.delete(ended.id);
    const role = this.roleName(place.roleId);
    const line = `◆ ${role ? `${role} ` : ''}${ended.name} (${place.id}) terminou: ${noticeBody(text) || '(sem resumo)'}`;
    const boardName = ended.projectName ?? lastSegment(cwd);
    for (const listenerPlace of listeners) {
      if (listenerPlace === place.id || listenerPlace === guard) continue;
      const leader = listenerPlace === LEADER_OF_ALL;
      const target = leader ? this.leaderTab() : this.tabOfPlace(cwd, listenerPlace);
      if (!target) continue;
      this.lastNoticeFrom.set(target.id, place.id);
      // The Líder único hears every board: the notice says which one.
      this.ports.sendLine(target.id, leader ? line.replace(`(${place.id})`, `(${place.id}, quadro ${boardName})`) : line);
    }
  }

  // ---- what cannot wait (08/11) --------------------------------------------------------------------------------

  /**
   * The state of a tab changed (App, from the semaphore it already has; nothing is computed here). A permission open
   * on its screen ("precisa do dono") or a turn that failed (usage limit, login…: "travada") reaches the Líder of its
   * board at once, once per situation. In the old mode ('chat') the "◆ … terminou" already says it: nothing here.
   */
  attention(tabId: string): void {
    if (this.chatMode()) return;
    const state = this.ports.stateOf(tabId);
    const failure = state !== undefined && state !== 'working' ? this.ports.turnFailureOf?.(tabId) : undefined;
    const stuck = failure ? `está travada: ${failureReasonText(failure)} (o turno parou e não segue sozinho)` : undefined;
    const situation = state === 'permission' ? 'precisa do dono: há uma permissão aberta na tela dela' : stuck;
    // On the PC no watchdog wakes it after the reset: there it is still a lock the Líder único may have to hear.
    const remote = this.ports.tabs().find((candidate) => candidate.id === tabId)?.remoteId !== undefined;
    const transient = remote && state !== 'permission' && failure !== undefined && TRANSIENT_TURN_FAILURES.has(failure);
    const key = `tab:${tabId}`;
    if (!situation) {
      this.toldUrgent.delete(tabId);
      if (!this.pendingUrgent.get(key)?.sending) this.pendingUrgent.delete(key); // it cleared before anyone heard
      this.flushUrgent();
      return;
    }
    if (this.toldUrgent.get(tabId) !== situation) {
      this.toldUrgent.set(tabId, situation);
      const tab = this.ports.tabs().find((candidate) => candidate.id === tabId);
      const place = tab ? this.placeOfTab(tab) : undefined;
      if (tab?.cwd && place) {
        // The ledger keeps it too, saying when nobody could hear it yet.
        const route = this.urgentTarget(tab);
        const waiting = route && !(route.leader && transient) ? '' : ' (aviso pendente: nenhum Líder aberto)';
        void Promise.resolve(this.ports.recordTurn?.({ projectPath: tab.cwd, placeId: place.id, text: `${situation}${waiting}`, estado: state === 'permission' ? 'precisa-do-dono' : 'travada' })).catch(() => undefined);
      }
      this.queueUrgent(key, tabId, state === 'permission' ? `${situation}. Leia o que ela pede e responda com sessao_permissao (ou feche com sessao_fechar e "recusarPermissao": true).` : `${situation}. Veja a tela dela com sessao_ver_tela.`, transient);
      return;
    }
    this.flushUrgent();
  }

  /** Something of the session of `tabId` that cannot wait: it stays here until a Líder's CLI took it. */
  private queueUrgent(key: string, tabId: string, words: string, transient = false): void {
    this.pendingUrgent.set(key, { tabId, words, transient, sending: false });
    this.flushUrgent();
  }

  /**
   * Tries every pending notice (App calls it at each state change and every half minute: a Líder that opens or comes
   * back from "sem ligação" gets what waited). Told = the Líder's CLI took it, or its send driver holds it.
   */
  flushUrgent(): void {
    for (const [key, entry] of this.pendingUrgent) {
      if (entry.sending) continue;
      const tab = this.ports.tabs().find((candidate) => candidate.id === entry.tabId);
      const place = tab ? this.placeOfTab(tab) : undefined;
      if (!tab?.cwd || !place) {
        this.pendingUrgent.delete(key); // the session itself is gone from every board: nobody to speak for
        continue;
      }
      const route = this.urgentTarget(tab);
      if (!route) continue; // waits for a Líder
      if (route.leader && entry.transient) continue; // never to the Líder único (12/11): waits for the Líder of the board
      entry.sending = true;
      const role = this.roleName(place.roleId ?? tab.roleId);
      const where = route.leader ? `, quadro ${tab.projectName ?? this.boardName(tab.cwd)}` : '';
      const line = `◆ ${role ? `${role} ` : ''}${tab.name} (${place.id}${where}) ${entry.words}`;
      void this.ports
        .deliverLine(route.target.id, line, DELIVERY_WAIT_MS, 'session')
        .catch((): DeliveryOutcome => ({ kind: 'nao-foi', reason: 'erro' }))
        .then((outcome) => {
          if (this.pendingUrgent.get(key) !== entry) return; // replaced by a newer situation meanwhile
          if (outcome.kind === 'nao-foi') entry.sending = false; // the next flush tries again
          else this.pendingUrgent.delete(key);
        });
    }
    this.reportReturns();
  }

  /**
   * Sessão durável (t-fb11c6cd) — the sessions reopened after an update. Once every one of a board came back or gave up
   * (`returnVerdict`), the Líder of that board hears it in one message, or the Líder único when the board has none that
   * hears. Judged at each `flushUrgent` (each state change and every half minute); it waits for a Líder like the urgent.
   */
  expectReturn(entries: readonly ReturnExpectation[]): void {
    const since = Date.now();
    const byBoard = new Map<string, ReturnExpectation[]>();
    for (const entry of entries) byBoard.set(entry.projectPath, [...(byBoard.get(entry.projectPath) ?? []), entry]);
    for (const [projectPath, list] of byBoard) {
      const before = this.returning.get(projectPath);
      this.returning.set(projectPath, { since: before?.since ?? since, entries: [...(before?.entries ?? []), ...list], sending: false });
    }
    this.flushUrgent();
  }

  private reportReturns(): void {
    for (const [projectPath, report] of this.returning) {
      if (report.sending) continue;
      const board = this.board(projectPath);
      if (!board) {
        if (this.ports.loaded) this.returning.delete(projectPath); // a folder with no board: no team to tell
        continue; // else the board has not loaded yet
      }
      const elapsedMs = Date.now() - report.since;
      const lines: ReturnLine[] = [];
      let pending = false;
      for (const entry of report.entries) {
        const tab = entry.remote
          ? this.ports.tabs().find((candidate) => candidate.remoteId !== undefined && candidate.claudeSessionId === entry.sessionId)
          : this.ports.tabs().find((candidate) => candidate.id === entry.tabId);
        const verdict = returnVerdict(entry.sessionId, {
          remote: entry.remote === true,
          tabFound: tab !== undefined,
          exited: tab !== undefined && this.ports.stateOf(tab.id) === undefined,
          ...(tab?.claudeSessionId ? { sessionId: tab.claudeSessionId } : {}),
          confirmed: tab !== undefined && !this.ports.unconfirmed(tab.id),
          fresh: entry.fresh === true,
          trouble: tab ? this.ports.startTrouble(tab.id) : null,
          elapsedMs,
        });
        if (verdict.kind === 'pendente') {
          pending = true;
          break;
        }
        const place = placeOfSession(board, entry.sessionId);
        if (!place) continue; // a tab out of every board belongs to no team
        const role = this.roleName(place.roleId);
        lines.push({ who: `${role ?? entry.name} (${place.id})`, verdict });
      }
      if (pending) continue;
      if (lines.length === 0) {
        this.returning.delete(projectPath);
        continue;
      }
      const boardLeader = boardLeaders(board).find((id) => this.hears(projectPath, id));
      const leaderOfAll = this.reachableTab(this.leaderTab());
      const target = boardLeader ? this.tabOfPlace(projectPath, boardLeader) : leaderOfAll && !this.ports.unconfirmed(leaderOfAll.id) ? leaderOfAll : undefined;
      if (!target) continue; // waits for a Líder
      report.sending = true;
      void this.ports
        .deliverLine(target.id, returnReport(lines, boardLeader ? undefined : this.boardName(projectPath)), DELIVERY_WAIT_MS, 'session')
        .catch((): DeliveryOutcome => ({ kind: 'nao-foi', reason: 'erro' }))
        .then((outcome) => {
          if (this.returning.get(projectPath) !== report) return;
          if (outcome.kind === 'nao-foi') report.sending = false; // the next flush tries again
          else this.returning.delete(projectPath);
        });
    }
  }

  /** A Líder tab that can take a line now: open, and not "sem ligação". */
  private reachableTab(tab: BridgeTab | undefined): BridgeTab | undefined {
    return tab && !this.ports.linkLost?.(tab.id) ? tab : undefined;
  }

  /**
   * A place that hears now: its tab is open, answers (not "sem ligação") and has shown signs of life since the app
   * opened (`unconfirmed`: a session mute since a reinstall would swallow a notice, or sit on a task, in silence).
   */
  private hears(projectPath: string, placeId: string): boolean {
    const tab = this.reachableTab(this.tabOfPlace(projectPath, placeId));
    return tab !== undefined && !this.ports.unconfirmed(tab.id);
  }

  /**
   * Dono, 12/11 (t-5c0df1df) — a chair does not go over a live Líder of its board to the Líder único: the Líder that
   * hears now and is not stuck itself, if `placeId` is not one of the board's Líderes. Closed, mute, "sem ligação",
   * with a permission open or a failed turn: none (the chair's blocker is one the Líder of the board cannot solve now).
   */
  private liveBoardLeaderAbove(projectPath: string, placeId: string): string | undefined {
    const leaders = boardLeaders(this.board(projectPath));
    if (leaders.includes(placeId)) return undefined;
    return leaders.find((id) => this.hears(projectPath, id) && !this.isStuck(projectPath, id));
  }

  /** The tab of `placeId` cannot answer now: a permission open on its screen, or a turn that failed (it is a lock too). */
  private isStuck(projectPath: string, placeId: string): boolean {
    const tab = this.tabOfPlace(projectPath, placeId);
    if (!tab) return true;
    const state = this.ports.stateOf(tab.id);
    return state === 'permission' || state === 'error' || (state !== 'working' && this.ports.turnFailureOf?.(tab.id) !== undefined);
  }

  /**
   * Who hears the delivery or the lock of the session of `tab`: `whoHears` (reach.ts), the ONE rule, read from the
   * board at this notice: the first live place above it by the arrows, else the Líder of its board, else the Líder
   * único. Nobody to hear now: it waits (`flushUrgent`).
   */
  private urgentTarget(tab: BridgeTab): { readonly target: BridgeTab; readonly leader: boolean } | undefined {
    if (!tab.cwd || isLeaderOfAllTab(tab)) return undefined;
    const cwd = tab.cwd;
    const place = this.placeOfTab(tab);
    const board = this.board(cwd);
    // A tab out of every board (opened by hand, no place) belongs to no team: nobody is told.
    if (!place || !board) return undefined;
    const to = whoHears(board, place.id, (id) => this.hears(cwd, id));
    const target = to === LEADER_OF_ALL ? undefined : this.tabOfPlace(cwd, to);
    if (target) return { target, leader: false };
    const leader = this.reachableTab(this.leaderTab());
    return leader ? { target: leader, leader: true } : undefined;
  }

  // ---- the tools ---------------------------------------------------------------------------------------------

  /** `answerBy`: epoch ms by which a call that waits answers (the main stamps it on `sessao_enviar`). */
  async handle(ptyId: string, call: BoardToolCall, answerBy?: number): Promise<Omit<MindscapeBoardResponse, 'requestId'>> {
    try {
      return await this.run(ptyId, call, answerBy);
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  private async run(ptyId: string, call: BoardToolCall, answerBy = Date.now() + SEND_ANSWER_BY_MS): Promise<Answer> {
    const fail = (text: string): Answer => ({ ok: false, text });
    if (!this.ports.loaded) return fail('O quadro ainda não abriu no app (ou falhou ao abrir). Tente de novo em instantes.');
    const caller = await this.callerTab(ptyId);
    if (!caller)
      return fail(
        'O app está religando esta sessão (ele reiniciou ou acabou de voltar) e ainda não a reconheceu. Você não caiu: espere 1 minuto e tente de novo. Não abra outra sessão no seu lugar.',
      );
    const roleNames = new Map(this.ports.roles().map((role) => [role.id, role.name]));

    if (call.tool === 'papeis_listar') return { ok: true, text: json(this.ports.roles().map((role) => ({ id: role.id, nome: role.name }))) };

    if (call.tool === 'aviso_imediato') {
      if (this.chatMode()) return { ok: true, text: 'modo antigo: o aviso vai no fim do turno' };
      const heard = this.urgentTarget(caller) !== undefined;
      this.queueUrgent(`n:${++this.urgentSeq}`, caller.id, call.texto);
      return { ok: true, text: heard ? 'avisado' : 'guardado: vai quando um Líder abrir' };
    }

    if (call.tool === 'estados_dos_lugares') {
      // Only ids and states, for the ledger's orphan count: the same for every caller (no reach in it). A folder that is
      // no board stays out (unknown).
      const states: Record<string, { id: string; estado: string }[]> = {};
      for (const [pasta, places] of this.placeStates(call.pastas)) states[pasta] = [...places].map(([id, estado]) => ({ id, estado }));
      return { ok: true, text: json(states) };
    }

    if (call.tool === 'sessao_quem_sou') {
      if (isLeaderOfAllTab(caller))
        return {
          ok: true,
          text: json({
            nome: caller.name,
            papel: caller.roleId,
            papelNome: this.roleName(caller.roleId),
            liderUnico: true,
            lugar: null,
            alcance: 'Todos os quadros, sem precisar da marca "Alcance": o topo de cada um e quem está abaixo dele pelas setas. Diga o quadro em "quadro" nas ferramentas de quadro, de sessão e de tarefa.',
            roda: caller.remoteId ? this.ports.remoteLabel(caller.remoteId) : 'este computador',
            lugaresRemotos: this.ports.remotes().map((remote) => remote.label),
            quadros: this.boardList(),
          }),
        };
      if (!caller.cwd) return fail('Esta sessão não é uma aba de projeto do Donel Dev.');
      const self = this.placeOfTab(caller);
      return {
        ok: true,
        text: json({
          nome: caller.name,
          projeto: caller.projectName ?? caller.cwd,
          pasta: caller.cwd,
          ...(self ? { lugar: self.id } : { lugar: null, aviso: 'Seu lugar ainda não está no quadro (a sessão acabou de abrir).' }),
          ...(self?.roleId ?? caller.roleId ? { papel: self?.roleId ?? caller.roleId, papelNome: this.roleName(self?.roleId ?? caller.roleId) } : {}),
          // The Líder the owner put on the board (never one a session made): it liberates upload folders for it.
          orquestrador: self ? isBoardOrchestrator(this.board(caller.cwd), self.id) : false,
          roda: caller.remoteId ? this.ports.remoteLabel(caller.remoteId) : 'este computador',
          lugaresRemotos: this.ports.remotes().map((remote) => remote.label),
        }),
      };
    }

    const scope = this.scopeOf(caller, call);
    if ('ok' in scope) return scope;
    const { projectPath, self } = scope;
    /** How the caller signs a message: the Líder único has no place. */
    const signature = scope.leader ? `Líder (${LEADER_OF_ALL})` : `${this.roleName(self?.roleId) ?? caller.name} (${self?.id})`;

    switch (call.tool) {
      case 'quadro_ler': {
        const described = describeBoard(this.ports.doc(), projectPath, {
          ...(self ? { selfPlaceId: self.id } : {}),
          roleNames,
          stateOf: (sessionId) => {
            const tab = this.ports.tabs().find((candidate) => candidate.cwd === projectPath && candidate.claudeSessionId === sessionId);
            const state = tab ? this.ports.stateOf(tab.id) : undefined;
            if (tab && state !== undefined && this.ports.linkLost?.(tab.id)) return LINK_LOST;
            return state ? STATE_NAMES[state] : undefined;
          },
        });
        if (!scope.leader) return { ok: true, text: json(described) };
        const board = this.board(projectPath);
        const reached = board ? Object.keys(board.cards).filter((id) => this.leaderReaches(projectPath, id)) : [];
        return { ok: true, text: json({ quadro: scope.projectName, pasta: projectPath, ...described, voceAlcanca: reached }) };
      }

      case 'quadro_aplicar': {
        let result: ReturnType<typeof applyBoardOps> | undefined;
        this.ports.applyGesture(projectPath, (doc) => {
          result = applyBoardOps(doc, projectPath, call.ops, {
            newId: () => crypto.randomUUID(),
            now: Date.now(),
            roleIds: new Set(roleNames.keys()),
            ...(self ? { selfPlaceId: self.id } : {}),
            ...(scope.leader ? { leaderOfAll: true } : {}),
          });
          return result.ok ? result.doc : doc;
        });
        if (!result) return fail('O quadro ainda não abriu no app.');
        if (!result.ok) return fail(`Nada foi aplicado. ${result.reason}`);
        return { ok: true, text: json({ aplicado: call.ops.length, ids: result.ids }) };
      }

      case 'sessao_listar': {
        const board = this.board(projectPath);
        const places = board ? Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session') : [];
        const list = places.map((place) => {
              const tab = this.tabOfPlace(projectPath, place.id);
              const opener = this.openerOf(projectPath, place.id, tab);
              return {
                id: place.id,
                ...(place.roleId ? { papel: place.roleId, papelNome: this.roleName(place.roleId) } : {}),
                ...(tab ? { nome: tab.name } : {}),
                estado: this.stateName(projectPath, place),
                ...(self && place.id === self.id ? { voce: true } : {}),
                podeMandar: this.canSend(scope, board, place.id),
                ...(opener ? { abertaPor: opener } : {}),
              };
            });
        // The Líder único gets the board with the list, so it (and the ledger) knows where it is.
        return { ok: true, text: json(scope.leader ? { quadro: scope.projectName, pasta: projectPath, lugares: list } : list) };
      }

      case 'sessao_ver_tela': {
        const board = this.board(projectPath);
        const place = board?.cards[call.quem];
        if (!board || place?.kind !== 'session') return fail(`"${call.quem}" não é um lugar do quadro (veja sessao_listar).`);
        const sessions = [place.sessionId, ...place.previous.slice().reverse()].filter((id): id is string => id !== undefined);
        const note = sessions.map((id) => board.cards[`note:${id}`]).find((card) => card?.kind === 'session-note');
        // t-2a9060dd (Líder único, 10/11: "O app não mostra ao Líder o que a permissão pede") — a session stopped on a
        // permission shows what it asks, the same reading sessao_permissao answers.
        const open = this.tabOfPlace(projectPath, place.id);
        const ask = open && this.ports.permissionAsk ? await this.ports.permissionAsk(open.id).catch(() => null) : null;
        return {
          ok: true,
          text: json({
            id: place.id,
            ...(place.roleId ? { papelNome: this.roleName(place.roleId) } : {}),
            estado: this.stateName(projectPath, place),
            ultimoTurno: note?.kind === 'session-note' ? { texto: note.text, em: new Date(note.writtenAt).toISOString() } : null,
            ...(ask
              ? {
                  permissaoAberta: {
                    pedido: ask.id,
                    ...(ask.tool ? { ferramenta: ask.tool } : {}),
                    oQuePede: ask.what,
                    ...(ask.complete === false ? { completo: false } : {}),
                    comoResponder: `Quem a dirige responde com sessao_permissao ("quem": "${place.id}"), ou a fecha com sessao_fechar e "recusarPermissao": true.`,
                  },
                }
              : {}),
          }),
        };
      }

      case 'sessao_enviar': {
        // What is left of the time the main gave this call (the wait for the caller's tab and a late request count).
        const sendWait = (): number => Math.max(SEND_MIN_WAIT_MS, answerBy - Date.now());
        if (!scope.leader && !self) return fail('Seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        // Back up to the Líder único (t-52b31719): only from a session it opened or one below it (reach.ts).
        if (!scope.leader && self && call.para.trim().toLowerCase() === LEADER_OF_ALL) {
          const reach = canReachLeader(this.ports.doc(), { projectPath, placeId: self.id }, (id) => this.openedByLeader(projectPath, id));
          if (!reach.ok) return fail(`Sem ligação com o Líder único: ${reach.reason}`);
          if (!call.motivo) return fail(LEADER_MESSAGE_REFUSAL);
          // A chair the Líder único opened hands it back the finished task even over a live Líder of the board.
          const handsBack = call.motivo === 'tarefa-completa' && this.openedByLeader(projectPath, self.id);
          const over = handsBack ? undefined : this.liveBoardLeaderAbove(projectPath, self.id);
          if (over) return fail(overBoardLeaderRefusal(over));
          const leader = this.leaderTab();
          if (!leader) return fail('O Líder único não está aberto agora. Registre o que precisa no Oráculo (tarefa_criar ou tarefa_transferir com "para": "lider") e siga.');
          const outcome = await this.ports.deliverLine(leader.id, `◆ De ${signature}, quadro ${scope.projectName ?? this.boardName(projectPath)}, ${LEADER_REASON_WORDS[call.motivo]}: ${call.texto}`, sendWait(), 'session');
          return this.deliveryAnswer(outcome, leader.id);
        }
        // Up to the Líder of the board (08/11): every place of the board, no arrow needed (reach.ts).
        if (!scope.leader && self && call.para.trim().toLowerCase() === BOARD_LEADER) {
          const leaders = boardLeaders(this.board(projectPath)).filter((id) => id !== self.id);
          if (leaders.length === 0 && isBoardLeader(this.board(projectPath), self.id))
            return fail(`Não mandei: você é o Líder deste quadro, e "${BOARD_LEADER}" é você mesmo. Para falar com o Líder único, "para": "lider".`);
          if (leaders.length === 0) return fail('Este quadro não tem Líder. Fale com quem está acima de você pelas setas (ou "lider", se o Líder único abriu você).');
          const leader = leaders.map((id) => this.tabOfPlace(projectPath, id)).find((tab) => tab !== undefined);
          if (!leader) return fail('O Líder do quadro não está aberto agora. Registre o que precisa no Oráculo (tarefa_criar) e siga.');
          const outcome = await this.ports.deliverLine(leader.id, `◆ De ${signature}: ${call.texto}`, sendWait(), 'session');
          return this.deliveryAnswer(outcome, leader.id);
        }
        // Back up to whoever opened me (08/11): the opening arrow, no arrow back needed (reach.ts).
        if (!scope.leader && self && call.para.trim().toLowerCase() === MY_OPENER) {
          const openers = openersOf(this.board(projectPath), self.id);
          if (openers.length === 0) {
            if (!this.openedByLeader(projectPath, self.id)) return fail(`Ninguém abriu você por sessao_abrir (foi o dono). Fale com o Líder do quadro ("para": "${BOARD_LEADER}") ou com quem está acima de você pelas setas.`);
            if (!call.motivo) return fail(LEADER_MESSAGE_REFUSAL);
            // The Líder único opened me: the finished task goes back to it even over a live Líder of the board.
            const over = call.motivo === 'tarefa-completa' ? undefined : this.liveBoardLeaderAbove(projectPath, self.id);
            if (over) return fail(overBoardLeaderRefusal(over));
            const leader = this.leaderTab();
            if (!leader) return fail('Quem abriu você foi o Líder único, e ele não está aberto agora. Registre o que precisa no Oráculo (tarefa_criar ou tarefa_transferir com "para": "lider") e siga.');
            const outcome = await this.ports.deliverLine(leader.id, `◆ De ${signature}, quadro ${scope.projectName ?? this.boardName(projectPath)}, ${LEADER_REASON_WORDS[call.motivo]}: ${call.texto}`, sendWait(), 'session');
            return this.deliveryAnswer(outcome, leader.id);
          }
          const opener = openers.map((id) => this.tabOfPlace(projectPath, id)).find((tab) => tab !== undefined);
          if (!opener) return fail(`Quem abriu você (${openers.join(', ')}) não está aberta agora. Registre o que precisa no Oráculo (tarefa_criar) e siga, ou fale com o Líder do quadro ("para": "${BOARD_LEADER}").`);
          if (this.ports.linkLost?.(opener.id)) return fail('Quem abriu você está sem ligação: o processo dela segue vivo no lugar remoto e o app está religando. Tente de novo em instantes.');
          const outcome = await this.ports.deliverLine(opener.id, `◆ De ${signature}: ${call.texto}`, sendWait(), 'session');
          return this.deliveryAnswer(outcome, opener.id);
        }
        const board = this.board(projectPath);
        const place = board?.cards[call.para];
        if (place?.kind !== 'session') return fail(`"${call.para}" não é um lugar do quadro (veja sessao_listar).`);
        if (!this.canSend(scope, board, place.id))
          return fail(
            scope.leader
              ? `Sem ligação: "${place.id}" não está no topo do quadro ${scope.projectName ?? projectPath} nem abaixo dele pelas setas do dono. Peça ao dono.`
              : `Sem ligação: não há seta do seu lugar (${self?.id}) para "${place.id}". Peça ao dono, ou use sessao_abrir. Para o Líder do quadro, "para": "${BOARD_LEADER}"; para quem abriu você, "para": "${MY_OPENER}".`,
          );
        const target = this.tabOfPlace(projectPath, place.id);
        if (!target && this.resumeInFlight(`${projectPath}\n${place.id}`)) return fail(`"${place.id}" está abrindo (sessao_retomar); tente de novo em instantes. Não retome de novo.`);
        if (!target) return fail(`"${place.id}" não está aberta agora.`);
        if (this.ports.linkLost?.(target.id)) return fail(`"${place.id}" está sem ligação: o processo dela segue vivo no lugar remoto e o app está religando. Tente de novo em instantes; não abra outra no lugar dela.`);
        if (scope.leader) this.leaderHears.add(target.id);
        // 05/11 — "Entregue" only once the CLI of there took it: the answer waits for the send to end.
        const outcome = await this.ports.deliverLine(target.id, `◆ De ${signature}: ${call.texto}`, sendWait(), 'session');
        return this.deliveryAnswer(outcome, target.id);
      }

      case 'sessao_fechar': {
        const no = (why: string): Omit<MindscapeBoardResponse, 'requestId'> => fail(`Não fechei: ${why}`);
        const from = scope.leader ? LEADER_OF_ALL_FROM : self ? { projectPath, placeId: self.id } : undefined;
        if (!from) return no('seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        // Hierarchy (owner 04/11): below me by arrows on this board, or any board when I am the Líder of a
        // board with reach "all", or the Líder único on any board — the rule lives in shared/mindscape/reach.ts.
        const doc = this.ports.doc();
        const where = findPlace(doc, call.quem, projectPath);
        if (!where) return no(`"${call.quem}" não é um lugar de nenhum quadro (veja sessao_listar).`);
        if (!scope.leader && self?.roleId === FAXINEIRO_ROLE_ID) return this.faxineiroClose(doc, { projectPath, placeId: self.id }, where, caller.id);
        const reach = canReach(doc, from, where);
        if (!reach.ok) return no(reach.reason);
        const target = this.tabOfPlace(where.projectPath, where.placeId);
        if (!target) return no(`"${where.placeId}" não está aberta agora.`);
        if (target.id === caller.id) return no('esta é a sua própria sessão.');
        if (this.ports.permissionOnScreen(target.id)) {
          // t-1293c818 (3): the caller answers it (sessao_permissao) or refuses it here; the owner's click is not needed.
          if (!call.recusarPermissao) return no(await this.permissionRefusal(target.id));
          const cleared = await this.refuseOpenPermissions(target.id);
          if (cleared !== null) return no(cleared);
        }
        let cut = false;
        // "Sem ligação": no line reaches it, so there is no pause to wait for; closing ends its tmux on the place.
        if (this.ports.stateOf(target.id) === 'working' && !this.ports.linkLost?.(target.id)) {
          this.ports.sendLine(target.id, `◆ De ${signature}: pause agora e não comece nada novo. Esta sessão vai ser fechada em instantes (o dono pode retomá-la depois).`);
          const deadline = Date.now() + CLOSE_WAIT_MS;
          while (this.ports.stateOf(target.id) === 'working' && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, CLOSE_POLL_MS));
          }
          cut = this.ports.stateOf(target.id) === 'working';
        }
        const state = this.ports.stateOf(target.id);
        if (state === undefined) return { ok: true, text: 'Fechada.' }; // it left on its own meanwhile
        if (this.ports.permissionOnScreen(target.id)) {
          if (!call.recusarPermissao) return no(await this.permissionRefusal(target.id));
          const cleared = await this.refuseOpenPermissions(target.id);
          if (cleared !== null) return no(cleared);
        }
        this.ports.closeTab(target.id);
        this.openedBy.delete(target.id);
        this.leaderHears.delete(target.id);
        return { ok: true, text: cut ? `Fechada (o turno não acabou em ${CLOSE_WAIT_MS / 1000} s; cortei).` : 'Fechada.' };
      }

      case 'sessao_permissao': {
        const no = (why: string): Answer => fail(`Não respondi: ${why}`);
        const from = scope.leader ? LEADER_OF_ALL_FROM : self ? { projectPath, placeId: self.id } : undefined;
        if (!from) return no('seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        // The same hierarchy as sessao_fechar (reach.ts): answering a dialog directs the session as much as closing it.
        const doc = this.ports.doc();
        const where = findPlace(doc, call.quem, projectPath);
        if (!where) return no(`"${call.quem}" não é um lugar de nenhum quadro (veja sessao_listar).`);
        const reach = canReach(doc, from, where);
        if (!reach.ok) return no(reach.reason);
        const target = this.tabOfPlace(where.projectPath, where.placeId);
        if (!target) return no(`"${where.placeId}" não está aberta agora.`);
        if (target.id === caller.id) return no('esta é a sua própria sessão.');
        if (!this.ports.permissionAsk || !this.ports.answerPermission) return no('este app não sabe responder permissões de outra sessão.');
        const ask = await this.ports.permissionAsk(target.id);
        if (!ask) return no(`não há pedido de permissão aberto na tela de "${where.placeId}".`);
        const asked = describeAsk(ask);
        if (call.resposta === undefined) {
          return {
            ok: true,
            text: json({
              pedido: ask.id,
              ...(ask.tool ? { ferramenta: ask.tool } : {}),
              oQuePede: ask.what,
              origem: ask.source === 'chat' ? 'pendência do chat (o app segura o pedido)' : 'diálogo na tela do CLI',
              ...(ask.complete === false
                ? { completo: false, comoResponder: `A leitura está incompleta (o pedido foi cortado ou o começo dele não está na tela): só "resposta": "recusar" vale por aqui.` }
                : { comoResponder: `sessao_permissao com "resposta": "permitir" e "pedido": "${ask.id}", ou "resposta": "recusar".` }),
            }),
          };
        }
        if (call.pedido !== undefined && call.pedido !== ask.id)
          return no(`o pedido aberto agora é outro (${ask.id}): ${asked}. Leia e responda de novo.`);
        if (call.resposta === 'permitir' && call.pedido === undefined)
          return no(`para permitir, diga o id do pedido que você leu ("pedido": "${ask.id}"). O pedido: ${asked}.`);
        if (call.resposta === 'permitir' && ask.complete === false)
          return no(`a leitura do pedido está incompleta (cortada, ou o começo dele não está na tela), e não se permite o que não se leu inteiro. Só "recusar" vale. O que se lê: ${asked}.`);
        const answer = call.resposta === 'permitir' ? 'allow' : 'deny';
        const result = await this.ports.answerPermission(target.id, ask.id, answer);
        if (!result.ok) return no(`${result.reason}. O pedido era: ${asked}.`);
        return { ok: true, text: `${answer === 'allow' ? 'Permitido' : 'Recusado'}: ${asked}.` };
      }

      case 'sessao_retomar': {
        // t-1293c818 — the owner's two clicks on a dormant place, by tool. Same hierarchy as `sessao_fechar` (reach.ts).
        const no = (why: string): Answer => fail(`Não retomei: ${why}`);
        const from = scope.leader ? LEADER_OF_ALL_FROM : self ? { projectPath, placeId: self.id } : undefined;
        if (!from) return no('seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        const doc = this.ports.doc();
        const where = findPlace(doc, call.quem, projectPath);
        if (!where) return no(`"${call.quem}" não é um lugar de nenhum quadro (veja sessao_listar).`);
        const reach = canReach(doc, from, where);
        if (!reach.ok) return no(reach.reason);
        const place = this.board(where.projectPath)?.cards[where.placeId];
        if (place?.kind !== 'session') return no(`"${where.placeId}" não é um lugar do quadro.`);
        const key = `${where.projectPath}\n${place.id}`;
        if (this.tabOfPlace(where.projectPath, place.id) || this.resumeInFlight(key)) return { ok: true, text: `"${place.id}" já está aberta (ou abrindo); nada a retomar. Para mandar trabalho: sessao_enviar.` };
        if (this.isQueued(where.projectPath, place.id)) return { ok: true, text: `"${place.id}" espera vaga na fila e abre sozinha quando a máquina tiver vaga.` };
        if (!this.ports.resumePlace) return no('este app não retoma sessões por ferramenta.');
        const sessionId = place.sessionId ?? place.previous[place.previous.length - 1];
        const note = sessionId ? this.board(where.projectPath)?.cards[`note:${sessionId}`] : undefined;
        const opener = this.openerOf(where.projectPath, place.id, undefined);
        const known = this.boards().find((board) => board.projectPath === where.projectPath);
        this.resuming.set(key, { tabId: null, at: Date.now() });
        let outcome: ResumePlaceOutcome;
        try {
          outcome = await this.ports.resumePlace({
            projectPath: where.projectPath,
            ...(known ? { projectName: known.name } : {}),
            placeId: place.id,
            ...(sessionId ? { sessionId } : {}),
            name: note?.kind === 'session-note' ? note.sessionName : (this.roleName(place.roleId) ?? 'Sessão'),
            ...(opener ? { openedBy: opener } : {}),
            // #375 — the same brake as `sessao_abrir`; an opening that passes counts for the next one.
            mayOpenOn: (remoteId) => {
              const machine = remoteId ?? PC_MACHINE_ID;
              const full = this.waitReasons(machine);
              if (full) return `a máquina não tem vaga agora (${full.join('; ')}). Tente de novo quando o Faxineiro liberar vaga.`;
              this.launchedOn.set(machine, [...(this.launchedOn.get(machine) ?? []), Date.now()]);
              return undefined;
            },
          });
        } catch (error) {
          this.resuming.delete(key);
          throw error;
        }
        if (!outcome.ok) {
          this.resuming.delete(key);
          return no(outcome.reason);
        }
        this.resuming.set(key, { tabId: outcome.tabId, at: Date.now() });
        return {
          ok: true,
          text: json({
            lugar: place.id,
            ...(place.roleId ? { papel: place.roleId } : {}),
            [sessionId ? 'retomada' : 'abriuPelaPrimeiraVez']: true,
            roda: outcome.remoteId ? this.ports.remoteLabel(outcome.remoteId) : 'este computador',
            aviso: sessionId ? 'Ela volta com a conversa de antes. Para mandar trabalho: sessao_enviar.' : 'O lugar não tinha começado: abriu a primeira sessão dele. Para mandar trabalho: sessao_enviar.',
          }),
        };
      }

      case 'sessao_religar': {
        const no = (why: string): Omit<MindscapeBoardResponse, 'requestId'> => fail(`Não religuei: ${why}`);
        // Same reach as `sessao_fechar` (shared/mindscape/reach.ts), plus the caller's own session (a hook gone while
        // its MCP still answers). Nothing is killed: only the app's keys go back.
        const doc = this.ports.doc();
        const where = findPlace(doc, call.quem, projectPath);
        if (!where) return no(`"${call.quem}" não é um lugar de nenhum quadro (veja sessao_listar).`);
        const target = this.tabOfPlace(where.projectPath, where.placeId);
        if (target?.id !== caller.id) {
          const from = scope.leader ? LEADER_OF_ALL_FROM : self ? { projectPath, placeId: self.id } : undefined;
          if (!from) return no('seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
          const reach = canReach(doc, from, where);
          if (!reach.ok) return no(reach.reason);
        }
        if (!target) return no(`"${where.placeId}" não está aberta agora (para uma fechada, o dono retoma).`);
        if (!this.ports.relinkTools) return no('este app não religa ferramentas.');
        const outcome = await this.ports.relinkTools(target.id);
        return outcome.ok ? { ok: true, text: outcome.text } : no(outcome.text);
      }

      case 'sessao_abrir': {
        const opener = scope.leader ? LEADER_OF_ALL : self?.id;
        if (opener === undefined) return fail('Seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        const role = this.ports.roles().find((candidate) => candidate.id === call.papel);
        if (!role) return fail(`Papel "${call.papel}" não existe (veja papeis_listar).`);
        // t-1293c818 — only the Líder único opens a Líder: the owner's orchestrator, its place made as the owner's.
        const ownersLeader = role.id === LEADER_ROLE_ID;
        if (ownersLeader && !scope.leader) return fail(`Não abri: ${LEADER_PLACE_IS_THE_OWNERS}`);
        // `onde` — absent, "aqui" or "auto": the router picks (t-89f14324); "este computador": local; else a remote
        // place by label or id. A place asked by name is kept even when full (it waits there, never moves).
        let explicit: string | undefined;
        const where = call.onde?.trim().toLowerCase();
        if (where && where !== 'aqui' && where !== 'auto') {
          if (where === 'este computador' || where === 'local') explicit = PC_MACHINE_ID;
          else {
            const remotes = this.ports.remotes();
            const found = remotes.find((remote) => remote.id.toLowerCase() === where || remote.label.toLowerCase() === where);
            if (!found) return fail(`Lugar "${call.onde}" não existe. Use "aqui", "auto", "este computador" ou um destes: ${remotes.map((remote) => remote.label).join(', ') || '(nenhum lugar remoto)'}.`);
            explicit = found.id;
          }
        }
        // The Líder único has a cap per board; a place, its own.
        const open = this.liveOpenedBy(opener, scope.leader ? projectPath : undefined);
        const cap = this.ports.openCap?.() ?? null;
        if (cap !== null && open >= cap) {
          const allowed = await this.ports.askOwner({ caller: caller.name, role: role.name, request: call.pedido, open });
          if (!allowed) return fail(`O dono negou abrir mais uma sessão (você já tem ${open} abertas${scope.leader ? ' neste quadro' : ''}). Use as que existem.`);
        }
        // t-89f14324 — the machine by a fixed rule (`placeRouter.ts`); a full one queues, or, for a role with "lugar:
        // qualquer" and no explicit place, goes to the remote with the most room (t-b3b26e60).
        const machines: RouteMachine[] = [PC_MACHINE_ID, ...this.ports.remotes().map((remote) => remote.id)].map((id) => {
          const reasons = this.waitReasons(id);
          const room = this.roomLeft(id);
          return { id, label: id === PC_MACHINE_ID ? 'este computador' : this.ports.remoteLabel(id), ...(reasons ? { waitReasons: reasons } : {}), ...(room !== undefined ? { roomSessions: room } : {}) };
        });
        const route = routePlace({
          explicit,
          callerMachine: caller.remoteId ?? PC_MACHINE_ID,
          roleAnyPlace: role.anyPlace === true,
          roleId: role.id,
          projectPath,
          projectName: scope.projectName ?? this.boardName(projectPath),
          request: call.pedido,
          machines,
          rules: this.ports.routing?.() ?? null,
        });
        if (route.refused) return fail(`Não abri: ${route.refused}`);
        const remoteId = route.machine === PC_MACHINE_ID ? undefined : route.machine;
        const movedFrom = route.overflowFrom;
        const full = route.queue ? (this.waitReasons(route.machine) ?? []) : undefined;
        const leadersBefore = ownersLeader ? boardLeaders(this.board(projectPath)) : [];
        const placeId = placeCardId(crypto.randomUUID());
        let made = false;
        this.ports.applyGesture(projectPath, (doc) => {
          // The Líder único has no card: the new place is born at the top of the board, right below it.
          const withPlace = addPlace(doc, projectPath, { id: placeId, roleId: role.id, ...(ownersLeader ? {} : { by: 'session' as const }), ...(self ? { origin: { x: self.x + 260, y: self.y } } : {}) });
          if (withPlace === doc) return doc;
          made = true;
          return self ? addLink(withPlace, projectPath, { id: crypto.randomUUID(), from: self.id, to: placeId, arrow: true, by: 'session', opened: true }) : withPlace;
        });
        if (!made) return fail('O quadro não aceitou o lugar novo.');
        const name = call.nome ?? role.name;
        const entry: QueuedOpen = {
          projectPath,
          ...(scope.projectName ? { projectName: scope.projectName } : {}),
          placeId,
          role,
          name,
          ...(remoteId ? { remoteId } : {}),
          openedBy: opener,
          firstMessage: call.pedido,
          leader: scope.leader,
          queuedAt: Date.now(),
        };
        const roda = remoteId ? this.ports.remoteLabel(remoteId) : 'este computador';
        if (full !== undefined) {
          this.openQueue.push(entry);
          this.ports.logFaxineiro?.([{ at: entry.queuedAt, kind: 'fila', projectPath, placeId, summary: `${name} (${role.id}) espera vaga em ${roda}: ${full.join('; ')}` }]);
          return {
            ok: true,
            text: json({
              ...(scope.leader ? { quadro: scope.projectName } : {}),
              lugar: placeId,
              nome: name,
              papel: role.id,
              roda,
              fila: this.openQueue.filter((waiting) => (waiting.remoteId ?? PC_MACHINE_ID) === (remoteId ?? PC_MACHINE_ID)).length,
              porque: route.reason,
              aviso: `Na fila: ${roda} está cheia (${full.join('; ')}). O lugar já está no quadro, e a sessão abre sozinha, com o seu pedido, quando a máquina tiver vaga. Não abra outra para o mesmo trabalho.`,
            }),
          };
        }
        this.launch(entry);
        return {
          ok: true,
          text: json({
            ...(scope.leader ? { quadro: scope.projectName } : {}),
            lugar: placeId,
            nome: name,
            papel: role.id,
            roda,
            porque: route.reason,
            ...(movedFrom ? { mudouDeLugar: `${movedFrom} está cheia; o papel permite outro lugar.` } : {}),
            ...(leadersBefore.length > 0 ? { atencao: `o quadro já tinha Líder (${leadersBefore.join(', ')}). Se ele só estava fechado, sessao_retomar o traz de volta; feche o que sobrar.` } : {}),
            aviso: 'Você recebe um aviso a cada turno que ela terminar. Para mandar mais trabalho: sessao_enviar.',
          }),
        };
      }
    }
  }
}
