// Quadro de tarefas (t-1e354d15), PR 3 — the board's cron on the VPS, one self-contained Node file
// (`out/board-cron/board-cron.mjs`, board-cron.vite.config.ts). Plan: docs/design/quadro-de-tarefas.md §5–§7.
//
//   node board-cron.mjs ronda   every 15 min: justification cron, vigia, lanes alive, page
//   node board-cron.mjs lider   every minute: the PC's requests for a lane's Líder (board.leader_requests)
//
// Config (nothing hardcoded: the repo goes public):
//   ~/.donel/board/supabase.json  {url, serviceKeyFile}             missing = the board is off, the cron exits 0
//   ~/.donel/board/cron.json      {host?, vigiaSombra?, slackReader?, pagina?}
//     host (default "vps-pessoal"): only the projects that run here (projects.host); another machine's sessions are
//       not in this tmux, and reading them as closed would tell the Líder something false.
//     vigiaSombra (default true): the vigia only LOGS what it would do. It runs one day beside the despertador's
//       `ronda` with the same output or better before it acts (Líder do quadro, 16/11); turning it on is a separate step.
//     slackReader: a script that prints a Slack thread with "(ts <epoch>)" per message (ler_fio.py); missing = Slack
//       links count only by their deadline.
//     pagina: folder of the page (index.html); missing = no page.
// State ~/.donel/board/estado.json (the vigia's wakes per card, busy fields in a row, and the shadow's own wakes, busy
// fields and Líder notices, so its log shows the cap, the pause and the Líder as acting would); log ~/.donel/board/cron.log.
//
// Waking a session = typing into its tmux (`tmux -L donel`, session `donel-<conversation>`) only when its input field
// is empty, and confirming it in the transcript — the despertador's way (~/bin/rotinas/despertador_sessoes.py).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, rmdirSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, closeSync, renameSync, statSync, writeFileSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createBoardClient, readBoardConfig, type CardRow, type LaneRow } from '../oraculo/board-client';
import { afterBusyField, fieldIsFree, LABEL, linkKind, planJustify, planVigia, responseSince, withShadowNotice, type CronAction, type CronCard, type SessionState, type ShadowNotice } from '../shared/board/cron';
import { renderBoardPage } from '../shared/board/page';

const HOME = homedir();
const DIR = join(HOME, '.donel', 'board');
const LOG = join(DIR, 'cron.log');
const STATE = join(DIR, 'estado.json');
/** The tmux socket of the Donel's sessions; another one only in the end-to-end test. */
const SOCKET = process.env.DONEL_TMUX_SOCKET || 'donel';
const LEADER_ALIVE_MS = 30 * 60 * 1000;
const LABEL_ASCII = LABEL.slice(0, LABEL.indexOf(' ·'));

interface CronConfig {
  readonly host: string;
  readonly vigiaSombra: boolean;
  readonly slackReader?: string;
  readonly pagina?: string;
}

function readCronConfig(): CronConfig {
  try {
    const raw = JSON.parse(readFileSync(join(DIR, 'cron.json'), 'utf8')) as Record<string, unknown>;
    return {
      host: typeof raw.host === 'string' && raw.host ? raw.host : 'vps-pessoal',
      vigiaSombra: raw.vigiaSombra !== false,
      ...(typeof raw.slackReader === 'string' && raw.slackReader ? { slackReader: raw.slackReader } : {}),
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
  let best: { path: string; at: number } | null = null;
  try {
    for (const dir of readdirSync(root)) {
      const path = join(root, dir, `${uuid}.jsonl`);
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
  return landed() ? 'enviado' : 'nao-confirmado';
}

// --- links ---------------------------------------------------------------------------------------------------

function ghJson(path: string): unknown {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`gh api ${path}: ${(r.stderr ?? '').trim().slice(0, 160)}`);
  return JSON.parse(r.stdout || 'null');
}

const after = (iso: unknown, since: number): boolean => typeof iso === 'string' && Date.parse(iso) > since;

/** Something new on the link after `since`: true/false; null when the link cannot be read (only the deadline counts). */
function responded(link: string, since: number, config: CronConfig): boolean | null {
  const kind = linkKind(link);
  try {
    if (kind.kind === 'github') {
      const base = `repos/${kind.owner}/${kind.repo}`;
      const sinceIso = new Date(since).toISOString();
      const comments = ghJson(`${base}/issues/${kind.number}/comments?since=${encodeURIComponent(sinceIso)}&per_page=100`) as { created_at?: string }[];
      if (comments.some((c) => after(c.created_at, since))) return true;
      if (kind.type === 'pull') {
        const pr = ghJson(`${base}/pulls/${kind.number}`) as { merged_at?: string; closed_at?: string };
        if (after(pr.merged_at, since) || after(pr.closed_at, since)) return true;
        const reviews = ghJson(`${base}/pulls/${kind.number}/reviews?per_page=100`) as { submitted_at?: string }[];
        if (reviews.some((r) => after(r.submitted_at, since))) return true;
      } else {
        const issue = ghJson(`${base}/issues/${kind.number}`) as { closed_at?: string };
        if (after(issue.closed_at, since)) return true;
      }
      return false;
    }
    if (kind.kind === 'slack' && config.slackReader) {
      const r = spawnSync('python3', ['-I', config.slackReader, link], { encoding: 'utf8', timeout: 120_000 });
      if (r.status !== 0) return null;
      // not a thread: the reader shows the channel around the message, and any of it would read as a response
      if ((r.stderr ?? '').includes('não um fio')) return null;
      return [...(r.stdout ?? '').matchAll(/\(ts (\d+(?:\.\d+)?)\)/g)].some((m) => Number(m[1]) * 1000 > since);
    }
  } catch (error) {
    log(`link sem leitura (${link}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return null;
}

// --- cards ---------------------------------------------------------------------------------------------------

const ms = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) : null);

function cronCard(row: CardRow): CronCard {
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
  };
}

type Client = ReturnType<typeof createBoardClient>;

/** What typing into a session would do, read only (the shadow): the same checks as `wakeSession`, nothing typed. */
function wouldWake(uuid: string): 'campo livre' | `campo: ${string}` {
  if (typingLocked(uuid)) return 'campo: outro aviso sendo digitado';
  const field = fieldFree(uuid);
  return field.free ? 'campo livre' : `campo: ${field.why}`;
}

/** Does the action; true when its notice reached someone (in shadow: would have). */
async function act(client: Client, lanes: readonly LaneRow[], card: CronCard, action: CronAction, who: string, shadow: boolean, state: State, now: number): Promise<boolean> {
  if (action.do === 'skip') return false;
  // The shadow goes through the same steps (it reads the field, the typing lock and the Líder's tmux, which changes
  // nothing) and keeps its own marks, so its log shows the cap, the pause and the Líder exactly where acting would.
  const tag = shadow ? '[sombra] ' : '';
  const memory: Memory = shadow ? state.sombra : state;
  if (action.do === 'wake') {
    const result = shadow ? wouldWake(action.session) : wakeSession(action.session, action.text);
    log(`${tag}${who}: ${shadow ? 'acordaria' : 'acordar'} a sessão ${action.session} (cartão ${card.id}, ${action.mark}): ${result}`);
    if (result.startsWith('campo:')) {
      // Nothing typed and nothing marked. From BUSY_MAX rounds in a row on, the Líder hears it; the count goes back to
      // zero only when the Líder did (closed or busy, the next round tries again).
      const busy = (memory.busy[card.id] ?? 0) + 1;
      memory.busy[card.id] = busy;
      const next = afterBusyField(card, busy, result.slice('campo: '.length), memory.busyHeard[card.id] ?? null, now);
      if (next.do === 'skip') {
        log(`${tag}${who}: cartão ${card.id}: ${next.why}`);
        return false;
      }
      if (await act(client, lanes, card, next, who, shadow, state, now)) {
        delete memory.busy[card.id];
        memory.busyHeard[card.id] = now;
      }
      return false;
    }
    delete memory.busy[card.id];
    // Typed counts even unconfirmed (the text is on the screen): the cap and the pause must hold, as in the despertador.
    // The local cap first: it holds even if the mark below fails.
    if (who === 'vigia') memory.wakes[card.id] = [...(memory.wakes[card.id] ?? []), now];
    if (!shadow) await client.markCron(card.id, action.mark);
    return true;
  }
  const lane = lanes.find((l) => l.project_id === card.projectId);
  const leader = lane?.leader_session && UUID.test(lane.leader_session) ? lane.leader_session : null;
  if (!leader || !tmux(['has-session', '-t', `donel-${leader}`]).ok) {
    // Not marked: nobody was told, and the next round tries again (a Líder back in 5 min hears it then).
    log(`${tag}${who}: cartão ${card.id} precisa do Líder, mas a raia ${card.projectId} está sem Líder aberto aqui (${lane?.leader_place ?? 'nenhum'})`);
    return false;
  }
  const busyField = action.via === 'busy';
  if (shadow) {
    const result = wouldWake(leader);
    log(`${tag}${who}: avisaria o Líder ${lane?.leader_place} (cartão ${card.id}${busyField ? ', campo ocupado' : ''})${who === 'vigia' ? ' e gravaria a nota no cartão' : ''}: ${result}`);
    if (result.startsWith('campo:')) return false;
    if (!busyField) state.sombra.leader[card.id] = { at: now, stageSince: card.stageSince };
    return true;
  }
  const result = wakeSession(leader, action.text);
  log(`${who}: avisar o Líder ${lane?.leader_place} (cartão ${card.id}${busyField ? ', campo ocupado' : ''}): ${result}`);
  if (result.startsWith('campo:')) return false;
  // A busy field keeps its own mark (the caller's busyHeard): leader_noticed_at would silence the once-per-stage notices.
  if (!busyField) await client.markCron(card.id, 'leader');
  // Design §6: the card itself says why the Líder was called (board.vigia_note: the vigia is not the card's place).
  if (who === 'vigia') {
    const written = await client.vigiaNote(card.id, busyField ? 'parado sem justificativa; aviso à sessão não entrou (campo ocupado); Líder do quadro avisado' : 'parado sem justificativa; Líder do quadro avisado');
    log(`vigia: nota no cartão ${card.id}: ${written ? 'gravada' : 'não gravada (saiu de Fazendo ou ganhou justificativa)'}`);
  }
  return true;
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

async function ronda(client: Client, config: CronConfig): Promise<void> {
  const now = Date.now();
  const state = readState();
  const [rows, lanes] = await Promise.all([client.parkedOrDoing(config.host), client.lanes(config.host)]);
  let woke = 0;
  for (const row of rows) {
    const card = cronCard(row);
    try {
      if (card.justification) {
        const session = sessionState(card.sessionId);
        const answer = now < card.justification.due ? responded(card.justification.link, responseSince(card), config) : null;
        const action = planJustify(card, answer, session, now);
        // "rounds in a row": a round with nothing to type (working, waiting, pause) breaks the busy streak
        if (action.do === 'skip') delete state.busy[card.id];
        else woke++;
        await act(client, lanes, card, action, 'justificativa', false, state, now);
      } else {
        const shadow = config.vigiaSombra;
        const view = shadow ? withShadowNotice(card, state.sombra.leader[card.id]) : card;
        const memory = shadow ? state.sombra : state;
        const action = planVigia(view, sessionState(card.sessionId), memory.wakes[card.id] ?? [], now);
        if (action.do === 'skip') delete memory.busy[card.id];
        else woke++;
        await act(client, lanes, view, action, 'vigia', shadow, state, now);
      }
    } catch (error) {
      log(`cartão ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
  const lanes = await client.lanes(config.host);
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

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode !== 'ronda' && mode !== 'lider') {
    console.error('uso: board-cron.mjs ronda|lider');
    return 2;
  }
  const configFile = process.env.DONEL_BOARD_CONFIG || join(DIR, 'supabase.json');
  if (!existsSync(configFile)) return 0; // the board is off: nothing touched
  const boardConfig = readBoardConfig(configFile);
  if (!boardConfig) {
    console.error(`[quadro] ${configFile} existe mas é inválido: precisa de {"url": "https://…", "serviceKeyFile": "…"}`);
    return 1;
  }
  mkdirSync(DIR, { recursive: true });
  const client = createBoardClient(boardConfig);
  const config = readCronConfig();
  if (mode === 'ronda') await ronda(client, config);
  else await lider(client, config);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    log(`erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
