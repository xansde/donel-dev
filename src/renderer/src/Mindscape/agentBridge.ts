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
import { LEADER_OF_ALL_FROM, canReach, findPlace } from '../../../shared/mindscape/reach';
import { addLink, addPlace, placeCardId, placeOfSession, type MindscapeBoard, type MindscapeDoc, type SessionPlaceCard } from '../../../shared/mindscape/model';
import type { SemaphoreState } from '../../../shared';
import type { SessionRole } from '../../../shared/roles';

/**
 * A session opened by `sessao_abrir` that sent no hook in this long did not start: the gate waits up to 30 s for
 * the CLI and the first paste up to 45 s more on a machine short of RAM.
 */
const START_GRACE_MS = 90_000;
/** `sessao_enviar` answers once the message went in, was queued, or failed; past this it says "ainda não entrou". */
const DELIVERY_WAIT_MS = 40_000;
/** The end-of-turn notice carries at most this much of the summary. */
const NOTICE_CHARS = 600;
/** `sessao_fechar` waits at most this long for the destination's turn to end, then closes anyway. */
export const CLOSE_WAIT_MS = 20_000;
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
  /** One line to the session of `tabId` through the chat's send driver (or typed into the terminal). */
  sendLine(tabId: string, text: string): void;
  /** The same, waiting (up to `waitMs`) for the CLI of there to take it or give up. */
  deliverLine(tabId: string, text: string, waitMs: number): Promise<DeliveryOutcome>;
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
  private readonly startChecks = new Set<ReturnType<typeof setTimeout>>();
  /** Tabs the Líder único sent work to with `sessao_enviar`: their end-of-turn notices go to it, on any board. */
  private readonly leaderHears = new Set<string>();

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
      const outcome = await this.ports.deliverLine(target.id, message.text, DELIVERY_WAIT_MS);
      if (outcome.kind !== 'nao-foi') return { placeId: message.placeId };
    }
    const leader = this.leaderTab();
    if (leader) {
      const outcome = await this.ports.deliverLine(leader.id, message.leaderText, DELIVERY_WAIT_MS);
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
    for (const timer of this.startChecks) clearTimeout(timer);
    this.startChecks.clear();
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
    const timer = setTimeout(() => {
      this.startChecks.delete(timer);
      if (this.ports.stateOf(tabId) !== 'working' || !this.ports.unconfirmed(tabId)) return;
      const opener = openerPlace === LEADER_OF_ALL ? this.leaderTab() : this.tabOfPlace(projectPath, openerPlace);
      if (!opener) return;
      this.ports.sendLine(opener.id, `◆ ${name} (${placeId}) ${this.startState(tabId)}. Veja a tela dela com sessao_ver_tela ou peça ao dono.`);
    }, START_GRACE_MS);
    this.startChecks.add(timer);
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
    const summary = text.trim().replace(/\s+/g, ' ');
    const cut = summary.length > NOTICE_CHARS ? `${summary.slice(0, NOTICE_CHARS)}…` : summary;
    const line = `◆ ${role ? `${role} ` : ''}${ended.name} (${place.id}) terminou: ${cut || '(sem resumo)'}`;
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
        const outcome = await this.ports.deliverLine(target.id, `◆ De ${signature}: ${call.texto}`, DELIVERY_WAIT_MS);
        if (outcome.kind === 'entrou') return { ok: true, text: 'Entregue: entrou no Claude de lá.' };
        if (outcome.kind === 'na-fila') return { ok: true, text: 'Entregue à fila do Claude de lá: ela está trabalhando e o próprio CLI a entrega no próximo passo.' };
        if (outcome.kind === 'nao-foi') return fail(`Não entrou: ${outcome.reason}. Veja a tela dela com sessao_ver_tela, ou peça ao dono.`);
        if (outcome.kind === 'pelo-terminal') {
          return { ok: true, text: 'Enviada pelo terminal dela (a aba não tem a visão de chat), sem confirmação de que entrou. NÃO mande de novo; confira com sessao_ver_tela.' };
        }
        return {
          ok: true,
          text: this.ports.permissionOnScreen(target.id)
            ? 'Ainda não entrou: há uma permissão aberta na tela dela. A mensagem entra sozinha assim que ela fechar; NÃO mande de novo.'
            : `Ainda não entrou${outcome.reason ? ` (${outcome.reason})` : ''}; o app segue tentando sozinho. NÃO mande de novo (sairia duas vezes quando a primeira entrar); confira com sessao_ver_tela.`,
        };
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
