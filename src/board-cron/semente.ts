// Quadro de tarefas no SQLite (t-1e354d15, emenda de 20/11: docs/design/quadro-de-tarefas-sqlite.md, "Semente") —
// `board-cron.mjs semear [--seco]`: one card per live task of the Oráculo, by the map of §8 of the design, and the
// projects their folders belong to. The Oráculo's ledger is opened read-only (never written: the Oráculo is the
// owner's desk). Idempotent by `client_ref = oraculo:<id>`: a second run creates nothing.
//
// Map (§8, with one honest change): aberta → A fazer; em-execucao and entregue → Fazendo; rejeitada (not cancelled)
// → A fazer, to redo; last andamento precisa-do-dono → Entrada, without a place, for the Líder to decide. The design
// sent the last andamento travada/esperando to Travado with the justification "importado; preencher", but Travado
// needs a link and a future deadline that the Oráculo never had: inventing them would be a lie the cron then trusts.
// Those cards stay in Fazendo with the note "importado: travada — <precisa>; falta justificar", and the session (or
// the vigia, which tells the Líder about a card in Fazendo with no justification) fills the justification.
//
// Session (devolução do Revisor, 20/11): the vigia wakes `session_id`, which no import filled (only a `card_move` of the
// session itself does). The seed takes it from the place: the live session that holds the place in this machine's
// picture (`retrato.json` and the satellites' pictures: the folder sid, which is the tmux `donel-<sid>`; a renewed place
// is held by its successor) or the conversation of the place's card on the pictured board (the gate's reading), the
// newer of the two; with no holder, the uuid of a `session:<uuid>` place first. No picture: only `session:<uuid>`
// resolves. A second run fills the cards still without one (`fillSession`: no version, no move, only where the place is
// still the same); a card whose session was renewed is followed by the round (`followCardSession`), not rewritten here.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { progressOf, type LedgerProgress } from '../shared/ledger/andamento';
import { awaitsSend, frenteOf, isClosed, requestedByOf, type LedgerTask } from '../shared/ledger/contract';
import { projectFolderOf } from '../oraculo/board-client';
import type { BoardSqliteStore, ProjectInput } from '../oraculo/board-sqlite';
import type { BoardPicture, PictureSession } from '../oraculo/portao';
import type { MindscapeBoard } from '../shared/mindscape/model';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

export const SEED_ACTOR = 'servico:semente-quadro';
const NO_PROJECT = 'sem-projeto';

export interface SeedLedger {
  readonly tasks: Readonly<Record<string, LedgerTask>>;
}

/** The Oráculo's ledger, read-only: its `ledger.sqlite` (readOnly connection) or a `ledger.json` export. */
export function readLedgerReadOnly(file: string): SeedLedger {
  // Never opens (and so never creates) a database that is not there.
  if (!existsSync(file)) throw new Error(`${file} não existe: nada a semear`);
  if (file.endsWith('.json')) {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { tasks?: Record<string, LedgerTask> };
    return { tasks: doc.tasks ?? {} };
  }
  const db: DatabaseSync = new DatabaseSync(file, { readOnly: true } as never);
  try {
    const tasks: Record<string, LedgerTask> = {};
    for (const row of db.prepare('SELECT id, doc FROM tarefas ORDER BY id').all() as Array<{ id: string; doc: string }>) tasks[row.id] = JSON.parse(row.doc) as LedgerTask;
    return { tasks };
  } finally {
    db.close();
  }
}

export interface CardSeed {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly ownerRequest: string;
  readonly criterion: string;
  readonly requestedBy: string;
  readonly front?: string;
  readonly due?: string;
  readonly risk: 'baixo' | 'alto';
  /** The Oráculo's owner place; none in Entrada (the Líder decides). */
  readonly place?: string;
  readonly stage: 'inbox' | 'todo' | 'doing';
  readonly note: string;
  /** The session doing it (the uuid the vigia wakes), resolved from the place; none when nothing says it. */
  readonly session?: string;
}

export interface SeedPlan {
  readonly projects: readonly ProjectInput[];
  readonly cards: readonly CardSeed[];
  /** Tasks left out: closed, or an accepted Slack letter that only waits for its send. */
  readonly skipped: number;
  /** `hostOf` projects that are not in the plan (a typo, or a project with no live task): reported, never used. */
  readonly unknownHostOf: readonly string[];
}

export interface SeedOptions {
  /** `projects.host` of new projects. */
  readonly host: string;
  /** `projects.host` of a new project by its id (`--host-de <projeto>=<host>`), over `host`; an existing project keeps its own. */
  readonly hostOf?: Readonly<Record<string, string>>;
  /** This machine's home: its `<home>/seazone/<Pasta>` becomes an alias. */
  readonly vpsHome: string;
  /** The PC's `...\seazone` folder; missing = taken from the Windows paths of the ledger itself. */
  readonly pcRoot?: string;
  /** The session of a place on a project (`sessionResolver`); missing = only `session:<uuid>` places resolve. */
  readonly sessionOf?: SessionOf;
}

export type SessionOf = (projectId: string, placeId: string) => string | undefined;

/** A session id the cron can use (`donel-<id>` in tmux, `<id>.jsonl` transcript): the cron's own pattern. */
const SESSION_ID = /^[0-9a-f-]{8,64}$/i;
const SESSION_PLACE = 'session:';

/**
 * The session of a place, from the pictures this machine has (`retrato.json`, the satellites'): the newest of the live
 * holder of the place (a picture entry whose `quemSou.lugar` is the place on that project's board, not handed over to a
 * successor) and the conversation of the place's card on the pictured boards, each dated by `entryTime`; a tie goes
 * to the board's card. With no holder, `session:<uuid>`'s own uuid comes before the board's card.
 *
 * The tie (decisão do cético, 20/11): "newest" is when the entry was pictured, not how old the session is. A stale
 * holder resumed and probed again gets `at` = now, and its own entry pictures the board at that same time; the board
 * is what the owner sees, so where both are equally fresh the card says who is in the place.
 *
 * Newest, not first (sobras do Revisor, 20/11): a holder that closed without renewing (the Líder reopened, or `/clear`)
 * stays in the picture with its old `at`, and resumed in tmux it would win again over the session the fresher board
 * names; and two boards of the same project (the PC's folder and this VPS's, or a satellite's) must not be decided by
 * the order the pictures were read.
 *
 * `here` (the lanes' Líder, devolução de 20/11): only a session it says is alive in this machine counts, at every step.
 * The satellites' sessions live on another machine (`maquina`). The seed reads without it (a card may name a session
 * closed now, for the Líder to reopen).
 */
export function sessionResolver(pictures: readonly BoardPicture[], here?: (sid: string) => boolean): SessionOf {
  const counts = (sid: string): boolean => SESSION_ID.test(sid) && (!here || here(sid));
  const holders = new Map<string, Dated>();
  const cards = new Map<string, Dated>();
  const keep = (map: Map<string, Dated>, key: string, sid: string, at: number): void => {
    const known = map.get(key);
    if (!known || at > known.at) map.set(key, { sid, at });
  };
  for (const picture of pictures) {
    for (const [sid, session] of Object.entries(picture.sessoes ?? {})) {
      const { lugar, pasta } = session.quemSou ?? {};
      if (typeof lugar !== 'string' || typeof pasta !== 'string' || session.renovadaPara || !counts(sid)) continue;
      keep(holders, `${projectSlug(projectFolderOf(pasta))}|${lugar}`, sid, entryTime(session, picture));
    }
    for (const [pasta, { board, at }] of datedBoards(picture)) {
      const project = projectSlug(projectFolderOf(pasta));
      for (const [placeId, card] of Object.entries(board?.cards ?? {})) {
        if (card.kind === 'session' && card.sessionId && counts(card.sessionId)) keep(cards, `${project}|${placeId}`, card.sessionId, at);
      }
    }
  }
  return (projectId, placeId) => {
    const key = `${projectId}|${placeId}`;
    const held = holders.get(key);
    const carded = cards.get(key);
    if (held && (!carded || held.at > carded.at)) return held.sid;
    if (!held && placeId.startsWith(SESSION_PLACE) && counts(placeId.slice(SESSION_PLACE.length))) return placeId.slice(SESSION_PLACE.length);
    return carded?.sid;
  };
}

/**
 * When a picture entry was last seen: the probe's `at`, else the last PC push that carried it (`pcAt`, stamped by
 * `mergePicture`), else the picture's own `at` — as `pickLocalLeader` reads it. The picture's `at` alone would date
 * an entry the PC stopped sending an hour ago as if it were pushed now.
 */
function entryTime(session: PictureSession, picture: BoardPicture): number {
  return session.at ?? session.pcAt ?? picture.at ?? 0;
}

interface Dated {
  readonly sid: string;
  readonly at: number;
}

/** `picturedBoards` (the gate's reading: the freshest board of each folder in a picture) with the time of each one. */
function datedBoards(picture: BoardPicture): Map<string, { readonly board?: MindscapeBoard; readonly at: number }> {
  const fresh = new Map<string, { board?: MindscapeBoard; at: number }>();
  for (const session of Object.values(picture.sessoes ?? {})) {
    const pasta = session.quemSou?.pasta;
    if (session.quemSou?.liderUnico === true || typeof pasta !== 'string' || !pasta) continue;
    const at = entryTime(session, picture);
    const known = fresh.get(pasta);
    if (!known || at > known.at || (!known.board && session.board)) fresh.set(pasta, { at, ...(session.board ? { board: session.board } : {}) });
  }
  return fresh;
}

/** `retrato.json` and the satellites' pictures (`portoes-retrato/*.json`) in the Oráculo's folder; an unreadable one is left out. */
export function readPictures(oraculoDir: string): BoardPicture[] {
  const files = [join(oraculoDir, 'retrato.json')];
  try {
    for (const name of readdirSync(join(oraculoDir, 'portoes-retrato'))) if (name.endsWith('.json')) files.push(join(oraculoDir, 'portoes-retrato', name));
  } catch {
    // no satellite
  }
  const out: BoardPicture[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as BoardPicture;
      if (raw && typeof raw === 'object' && raw.sessoes && typeof raw.sessoes === 'object') out.push({ at: typeof raw.at === 'number' ? raw.at : 0, sessoes: raw.sessoes });
    } catch {
      // missing or cut: that picture is not used
    }
  }
  return out;
}

/** What the vigia needs of a task on the owner's desk (the Oráculo): its state, and whether it is closed. */
export interface DeskState {
  readonly state: LedgerTask['state'];
  readonly closed: boolean;
}

/** The Oráculo's tasks `ids`, read-only (only those rows); a missing ledger = none. */
export function readDeskStates(file: string, ids: readonly string[]): Map<string, DeskState> {
  const out = new Map<string, DeskState>();
  for (const [id, task] of readTasksReadOnly(file, ids)) out.set(id, { state: task.state, closed: isClosed(task) });
  return out;
}

/** The Oráculo's tasks `ids` whole, read-only (only those rows; never opens a ledger that is not there); none = empty. */
export function readTasksReadOnly(file: string, ids: readonly string[]): Map<string, LedgerTask> {
  const out = new Map<string, LedgerTask>();
  if (ids.length === 0 || !existsSync(file)) return out;
  if (file.endsWith('.json')) {
    const tasks = readLedgerReadOnly(file).tasks;
    for (const id of ids) if (tasks[id]) out.set(id, tasks[id]!);
    return out;
  }
  const db: DatabaseSync = new DatabaseSync(file, { readOnly: true } as never);
  try {
    const query = db.prepare('SELECT doc FROM tarefas WHERE id = ?');
    for (const id of new Set(ids)) {
      const row = query.get(id) as { doc: string } | undefined;
      if (row) out.set(id, JSON.parse(row.doc) as LedgerTask);
    }
  } finally {
    db.close();
  }
  return out;
}

const HOST_OF = /^([a-z0-9][a-z0-9-]{0,62})=([A-Za-z0-9._-]{1,64})$/;

/**
 * `--host-de <projeto>=<host>` (repeatable): the host of a project on its first seed, so a project of another machine
 * (the Homologações' `homologacao`) is not born as this one's. A malformed one throws (nothing seeded by a typo).
 */
export function parseHostOf(values: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of values) {
    const m = HOST_OF.exec(value.trim());
    if (!m) throw new Error(`--host-de espera <projeto>=<host> (projeto em minúsculas, dígitos e hífen): "${value}"`);
    out[m[1]!] = m[2]!;
  }
  return out;
}

const segments = (folder: string): string[] => folder.split(/[\\/]+/).filter(Boolean);
const isWindows = (folder: string): boolean => /^[A-Za-z]:[\\/]/.test(folder) || folder.includes('\\');

/** The project id of a folder: its last name as a slug ("Donel Dev" → "donel-dev"); '' when nothing is left. */
export function projectSlug(folder: string): string {
  const name = segments(folder).pop() ?? '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

function pcRootOf(folders: readonly string[]): string | undefined {
  for (const folder of folders) {
    if (!isWindows(folder)) continue;
    const parts = segments(folder);
    const at = parts.lastIndexOf('seazone');
    if (at > 0) return parts.slice(0, at + 1).join('\\');
  }
  return undefined;
}

/** The folder as each machine knows it: the same `seazone/<rel>` under the VPS's home and under the PC's root. */
function aliasesOf(folder: string, options: SeedOptions, pcRoot: string | undefined): string[] {
  const parts = segments(folder);
  const at = parts.lastIndexOf('seazone');
  const rel = at >= 0 ? parts.slice(at + 1) : [];
  const out = [folder];
  if (rel.length > 0) {
    out.push(`${options.vpsHome.replace(/\/+$/, '')}/seazone/${rel.join('/')}`);
    if (pcRoot) out.push(`${pcRoot}\\${rel.join('\\')}`);
  }
  return [...new Set(out)];
}

function lastProgress(task: LedgerTask): LedgerProgress | null {
  for (let index = task.events.length - 1; index >= 0; index -= 1) {
    const progress = progressOf(task.events[index]!);
    if (progress) return progress;
  }
  return null;
}

function stageOf(task: LedgerTask): Pick<CardSeed, 'stage' | 'note'> {
  const progress = lastProgress(task);
  const needs = progress?.precisa?.trim() ? ` — ${progress.precisa.trim()}` : '';
  if (progress?.estado === 'precisa-do-dono') return { stage: 'inbox', note: `importado: precisa do dono${needs}; o Líder decide` };
  if (task.state === 'aberta') return { stage: 'todo', note: 'importado do Oráculo' };
  if (task.state === 'rejeitada') return { stage: 'todo', note: 'importado: rejeitada no Oráculo, para refazer' };
  if (task.state === 'entregue') return { stage: 'doing', note: 'importado: entregue, esperando o aceite no Oráculo' };
  if (progress?.estado === 'travada' || progress?.estado === 'esperando') {
    return { stage: 'doing', note: `importado: ${progress.estado}${needs}; falta justificar (motivo, link e prazo)` };
  }
  return { stage: 'doing', note: 'importado do Oráculo' };
}

/** What the seed would do: pure, from the ledger alone. */
export function planSeed(ledger: SeedLedger, options: SeedOptions): SeedPlan {
  const live = Object.values(ledger.tasks)
    .filter((task) => !isClosed(task) && !awaitsSend(task) && (task.state === 'aberta' || task.state === 'em-execucao' || task.state === 'entregue' || task.state === 'rejeitada'))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const folders = [...new Set(live.map((task) => projectFolderOf(task.projectPath)))];
  const pcRoot = options.pcRoot?.replace(/[\\/]+$/, '') ?? pcRootOf(folders);
  const resolveSession = options.sessionOf ?? sessionResolver([]);
  const projects = new Map<string, { name: string; aliases: Set<string> }>();
  for (const folder of folders) {
    const id = projectSlug(folder);
    if (!id || id === NO_PROJECT) continue;
    const project = projects.get(id) ?? { name: segments(folder).pop()!, aliases: new Set<string>() };
    for (const alias of aliasesOf(folder, options, pcRoot)) project.aliases.add(alias);
    projects.set(id, project);
  }
  const cards = live.map((task): CardSeed => {
    const slug = projectSlug(projectFolderOf(task.projectPath));
    const front = frenteOf(task);
    const { stage, note } = stageOf(task);
    const projectId = projects.has(slug) ? slug : NO_PROJECT;
    const session = stage === 'inbox' ? undefined : resolveSession(projectId, task.ownerPlaceId);
    return {
      taskId: task.id,
      projectId,
      title: task.title?.trim() || task.request.split('\n')[0]!.trim() || task.id,
      ownerRequest: task.request,
      criterion: task.doneWhen,
      requestedBy: requestedByOf(task) ?? 'não registrado',
      ...(front ? { front } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(task.due) ? { due: task.due } : {}),
      risk: task.risk === 'alto' ? 'alto' : 'baixo',
      ...(stage === 'inbox' ? {} : { place: task.ownerPlaceId }),
      stage,
      note,
      ...(session ? { session } : {}),
    };
  });
  return {
    projects: [...projects].sort(([a], [b]) => a.localeCompare(b)).map(([id, project]) => ({ id, name: project.name, host: options.hostOf?.[id] ?? options.host, aliases: [...project.aliases] })),
    cards,
    skipped: Object.keys(ledger.tasks).length - live.length,
    unknownHostOf: Object.keys(options.hostOf ?? {}).filter((id) => !projects.has(id)).sort(),
  };
}

export interface SessionFill {
  readonly cardId: string;
  readonly taskId: string;
  readonly stage: string;
  readonly place: string;
  readonly session: string;
}

/**
 * `semear --seco`: the cards already on the board that a run would give their session (the same rule as `runSeed`),
 * from the board's file opened read-only (nothing created, no schema written).
 */
export function countSessionFills(boardFile: string, plan: SeedPlan): SessionFill[] {
  const db: DatabaseSync = new DatabaseSync(boardFile, { readOnly: true } as never);
  try {
    const query = db.prepare('SELECT id, stage, place_id, session_id FROM cards WHERE client_ref = ?');
    const out: SessionFill[] = [];
    for (const seed of plan.cards) {
      if (!seed.session || !seed.place) continue;
      const card = query.get(`oraculo:${seed.taskId}`) as { id: string; stage: string; place_id: string | null; session_id: string | null } | undefined;
      if (card && !card.session_id && card.place_id === seed.place) out.push({ cardId: card.id, taskId: seed.taskId, stage: card.stage, place: seed.place, session: seed.session });
    }
    return out;
  } finally {
    db.close();
  }
}

export interface SeedResult {
  readonly projects: number;
  readonly created: number;
  readonly existing: number;
  /** Cards (new or old) that got their session now. */
  readonly sessions: number;
}

/**
 * Applies the plan through the store's own functions (the rules hold, as the Líder: the seed triages). A card is
 * born in its column's door (Entrada or A fazer) and gets its import move at once; one cut between the two (version
 * 1, never moved) is finished by the next run.
 */
export async function runSeed(store: BoardSqliteStore, plan: SeedPlan, log: (line: string) => void = () => undefined): Promise<SeedResult> {
  for (const project of plan.projects) await store.upsertProject(project);
  let created = 0;
  let existing = 0;
  let sessions = 0;
  for (const seed of plan.cards) {
    const ref = `oraculo:${seed.taskId}`;
    let card = await store.cardByClientRef(ref);
    if (card) existing += 1;
    else {
      card = await store.createCard({
        p_project_id: seed.projectId,
        p_title: seed.title,
        p_owner_request: seed.ownerRequest,
        p_criterion: seed.criterion,
        p_requested_by: seed.requestedBy,
        p_actor: SEED_ACTOR,
        p_client_ref: ref,
        p_stage: seed.stage === 'inbox' ? 'inbox' : 'todo',
        ...(seed.front ? { p_front: seed.front } : {}),
        ...(seed.due ? { p_due: seed.due } : {}),
        p_risk: seed.risk,
        p_oraculo_id: seed.taskId,
        ...(seed.place && seed.stage !== 'inbox' ? { p_place_id: seed.place } : {}),
        p_as_leader: true,
      });
      created += 1;
    }
    if (card.version === 1) {
      card = await store.moveCard({
        p_card_id: card.id,
        p_to: seed.stage,
        p_actor: SEED_ACTOR,
        p_expected_version: 1,
        p_note: seed.note,
        ...(seed.stage === 'doing' && seed.place ? { p_place_id: seed.place } : {}),
        p_as_leader: true,
      });
      log(`${seed.taskId} → ${card.id} (${card.project_id}, ${card.stage}): ${seed.note}`);
    }
    // Only the session of the place the card still has (a card the Líder gave to another place keeps its own).
    if (seed.session && !card.session_id && seed.place && card.place_id === seed.place && (await store.fillSession(card.id, seed.place, seed.session))) {
      sessions += 1;
      log(`${seed.taskId} → ${card.id}: sessão ${seed.session}`);
    }
  }
  return { projects: plan.projects.length, created, existing, sessions };
}
