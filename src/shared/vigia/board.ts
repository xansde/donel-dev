// t-5839d76b — where the vigia files a lock's card. A lock is a MACHINE's (down, asking for login, vault, sessions in a
// loop) and a machine has no board; the cards went to the folder of the projects (\`projectRoots[0]\`), which is
// nobody's board, so nobody could see or cancel them. Now: a board that exists, or no card (the PC warns natively).

import type { MindscapeBoard } from '../mindscape/model';
import { boardOrchestrators } from '../mindscape/reach';

/**
 * The board of the vigia's cards: \`configured\` (\`vigia.quadro\`) when it is a board; else the board with a Líder the
 * owner put there and the most places, ties broken by the board's folder so the same lock never lands on two boards
 * from one round to the next; \`null\` when no board qualifies (the card is not made).
 */
export function vigiaBoardOf(boards: Readonly<Record<string, MindscapeBoard>>, configured: string | null): string | null {
  if (configured && boards[configured]) return configured;
  let best: { folder: string; places: number } | null = null;
  for (const folder of Object.keys(boards).sort()) {
    const board = boards[folder]!;
    if (boardOrchestrators(board).length === 0) continue;
    const places = Object.values(board.cards).filter((card) => card.kind === 'session').length;
    if (!best || places > best.places) best = { folder, places };
  }
  return best?.folder ?? null;
}

/** The last segment of a board's folder, how people name it ("Donel Dev"). */
export function boardName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
}
