// Canal do Donel fora do PC (t-e195b35c, §2, §5, §6) — the recados of this machine's sessions, with no PC in the way.
// A `sessao_enviar` whose target runs here goes to a queue on disk (`<dir>/recados.json`, temp → rename, an unreadable
// file is set aside, never written over) and is delivered without pasting into a busy session:
//
// - at the end of the target's turn: the user-level Stop hook (scripts/vps/recados-hook.sh) asks `fim-de-turno`, and
//   the answer `{"decision":"block","reason":…}` hands it everything that waits for it, marked delivered at once;
// - to a stopped session (its last Stop found nothing): typed by tmux, ONLY on an empty input field (the port of
//   `campo_livre` of ~/bin/rotinas/despertador_sessoes.py), and confirmed by the next UserPromptSubmit hook (`ocupada`)
//   carrying its label, or by the label in the transcript. Unconfirmed in 20 s it goes back to the queue and is never
//   typed again until the screen is free again (a new end of turn delivers it); at most two typings per item. A session
//   never heard from is never typed into.
//
// Nothing vanishes (the queue is on disk before the answer), nothing arrives twice (one state per item; the same
// message inside 2 min joins the first). The notices the PC gave after a `tarefa_*` (delivery for acceptance, travada,
// precisa-do-dono) and the new ones (to the Revisores out of the chain, the verdict to the Dev) go the same way; a
// target out of this machine goes to the PC's relay (`fila.json`).

import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import { hasArrowLink } from '../shared/mindscape/agent-tools';
import { listedPlaces, resolveAddress } from '../shared/mindscape/address';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import { BOARD_LEADER, canReach, isBoardOrchestrator, isLiveListedPlace, MY_OPENER, successorOf, whoHears, type ListedPlace } from '../shared/mindscape/reach';
import type { MindscapeBoard } from '../shared/mindscape/model';
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
}

export interface GateRecadosDeps {
  /** `<dir>/recados.json`. */
  readonly file: string;
  readonly io: ConfigIoDeps;
  /** The ledger of this daemon; `null` on a satellite (no review link, no renewal, no task notices). */
  readonly ledger: () => LedgerService | null;
  readonly picture: () => BoardPicture | null;
  /** The sessions alive in this machine's tmux (folder sids). Default: `tmux -L donel ls`. */
  readonly localSessions?: () => Promise<ReadonlySet<string>>;
  readonly tmux?: RecadosTmux;
  /** A notice to a place out of this machine (or to the Líder único): the PC's relay. Absent = only logged. */
  readonly relay?: (message: OwnerMessage) => Promise<unknown>;
  /** Whether the transcript file has `label` (the confirmation of a typed item). Default: reads its end. */
  readonly transcriptHas?: (path: string, label: string) => Promise<boolean>;
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

/** The Claude Code input field: the "❯" line between the two last "────" rules. Free only when empty. */
export function fieldIsFree(screen: string): { readonly free: boolean; readonly reason: string } {
  const lines = withoutSuggestion(screen).replace(/\n+$/, '').split('\n');
  const rules = lines.map((line, index) => (line.trim().startsWith('─'.repeat(10)) ? index : -1)).filter((index) => index >= 0);
  if (rules.length < 2) return { free: false, reason: 'campo não reconhecido na tela' };
  const between = lines.slice(rules[rules.length - 2]! + 1, rules[rules.length - 1]).map((line) => line.replace(/ /g, ' ').trim());
  if (!between.length || !between[0]!.startsWith('❯')) return { free: false, reason: 'campo não reconhecido na tela' };
  const rest = [between[0]!.slice(1).trim(), ...between.slice(1)];
  if (rest.some((line) => line.length > 0)) return { free: false, reason: 'campo com texto (rascunho de alguém)' };
  return { free: true, reason: '' };
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

// ---- the queue ---------------------------------------------------------------------------------------------------

type SessionMood = 'parada' | 'ocupada' | 'digitando';

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** How a session signs: its role's name, else its tab's name. */
function nameOf(who: Record<string, unknown>): string {
  for (const key of ['papelNome', 'nome', 'papel'] as const) if (typeof who[key] === 'string' && who[key]) return who[key] as string;
  return 'sessão';
}

function taskIdsOf(call: LedgerToolCall): string[] | undefined {
  if (call.tool === 'tarefa_lote') return call.itens.map((item) => item.id);
  return 'id' in call && typeof call.id === 'string' && call.id ? [call.id] : undefined;
}

export function createGateRecados(deps: GateRecadosDeps): GateRecadosHandle {
  const { file, io } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] recados: ${line}`));
  const tmux = deps.tmux ?? systemRecadosTmux;
  const localSessions = deps.localSessions ?? tmuxLocalSessions;
  const transcriptHas = deps.transcriptHas ?? transcriptTailHas;
  /** What the hooks told of each session (memory only: after a restart, nothing is typed until its next turn end). */
  const moods = new Map<string, SessionMood>();
  const transcripts = new Map<string, string>();
  const enters = new Map<string, number>();
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

  /** May `from` send to `to` with no word address: an arrow of its own, the Líder of the board's reach, or the review link. */
  function linked(projectPath: string, board: MindscapeBoard, places: readonly ListedPlace[], from: string, to: string): boolean {
    if (hasArrowLink(board, from, to)) return true;
    if (isBoardOrchestrator(board, from) && canReach({ schemaVersion: 8, boards: { [projectPath]: board } }, { projectPath, placeId: from }, { projectPath, placeId: to }).ok) return true;
    const doc = ledgerDoc();
    return doc !== null && reviewLink(doc, board, places, from, to);
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
    const task = ledgerDoc()?.tasks[taskId];
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
          const path = transcripts.get(sid);
          const seen = path ? await transcriptHas(path, tagOf(item.id)) : false;
          update(
            (candidate) => candidate.id === item.id && candidate.estado === 'digitado',
            (candidate) => (seen ? { ...candidate, estado: 'entregue', via: 'transcript', entregueEm: now() } : { ...candidate, estado: 'fila' }),
          );
          enters.delete(item.id);
          // Never typed again until a new end of turn says the screen is free (it delivers it then).
          if (!seen && moods.get(sid) === 'digitando') moods.delete(sid);
          else if (seen && moods.get(sid) === 'digitando') moods.set(sid, 'ocupada');
        } else if (since >= ENTER_AGAIN_MS && (enters.get(item.id) ?? 0) < MAX_ENTERS) {
          const screen = await tmux.screen(sid);
          if (screen && !screen.inMode && fieldIsFree(screen.text).reason.startsWith('campo com texto')) {
            enters.set(item.id, (enters.get(item.id) ?? 0) + 1);
            await tmux.enter(sid);
          }
        }
      }
      // 2. Stopped sessions with something queued: typed only on a free field.
      const queued = read().filter((item) => item.estado === 'fila' && item.tentativas < MAX_TYPINGS && moods.get(item.para.sid) === 'parada');
      for (const sid of new Set(queued.map((item) => item.para.sid))) {
        const screen = await tmux.screen(sid);
        if (!screen || screen.inMode || !fieldIsFree(screen.text).free || moods.get(sid) !== 'parada') continue;
        const ids = new Set(queued.filter((item) => item.para.sid === sid).map((item) => item.id));
        // Marked BEFORE typing: a turn end in between does not deliver them a second time.
        const typed = update(
          (item) => ids.has(item.id) && item.estado === 'fila',
          (item) => ({ ...item, estado: 'digitado', tentativas: item.tentativas + 1, digitadoEm: now() }),
        );
        if (!typed.length) continue;
        moods.set(sid, 'digitando');
        const ok = await tmux.type(sid, typed.map((item) => item.texto.replace(/\s*\n\s*/g, ' ')).join('   '));
        if (!ok) {
          const back = new Set(typed.map((item) => item.id));
          update((item) => back.has(item.id) && item.estado === 'digitado', (item) => ({ ...item, estado: 'fila', tentativas: item.tentativas - 1 }));
          moods.delete(sid);
          log(`tmux recusou digitar na sessão ${sid}; fica para o fim do turno.`);
        }
      }
    } catch (error) {
      log(`laço de entrega: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      ticking = false;
    }
  }

  return {
    async enviar(sid, mine, call: SendCall): Promise<BrowserToolOutcome | 'repassar'> {
      const who = mine.quemSou;
      const board = mine.board;
      // Who the caller is, or its board, unknown here: the PC decides.
      if (typeof who.lugar !== 'string' || typeof who.pasta !== 'string' || !board) return 'repassar';
      const me = who.lugar;
      const projectPath = who.pasta;
      const places = listedPlaces(mine.listar);
      const target = resolveAddress(board, places, me, call.para);
      if ('erro' in target) return { kind: 'error', text: target.erro };
      if ('liderUnico' in target) return 'repassar';
      const word = call.para.trim().toLowerCase();
      if (word !== BOARD_LEADER && word !== MY_OPENER && !linked(projectPath, board, places, me, target.placeId))
        return {
          kind: 'error',
          text: `Sem ligação: não há seta do seu lugar (${me}) para "${target.placeId}". Peça ao dono, ou use sessao_abrir. Para o Líder do quadro, "para": "${BOARD_LEADER}"; para quem abriu você, "para": "${MY_OPENER}".`,
        };
      const targetSid = sidOfPlace(projectPath, target.placeId, await localSessions());
      if (!targetSid) return 'repassar';
      const item = enqueue({ lugar: me, nome: nameOf(who), sid }, { lugar: target.placeId, sid: targetSid }, `${call.tarefa ? `[${call.tarefa}] ` : ''}${call.texto}`);
      return {
        kind: 'text',
        text: JSON.stringify({ entregue: item.estado === 'entregue' ? 'entregue' : 'na-fila', id: item.id, para: target.placeId, como: HOW }),
      };
    },

    async antesDaTarefa(caller, mine, call) {
      const service = deps.ledger();
      if (!service) return;
      const places = listedPlaces(mine.listar);
      const closed = places.filter((place) => place.estado === 'fechada' && successorOf(mine.board, places, place.id) === caller.placeId);
      if (!closed.length) return;
      const ids = taskIdsOf(call);
      for (const place of closed) {
        const passed = await followRenewal(service, { projectPath: caller.projectPath, placeId: place.id, to: caller.placeId, ...(ids ? { ids } : {}) });
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
        moods.set(sid, 'ocupada');
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
        if (moods.get(sid) !== 'digitando') moods.set(sid, 'parada');
        return answerHook({});
      }
      moods.set(sid, 'ocupada');
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
