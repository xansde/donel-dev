// 014-chat (T067) - optimistic messages of the timeline. A message the chat is sending shows up as a local
// `user` row (`local:<sendId>`) with its live send state; when the real transcript row arrives the local one
// disappears and the real row inherits the state ("hh:mm - entrou", D-C11) - never two bubbles.

import { matchesPrompt, normalizePrompt } from '../../../../shared/chat/promptMatch';
import type { ConversationRow, ShellRow, UserRow } from '../../../../shared/chat/rows';
import { ownerSendState, type SendItemView } from '../sendDriver';

export interface SendOverlay {
  readonly sendState: 'sending' | 'queued' | 'sent' | 'failed' | 'interrupted';
  readonly queuedReason?: string;
  readonly failedReason?: string;
  /** Send to retry ("tentar de novo"); only for `failed`. */
  readonly sendId?: string;
}

export interface MergedRows {
  readonly rows: readonly ConversationRow[];
  readonly overlays: ReadonlyMap<string, SendOverlay>;
}

export const LOCAL_PREFIX = 'local:';

/** What the owner typed, as a real row would carry it (`command` rows keep name and args apart). */
function realText(row: UserRow): string {
  if (row.text !== '') return row.text;
  return row.command ? `/${row.command.name} ${row.command.args}`.trim() : '';
}

/** The command of a `!` message, as the transcript records it in `<bash-input>`. */
const shellCommandOf = (text: string): string => text.replace(/^!\s*/, '').trim();

const SLACK_MS = 2_000;
/** An accepted send whose real row never showed up is dropped after this long (or after the Claude answered). */
export const ACCEPTED_ORPHAN_MS = 60_000;

/**
 * An accepted prompt with no real row (the chain was rewritten, or the row never matched) must not hang at the end
 * of the conversation: it stays where it was sent, and goes away once it is clearly stale - the Claude produced
 * something after it, or `ACCEPTED_ORPHAN_MS` passed. `interrupted` is the exception: it stays until the next
 * message of the owner (the card that explains where the text went).
 */
function orphanIsStale(item: SendItemView, realRows: readonly ConversationRow[], now: number): boolean {
  if (item.returned === true) return false;
  if (now - item.createdAt > ACCEPTED_ORPHAN_MS) return true;
  return realRows.some((row) => row.kind !== 'user' && row.kind !== 'notice' && Date.parse(row.at) > item.createdAt);
}

function overlayOf(item: SendItemView, claimed: boolean): SendOverlay {
  const base = ownerSendState(item);
  // A real row exists, so the message did get in, whatever the machine still thinks.
  const sendState = claimed && base === 'failed' ? 'sent' : base;
  return {
    sendState,
    ...(sendState === 'queued' && item.queuedReason !== undefined ? { queuedReason: item.queuedReason } : {}),
    ...(sendState === 'failed' ? { failedReason: item.reason, sendId: item.id } : {}),
  };
}

export function mergeOptimistic(realRows: readonly ConversationRow[], items: readonly SendItemView[], now: number = Date.now()): MergedRows {
  if (items.length === 0) return { rows: realRows, overlays: new Map() };
  const overlays = new Map<string, SendOverlay>();
  const claimedRows = new Set<string>();
  const local: ConversationRow[] = [];
  const failedLocal: ConversationRow[] = [];

  const users = realRows.filter((r): r is UserRow => r.kind === 'user');
  const shells = realRows.filter((r): r is ShellRow => r.kind === 'shell');
  for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    if (item.kind === 'shell') {
      // a `!` message is drawn by the transcript as a shell row (command + output), not as a user row
      const shell = shells.find(
        (row) =>
          !claimedRows.has(row.id) &&
          Date.parse(row.at) >= item.createdAt - SLACK_MS &&
          normalizePrompt(row.command) === normalizePrompt(shellCommandOf(item.text)),
      );
      if (shell !== undefined) {
        claimedRows.add(shell.id);
        overlays.set(shell.id, overlayOf(item, true));
        continue;
      }
    }
    const match = users.find(
      (row) =>
        !claimedRows.has(row.id) &&
        Date.parse(row.at) >= item.createdAt - SLACK_MS &&
        matchesPrompt(item.text, realText(row)),
    );
    if (match !== undefined) {
      claimedRows.add(match.id);
      overlays.set(match.id, overlayOf(item, true));
      continue;
    }
    // The real row of a command is drawn by the transcript itself (command/output): drop the local copy.
    if (item.state === 'accepted' && item.kind !== 'prompt') continue;
    const orphan = item.state === 'accepted';
    if (orphan && orphanIsStale(item, realRows, now)) continue;
    const id = `${LOCAL_PREFIX}${item.id}`;
    (orphan || overlayOf(item, false).sendState === 'failed' ? failedLocal : local).push({
      kind: 'user',
      id,
      turnId: null,
      at: new Date(item.createdAt).toISOString(),
      scope: 'main',
      // An images-only message has no text to show; the thumbnails live in the composer until the real row arrives.
      text: item.text !== '' || item.images.length === 0 ? item.text : item.images.length === 1 ? 'imagem enviada' : `${item.images.length} imagens enviadas`,
      attachments: [],
    });
    overlays.set(id, overlayOf(item, false));
  }
  // A failed or accepted-without-row card stays where the send happened (chronological order), not stuck below newer messages.
  let rows: ConversationRow[] = [...realRows];
  for (const card of failedLocal) {
    const at = Date.parse(card.at);
    const index = rows.findIndex((row) => Date.parse(row.at) > at);
    rows.splice(index < 0 ? rows.length : index, 0, card);
  }
  rows = [...rows, ...local];
  return { rows: failedLocal.length === 0 && local.length === 0 ? realRows : rows, overlays };
}
