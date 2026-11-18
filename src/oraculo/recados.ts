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
//   new end of turn delivers it); at most two typings per item. Another Enter (a long text can swallow the first) goes
//   only on a field that still shows the item, and a typing tmux refused counts as one (no retry every tick). A session no hook spoke of since the daemon came up
//   (a restart, a session opened before the hook was installed) is stopped when the screen and the transcript say so:
//   the last turn of the transcript ended and has been quiet for 10 s, the field is empty and the CLI does not say
//   "esc to interrupt". The same check revives a session the hooks left "ocupada" for over a minute (a lost Stop).
//
// Nothing vanishes (the queue is on disk before the answer), nothing arrives twice (one state per item; the same
// message inside 2 min joins the first). The notices the PC gave after a `tarefa_*` (delivery for acceptance, travada,
// precisa-do-dono) and the new ones (to the Revisores out of the chain, the verdict to the Dev) go the same way; a
// target out of this machine goes to the PC's relay (`fila.json`).

import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import { hasArrowLink } from '../shared/mindscape/agent-tools';
import { listedPlaces, resolveAddress } from '../shared/mindscape/address';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import { BOARD_LEADER, canReach, isBoardOrchestrator, isLiveListedPlace, MY_OPENER, successorOf, whoHears, type ListedPlace } from '../shared/mindscape/reach';
import type { MindscapeBoard } from '../shared/mindscape/model';
import type { LedgerTask } from '../shared/ledger/contract';
import type { LedgerToolCall } from '../shared/ledger/tools';
import { deliverersOf, reviewersOutsideChain, reviewLink, reviewRequestNotice, verdictNotice, verdictTargets } from '../shared/ledger/revisao';
import { followRenewal, urgentLedgerNotice, type LedgerCaller, type LedgerService } from '../main/ledger-store';
import type { ConfigIoDeps } from '../main/config-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { BoardPicture, PictureSession } from './portao';
import type { GateHookResponse, GateRecados, SendCall } from './gate-recados';

export type RecadoState = 'fila' | 'digitado' | 'entregue';
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
}

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
}

/** The last turn of a transcript: `ended` = its last main entry is the assistant's end of turn; `at` = file mtime. */
export interface TranscriptTurn {
  readonly ended: boolean;
  readonly at: number;
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
  /** Whether the transcript file has `label` (the confirmation of a typed item). Default: reads its end. */
  readonly transcriptHas?: (path: string, label: string) => Promise<boolean>;
  /** The transcript of a session no hook spoke of yet. Default: `~/.claude/projects/<pasta>/<sid>.jsonl`, the newest. */
  readonly transcriptOf?: (sid: string) => Promise<string | undefined>;
  /** The last turn of a transcript (`null` = unreadable). Default: reads its end. */
  readonly lastTurn?: (path: string) => Promise<TranscriptTurn | null>;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface GateRecadosHandle extends GateRecados {
  /** One round of the typing loop (the vitest calls it; `start` runs it every 2 s). */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

const TICK_MS = 2_000;
const CONFIRM_MS = 20_000;
const ENTER_AGAIN_MS = 5_000;
const MAX_ENTERS = 2;
const MAX_TYPINGS = 2;
/** After an unconfirmed typing, the screen is not trusted for this long (an end of turn still delivers). */
const HOLD_MS = 2 * 60_000;
/** A transcript that moved this recently is a turn that may still be going. */
const QUIET_MS = 10_000;
/** An "ocupada" this old is checked on the screen and the transcript (its Stop may have been lost). */
const STALE_BUSY_MS = 60_000;
const BUSY_ON_SCREEN = /esc to interrupt/i;
const PASTE_PLACEHOLDER = /\[Pasted text #\d+[^\]]*\]/g;
const JOIN_MS = 2 * 60_000;
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
  const estado = value.estado === 'entregue' || value.estado === 'digitado' ? value.estado : 'fila';
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
  };
}

/** The unique words that open an item and confirm it on the screen: "Recado r-…". */
const tagOf = (id: string): string => `Recado ${id}`;

function labelOf(id: string, de: RecadoItem['de']): string {
  return `◆ ${tagOf(id)} ${de.lugar ? `de ${de.nome} (${de.lugar})` : `do ${de.nome}`}:`;
}

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

function runTmux(args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string }> {
  return new Promise((resolve) => {
    execFile('tmux', ['-L', TMUX_SOCKET, ...args], { timeout: 3_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error ? 1 : 0, stdout: typeof stdout === 'string' ? stdout : '' });
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
};

export async function tmuxLocalSessions(): Promise<ReadonlySet<string>> {
  const listed = await runTmux(['ls', '-F', '#{session_name}']);
  return new Set(
    listed.stdout
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name.startsWith(TMUX_PREFIX))
      .map((name) => name.slice(TMUX_PREFIX.length)),
  );
}

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
      return { ended: false, at: mtimeMs };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
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

export function createGateRecados(deps: GateRecadosDeps): GateRecadosHandle {
  const { file, io } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] recados: ${line}`));
  const tmux = deps.tmux ?? systemRecadosTmux;
  const localSessions = deps.localSessions ?? tmuxLocalSessions;
  const transcriptHas = deps.transcriptHas ?? transcriptTailHas;
  const transcriptOf = deps.transcriptOf ?? findTranscript;
  const lastTurn = deps.lastTurn ?? transcriptLastTurn;
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

  /** A session no hook spoke of (or whose "ocupada" went stale): stopped when its transcript's last turn ended and is quiet. */
  async function transcriptSaysStopped(sid: string): Promise<boolean> {
    const path = await transcriptPath(sid);
    const turn = path ? await lastTurn(path) : null;
    return turn !== null && turn.ended && now() - turn.at >= QUIET_MS;
  }
  /** A typed item's label in its session's transcript (the known one, else found by the sid): it came in. */
  async function typedInTranscript(sid: string, id: string): Promise<boolean> {
    const path = await transcriptPath(sid);
    return path ? transcriptHas(path, tagOf(id)) : false;
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
    const kept = items.filter((item) => (item.entregueEm !== undefined ? at - item.entregueEm < DELIVERED_DAYS * DAY : at - item.criado < PENDING_DAYS * DAY));
    for (const item of items) if (item.estado !== 'entregue' && !kept.includes(item)) log(`recado ${item.id} para ${item.para.lugar} (${item.para.sid}) nunca entregue em ${PENDING_DAYS} dias: sai da fila.`);
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
      if (!io.existsSync(dirname(file))) io.mkdirSync(dirname(file));
      io.writeFileText(tmp, JSON.stringify({ items: kept }, null, 2));
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

  /** Queues `words` for `para` (or joins the same message of the last 2 min). */
  function enqueue(de: RecadoItem['de'], para: RecadoItem['para'], words: string): RecadoItem {
    const at = now();
    const chave = createHash('sha256').update(JSON.stringify([de.lugar, para.lugar, words])).digest('hex').slice(0, 32);
    const items = read();
    const same = items.find((item) => item.chave === chave && item.para.sid === para.sid && at - item.criado < JOIN_MS);
    if (same) return same;
    const id = `r-${randomBytes(4).toString('hex')}`;
    const item: RecadoItem = { id, chave, de, para, texto: `${labelOf(id, de)} ${words}`, criado: at, estado: 'fila', tentativas: 0 };
    write([...items, item]);
    return item;
  }

  /** The folder sid of the live session of `placeId` on the board of `projectPath`, on this machine. */
  function sidOfPlace(projectPath: string, placeId: string, live: ReadonlySet<string>): string | undefined {
    const sessions = Object.entries(deps.picture()?.sessoes ?? {});
    return sessions.find(([sid, session]) => live.has(sid) && session.quemSou.lugar === placeId && session.quemSou.pasta === projectPath)?.[0];
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
    if (!deps.relay) {
      log(`aviso para ${placeId} (${board}) fora desta máquina e sem relay: ${words.slice(0, 80)}`);
      return;
    }
    await deps.relay({
      projectPath,
      placeId: placeId === LEADER_OF_ALL ? '' : placeId,
      text: `◆ Oráculo: ${words}`,
      leaderText: `◆ Oráculo, quadro ${board}${placeId === LEADER_OF_ALL ? '' : ` (para ${placeId}, que não está aberta)`}: ${words}`,
      key,
    });
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
    const urgent = urgentLedgerNotice(call, answerText);
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
  async function relayed(projectPath: string, me: string, name: string, placeId: string, words: string): Promise<BrowserToolOutcome> {
    if (!deps.relay) return { kind: 'error', text: NO_RELAY };
    const board = lastSegment(projectPath);
    const toLeader = placeId === LEADER_OF_ALL;
    const chave = createHash('sha256').update(JSON.stringify([projectPath, me, placeId, words, Math.floor(now() / JOIN_MS)])).digest('hex').slice(0, 32);
    const signature = `${name} (${me})`;
    try {
      await deps.relay({
        projectPath,
        placeId: toLeader ? '' : placeId,
        text: `◆ Recado de ${signature}, guardado com o PC fora: ${words}`,
        leaderText: `◆ Recado, quadro ${board}${toLeader ? '' : ` (para ${placeId}, que não está aberta)`}, de ${signature}: ${words}`,
        key: `recado:${chave}`,
      });
    } catch (error) {
      log(`recado de ${me} para ${placeId} não entrou no relay: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: 'error', text: NO_RELAY };
    }
    return { kind: 'text', text: JSON.stringify({ entregue: 'pelo-relay', para: toLeader ? 'lider' : placeId, como: RELAY_HOW }) };
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const at = now();
      // 1. Typed items: confirmed by the transcript, another Enter on a stuck field, or back to the queue.
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
          // someone else's): its Enter never went in, what it left in the field goes, and the screen waits a while.
          if (!seen && changed.length) {
            holds.set(sid, now() + HOLD_MS);
            const screen = await tmux.screen(sid);
            if (screen && !screen.inMode && fieldHoldsOnly(screen.text, [tagOf(item.id)])) await tmux.clear(sid);
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
      // 2. Stopped sessions with something queued: typed only on a free field.
      const queued = read().filter((item) => item.estado === 'fila' && item.tentativas < MAX_TYPINGS);
      for (const sid of new Set(queued.map((item) => item.para.sid))) {
        const mood = moods.get(sid);
        if (mood?.mood === 'digitando' || (mood?.mood === 'ocupada' && now() - mood.at < STALE_BUSY_MS)) continue;
        if (mood?.mood !== 'parada' && (holds.get(sid) ?? 0) > now()) continue;
        const screen = await tmux.screen(sid);
        if (!screen || screen.inMode || BUSY_ON_SCREEN.test(screen.text) || !fieldIsFree(screen.text).free) continue;
        if (mood?.mood !== 'parada' && !(await transcriptSaysStopped(sid))) continue;
        const ids = new Set(queued.filter((item) => item.para.sid === sid).map((item) => item.id));
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

  return {
    async enviar(sid, mine, call: SendCall, pc = 'ligado'): Promise<BrowserToolOutcome | 'repassar'> {
      // With the PC on, what the picture cannot send goes to it: the picture may be minutes old (the probe's), and a
      // place opened or an arrow drawn after it is the PC's to know (revisão do #486). With the PC off it is all there is.
      const pcOn = pc === 'ligado';
      const who = mine.quemSou;
      const board = mine.board;
      // Who the caller is, or its board, unknown here: the PC decides.
      if (typeof who.lugar !== 'string' || typeof who.pasta !== 'string' || !board) return pcOn ? 'repassar' : { kind: 'error', text: NOT_PICTURED };
      const me = who.lugar;
      const projectPath = who.pasta;
      const places = listedPlaces(mine.listar);
      const target = resolveAddress(board, places, me, call.para);
      if ('erro' in target) return pcOn ? 'repassar' : { kind: 'error', text: target.erro };
      const words = `${call.tarefa ? `[${call.tarefa}] ` : ''}${call.texto}`;
      if ('liderUnico' in target) return pcOn ? 'repassar' : relayed(projectPath, me, nameOf(who), LEADER_OF_ALL, words);
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

    async antesDaTarefa(caller, mine, call) {
      const service = deps.ledger();
      if (!service) return;
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
            (item) => item.para.sid === sid && item.estado !== 'entregue' && item.tentativas > 0 && prompt.includes(tagOf(item.id)),
            (item) => ({ ...item, estado: 'entregue', via: 'tela', entregueEm: now() }),
          );
        return answerHook({});
      }

      const delivered = update(
        (item) => item.para.sid === sid && item.estado === 'fila',
        (item) => ({ ...item, estado: 'entregue', via: 'fim-de-turno', entregueEm: now() }),
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
