// Alcance — the hierarchy that lets a session direct another one (today: `sessao_fechar`). The ONE place
// for this concept (owner 04/11: "fechar sessões só com a hierarquia adequada … tanto pelas setas, quanto
// entre mindscapes"); the single Líder that talks to every board reuses it. Pure.
//
// - Inside a board: a session reaches the places below it by arrows (mine → hers, directly or down a
//   chain). Never up, never sideways, never itself. Only the owner's arrows and the ones `sessao_abrir`
//   makes (mother → daughter) count: an arrow a session draws itself would let it climb above anyone.
// - Across boards: only the Líder the owner placed (not one a session opened or drew) on a board the
//   owner marked `reach: 'all'` (the "Alcance" toggle of the
//   board) reaches the sessions of the other boards. Without that mark, each board reaches only itself.
// - The Líder único (ADR 0007: the session the Jobu opens, recognized by a mark on its tab — never by the role
//   alone) has no place on any board. It stands above the top of EVERY board (owner: "o do Donel Dev deve ser
//   capaz de fechar sessões em qualquer mindscape"), so it reaches the top places (no hierarchy arrow points to
//   them) and everything below them, on any board, without the "Alcance" mark. The same hierarchy arrows count:
//   an arrow a session draws neither hides a place from it nor puts anyone above it. A former Líder of a board
//   is an ordinary place: its owner's arrows are ordinary hierarchy.
// - Back up to the Líder único (06/11, t-52b31719): a session the Líder único opened, or one below it by the
//   arrows, reaches the Líder único (a message, a task passed to it). Nobody else does: a place out of that chain
//   talks to whoever is above it on its board.
// - The Líder of a board (08/11, Líder único: "o líder do quadro … deve ser a palavra mestre de tudo"): the Líder
//   the owner placed on a board (`isBoardOrchestrator`) reaches EVERY place of its own board, with or without an
//   arrow, whoever opened it (the Líder único included). Nobody else gains reach by it: a common session still only
//   reaches down its arrows, and a Líder a session made is a common session. And every place of a board talks up to
//   that Líder (`sessao_enviar` with "lider-quadro", `boardOrchestrators`), as the chain of the Líder único talks to it.
// - Who takes the work of a place that is gone (06/11, t-e753b554): the first live place above it by the
//   hierarchy arrows, the one that opened it first; none → the Líder único.

import { FAXINEIRO_ROLE_ID, LEADER_ROLE_ID } from '../roles';
import type { BoardReach, MindscapeBoard, MindscapeDoc, MindscapeLink } from './model';

export function boardReach(board: MindscapeBoard | undefined): BoardReach {
  return board?.reach === 'all' ? 'all' : 'own';
}

/** An arrow that puts `from` above `to`: drawn by the owner, or made by `sessao_abrir`. */
function isHierarchyArrow(link: MindscapeLink): boolean {
  return link.arrow && (link.by !== 'session' || link.opened === true);
}

/** A path `from → … → to` on the board made only of links that `follows` accepts. */
function hasPath(board: MindscapeBoard | undefined, from: string, to: string, follows: (link: MindscapeLink) => boolean): boolean {
  if (!board || from === to) return false;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const link of board.links) {
      if (!follows(link) || link.from !== at || seen.has(link.to)) continue;
      if (link.to === to) return true;
      seen.add(link.to);
      queue.push(link.to);
    }
  }
  return false;
}

/** `to` is below `from`: a path of hierarchy arrows `from → … → to` on the board. */
export function isBelow(board: MindscapeBoard | undefined, from: string, to: string): boolean {
  return hasPath(board, from, to, isHierarchyArrow);
}

/** `to` was opened by `from`: a path of `sessao_abrir` arrows `from → … → to` (daughter, granddaughter…). */
export function isOpenedBy(board: MindscapeBoard | undefined, from: string, to: string): boolean {
  return hasPath(board, from, to, (link) => link.opened === true);
}

export interface ReachEnd {
  readonly projectPath: string;
  readonly placeId: string;
}

/** The Líder único as the one who directs: it has no place, so it is not a `ReachEnd`. */
export const LEADER_OF_ALL_FROM = { leaderOfAll: true } as const;
export type ReachFrom = ReachEnd | typeof LEADER_OF_ALL_FROM;

/** A place at the top of its board: a session place no hierarchy arrow points to. The Líder único is right above it. */
export function isTop(board: MindscapeBoard | undefined, placeId: string): boolean {
  if (board?.cards[placeId]?.kind !== 'session') return false;
  return !board.links.some((link) => link.to === placeId && isHierarchyArrow(link) && board.cards[link.from]?.kind === 'session');
}

/**
 * The orchestrator of a board: a place with the Líder role that the OWNER put there. Never one a session opened or drew
 * (`by: 'session'`): a role given by a session would let any Dev make itself a Líder (PR #305). What a session cannot
 * forge is who made the place, so that is the line, here and in `canReach` across boards.
 */
export function isBoardOrchestrator(board: MindscapeBoard | undefined, placeId: string): boolean {
  const card = board?.cards[placeId];
  return card?.kind === 'session' && card.roleId === LEADER_ROLE_ID && card.by !== 'session';
}

/** `sessao_enviar` to the Líder of the caller's board, whoever it is: `"para": "lider-quadro"`. */
export const BOARD_LEADER = 'lider-quadro';

/** The orchestrators of a board (`isBoardOrchestrator`), in card order: whom "lider-quadro" means. */
export function boardOrchestrators(board: MindscapeBoard | undefined): string[] {
  return board ? Object.keys(board.cards).filter((id) => isBoardOrchestrator(board, id)) : [];
}

/** The Líder único reaches `placeId`: a top place, or one below a top place by hierarchy arrows. */
function leaderOfAllReaches(board: MindscapeBoard | undefined, placeId: string): boolean {
  if (!board || board.cards[placeId]?.kind !== 'session') return false;
  if (isTop(board, placeId)) return true;
  return Object.keys(board.cards).some((id) => isTop(board, id) && isBelow(board, id, placeId));
}

export type ReachVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** May the session at `from` direct the one at `to`? The reason is a pt-BR clause for the agent. */
export function canReach(doc: MindscapeDoc, from: ReachFrom, to: ReachEnd): ReachVerdict {
  if ('leaderOfAll' in from) {
    return leaderOfAllReaches(doc.boards[to.projectPath], to.placeId)
      ? { ok: true }
      : { ok: false, reason: `"${to.placeId}" não está no topo do quadro nem abaixo dele pelas setas do dono ou de abertura.` };
  }
  if (from.projectPath === to.projectPath && from.placeId === to.placeId) return { ok: false, reason: 'esta é a sua própria sessão.' };
  const fromBoard = doc.boards[from.projectPath];
  if (from.projectPath === to.projectPath) {
    if (isBoardOrchestrator(fromBoard, from.placeId) && fromBoard?.cards[to.placeId]?.kind === 'session') return { ok: true };
    return isBelow(fromBoard, from.placeId, to.placeId)
      ? { ok: true }
      : { ok: false, reason: `"${to.placeId}" não está abaixo de você: falta seta (direta ou em cadeia) do seu lugar (${from.placeId}) para ela.` };
  }
  const self = fromBoard?.cards[from.placeId];
  if (self?.kind !== 'session' || self.roleId !== LEADER_ROLE_ID) return { ok: false, reason: 'ela está em outro quadro, e só o Líder alcança outros quadros.' };
  if (!isBoardOrchestrator(fromBoard, from.placeId)) return { ok: false, reason: 'ela está em outro quadro, e só o Líder que o dono pôs no quadro alcança outros quadros (você foi aberta por uma sessão).' };
  if (boardReach(fromBoard) !== 'all') return { ok: false, reason: 'ela está em outro quadro, e o alcance do seu quadro é só ele mesmo (o dono muda em "Alcance", no quadro).' };
  return { ok: true };
}

/**
 * May the session at `from` reach the Líder único: it was opened by the Líder único, or is below one that was (by
 * hierarchy arrows). `openedByLeader` says which places of the board the Líder único opened (the board does not
 * keep it: the tabs and the bridge do).
 */
export function canReachLeader(doc: MindscapeDoc, from: ReachEnd, openedByLeader: (placeId: string) => boolean): ReachVerdict {
  const board = doc.boards[from.projectPath];
  if (board?.cards[from.placeId]?.kind !== 'session') return { ok: false, reason: `"${from.placeId}" não é um lugar do quadro.` };
  if (openedByLeader(from.placeId)) return { ok: true };
  const above = Object.keys(board.cards).some((id) => board.cards[id]?.kind === 'session' && openedByLeader(id) && isBelow(board, id, from.placeId));
  return above
    ? { ok: true }
    : { ok: false, reason: 'você não foi aberta pelo Líder único nem está abaixo, pelas setas, de uma sessão que ele abriu. Fale com quem está acima de você no quadro.' };
}

/**
 * The first live place above `placeId` by hierarchy arrows, nearest first and, at the same distance, the one that
 * opened it before an arrow of the owner; `undefined` = nobody live above (the work goes to the Líder único).
 */
export function firstLiveAbove(board: MindscapeBoard | undefined, placeId: string, isLive: (placeId: string) => boolean): string | undefined {
  if (!board) return undefined;
  const seen = new Set([placeId]);
  let level = [placeId];
  while (level.length > 0) {
    const next: string[] = [];
    for (const at of level) {
      const up = board.links
        .filter((link) => link.to === at && isHierarchyArrow(link) && board.cards[link.from]?.kind === 'session' && !seen.has(link.from))
        .sort((a, b) => Number(b.opened === true) - Number(a.opened === true));
      for (const link of up) {
        if (seen.has(link.from)) continue;
        seen.add(link.from);
        next.push(link.from);
      }
    }
    const live = next.find(isLive);
    if (live) return live;
    level = next;
  }
  return undefined;
}

/** The board and place of a place id: the caller's board first, then every other one. */
export function findPlace(doc: MindscapeDoc, placeId: string, preferredPath: string): ReachEnd | undefined {
  const paths = [preferredPath, ...Object.keys(doc.boards).filter((path) => path !== preferredPath)];
  const projectPath = paths.find((path) => doc.boards[path]?.cards[placeId]?.kind === 'session');
  return projectPath ? { projectPath, placeId } : undefined;
}

/** What only the live tab tells (the board does not keep it), for `canFaxineiroClose`. */
export interface CloseFacts {
  /** Working, or not known yet. */
  readonly working: boolean;
  /** A permission on screen, a question, a plan, a usage limit or an error: the owner's. */
  readonly needsOwner: boolean;
  /** Another session (or the app) opened the tab; `false` = the owner opened it by hand. */
  readonly openedBySession: boolean;
}

/**
 * Faxineiro com gatilhos (t-b3b26e60) — the Faxineiro of a board closes the sessions of its own board with no arrow
 * to them ("ele tem permissão para fechar sessões do próprio quadro"), and never: another board, itself, the Líder, a
 * session working, one waiting for the owner, or a tab the owner opened by hand ("nunca fecha sessão trabalhando nem
 * mexe no que é do dono"). Only a place with the Faxineiro role has this reach; the arrows of `canReach` still hold
 * for everyone else.
 */
export function canFaxineiroClose(doc: MindscapeDoc, from: ReachEnd, to: ReachEnd, facts: CloseFacts): ReachVerdict {
  const board = doc.boards[from.projectPath];
  const self = board?.cards[from.placeId];
  if (!board || self?.kind !== 'session' || self.roleId !== FAXINEIRO_ROLE_ID) return { ok: false, reason: 'só o Faxineiro do quadro fecha sem seta.' };
  if (from.projectPath !== to.projectPath) return { ok: false, reason: 'ela está em outro quadro; o Faxineiro só fecha sessões do próprio quadro.' };
  if (from.placeId === to.placeId) return { ok: false, reason: 'esta é a sua própria sessão.' };
  const target = board.cards[to.placeId];
  if (target?.kind !== 'session') return { ok: false, reason: `"${to.placeId}" não é um lugar do quadro.` };
  if (target.roleId === LEADER_ROLE_ID) return { ok: false, reason: 'é o Líder do quadro; o Faxineiro não fecha o Líder.' };
  if (facts.working) return { ok: false, reason: 'ela está trabalhando; o Faxineiro não corta turno.' };
  if (facts.needsOwner) return { ok: false, reason: 'ela espera o dono (permissão, pergunta, plano, limite ou erro).' };
  if (!facts.openedBySession) return { ok: false, reason: 'o dono abriu esta aba à mão; ela é dele.' };
  return { ok: true };
}
