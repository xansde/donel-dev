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

import {
  applyBoardOps,
  describeBoard,
  hasArrowLink,
  placeState,
  type BoardToolCall,
} from '../../../shared/mindscape/agent-tools';
import type { MindscapeBoardResponse } from '../../../shared/mindscape/channels';
import { addLink, addPlace, placeCardId, placeOfSession, type MindscapeBoard, type MindscapeDoc, type SessionPlaceCard } from '../../../shared/mindscape/model';
import type { SemaphoreState } from '../../../shared';
import type { SessionRole } from '../../../shared/roles';

/** Live sessions a caller may have opened with `sessao_abrir` before the owner is asked. */
export const OPEN_CAP = 4;
/** The end-of-turn notice carries at most this much of the summary. */
const NOTICE_CHARS = 600;

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
  /** The caller's place: the new session is its team, out of the tab bar, also after an update or a restart. */
  readonly openedBy: string;
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
  /** A permission prompt is drawn on that tab's screen right now (read from the screen, never from a mark). */
  permissionOnScreen(tabId: string): boolean;
  /** The owner allows (true) or denies a session over the cap. */
  askOwner(question: { readonly caller: string; readonly role: string; readonly request: string; readonly open: number }): Promise<boolean>;
  remoteLabel(remoteId: string): string;
  /** The remote places the app knows (id + label), for `onde` of `sessao_abrir`. */
  remotes(): readonly { readonly id: string; readonly label: string }[];
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

export class AgentBridge {
  private ports: AgentBridgePorts;
  /** Tab opened by `sessao_abrir` → the caller's place. */
  private readonly openedBy = new Map<string, string>();
  /** Tab that last got an end-of-turn notice → the place that ended (the loop guard). */
  private readonly lastNoticeFrom = new Map<string, string>();
  /** Session → text of the last turn it was announced for: the same end of turn is announced once. */
  private readonly lastNoticeText = new Map<string, string>();

  constructor(ports: AgentBridgePorts) {
    this.ports = ports;
  }

  setPorts(ports: AgentBridgePorts): void {
    this.ports = ports;
  }

  /** A tab reopened after an update or a restart that had been opened by `opener` (counts for its cap again). */
  adoptOpened(tabId: string, opener: string): void {
    this.openedBy.set(tabId, opener);
  }

  dispose(): void {
    this.lastNoticeFrom.clear();
    this.lastNoticeText.clear();
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

  private liveOpenedBy(placeId: string): number {
    let count = 0;
    for (const [tabId, opener] of this.openedBy) {
      if (opener !== placeId) continue;
      if (this.ports.stateOf(tabId) === undefined) this.openedBy.delete(tabId);
      else count += 1;
    }
    return count;
  }

  // ---- end-of-turn notice (D) --------------------------------------------------------------------------------

  /** A session ended a turn: each open session with an arrow to it (or that opened it) hears a short notice. */
  turnEnded(sessionId: string, text: string): void {
    const ended = this.ports.tabs().find((tab) => tab.claudeSessionId === sessionId);
    if (!ended?.cwd) return;
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
    const guard = this.lastNoticeFrom.get(ended.id);
    this.lastNoticeFrom.delete(ended.id);
    const role = this.roleName(place.roleId);
    const summary = text.trim().replace(/\s+/g, ' ');
    const cut = summary.length > NOTICE_CHARS ? `${summary.slice(0, NOTICE_CHARS)}…` : summary;
    const line = `◆ ${role ? `${role} ` : ''}${ended.name} (${place.id}) terminou: ${cut || '(sem resumo)'}`;
    for (const listenerPlace of listeners) {
      if (listenerPlace === place.id || listenerPlace === guard) continue;
      const target = this.tabOfPlace(ended.cwd, listenerPlace);
      if (!target) continue;
      this.lastNoticeFrom.set(target.id, place.id);
      this.ports.sendLine(target.id, line);
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

  private async run(ptyId: string, call: BoardToolCall): Promise<Omit<MindscapeBoardResponse, 'requestId'>> {
    const fail = (text: string): Omit<MindscapeBoardResponse, 'requestId'> => ({ ok: false, text });
    if (!this.ports.loaded) return fail('O quadro ainda não abriu no app (ou falhou ao abrir). Tente de novo em instantes.');
    const caller = this.ports.tabOfPty(ptyId);
    if (!caller?.cwd) return fail('Esta sessão não é uma aba de projeto do Donel Dev.');
    const projectPath = caller.cwd;
    const self = this.placeOfTab(caller);
    const roleNames = new Map(this.ports.roles().map((role) => [role.id, role.name]));

    switch (call.tool) {
      case 'papeis_listar':
        return { ok: true, text: json(this.ports.roles().map((role) => ({ id: role.id, nome: role.name }))) };

      case 'quadro_ler':
        return {
          ok: true,
          text: json(
            describeBoard(this.ports.doc(), projectPath, {
              ...(self ? { selfPlaceId: self.id } : {}),
              roleNames,
              stateOf: (sessionId) => {
                const tab = this.ports.tabs().find((candidate) => candidate.cwd === projectPath && candidate.claudeSessionId === sessionId);
                const state = tab ? this.ports.stateOf(tab.id) : undefined;
                return state ? STATE_NAMES[state] : undefined;
              },
            }),
          ),
        };

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

      case 'sessao_quem_sou':
        return {
          ok: true,
          text: json({
            nome: caller.name,
            projeto: caller.projectName ?? projectPath,
            pasta: projectPath,
            ...(self ? { lugar: self.id } : { lugar: null, aviso: 'Seu lugar ainda não está no quadro (a sessão acabou de abrir).' }),
            ...(self?.roleId ?? caller.roleId ? { papel: self?.roleId ?? caller.roleId, papelNome: this.roleName(self?.roleId ?? caller.roleId) } : {}),
            roda: caller.remoteId ? this.ports.remoteLabel(caller.remoteId) : 'este computador',
            lugaresRemotos: this.ports.remotes().map((remote) => remote.label),
          }),
        };

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
                podeMandar: self ? hasArrowLink(board, self.id, place.id) : false,
                ...(opener ? { abertaPor: opener } : {}),
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
        if (!self) return fail('Seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
        const board = this.board(projectPath);
        const place = board?.cards[call.para];
        if (place?.kind !== 'session') return fail(`"${call.para}" não é um lugar do quadro (veja sessao_listar).`);
        if (!hasArrowLink(board, self.id, place.id)) return fail(`Sem ligação: não há seta do seu lugar (${self.id}) para "${place.id}". Peça ao dono, ou use sessao_abrir.`);
        const target = this.tabOfPlace(projectPath, place.id);
        if (!target) return fail(`"${place.id}" não está aberta agora.`);
        const from = this.roleName(self.roleId) ?? caller.name;
        this.ports.sendLine(target.id, `◆ De ${from} (${self.id}): ${call.texto}`);
        return {
          ok: true,
          text: this.ports.permissionOnScreen(target.id)
            ? 'Entregue à fila de lá. Há uma permissão aberta na tela dela: a mensagem entra sozinha assim que ela fechar.'
            : 'Entregue: foi para a caixa do CLI de lá (se ela estiver trabalhando, o próprio CLI enfileira).',
        };
      }

      case 'sessao_abrir': {
        if (!self) return fail('Seu lugar ainda não está no quadro; espere o primeiro turno terminar.');
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
        const open = this.liveOpenedBy(self.id);
        if (open >= OPEN_CAP) {
          const allowed = await this.ports.askOwner({ caller: caller.name, role: role.name, request: call.pedido, open });
          if (!allowed) return fail(`O dono negou abrir mais uma sessão (você já tem ${open} abertas). Use as que existem.`);
        }
        const placeId = placeCardId(crypto.randomUUID());
        let made = false;
        this.ports.applyGesture(projectPath, (doc) => {
          const withPlace = addPlace(doc, projectPath, { id: placeId, roleId: role.id, by: 'session', origin: { x: self.x + 260, y: self.y } });
          if (withPlace === doc) return doc;
          made = true;
          return addLink(withPlace, projectPath, { id: crypto.randomUUID(), from: self.id, to: placeId, arrow: true, by: 'session' });
        });
        if (!made) return fail('O quadro não aceitou o lugar novo.');
        const name = call.nome ?? role.name;
        const tabId = this.ports.openSession({
          projectPath,
          ...(caller.projectName ? { projectName: caller.projectName } : {}),
          placeId,
          role,
          name,
          ...(remoteId ? { remoteId } : {}),
          openedBy: self.id,
          firstMessage: call.pedido,
        });
        this.openedBy.set(tabId, self.id);
        return {
          ok: true,
          text: json({
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
