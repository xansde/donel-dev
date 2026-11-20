// Canal do Donel fora do PC (t-e195b35c, §2, §5, §6) — the recados of this machine's sessions, with no PC in the way.
// A `sessao_enviar` whose target runs here goes to a queue on disk (`<dir>/recados.json`, temp → rename, an unreadable
// file is set aside, never written over) and is delivered without pasting into a busy session:
//
// - at the end of the target's turn: the user-level Stop hook (scripts/vps/recados-hook.sh) asks `fim-de-turno`, and
//   the answer `{"decision":"block","reason":…}` hands it everything that waits for it, marked delivered at once;
// - to a stopped session (its last Stop found nothing): typed by tmux, ONLY on an empty input field (the port of
//   `campo_livre` of ~/bin/rotinas/despertador_sessoes.py), and confirmed by the next UserPromptSubmit hook (`ocupada`)
//   carrying its label, or by the label in the transcript. Unconfirmed in 20 s it goes back to the queue, what it left in
//   the field is cleared (Ctrl+U, only when the field shows it), and the session is not typed into again for 2 min (a
//   new end of turn delivers it); at most `MAX_TYPINGS` typings per item. Another Enter (a long text can swallow the first) goes
//   only on a field that still shows the item, and a typing tmux refused counts as one (no retry every tick). A session no hook spoke of since the daemon came up
//   (a restart, a session opened before the hook was installed) is stopped when the screen and the transcript say so:
//   the last turn of the transcript ended and has been quiet for 10 s, the field is empty and the CLI does not say
//   "esc to interrupt". The same check revives a session the hooks left "ocupada" for over a minute (a lost Stop).
//
// Nothing vanishes (the queue is on disk before the answer), nothing arrives twice (one state per item; the same
// message inside 2 min joins the first). The notices the PC gave after a `tarefa_*` (delivery for acceptance, travada,
// precisa-do-dono) and the new ones (to the Revisores out of the chain, the verdict to the Dev) go the same way; a
// target out of this machine goes to the PC's relay (`fila.json`).
//
// Caixa pendurada (19/11: the Dalton's queue stood ~20 h behind two notices typed and never sent):
//
// - Our own typing never stays in the field. A typed item whose text still sits in the field 20 s later (Enters given)
//   is cleared (only the field, Ctrl+U, and only when it holds nothing but this typing) and typed again, the same text,
//   up to `MAX_TYPINGS` in all. Before each new typing the transcript decides: a label already there came in and is
//   never typed again. With the typings spent the field is left empty, the item goes back to the queue (the end of the
//   turn delivers it) and the Líder único hears of it once.
// - A field held by text that is not ours (the box watcher, every `WATCH_MS`, over every session of this machine's
//   tmux): the same text unchanged for `STUCK_MS` (5 min) is
//   * sent with one Enter when it has the form of a Donel notice or recado (opens with "◆ ", or "[Donel Dev · " as the
//     app's own messages do, like the first message of a renewed session) and the session is idle
//     (no "esc to interrupt", and its last turn ended and is quiet, its hook said it stopped, or it never had a turn):
//     it was typed by the app or by this entregador and only its Enter was lost, and the queue behind it can then move.
//     Up to `MAX_BOX_ENTERS` Enters, each after a longer wait, one log line each; never the text again;
//   * never cleared nor sent otherwise: it may be the owner typing. The Líder único hears "caixa com texto não enviado
//     há mais de 5 min" (the session, the place, how long and its first 80 characters), once per stuck box (a box that
//     empties or changes is a new one). A "◆" text whose Enter did not take is told the same way.
// - A stuck box that is the Líder único's own is only logged: a warning queued for him would wait in (or be typed into)
//   that same box, fail too and warn again, without end.
//
// Recado vencido (r-3ac3e0e4, vencimento.ts): an item waiting longer than `STALE_MS` is never delivered (not at the end
// of a turn, not typed, not sent back to the relay). Each tick turns it `vencido` (terminal, kept, logged) after telling
// whoever sent it ("seu recado para X venceu sem entrega"), in that session's own queue when it lives here, else the
// other machine's or the relay; a sender no longer open has the Líder único told. The notice carries the key
// `vencido:<item>`, so a restart joins it instead of telling twice, and it never makes a notice of its own. An Oráculo
// notice has nobody to tell: only the log. The owner's words never go stale: they go marked "(atrasada: …)". On disk a
// `vencido` item is written `devolvido` with `vencidoEm` (a daemon of before this rule reads it as terminal too, never
// as 'fila'). The age crosses hops (revisão do #524): an item made from a message with `sentAt` (it came from the relay,
// a satellite's inbox, the registro) counts from it, one that arrives already stale is born `vencido` with no notice,
// and an item that goes back to the relay takes its `criado` along. A repeat of a key that went stale here is not
// delivered (`deliverLocal` answers `null`) and leaves the key stale in the relay too, so the caller's way to the relay
// joins it there instead of starting it again.

import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import { hasArrowLink } from '../shared/mindscape/agent-tools';
import { listedPlaces, resolveAddress } from '../shared/mindscape/address';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import { BOARD_LEADER, canReach, canReachLeader, isBoardOrchestrator, isLiveListedPlace, LEADER_OF_ALL_FROM, MY_OPENER, successorOf, whoHears, type ListedPlace } from '../shared/mindscape/reach';
import { blockingScreen, isWorking } from '../shared/chat/screen';
import type { MindscapeBoard } from '../shared/mindscape/model';
import type { LedgerDeliveredTo, LedgerTask } from '../shared/ledger/contract';
import type { LedgerToolCall } from '../shared/ledger/tools';
import { deliverersOf, reviewersOutsideChain, reviewLink, reviewRequestNotice, verdictNotice, verdictTargets } from '../shared/ledger/revisao';
import { followRenewal, urgentLedgerNotice, type LedgerCaller, type LedgerService } from '../main/ledger-store';
import type { ConfigIoDeps } from '../main/config-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import { picturedBoards, type BoardPicture, type PictureSession } from './portao';
import type { CloseCall, GateHookResponse, GateRecados, ScreenCall, SendCall } from './gate-recados';
import type { LocalLeader } from './lider-local';
import { ageText, expiryNotice, isOwnerMessage, isStale, markLate, relaySenderOf, sentAtOf } from './vencimento';
import { forgetFirstMessage, isSameRequest, readFirstMessages, sweepLongRequests, writeLongRequest, type FirstMessage, type RequestKey } from './primeiras';

/**
 * `devolvido` = its target left this machine before reading it: it went to the PC's relay with the same key (t-c3fbe852).
 * `vencido` = it waited longer than `STALE_MS` and was never delivered (terminal; written `devolvido` + `vencidoEm`).
 */
export type RecadoState = 'fila' | 'digitado' | 'entregue' | 'devolvido' | 'vencido';
export type RecadoVia = 'fim-de-turno' | 'tela' | 'transcript';

export interface RecadoItem {
  readonly id: string;
  /** Same sender, target and words: a repeat inside `JOIN_MS` joins this item. */
  readonly chave: string;
  /** `lugar` empty = the Oráculo itself (a notice). */
  readonly de: { readonly lugar: string; readonly nome: string; readonly sid?: string };
  readonly para: { readonly lugar: string; readonly sid: string };
  /** What the target reads, label first. */
  readonly texto: string;
  readonly criado: number;
  readonly estado: RecadoState;
  readonly via?: RecadoVia;
  readonly entregueEm?: number;
  /** How many times it was typed on the screen. */
  readonly tentativas: number;
  readonly digitadoEm?: number;
  /** Recado vencido: when it went stale undelivered. */
  readonly vencidoEm?: number;
  /**
   * t-c3fbe852 — the same message as the PC's relay takes it (with its key): an item whose target leaves this machine
   * before reading it (the Líder único closed, or went back to the PC) goes there with it, once. Absent = it stays here.
   */
  readonly volta?: OwnerMessage;
  /**
   * t-f66595b2 — an opening request the gate kept (primeiras.ts): its hashes. Before each typing, a session whose first
   * message is that request (the PC pasted it) gets nothing: the item counts as delivered.
   */
  readonly primeira?: RequestKey;
  /**
   * t-49dee38d (T1) — the sid of the successor this item went to after it reached a session renewed with the PC away
   * (renovar-local.ts): it came in after the handoff, so it is not in it. Set once: it is never forwarded again.
   */
  readonly reencaminhado?: string;
}

/** t-49dee38d (T1) — what came into a renewed session after its handoff, to its successor, before the old one is closed. */
export interface ForwardCall {
  /** The old session (folder sid). */
  readonly de: string;
  /** The successor (folder sid), alive in this tmux. */
  readonly para: string;
  /** The board place both hold (`place:` or `session:`). */
  readonly lugar: string;
  /** Since when (ms): the handoff request. What reached the old one from then on is not in its handoff. */
  readonly desde: number;
  /** A user message of the old one holding this text is not forwarded (the handoff request itself). */
  readonly excluir?: string;
}

/** `ok: false` = nothing can be said of what reached the old one: it must not be closed. */
export type ForwardOutcome = { readonly ok: true; readonly reencaminhados: number; readonly passados: number } | { readonly ok: false; readonly motivo: string };

/** The tmux of the sessions (`tmux -L donel`, session `donel-<sid>`); injected in the vitest. */
export interface RecadosTmux {
  /** The pane: in copy mode, and the screen with its colors (`capture-pane -e -p`). `null` = tmux did not answer. */
  screen(sid: string): Promise<{ readonly inMode: boolean; readonly text: string } | null>;
  /** `send-keys -l <text>`, then `Enter` apart. `false` = tmux refused. */
  type(sid: string, text: string): Promise<boolean>;
  /** One `Enter` alone (a long text typed can swallow the first one). */
  enter(sid: string): Promise<boolean>;
  /** `C-u`: clears the input field (a typed text whose Enter never went in). */
  clear(sid: string): Promise<boolean>;
  /** t-d461e003 — `kill-session`: ends the session's tmux (the Líder único's `sessao_fechar` with the PC off). Absent = never. */
  kill?(sid: string): Promise<boolean>;
}

/** The last turn of a transcript: `ended` = its last main entry is the assistant's end of turn; `at` = file mtime. */
export interface TranscriptTurn {
  readonly ended: boolean;
  readonly at: number;
  /** No message in it yet: the conversation never had a turn (a session just opened or renewed). */
  readonly empty?: boolean;
}

export interface GateRecadosDeps {
  /** `<dir>/recados.json`. */
  readonly file: string;
  readonly io: ConfigIoDeps;
  /** The ledger of this daemon; `null` on a satellite (the renewal runs on the ledger's machine). */
  readonly ledger: () => LedgerService | null;
  /** The task a `tarefa_*` left, for the notices after it. Default: this daemon's ledger (the satellite: what the ledger's machine answered with). */
  readonly taskOf?: (id: string) => LedgerTask | undefined;
  /**
   * The review link (item 5) of a `sessao_enviar` with no arrow. Default: this daemon's ledger (the satellite: asked of
   * the ledger's machine; `null` = it did not answer, and the message goes on to the PC, which decides).
   */
  readonly reviewLinked?: (mine: PictureSession, from: string, to: string) => Promise<boolean | null>;
  readonly picture: () => BoardPicture | null;
  /** The sessions alive in this machine's tmux (folder sids). Default: `tmux -L donel ls`. */
  readonly localSessions?: () => Promise<ReadonlySet<string>>;
  readonly tmux?: RecadosTmux;
  /** A notice to a place out of this machine (or to the Líder único): the PC's relay. Absent = only logged. */
  readonly relay?: (message: OwnerMessage) => Promise<unknown>;
  /**
   * t-d461e003 — a message for a place that runs on another machine whose satellite sends its picture here
   * (retrato-satelite.ts): queued for that machine, whose satellite takes it to its own recados. The machine's name, or
   * `null` (no other machine runs it: the PC's relay). Absent = none.
   */
  readonly remote?: (message: OwnerMessage) => Promise<string | null>;
  /** t-c3fbe852 — the Líder único alive in this machine's tmux (`lider-local.ts`); absent = never here. */
  readonly leader?: () => Promise<LocalLeader | null>;
  /** Whether the transcript file has `label` (the confirmation of a typed item). Default: reads its end. */
  readonly transcriptHas?: (path: string, label: string) => Promise<boolean>;
  /** The transcript of a session no hook spoke of yet. Default: `~/.claude/projects/<pasta>/<sid>.jsonl`, the newest. */
  readonly transcriptOf?: (sid: string) => Promise<string | undefined>;
  /** The last turn of a transcript (`null` = unreadable). Default: reads its end. */
  readonly lastTurn?: (path: string) => Promise<TranscriptTurn | null>;
  /**
   * t-f66595b2 — `<oraculo>/primeiras.json` (primeiras.ts): the opening requests this machine's gate saw the PC answer.
   * Each goes into this queue once the session of its place is up here with a still, empty box. Absent = none.
   */
  readonly firstMessages?: string;
  /** The place a session of this machine was opened for (its `meta.json`); needed with `firstMessages`. */
  readonly placeOf?: (sid: string) => string | undefined;
  /** The text of a transcript's first user message (`null` = none, or unreadable). Default: reads its start. */
  readonly firstUserText?: (path: string) => Promise<string | null>;
  /** t-49dee38d (T1) — the end of a transcript (`null` = unreadable). Default: its last 512 KB. */
  readonly readTranscript?: (path: string) => Promise<string | null>;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface GateRecadosHandle extends GateRecados {
  /**
   * t-4c60b815 — the owner's word on a card or his decision (the card writer), when the session that owns the task runs
   * here: queued in `recados.json` (the same key joins, even after delivered) and answered as delivered to it. `null` =
   * it does not run here (or it is the Líder único): the caller sends it to the PC's relay. t-c3fbe852: `placeId` '' (or
   * `lider`) = the Líder único alive here; `localText` = what he reads here when it differs from the relay's words (the
   * relay's go with the item, should it go back there).
   */
  deliverLocal(message: OwnerMessage, localText?: string): Promise<LedgerDeliveredTo>;
  /** t-c3fbe852 — the item a `key` made (its state and its session), while it is kept; `undefined` = none here. */
  stateOf(key: string): { readonly estado: RecadoState; readonly sid: string } | undefined;
  /** The transcript of a session of this machine (what its hooks named, else found by its id). */
  transcriptOf(sid: string): Promise<string | undefined>;
  /**
   * t-49dee38d (T1) — before a session renewed with the PC away is closed: every recado delivered to it since the
   * handoff request (this queue, or a "◆ …" in its conversation) and every message the owner typed in it since then
   * goes to the successor, once, with its original text after a short line saying so; what still waits for it here
   * passes to the successor. Called again it forwards nothing twice. `ok: false` = do not close the old one.
   */
  forwardAfterHandoff(call: ForwardCall): Promise<ForwardOutcome>;
  /** One round of the typing loop (the vitest calls it; `start` runs it every 2 s). */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

const TICK_MS = 2_000;
const CONFIRM_MS = 20_000;
const ENTER_AGAIN_MS = 5_000;
const MAX_ENTERS = 2;
/** Typings of one item on the screen, counting the ones after a field that held it (cleared and typed again). */
const MAX_TYPINGS = 3;
/**
 * One typing's UTF-8 bytes at most: `tmux send-keys -l` refuses a command past ~16.3 KB ("command too long", tmux 3.4),
 * and each refusal spends a typing of every item joined in it. Items past this wait for the next typing.
 */
const MAX_TYPING_BYTES = 15_000;
/** The box watcher looks at every session's field this often (two tmux calls each). */
const WATCH_MS = 30_000;
/** A field with the same text unsent for this long is a stuck box. */
const STUCK_MS = 5 * 60_000;
/**
 * Enters the watcher gives one stuck Donel text, the n-th `WATCH_MS * 2^(n-1)` after the one before (19/11: a CLI that
 * just booted on a loaded place can lose an Enter more than once). Only the Enter: the text is never typed again.
 */
const MAX_BOX_ENTERS = 3;
/**
 * The form of a Donel notice or recado typed into a session (the app's "◆ De …", this queue's "◆ Recado …"), or of a
 * message the app types by itself into a session (19/11: "[Donel Dev · sessão renovada em voo] …", the first message of
 * a renewed session, sat 5 min+ in a loaded place's box with its Enter lost, and the queue behind it with it).
 */
const DONEL_FORM = /^(?:◆\s|\[Donel Dev · )/;
const PREVIEW_CHARS = 80;
/** After an unconfirmed typing, the screen is not trusted for this long (an end of turn still delivers). */
const HOLD_MS = 2 * 60_000;
/** A transcript that moved this recently is a turn that may still be going. */
const QUIET_MS = 10_000;
/** An "ocupada" this old is checked on the screen and the transcript (its Stop may have been lost). */
const STALE_BUSY_MS = 60_000;
const BUSY_ON_SCREEN = /esc to interrupt/i;
const PASTE_PLACEHOLDER = /\[Pasted text #\d+[^\]]*\]/g;
const JOIN_MS = 2 * 60_000;
/** A target missing from tmux this long (not one hiccup of `tmux ls`) has left: what waits for it goes back (t-c3fbe852). */
const GONE_MS = 30_000;
const DAY = 24 * 60 * 60 * 1000;
const DELIVERED_DAYS = 7;
const PENDING_DAYS = 14;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const TMUX_SOCKET = 'donel';
const TMUX_PREFIX = 'donel-';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;

const HOW = 'entra no fim do turno dela, ou na hora se ela estiver parada; a entrega fica registrada';
const ANSWER_LINE = 'Responda a quem mandou pelo sessao_enviar se precisar.';
const RELAY_HOW = 'o PC está fora e esse lugar não roda nesta máquina: o recado espera no Oráculo e o app entrega quando o PC voltar';
const NO_RELAY = 'O PC está fora e esse lugar não roda nesta máquina; o recado não saiu. Tente quando o PC ligar.';
const REMOTE_HOW = 'esse lugar roda em outra máquina: o recado espera na fila dela, o portão de lá o busca em segundos e ele entra no fim do turno da sessão, ou na hora se ela estiver parada';
const NOT_PICTURED = 'Sem retrato do quadro desta sessão (lugar e setas): com o PC fora, o recado não sai daqui. Tente quando o PC ligar.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseItem(value: unknown): RecadoItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.chave !== 'string' || typeof value.texto !== 'string' || typeof value.criado !== 'number') return null;
  const de = value.de;
  const para = value.para;
  if (!isRecord(de) || typeof de.lugar !== 'string' || typeof de.nome !== 'string') return null;
  if (!isRecord(para) || typeof para.lugar !== 'string' || typeof para.sid !== 'string') return null;
  const vencidoEm = typeof value.vencidoEm === 'number' ? value.vencidoEm : undefined;
  const estado: RecadoState =
    value.estado === 'vencido' || (value.estado === 'devolvido' && vencidoEm !== undefined)
      ? 'vencido'
      : value.estado === 'entregue' || value.estado === 'digitado' || value.estado === 'devolvido'
        ? value.estado
        : 'fila';
  const via = value.via === 'fim-de-turno' || value.via === 'tela' || value.via === 'transcript' ? value.via : undefined;
  return {
    id: value.id,
    chave: value.chave,
    de: { lugar: de.lugar, nome: de.nome, ...(typeof de.sid === 'string' ? { sid: de.sid } : {}) },
    para: { lugar: para.lugar, sid: para.sid },
    texto: value.texto,
    criado: value.criado,
    estado,
    ...(via ? { via } : {}),
    ...(typeof value.entregueEm === 'number' ? { entregueEm: value.entregueEm } : {}),
    tentativas: typeof value.tentativas === 'number' ? value.tentativas : 0,
    ...(typeof value.digitadoEm === 'number' ? { digitadoEm: value.digitadoEm } : {}),
    ...(estado === 'vencido' ? { vencidoEm: vencidoEm ?? (typeof value.entregueEm === 'number' ? value.entregueEm : value.criado) } : {}),
    ...(parseMessage(value.volta) ? { volta: parseMessage(value.volta)! } : {}),
    ...(isRecord(value.primeira) && typeof value.primeira.hash === 'string' && typeof value.primeira.hashPlano === 'string'
      ? { primeira: { hash: value.primeira.hash, hashPlano: value.primeira.hashPlano } }
      : {}),
    ...(typeof value.reencaminhado === 'string' && SID_PATTERN.test(value.reencaminhado) ? { reencaminhado: value.reencaminhado } : {}),
  };
}

function parseMessage(value: unknown): OwnerMessage | null {
  if (!isRecord(value)) return null;
  const { projectPath, placeId, text, leaderText, key } = value;
  if (typeof projectPath !== 'string' || typeof placeId !== 'string' || typeof text !== 'string' || typeof leaderText !== 'string' || typeof key !== 'string') return null;
  return { projectPath, placeId, text, leaderText, key };
}

/** The `chave` of an item made with `key` (what makes the message one), the same for every caller. */
function keyedChave(key: string): string {
  return createHash('sha256').update(JSON.stringify(['chave', key])).digest('hex').slice(0, 32);
}

/** The unique words that open an item and confirm it on the screen: "Recado r-…". */
const tagOf = (id: string): string => `Recado ${id}`;

function labelOf(id: string, de: RecadoItem['de']): string {
  return `◆ ${tagOf(id)} ${de.lugar ? `de ${de.nome} (${de.lugar})` : `do ${de.nome}`}:`;
}

/** The words of an item, without its label. */
function wordsOf(item: RecadoItem): string {
  const label = labelOf(item.id, item.de);
  return item.texto.startsWith(label) ? item.texto.slice(label.length).trim() : item.texto;
}

/** The owner's own words (never stale): by the message's key, or, for the Oráculo's items, by how they open. */
function isOwnerItem(item: RecadoItem): boolean {
  return isOwnerMessage(item.volta?.key, item.volta?.text ?? (item.de.lugar ? '' : wordsOf(item)));
}

/** Waiting longer than `STALE_MS` and not the owner's: never delivered. */
function staleRecado(item: RecadoItem, at: number): boolean {
  return item.estado === 'fila' && isStale(item.criado, at) && !isOwnerItem(item);
}

/** A stale owner's item, marked "(atrasada: enviada …)" (its copy for the relay too); once. */
function lateOwnerItem(item: RecadoItem, at: number): RecadoItem {
  if (item.estado !== 'fila' || !isStale(item.criado, at) || !isOwnerItem(item)) return item;
  const texto = markLate(item.texto, item.criado);
  if (texto === item.texto) return item;
  return {
    ...item,
    texto,
    ...(item.volta ? { volta: { ...item.volta, text: markLate(item.volta.text, item.criado), leaderText: markLate(item.volta.leaderText, item.criado) } } : {}),
  };
}

/** On disk a `vencido` item is `devolvido` + `vencidoEm`: a daemon of before the rule reads it as terminal, never 'fila'. */
const toDisk = (item: RecadoItem): RecadoItem => (item.estado === 'vencido' ? { ...item, estado: 'devolvido' } : item);

// ---- the input field on the screen (port of ler_campo/sem_sugestao of despertador_sessoes.py) -------------------

const SGR = /\x1b\[([0-9;]*)m/g;

/** Applies an SGR's parameters to the "dim" state, skipping the arguments of extended colors (38/48/58;5;n and ;2;r;g;b). */
function sgrDim(codes: readonly string[], dim: boolean): boolean {
  const ps = codes.length ? codes : ['0'];
  let i = 0;
  while (i < ps.length) {
    const p = ps[i] || '0';
    if (p === '38' || p === '48' || p === '58') {
      const mode = ps[i + 1] ?? '';
      i += mode === '5' ? 3 : mode === '2' ? 5 : 2;
      continue;
    }
    if (p === '2') dim = true;
    else if (p === '0' || p === '22') dim = false;
    i += 1;
  }
  return dim;
}

/** The screen without the dim text (the CLI's prompt suggestion is not something typed). */
function withoutSuggestion(screen: string): string {
  return screen
    .split('\n')
    .map((line) => {
      let dim = false;
      let out = '';
      let pos = 0;
      for (const match of line.matchAll(SGR)) {
        if (!dim) out += line.slice(pos, match.index);
        dim = sgrDim(match[1] ? match[1].split(';') : [], dim);
        pos = match.index! + match[0].length;
      }
      if (!dim) out += line.slice(pos);
      return out;
    })
    .join('\n');
}

/** What is typed in the Claude Code input field (the "❯" line between the two last "────" rules); `null` = no field. */
function fieldText(screen: string): string | null {
  const lines = withoutSuggestion(screen).replace(/\n+$/, '').split('\n');
  const rules = lines.map((line, index) => (line.trim().startsWith('─'.repeat(10)) ? index : -1)).filter((index) => index >= 0);
  if (rules.length < 2) return null;
  const between = lines.slice(rules[rules.length - 2]! + 1, rules[rules.length - 1]).map((line) => line.replace(/\u00a0/g, ' ').trim());
  if (!between.length || !between[0]!.startsWith('❯')) return null;
  return [between[0]!.slice(1).trim(), ...between.slice(1)].filter((line) => line.length > 0).join(' ');
}

/** The Claude Code input field: free only when empty. */
export function fieldIsFree(screen: string): { readonly free: boolean; readonly reason: string } {
  const text = fieldText(screen);
  if (text === null) return { free: false, reason: 'campo não reconhecido na tela' };
  if (text) return { free: false, reason: 'campo com texto (rascunho de alguém)' };
  return { free: true, reason: '' };
}

/** The field holds only what was typed for `tags` (a long text shows as "[Pasted text #N]"): clearing it erases no one's draft. */
function fieldHoldsOnly(screen: string, tags: readonly string[]): boolean {
  const text = fieldText(screen);
  if (!text) return false;
  return tags.some((tag) => text.includes(tag)) || text.replace(PASTE_PLACEHOLDER, '').trim() === '';
}

/** What tmux types: one line, no control characters (a lone \r would send it in half, a \t completes, ESC starts a sequence). */
export function typeable(text: string): string {
  return text.replace(/\s*[\u0000-\u001f\u007f-\u009f]+\s*/g, ' ').trim();
}

// ---- the real tmux and transcript --------------------------------------------------------------------------------

export interface TmuxRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runTmux(args: readonly string[]): Promise<TmuxRun> {
  return new Promise((resolve) => {
    execFile('tmux', ['-L', TMUX_SOCKET, ...args], { timeout: 3_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '' });
    });
  });
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const systemRecadosTmux: RecadosTmux = {
  async screen(sid) {
    const target = `${TMUX_PREFIX}${sid}`;
    const mode = await runTmux(['display', '-p', '-t', target, '#{pane_in_mode}']);
    if (mode.code) return null;
    const pane = await runTmux(['capture-pane', '-e', '-p', '-t', target]);
    if (pane.code) return null;
    return { inMode: !['', '0'].includes(mode.stdout.trim()), text: pane.stdout };
  },
  async type(sid, text) {
    const target = `${TMUX_PREFIX}${sid}`;
    if ((await runTmux(['send-keys', '-t', target, '-l', text])).code) return false;
    await pause(400);
    return (await runTmux(['send-keys', '-t', target, 'Enter'])).code === 0;
  },
  async enter(sid) {
    return (await runTmux(['send-keys', '-t', `${TMUX_PREFIX}${sid}`, 'Enter'])).code === 0;
  },
  async clear(sid) {
    return (await runTmux(['send-keys', '-t', `${TMUX_PREFIX}${sid}`, 'C-u'])).code === 0;
  },
  async kill(sid) {
    return (await runTmux(['kill-session', '-t', `${TMUX_PREFIX}${sid}`])).code === 0;
  },
};

/** The screen as text: no colors nor other escapes, no trailing blank lines (what `sessao_ver_tela` shows). */
function plainScreen(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b./g, '')
    .replace(/\s+$/, '');
}

/** A turn that did not end (an Esc, a lost Stop) and wrote nothing for this long, with a quiet screen, is not running. */
const IDLE_TURN_MS = 5 * 60_000;

/**
 * How long the screen must stay the same for a session in an open turn to count as still (t-0116dccf): the CLI's
 * spinner shows the elapsed time and changes every second, wherever it sits on the screen.
 */
const STILL_SCREEN_MS = 3_000;

/**
 * t-f66595b2 — a session that never had a turn (no transcript, or one with no message) is typed into only after its
 * empty box has been still this long: a CLI that just came out of the limitador is still loading, and the PC, when it
 * opened the tab a moment ago, may be pasting the first message right now.
 */
const FRESH_SETTLE_MS = 60_000;
/** An opening request kept by the gate goes into the queue only after the box has been still this long. */
const FIRST_SETTLE_MS = 2 * 60_000;
/**
 * ... and only this long after the later of the PC's answer and the box's first sight here (t-f66595b2, round 2): the
 * app types it itself within 240 s of launching the tab, which may be hours after its answer (its own queue of openings)
 * and is never after the box shows up.
 */
const FIRST_PASTE_MS = 5 * 60_000;
/** How often the long requests no longer needed are removed. */
const SWEEP_LONG_MS = 60_000;
/** A request too long for one typing: this much of it is typed, and the whole of it waits in a file. */
const FIRST_TYPED_CHARS = 3_000;

/** How many lines of the screen `sessao_ver_tela` shows (its end: the input box and what came just before it). */
const SCREEN_LINES = 60;

/** What tmux says when its server is not running at all (the socket is gone or refused): truly no session. */
const TMUX_NO_SERVER = /no server running|error connecting to/i;

/**
 * What one `tmux ls -F '#{session_name}'` says of the Donel sessions alive (the names after `donel-`). A `tmux ls` that
 * fails (a timeout, a busy server) is not "every session closed": `null` = it did not say, and the caller keeps the last
 * set it knew (t-c3fbe852) or, on the satellite, sends no picture that round (t-d461e003). Only tmux saying its server
 * is not running is "none". The one rule for every reader of this machine's tmux (recados, retrato-local, satélite).
 */
export function parseTmuxLs(listed: TmuxRun): Set<string> | null {
  if (listed.code !== 0) return TMUX_NO_SERVER.test(listed.stderr) ? new Set() : null;
  return new Set(
    listed.stdout
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name.startsWith(TMUX_PREFIX))
      .map((name) => name.slice(TMUX_PREFIX.length)),
  );
}

/**
 * The sessions alive in this machine's tmux. A `tmux ls` that fails answers the last set it knew, so nothing goes back
 * to the relay on a hiccup (`parseTmuxLs`).
 */
export function createTmuxLocalSessions(run: (args: readonly string[]) => Promise<TmuxRun> = runTmux): () => Promise<ReadonlySet<string>> {
  let last: ReadonlySet<string> = new Set();
  return async () => {
    last = parseTmuxLs(await run(['ls', '-F', '#{session_name}'])) ?? last;
    return new Set(last);
  };
}

/** This machine's tmux sessions (one memory for every caller of the daemon). */
export const tmuxLocalSessions = createTmuxLocalSessions();

/** The label in the last 512 KB of the transcript. */
async function transcriptTailHas(path: string, label: string): Promise<boolean> {
  try {
    const handle = await fsp.open(path, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, 512 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString('utf8').includes(label);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** The newest `<sid>.jsonl` under `~/.claude/projects/*` (the CLI names the transcript after the session id). */
export async function findTranscript(sid: string): Promise<string | undefined> {
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  let best: { path: string; at: number } | undefined;
  try {
    for (const folder of await fsp.readdir(root)) {
      const path = join(root, folder, `${sid}.jsonl`);
      try {
        const { mtimeMs } = await fsp.stat(path);
        if (!best || mtimeMs > best.at) best = { path, at: mtimeMs };
      } catch {
        // not in this folder
      }
    }
  } catch {
    return undefined;
  }
  return best?.path;
}

/** The last user/assistant entry of the main conversation, in the last 400 KB (port of `ultima_entrada` of the despertador). */
export async function transcriptLastTurn(path: string): Promise<TranscriptTurn | null> {
  try {
    const handle = await fsp.open(path, 'r');
    try {
      const { size, mtimeMs } = await handle.stat();
      const length = Math.min(size, 400 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split('\n');
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parseObject(lines[index]!);
        if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isSidechain === true) continue;
        const message = isRecord(entry.message) ? entry.message : {};
        const ended = entry.type === 'assistant' && (message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence');
        return { ended, at: mtimeMs };
      }
      return { ended: false, at: mtimeMs, empty: true };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * t-f66595b2 — the words of the first message someone typed in the main conversation (its first 512 KB): a user entry
 * that is not the CLI's own (`isMeta`), nor a tool's answer. `null` = none yet, or unreadable.
 */
export async function transcriptFirstUserText(path: string): Promise<string | null> {
  try {
    const handle = await fsp.open(path, 'r');
    try {
      const buffer = Buffer.alloc(512 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        const entry = parseObject(line);
        if (entry.type !== 'user' || entry.isSidechain === true || entry.isMeta === true || !isRecord(entry.message)) continue;
        const content = entry.message.content;
        if (typeof content === 'string') return content;
        if (!Array.isArray(content) || content.some((block) => isRecord(block) && block.type === 'tool_result')) continue;
        const text = content.flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n');
        if (text) return text;
      }
      return null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** The last 512 KB of a transcript (`null` = unreadable). */
export async function readTranscriptTail(path: string): Promise<string | null> {
  try {
    const handle = await fsp.open(path, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, 512 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** A message someone put into a session's conversation (the owner typing, the app or this queue), after a moment. */
export interface TypedMessage {
  /** Its entry's uuid, else its time and words (what makes it one). */
  readonly key: string;
  readonly at: number;
  readonly text: string;
  /** The recado ids its label names ("Recado r-…"). */
  readonly ids: readonly string[];
  /** It has the form of a Donel notice or recado ("◆ …", "[Donel Dev · …"); otherwise it is someone typing. */
  readonly donel: boolean;
}

const RECADO_ID = /\bRecado (r-[0-9a-f]{8})\b/g;
const STOP_FEEDBACK = /^Stop hook feedback:\s*/;

/**
 * Pure — t-49dee38d (T1): the user messages of a transcript's main conversation written at or after `since` (ms): the
 * owner's typing, the app's "◆ De …", this queue's "◆ Recado r-…" typed or given at a turn end (the CLI's "Stop hook
 * feedback"). Never a tool's answer, a task notification, a command or other text the CLI adds itself, an interruption,
 * nor one holding `exclude`.
 */
export function typedMessagesSince(tail: string, since: number, exclude?: string): TypedMessage[] {
  const found: TypedMessage[] = [];
  for (const line of tail.split('\n')) {
    const entry = parseObject(line);
    if (entry.type !== 'user' || entry.isSidechain === true || typeof entry.timestamp !== 'string') continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at) || at < since) continue;
    const message = isRecord(entry.message) ? entry.message : {};
    const content = message.content;
    if (Array.isArray(content) && content.some((part) => isRecord(part) && part.type === 'tool_result')) continue;
    const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('\n') : '';
    let text = raw.replace(/<\/?pasted_content[^>]*>/g, '').trim();
    if (entry.isMeta === true) {
      // Of the CLI's own texts only a turn end's feedback: that is how this queue hands a recado at a turn end.
      if (!STOP_FEEDBACK.test(text)) continue;
      text = text.replace(STOP_FEEDBACK, '').trim();
    }
    const origin = isRecord(entry.origin) ? entry.origin.kind : undefined;
    if (!text || (origin !== undefined && origin !== 'human') || /^<(?:task-notification|command-|local-command|system-reminder)/.test(text) || text.startsWith('[Request interrupted')) continue;
    if (exclude && text.includes(exclude)) continue;
    const ids = [...text.matchAll(RECADO_ID)].map((match) => match[1]!);
    const key = typeof entry.uuid === 'string' && entry.uuid ? entry.uuid : createHash('sha256').update(JSON.stringify([entry.timestamp, text])).digest('hex').slice(0, 32);
    found.push({ key, at, text, ids: [...new Set(ids)], donel: ids.length > 0 || DONEL_FORM.test(text) || text.startsWith('◆') });
  }
  return found;
}

// ---- the queue ---------------------------------------------------------------------------------------------------

type SessionMood = 'parada' | 'ocupada' | 'digitando';

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** How a session signs: its role's name, else its tab's name. */
function nameOf(who: Record<string, unknown>): string {
  for (const key of ['papelNome', 'nome', 'papel'] as const) if (typeof who[key] === 'string' && who[key]) return who[key] as string;
  return 'sessão';
}

/** The calls that work a task (taking it on, reporting on it, delivering it): only these make it follow a renewal. */
const RENEWAL_TOOLS: ReadonlySet<LedgerToolCall['tool']> = new Set(['tarefa_assumir', 'tarefa_andamento', 'tarefa_entregar']);

/** The task a call works on; `undefined` for a read (tarefa_ver), a list or anything else (it takes nothing). */
function workedTaskIds(call: LedgerToolCall): string[] | undefined {
  if (!RENEWAL_TOOLS.has(call.tool)) return undefined;
  return 'id' in call && typeof call.id === 'string' && call.id ? [call.id] : undefined;
}

/**
 * Item 13 — before a `tarefa_*` of `caller` (its picture `mine`): the task the call works on, when it was a closed
 * place's whose successor is the caller, follows it. Passo 9: the registro runs it too, for a gate whose recados are on
 * another process (the entregador apart, a satellite), so the renewal is always beside the ledger.
 */
export async function renewBeforeTask(service: LedgerService, caller: LedgerCaller, mine: PictureSession, call: LedgerToolCall, log: (line: string) => void): Promise<void> {
  const places = listedPlaces(mine.listar);
  const closed = places.filter((place) => place.estado === 'fechada' && successorOf(mine.board, places, place.id) === caller.placeId);
  if (!closed.length) return;
  // Only the task the call works on follows (§6): a read (tarefa_ver), listar, criar or novidades takes nothing, so
  // a sibling of the same role that only looks at it never takes it.
  const ids = workedTaskIds(call);
  if (!ids?.length) return;
  for (const place of closed) {
    const passed = await followRenewal(service, { projectPath: caller.projectPath, placeId: place.id, to: caller.placeId, ids });
    if (passed.length) log(`renovação: ${passed.join(', ')} de ${place.id} para ${caller.placeId}`);
  }
}

export function createGateRecados(deps: GateRecadosDeps): GateRecadosHandle {
  const { file, io } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] recados: ${line}`));
  const tmux = deps.tmux ?? systemRecadosTmux;
  const localSessions = deps.localSessions ?? tmuxLocalSessions;
  const transcriptHas = deps.transcriptHas ?? transcriptTailHas;
  const transcriptOf = deps.transcriptOf ?? findTranscript;
  const lastTurn = deps.lastTurn ?? transcriptLastTurn;
  const firstUserText = deps.firstUserText ?? transcriptFirstUserText;
  const readTranscript = deps.readTranscript ?? readTranscriptTail;
  /** What the hooks told of each session (memory only: a session they never spoke of is read on its screen and transcript). */
  const moods = new Map<string, { readonly mood: SessionMood; readonly at: number }>();
  const moodOf = (sid: string): SessionMood | undefined => moods.get(sid)?.mood;
  /** Sessions not typed into until then (an unconfirmed typing), unless a hook says the turn ended. */
  const holds = new Map<string, number>();
  const setMood = (sid: string, mood: SessionMood): void => {
    moods.set(sid, { mood, at: now() });
    holds.delete(sid);
  };
  const transcripts = new Map<string, string>();
  const enters = new Map<string, number>();

  async function transcriptPath(sid: string): Promise<string | undefined> {
    const known = transcripts.get(sid);
    if (known) return known;
    const found = await transcriptOf(sid);
    if (found) transcripts.set(sid, found);
    return found;
  }

  /** Each session's last screen read (plain text) and since when it reads the same (memory only). */
  const lastScreens = new Map<string, { readonly text: string; readonly since: number }>();
  /** t-f66595b2 — a session with a kept opening request: when its box was first seen here, and whether a turn ran on it. */
  const boxSince = new Map<string, number>();
  const turnSeen = new Set<string>();
  let lastLongSweep = Number.NEGATIVE_INFINITY;
  /**
   * Notes a read of `sid`'s screen and says whether it is quiet: no turn on it (`isWorking`), and the same text as a
   * read at least `STILL_SCREEN_MS` before (a long turn's spinner, even far from the box, counts the seconds). Without
   * an earlier read it is not quiet this time.
   */
  function screenIsQuiet(sid: string, screenText: string): boolean {
    const text = plainScreen(screenText);
    const known = lastScreens.get(sid);
    if (!known || known.text !== text) {
      lastScreens.set(sid, { text, since: now() });
      return false;
    }
    return now() - known.since >= STILL_SCREEN_MS && !isWorking(text.split('\n'));
  }

  /**
   * A session no hook spoke of (or whose "ocupada" went stale): stopped when its transcript's last turn ended and is
   * quiet. A turn that never ended (a resume whose last entry is a user one nobody answered, or a session with no turn
   * at all) and wrote nothing for IDLE_TURN_MS counts too, but only on a `quietScreen` (t-0116dccf): a long tool run
   * writes nothing to the transcript either, and only its moving screen tells them apart.
   */
  async function transcriptSaysStopped(sid: string, quietScreen: boolean): Promise<boolean> {
    const path = await transcriptPath(sid);
    const turn = path ? await lastTurn(path) : null;
    return turn !== null && now() - turn.at >= QUIET_MS && (turn.ended || (quietScreen && now() - turn.at >= IDLE_TURN_MS));
  }
  /** A typed item's label in its session's transcript (the known one, else found by the sid): it came in. */
  async function typedInTranscript(sid: string, id: string): Promise<boolean> {
    const path = await transcriptPath(sid);
    return path ? transcriptHas(path, tagOf(id)) : false;
  }
  /** A session that never had a turn (no transcript yet, or one without a message): nothing of it is running. */
  async function transcriptSaysFresh(sid: string): Promise<boolean> {
    const path = await transcriptPath(sid);
    if (!path) return true;
    // A transcript that could not be read says nothing: only one read with no message in it is a fresh session.
    return (await lastTurn(path))?.empty === true;
  }
  /** Its conversation has a message (read, not guessed): it started. */
  async function transcriptSaysStarted(sid: string): Promise<boolean> {
    const path = await transcriptPath(sid);
    const turn = path ? await lastTurn(path) : null;
    return turn !== null && turn.empty !== true;
  }
  /** t-f66595b2 (condição do Líder) — the session's first message is this request: the PC pasted it. */
  async function pastedAlready(sid: string, kept: RequestKey): Promise<boolean> {
    const path = await transcriptPath(sid);
    const first = path ? await firstUserText(path) : null;
    return first !== null && isSameRequest(kept, first);
  }
  /**
   * t-f66595b2 — a session that never had a turn, up and waiting on an empty box: the field free, nothing running nor a
   * dialog on the screen, and the same screen for `ms` (call `screenIsQuiet` on this read first). A session still in
   * the limitador shows no field at all.
   */
  async function freshAndSettled(sid: string, screenText: string, ms: number): Promise<boolean> {
    const lines = plainScreen(screenText).split('\n');
    const known = lastScreens.get(sid);
    if (!known || known.text !== plainScreen(screenText) || now() - known.since < ms) return false;
    if (BUSY_ON_SCREEN.test(screenText) || isWorking(lines) || blockingScreen(lines) || !fieldIsFree(screenText).free) return false;
    return moodOf(sid) !== 'ocupada' && moodOf(sid) !== 'digitando' && transcriptSaysFresh(sid);
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function read(): RecadoItem[] {
    const text = io.readFileText(file);
    if (text === null) {
      if (io.existsSync(file)) throw new Error('recados.json existe mas não pôde ser lida');
      return [];
    }
    try {
      const raw = JSON.parse(text) as { items?: unknown };
      if (!Array.isArray(raw.items)) throw new Error('sem itens');
      return raw.items.map(parseItem).filter((item): item is RecadoItem => item !== null);
    } catch {
      // Kept aside for a human, so the next write does not erase what was waiting in it.
      io.renameFile(file, file.replace(/\.json$/, `.ilegivel-${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`));
      log('recados.json ilegível: guardada à parte.');
      return [];
    }
  }

  function write(items: readonly RecadoItem[]): void {
    const at = now();
    const kept = items.filter((item) => {
      const closed = item.entregueEm ?? item.vencidoEm;
      return closed !== undefined ? at - closed < DELIVERED_DAYS * DAY : at - item.criado < PENDING_DAYS * DAY;
    });
    for (const item of items) if ((item.estado === 'fila' || item.estado === 'digitado') && !kept.includes(item)) log(`recado ${item.id} para ${item.para.lugar} (${item.para.sid}) nunca entregue em ${PENDING_DAYS} dias: sai da fila.`);
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
      if (!io.existsSync(dirname(file))) io.mkdirSync(dirname(file));
      io.writeFileText(tmp, JSON.stringify({ items: kept.map(toDisk) }, null, 2));
      io.renameFile(tmp, file);
    } catch (error) {
      io.unlinkFile(tmp);
      throw error;
    }
  }

  /** Changes the items `pick` chooses, on a fresh read (sync: nothing interleaves between the read and the write). */
  function update(pick: (item: RecadoItem) => boolean, change: (item: RecadoItem) => RecadoItem): RecadoItem[] {
    const items = read();
    const changed: RecadoItem[] = [];
    const next = items.map((item) => {
      if (!pick(item)) return item;
      const updated = change(item);
      changed.push(updated);
      return updated;
    });
    if (changed.length) write(next);
    return changed;
  }

  /**
   * Queues `words` for `para` (or joins the same message of the last 2 min). With `key` (what makes the message one: a
   * decision event, the phone's request id) the same key joins for as long as the item is kept, delivered or not.
   */
  function enqueue(de: RecadoItem['de'], para: RecadoItem['para'], words: string, key?: string, volta?: OwnerMessage): RecadoItem {
    const at = now();
    const chave = key ? keyedChave(key) : createHash('sha256').update(JSON.stringify([de.lugar, para.lugar, words])).digest('hex').slice(0, 32);
    const items = read();
    const same = items.find((item) => item.chave === chave && (key !== undefined || (item.para.sid === para.sid && at - item.criado < JOIN_MS)));
    if (same) return same;
    const id = `r-${randomBytes(4).toString('hex')}`;
    // Counted from when it was first queued (a message that crossed a hop says it), not from its arrival here.
    const criado = volta ? sentAtOf(volta, at) : at;
    const fresh: RecadoItem = { id, chave, de, para, texto: `${labelOf(id, de)} ${words}`, criado, estado: 'fila', tentativas: 0, ...(volta?.key ? { volta } : {}) };
    // Already stale on arrival (it aged in the queue before this one, which tells its sender): kept, never delivered.
    const item: RecadoItem = staleRecado(fresh, at) ? { ...fresh, estado: 'vencido', vencidoEm: at } : fresh;
    if (item.estado === 'vencido') log(`recado ${id} para ${para.lugar} (${para.sid}) chegou vencido (${ageText(criado, at)}): não é entregue.`);
    write([...items, item]);
    return item;
  }

  /**
   * t-f66595b2 — the opening request of `placeId` as the first item of `sid` (ahead of anything else waiting for it):
   * its key (`primeira:<place>`) makes it one for as long as it is kept, whatever repeats. A request past one typing's
   * ceiling is typed in part, and the whole of it waits in a file next to this queue that the session is told to read.
   */
  function enqueueFirst(sid: string, entry: FirstMessage): RecadoItem {
    const { placeId, pedido } = entry;
    const at = now();
    const chave = keyedChave(`primeira:${placeId}`);
    const items = read();
    const same = items.find((item) => item.chave === chave);
    if (same) return same;
    const id = `r-${randomBytes(4).toString('hex')}`;
    const de = { lugar: '', nome: 'Oráculo' };
    let words = `pedido de abertura desta sessão (ela esperou vaga para subir): ${pedido}`;
    if (Buffer.byteLength(typeable(`${labelOf(id, de)} ${words}`)) > MAX_TYPING_BYTES) {
      const whole = writeLongRequest(dirname(file), sid, pedido);
      words = `pedido de abertura desta sessão (ela esperou vaga para subir), longo demais para digitar: o texto inteiro, com as quebras de linha, está em ${whole} . Leia o arquivo todo antes de começar. O começo: ${pedido.slice(0, FIRST_TYPED_CHARS)} …`;
    }
    const item: RecadoItem = {
      id,
      chave,
      de,
      para: { lugar: placeId, sid },
      texto: `${labelOf(id, de)} ${words}`,
      criado: at,
      estado: 'fila',
      tentativas: 0,
      primeira: { hash: entry.hash, hashPlano: entry.hashPlano },
    };
    write([item, ...items]);
    return item;
  }

  /** t-f66595b2 — the gate keeps an opening request for the place of `sid` (primeiras.json) not yet queued nor dropped. */
  function openingKept(sid: string): boolean {
    const placeId = deps.placeOf?.(sid);
    return Boolean(deps.firstMessages && placeId && readFirstMessages(deps.firstMessages).some((entry) => entry.placeId === placeId));
  }

  /**
   * t-f66595b2 — the opening requests the gate kept (primeiras.json): one whose session is up on this machine, never
   * had a turn, and sits on a still, empty box goes into the queue (the step below types it); one whose session already
   * started (the PC typed it in time) is dropped. Only the place and the session are logged, never the request.
   */
  async function firstMessagesIn(): Promise<void> {
    const firstFile = deps.firstMessages;
    if (!firstFile || !deps.placeOf) return;
    const at = now();
    if (at - lastLongSweep >= SWEEP_LONG_MS) {
      lastLongSweep = at;
      // The whole of a long request goes once its item is delivered, stale or gone (or after a day).
      const pending = read().filter((item) => item.estado === 'fila' || item.estado === 'digitado');
      sweepLongRequests(dirname(file), (sid) => !pending.some((item) => item.para.sid === sid && item.texto.includes(`${sid}.md`)), at);
    }
    const waiting = readFirstMessages(firstFile);
    if (!waiting.length) return;
    for (const sid of await localSessions()) {
      if (!SID_PATTERN.test(sid)) continue;
      const placeId = deps.placeOf(sid);
      const entry = placeId ? waiting.find((candidate) => candidate.placeId === placeId) : undefined;
      if (!entry) continue;
      if (await transcriptSaysStarted(sid)) {
        const path = await transcriptPath(sid);
        const first = path ? await firstUserText(path) : null;
        if (first === null) {
          forgetFirstMessage(firstFile, entry.placeId, at);
          log(`pedido de abertura de ${entry.placeId}: a sessão ${sid} já começou a conversa e não li a 1ª mensagem dela; não digito às cegas (o PC pode ter colado).`);
        } else if (isSameRequest(entry, first)) {
          forgetFirstMessage(firstFile, entry.placeId, at);
          log(`pedido de abertura de ${entry.placeId}: a sessão ${sid} já começou a conversa com ele (o PC colou); nada a digitar.`);
        } else {
          // Started by another text (a recado, the owner typing): the request never went in. It joins the queue once.
          const item = enqueueFirst(sid, entry);
          forgetFirstMessage(firstFile, entry.placeId, at);
          log(`pedido de abertura de ${entry.placeId}: a sessão ${sid} começou a conversa por outro texto; o pedido não tinha entrado: vai para a fila (${item.id}).`);
        }
        continue;
      }
      const screen = await tmux.screen(sid);
      if (!screen || screen.inMode) continue;
      screenIsQuiet(sid, screen.text);
      // The box's first sight: the session is up (a CLI still in the limitador shows none). The app types the request
      // within 240 s of launching the tab, never after its box showed up: counted from here, not from the PC's answer.
      if (!boxSince.has(sid) && fieldIsFree(screen.text).free) boxSince.set(sid, at);
      const up = boxSince.get(sid);
      if (up === undefined) continue;
      if (BUSY_ON_SCREEN.test(screen.text) || isWorking(plainScreen(screen.text).split('\n'))) turnSeen.add(sid);
      // A turn ran on it and no transcript says what it was (none found): the PC may have pasted it. Never typed blind.
      if (turnSeen.has(sid) && !(await transcriptPath(sid))) {
        forgetFirstMessage(firstFile, entry.placeId, at);
        log(`pedido de abertura de ${entry.placeId}: a sessão ${sid} já teve um turno na tela e não achei a conversa dela; não digito (o PC pode ter colado).`);
        continue;
      }
      if (at - Math.max(entry.em, up) < FIRST_PASTE_MS) continue;
      if (!(await freshAndSettled(sid, screen.text, FIRST_SETTLE_MS))) continue;
      const item = enqueueFirst(sid, entry);
      forgetFirstMessage(firstFile, entry.placeId, at);
      log(`pedido de abertura de ${entry.placeId} na fila da sessão ${sid} (${item.id}): ela subiu com a caixa vazia, ${ageText(entry.em, at)} depois de aberta.`);
    }
  }

  /**
   * An item a message joined that will not be delivered here: gone back to the relay, or stale. A stale one with a key
   * leaves that key stale in the relay (its `criado` as `sentAt`: it arrives stale there, with no notice), so the
   * caller's way to the relay after this `null` joins it instead of starting it again.
   */
  async function notHere(item: RecadoItem): Promise<boolean> {
    if (item.estado === 'devolvido') return true;
    if (item.estado !== 'vencido') return false;
    if (item.volta?.key && deps.relay) await deps.relay({ ...item.volta, sentAt: item.criado }).catch((error: unknown) => log(`recado ${item.id} vencido não ficou marcado no relay: ${error instanceof Error ? error.message : String(error)}`));
    return true;
  }

  /**
   * t-c3fbe852 — `message` for the Líder único alive here: queued for its tmux with the message's key (and kept to go
   * back to the relay if it leaves). `null` = no Líder here, or this key already went back to the relay (it stays there).
   */
  async function toLocalLeader(de: RecadoItem['de'], words: string, message: OwnerMessage): Promise<RecadoItem | null> {
    const leader = await deps.leader?.();
    if (!leader || !message.key) return null;
    const item = enqueue(de, { lugar: LEADER_OF_ALL, sid: leader.sid }, words, message.key, message);
    return (await notHere(item)) ? null : item;
  }

  /** The folder sids of the live sessions of `placeId` on the board of `projectPath`, on this machine. */
  function sidsOfPlace(projectPath: string, placeId: string, live: ReadonlySet<string>): string[] {
    const sessions = Object.entries(deps.picture()?.sessoes ?? {});
    return sessions.filter(([sid, session]) => live.has(sid) && session.quemSou.lugar === placeId && session.quemSou.pasta === projectPath).map(([sid]) => sid);
  }

  /** The folder sid of the live session of `placeId` on the board of `projectPath`, on this machine. */
  function sidOfPlace(projectPath: string, placeId: string, live: ReadonlySet<string>): string | undefined {
    return sidsOfPlace(projectPath, placeId, live)[0];
  }

  function ledgerDoc() {
    try {
      return deps.ledger()?.load().doc ?? null;
    } catch {
      return null;
    }
  }

  /** May `from` send to `to` on the board alone: an arrow of its own, or the Líder of the board's reach. */
  function drawnLink(projectPath: string, board: MindscapeBoard, from: string, to: string): boolean {
    if (hasArrowLink(board, from, to)) return true;
    return isBoardOrchestrator(board, from) && canReach({ schemaVersion: 8, boards: { [projectPath]: board } }, { projectPath, placeId: from }, { projectPath, placeId: to }).ok;
  }

  /** The review link (item 5): a delivery waiting for a verdict between the two. `null` = unknown here. */
  async function reviewLinked(mine: PictureSession, places: readonly ListedPlace[], from: string, to: string): Promise<boolean | null> {
    if (deps.reviewLinked) return deps.reviewLinked(mine, from, to);
    const doc = ledgerDoc();
    return doc !== null && reviewLink(doc, mine.board, places, from, to);
  }

  function taskOf(id: string): LedgerTask | undefined {
    return deps.taskOf ? deps.taskOf(id) : ledgerDoc()?.tasks[id];
  }

  function hookSid(headers: Readonly<Record<string, string>>, payload: Record<string, unknown>): string | undefined {
    const tmuxName = headers['x-donel-tmux']?.trim();
    const fromTmux = tmuxName?.startsWith(TMUX_PREFIX) ? tmuxName.slice(TMUX_PREFIX.length) : undefined;
    const sid = fromTmux || (typeof payload.session_id === 'string' ? payload.session_id : undefined);
    return sid && SID_PATTERN.test(sid) ? sid : undefined;
  }

  const answerHook = (value: unknown): GateHookResponse => ({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(value) });

  /** A notice of the Oráculo to `placeId`: queued here when it runs here, else the PC's relay. */
  async function notify(projectPath: string, placeId: string, words: string, key: string, live: ReadonlySet<string>): Promise<void> {
    const board = lastSegment(projectPath);
    const sid = placeId === LEADER_OF_ALL ? undefined : sidOfPlace(projectPath, placeId, live);
    if (sid) {
      enqueue({ lugar: '', nome: 'Oráculo' }, { lugar: placeId, sid }, words);
      return;
    }
    const message: OwnerMessage = {
      projectPath,
      placeId: placeId === LEADER_OF_ALL ? '' : placeId,
      text: `◆ Oráculo: ${words}`,
      leaderText: `◆ Oráculo, quadro ${board}${placeId === LEADER_OF_ALL ? '' : ` (para ${placeId}, que não está aberta)`}: ${words}`,
      key,
    };
    // t-c3fbe852 — the Líder único alive here hears it from its own queue, with the PC off too.
    if (placeId === LEADER_OF_ALL && (await toLocalLeader({ lugar: '', nome: 'Oráculo' }, `quadro ${board}: ${words}`, message))) return;
    // t-d461e003 — a place of another machine whose satellite sends its picture: that machine's queue.
    if (placeId !== LEADER_OF_ALL && (await toRemote(message))) return;
    if (!deps.relay) {
      log(`aviso para ${placeId} (${board}) fora desta máquina e sem relay: ${words.slice(0, 80)}`);
      return;
    }
    await deps.relay(message);
  }

  async function taskNotices(mine: PictureSession, caller: LedgerCaller, call: LedgerToolCall, answerText: string): Promise<void> {
    const answer = parseObject(answerText);
    const taskId = typeof answer.id === 'string' ? answer.id : undefined;
    if (!taskId) return;
    const board = mine.board;
    const places = listedPlaces(mine.listar);
    const isLive = (id: string): boolean => isLiveListedPlace(places.find((place) => place.id === id));
    const task = taskOf(taskId);
    const signature = `${nameOf(mine.quemSou)} (${caller.placeId})`;
    const notes = new Map<string, string>();
    // As on the PC: the Líder único's own "travada" or delivery is no urgent notice (it would come back to him).
    const urgent = caller.placeId === LEADER_OF_ALL ? null : urgentLedgerNotice(call, answerText);
    if (urgent) notes.set(whoHears(board, caller.placeId, isLive), `${signature} ${urgent}`);
    // The Revisores out of the chain hear a delivery for acceptance (their words replace the generic one).
    if (call.tool === 'tarefa_entregar' && answer.entregue === true && task?.state === 'entregue' && board)
      for (const reviewer of reviewersOutsideChain(board, isLive, deliverersOf(task))) notes.set(reviewer, reviewRequestNotice(signature, task));
    const accepted = call.tool === 'tarefa_aceitar' && answer.aceita === true;
    if (task && (accepted || (call.tool === 'tarefa_rejeitar' && answer.rejeitada === true)))
      for (const target of verdictTargets(task, caller.placeId)) notes.set(target, verdictNotice(signature, accepted, task, call.tool === 'tarefa_rejeitar' ? call.motivo : undefined));
    if (!notes.size) return;
    const live = await localSessions();
    const eventAt = task?.events.at(-1)?.at ?? now();
    for (const [placeId, words] of notes) {
      try {
        await notify(caller.projectPath, placeId, words, `aviso:${call.tool}:${taskId}:${placeId}:${eventAt}`, live);
      } catch (error) {
        log(`aviso para ${placeId} falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * A message for a place off this machine (or the Líder único) with the PC off: the PC's relay, which today's app
   * delivers when it comes back. The same message inside `JOIN_MS` has the same key: the relay joins it.
   */
  function relayMessage(projectPath: string, me: string, name: string, placeId: string, words: string, remote = false): OwnerMessage {
    const board = lastSegment(projectPath);
    const toLeader = placeId === LEADER_OF_ALL;
    const chave = createHash('sha256').update(JSON.stringify([projectPath, me, placeId, words, Math.floor(now() / JOIN_MS)])).digest('hex').slice(0, 32);
    const signature = `${name} (${me})`;
    return {
      projectPath,
      placeId: toLeader ? '' : placeId,
      text: remote ? `◆ Recado de ${signature}: ${words}` : `◆ Recado de ${signature}, guardado com o PC fora: ${words}`,
      leaderText: `◆ Recado, quadro ${board}${toLeader ? '' : ` (para ${placeId}, que não está aberta)`}, de ${signature}: ${words}`,
      // The sender's place in the key: a recado that goes stale in the relay tells it (vencimento.ts).
      key: `recado:${me}:${chave}`,
    };
  }

  /** `message` to another machine's queue; its name, or `null` (none runs it, or the queue failed: logged). */
  async function toRemote(message: OwnerMessage): Promise<string | null> {
    if (!deps.remote || !message.placeId) return null;
    try {
      return await deps.remote(message);
    } catch (error) {
      log(`recado para ${message.placeId} não entrou na fila da outra máquina: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function relayed(projectPath: string, me: string, name: string, placeId: string, words: string): Promise<BrowserToolOutcome> {
    const toLeader = placeId === LEADER_OF_ALL;
    // t-d461e003 — a place of another machine whose satellite sends its picture (the Dalton, on the Homologações).
    const machine = toLeader ? null : await toRemote(relayMessage(projectPath, me, name, placeId, words, true));
    if (machine) return { kind: 'text', text: JSON.stringify({ entregue: 'na-fila', para: placeId, maquina: machine, como: REMOTE_HOW }) };
    if (!deps.relay) return { kind: 'error', text: NO_RELAY };
    try {
      await deps.relay(relayMessage(projectPath, me, name, placeId, words));
    } catch (error) {
      log(`recado de ${me} para ${placeId} não entrou no relay: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: 'error', text: NO_RELAY };
    }
    return { kind: 'text', text: JSON.stringify({ entregue: 'pelo-relay', para: toLeader ? 'lider' : placeId, como: RELAY_HOW }) };
  }

  /**
   * O Oráculo sem o PC (19/11) — a `sessao_enviar` of the Líder único (he has no place): to a place of the board he
   * names, on the boards the picture has, by the PC's rule (the top of the board and whoever is below it by the owner's
   * or the opening arrows). Queued here when the place runs here, else the PC's relay. Only with the PC off or for a
   * Líder the PC does not know: with the PC on, the PC sends his messages. Without "quadro", a place id names its board
   * (the ids are unique): the messages the carteiro kept on 19/11 name only the place.
   */
  /**
   * The place the Líder único names (`para`, on the board `quadro` or, without it, the board that has that place) and
   * reaches by the PC's rule, on the boards the picture has; a string = why not.
   */
  function leaderTarget(para: string, quadro: string | undefined): { readonly projectPath: string; readonly placeId: string; readonly listar: readonly unknown[]; readonly renovadoDe?: string } | string {
    const boards = picturedBoards(deps.picture());
    const names = [...boards.keys()].map(lastSegment).join(', ') || 'nenhum';
    const id = para.trim();
    const found = quadro
      ? [...boards].find(([pasta]) => pasta === quadro || lastSegment(pasta) === quadro)
      : [...boards].find(([, { listar, board }]) => board?.cards[id]?.kind === 'session' || listedPlaces(listar).some((place) => place.id === id));
    if (!quadro && !found) return `Você é o Líder único: "${id}" não é lugar de nenhum quadro que conheço com o PC fora (${names}); diga o quadro em "quadro".`;
    if (!found) return `Com o PC fora, conheço só os quadros do último retrato (${names}); "${quadro}" não está entre eles.`;
    const [projectPath, { listar, board }] = found;
    const target = resolveAddress(board, listedPlaces(listar), LEADER_OF_ALL, para);
    if ('erro' in target) return target.erro;
    if ('liderUnico' in target) return 'Não mandei: "lider" é você mesmo.';
    const reach = board ? canReach({ schemaVersion: 8, boards: { [projectPath]: board } }, LEADER_OF_ALL_FROM, { projectPath, placeId: target.placeId }) : { ok: false as const, reason: 'o retrato não tem as setas deste quadro.' };
    if (!reach.ok) return `Sem ligação: o Líder único não alcança "${target.placeId}" no quadro ${lastSegment(projectPath)}: ${reach.reason}`;
    return { projectPath, placeId: target.placeId, listar, ...('renovadoDe' in target && target.renovadoDe ? { renovadoDe: target.renovadoDe } : {}) };
  }

  async function fromLeader(sid: string, call: SendCall): Promise<BrowserToolOutcome> {
    const target = leaderTarget(call.para, call.quadro);
    if (typeof target === 'string') return { kind: 'error', text: target };
    const { projectPath } = target;
    const words = `${call.tarefa ? `[${call.tarefa}] ` : ''}${call.texto}`;
    const targetSid = sidOfPlace(projectPath, target.placeId, await localSessions());
    if (!targetSid) return relayed(projectPath, LEADER_OF_ALL, 'Líder', target.placeId, words);
    const item = enqueue({ lugar: LEADER_OF_ALL, nome: 'Líder', sid }, { lugar: target.placeId, sid: targetSid }, words);
    return {
      kind: 'text',
      text: JSON.stringify({
        entregue: item.estado === 'entregue' ? 'entregue' : 'na-fila',
        id: item.id,
        para: target.placeId,
        ...(target.renovadoDe ? { renovado: `${target.renovadoDe} fechou; foi para o lugar que o sucede (${target.placeId}).` } : {}),
        como: HOW,
      }),
    };
  }

  /**
   * t-d461e003 — the place the Líder único names, running in this machine's tmux: its board place and its sid, or why
   * not (with the PC off nothing else shows or closes a session; a place of another machine waits for the PC). As on
   * the PC (`findPlace`): only the exact id of a place of the board, never a role, "lider-quadro", "quem-me-abriu" nor
   * the successor of a closed place (closing would end a live sibling); two live sessions with the place = refused.
   */
  async function leaderLocalTarget(call: ScreenCall | CloseCall, verb: string): Promise<{ readonly placeId: string; readonly sid: string; readonly estado?: string } | string> {
    const boards = picturedBoards(deps.picture());
    const names = [...boards.keys()].map(lastSegment).join(', ') || 'nenhum';
    const id = call.quem.trim();
    const isPlaceOf = (board: MindscapeBoard | undefined, listar: readonly unknown[]): boolean => board?.cards[id]?.kind === 'session' || listedPlaces(listar).some((place) => place.id === id);
    const found = call.quadro
      ? [...boards].find(([pasta]) => pasta === call.quadro || lastSegment(pasta) === call.quadro)
      : [...boards].find(([, { listar, board }]) => isPlaceOf(board, listar));
    if (!call.quadro && !found) return `"${id}" não é lugar de nenhum quadro que conheço com o PC fora (${names}); use o id do lugar (veja sessao_listar) e diga o quadro em "quadro".`;
    if (!found) return `Com o PC fora, conheço só os quadros do último retrato (${names}); "${call.quadro}" não está entre eles.`;
    const [projectPath, { listar, board }] = found;
    if (!isPlaceOf(board, listar)) return `"${id}" não é um lugar do quadro ${lastSegment(projectPath)}: use o id do lugar (veja sessao_listar).`;
    const estado = listedPlaces(listar).find((place) => place.id === id)?.estado;
    if (estado === 'fechada') return `"${id}" está fechada; se outro lugar a sucedeu, use o id dele (veja sessao_listar).`;
    const reach = board ? canReach({ schemaVersion: 8, boards: { [projectPath]: board } }, LEADER_OF_ALL_FROM, { projectPath, placeId: id }) : { ok: false as const, reason: 'o retrato não tem as setas deste quadro.' };
    if (!reach.ok) return `Sem ligação: o Líder único não alcança "${id}" no quadro ${lastSegment(projectPath)}: ${reach.reason}`;
    const sids = sidsOfPlace(projectPath, id, await localSessions());
    if (!sids.length) return `"${id}" não roda nesta máquina: com o PC fora, ${verb} só sessões do tmux daqui.`;
    if (sids.length > 1) return `"${id}" tem ${sids.length} sessões vivas nesta máquina (${sids.join(', ')}); não sei qual é a do lugar. Espere o PC voltar.`;
    return { placeId: id, sid: sids[0]!, ...(estado ? { estado } : {}) };
  }

  /** When each target with a waiting item was first missing from tmux (memory only). */
  const missing = new Map<string, number>();
  /** Items whose place has two or more live sessions here: said once in the log (memory only). */
  const crowded = new Set<string>();

  /**
   * t-c3fbe852 — a waiting item whose target left this machine (missing from tmux for `GONE_MS`): the Líder único
   * renewed here gets it in its new tmux; so does a place renewed here (t-0116dccf: exactly one live session of the
   * same place in the picture, else nothing is guessed); otherwise an item that carries its message goes to the PC's
   * relay with the same key (sent before it is marked: a crash in between sends it again, and the key joins it there),
   * never twice.
   */
  async function sendBack(): Promise<void> {
    const waiting = read().filter((item) => item.estado === 'fila' && !staleRecado(item, now()) && (item.volta || item.para.lugar === LEADER_OF_ALL || item.para.lugar.startsWith('place:')));
    if (!waiting.length) {
      missing.clear();
      return;
    }
    const live = await localSessions();
    const at = now();
    for (const sid of [...missing.keys()]) if (live.has(sid) || !waiting.some((item) => item.para.sid === sid)) missing.delete(sid);
    const gone = new Set<string>();
    for (const item of waiting) {
      if (live.has(item.para.sid)) continue;
      const since = missing.get(item.para.sid) ?? at;
      missing.set(item.para.sid, since);
      if (at - since >= GONE_MS) gone.add(item.para.sid);
    }
    if (!gone.size) return;
    const leader = (await deps.leader?.()) ?? null;
    for (const item of waiting.filter((candidate) => gone.has(candidate.para.sid))) {
      if (item.para.lugar === LEADER_OF_ALL && leader && leader.sid !== item.para.sid) {
        update(
          (candidate) => candidate.id === item.id && candidate.estado === 'fila',
          (candidate) => ({ ...candidate, para: { ...candidate.para, sid: leader.sid } }),
        );
        log(`recado ${item.id} segue o Líder único para a sessão ${leader.sid}.`);
        continue;
      }
      if (item.para.lugar.startsWith('place:')) {
        // Same place and same board, as `sidsOfPlace`. The board: the message's, else the old session's in the picture,
        // else the sender's when it is a place (`sessao_enviar` only reaches its own board). None known: the place alone
        // (its id is `place:<uuid>`, unique across boards).
        const pasta = item.volta?.projectPath || pastaOf(item.para.sid) || (item.de.lugar.startsWith('place:') ? pastaOf(item.de.sid) : undefined);
        const alive = Object.entries(deps.picture()?.sessoes ?? {})
          .filter(([sid, session]) => live.has(sid) && session.quemSou.lugar === item.para.lugar && (!pasta || session.quemSou.pasta === pasta))
          .map(([sid]) => sid);
        if (alive.length === 1) {
          update(
            (candidate) => candidate.id === item.id && candidate.estado === 'fila',
            (candidate) => ({ ...candidate, para: { ...candidate.para, sid: alive[0]! } }),
          );
          log(`recado ${item.id} segue o lugar ${item.para.lugar} para a sessão ${alive[0]}.`);
          continue;
        }
        if (alive.length > 1 && !crowded.has(item.id)) {
          crowded.add(item.id);
          log(`recado ${item.id} para ${item.para.lugar}: a sessão ${item.para.sid} saiu, e o lugar tem ${alive.length} sessões vivas aqui (${alive.join(', ')}); não sei qual, ele espera.`);
        }
      }
      if (!item.volta || !deps.relay) continue;
      try {
        // With when it was first queued: its age goes on counting in the relay (revisão do #524).
        await deps.relay({ ...item.volta, sentAt: item.criado });
      } catch (error) {
        log(`recado ${item.id} não voltou ao relay: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      update(
        (candidate) => candidate.id === item.id && candidate.estado === 'fila',
        (candidate) => ({ ...candidate, estado: 'devolvido', entregueEm: now() }),
      );
      log(`recado ${item.id} para ${item.para.lugar}: a sessão ${item.para.sid} saiu desta máquina; foi ao relay do PC.`);
    }
  }

  /**
   * A warning to the Líder único, by the daemon's way (`toLeader`): his own queue when he lives here, else the relay
   * (the PC's, or the personal VPS's from a satellite). The key joins a repeat there. `about` = the session whose box is
   * stuck: when it is the Líder's own, nothing new is queued for him, only logged — a warning typed into the same box
   * that does not take the Enter would be stuck in turn and warn again, without end (21 recados an hour, 19/11).
   */
  async function warnLeader(key: string, words: string, about: string): Promise<void> {
    const text = `◆ Oráculo: ${words}`;
    const message: OwnerMessage = { projectPath: '', placeId: '', text, leaderText: text, key: `caixa:${key}` };
    try {
      const leader = (await deps.leader?.()) ?? null;
      if (leader?.sid === about) {
        log(`aviso ao Líder único sobre a própria caixa dele, só no log: ${words.slice(0, 160)}`);
        return;
      }
      if (await toLocalLeader({ lugar: '', nome: 'Oráculo' }, words, message)) return;
      if (deps.relay) await deps.relay(message);
      else log(`aviso ao Líder único sem relay: ${words.slice(0, 160)}`);
    } catch (error) {
      log(`aviso ao Líder único falhou: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The board of a session of the picture (its folder), for the notices. */
  const pastaOf = (sid: string | undefined): string | undefined => {
    const pasta = sid ? deps.picture()?.sessoes[sid]?.quemSou.pasta : undefined;
    return typeof pasta === 'string' && pasta ? pasta : undefined;
  };

  /** The words the Líder único reads in his own queue (the label already says "do Oráculo"). */
  const oracleWords = (text: string): string => text.replace(/^◆\s*Oráculo[^:]*:\s*/, '');

  /**
   * Recado vencido — tells whoever sent `item` that it went stale undelivered. The sender alive here: its own queue;
   * open on another machine (the picture's list): that machine's queue, else the relay; no longer open, or unknown: the
   * Líder único. The notice's key (`vencido:…`) joins a repeat everywhere, so telling again after a crash is safe.
   */
  async function tellSender(item: RecadoItem): Promise<void> {
    const from = item.de.lugar || (item.volta?.key ? relaySenderOf(item.volta.key) : undefined);
    const projectPath = item.volta?.projectPath || pastaOf(item.para.sid) || pastaOf(item.de.sid) || '';
    const notice = expiryNotice({
      key: item.volta?.key ?? item.id,
      projectPath,
      from,
      to: item.para.lugar === LEADER_OF_ALL ? 'o Líder único' : item.para.lugar,
      createdAt: item.criado,
      text: wordsOf(item),
    });
    if (!notice) return;
    const oracle = { lugar: '', nome: 'Oráculo' };
    const toLeaderNotice = async (): Promise<void> => {
      const message: OwnerMessage = { ...notice, placeId: '', text: notice.leaderText };
      if (await toLocalLeader(oracle, oracleWords(notice.leaderText), message)) return;
      if (deps.relay) await deps.relay(message);
      else log(`aviso de recado vencido ao Líder único sem relay: ${notice.leaderText.slice(0, 160)}`);
    };
    if (!notice.placeId) return toLeaderNotice();
    const live = await localSessions();
    const sid = item.de.sid && live.has(item.de.sid) ? item.de.sid : projectPath ? sidOfPlace(projectPath, notice.placeId, live) : undefined;
    if (sid) {
      enqueue(oracle, { lugar: notice.placeId, sid }, oracleWords(notice.text), notice.key, notice);
      return;
    }
    const listar = projectPath ? picturedBoards(deps.picture()).get(projectPath)?.listar : undefined;
    const open = listar !== undefined && isLiveListedPlace(listedPlaces(listar).find((place) => place.id === notice.placeId));
    if (!open) return toLeaderNotice();
    if (await toRemote(notice)) return;
    if (deps.relay) await deps.relay(notice);
    else log(`aviso de recado vencido para ${notice.placeId} fora desta máquina e sem relay.`);
  }

  /** Items whose notice failed (memory only): said once in the log, tried again each tick, never delivered meanwhile. */
  const untold = new Set<string>();

  /**
   * Recado vencido — each tick (the first one after a boot too): the owner's stale items are marked late; any other
   * stale item tells its sender, then turns `vencido`. Notice first: a crash in between tells again, and the key joins.
   */
  async function expire(): Promise<void> {
    const at = now();
    const items = read();
    if (items.some((item) => lateOwnerItem(item, at) !== item)) update((item) => lateOwnerItem(item, at) !== item, (item) => lateOwnerItem(item, at));
    for (const item of items.filter((candidate) => staleRecado(candidate, at))) {
      try {
        await tellSender(item);
      } catch (error) {
        if (!untold.has(item.id)) log(`recado ${item.id} venceu, mas o aviso a quem mandou falhou: ${error instanceof Error ? error.message : String(error)}`);
        untold.add(item.id);
        continue;
      }
      untold.delete(item.id);
      const changed = update(
        (candidate) => candidate.id === item.id && candidate.estado === 'fila',
        (candidate) => ({ ...candidate, estado: 'vencido', vencidoEm: now() }),
      );
      if (changed.length) log(`recado ${item.id} venceu sem entrega (${ageText(item.criado, at)}, para ${item.para.lugar} (${item.para.sid})).`);
    }
  }

  /** The text each session's field has held unchanged since `since` (memory only); one warning and one Enter per box. */
  const boxes = new Map<string, { readonly text: string; readonly since: number; enters: number; nextEnterAt: number; warned: boolean }>();
  let lastWatch = Number.NEGATIVE_INFINITY;

  /**
   * The box watcher (caixa pendurada, 19/11): every session of this machine's tmux whose field holds the same unsent
   * text for `STUCK_MS`. The rule (see the head of this file): a "◆ …" text in an idle session gets one Enter (only its
   * Enter was lost, and the queue behind it moves); any other text is the owner's, never cleared nor sent, and the Líder
   * único hears of it once per box. The fields the entregador is typing into are its own (it clears them in 20 s).
   */
  async function watchBoxes(): Promise<void> {
    const at = now();
    if (at - lastWatch < WATCH_MS) return;
    lastWatch = at;
    const live = await localSessions();
    for (const sid of [...boxes.keys()]) if (!live.has(sid)) boxes.delete(sid);
    for (const sid of [...lastScreens.keys()]) if (!live.has(sid)) lastScreens.delete(sid);
    for (const sid of [...boxSince.keys()]) if (!live.has(sid)) boxSince.delete(sid);
    for (const sid of [...turnSeen]) if (!live.has(sid)) turnSeen.delete(sid);
    const typing = new Set(read().filter((item) => item.estado === 'digitado').map((item) => item.para.sid));
    for (const sid of live) {
      if (!SID_PATTERN.test(sid)) continue;
      const screen = await tmux.screen(sid);
      // Not readable now (tmux silent, copy mode): the box stays as it was known.
      if (!screen || screen.inMode) continue;
      const quiet = screenIsQuiet(sid, screen.text);
      const text = fieldText(screen.text);
      if (!text) {
        boxes.delete(sid);
        continue;
      }
      const known = boxes.get(sid);
      if (!known || known.text !== text) {
        boxes.set(sid, { text, since: at, enters: 0, nextEnterAt: 0, warned: false });
        continue;
      }
      if (typing.has(sid) || at - known.since < STUCK_MS) continue;
      const donel = DONEL_FORM.test(text);
      // Idle: nothing running on screen, and its hook said it stopped, or its last turn ended and is quiet, or it never
      // had a turn (19/11: a renewed session's first message, before which the transcript holds nothing).
      const idle = async (): Promise<boolean> =>
        !BUSY_ON_SCREEN.test(screen.text) &&
        (moodOf(sid) === 'parada' || (moodOf(sid) !== 'ocupada' && ((await transcriptSaysStopped(sid, quiet)) || (await transcriptSaysFresh(sid)))));
      if (donel && known.enters < MAX_BOX_ENTERS) {
        if (at < known.nextEnterAt) continue;
        if (await idle()) {
          known.enters += 1;
          known.nextEnterAt = at + WATCH_MS * 2 ** (known.enters - 1);
          const sent = await tmux.enter(sid);
          log(
            `caixa da sessão ${sid}: aviso do Donel parado há ${Math.round((at - known.since) / 60_000)} min${sent ? ` enviado com Enter (${known.enters}ª de ${MAX_BOX_ENTERS})` : '; o tmux recusou o Enter'}.`,
          );
          if (sent) continue;
        }
      }
      // The last Enter had its wait too: only then the Líder hears that it did not take.
      if (donel && known.enters >= MAX_BOX_ENTERS && at < known.nextEnterAt) continue;
      if (known.warned) continue;
      known.warned = true;
      const who = deps.picture()?.sessoes[sid]?.quemSou ?? {};
      const lugar = typeof who.lugar === 'string' ? who.lugar : undefined;
      const quadro = typeof who.pasta === 'string' ? lastSegment(who.pasta) : undefined;
      const minutes = Math.max(1, Math.floor((at - known.since) / 60_000));
      const why = donel ? (known.enters > 0 ? ' Era um aviso do Donel e o Enter não entrou.' : ' É um aviso do Donel, mas a sessão está num turno.') : ' Não tem a forma de aviso do Donel: pode ser o dono digitando, não mexi.';
      log(`caixa da sessão ${sid} com texto não enviado há ${minutes} min: avisando o Líder único.`);
      await warnLeader(
        `${sid}:${known.since}`,
        `caixa com texto não enviado há mais de 5 min na sessão ${sid}${lugar ? ` (lugar ${lugar}${quadro ? `, quadro ${quadro}` : ''})` : ''}, há ${minutes} min: «${text.slice(0, PREVIEW_CHARS)}».${why} O que espera por ela na fila só entra quando a caixa esvaziar.`,
        sid,
      );
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      // Its own failure never stops the delivery below (which skips a stale item anyway).
      await expire().catch((error: unknown) => log(`recados vencidos: ${error instanceof Error ? error.message : String(error)}`));
      await sendBack();
      // Its own failure never stops the delivery below.
      await watchBoxes().catch((error: unknown) => log(`vigia das caixas: ${error instanceof Error ? error.message : String(error)}`));
      const at = now();
      // 1. Typed items: confirmed by the transcript, another Enter on a stuck field, or back to the queue.
      /** Sessions whose field held this tick's typing and was cleared (the items typed together share the field). */
      const clearedNow = new Set<string>();
      for (const item of read().filter((candidate) => candidate.estado === 'digitado')) {
        const sid = item.para.sid;
        const since = at - (item.digitadoEm ?? at);
        if (since >= CONFIRM_MS) {
          const seen = await typedInTranscript(sid, item.id);
          const changed = update(
            (candidate) => candidate.id === item.id && candidate.estado === 'digitado',
            (candidate) => (seen ? { ...candidate, estado: 'entregue', via: 'transcript', entregueEm: now() } : { ...candidate, estado: 'fila' }),
          );
          enters.delete(item.id);
          if (moodOf(sid) === 'digitando') moods.delete(sid);
          // Only when it really went back to the queue (a hook may have confirmed it meanwhile, and the field is then
          // someone else's): its Enter never went in and what it left in the field goes. A field that held it is typed
          // again right away (the text sat there: it did not come in), until the typings are spent; otherwise (an empty
          // field, the Enter's fate unknown, or the typings spent) the screen waits a while and the turn end delivers.
          if (!seen && changed.length) {
            const screen = await tmux.screen(sid);
            const held = clearedNow.has(sid) || Boolean(screen && !screen.inMode && fieldHoldsOnly(screen.text, [tagOf(item.id)]));
            const cleared = clearedNow.has(sid) || (held && (await tmux.clear(sid)));
            if (cleared) clearedNow.add(sid);
            if (!cleared || item.tentativas >= MAX_TYPINGS) holds.set(sid, now() + HOLD_MS);
            if (held && item.tentativas >= MAX_TYPINGS) {
              log(`recado ${item.id} ficou na caixa da sessão ${sid} depois de ${item.tentativas} digitações: caixa limpa, volta à fila.`);
              await warnLeader(
                `entrega:${item.id}`,
                `o recado ${item.id} para ${item.para.lugar} (sessão ${sid}) ficou na caixa depois de ${item.tentativas} digitações com Enter; limpei a caixa e ele volta à fila (entra no fim do turno dela). Confira a sessão.`,
                sid,
              );
            }
          }
        } else if (since >= ENTER_AGAIN_MS && (enters.get(item.id) ?? 0) < MAX_ENTERS) {
          // It came in already (a session with no hook to say so): confirmed, and the field is no longer ours.
          if (await typedInTranscript(sid, item.id)) {
            update(
              (candidate) => candidate.id === item.id && candidate.estado === 'digitado',
              (candidate) => ({ ...candidate, estado: 'entregue', via: 'transcript', entregueEm: now() }),
            );
            enters.delete(item.id);
            if (moodOf(sid) === 'digitando') moods.delete(sid);
            continue;
          }
          // Another Enter only on a field that still shows this recado: never on someone's draft.
          const screen = await tmux.screen(sid);
          if (screen && !screen.inMode && fieldHoldsOnly(screen.text, [tagOf(item.id)])) {
            enters.set(item.id, (enters.get(item.id) ?? 0) + 1);
            await tmux.enter(sid);
          }
        }
      }
      // t-f66595b2 — an opening request whose session came up after the PC gave up typing it joins the queue.
      await firstMessagesIn().catch((error: unknown) => log(`pedidos de abertura: ${error instanceof Error ? error.message : String(error)}`));
      // 2. Stopped sessions with something queued: typed only on a free field.
      const queued = read().filter((item) => item.estado === 'fila' && item.tentativas < MAX_TYPINGS && !staleRecado(item, at));
      for (const sid of new Set(queued.map((item) => item.para.sid))) {
        // t-f66595b2 (condição do Líder) — an opening request whose session's first message is that request (the PC
        // pasted it meanwhile): delivered by the PC, never typed again.
        const pasted = new Set<string>();
        for (const item of queued.filter((candidate) => candidate.para.sid === sid && candidate.primeira)) {
          if (!(await pastedAlready(sid, item.primeira!))) continue;
          const done = update(
            (candidate) => candidate.id === item.id && candidate.estado === 'fila',
            (candidate) => ({ ...candidate, estado: 'entregue', via: 'transcript', entregueEm: now() }),
          );
          if (done.length) {
            pasted.add(item.id);
            log(`pedido de abertura ${item.id} de ${item.para.lugar}: a conversa da sessão ${sid} já começa com ele (o PC colou); não digito.`);
          }
        }
        if (queued.every((item) => item.para.sid !== sid || pasted.has(item.id))) continue;
        const mood = moods.get(sid);
        if (mood?.mood === 'digitando' || (mood?.mood === 'ocupada' && now() - mood.at < STALE_BUSY_MS)) continue;
        if (mood?.mood !== 'parada' && (holds.get(sid) ?? 0) > now()) continue;
        const screen = await tmux.screen(sid);
        if (!screen || screen.inMode) continue;
        const quiet = screenIsQuiet(sid, screen.text);
        if (BUSY_ON_SCREEN.test(screen.text) || isWorking(plainScreen(screen.text).split('\n')) || !fieldIsFree(screen.text).free) continue;
        // A session that never had a turn has no end of turn to read (t-f66595b2): its box empty and still for a minute.
        // Only a first typing, or one whose text this tick cleared from the box: a typing the box took but no transcript
        // shows (none found) is never typed again on the screen's word alone.
        const firstTyping = clearedNow.has(sid) || queued.every((item) => item.para.sid !== sid || item.tentativas === 0);
        // Its opening request still kept (not queued nor dropped yet): another recado would start the conversation
        // without it. They wait; once it is queued, it goes first.
        const fresh = firstTyping && !openingKept(sid) && (await freshAndSettled(sid, screen.text, FRESH_SETTLE_MS));
        if (mood?.mood !== 'parada' && !(await transcriptSaysStopped(sid, quiet)) && !fresh) continue;
        // The conversation decides: an item typed before whose label is in the transcript came in, never typed again.
        const ids = new Set<string>();
        let bytes = 0;
        for (const item of queued.filter((candidate) => candidate.para.sid === sid && !pasted.has(candidate.id))) {
          if (item.tentativas > 0 && (await typedInTranscript(sid, item.id))) {
            update(
              (candidate) => candidate.id === item.id && candidate.estado === 'fila',
              (candidate) => ({ ...candidate, estado: 'entregue', via: 'transcript', entregueEm: now() }),
            );
            continue;
          }
          // Joined, they stay under tmux's ceiling; the first goes alone whatever its size. What does not fit stops the
          // join: it and everything after it wait for the next typing, so the queue's order never changes (#527).
          const size = Buffer.byteLength(typeable(item.texto)) + 3;
          if (ids.size && bytes + size > MAX_TYPING_BYTES) break;
          bytes += size;
          ids.add(item.id);
        }
        if (!ids.size) continue;
        // Marked BEFORE typing: a turn end in between does not deliver them a second time.
        const typed = update(
          (item) => ids.has(item.id) && item.estado === 'fila',
          (item) => ({ ...item, estado: 'digitado', tentativas: item.tentativas + 1, digitadoEm: now() }),
        );
        if (!typed.length) continue;
        moods.set(sid, { mood: 'digitando', at: now() });
        const ok = await tmux.type(sid, typed.map((item) => typeable(item.texto)).join('   '));
        if (!ok) {
          // The text may be in the field already (only the Enter failed): the items stay typed, counted, so a later
          // Enter is confirmed by the prompt hook, the field is cleared if unconfirmed in 20 s, and the screen waits
          // 2 min (never a retry every tick).
          holds.set(sid, now() + HOLD_MS);
          log(`tmux recusou digitar na sessão ${sid}; confere em 20 s e fica para o fim do turno.`);
        }
      }
    } catch (error) {
      log(`laço de entrega: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      ticking = false;
    }
  }

  /** t-49dee38d (T1) — the words a forwarded message goes with: a short line, then what came in as it came. */
  function forwardWords(old: string, owner: boolean, original: string, at: number): string {
    const head = owner
      ? `[reencaminhado] o dono digitou isto na sessão anterior deste lugar (${old.slice(0, 8)}) depois da passagem de bastão; não está nela. O texto, como veio:`
      : `[reencaminhado] chegou à sessão anterior deste lugar (${old.slice(0, 8)}) depois da passagem de bastão; não está nela. Como veio:`;
    const words = `${head} ${original}`;
    // Past one typing's ceiling (tmux refuses it): the whole of it in a file, read first.
    if (Buffer.byteLength(typeable(words)) + 80 <= MAX_TYPING_BYTES) return words;
    const name = `reencaminhado-${createHash('sha256').update(JSON.stringify([old, at, original])).digest('hex').slice(0, 16)}`;
    const whole = writeLongRequest(dirname(file), name, original);
    return `${head} longo demais para digitar; o texto inteiro está em ${whole} . Leia o arquivo todo. O começo: ${original.slice(0, FIRST_TYPED_CHARS)} …`;
  }

  async function forwardAfterHandoff(call: ForwardCall): Promise<ForwardOutcome> {
    const { de, para, lugar, desde } = call;
    if (!SID_PATTERN.test(de) || !SID_PATTERN.test(para) || de === para || !lugar) return { ok: false, motivo: 'pedido de reencaminhar inválido' };
    try {
      // What the old one's conversation shows since the request: read first, so nothing is forwarded blind.
      const path = await transcriptPath(de);
      if (!path) return { ok: false, motivo: `não achei a conversa de ${de.slice(0, 8)}` };
      const tail = await readTranscript(path);
      if (tail === null) return { ok: false, motivo: `não li a conversa de ${de.slice(0, 8)}` };
      const typedInOld = typedMessagesSince(tail, desde, call.excluir);
      const items = read();
      const outgoing: { readonly at: number; readonly words: string; readonly key: string; readonly source?: string }[] = [];
      for (const item of items) {
        if (item.para.sid !== de || item.reencaminhado) continue;
        // Delivered to it since the request, or typed into it (whether it came in or not, it goes once, from here).
        const delivered = item.estado === 'entregue' && (item.entregueEm ?? 0) >= desde;
        if (!delivered && item.estado !== 'digitado') continue;
        const at = item.entregueEm ?? item.digitadoEm ?? item.criado;
        outgoing.push({ at, words: forwardWords(de, false, item.texto, at), key: `reencaminhado:${item.id}`, source: item.id });
      }
      for (const message of typedInOld) {
        // A recado of this queue: the queue says whether it came after the request (it goes from there), never twice.
        if (message.ids.length > 0 && message.ids.every((id) => items.some((item) => item.id === id))) continue;
        outgoing.push({ at: message.at, words: forwardWords(de, !message.donel, message.text, message.at), key: `reencaminhado:${de}:${message.key}` });
      }
      outgoing.sort((a, b) => a.at - b.at);
      const oracle = { lugar: '', nome: 'Oráculo' };
      for (const out of outgoing) enqueue(oracle, { lugar, sid: para }, out.words, out.key);
      const sources = new Set(outgoing.flatMap((out) => (out.source ? [out.source] : [])));
      if (sources.size)
        update(
          (item) => sources.has(item.id) && item.para.sid === de && !item.reencaminhado,
          (item) => ({ ...item, reencaminhado: para, ...(item.estado === 'digitado' ? { estado: 'entregue' as const, entregueEm: now() } : {}) }),
        );
      // What still waits for the old one never reached it: it is the successor's now.
      const passed = update(
        (item) => item.para.sid === de && item.estado === 'fila',
        (item) => ({ ...item, para: { ...item.para, sid: para } }),
      );
      if (outgoing.length || passed.length)
        log(`renovação de ${de.slice(0, 8)}: ${outgoing.length} recado(s) ou mensagem(ns) que chegaram depois da passagem reencaminhado(s) a ${para.slice(0, 8)}; ${passed.length} da fila passado(s) a ela.`);
      return { ok: true, reencaminhados: outgoing.length, passados: passed.length };
    } catch (error) {
      return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    async deliverLocal(message, localText) {
      // The label already opens with ◆; the message's own one would be a second.
      if (!message.placeId || message.placeId === LEADER_OF_ALL) {
        // t-c3fbe852 — the Líder único alive here: its queue, with what it would read from the PC.
        const item = await toLocalLeader({ lugar: '', nome: 'Oráculo' }, (localText ?? message.leaderText).replace(/^◆\s*/, ''), message);
        return item ? 'lider' : null;
      }
      const sid = sidOfPlace(message.projectPath, message.placeId, await localSessions());
      if (!sid) return null;
      const item = enqueue({ lugar: '', nome: 'Oráculo' }, { lugar: message.placeId, sid }, message.text.replace(/^◆\s*/, ''), message.key, message);
      return (await notHere(item)) ? null : { placeId: message.placeId };
    },

    stateOf(key) {
      const chave = keyedChave(key);
      const item = read().find((candidate) => candidate.chave === chave);
      return item ? { estado: item.estado, sid: item.para.sid } : undefined;
    },

    transcriptOf: transcriptPath,

    forwardAfterHandoff,

    async enviar(sid, mine, call: SendCall, pc = 'ligado'): Promise<BrowserToolOutcome | 'repassar'> {
      // With the PC on, what the picture cannot send goes to it: the picture may be minutes old (the probe's), and a
      // place opened or an arrow drawn after it is the PC's to know (revisão do #486). With the PC off it is all there is.
      const pcOn = pc === 'ligado';
      const who = mine.quemSou;
      // The Líder único the PC knows, with the PC on: the PC sends it, as before.
      if (who.liderUnico === true) return pcOn ? 'repassar' : fromLeader(sid, call);
      const board = mine.board;
      // Who the caller is, or its board, unknown here: the PC decides.
      if (typeof who.lugar !== 'string' || typeof who.pasta !== 'string' || !board) return pcOn ? 'repassar' : { kind: 'error', text: NOT_PICTURED };
      const me = who.lugar;
      const projectPath = who.pasta;
      const places = listedPlaces(mine.listar);
      const target = resolveAddress(board, places, me, call.para);
      if ('erro' in target) return pcOn ? 'repassar' : { kind: 'error', text: target.erro };
      const words = `${call.tarefa ? `[${call.tarefa}] ` : ''}${call.texto}`;
      if ('liderUnico' in target) {
        // The PC's rule (t-d461e003): opened by the Líder único, below one he opened, or nobody alive above to hear it.
        const opened = (id: string): boolean => places.find((place) => place.id === id)?.abertaPor === LEADER_OF_ALL;
        const isLive = (id: string): boolean => isLiveListedPlace(places.find((place) => place.id === id));
        const reach = canReachLeader({ schemaVersion: 8, boards: { [projectPath]: board } }, { projectPath, placeId: me }, opened, isLive);
        if (!reach.ok) return pcOn ? 'repassar' : { kind: 'error', text: `Sem ligação com o Líder único: ${reach.reason}` };
        // t-c3fbe852 — the Líder único alive here hears it from its own queue, PC on or off (no paste through the PC).
        const back = relayMessage(projectPath, me, nameOf(who), LEADER_OF_ALL, words);
        const item = await toLocalLeader({ lugar: me, nome: nameOf(who), sid }, words, back);
        if (item) return { kind: 'text', text: JSON.stringify({ entregue: item.estado === 'entregue' ? 'entregue' : 'na-fila', id: item.id, para: LEADER_OF_ALL, como: HOW }) };
        return pcOn ? 'repassar' : relayed(projectPath, me, nameOf(who), LEADER_OF_ALL, words);
      }
      const word = call.para.trim().toLowerCase();
      // A renewed place's old id: the link the caller had to it holds for its successor.
      const renewedFrom = 'renovadoDe' in target ? target.renovadoDe : undefined;
      if (word !== BOARD_LEADER && word !== MY_OPENER && !drawnLink(projectPath, board, me, target.placeId) && !(renewedFrom && drawnLink(projectPath, board, me, renewedFrom))) {
        const review = [await reviewLinked(mine, places, me, target.placeId), renewedFrom ? await reviewLinked(mine, places, me, renewedFrom) : false];
        if (!review.includes(true)) {
          // An arrow drawn after the picture, or the review link the ledger's machine did not answer: the PC decides.
          if (pcOn) return 'repassar';
          return {
            kind: 'error',
            text: `Sem ligação: não há seta do seu lugar (${me}) para "${target.placeId}". Peça ao dono, ou use sessao_abrir. Para o Líder do quadro, "para": "${BOARD_LEADER}"; para quem abriu você, "para": "${MY_OPENER}".${review.includes(null) ? ' (O Oráculo da VPS pessoal não respondeu para conferir a ligação de revisão: tente de novo em um minuto.)' : ''}`,
          };
        }
      }
      const targetSid = sidOfPlace(projectPath, target.placeId, await localSessions());
      if (!targetSid) return pcOn ? 'repassar' : relayed(projectPath, me, nameOf(who), target.placeId, words);
      const item = enqueue({ lugar: me, nome: nameOf(who), sid }, { lugar: target.placeId, sid: targetSid }, words);
      return {
        kind: 'text',
        text: JSON.stringify({
          entregue: item.estado === 'entregue' ? 'entregue' : 'na-fila',
          id: item.id,
          para: target.placeId,
          ...(renewedFrom ? { renovado: `${renewedFrom} fechou; foi para o lugar que o sucede (${target.placeId}). Use esse id daqui em diante.` } : {}),
          como: HOW,
        }),
      };
    },

    async verTela(_sid, call) {
      const target = await leaderLocalTarget(call, 'vejo');
      if (typeof target === 'string') return { kind: 'error', text: target };
      const screen = await tmux.screen(target.sid);
      if (!screen) return { kind: 'error', text: `O tmux de "${target.placeId}" não respondeu; tente de novo em instantes.` };
      const lines = plainScreen(screen.text).split('\n');
      return {
        kind: 'text',
        text: JSON.stringify({ id: target.placeId, ...(target.estado ? { estado: target.estado } : {}), tela: lines.slice(-SCREEN_LINES).join('\n'), fonte: 'tmux desta VPS (o PC está fora)' }, null, 1),
      };
    },

    async fechar(_sid, call) {
      const no = (why: string): BrowserToolOutcome => ({ kind: 'error', text: `Não fechei: ${why}` });
      const target = await leaderLocalTarget(call, 'fecho');
      if (typeof target === 'string') return no(target);
      if (!tmux.kill) return no('este Oráculo não sabe fechar sessões.');
      const screen = await tmux.screen(target.sid);
      if (!screen) return no(`o tmux de "${target.placeId}" não respondeu.`);
      // Never cut a turn nor a dialog: the app on the PC waits for the pause; here the caller asks for it.
      const lines = plainScreen(screen.text).split('\n');
      const dialog = blockingScreen(lines);
      if (dialog) return no(`a tela de "${target.placeId}" espera uma resposta (${dialog.title}); responda com sessao_permissao quando o PC voltar, ou espere.`);
      const turn = await (async () => {
        const path = await transcriptPath(target.sid);
        return path ? lastTurn(path) : null;
      })();
      const mood = moodOf(target.sid);
      if (BUSY_ON_SCREEN.test(screen.text) || isWorking(lines) || mood === 'ocupada' || mood === 'digitando' || (turn !== null && !turn.ended && mood !== 'parada' && now() - turn.at < IDLE_TURN_MS))
        return no(`"${target.placeId}" está no meio de um turno. Peça que pause (sessao_enviar) e feche quando ela parar.`);
      if (!(await tmux.kill(target.sid))) return no(`o tmux recusou fechar "${target.placeId}".`);
      log(`sessao_fechar do Líder único com o PC fora: ${target.placeId} (tmux donel-${target.sid}) fechada; a pasta fica para o app do PC limpar quando voltar.`);
      return { kind: 'text', text: 'Fechada.' };
    },

    async antesDaTarefa(caller, mine, call) {
      const service = deps.ledger();
      if (service) await renewBeforeTask(service, caller, mine, call, log);
    },

    depoisDaTarefa(_sid, mine, caller, call, answerText) {
      void taskNotices(mine, caller, call, answerText).catch((error: unknown) => log(`avisos da tarefa: ${error instanceof Error ? error.message : String(error)}`));
    },

    async hook(evento, headers, body) {
      if (evento !== 'fim-de-turno' && evento !== 'ocupada') return { status: 404, headers: {}, body: '' };
      const payload = parseObject(body);
      const sid = hookSid(headers, payload);
      if (!sid) return answerHook({});
      if (typeof payload.transcript_path === 'string' && payload.transcript_path) transcripts.set(sid, payload.transcript_path);

      if (evento === 'ocupada') {
        setMood(sid, 'ocupada');
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        // The typed item came in (or one that went back to the queue after all entered late): delivered, never again.
        if (prompt.includes('◆ Recado '))
          update(
            // Never one that went back to the relay: the PC delivers that one (it would arrive twice).
            (item) => item.para.sid === sid && (item.estado === 'fila' || item.estado === 'digitado') && item.tentativas > 0 && prompt.includes(tagOf(item.id)),
            (item) => ({ ...item, estado: 'entregue', via: 'tela', entregueEm: now() }),
          );
        return answerHook({});
      }

      // A stale item is never delivered (the next tick turns it vencido and tells its sender); the owner's go marked late.
      const delivered = update(
        (item) => item.para.sid === sid && item.estado === 'fila' && !staleRecado(item, now()),
        (item) => ({ ...lateOwnerItem(item, now()), estado: 'entregue', via: 'fim-de-turno', entregueEm: now() }),
      );
      if (!delivered.length) {
        if (moodOf(sid) !== 'digitando') setMood(sid, 'parada');
        return answerHook({});
      }
      setMood(sid, 'ocupada');
      const reason = [...delivered.sort((a, b) => a.criado - b.criado).map((item) => item.texto), ANSWER_LINE].join('\n\n');
      return answerHook({ decision: 'block', reason });
    },

    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
