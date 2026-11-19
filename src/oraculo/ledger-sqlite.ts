// O ledger do Oráculo num SQLite local da VPS (dono, 18/11: "Ta na minha conta pessoal. Vamos trazer para um sqlite
// local mesmo. Acho que vai ser a melhor solução sem custos"). The same `LedgerStore` the Supabase was
// (ledger-supabase.ts): the daemon is the only writer and keeps the document in memory; every op writes the tasks that
// changed, in one transaction, BEFORE answering, and a write the disk refused is refused (the memory stays as the disk
// has it). Unlike the ledger.json, an op writes only what changed, not the 11 MB again.
//
// `<dir>/ledger.sqlite` (WAL, synchronous FULL). Tables: `tarefas(id, doc, atualizado_em)` and `meta(id=1,
// schema_version, started_at)`. Once seeded, `<dir>/ledger.fonte` says `sqlite`: a database gone missing stops the
// daemon instead of letting it start an empty ledger. Way back: `--exportar-sqlite <arquivo>` writes a ledger.json.

import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { LedgerDoc } from '../shared/ledger/contract';
import type { LedgerStore } from '../main/ledger-store';
import { canonicalJson } from './ledger-supabase';

// Loaded at run time: the bundlers (vite) drop the `node:` of `node:sqlite`, a builtin that only exists with it.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

export const LEDGER_SQLITE_FILE = 'ledger.sqlite';
/** Written when the SQLite is seeded: from then on a missing database is an error, never an empty ledger. */
export const LEDGER_SOURCE_MARK = 'ledger.fonte';

type RawDoc = { schemaVersion: unknown; startedAt: unknown; tasks: Record<string, unknown> };

export interface SqliteLedgerStore extends LedgerStore {
  count(): number;
  close(): void;
}

function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(
    'CREATE TABLE IF NOT EXISTS tarefas (id TEXT PRIMARY KEY, doc TEXT NOT NULL, atualizado_em TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER, started_at INTEGER);',
  );
  return db;
}

function readAll(db: DatabaseSync): RawDoc & { exists: boolean } {
  const head = db.prepare('SELECT schema_version, started_at FROM meta WHERE id = 1').get() as { schema_version: number | null; started_at: number | null } | undefined;
  const tasks: Record<string, unknown> = {};
  for (const row of db.prepare('SELECT id, doc FROM tarefas ORDER BY id').all() as Array<{ id: string; doc: string }>) tasks[row.id] = JSON.parse(row.doc) as unknown;
  return { exists: head !== undefined, schemaVersion: head?.schema_version ?? null, startedAt: head?.started_at ?? null, tasks };
}

export function openSqliteLedgerStore(file: string, log: (line: string) => void = () => undefined, options: { readonly requireSeeded?: boolean } = {}): SqliteLedgerStore {
  const db = open(file);
  const initial = readAll(db);
  // The daemon's source: every seed writes the header row; a database without it (an empty file, a wrong copy) never
  // becomes an empty ledger that answers (revisão do #496, as the Supabase's `initial.exists`).
  if (options.requireSeeded && !initial.exists) {
    db.close();
    throw new Error(`${file} não tem o cabeçalho do ledger (meta): não é um banco semeado. O daemon não sobe vazio.`);
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // a read-only place: the folder (0700) still covers it
  }
  const persisted = new Map<string, string>(Object.entries(initial.tasks).map(([id, task]) => [id, canonicalJson(task)]));
  let current: RawDoc | null = initial.exists || persisted.size > 0 ? { schemaVersion: initial.schemaVersion, startedAt: initial.startedAt, tasks: { ...initial.tasks } } : null;
  let head = initial.exists ? JSON.stringify([initial.schemaVersion, initial.startedAt]) : null;
  let closed = false;

  return {
    read: () => current,
    count: () => persisted.size,
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
    async write(doc: LedgerDoc): Promise<boolean> {
      const changed: Array<{ id: string; json: string }> = [];
      for (const [id, task] of Object.entries(doc.tasks)) {
        const json = canonicalJson(task);
        if (persisted.get(id) !== json) changed.push({ id, json });
      }
      const gone = [...persisted.keys()].filter((id) => !(id in doc.tasks));
      const nextHead = JSON.stringify([doc.schemaVersion, doc.startedAt]);
      try {
        if (closed) throw new Error('o banco está fechado');
        const at = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const upsert = db.prepare('INSERT INTO tarefas (id, doc, atualizado_em) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, atualizado_em = excluded.atualizado_em');
          for (const row of changed) upsert.run(row.id, row.json, at);
          const remove = db.prepare('DELETE FROM tarefas WHERE id = ?');
          for (const id of gone) remove.run(id);
          if (head !== nextHead) {
            db.prepare('INSERT INTO meta (id, schema_version, started_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, started_at = excluded.started_at').run(
              doc.schemaVersion as number,
              (doc.startedAt ?? null) as number | null,
            );
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch (error) {
        log(`[ledger] o SQLite não gravou: ${error instanceof Error ? error.message : 'erro'}`);
        return false;
      }
      for (const row of changed) persisted.set(row.id, row.json);
      for (const id of gone) persisted.delete(id);
      head = nextHead;
      current = doc as unknown as RawDoc;
      return true;
    },
  };
}

/**
 * `oraculo.mjs --semear-sqlite`: a NEW `ledger.sqlite` from the ledger.json (never over an existing one), read back
 * and compared task by task, then the mark `ledger.fonte`. Run with the daemon stopped.
 */
export async function seedSqliteLedger(file: string, doc: LedgerDoc): Promise<{ tarefas: number; diferentes: number }> {
  if (existsSync(file)) throw new Error(`${file} já existe: nada foi gravado`);
  // A WAL left by an older database (a daemon stopped without closing it) would be replayed over the new file on its
  // first open: the seed would check fine and the daemon would open another ledger (revisão do #496).
  for (const side of [`${file}-wal`, `${file}-shm`]) if (existsSync(side)) throw new Error(`${side} existe (de um banco anterior): nada foi gravado. Ponha-o de lado junto do banco a que pertence.`);
  // Built beside, renamed into place only once it checks, the mark last: a seed cut midway leaves no database the
  // daemon would take (revisão do #496).
  const building = `${file}.semeando`;
  for (const leftover of [building, `${building}-wal`, `${building}-shm`]) rmSync(leftover, { force: true });
  const store = openSqliteLedgerStore(building);
  const wrote = await store.write(doc);
  store.close();
  const check = new DatabaseSync(building);
  const back = readAll(check);
  check.close();
  const ids = Object.keys(doc.tasks);
  const header = back.schemaVersion === doc.schemaVersion && (back.startedAt ?? null) === (doc.startedAt ?? null) ? 0 : 1;
  const diferentes = header + ids.filter((id) => canonicalJson(back.tasks[id]) !== canonicalJson(doc.tasks[id])).length + Math.abs(Object.keys(back.tasks).length - ids.length);
  if (!wrote || diferentes !== 0) {
    for (const leftover of [building, `${building}-wal`, `${building}-shm`]) rmSync(leftover, { force: true });
    return { tarefas: Object.keys(back.tasks).length, diferentes: diferentes || 1 };
  }
  renameSync(building, file);
  writeFileSync(join(dirname(file), LEDGER_SOURCE_MARK), 'sqlite\n', { mode: 0o600 });
  return { tarefas: Object.keys(back.tasks).length, diferentes: 0 };
}

/** The way back: the SQLite's ledger as a ledger.json (a new file only). */
export function exportSqliteLedger(file: string, target: string): { tarefas: number } {
  // Never opens (and so never creates) a database that is not there.
  if (!existsSync(file)) throw new Error(`${file} não existe: nada a exportar`);
  // Read-only (Node 22.12+; the type here is older): the export never writes the database it reads.
  const db = new DatabaseSync(file, { readOnly: true } as never);
  const doc = readAll(db);
  db.close();
  writeFileSync(target, JSON.stringify({ schemaVersion: doc.schemaVersion, startedAt: doc.startedAt, tasks: doc.tasks }, null, 2), { mode: 0o600, flag: 'wx' });
  return { tarefas: Object.keys(doc.tasks).length };
}

/** Where the daemon's ledger lives: the SQLite when it is there; seeded once and gone = an error, never empty. */
export function ledgerSourceOf(dir: string): 'sqlite' | 'supabase' | 'arquivo' {
  const seeded = (() => {
    try {
      return readFileSync(join(dir, LEDGER_SOURCE_MARK), 'utf8').trim() === 'sqlite';
    } catch {
      return false;
    }
  })();
  const present = existsSync(join(dir, LEDGER_SQLITE_FILE));
  if (present && seeded) return 'sqlite';
  if (present) throw new Error(`${join(dir, LEDGER_SQLITE_FILE)} existe sem a marca ${LEDGER_SOURCE_MARK}: a semeadura não terminou, ou a marca se perdeu. NÃO apague o banco: ponha-o de lado com o -wal e o -shm dele; se houver ledger.json, semeie de novo (--semear-sqlite); se não houver (ele vira ledger.json.antes-sqlite-* na semeadura), o banco é a única cópia: volte a marca (echo sqlite > ${LEDGER_SOURCE_MARK}) ou exporte-o (--exportar-sqlite).`);
  if (seeded) throw new Error(`${join(dir, LEDGER_SQLITE_FILE)} sumiu, mas o ledger foi semeado nele (${LEDGER_SOURCE_MARK}): o daemon não sobe vazio. Volte o banco com o -wal e o -shm dele, ou volte ao ledger.json com --exportar-sqlite de uma cópia.`);
  if (existsSync(join(dir, 'ledger-supabase.json'))) return 'supabase';
  return 'arquivo';
}
