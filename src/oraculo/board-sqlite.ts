// Quadro de tarefas no SQLite da VPS (t-1e354d15, emenda de 20/11: docs/design/quadro-de-tarefas-sqlite.md). The same
// `BoardStore & BoardCronStore` the Supabase client is (board-client.ts), with the semantics of the functions and views
// of docs/board/schema.sql ported here: the rules of a move are `checkMove` (src/shared/board/rules.ts), applied inside
// the write transaction, so this file is where they count (as `board.move_card` did in Postgres).
//
// Two processes write the same file (the daemon's `card_*` tools and the board-cron): WAL, busy_timeout, and every
// write in BEGIN IMMEDIATE (one writer at a time; a compare-and-swap read inside it cannot go stale). `moves` is
// append-only (it is the andamento). The file is created 0600 when missing.
//
// Config: `<home>/.donel/board/sqlite.json` = `{ "file": "<path>" }` (`~/` and paths relative to the config's folder
// work). Nothing here is hardcoded (the repo goes public).

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { OverviewRow, PageCard } from '../shared/board/page';
import { checkMove, hasText, isValidJustification, STAGES, type Justification, type OwnerReason, type Stage } from '../shared/board/rules';
import {
  BoardError,
  createBoardClient,
  projectFolderOf,
  readBoardConfig,
  type BoardCronStore,
  type BoardStore,
  type CardRow,
  type CreateCardArgs,
  type LaneRow,
  type LeaderRequestRow,
  type MoveCardArgs,
} from './board-client';

// Loaded at run time: the bundlers (vite) drop the `node:` of `node:sqlite`, a builtin that only exists with it.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

const NO_PROJECT = 'sem-projeto';
const LEADER_ALIVE_MS = 30 * 60 * 1000;
const PAGE_DONE_MS = 3 * 24 * 60 * 60 * 1000;

/** How far back a card in Feito is still read to follow its task (a task devolvida after the card closed reopens it). */
export const CARDS_WITH_TASK_DONE_MS = 7 * 24 * 60 * 60 * 1000;
/** The cards of Oráculo tasks: not done, or done after `?` (ISO). Read by the store and by `sincronizar --seco`. */
export const CARDS_WITH_TASK_SQL = "SELECT * FROM cards WHERE oraculo_id IS NOT NULL AND (stage <> 'done' OR updated_at > ?) ORDER BY created_at, rowid LIMIT 5000";
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProjectInput {
  readonly id: string;
  readonly name: string;
  /** Where it runs (`vps-pessoal` when missing); an existing project keeps its own. */
  readonly host?: string;
  /** Folders of the project per machine; merged with the ones it already has. */
  readonly aliases: readonly string[];
}

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly aliases: readonly string[];
}

/** A row of the view `board.owner_feed`. */
export interface OwnerFeedRow {
  readonly id: number;
  readonly card_id: string;
  readonly project_id: string;
  readonly to_stage: Stage;
  readonly note: string | null;
  readonly owner_reason: string | null;
  readonly done_summary: string | null;
  readonly title: string;
  readonly owner_request: string;
  readonly requested_by: string;
  readonly oraculo_id: string | null;
  readonly at: string;
}

export interface LeaderRequestFull extends LeaderRequestRow {
  readonly client_ref: string;
  readonly status: 'pending' | 'done' | 'failed';
  readonly reason: string | null;
  readonly handled_at: string | null;
}

/** The board's store, plus the admin functions of schema.sql that are no session tool. */
export interface BoardSqliteStore extends BoardStore, BoardCronStore {
  /** Admin (the seed): creates the project or adds aliases to it. */
  upsertProject(project: ProjectInput): Promise<ProjectRow>;
  reclassifyCard(cardId: string, projectId: string, actor: string): Promise<CardRow>;
  requestLeader(projectId: string, actor: string, clientRef: string): Promise<LeaderRequestFull>;
  /** `board.owner_feed` after the cursor `afterId`. */
  ownerFeed(afterId: number): Promise<readonly OwnerFeedRow[]>;
  /** `board.lanes_without_leader`. */
  lanesWithoutLeader(): Promise<readonly LaneRow[]>;
  /** Admin (`board-cron raia`): the lane of a project, or null. */
  laneOf(projectId: string): Promise<LaneRow | null>;
  cardByOraculoId(taskId: string): Promise<CardRow | null>;
  cardsWithTask(): Promise<readonly CardRow[]>;
  /**
   * Admin (the seed): the session that does a card the import left without one. Only while the card has none and its
   * place is still `placeId`; no version, no move (it is who to wake, not a step of the card). False = nothing changed.
   * `replacing` (t-8406f473, the assumir of a renewed place): swaps that session instead, only while the card still has it.
   */
  fillSession(cardId: string, placeId: string, sessionId: string, replacing?: string): Promise<boolean>;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'vps-pessoal',
  aliases TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lanes (
  project_id TEXT PRIMARY KEY REFERENCES projects (id),
  leader_place TEXT,
  leader_session TEXT,
  leader_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  front TEXT CHECK (front IS NULL OR length(front) <= 40),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  owner_request TEXT NOT NULL,
  criterion TEXT,
  requested_by TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'inbox' CHECK (stage IN ('inbox', 'todo', 'doing', 'blocked', 'waiting_owner', 'done')),
  stage_since TEXT NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  place_id TEXT,
  session_id TEXT,
  justification TEXT,
  justification_link TEXT,
  justification_due TEXT,
  owner_reason TEXT CHECK (owner_reason IS NULL OR owner_reason IN ('main_prod', 'new_credential', 'money', 'laya')),
  done_summary TEXT,
  oraculo_id TEXT,
  due TEXT,
  risk TEXT NOT NULL DEFAULT 'baixo' CHECK (risk IN ('baixo', 'alto')),
  position INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  client_ref TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  woken_at TEXT,
  charged_at TEXT,
  charge_count INTEGER NOT NULL DEFAULT 0,
  leader_noticed_at TEXT,
  justified_at TEXT,
  CHECK (stage <> 'blocked' OR (justification IS NOT NULL AND justification_link IS NOT NULL AND justification_due IS NOT NULL)),
  CHECK (stage <> 'waiting_owner' OR owner_reason IS NOT NULL),
  CHECK (stage <> 'done' OR done_summary IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cards_project_stage ON cards (project_id, stage);
CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards (id),
  project_id TEXT NOT NULL REFERENCES projects (id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  note TEXT,
  owner_reason TEXT,
  done_summary TEXT,
  actor TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moves_to_stage ON moves (to_stage, id);
CREATE TABLE IF NOT EXISTS leader_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects (id),
  actor TEXT NOT NULL,
  client_ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  reason TEXT,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS leader_requests_one_pending ON leader_requests (project_id) WHERE status = 'pending';
`;

/** `left(text, n)` of Postgres: n characters, not UTF-16 units. */
const left = (value: string, n: number): string => Array.from(value).slice(0, n).join('');
/** `btrim(text)` of Postgres: spaces only. */
const btrim = (value: string): string => value.replace(/^ +| +$/g, '');
/** `left(nullif(btrim(front), ''), 40)`. */
const cleanFront = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = btrim(value);
  return trimmed ? left(trimmed, 40) : null;
};
const iso = (ms: number): string => new Date(ms).toISOString();
const dueOf = (row: { justification: string | null; justification_link: string | null; justification_due: string | null }): Justification | undefined =>
  row.justification !== null ? { text: row.justification, link: row.justification_link ?? '', due: row.justification_due ? Date.parse(row.justification_due) : Number.NaN } : undefined;

const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

function openDb(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // An empty file is an empty SQLite database: created 0600 here, the -wal and -shm take its mode.
  if (!existsSync(file)) writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
  try {
    chmodSync(file, 0o600);
  } catch {
    // a read-only place: the folder still covers it
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SCHEMA);
    db.prepare("INSERT INTO projects (id, name, host, aliases, created_at) VALUES ('sem-projeto', 'Sem projeto', 'vps-pessoal', '[]', ?) ON CONFLICT (id) DO NOTHING").run(iso(Date.now()));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

const PROJECT_CARDS_ORDER = `ORDER BY c.project_id, c.front IS NULL, c.front, CASE c.stage ${STAGES.map((stage, index) => `WHEN '${stage}' THEN ${index + 1}`).join(' ')} END, c.position, c.created_at`;

/** board.overview */
function overviewRows(db: DatabaseSync, at: number): OverviewRow[] {
  const today = iso(at).slice(0, 10);
  return db
    .prepare(
      `SELECT p.id AS project_id, p.name, p.host,
              ${STAGES.map((stage) => `COUNT(CASE WHEN c.stage = '${stage}' THEN 1 END) AS ${stage}`).join(', ')},
              COUNT(CASE WHEN c.stage <> 'done' AND c.due < ? THEN 1 END) AS overdue,
              MIN(CASE WHEN c.stage IN ('doing', 'blocked') THEN c.stage_since END) AS oldest_parked_since,
              MAX(c.updated_at) AS last_change
         FROM projects p LEFT JOIN cards c ON c.project_id = p.id
        GROUP BY p.id, p.name, p.host
        ORDER BY p.id`,
    )
    .all(today)
    .map((row) => plain<OverviewRow>(row));
}

/** board.project_cards: every card not done, plus the ones done in the last 3 days. */
function pageCardRows(db: DatabaseSync, at: number): PageCard[] {
  return db
    .prepare(`SELECT c.* FROM cards c WHERE c.stage <> 'done' OR c.updated_at > ? ${PROJECT_CARDS_ORDER} LIMIT 2000`)
    .all(iso(at - PAGE_DONE_MS))
    .map((row) => plain<PageCard>(row));
}

/** The two views of a board, read without writing (the phone's `/api/v2/quadro`). */
export interface BoardReadView {
  overview(): Promise<readonly OverviewRow[]>;
  /** The rows are the whole card (`c.*`); `PageCard` names what the page uses. */
  pageCards(): Promise<readonly PageCard[]>;
  close?: () => void;
}

/**
 * t-f091595a — the board opened read-only: no schema, no seed project, no chmod, never created when missing (that is
 * `createBoardSqlite`, the writers'). A missing file throws.
 */
export function openBoardSqliteReadOnly(file: string, options: { readonly now?: () => number } = {}): BoardReadView & { close(): void } {
  const now = options.now ?? Date.now;
  if (!existsSync(file)) throw new BoardError('o quadro de tarefas não existe nesta máquina');
  const db = new DatabaseSync(file, { readOnly: true } as never);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    overview: async () => overviewRows(db, now()),
    pageCards: async () => pageCardRows(db, now()),
    close: () => db.close(),
  };
}

export function createBoardSqlite(file: string, options: { readonly now?: () => number } = {}): BoardSqliteStore {
  const now = options.now ?? Date.now;
  const db = openDb(file);
  let closed = false;

  /** A write: one transaction, the write lock taken first. A database error reaches the session as a BoardError. */
  function write<T>(fn: () => T): T {
    if (closed) throw new BoardError('o quadro de tarefas está fechado');
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      throw new BoardError(`o quadro de tarefas está ocupado (${error instanceof Error ? error.message : 'erro'}); tente de novo`);
    }
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // the transaction is already gone
      }
      if (error instanceof BoardError) throw error;
      throw new BoardError(`o quadro de tarefas recusou: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const read = <T>(fn: () => T): Promise<T> => {
    if (closed) return Promise.reject(new BoardError('o quadro de tarefas está fechado'));
    return Promise.resolve(fn());
  };

  const cardById = (id: string): CardRow | null => {
    const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    return row ? plain<CardRow>(row) : null;
  };
  const cardByRef = (ref: string): CardRow | null => {
    const row = db.prepare('SELECT * FROM cards WHERE client_ref = ?').get(ref);
    return row ? plain<CardRow>(row) : null;
  };
  /** The history: append-only, the last write of its transaction. */
  const logMove = (card: CardRow, from: string | null, actor: string, at: string): void => {
    db.prepare('INSERT INTO moves (card_id, project_id, from_stage, to_stage, note, owner_reason, done_summary, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      card.id,
      card.project_id,
      from,
      card.stage,
      card.note,
      card.owner_reason,
      card.done_summary,
      actor,
      at,
    );
  };
  const projectExists = (id: string): boolean => db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id) !== undefined;
  const projectRow = (id: string): ProjectRow => {
    const row = db.prepare('SELECT id, name, host, aliases FROM projects WHERE id = ?').get(id) as { id: string; name: string; host: string; aliases: string };
    return { id: row.id, name: row.name, host: row.host, aliases: JSON.parse(row.aliases) as string[] };
  };
  return {
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },

    projectOf: (projectPath) =>
      read(() => {
        const folder = projectFolderOf(projectPath);
        const row = db.prepare('SELECT p.id FROM projects p, json_each(p.aliases) a WHERE a.value = ? LIMIT 1').get(folder) as { id: string } | undefined;
        return row?.id ?? NO_PROJECT;
      }),
    getCard: (id) => read(() => cardById(id)),
    cardByClientRef: (ref) => read(() => cardByRef(ref)),
    cardByOraculoId: (taskId) =>
      read(() => {
        const row = db.prepare("SELECT * FROM cards WHERE oraculo_id = ? AND stage <> 'done' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(taskId);
        return row ? plain<CardRow>(row) : null;
      }),
    listCards: (projectId, options) =>
      read(() => {
        const filter = options.stage ? 'AND c.stage = ?' : options.includeDone ? '' : "AND c.stage <> 'done'";
        const params = options.stage ? [projectId, options.stage] : [projectId];
        return db.prepare(`SELECT c.* FROM cards c WHERE c.project_id = ? ${filter} ${PROJECT_CARDS_ORDER} LIMIT 200`).all(...params).map((row) => plain<CardRow>(row));
      }),

    // board.create_card
    createCard: async (args: CreateCardArgs) =>
      write(() => {
        if (args.p_client_ref !== undefined && args.p_client_ref !== null) {
          const existing = cardByRef(args.p_client_ref);
          if (existing) return existing;
        }
        if (!hasText(args.p_actor)) throw new BoardError('quem cria é obrigatório (actor)');
        if (!hasText(args.p_title)) throw new BoardError('título é obrigatório');
        if (!hasText(args.p_owner_request)) throw new BoardError('a frase do pedido é obrigatória');
        if (!hasText(args.p_requested_by)) throw new BoardError('quem pediu é obrigatório (requested_by)');
        const stage = args.p_stage === undefined ? 'inbox' : args.p_stage;
        if (stage !== 'inbox' && stage !== 'todo') throw new BoardError(`cartão novo entra em inbox ou todo, não em ${String(stage)}`);
        const place = args.p_place_id ?? null;
        if ((stage === 'todo' || place !== null) && !args.p_as_leader) throw new BoardError('só o Líder do quadro cria direto em "A fazer" ou dá o lugar; crie na Entrada');
        const risk = args.p_risk ?? 'baixo';
        if (risk !== 'baixo' && risk !== 'alto') throw new BoardError(`risco desconhecido: ${String(risk)}`);
        let project = args.p_project_id;
        let note = 'criado';
        if (!project || !projectExists(project)) {
          note = `projeto desconhecido: ${project || '(nenhum)'}`;
          project = NO_PROJECT;
        }
        const at = iso(now());
        const id = `c-${randomBytes(6).toString('hex')}`;
        db.prepare(
          `INSERT INTO cards (id, project_id, front, title, owner_request, criterion, requested_by, stage, stage_since, note, place_id, session_id,
                              due, risk, oraculo_id, client_ref, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          project,
          cleanFront(args.p_front),
          left(btrim(args.p_title), 120),
          args.p_owner_request,
          args.p_criterion ?? null,
          args.p_requested_by,
          stage,
          at,
          left(note, 200),
          place,
          place !== null && place === args.p_actor ? (args.p_session_id ?? null) : null,
          args.p_due ?? null,
          risk,
          args.p_oraculo_id ?? null,
          args.p_client_ref ?? null,
          args.p_actor,
          at,
          at,
        );
        const card = cardById(id)!;
        logMove(card, null, args.p_actor, at);
        return card;
      }),

    // board.move_card: the rules are checkMove, here inside the write lock
    moveCard: async (args: MoveCardArgs) =>
      write(() => {
        if (!hasText(args.p_actor)) throw new BoardError('quem move é obrigatório (actor)');
        const card = cardById(args.p_card_id);
        if (!card) throw new BoardError(`cartão ${args.p_card_id} não existe`);
        const t = now();
        const leader = Boolean(args.p_as_leader);
        const changed = args.p_to !== card.stage;
        const newJ = args.p_justification !== undefined && args.p_justification !== null;
        const given: Justification | undefined = newJ
          ? { text: args.p_justification!, link: args.p_justification_link ?? '', due: args.p_justification_due ? Date.parse(args.p_justification_due) : Number.NaN }
          : undefined;
        const kept = changed ? undefined : dueOf(card);
        const reason = args.p_owner_reason ?? (changed ? undefined : card.owner_reason ?? undefined);
        const summary = args.p_done_summary ?? (changed ? undefined : card.done_summary ?? undefined);
        if (args.p_place_id === '' && !leader) throw new BoardError('só o Líder do quadro dá o cartão a outro lugar');
        const check = checkMove({
          card: { id: card.id, projectId: card.project_id, stage: card.stage, stageSince: Date.parse(card.stage_since), placeId: card.place_id, version: card.version },
          to: args.p_to,
          actor: args.p_actor,
          actorIsLeader: leader,
          now: t,
          expectedVersion: args.p_expected_version,
          ...(given ? { justification: given } : {}),
          ...(kept ? { keptJustification: kept } : {}),
          ...(reason !== undefined ? { ownerReason: reason as OwnerReason } : {}),
          ...(summary !== undefined ? { doneSummary: summary } : {}),
          ...(args.p_place_id ? { assignPlace: args.p_place_id } : {}),
          ...(args.p_front !== undefined && args.p_front !== null ? { front: args.p_front } : {}),
        });
        if (!check.ok) throw new BoardError(check.error);
        // The justification that counts now (the database's v_j_*): a new one, or in the same stage the card's own.
        const j = given ?? kept;
        const justified = isValidJustification(j, t);
        const at = iso(t);
        const reset = changed || newJ;
        const assigned = args.p_place_id !== undefined && args.p_place_id !== null;
        const place = assigned ? args.p_place_id! : args.p_to === 'doing' && changed ? args.p_actor : card.place_id;
        const session = assigned
          ? args.p_place_id === args.p_actor
            ? (args.p_session_id ?? null)
            : null
          : args.p_to === 'doing' && changed
            ? (args.p_session_id ?? null)
            : args.p_actor === card.place_id && args.p_session_id
              ? args.p_session_id
              : card.session_id;
        db.prepare(
          `UPDATE cards SET stage = ?, stage_since = ?, note = ?, front = ?, justification = ?, justification_link = ?, justification_due = ?,
                  owner_reason = ?, done_summary = ?, woken_at = ?, charged_at = ?, charge_count = ?, justified_at = ?, leader_noticed_at = ?,
                  place_id = ?, session_id = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?`,
        ).run(
          args.p_to,
          changed ? at : card.stage_since,
          args.p_note !== undefined && args.p_note !== null ? left(args.p_note, 200) : changed ? null : card.note,
          args.p_front !== undefined && args.p_front !== null ? cleanFront(args.p_front) : card.front,
          // a justification lives in its stage: it goes away on a stage change unless a new one comes along
          reset ? (justified ? j!.text : null) : card.justification,
          reset ? (justified ? j!.link : null) : card.justification_link,
          reset ? (justified ? iso(j!.due) : null) : card.justification_due,
          args.p_to === 'waiting_owner' ? (reason ?? null) : null,
          args.p_to === 'done' ? (summary ?? null) : null,
          changed ? null : (card.woken_at ?? null),
          reset ? null : (card.charged_at ?? null),
          reset ? 0 : (card.charge_count ?? 0),
          newJ ? at : changed ? null : (card.justified_at ?? null),
          reset ? null : (card.leader_noticed_at ?? null),
          place,
          session,
          at,
          card.id,
          card.version,
        );
        if (leader) db.prepare('UPDATE lanes SET leader_seen_at = ? WHERE project_id = ? AND leader_place = ?').run(at, card.project_id, args.p_actor);
        const moved = cardById(card.id)!;
        logMove(moved, card.stage, args.p_actor, at);
        return moved;
      }),

    // board.touch_lane
    touchLane: async (projectId, leaderPlace, leaderSession, force) => {
      write(() => {
        const at = iso(now());
        const lane = db.prepare('SELECT * FROM lanes WHERE project_id = ?').get(projectId) as LaneRow | undefined;
        if (!lane) {
          db.prepare('INSERT INTO lanes (project_id, leader_place, leader_session, leader_seen_at) VALUES (?, ?, ?, ?)').run(projectId, leaderPlace, leaderSession ?? null, at);
          return;
        }
        const takes =
          force ||
          lane.leader_place === null ||
          lane.leader_place === leaderPlace ||
          lane.leader_seen_at === null ||
          Date.parse(lane.leader_seen_at) < now() - LEADER_ALIVE_MS;
        if (!takes) return;
        // a new Líder never inherits the previous one's conversation
        const session = lane.leader_place === leaderPlace ? (leaderSession ?? lane.leader_session) : (leaderSession ?? null);
        db.prepare('UPDATE lanes SET leader_place = ?, leader_session = ?, leader_seen_at = ? WHERE project_id = ?').run(leaderPlace, session, at, projectId);
      });
    },

    // board.reclassify_card
    reclassifyCard: async (cardId, projectId, actor) =>
      write(() => {
        if (!hasText(actor)) throw new BoardError('quem reclassifica é obrigatório (actor)');
        if (projectId === NO_PROJECT || !projectExists(projectId)) throw new BoardError(`projeto ${projectId} não existe`);
        const card = cardById(cardId);
        if (!card || card.project_id !== NO_PROJECT) throw new BoardError(`só cartão em sem-projeto se reclassifica (${cardId})`);
        const at = iso(now());
        db.prepare('UPDATE cards SET project_id = ?, note = ?, version = version + 1, updated_at = ? WHERE id = ?').run(projectId, left(`projeto: ${projectId}`, 200), at, cardId);
        const moved = cardById(cardId)!;
        logMove(moved, moved.stage, actor, at);
        return moved;
      }),

    // board.request_leader: idempotent by client_ref, and by project while one is pending
    requestLeader: async (projectId, actor, clientRef) =>
      write(() => {
        if (!hasText(actor)) throw new BoardError('quem pede é obrigatório (actor)');
        const find = (): LeaderRequestFull | undefined => {
          const row = db
            .prepare("SELECT * FROM leader_requests WHERE client_ref = ? OR (project_id = ? AND status = 'pending') ORDER BY (client_ref = ?) DESC LIMIT 1")
            .get(clientRef, projectId, clientRef);
          return row ? plain<LeaderRequestFull>(row) : undefined;
        };
        const existing = find();
        if (existing) return existing;
        db.prepare('INSERT INTO leader_requests (project_id, actor, client_ref, created_at) VALUES (?, ?, ?, ?)').run(projectId, actor, clientRef, iso(now()));
        return find()!;
      }),

    // board.mark_cron: not a move, the version stays (a session that read the card must still move it)
    markCron: async (cardId, kind) => {
      write(() => {
        if (kind !== 'woken' && kind !== 'charged' && kind !== 'leader') throw new BoardError(`marca desconhecida: ${String(kind)}`);
        const at = iso(now());
        if (kind === 'woken') db.prepare('UPDATE cards SET woken_at = ? WHERE id = ?').run(at, cardId);
        else if (kind === 'charged') db.prepare('UPDATE cards SET charged_at = ?, charge_count = charge_count + 1 WHERE id = ?').run(at, cardId);
        else db.prepare('UPDATE cards SET leader_noticed_at = ? WHERE id = ?').run(at, cardId);
      });
    },

    // board.vigia_note: only the note, on a card still in Fazendo and unjustified; no version bump; logged in moves
    vigiaNote: async (cardId, note) =>
      write(() => {
        if (!hasText(note)) throw new BoardError('a nota do vigia é obrigatória');
        const at = iso(now());
        const result = db
          .prepare("UPDATE cards SET note = ?, updated_at = ? WHERE id = ? AND stage = 'doing' AND justification IS NULL")
          .run(left(`vigia: ${btrim(note)}`, 200), at, cardId);
        if (Number(result.changes) === 0) return false;
        logMove(cardById(cardId)!, 'doing', 'vigia', at);
        return true;
      }),

    // board.resolve_leader_request
    resolveLeaderRequest: async (id, status, reason) => {
      write(() => {
        if (status !== 'done' && status !== 'failed') throw new BoardError(`estado desconhecido: ${String(status)}`);
        db.prepare("UPDATE leader_requests SET status = ?, reason = ?, handled_at = ? WHERE id = ? AND status = 'pending'").run(status, left(reason, 300), iso(now()), id);
      });
    },

    parkedOrDoing: (host) =>
      read(() =>
        db
          .prepare("SELECT c.* FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.stage IN ('doing', 'blocked') AND p.host = ? LIMIT 1000")
          .all(host)
          .map((row) => plain<CardRow>(row)),
      ),
    lanes: (host) =>
      read(() =>
        db
          .prepare('SELECT l.project_id, l.leader_place, l.leader_session, l.leader_seen_at FROM lanes l JOIN projects p ON p.id = l.project_id WHERE p.host = ?')
          .all(host)
          .map((row) => plain<LaneRow>(row)),
      ),
    pendingLeaderRequests: (host) =>
      read(() =>
        db
          .prepare("SELECT r.id, r.project_id, r.actor, r.created_at FROM leader_requests r JOIN projects p ON p.id = r.project_id WHERE r.status = 'pending' AND p.host = ? ORDER BY r.id")
          .all(host)
          .map((row) => plain<LeaderRequestRow>(row)),
      ),

    overview: () => read(() => overviewRows(db, now())),
    pageCards: () => read(() => pageCardRows(db, now())),
    // board.owner_feed
    ownerFeed: (afterId) =>
      read(() =>
        db
          .prepare(
            `SELECT m.id, m.card_id, m.project_id, m.to_stage, m.note, m.owner_reason, m.done_summary, c.title, c.owner_request, c.requested_by, c.oraculo_id, m.at
               FROM moves m JOIN cards c ON c.id = m.card_id
              WHERE m.id > ? AND m.from_stage IS NOT m.to_stage
                AND (m.to_stage = 'waiting_owner' OR (m.to_stage = 'done' AND c.requested_by = 'dono'))
              ORDER BY m.id`,
          )
          .all(afterId)
          .map((row) => plain<OwnerFeedRow>(row)),
      ),
    // board.lanes_without_leader
    lanesWithoutLeader: () =>
      read(() =>
        db
          .prepare(
            `SELECT p.id AS project_id, l.leader_place, l.leader_session, l.leader_seen_at
               FROM projects p LEFT JOIN lanes l ON l.project_id = p.id
              WHERE p.id <> 'sem-projeto' AND (l.leader_place IS NULL OR l.leader_seen_at IS NULL OR l.leader_seen_at < ?)`,
          )
          .all(iso(now() - LEADER_ALIVE_MS))
          .map((row) => plain<LaneRow>(row)),
      ),

    cardsWithTask: () =>
      read(() =>
        db
          .prepare(CARDS_WITH_TASK_SQL)
          .all(iso(now() - CARDS_WITH_TASK_DONE_MS))
          .map((row) => plain<CardRow>(row)),
      ),

    laneOf: (projectId) =>
      read(() => {
        const row = db.prepare('SELECT project_id, leader_place, leader_session, leader_seen_at FROM lanes WHERE project_id = ?').get(projectId);
        return row ? plain<LaneRow>(row) : null;
      }),
    fillSession: async (cardId, placeId, sessionId, replacing) =>
      write(() => {
        if (!hasText(sessionId)) throw new BoardError('a sessão é obrigatória');
        const result =
          replacing === undefined
            ? db.prepare('UPDATE cards SET session_id = ? WHERE id = ? AND session_id IS NULL AND place_id = ?').run(sessionId, cardId, placeId)
            : db.prepare('UPDATE cards SET session_id = ? WHERE id = ? AND session_id = ? AND place_id = ?').run(sessionId, cardId, replacing, placeId);
        return Number(result.changes) > 0;
      }),

    upsertProject: async (project) =>
      write(() => {
        if (!PROJECT_ID.test(project.id)) throw new BoardError(`id de projeto inválido: ${project.id} (minúsculas, dígitos e hífen)`);
        if (!hasText(project.name)) throw new BoardError('nome do projeto é obrigatório');
        const aliases = project.aliases.filter((alias) => hasText(alias));
        if (!projectExists(project.id)) {
          db.prepare('INSERT INTO projects (id, name, host, aliases, created_at) VALUES (?, ?, ?, ?, ?)').run(project.id, project.name, project.host ?? 'vps-pessoal', JSON.stringify([...new Set(aliases)]), iso(now()));
        } else {
          const merged = [...new Set([...projectRow(project.id).aliases, ...aliases])];
          db.prepare('UPDATE projects SET aliases = ? WHERE id = ?').run(JSON.stringify(merged), project.id);
        }
        return projectRow(project.id);
      }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Which board the daemon and the cron open

export const BOARD_SQLITE_CONFIG = 'sqlite.json';

/** `{ "file": "<path>" }` → the database's absolute path; null when missing or malformed. */
export function readBoardSqliteConfig(configFile: string, home = homedir()): string | null {
  try {
    const raw = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
    if (typeof raw.file !== 'string' || !hasText(raw.file)) return null;
    const file = raw.file.trim();
    if (file === '~' || file.endsWith('/')) return null;
    if (file.startsWith('~/')) return join(home, file.slice(2));
    return isAbsolute(file) ? file : resolve(dirname(configFile), file);
  } catch {
    return null;
  }
}

export type BoardChoice =
  | { readonly kind: 'sqlite'; readonly key: string; readonly file: string }
  | { readonly kind: 'supabase'; readonly key: string; readonly config: NonNullable<ReturnType<typeof readBoardConfig>> }
  | { readonly kind: 'invalid'; readonly file: string; readonly expected: string }
  | { readonly kind: 'off' };

/**
 * sqlite.json present and valid → the SQLite; present and invalid → `invalid` (never the Supabase behind the owner's
 * back); missing → supabase.json, as before; neither → off. Reads the config only: `openBoard` opens it.
 */
export function chooseBoard(paths: { readonly sqliteConfig: string; readonly supabaseConfig: string }, home = homedir()): BoardChoice {
  if (existsSync(paths.sqliteConfig)) {
    const file = readBoardSqliteConfig(paths.sqliteConfig, home);
    if (!file) return { kind: 'invalid', file: paths.sqliteConfig, expected: '{"file": "<caminho do board.sqlite>"}' };
    return { kind: 'sqlite', key: `sqlite|${file}`, file };
  }
  if (!existsSync(paths.supabaseConfig)) return { kind: 'off' };
  const config = readBoardConfig(paths.supabaseConfig);
  if (!config) return { kind: 'invalid', file: paths.supabaseConfig, expected: '{"url": "https://…", "serviceKeyFile": "…"}' };
  return { kind: 'supabase', key: `supabase|${config.url}|${config.serviceKeyFile}`, config };
}

export function openBoard(choice: Extract<BoardChoice, { kind: 'sqlite' | 'supabase' }>): BoardStore & BoardCronStore & { close?: () => void } {
  return choice.kind === 'sqlite' ? createBoardSqlite(choice.file) : createBoardClient(choice.config);
}
