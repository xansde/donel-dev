// Líder único (ADR 0007, owner 04/11: "os líderes de cada mindscape deve ser apenas uma sessão única que se comunica
// com todos os mindscapes. Essa eu acesso pelo jobu."). ONE session of the app, opened by the Jobu: it belongs to no
// board, reads and acts on all of them. Who it reaches is NOT here: it is the one rule of `reach.ts` (`canReach`
// with `LEADER_OF_ALL_FROM`). Here: how its tab is recognized, where it runs, and how it names a board. Pure.

import { LEADER_ROLE_ID } from '../roles';
import type { MindscapeDoc } from './model';

/** The name the Líder único signs with (messages, notices, the ledger) and the key of what it opened. */
export const LEADER_OF_ALL = 'lider';

/** The minimum of a tab the rule needs. */
export interface LeaderTabLike {
  readonly sessionType: 'claude' | 'shell';
  readonly roleId?: string;
  /** Set ONLY by the Jobu's path when it opens the Líder único (App.tsx, `liderDeliverRef`), and kept on an update. */
  readonly leaderOfAll?: boolean;
}

/**
 * The tab is the Líder único: the explicit mark the Jobu puts on it, never the absence of a project. A Líder opened
 * by the Launcher, on the VPS or in a folder out of the sidebar is an ordinary session of its board.
 */
export function isLeaderOfAllTab(tab: LeaderTabLike): boolean {
  return tab.sessionType === 'claude' && tab.leaderOfAll === true && tab.roleId === LEADER_ROLE_ID;
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
