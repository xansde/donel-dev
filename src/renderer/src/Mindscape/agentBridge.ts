// Quadro por MCP — the renderer side of the board and session tools (PDA mindscape-openrig, items 08/13 +
// B37). The main relays each call of the MCP server `donel` here (main/board-bridge.ts) because the renderer
// owns the Mindscape document (ADR 0004) and the tabs. What lives here, in memory:
// - who opened whom (`sessao_abrir`), for the cap of 4 live sessions per caller;
// - the messages held while the owner types in the destination or a permission is open;
// - the end-of-turn notices to the sessions that hold an arrow to the one that ended (with a guard against
//   two sessions pinging each other forever).
// Decisions of the owner (04/11): docs/refinamentos/time-de-sessoes-v1.md.
// Líder único (ADR 0007): the session with the role `lider` and no project acts on every board, naming it with
// `quadro`; its links are derived (src/shared/mindscape/leader.ts). Every other session stays on its own board.

import {
  applyBoardOps,
  describeBoard,
  hasArrowLink,
  placeState,
  type BoardScopedCall,
  type BoardToolCall,
} from '../../../shared/mindscape/agent-tools';
import { LEADER_OF_ALL, isLeaderOfAllTab, knownBoards, leaderReaches, resolveBoard, type KnownBoard } from '../../../shared/mindscape/leader';
import type { MindscapeBoardResponse } from '../../../shared/mindscape/channels';
import { addLink, addPlace, placeCardId, placeOfSession, type MindscapeBoard, type MindscapeDoc, type SessionPlaceCard } from '../../../shared/mindscape/model';
import type { SemaphoreState } from '../../../shared';
import type { SessionRole } from '../../../shared/roles';

/** Live sessions a caller may have opened with `sessao_abrir` before the owner is asked. */
export const OPEN_CAP = 4;
/** The end-of-turn notice carries at most this much of the summary. */
const NOTICE_CHARS = 600;
/** A held message is tried again on this beat. */
const RETRY_MS = 1500;

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
}

export interface OpenSessionRequest {
  readonly projectPath: string;
  readonly projectName?: string;
  readonly placeId: string;
  readonly role: SessionRole;
  readonly name: string;
  readonly remoteId?: string;
  /** Sent as soon as the new tab exists (the chat's send driver waits for the session). */
  readonly firstMessage: string;
}

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
  /** One line to the session of `tabId` through the chat's send driver (or typed into the terminal). */
  sendLine(tabId: string, text: string): void;
  /** The owner is typing in that tab's composer. */
  ownerTyping(tabId: string): boolean;
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

interface Held {
  readonly tabId: string;
  readonly text: string;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
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
  private readonly held: Held[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Tab that last got an end-of-turn notice → the place that ended (the loop guard). */
  private readonly lastNoticeFrom = new Map<string, string>();

  constructor(ports: AgentBridgePorts) {
    this.ports = ports;
  }

  setPorts(ports: AgentBridgePorts): void {
    this.ports = ports;
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.held.length = 0;
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
      return state ? STATE_NAMES[state] : undefined;
    });
  }

  /** Live sessions `placeId` opened; for the Líder único, only those of `projectPath` (its cap is per board). */
  private liveOpenedBy(placeId: string, projectPath?: string): number {
    let count = 0;
    for (const [tabId, opener] of this.openedBy) {
      if (opener !== placeId) continue;
      if (this.ports.stateOf(tabId) === undefined) this.openedBy.delete(tabId);
      else if (projectPath === undefined || this.ports.tabs().find((tab) => tab.id === tabId)?.cwd === projectPath) count += 1;
    }
    return count;
  }

  /** The open tab of the Líder único, if any. */
  private leaderTab(): BridgeTab | undefined {
    return this.ports.tabs().find((tab) => isLeaderOfAllTab(tab) && this.ports.stateOf(tab.id) !== undefined);
  }

  /** May the caller send to (and direct) `placeId`: the Líder único by the derived links, the others by an arrow. */
  private canSend(scope: Scope, board: MindscapeBoard | undefined, placeId: string): boolean {
    if (scope.leader) return leaderReaches(board, placeId);
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
        voceAlcanca: places.filter((place) => leaderReaches(board, place.id)).map((place) => ({ id: place.id, ...(place.roleId ? { papelNome: this.roleName(place.roleId) } : {}) })),
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
      if (!match.ok || match.board.projectPath !== caller.cwd) return { ok: false, text: 'Só o Líder único alcança outros quadros. Esta sessão usa sempre o próprio quadro (chame sem "quadro").' };
    }
    const self = this.placeOfTab(caller);
    return { projectPath: caller.cwd, ...(caller.projectName ? { projectName: caller.projectName } : {}), leader: false, ...(self ? { self } : {}) };
  }


  // ---- delivery with retention -------------------------------------------------------------------------------

  /** Delivers now, or holds it while the owner types there or a permission is open. Order per tab is kept. */
  deliver(tabId: string, text: string): 'entregue' | 'retida' {
    const blocked = this.held.some((item) => item.tabId === tabId) || this.isBlocked(tabId);
    if (!blocked) {
      this.ports.sendLine(tabId, text);
      return 'entregue';
    }
    this.held.push({ tabId, text });
    if (this.timer === null) this.timer = setInterval(() => this.flush(), RETRY_MS);
    return 'retida';
  }

  private isBlocked(tabId: string): boolean {
    return this.ports.ownerTyping(tabId) || this.ports.stateOf(tabId) === 'permission';
  }

  private flush(): void {
    const done = new Set<string>();
    for (let index = 0; index < this.held.length; ) {
      const item = this.held[index]!;
      if (this.ports.stateOf(item.tabId) === undefined) {
        this.held.splice(index, 1); // the session left: nothing to deliver to
        continue;
      }
      if (done.has(item.tabId) || this.isBlocked(item.tabId)) {
        done.add(item.tabId);
        index += 1;
        continue;
      }
      this.ports.sendLine(item.tabId, item.text);
      this.held.splice(index, 1);
    }
    if (this.held.length === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** How many messages wait for that tab (the place shows "1 mensagem esperando"). */
  heldFor(tabId: string): number {
    return this.held.filter((item) => item.tabId === tabId).length;
  }

  // ---- end-of-turn notice (D) --------------------------------------------------------------------------------

  /** A session ended a turn: each open session with an arrow to it (or that opened it) hears a short notice. */
  turnEnded(sessionId: string, text: string): void {
    const ended = this.ports.tabs().find((tab) => tab.claudeSessionId === sessionId);
    if (!ended?.cwd || isLeaderOfAllTab(ended)) return;
    const place = this.placeOfTab(ended);
    const board = this.board(ended.cwd);
    if (!place || !board) return;
    const listeners = new Set<string>();
    for (const link of board.links) if (link.arrow && link.to === place.id) listeners.add(link.from);
    const opener = this.openedBy.get(ended.id);
    if (opener) listeners.add(opener);
    // Líder único — every place linked to it (and every one it opened) tells it, on any board.
    if (leaderReaches(board, place.id)) listeners.add(LEADER_OF_ALL);
    const guard = this.lastNoticeFrom.get(ended.id);
    this.lastNoticeFrom.delete(ended.id);
    const role = this.roleName(place.roleId);
    const summary = text.trim().replace(/\s+/g, ' ');
    const cut = summary.length > NOTICE_CHARS ? `${summary.slice(0, NOTICE_CHARS)}…` : summary;
    const line = `◆ ${role ? `${role} ` : ''}${ended.name} (${place.id}) terminou: ${cut || '(sem resumo)'}`;
    const boardName = ended.projectName ?? ended.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ended.cwd;
    for (const listenerPlace of listeners) {
      if (listenerPlace === place.id || listenerPlace === guard) continue;
      const leader = listenerPlace === LEADER_OF_ALL;
      const target = leader ? this.leaderTab() : this.tabOfPlace(ended.cwd, listenerPlace);
      if (!target) continue;
      this.lastNoticeFrom.set(target.id, place.id);
      // The Líder único hears every board: the notice says which one.
      this.deliver(target.id, leader ? line.replace(`(${place.id})`, `(${place.id}, quadro ${boardName})`) : line);
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
            alcance: 'Todos os quadros. Diga o quadro em "quadro" nas ferramentas de quadro e de sessão.',
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
    const stateOf = (sessionId: string): string | undefined => {
      const tab = this.ports.tabs().find((candidate) => candidate.cwd === projectPath && candidate.claudeSessionId === sessionId);
      const state = tab ? this.ports.stateOf(tab.id) : undefined;
      return state ? STATE_NAMES[state] : undefined;
    };

    switch (call.tool) {
      case 'quadro_ler': {
        const described = describeBoard(this.ports.doc(), projectPath, { ...(self ? { selfPlaceId: self.id } : {}), roleNames, stateOf });
        if (!scope.leader) return { ok: true, text: json(described) };
        const board = this.board(projectPath);
        const reached = board ? Object.keys(board.cards).filter((id) => leaderReaches(board, id)) : [];
        return { ok: true, text: json({ quadro: scope.projectName, ...described, voceAlcanca: reached }) };
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
        return {
          ok: true,
          text: json(
            places.map((place) => {
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
                ...(tab && this.heldFor(tab.id) > 0 ? { mensagensEsperando: this.heldFor(tab.id) } : {}),
              };
            }),
          ),
        };
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
              ? `Sem ligação: "${place.id}" está abaixo de outro lugar do quadro ${scope.projectName ?? projectPath} (há uma seta de outro lugar para ele). Mande para quem aponta para ele, ou peça ao dono.`
              : `Sem ligação: não há seta do seu lugar (${self?.id}) para "${place.id}". Peça ao dono, ou use sessao_abrir.`,
          );
        const target = this.tabOfPlace(projectPath, place.id);
        if (!target) return fail(`"${place.id}" não está aberta agora.`);
        const from = scope.leader ? `Líder (${LEADER_OF_ALL})` : `${this.roleName(self?.roleId) ?? caller.name} (${self?.id})`;
        const status = this.deliver(target.id, `◆ De ${from}: ${call.texto}`);
        return { ok: true, text: status === 'entregue' ? 'Entregue.' : 'Retida: o dono está digitando lá ou há uma permissão aberta; entra sozinha depois.' };
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
        if (open >= OPEN_CAP) {
          const allowed = await this.ports.askOwner({ caller: caller.name, role: role.name, request: call.pedido, open });
          if (!allowed) return fail(`O dono negou abrir mais uma sessão (você já tem ${open} abertas${scope.leader ? ' neste quadro' : ''}). Use as que existem.`);
        }
        const placeId = placeCardId(crypto.randomUUID());
        let made = false;
        this.ports.applyGesture(projectPath, (doc) => {
          // The Líder único has no card: the new place is at the top of the board, so it is born linked to it.
          const withPlace = addPlace(doc, projectPath, { id: placeId, roleId: role.id, by: 'session', ...(self ? { origin: { x: self.x + 260, y: self.y } } : {}) });
          if (withPlace === doc) return doc;
          made = true;
          return self ? addLink(withPlace, projectPath, { id: crypto.randomUUID(), from: self.id, to: placeId, arrow: true, by: 'session' }) : withPlace;
        });
        if (!made) return fail('O quadro não aceitou o lugar novo.');
        const name = call.nome ?? role.name;
        const projectName = scope.projectName ?? projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
        const tabId = this.ports.openSession({
          projectPath,
          projectName,
          placeId,
          role,
          name,
          ...(remoteId ? { remoteId } : {}),
          firstMessage: call.pedido,
        });
        this.openedBy.set(tabId, opener);
        return {
          ok: true,
          text: json({
            ...(scope.leader ? { quadro: projectName } : {}),
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
