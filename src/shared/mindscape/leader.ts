// Líder único (ADR 0007, owner 04/11: "os líderes de cada mindscape deve ser apenas uma sessão única que se comunica
// com todos os mindscapes. Essa eu acesso pelo jobu."). ONE session of the app, with the role `lider` and no project:
// it belongs to no board, reads and acts on all of them, and the owner talks to it through the Jobu. Pure.
//
// The arrow rule holds: the Líder único sends only to places it is linked to. It has no card on any board, so its
// links are DERIVED from what the owner draws, never stored (nothing invisible to undo):
// - it stands above the top of every board: a place no other place points to with an arrow answers to it;
// - the places that held the role `lider` before (one Líder per board) became ordinary places, and their arrows
//   count as the Líder único's — whom they directed, it directs.
// A session it opens has no arrow pointing to it, so it is born linked. Drawing an arrow from another place to one
// of those puts it under that place, out of the Líder's direct reach — the owner decides by drawing.

import { LEADER_ROLE_ID } from '../roles';
import type { MindscapeBoard, MindscapeDoc, SessionPlaceCard } from './model';

/** The name the Líder único signs with (messages, notices) and the key of what it opened. */
export const LEADER_OF_ALL = 'lider';

/** The minimum of a tab the rule needs. */
export interface LeaderTabLike {
  readonly sessionType: 'claude' | 'shell';
  readonly roleId?: string;
  /** A tab of a project has it; the Líder único runs in no project. */
  readonly projectName?: string;
}

/** The tab is the Líder único: a `claude` session with the role `lider` that belongs to no project. */
export function isLeaderOfAllTab(tab: LeaderTabLike): boolean {
  return tab.sessionType === 'claude' && tab.roleId === LEADER_ROLE_ID && !tab.projectName;
}

/** A place of a board that was its Líder before the Líder único (role `lider`): its arrows are the Líder único's. */
export function isFormerLeaderPlace(card: SessionPlaceCard): boolean {
  return card.roleId === LEADER_ROLE_ID;
}

/** The Líder único is linked to `placeId` on `board` (see the header). */
export function leaderReaches(board: MindscapeBoard | undefined, placeId: string): boolean {
  const target = board?.cards[placeId];
  if (!board || target?.kind !== 'session') return false;
  return !board.links.some((link) => {
    if (!link.arrow || link.to !== placeId) return false;
    const from = board.cards[link.from];
    // A post-it pointing to a place is a note, not a boss; an arrow from a former Líder is the Líder único's own.
    // Any other place pointing to it puts it under that place: the Líder goes through it.
    return from?.kind === 'session' && !isFormerLeaderPlace(from);
  });
}

/**
 * Where the Líder único runs: the folder that holds every board's project (`…\seazone` for `…\seazone\Donel Dev` and
 * `…\seazone\BizOps`), so it reads any of them without leaving its folder. One project → its parent folder; none, or
 * nothing in common but the drive → `undefined` (the home folder).
 */
export function leaderHome(projectPaths: readonly string[]): string | undefined {
  const split = projectPaths.map((path) => path.replace(/[\\/]+$/, '').split(/[\\/]/));
  if (split.length === 0) return undefined;
  const sep = projectPaths[0]!.includes('\\') ? '\\' : '/';
  let common = split[0]!.slice(0, -1); // the parent of the first one
  for (const parts of split.slice(1)) {
    let at = 0;
    while (at < common.length && at < parts.length - 1 && common[at]!.toLowerCase() === parts[at]!.toLowerCase()) at += 1;
    common = common.slice(0, at);
  }
  return common.length >= 3 ? common.join(sep) : undefined;
}

/** Folds case, accents, slashes and spaces, so "homologacao", "Homologação" and its path all match. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .trim();
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export interface KnownBoard {
  readonly projectPath: string;
  readonly name: string;
}

/** The boards the Líder can name: every board of the document plus every project the app knows (it may have no board yet). */
export function knownBoards(doc: MindscapeDoc, projects: readonly { readonly path: string; readonly name: string }[]): KnownBoard[] {
  const byPath = new Map<string, KnownBoard>();
  for (const project of projects) byPath.set(project.path, { projectPath: project.path, name: project.name });
  for (const path of Object.keys(doc.boards)) if (!byPath.has(path)) byPath.set(path, { projectPath: path, name: lastSegment(path) });
  return [...byPath.values()];
}

export type BoardMatch = { readonly ok: true; readonly board: KnownBoard } | { readonly ok: false; readonly reason: string };

/** `quadro` of a tool: the folder of the project, or its name (the sidebar's, or the folder's). */
export function resolveBoard(boards: readonly KnownBoard[], query: string): BoardMatch {
  const wanted = fold(query);
  const names = boards.map((board) => board.name).join(', ') || '(nenhum)';
  if (!wanted) return { ok: false, reason: `Diga o quadro. Quadros: ${names}.` };
  const byPath = boards.filter((board) => fold(board.projectPath) === wanted);
  if (byPath.length === 1) return { ok: true, board: byPath[0]! };
  const byName = boards.filter((board) => fold(board.name) === wanted || fold(lastSegment(board.projectPath)) === wanted);
  if (byName.length === 1) return { ok: true, board: byName[0]! };
  if (byName.length > 1) return { ok: false, reason: `"${query}" é mais de um quadro; use a pasta: ${byName.map((board) => board.projectPath).join(' | ')}.` };
  return { ok: false, reason: `Quadro "${query}" não existe. Quadros: ${names}.` };
}
