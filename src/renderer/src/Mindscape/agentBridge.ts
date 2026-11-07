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
  applyBoardOps,
  describeBoard,
  hasArrowLink,
  placeState,
  type BoardScopedCall,
  type BoardToolCall,
} from '../../../shared/mindscape/agent-tools';
import type { MindscapeBoardResponse } from '../../../shared/mindscape/channels';
import { LEADER_OF_ALL, isLeaderOfAllTab, knownBoards, resolveBoard, type KnownBoard } from '../../../shared/mindscape/leader';
import { LEADER_OF_ALL_FROM, canReach, canReachLeader, findPlace, firstLiveAbove } from '../../../shared/mindscape/reach';
import type { LedgerPassedOn, LedgerPassOnRequest } from '../../../shared/ledger/channels';
import { addLink, addPlace, placeCardId, placeHasStarted, placeOfSession, type MindscapeBoard, type MindscapeDoc, type SessionPlaceCard } from '../../../shared/mindscape/model';
import type { SemaphoreState } from '../../../shared';
import type { SessionRole } from '../../../shared/roles';
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
  private readonly startChecks = new Map<string, { readonly timer: ReturnType<typeof setTimeout>; readonly report: () => void }>();
  /** Tabs the Líder único sent work to with `sessao_enviar`: their end-of-turn notices go to it, on any board. */
  private readonly leaderHears = new Set<string>();
  /** Places the Líder único opened in this run (`projectPath\nplaceId`); the tabs' `openedBy` covers a restart. */
  private readonly leaderOpened = new Set<string>();
  /** A closed place waiting PASS_ON_GRACE_MS before its tasks pass on (`projectPath\nplaceId` → timer). */
  private readonly passOnTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        if (this.tabOfPlace(projectPath, place.id)) return; // it came back (reopened, renewed)
        void this.passOn([{ projectPath, placeId: place.id, gone: 'fechada' }]);
      }, PASS_ON_GRACE_MS),
    );
  }

  /** Places of every board that never started: their tasks pass on once the main's grace is over (`ownerGone`). */
  checkNotStarted(): Promise<void> {
    if (!this.ports.loaded) return Promise.resolve();
    const gone: { projectPath: string; placeId: string; gone: 'nao-comecou' }[] = [];
    for (const [projectPath, board] of Object.entries(this.ports.doc().boards)) {
      for (const card of Object.values(board.cards)) if (card.kind === 'session' && !placeHasStarted(card)) gone.push({ projectPath, placeId: card.id, gone: 'nao-comecou' });
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

  /** Once START_GRACE_MS is over, a session that still took nothing is reported to whoever opened it, once. */
  private watchStart(tabId: string, projectPath: string, openerPlace: string, placeId: string, name: string): void {
    const report = (): void => {
      this.startChecks.delete(tabId);
      if (this.ports.stateOf(tabId) !== 'working' || !this.ports.unconfirmed(tabId)) return;
      const opener = openerPlace === LEADER_OF_ALL ? this.leaderTab() : this.tabOfPlace(projectPath, openerPlace);
      if (!opener) return;
      this.ports.sendLine(opener.id, `◆ ${name} (${placeId}) ${this.startState(tabId)}. Veja a tela dela com sessao_ver_tela ou peça ao dono.`);
    };
    this.startChecks.set(tabId, { timer: setTimeout(report, START_GRACE_MS), report });
  }

  /** 07/11 — the terminal of a tab failed to start: whoever opened it hears why now, not after the grace. */
  startFailed(tabId: string): void {
    const check = this.startChecks.get(tabId);
    if (!check) return;
    clearTimeout(check.timer);
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
      for (const pasta of call.pastas) {
        const match = resolveBoard(this.boards(), pasta);
        if (!match.ok) continue;
        const board = this.board(match.board.projectPath);
        const places = board ? Object.values(board.cards).filter((card): card is SessionPlaceCard => card.kind === 'session') : [];
        states[pasta] = places.map((place) => ({ id: place.id, estado: this.stateName(match.board.projectPath, place) }));
      }
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
        const tabId = this.ports.openSession({
          projectPath,
          ...(scope.projectName ? { projectName: scope.projectName } : {}),
          placeId,
          role,
          name,
          ...(remoteId ? { remoteId } : {}),
          openedBy: opener,
          firstMessage: call.pedido,
        });
        this.openedBy.set(tabId, opener);
        this.openedAt.set(tabId, Date.now());
        if (scope.leader) this.leaderOpened.add(`${projectPath}\n${placeId}`);
        this.watchStart(tabId, projectPath, opener, placeId, name);
        return {
          ok: true,
          text: json({
            ...(scope.leader ? { quadro: scope.projectName } : {}),
            lugar: placeId,
            nome: name,
            papel: role.id,
            roda: remoteId ? this.ports.remoteLabel(remoteId) : 'este computador',
            aviso: 'Você recebe um aviso a cada turno que ela terminar. Para mandar mais trabalho: sessao_enviar.',
          }),
        };
      }
    }
  }
}
