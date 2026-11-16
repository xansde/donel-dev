// Quadro de tarefas (t-1e354d15), PR 3 — the board's cron on the VPS, one self-contained Node file
// (`out/board-cron/board-cron.mjs`, board-cron.vite.config.ts). Plan: docs/design/quadro-de-tarefas.md §5–§7.
//
//   node board-cron.mjs ronda   every 15 min: justification cron, vigia, lanes alive, page
//   node board-cron.mjs lider   every minute: the PC's requests for a lane's Líder (board.leader_requests)
//
// Config (nothing hardcoded: the repo goes public):
//   ~/.donel/board/supabase.json  {url, serviceKeyFile}             missing = the board is off, the cron exits 0
//   ~/.donel/board/cron.json      {vigiaSombra?, slackReader?, pagina?}
//     vigiaSombra (default true): the vigia only LOGS what it would do. It runs one day beside the despertador's
//       `ronda` with the same output or better before it acts (Líder do quadro, 16/11); turning it on is a separate step.
//     slackReader: a script that prints a Slack thread with "(ts <epoch>)" per message (ler_fio.py); missing = Slack
//       links count only by their deadline.
//     pagina: folder of the page (index.html); missing = no page.
// State ~/.donel/board/estado.json (the vigia's wakes per card); log ~/.donel/board/cron.log.
//
// Waking a session = typing into its tmux (`tmux -L donel`, session `donel-<conversation>`) only when its input field
// is empty, and confirming it in the transcript — the despertador's way (~/bin/rotinas/despertador_sessoes.py).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, closeSync, renameSync, statSync, writeFileSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createBoardClient, readBoardConfig, type CardRow, type LaneRow } from '../oraculo/board-client';
import { fieldIsFree, LABEL, linkKind, planJustify, planVigia, responseSince, type CronAction, type CronCard, type SessionState } from '../shared/board/cron';
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
  readonly vigiaSombra: boolean;
  readonly slackReader?: string;
  readonly pagina?: string;
}

function readCronConfig(): CronConfig {
  try {
    const raw = JSON.parse(readFileSync(join(DIR, 'cron.json'), 'utf8')) as Record<string, unknown>;
    return {
      vigiaSombra: raw.vigiaSombra !== false,
      ...(typeof raw.slackReader === 'string' && raw.slackReader ? { slackReader: raw.slackReader } : {}),
      ...(typeof raw.pagina === 'string' && raw.pagina ? { pagina: raw.pagina } : {}),
    };
  } catch {
    return { vigiaSombra: true };
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

interface State {
  wakes: Record<string, number[]>;
}

function readState(): State {
  try {
    const raw = JSON.parse(readFileSync(STATE, 'utf8')) as State;
    return { wakes: raw.wakes && typeof raw.wakes === 'object' ? raw.wakes : {} };
  } catch {
    return { wakes: {} };
  }
}

function writeState(state: State, now: number): void {
  for (const [card, list] of Object.entries(state.wakes)) {
    const kept = list.filter((at) => now - at < 24 * 60 * 60 * 1000);
    if (kept.length) state.wakes[card] = kept;
    else delete state.wakes[card];
  }
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

function lastTurnAt(uuid: string): number | null {
  const path = transcriptOf(uuid);
  if (!path) return null;
  const lines = tail(path, 400_000).split('\n').reverse();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { type?: string; isSidechain?: boolean; timestamp?: string };
      if ((entry.type === 'user' || entry.type === 'assistant') && !entry.isSidechain && entry.timestamp) return Date.parse(entry.timestamp);
    } catch {
      // a cut line at the start of the tail
    }
  }
  return null;
}

function sessionState(uuid: string | null): SessionState | null {
  if (!uuid || !UUID.test(uuid)) return null;
  return { alive: tmux(['has-session', '-t', `donel-${uuid}`]).ok, lastTurnAt: lastTurnAt(uuid) };
}

function fieldFree(uuid: string): { free: boolean; why: string } {
  const target = `donel-${uuid}`;
  const mode = tmux(['display', '-p', '-t', target, '#{pane_in_mode}']);
  if (!mode.ok) return { free: false, why: 'tmux não respondeu' };
  if (!['', '0'].includes(mode.out.trim())) return { free: false, why: 'tela em modo cópia' };
  return fieldIsFree(tmux(['capture-pane', '-e', '-p', '-t', target]).out);
}

/** Types into the session and confirms it in the transcript, as the despertador does. */
function typeInto(uuid: string, text: string): 'enviado' | 'nao-confirmado' {
  const target = `donel-${uuid}`;
  const path = transcriptOf(uuid);
  const before = path ? statSync(path).size : 0;
  if (!tmux(['send-keys', '-t', target, '-l', text]).ok) return 'nao-confirmado';
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
  };
}

type Client = ReturnType<typeof createBoardClient>;

async function act(client: Client, lanes: readonly LaneRow[], card: CronCard, action: CronAction, who: string, shadow: boolean, state: State, now: number): Promise<void> {
  if (action.do === 'skip') return;
  const tag = shadow ? '[sombra] ' : '';
  if (action.do === 'wake') {
    if (shadow) {
      log(`${tag}${who}: acordaria a sessão ${action.session} (cartão ${card.id}, ${action.mark})`);
      return;
    }
    const field = fieldFree(action.session);
    if (!field.free) {
      log(`${who}: não acordou ${action.session} (cartão ${card.id}): ${field.why}`);
      return;
    }
    const result = typeInto(action.session, action.text);
    log(`${who}: acordou a sessão ${action.session} (cartão ${card.id}, ${action.mark}): ${result}`);
    if (result === 'enviado') {
      await client.markCron(card.id, action.mark);
      if (who === 'vigia') state.wakes[card.id] = [...(state.wakes[card.id] ?? []), now];
    }
    return;
  }
  const lane = lanes.find((l) => l.project_id === card.projectId);
  const leader = lane?.leader_session && UUID.test(lane.leader_session) ? lane.leader_session : null;
  if (shadow) {
    log(`${tag}${who}: avisaria o Líder ${lane?.leader_place ?? '(sem Líder)'} (cartão ${card.id})`);
    return;
  }
  if (!leader || !tmux(['has-session', '-t', `donel-${leader}`]).ok) {
    log(`${who}: cartão ${card.id} precisa do Líder, mas a raia ${card.projectId} está sem Líder vivo (${lane?.leader_place ?? 'nenhum'})`);
    await client.markCron(card.id, 'leader');
    return;
  }
  const field = fieldFree(leader);
  if (!field.free) {
    log(`${who}: não avisou o Líder ${lane?.leader_place} (cartão ${card.id}): ${field.why}`);
    return;
  }
  const result = typeInto(leader, action.text);
  log(`${who}: avisou o Líder ${lane?.leader_place} (cartão ${card.id}): ${result}`);
  if (result === 'enviado') await client.markCron(card.id, 'leader');
}

/** Lanes whose Líder is alive in tmux and had a turn in the last 30 min stay alive in `board.lanes`. */
async function touchLiveLeaders(client: Client, lanes: readonly LaneRow[], now: number): Promise<void> {
  for (const lane of lanes) {
    if (!lane.leader_place || !lane.leader_session) continue;
    const session = sessionState(lane.leader_session);
    if (session?.alive && session.lastTurnAt !== null && now - session.lastTurnAt < LEADER_ALIVE_MS) {
      await client.touchLane(lane.project_id, lane.leader_place, lane.leader_session);
    }
  }
}

async function ronda(client: Client, config: CronConfig): Promise<void> {
  const now = Date.now();
  const state = readState();
  const [rows, lanes] = await Promise.all([client.parkedOrDoing(), client.lanes()]);
  let woke = 0;
  for (const row of rows) {
    const card = cronCard(row);
    try {
      if (card.justification) {
        const answer = now < card.justification.due ? responded(card.justification.link, responseSince(card), config) : null;
        const action = planJustify(card, answer, now);
        if (action.do !== 'skip') woke++;
        await act(client, lanes, card, action, 'justificativa', false, state, now);
      } else {
        const action = planVigia(card, sessionState(card.sessionId), state.wakes[card.id] ?? [], now);
        if (action.do !== 'skip') woke++;
        await act(client, lanes, card, action, 'vigia', config.vigiaSombra, state, now);
      }
    } catch (error) {
      log(`cartão ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  writeState(state, now);
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

async function lider(client: Client): Promise<void> {
  const requests = await client.pendingLeaderRequests();
  if (requests.length === 0) return;
  const lanes = await client.lanes();
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
    const field = fieldFree(leader);
    if (!field.free) {
      // still alive and busy: try again next minute, but do not hold the request forever
      if (Date.now() - Date.parse(request.created_at) > 10 * 60 * 1000) {
        await client.resolveLeaderRequest(request.id, 'done', `Líder vivo e ocupado (${field.why})`);
        log(`lider: pedido ${request.id} (${request.project_id}): Líder vivo e ocupado há 10 min; dado como atendido`);
      }
      continue;
    }
    const result = typeInto(leader, `${LABEL} O ${request.actor} pediu o Líder da raia ${request.project_id}. Veja a Entrada e o que espera por você no quadro (card_list).`);
    if (result === 'enviado') await client.resolveLeaderRequest(request.id, 'done', 'Líder acordado');
    log(`lider: pedido ${request.id} (${request.project_id}): ${result}`);
  }
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode !== 'ronda' && mode !== 'lider') {
    console.error('uso: board-cron.mjs ronda|lider');
    return 2;
  }
  mkdirSync(DIR, { recursive: true });
  const boardConfig = readBoardConfig(process.env.DONEL_BOARD_CONFIG || join(DIR, 'supabase.json'));
  if (!boardConfig) return 0; // the board is off
  const client = createBoardClient(boardConfig);
  if (mode === 'ronda') await ronda(client, readCronConfig());
  else await lider(client);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    log(`erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
