// Recado vencido (r-3ac3e0e4, 19/11) — one rule for every queue that hands a message to a session or to the Líder
// único (recados.json, the PC's relay fila.json, the other machines' queues and a satellite's avisos-pendentes.json,
// all in the relay's format): an item older than `STALE_MS` and still not delivered is NOT delivered. It turns
// terminal ('vencido', with when), one short log line says it (id, age, for whom), the record stays (it leaves with
// the queue's own retention), and it never goes back to the queue. On 19/11 the app came back after hours off and
// handed the Líder 24 notices of the morning, and a day-old order ("termine o passo atual…") waited for a session that
// could come back and obey it.
//
// Two exceptions, set by the Líder único (r-54647a6a):
// - the owner's own words (a card, his decision, the phone's Pedir, his chat with the Líder) never go stale: they are
//   delivered late, marked "(atrasada: enviada DD/MM HH:MM)";
// - a recado a session sent does not vanish quietly: whoever sent it hears "seu recado para X venceu sem entrega" and
//   decides whether to send it again; a sender no longer open has the Líder único hear it. That notice is the
//   Oráculo's, so it never makes another one (no loop), and its key (`vencido:<item>`) joins a repeat (one per item,
//   across restarts too).
//
// The age is counted in each queue (an item that crosses a hop, satellite → personal VPS → PC, starts again there).

import type { OwnerMessage } from '../main/ledger-card-writer';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';

/** How long an undelivered message stays worth delivering. */
export const STALE_MS = 6 * 60 * 60 * 1000;

/** The key of an expiry notice (`vencido:<the expired item's key or id>`): it never makes another one. */
export const EXPIRY_KEY_PREFIX = 'vencido:';

/** The keys the code gives the owner's words: a comment on a card, his decision, the phone's Pedir and chat. */
const OWNER_KEY = /^(comentario|decisao|pedido|pedido-tarefa|celular-chat):/;
/** The owner's words without a key (a card written on the desktop): how the card writer opens them. */
const OWNER_TEXT = /^(◆\s*)?(Do dono|O dono|Pedido do dono)\b/;
const LATE = '(atrasada: enviada ';

export function isStale(createdAt: number, now: number): boolean {
  return now - createdAt > STALE_MS;
}

/** The owner's own words (never stale): by the key the code gives them, or by how the card writer opens them. */
export function isOwnerMessage(key: string | undefined, text: string): boolean {
  return (key !== undefined && OWNER_KEY.test(key)) || OWNER_TEXT.test(text.trim());
}

const SAO_PAULO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "DD/MM HH:MM", São Paulo time. */
export function sentAt(at: number): string {
  const part = (type: Intl.DateTimeFormatPartTypes): string => SAO_PAULO.formatToParts(at).find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`;
}

/** `text` with "(atrasada: enviada DD/MM HH:MM)" at the end of its first line; once (a text already marked is kept). */
export function markLate(text: string, createdAt: number): string {
  if (text.includes(LATE)) return text;
  const mark = ` ${LATE}${sentAt(createdAt)})`;
  const end = text.indexOf('\n');
  return end < 0 ? `${text}${mark}` : `${text.slice(0, end)}${mark}${text.slice(end)}`;
}

/** Hours, one decimal, for the log line. */
export function ageText(createdAt: number, now: number): string {
  return `${(Math.round((now - createdAt) / 360_000) / 10).toFixed(1)} h`;
}

/**
 * Who sent a message the relay holds: the session's place in a `recado:<place>:<hash>` key, the Líder único for his
 * opening (`abrir:`), '' for a recado of an older key (someone, not known). `undefined` = the Oráculo's own notice
 * (aviso, caixa, reconciliador…): nobody to tell.
 */
export function relaySenderOf(key: string): string | undefined {
  if (key.startsWith('abrir:')) return LEADER_OF_ALL;
  if (!key.startsWith('recado:')) return undefined;
  return /^recado:(.+):[0-9a-f]{32}$/.exec(key)?.[1] ?? '';
}

/** A stretch of the expired words, one line, for the notice. */
function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * The notice to the sender of an expired message, as the relay carries it: `placeId` the sender ('' = the Líder
 * único); its `leaderText` is what the Líder único reads when the sender is no longer open. `null` = nobody sent it
 * (an Oráculo notice) or it is an expiry notice itself.
 */
export function expiryNotice(input: {
  readonly key: string;
  readonly projectPath: string;
  /** The sender's place (`lider` = the Líder único); '' = someone not known (the Líder único hears it); `undefined` = the Oráculo (no notice). */
  readonly from: string | undefined;
  /** The target's name for the sender. */
  readonly to: string;
  readonly createdAt: number;
  readonly text: string;
}): OwnerMessage | null {
  if (input.from === undefined || input.key.startsWith(EXPIRY_KEY_PREFIX)) return null;
  const when = sentAt(input.createdAt);
  const board = input.projectPath ? lastSegment(input.projectPath) : '';
  const what = `«${excerpt(input.text)}»`;
  const from = input.from && input.from !== LEADER_OF_ALL ? input.from : undefined;
  const text = `◆ Oráculo: seu recado para ${input.to} venceu sem entrega (enviado ${when}): ${what}. Não foi entregue; reenvie se ainda valer.`;
  const leaderText = from
    ? `◆ Oráculo${board ? `, quadro ${board}` : ''}: o recado de ${from} para ${input.to} venceu sem entrega (enviado ${when}) e ${from} não está aberta: ${what}. Decida se reenvia.`
    : input.from === LEADER_OF_ALL
      ? text
      : `◆ Oráculo${board ? `, quadro ${board}` : ''}: um recado para ${input.to} venceu sem entrega (enviado ${when}), de quem não sei: ${what}. Decida se reenvia.`;
  return { projectPath: input.projectPath, placeId: from ?? '', text, leaderText, key: `${EXPIRY_KEY_PREFIX}${input.key}` };
}
