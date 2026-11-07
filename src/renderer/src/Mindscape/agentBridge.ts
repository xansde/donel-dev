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
// A place that is gone (its tab closed and did not come back in PASS_ON_GRACE_MS, or it never started) passes its live
// tasks to the first live place above it, or to the Líder único (`firstLiveAbove`), and whoever gets them hears it.

import {
  LEADER_PLACE_IS_THE_OWNERS,
  applyBoardOps,
  describeBoard,
  hasArrowLink,
  placeState,
  type BoardScopedCall,
  type BoardToolCall,
} from '../../../shared/mindscape/agent-tools';
import type { MindscapeBoardResponse } from '../../../shared/mindscape/channels';
import { LEADER_OF_ALL, isLeaderOfAllTab, knownBoards, resolveBoard, type KnownBoard } from '../../../shared/mindscape/leader';
import { LEADER_OF_ALL_FROM, canFaxineiroClose, canReach, canReachLeader, findPlace, firstLiveAbove, isBoardOrchestrator } from '../../../shared/mindscape/reach';
import { FAXINEIRO_OPENER, PC_MACHINE_ID, type FaxineiroLogEntry, type SessionView } from '../../../shared/faxineiro/triggers';
import type { FaxineiroWakeOrder } from '../../../shared/faxineiro/ipc';
import type { LedgerPassedOn, LedgerPassOnRequest } from '../../../shared/ledger/channels';
import { addLink, addPlace, noteCardId, placeCardId, placeHasStarted, placeOfSession, type MindscapeBoard, type MindscapeDoc, type SessionPlaceCard } from '../../../shared/mindscape/model';
import type { SemaphoreState } from '../../../shared';
import { FAXINEIRO_ROLE_ID, LEADER_ROLE_ID, type SessionRole } from '../../../shared/roles';
import type { SendFrom } from '../chat/sendDriver';

/**
 * A session opened by `sessao_abrir` that sent no hook in this long did not start: the gate waits up to 30 s for
 * the CLI and the first paste up to 45 s more on a machine short of RAM.
 */
const START_GRACE_MS = 90_000;
/** `sessao_enviar` answers once the message went in, was queued, or failed; past this it says "ainda não entrou". */
const DELIVERY_WAIT_MS = 40_000;
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
const CLOSE_POLL_MS = 500;

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

export interface AgentBridgePorts {
  readonly loaded: boolean;
  doc(): MindscapeDoc;
  /** One owner gesture (undoable): the reducer runs synchronously, or not at all when the board did not load. */
  applyGesture(projectPath: string, reducer: (doc: MindscapeDoc) => MindscapeDoc): void;
  tabs(): readonly BridgeTab[];
  tabOfPty(ptyId: string): BridgeTab | undefined;
  /** Live state of an open tab; `undefined` = the process left. */
  stateOf(tabId: string): SemaphoreState | undefined;
  roles(): readonly SessionRole[];
  /** Opens the tab of a place without stealing the focus and sends its first message; returns the tab id. */
  openSession(request: OpenSessionRequest): string;
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
  /** The projects of the sidebar (path + name): the Líder único may name one that has no board yet. */
  projects(): readonly { readonly path: string; readonly name: string }[];
  /** 06/11 — the live tasks of gone places pass on (the main writes the ledger); answers what moved. */
  passOn?(requests: readonly LedgerPassOnRequest[]): Promise<readonly LedgerPassedOn[]>;
  /** t-b3b26e60 — since when the tab is in its current state (epoch ms); `undefined` = no reading. */
  stateEnteredAt?(tabId: string): number | undefined;
  /** t-b3b26e60 — lines for `<userData>/rotinas/faxineiro.log` (each close the Faxineiro asks for, each wake). */
  logFaxineiro?(entries: readonly FaxineiroLogEntry[]): void;
}

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
  /** t-b3b26e60 — machines where a new session waits for room (`pc` or a remote id → why), from the minute round. */
  private fullMachines = new Map<string, readonly string[]>();
  /** t-b3b26e60 — the `sessao_abrir` waiting for room, oldest first. In memory: a restart leaves them "não começou". */
  private openQueue: QueuedOpen[] = [];
  /** t-b3b26e60 — what each tab opened by `sessao_abrir` was asked: a tab that never started can go back to the queue. */
  private readonly launched = new Map<string, QueuedOpen>();

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
    const requests = gone.map((request) => ({
      ...request,
      to: firstLiveAbove(this.board(request.projectPath), request.placeId, (id) => this.tabOfPlace(request.projectPath, id) !== undefined) ?? LEADER_OF_ALL,
    }));
    let passed: readonly LedgerPassedOn[] = [];
    try {
      passed = await this.ports.passOn(requests);
    } catch {
      return; // nothing moved; the next close or check tries again
    }
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

  /** The full machines of the last minute round (`pc` or a remote id → why). */
  setFullMachines(full: Readonly<Record<string, readonly string[]>>): void {
    this.fullMachines = new Map(Object.entries(full));
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
      if (this.fullMachines.has(machine) || used.has(machine)) {
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
      if (tab && state === 'working' && this.ports.unconfirmed(tab.id)) return this.startState(tab.id);
      return state ? STATE_NAMES[state] : undefined;
    });
  }

  /**
   * 05/11 — a live process that never sent a hook is not "trabalhando": it has not taken any message yet. A session
   * opened by `sessao_abrir` that is still like that after START_GRACE_MS failed to start, and says why.
   */
  private startState(tabId: string): string {
    const openedAt = this.openedAt.get(tabId);
    if (openedAt === undefined) return 'aberta, sem nenhum pedido ainda';
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

  /** May the caller send to `placeId`: the Líder único by its reach, the others by an arrow of theirs. */
  private canSend(scope: Scope, board: MindscapeBoard | undefined, placeId: string): boolean {
    if (scope.leader) return this.leaderReaches(scope.projectPath, placeId);
    return scope.self ? hasArrowLink(board, scope.self.id, placeId) : false;
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

  /** A session ended a turn: each open session with an arrow to it (or that opened it) hears a short notice. */
  turnEnded(sessionId: string, text: string): void {
    const ended = this.ports.tabs().find((tab) => tab.claudeSessionId === sessionId);
    if (!ended?.cwd || isLeaderOfAllTab(ended)) return;
    // B40 — the same end of turn arriving twice (a repeated or late hook) is announced once.
    if (this.lastNoticeText.get(sessionId) === text) return;
    this.lastNoticeText.set(sessionId, text);
    const place = this.placeOfTab(ended);
    const board = this.board(ended.cwd);
    if (!place || !board) return;
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
    const boardName = ended.projectName ?? lastSegment(ended.cwd);
    for (const listenerPlace of listeners) {
      if (listenerPlace === place.id || listenerPlace === guard) continue;
      const leader = listenerPlace === LEADER_OF_ALL;
      const target = leader ? this.leaderTab() : this.tabOfPlace(ended.cwd, listenerPlace);
      if (!target) continue;
      this.lastNoticeFrom.set(target.id, place.id);
      // The Líder único hears every board: the notice says which one.
      this.ports.sendLine(target.id, leader ? line.replace(`(${place.id})`, `(${place.id}, quadro ${boardName})`) : line);
    }
  }

  // ---- the tools ---------------------------------------------------------------------------------------------

  async handle(ptyId: string, call: BoardToolCall): Promise<Omit<MindscapeBoardResponse, 'requestId'>> {
    try {
      return await this.run(ptyId, call);
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  private async run(ptyId: string, call: BoardToolCall): Promise<Answer> {
    const fail = (text: string): Answer => ({ ok: false, text });
    if (!this.ports.loaded) return fail('O quadro ainda não abriu no app (ou falhou ao abrir). Tente de novo em instantes.');
    const caller = this.ports.tabOfPty(ptyId);
    if (!caller) return fail('Esta sessão não é uma aba do Donel Dev.');
    const roleNames = new Map(this.ports.roles().map((role) => [role.id, role.name]));

    if (call.tool === 'papeis_listar') return { ok: true, text: json(this.ports.roles().map((role) => ({ id: role.id, nome: role.name }))) };

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
              const opener = tab ? this.openedBy.get(tab.id) : undefined;
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
        return {
          ok: true,
          text: json({
            id: place.id,
            ...(place.roleId ? { papelNome: this.roleName(place.roleId) } : {}),
            estado: this.stateName(projectPath, place),
            ultimoTurno: note?.kind === 'session-note' ? { texto: note.text, em: new Date(note.writtenAt).toISOString() } : null,
          }),
        };
      }

      case 'sessao_enviar': {
        if (!scope.leader && !self) return fail('Seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        // Back up to the Líder único (t-52b31719): only from a session it opened or one below it (reach.ts).
        if (!scope.leader && self && call.para.trim().toLowerCase() === LEADER_OF_ALL) {
          const reach = canReachLeader(this.ports.doc(), { projectPath, placeId: self.id }, (id) => this.openedByLeader(projectPath, id));
          if (!reach.ok) return fail(`Sem ligação com o Líder único: ${reach.reason}`);
          const leader = this.leaderTab();
          if (!leader) return fail('O Líder único não está aberto agora. Registre o que precisa no Oráculo (tarefa_criar ou tarefa_transferir com "para": "lider") e siga.');
          const outcome = await this.ports.deliverLine(leader.id, `◆ De ${signature}, quadro ${scope.projectName ?? this.boardName(projectPath)}: ${call.texto}`, DELIVERY_WAIT_MS, 'session');
          return this.deliveryAnswer(outcome, leader.id);
        }
        const board = this.board(projectPath);
        const place = board?.cards[call.para];
        if (place?.kind !== 'session') return fail(`"${call.para}" não é um lugar do quadro (veja sessao_listar).`);
        if (!this.canSend(scope, board, place.id))
          return fail(
            scope.leader
              ? `Sem ligação: "${place.id}" não está no topo do quadro ${scope.projectName ?? projectPath} nem abaixo dele pelas setas do dono. Peça ao dono.`
              : `Sem ligação: não há seta do seu lugar (${self?.id}) para "${place.id}". Peça ao dono, ou use sessao_abrir.`,
          );
        const target = this.tabOfPlace(projectPath, place.id);
        if (!target) return fail(`"${place.id}" não está aberta agora.`);
        if (scope.leader) this.leaderHears.add(target.id);
        // 05/11 — "Entregue" only once the CLI of there took it: the answer waits for the send to end.
        const outcome = await this.ports.deliverLine(target.id, `◆ De ${signature}: ${call.texto}`, DELIVERY_WAIT_MS, 'session');
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
        const permission = 'ela tem um pedido de permissão aberto na tela; o dono responde antes.';
        if (this.ports.permissionOnScreen(target.id)) return no(permission);
        let cut = false;
        if (this.ports.stateOf(target.id) === 'working') {
          this.ports.sendLine(target.id, `◆ De ${signature}: pause agora e não comece nada novo. Esta sessão vai ser fechada em instantes (o dono pode retomá-la depois).`);
          const deadline = Date.now() + CLOSE_WAIT_MS;
          while (this.ports.stateOf(target.id) === 'working' && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, CLOSE_POLL_MS));
          }
          cut = this.ports.stateOf(target.id) === 'working';
        }
        const state = this.ports.stateOf(target.id);
        if (state === undefined) return { ok: true, text: 'Fechada.' }; // it left on its own meanwhile
        if (this.ports.permissionOnScreen(target.id)) return no(permission);
        this.ports.closeTab(target.id);
        this.openedBy.delete(target.id);
        this.leaderHears.delete(target.id);
        return { ok: true, text: cut ? `Fechada (o turno não acabou em ${CLOSE_WAIT_MS / 1000} s; cortei).` : 'Fechada.' };
      }

      case 'sessao_abrir': {
        const opener = scope.leader ? LEADER_OF_ALL : self?.id;
        if (opener === undefined) return fail('Seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        const role = this.ports.roles().find((candidate) => candidate.id === call.papel);
        if (!role) return fail(`Papel "${call.papel}" não existe (veja papeis_listar).`);
        if (role.id === LEADER_ROLE_ID) return fail(`Não abri: ${LEADER_PLACE_IS_THE_OWNERS}`);
        // `onde` — absent or "aqui": where the caller runs; "este computador": local; else a remote place by label or id.
        let remoteId = caller.remoteId;
        const where = call.onde?.trim().toLowerCase();
        if (where && where !== 'aqui') {
          if (where === 'este computador' || where === 'local') remoteId = undefined;
          else {
            const remotes = this.ports.remotes();
            const found = remotes.find((remote) => remote.id.toLowerCase() === where || remote.label.toLowerCase() === where);
            if (!found) return fail(`Lugar "${call.onde}" não existe. Use "aqui", "este computador" ou um destes: ${remotes.map((remote) => remote.label).join(', ') || '(nenhum lugar remoto)'}.`);
            remoteId = found.id;
          }
        }
        // The Líder único has a cap per board; a place, its own.
        const open = this.liveOpenedBy(opener, scope.leader ? projectPath : undefined);
        const cap = this.ports.openCap?.() ?? null;
        if (cap !== null && open >= cap) {
          const allowed = await this.ports.askOwner({ caller: caller.name, role: role.name, request: call.pedido, open });
          if (!allowed) return fail(`O dono negou abrir mais uma sessão (você já tem ${open} abertas${scope.leader ? ' neste quadro' : ''}). Use as que existem.`);
        }
        // t-b3b26e60 — a full machine: another remote place when the role allows it ("lugar: qualquer"), else the queue.
        let movedFrom: string | undefined;
        const full = this.fullMachines.get(remoteId ?? PC_MACHINE_ID);
        if (full && role.anyPlace) {
          const other = this.ports.remotes().find((remote) => remote.id !== remoteId && !this.fullMachines.has(remote.id));
          if (other) {
            movedFrom = remoteId ? this.ports.remoteLabel(remoteId) : 'este computador';
            remoteId = other.id;
          }
        }
        const placeId = placeCardId(crypto.randomUUID());
        let made = false;
        this.ports.applyGesture(projectPath, (doc) => {
          // The Líder único has no card: the new place is born at the top of the board, right below it.
          const withPlace = addPlace(doc, projectPath, { id: placeId, roleId: role.id, by: 'session', ...(self ? { origin: { x: self.x + 260, y: self.y } } : {}) });
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
        if (full !== undefined && movedFrom === undefined) {
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
            ...(movedFrom ? { mudouDeLugar: `${movedFrom} está cheia; o papel permite outro lugar.` } : {}),
            aviso: 'Você recebe um aviso a cada turno que ela terminar. Para mandar mais trabalho: sessao_enviar.',
          }),
        };
      }
    }
  }
}
