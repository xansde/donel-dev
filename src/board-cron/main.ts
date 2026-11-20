// Quadro de tarefas (t-1e354d15), PR 3 — the board's cron on the VPS, one self-contained Node file
// (`out/board-cron/board-cron.mjs`, board-cron.vite.config.ts). Plan: docs/design/quadro-de-tarefas.md §5–§7.
//
//   node board-cron.mjs ronda   every 15 min: lanes follow their Líder, justification cron, vigia, lanes alive, page
//   node board-cron.mjs lider   every minute: the PC's requests for a lane's Líder (board.leader_requests)
//   node board-cron.mjs semear [--seco] [--ledger <arquivo>] [--host <host>] [--pc-raiz <C:\...\seazone>]
//                               once, by hand: projects and one card per live task of the Oráculo (semente.ts), with
//                               the session of its place from the Oráculo's pictures; the Oráculo's ledger read-only;
//                               --seco prints the plan and only reads (the board too, to count the sessions it would fill)
//   node board-cron.mjs raia <projeto> <lugar> [<sessão>]
//                               by hand: the lane's Líder (touch_lane with force), for a Líder with no card_* tools;
//                               no <sessão> = the session alive here that holds the place now (as the round does)
//
// Config (nothing hardcoded: the repo goes public):
//   ~/.donel/board/sqlite.json    {file}                            the board in a SQLite of this machine (20/11)
//   ~/.donel/board/supabase.json  {url, serviceKeyFile}             only without sqlite.json; neither = the board is
//                                                                   off, the cron exits 0
//   ~/.donel/board/cron.json      {host?, vigiaSombra?, slackReader?, slackSelf?, pagina?}
//     host (default "vps-pessoal"): only the projects that run here (projects.host); another machine's sessions are
//       not in this tmux, and reading them as closed would tell the Líder something false.
//     vigiaSombra (default true): the vigia only LOGS what it would do. It runs one day beside the despertador's
//       `ronda` with the same output or better before it acts (Líder do quadro, 16/11); turning it on is a separate step.
//     slackReader: a script that prints a Slack thread with "--- <hora> <autor> (ts <epoch>)" per message (ler_fio.py);
//       missing = Slack links count only by their deadline.
//     slackSelf: the names and ids the reader shows for the account the sessions write with (a message of it is never
//       a response); missing = Slack links count only by their deadline, as without a reader.
//     pagina: folder of the page (index.html); missing = no page.
// State ~/.donel/board/estado.json (the vigia's wakes per card, busy fields in a row, and the shadow's own wakes, busy
// fields and Líder notices, so its log shows the cap, the pause and the Líder as acting would); log ~/.donel/board/cron.log.
//
// Waking a session = typing into its tmux (`tmux -L donel`, session `donel-<sid>`) only when its input field is empty,
// and confirming it in the transcript — the despertador's way (~/bin/rotinas/despertador_sessoes.py). The transcript is
// the conversation the tmux carries now (`current` in the session's folder, lider-local.ts: a resume or `/clear` moves
// it), else `<sid>.jsonl`. A notice for a lane's Líder goes to the lane's Líder alive here, else to the Líder único
// alive here (the daemon's own pick, lider-local.ts). Each round first moves every lane to the session alive here that
// holds its Líder's place now (followLanes), and a session gets at most one notice per round, with all its cards.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, rmdirSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, closeSync, renameSync, statSync, writeFileSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BoardCronStore, BoardStore, CardRow, LaneRow } from '../oraculo/board-client';
import { BOARD_SQLITE_CONFIG, chooseBoard, createBoardSqlite, openBoard } from '../oraculo/board-sqlite';
import { countSessionFills, planSeed, readDeskStates, readLedgerReadOnly, readPictures, runSeed, sessionResolver, type DeskState } from './semente';
import { afterBusyField, fieldHoldsOnlyNotice, fieldIsFree, fieldTextOf, followLaneLeaders, groupNotices, LABEL, linkKind, othersOnGithub, othersOnSlack, pickLeader, planJustify, planVigia, responseSince, withShadowNotice, type CronAction, type CronCard, type GithubReading, type SessionState, type ShadowNotice } from '../shared/board/cron';
import { currentConversation, pickLocalLeader, readLeaderMeta } from '../oraculo/lider-local';
import type { BoardPicture } from '../oraculo/portao';
import { renderBoardPage } from '../shared/board/page';

const HOME = homedir();
/** The board's folder (config, state, log); another one only for a dry run on a copy (DONEL_BOARD_DIR). */
const DIR = process.env.DONEL_BOARD_DIR || join(HOME, '.donel', 'board');
const LOG = join(DIR, 'cron.log');
const STATE = join(DIR, 'estado.json');
/** The tmux socket of the Donel's sessions; another one only in the end-to-end test. */
const SOCKET = process.env.DONEL_TMUX_SOCKET || 'donel';
const LEADER_ALIVE_MS = 30 * 60 * 1000;
const ORACULO_DIR = process.env.DONEL_ORACULO_DIR || join(HOME, '.donel', 'oraculo');
const SESSIONS_DIR = process.env.DONEL_SESSIONS_DIR || join(HOME, '.donel', 's');
const LEDGER_FILE = join(ORACULO_DIR, 'ledger.sqlite');
const LABEL_ASCII = LABEL.slice(0, LABEL.indexOf(' ·'));

interface CronConfig {
  readonly host: string;
  readonly vigiaSombra: boolean;
  readonly slackReader?: string;
  readonly slackSelf?: readonly string[];
  readonly pagina?: string;
}

function readCronConfig(): CronConfig {
  try {
    const raw = JSON.parse(readFileSync(join(DIR, 'cron.json'), 'utf8')) as Record<string, unknown>;
    return {
      host: typeof raw.host === 'string' && raw.host ? raw.host : 'vps-pessoal',
      vigiaSombra: raw.vigiaSombra !== false,
      ...(typeof raw.slackReader === 'string' && raw.slackReader ? { slackReader: raw.slackReader } : {}),
      ...(Array.isArray(raw.slackSelf) && raw.slackSelf.some((name) => typeof name === 'string' && name.trim()) ? { slackSelf: raw.slackSelf.filter((name): name is string => typeof name === 'string') } : {}),
      ...(typeof raw.pagina === 'string' && raw.pagina ? { pagina: raw.pagina } : {}),
    };
  } catch {
    return { host: 'vps-pessoal', vigiaSombra: true };
  }
}

function log(line: string): void {
  const out = `${new Date().toISOString()} ${line}`;
  console.log(out);
  try {
    appendFileSync(LOG, `${out}\n`);
  } catch {
    // stdout (the crontab's log) still has it
  }
}

/**
 * What the runner remembers per card between rounds: the vigia's wakes (cap and pause), busy fields in rounds in a
 * row, and when the Líder last heard of a busy field (its own mark: the card's `leader_noticed_at` belongs to the
 * once-per-stage notices).
 */
interface Memory {
  wakes: Record<string, number[]>;
  busy: Record<string, number>;
  busyHeard: Record<string, number>;
}

interface State extends Memory {
  /** The vigia in shadow: what it would have done, kept apart so turning the shadow off starts from a clean count. */
  sombra: Memory & { leader: Record<string, ShadowNotice> };
}

// The state file is ours, but a hand edit or a cut write must not stop every round: keep only well-typed entries.
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function entries<T>(value: unknown, keep: (item: unknown) => item is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (isObject(value)) for (const [key, item] of Object.entries(value)) if (keep(item)) out[key] = item;
  return out;
}

const isTimes = (value: unknown): value is number[] => Array.isArray(value) && value.every(isTime);
const isNotice = (value: unknown): value is ShadowNotice => isObject(value) && isTime(value.at) && isTime(value.stageSince);

function readMemory(raw: unknown): Memory {
  const memory = isObject(raw) ? raw : {};
  return { wakes: entries(memory.wakes, isTimes), busy: entries(memory.busy, isTime), busyHeard: entries(memory.busyHeard, isTime) };
}

function readState(): State {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    // missing or cut: start clean
  }
  const sombra = isObject(raw) ? raw.sombra : undefined;
  return { ...readMemory(raw), sombra: { ...readMemory(sombra), leader: entries(isObject(sombra) ? sombra.leader : undefined, isNotice) } };
}

function writeState(state: State, now: number, live: ReadonlySet<string>): void {
  for (const memory of [state, state.sombra]) {
    for (const [card, list] of Object.entries(memory.wakes)) {
      const kept = list.filter((at) => now - at < 24 * 60 * 60 * 1000);
      if (kept.length) memory.wakes[card] = kept;
      else delete memory.wakes[card];
    }
    // a card no longer in Fazendo/Travado has nothing to count
    for (const card of Object.keys(memory.busy)) if (!live.has(card)) delete memory.busy[card];
    for (const card of Object.keys(memory.busyHeard)) if (!live.has(card)) delete memory.busyHeard[card];
  }
  for (const card of Object.keys(state.sombra.leader)) if (!live.has(card)) delete state.sombra.leader[card];
  writeFileSync(`${STATE}.tmp`, JSON.stringify(state));
  renameSync(`${STATE}.tmp`, STATE);
}

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

// --- sessions ------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f-]{8,64}$/i;

function tmux(args: readonly string[]): { ok: boolean; out: string } {
  const r = spawnSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', timeout: 10_000 });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

function transcriptOf(uuid: string): string | null {
  const root = join(HOME, '.claude', 'projects');
  const conversation = currentConversation(SESSIONS_DIR, uuid) ?? uuid;
  let best: { path: string; at: number } | null = null;
  try {
    for (const dir of readdirSync(root)) {
      const path = join(root, dir, `${conversation}.jsonl`);
      if (!existsSync(path)) continue;
      const at = statSync(path).mtimeMs;
      if (!best || at > best.at) best = { path, at };
    }
  } catch {
    return null;
  }
  return best?.path ?? null;
}

function tail(path: string, bytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Since when the conversation is idle: its last main entry is the assistant's finished turn (end_turn, as the
 * despertador's `ronda`). A tool call still running, a turn not finished or a user line not answered = null (busy or
 * unknown: never woken by the vigia).
 */
function idleSince(uuid: string): number | null {
  const path = transcriptOf(uuid);
  if (!path) return null;
  const lines = tail(path, 400_000).split('\n').reverse();
  for (const line of lines) {
    let entry: { type?: string; isSidechain?: boolean; isApiErrorMessage?: boolean; timestamp?: string; message?: { stop_reason?: string | null } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a cut line at the start of the tail
    }
    if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isSidechain) continue;
    if (entry.type !== 'assistant' || entry.isApiErrorMessage || !entry.timestamp) return null;
    const stop = entry.message?.stop_reason;
    return stop === 'end_turn' || stop === 'stop_sequence' || stop === null || stop === undefined ? Date.parse(entry.timestamp) : null;
  }
  return null;
}

function sessionState(uuid: string | null): SessionState | null {
  if (!uuid || !UUID.test(uuid)) return null;
  return { alive: tmux(['has-session', '-t', `donel-${uuid}`]).ok, idleSince: idleSince(uuid) };
}

function fieldFree(uuid: string): { free: boolean; why: string } {
  const target = `donel-${uuid}`;
  const mode = tmux(['display', '-p', '-t', target, '#{pane_in_mode}']);
  if (!mode.ok) return { free: false, why: 'tmux não respondeu' };
  if (!['', '0'].includes(mode.out.trim())) return { free: false, why: 'tela em modo cópia' };
  return fieldIsFree(tmux(['capture-pane', '-e', '-p', '-t', target]).out);
}

/**
 * One writer at a time per session among this cron's modes (ronda every 15 min and lider every minute run under different flocks): a
 * directory made atomically, left behind only by a crash and then taken after 2 min. The despertador has no such lock;
 * its own check of the field is what keeps the two apart.
 */
const TYPING_LOCK_MS = 2 * 60 * 1000;

/** Another mode is typing into this session now (the lock below); the shadow reads it without taking it. */
function typingLocked(uuid: string): boolean {
  try {
    return Date.now() - statSync(join(DIR, 'digitando', uuid)).mtimeMs < TYPING_LOCK_MS;
  } catch {
    return false;
  }
}

function withTypingLock<T>(uuid: string, run: () => T): T | 'ocupado' {
  const dir = join(DIR, 'digitando', uuid);
  mkdirSync(join(DIR, 'digitando'), { recursive: true });
  try {
    mkdirSync(dir);
  } catch {
    try {
      if (Date.now() - statSync(dir).mtimeMs < TYPING_LOCK_MS) return 'ocupado';
    } catch {
      return 'ocupado';
    }
  }
  try {
    return run();
  } finally {
    try {
      rmdirSync(dir);
    } catch {
      // gone already
    }
  }
}

/** Checks the field and types; 'campo: …' when it was not free (nothing typed). */
function wakeSession(uuid: string, text: string): 'enviado' | 'nao-confirmado' | `campo: ${string}` {
  const result = withTypingLock(uuid, () => {
    const field = fieldFree(uuid);
    if (!field.free) return `campo: ${field.why}` as const;
    return typeInto(uuid, text);
  });
  return result === 'ocupado' ? 'campo: outro aviso sendo digitado' : result;
}

/** Types into the session and confirms it in the transcript, as the despertador does. */
function typeInto(uuid: string, text: string): 'enviado' | 'nao-confirmado' {
  const target = `donel-${uuid}`;
  const path = transcriptOf(uuid);
  const before = path ? statSync(path).size : 0;
  // Card text (title, justification, link) comes from sessions: a \r would send the notice cut in half, and \x03/\x1b
  // would reach the screen as Ctrl+C/Esc. Typed literally, control characters become spaces.
  const safe = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  if (!tmux(['send-keys', '-t', target, '-l', safe]).ok) return 'nao-confirmado';
  pause(400);
  if (!tmux(['send-keys', '-t', target, 'Enter']).ok) return 'nao-confirmado';
  const landed = (): boolean => {
    const file = path ?? transcriptOf(uuid);
    if (!file) return false;
    try {
      const size = statSync(file).size;
      if (size <= before) return false;
      // the ASCII start of the label: a transcript may write the "·" escaped (\u00b7)
      return tail(file, size - before).includes(LABEL_ASCII);
    } catch {
      return false;
    }
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let i = 0; i < (attempt === 0 ? 20 : 8); i++) {
      pause(1000);
      if (landed()) return 'enviado';
    }
    if (attempt === 3) break;
    // a long text becomes "[Pasted text #N]" and the Enter right after it is sometimes lost: Enter again, never the text
    const field = fieldFree(uuid);
    if (field.free || !field.why.startsWith('campo com texto')) break;
    tmux(['send-keys', '-t', target, 'Enter']);
  }
  if (landed()) return 'enviado';
  // Caixa pendurada (19/11): what this cron typed never stays in the field, or every later wake (and the Oráculo's
  // recados) finds it busy for good. Cleared only when the field holds nothing but this notice (its text, or the one
  // paste placeholder of a long one: the field was empty when it typed, under the typing lock); someone's draft, or
  // what the owner wrote or pasted after it, stays.
  const left = fieldTextOf(tmux(['capture-pane', '-e', '-p', '-t', target]).out);
  if (left && fieldHoldsOnlyNotice(left, safe)) tmux(['send-keys', '-t', target, 'C-u']);
  return 'nao-confirmado';
}

// --- links ---------------------------------------------------------------------------------------------------

function ghJson(path: string): unknown {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`gh api ${path}: ${(r.stderr ?? '').trim().slice(0, 160)}`);
  return JSON.parse(r.stdout || 'null');
}

/** The gh account of this machine (the one the sessions comment with), read once per run; null = gh not logged in. */
let ghSelf: string | null | undefined;
function ghLogin(): string | null {
  if (ghSelf !== undefined) return ghSelf;
  const r = spawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8', timeout: 30_000 });
  const login = r.status === 0 ? (r.stdout ?? '').trim() : '';
  ghSelf = /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null;
  if (!ghSelf) log('gh sem conta: link do GitHub conta só pelo prazo nesta ronda');
  return ghSelf;
}

/**
 * Something new on the link after `since` that someone other than this machine's own account did (design §5): true or
 * false; null when the link cannot be read (only the deadline counts).
 */
function responded(link: string, since: number, config: CronConfig): boolean | null {
  const kind = linkKind(link);
  try {
    if (kind.kind === 'github') {
      const self = ghLogin();
      if (!self) return null;
      const base = `repos/${kind.owner}/${kind.repo}`;
      const sinceIso = new Date(since).toISOString();
      const reading: GithubReading = {
        comments: ghJson(`${base}/issues/${kind.number}/comments?since=${encodeURIComponent(sinceIso)}&per_page=100`) as GithubReading['comments'],
        issue: ghJson(`${base}/issues/${kind.number}`) as GithubReading['issue'],
        ...(kind.type === 'pull'
          ? { pull: ghJson(`${base}/pulls/${kind.number}`) as GithubReading['pull'], reviews: ghJson(`${base}/pulls/${kind.number}/reviews?per_page=100`) as GithubReading['reviews'] }
          : {}),
      };
      return othersOnGithub(reading, self, since);
    }
    if (kind.kind === 'slack' && config.slackReader && config.slackSelf) {
      const r = spawnSync('python3', ['-I', config.slackReader, link], { encoding: 'utf8', timeout: 300_000 });
      if (r.status !== 0) return null;
      // not a thread: the reader shows the channel around the message, and any of it would read as a response
      if ((r.stderr ?? '').includes('não um fio')) return null;
      return othersOnSlack(r.stdout ?? '', config.slackSelf, since);
    }
  } catch (error) {
    log(`link sem leitura (${link}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return null;
}

// --- cards ---------------------------------------------------------------------------------------------------

const ms = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) : null);

function cronCard(row: CardRow, desk?: DeskState): CronCard {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    stageSince: Date.parse(row.stage_since),
    placeId: row.place_id,
    version: row.version,
    title: row.title,
    sessionId: row.session_id,
    ...(row.justification && row.justification_link && row.justification_due
      ? { justification: { text: row.justification, link: row.justification_link, due: Date.parse(row.justification_due) } }
      : {}),
    wokenAt: ms(row.woken_at),
    chargedAt: ms(row.charged_at),
    chargeCount: row.charge_count ?? 0,
    leaderNoticedAt: ms(row.leader_noticed_at),
    justifiedAt: ms(row.justified_at),
    ...(desk ? { desk } : {}),
  };
}

type Client = BoardStore & BoardCronStore;

/** What typing into a session would do, read only (the shadow): the same checks as `wakeSession`, nothing typed. */
function wouldWake(uuid: string): 'campo livre' | `campo: ${string}` {
  if (typingLocked(uuid)) return 'campo: outro aviso sendo digitado';
  const field = fieldFree(uuid);
  return field.free ? 'campo livre' : `campo: ${field.why}`;
}

/** The live Donel sessions of this machine's tmux (`donel-<sid>`); null when tmux did not answer. */
function liveSessions(): Set<string> | null {
  const r = tmux(['ls', '-F', '#{session_name}']);
  if (!r.ok) return null;
  return new Set(r.out.split('\n').flatMap((name) => (name.startsWith('donel-') ? [name.slice('donel-'.length)] : [])));
}

/** The Líder único alive in this machine's tmux (the daemon's own pick, lider-local.ts); null = none. */
function leaderOfAllHere(now: number): string | null {
  const live = liveSessions();
  if (!live) return null;
  let picture: BoardPicture | null = null;
  try {
    picture = JSON.parse(readFileSync(join(ORACULO_DIR, 'retrato.json'), 'utf8')) as BoardPicture;
  } catch {
    // no picture: the folder's mark alone counts
  }
  return pickLocalLeader(live, picture, (sid) => readLeaderMeta(SESSIONS_DIR, sid), now)?.sid ?? null;
}

/** What a round knows once: the lanes, and the Líder único here (read only when a notice needs him). */
interface RoundLeaders {
  readonly lanes: readonly LaneRow[];
  leaderOfAll(): string | null;
}

/**
 * The lanes' Líder follows its place (devolução do Revisor, 20/11): the place's session alive in this machine's tmux,
 * by the seed's own resolver (`sessionResolver`) over the pictures, with the liveness test; the lane `lider`, the
 * Líder único alive here (the daemon's pick). A session of another machine (`portoes-retrato/*.json`) is never in this
 * tmux, so it never resolves: the notice goes only to a session this cron can type into, and the lane of a Líder on
 * another machine keeps what it has (the reserve). Nothing resolves = the lane keeps its session, as before.
 */
async function followLanes(client: Client, lanes: readonly LaneRow[], leaderOfAll: () => string | null): Promise<LaneRow[]> {
  const live = liveSessions();
  if (!live) return [...lanes];
  const sessionOf = sessionResolver(readPictures(ORACULO_DIR), (sid) => live.has(sid));
  const out = [...lanes];
  for (const follow of followLaneLeaders(lanes, sessionOf, leaderOfAll)) {
    try {
      await client.touchLane(follow.project, follow.place, follow.session, true);
      const at = out.findIndex((lane) => lane.project_id === follow.project);
      out[at] = { ...out[at]!, leader_session: follow.session, leader_seen_at: new Date().toISOString() };
      log(`raia ${follow.project}: Líder ${follow.place} agora na sessão ${follow.session} (era ${follow.was ?? 'nenhuma'})`);
    } catch (error) {
      log(`raia ${follow.project}: Líder ${follow.place} não gravado (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return out;
}

/** A notice planned for one card this round, before the one per session goes out. */
interface Notice {
  readonly card: CronCard;
  readonly action: Extract<CronAction, { do: 'wake' | 'leader' }>;
  readonly who: 'vigia' | 'justificativa';
  readonly shadow: boolean;
  readonly session: string;
  /** What the log says of this card (who is told and why). */
  readonly says: string;
}

/** Who hears a card's action; null when nobody can (logged, nothing marked: the next round tries again). */
function addressee(leaders: RoundLeaders, card: CronCard, action: CronAction, who: Notice['who'], shadow: boolean): Notice | null {
  if (action.do === 'skip') return null;
  const tag = shadow ? '[sombra] ' : '';
  if (action.do === 'wake') return { card, action, who, shadow, session: action.session, says: `${tag}${who}: ${shadow ? 'acordaria' : 'acordar'} a sessão ${action.session} (cartão ${card.id}, ${action.mark})` };
  const lane = leaders.lanes.find((l) => l.project_id === card.projectId);
  const alive = (sid: string): boolean => UUID.test(sid) && tmux(['has-session', '-t', `donel-${sid}`]).ok;
  const pick = pickLeader(lane, alive, leaders.leaderOfAll());
  // "sessão <uuid> fechada; …": the vigia does not reopen a session itself (cron.ts), the Líder does.
  const closed = action.closed ? `sessão ${action.closed} fechada; ` : '';
  if (pick.kind === 'none') {
    log(`${tag}${who}: ${closed}cartão ${card.id} precisa do Líder, mas a raia ${card.projectId} está sem Líder aberto aqui (${pick.why}) e o Líder único não está aberto aqui`);
    return null;
  }
  const leaderName = pick.kind === 'lane' ? `o Líder ${pick.place} da raia ${card.projectId}` : `o Líder único (${pick.why})`;
  const busyField = action.via === 'busy';
  const says = `${tag}${who}: ${closed}${shadow ? 'avisaria' : 'avisar'} ${leaderName}, sessão ${pick.session} (cartão ${card.id}${busyField ? ', campo ocupado' : ''}${action.why ? `: ${action.why}` : ''})${shadow && who === 'vigia' ? ' e gravaria a nota no cartão' : ''}`;
  return { card, action, who, shadow, session: pick.session, says };
}

/**
 * One notice per session in a round (devolução de 20/11: three cards of one session were three notices in a row). The
 * real ones and the shadow's go apart (one types, the other only logs); each session is tried once, so a busy field's
 * escalation to a Líder already tried this round waits for the next one (its busy count holds). Each card keeps its
 * own marks: woken/charged, the Líder's notice, the vigia's wakes, the busy count and the vigia's note.
 */
async function dispatch(client: Client, leaders: RoundLeaders, notices: readonly Notice[], state: State, now: number, tried: Set<string>): Promise<void> {
  const escalations: Notice[] = [];
  for (const shadow of [false, true]) {
    for (const group of groupNotices(notices.filter((n) => n.shadow === shadow), (n) => n.session, (n) => n.action.text)) {
      const tag = shadow ? '[sombra] ' : '';
      for (const notice of group.items) log(notice.says);
      const key = `${shadow}|${group.session}`;
      if (tried.has(key)) {
        log(`${tag}sessão ${group.session} já ${shadow ? 'receberia' : 'recebeu'} aviso nesta ronda; ${group.items.map((n) => n.card.id).join(', ')} fica para a próxima`);
        continue;
      }
      tried.add(key);
      const result = shadow ? wouldWake(group.session) : wakeSession(group.session, group.text);
      const cards = group.items.map((n) => n.card.id);
      log(`${tag}${shadow ? 'acordaria' : 'acordou'} a sessão ${group.session} (${cards.length === 1 ? 'cartão' : 'cartões'} ${cards.join(', ')}): ${result}`);
      for (const notice of group.items) {
        try {
          const next = await settle(client, leaders, notice, result, state, now);
          if (next) escalations.push(next);
        } catch (error) {
          log(`cartão ${notice.card.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  if (escalations.length) await dispatch(client, leaders, escalations, state, now, tried);
}

/** The marks of one card after its session's notice; a busy field's escalation to the Líder, when it is due. */
async function settle(client: Client, leaders: RoundLeaders, notice: Notice, result: string, state: State, now: number): Promise<Notice | null> {
  const { card, action, who, shadow } = notice;
  const memory: Memory = shadow ? state.sombra : state;
  const typed = !result.startsWith('campo:');
  if (action.do === 'wake') {
    if (!typed) {
      // Nothing typed and nothing marked. From BUSY_MAX rounds in a row on, the Líder hears it; the count goes back to
      // zero only when the Líder did (closed or busy, the next round tries again).
      const busy = (memory.busy[card.id] ?? 0) + 1;
      memory.busy[card.id] = busy;
      const next = afterBusyField(card, busy, result.slice('campo: '.length), memory.busyHeard[card.id] ?? null, now);
      if (next.do === 'skip') {
        log(`${shadow ? '[sombra] ' : ''}${who}: cartão ${card.id}: ${next.why}`);
        return null;
      }
      return addressee(leaders, card, next, who, shadow);
    }
    delete memory.busy[card.id];
    // Typed counts even unconfirmed (the text is on the screen): the cap and the pause must hold, as in the despertador.
    // The local cap first: it holds even if the mark below fails.
    if (who === 'vigia') memory.wakes[card.id] = [...(memory.wakes[card.id] ?? []), now];
    if (!shadow) await client.markCron(card.id, action.mark);
    return null;
  }
  if (!typed) return null;
  const busyField = action.via === 'busy';
  if (busyField) {
    delete memory.busy[card.id];
    memory.busyHeard[card.id] = now;
  }
  if (shadow) {
    if (!busyField) state.sombra.leader[card.id] = { at: now, stageSince: card.stageSince };
    return null;
  }
  // A busy field keeps its own mark (busyHeard above): leader_noticed_at would silence the once-per-stage notices.
  if (!busyField) await client.markCron(card.id, 'leader');
  // Design §6: the card itself says why the Líder was called (board.vigia_note: the vigia is not the card's place).
  if (who === 'vigia') {
    const written = await client.vigiaNote(card.id, busyField ? 'parado sem justificativa; aviso à sessão não entrou (campo ocupado); Líder do quadro avisado' : 'parado sem justificativa; Líder do quadro avisado');
    log(`vigia: nota no cartão ${card.id}: ${written ? 'gravada' : 'não gravada (saiu de Fazendo ou ganhou justificativa)'}`);
  }
  return null;
}

/** Lanes whose Líder is alive in tmux and had a turn in the last 30 min stay alive in `board.lanes`. */
async function touchLiveLeaders(client: Client, lanes: readonly LaneRow[], now: number): Promise<void> {
  for (const lane of lanes) {
    if (!lane.leader_place || !lane.leader_session || !UUID.test(lane.leader_session)) continue;
    const session = sessionState(lane.leader_session);
    // open and busy (no finished turn yet) is alive too; open and idle counts if it worked in the last 30 min
    if (session?.alive && (session.idleSince === null || now - session.idleSince < LEADER_ALIVE_MS)) {
      await client.touchLane(lane.project_id, lane.leader_place, lane.leader_session);
    }
  }
}

/** The Oráculo's state of the cards' tasks, read-only; unreadable = none (the vigia then judges by the card alone). */
function deskStates(rows: readonly CardRow[]): Map<string, DeskState> {
  const ids = rows.flatMap((row) => (row.stage === 'doing' && row.oraculo_id ? [row.oraculo_id] : []));
  try {
    return readDeskStates(LEDGER_FILE, ids);
  } catch (error) {
    log(`Oráculo sem leitura (${error instanceof Error ? error.message : String(error)}): o vigia não sabe o que espera aceite`);
    return new Map();
  }
}

async function ronda(client: Client, config: CronConfig): Promise<void> {
  const now = Date.now();
  const state = readState();
  const [rows, storedLanes] = await Promise.all([client.parkedOrDoing(config.host), client.lanes(config.host)]);
  const desk = deskStates(rows);
  let leaderOfAll: string | null | undefined;
  const leaderOfAllOnce = (): string | null => (leaderOfAll === undefined ? (leaderOfAll = leaderOfAllHere(now)) : leaderOfAll);
  const lanes = await followLanes(client, storedLanes, leaderOfAllOnce);
  const leaders: RoundLeaders = { lanes, leaderOfAll: leaderOfAllOnce };
  let woke = 0;
  const notices: Notice[] = [];
  for (const row of rows) {
    const card = cronCard(row, row.oraculo_id ? desk.get(row.oraculo_id) : undefined);
    try {
      if (card.justification) {
        const session = sessionState(card.sessionId);
        const answer = now < card.justification.due ? responded(card.justification.link, responseSince(card), config) : null;
        const action = planJustify(card, answer, session, now);
        // "rounds in a row": a round with nothing to type (working, waiting, pause) breaks the busy streak
        if (action.do === 'skip') delete state.busy[card.id];
        else woke++;
        const notice = addressee(leaders, card, action, 'justificativa', false);
        if (notice) notices.push(notice);
      } else {
        const shadow = config.vigiaSombra;
        const view = shadow ? withShadowNotice(card, state.sombra.leader[card.id]) : card;
        const memory = shadow ? state.sombra : state;
        const action = planVigia(view, sessionState(card.sessionId), memory.wakes[card.id] ?? [], now);
        if (action.do === 'skip') delete memory.busy[card.id];
        else woke++;
        if (action.do === 'skip' && action.why.startsWith('entregue')) log(`${shadow ? '[sombra] ' : ''}vigia: cartão ${card.id} ${action.why}; não é parado`);
        const notice = addressee(leaders, view, action, 'vigia', shadow);
        if (notice) notices.push(notice);
      }
    } catch (error) {
      log(`cartão ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await dispatch(client, leaders, notices, state, now, new Set());
  writeState(state, now, new Set(rows.map((row) => row.id)));
  await touchLiveLeaders(client, lanes, now);
  if (config.pagina) {
    const [overview, cards] = await Promise.all([client.overview(), client.pageCards()]);
    mkdirSync(config.pagina, { recursive: true });
    const file = join(config.pagina, 'index.html');
    writeFileSync(`${file}.tmp`, renderBoardPage(overview, cards, now));
    renameSync(`${file}.tmp`, file);
  }
  log(`ronda: ${rows.length} cartões em Fazendo/Travado, ${woke} com ação${config.vigiaSombra ? ' (vigia em sombra)' : ''}`);
}

async function lider(client: Client, config: CronConfig): Promise<void> {
  const requests = await client.pendingLeaderRequests(config.host);
  if (requests.length === 0) return;
  // the request goes to the lane's Líder where he runs now (followLanes), not to a session he left
  const lanes = await followLanes(client, await client.lanes(config.host), () => leaderOfAllHere(Date.now()));
  for (const request of requests) {
    const lane = lanes.find((l) => l.project_id === request.project_id);
    const leader = lane?.leader_session && UUID.test(lane.leader_session) ? lane.leader_session : null;
    if (!lane?.leader_place || !leader) {
      await client.resolveLeaderRequest(request.id, 'failed', 'a raia não tem Líder conhecido (nenhum touch_lane)');
      log(`lider: pedido ${request.id} (${request.project_id}): raia sem Líder conhecido`);
      continue;
    }
    if (!tmux(['has-session', '-t', `donel-${leader}`]).ok) {
      await client.resolveLeaderRequest(request.id, 'failed', `a sessão do Líder ${lane.leader_place} está fechada; reabrir sem o app ainda não existe`);
      log(`lider: pedido ${request.id} (${request.project_id}): sessão do Líder fechada`);
      continue;
    }
    const result = wakeSession(leader, `${LABEL} O ${request.actor} pediu o Líder da raia ${request.project_id}. Veja a Entrada e o que espera por você no quadro (card_list).`);
    if (result.startsWith('campo:')) {
      // alive and busy: try again next minute, but do not hold the request forever
      if (Date.now() - Date.parse(request.created_at) > 10 * 60 * 1000) {
        await client.resolveLeaderRequest(request.id, 'done', `Líder aberto e ocupado (${result})`);
        log(`lider: pedido ${request.id} (${request.project_id}): Líder aberto e ocupado há 10 min; dado como atendido`);
      }
      continue;
    }
    // typed (confirmed or not): answered, so it is not typed again every minute
    await client.resolveLeaderRequest(request.id, 'done', result === 'enviado' ? 'Líder acordado' : 'aviso digitado; não confirmado no transcript');
    log(`lider: pedido ${request.id} (${request.project_id}): ${result}`);
  }
}

/** The value after `--flag`, if any. */
const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};

/** `semear`: needs the SQLite board (the Supabase one is seeded by its own SQL, never from here). */
async function semear(boardFile: string | null): Promise<number> {
  const ledgerFile = argOf('--ledger') ?? join(process.env.DONEL_ORACULO_DIR || join(HOME, '.donel', 'oraculo'), 'ledger.sqlite');
  const pcRoot = argOf('--pc-raiz');
  const pictures = readPictures(ORACULO_DIR);
  const plan = planSeed(readLedgerReadOnly(ledgerFile), { host: argOf('--host') ?? readCronConfig().host, vpsHome: HOME, ...(pcRoot ? { pcRoot } : {}), sessionOf: sessionResolver(pictures) });
  const byStage = plan.cards.reduce<Record<string, number>>((acc, card) => ({ ...acc, [card.stage]: (acc[card.stage] ?? 0) + 1 }), {});
  if (process.argv.includes('--seco')) {
    for (const project of plan.projects) console.log(`projeto ${project.id} (${project.name}, ${project.host}): ${project.aliases.join(' | ')}`);
    for (const card of plan.cards) console.log(`cartão ${card.taskId} → ${card.projectId} ${card.stage}${card.place ? ` ${card.place}` : ''}${card.session ? ` sessão ${card.session}` : ''}${card.front ? ` [${card.front}]` : ''}: ${card.title} — ${card.note}`);
    // read-only: which cards already on the board would get their session now
    const fills = boardFile && existsSync(boardFile) ? countSessionFills(boardFile, plan) : null;
    if (fills) for (const fill of fills) console.log(`ganharia sessão: ${fill.cardId} (${fill.taskId}, ${fill.stage}, ${fill.place}) → ${fill.session}`);
    const withSession = plan.cards.filter((card) => card.session);
    console.log(
      JSON.stringify({
        seco: true,
        ledger: ledgerFile,
        retratos: pictures.length,
        projetos: plan.projects.length,
        cartoes: plan.cards.length,
        porColuna: byStage,
        comSessao: withSession.length,
        comSessaoEmFazendo: withSession.filter((card) => card.stage === 'doing').length,
        ganhariamSessao: fills ? fills.length : '(quadro não lido)',
        ganhariamSessaoEmFazendo: fills ? fills.filter((fill) => fill.stage === 'doing').length : '(quadro não lido)',
        deFora: plan.skipped,
        quadro: boardFile ?? '(sem sqlite.json)',
      }),
    );
    return 0;
  }
  if (!boardFile) {
    console.error(`[semear] sem ${join(DIR, BOARD_SQLITE_CONFIG)} válido: a semente só grava no quadro em SQLite. Rode com --seco para ver o plano.`);
    return 1;
  }
  const store = createBoardSqlite(boardFile);
  try {
    const result = await runSeed(store, plan, (line) => console.log(line));
    console.log(JSON.stringify({ ledger: ledgerFile, quadro: boardFile, ...result, porColuna: byStage, deFora: plan.skipped }));
  } finally {
    store.close();
  }
  return 0;
}

const PLACE = /^(?:place|session):[A-Za-z0-9-]{1,64}$/;

/**
 * `raia <projeto> <lugar> [<sessão>]`: the lane's Líder, as the daemon does for a Líder who uses the card_* tools
 * (touch_lane with force: he takes the lane at once, and a new Líder never inherits the previous one's session). For a
 * Líder with no card_* tools (the Líder único, a Líder on another machine). `lider` = the Líder único's own name.
 */
async function raia(boardFile: string | null): Promise<number> {
  const [project, place, session] = process.argv.slice(3);
  if (!project || !place || (place !== 'lider' && !PLACE.test(place)) || (session !== undefined && !UUID.test(session))) {
    console.error('uso: board-cron.mjs raia <projeto> <place:…|session:…|lider> [<sessão uuid>]');
    return 2;
  }
  if (!boardFile) {
    console.error(`[raia] sem ${join(DIR, BOARD_SQLITE_CONFIG)} válido: as raias moram no quadro em SQLite.`);
    return 1;
  }
  // No session given: the one alive here that holds the place now (the round's own resolution, followLanes).
  let resolved = session;
  if (resolved === undefined) {
    const live = liveSessions();
    const [follow] = live ? followLaneLeaders([{ project_id: project, leader_place: place, leader_session: null }], sessionResolver(readPictures(ORACULO_DIR), (sid) => live.has(sid)), () => leaderOfAllHere(Date.now())) : [];
    resolved = follow?.session;
  }
  const store = createBoardSqlite(boardFile);
  try {
    await store.touchLane(project, place, resolved, true);
    const lane = await store.laneOf(project);
    const alive = lane?.leader_session ? (tmux(['has-session', '-t', `donel-${lane.leader_session}`]).ok ? 'aberta aqui' : 'fechada aqui') : 'sem sessão';
    console.log(JSON.stringify({ raia: lane, sessao: alive }));
  } finally {
    store.close();
  }
  return 0;
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode !== 'ronda' && mode !== 'lider' && mode !== 'semear' && mode !== 'raia') {
    console.error('uso: board-cron.mjs ronda|lider|semear [--seco]|raia <projeto> <lugar> [<sessão>]');
    return 2;
  }
  const choice = chooseBoard({ sqliteConfig: process.env.DONEL_BOARD_SQLITE_CONFIG || join(DIR, BOARD_SQLITE_CONFIG), supabaseConfig: process.env.DONEL_BOARD_CONFIG || join(DIR, 'supabase.json') });
  if (choice.kind === 'invalid') {
    console.error(`[quadro] ${choice.file} existe mas é inválido: precisa de ${choice.expected}`);
    return 1;
  }
  if (mode === 'semear') return semear(choice.kind === 'sqlite' ? choice.file : null);
  if (mode === 'raia') return raia(choice.kind === 'sqlite' ? choice.file : null);
  if (choice.kind === 'off') return 0; // the board is off: nothing touched
  mkdirSync(DIR, { recursive: true });
  const client = openBoard(choice);
  const config = readCronConfig();
  try {
    if (mode === 'ronda') await ronda(client, config);
    else await lider(client, config);
  } finally {
    client.close?.();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    log(`erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
