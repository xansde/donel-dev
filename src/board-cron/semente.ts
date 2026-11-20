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

import { existsSync, readFileSync } from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { progressOf, type LedgerProgress } from '../shared/ledger/andamento';
import { awaitsSend, frenteOf, isClosed, requestedByOf, type LedgerTask } from '../shared/ledger/contract';
import { projectFolderOf } from '../oraculo/board-client';
import type { BoardSqliteStore, ProjectInput } from '../oraculo/board-sqlite';

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
}

export interface SeedPlan {
  readonly projects: readonly ProjectInput[];
  readonly cards: readonly CardSeed[];
  /** Tasks left out: closed, or an accepted Slack letter that only waits for its send. */
  readonly skipped: number;
}

export interface SeedOptions {
  /** `projects.host` of new projects. */
  readonly host: string;
  /** This machine's home: its `<home>/seazone/<Pasta>` becomes an alias. */
  readonly vpsHome: string;
  /** The PC's `...\seazone` folder; missing = taken from the Windows paths of the ledger itself. */
  readonly pcRoot?: string;
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
    return {
      taskId: task.id,
      projectId: projects.has(slug) ? slug : NO_PROJECT,
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
    };
  });
  return {
    projects: [...projects].sort(([a], [b]) => a.localeCompare(b)).map(([id, project]) => ({ id, name: project.name, host: options.host, aliases: [...project.aliases] })),
    cards,
    skipped: Object.keys(ledger.tasks).length - live.length,
  };
}

export interface SeedResult {
  readonly projects: number;
  readonly created: number;
  readonly existing: number;
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
    if (card.version !== 1) continue;
    const moved = await store.moveCard({
      p_card_id: card.id,
      p_to: seed.stage,
      p_actor: SEED_ACTOR,
      p_expected_version: 1,
      p_note: seed.note,
      ...(seed.stage === 'doing' && seed.place ? { p_place_id: seed.place } : {}),
      p_as_leader: true,
    });
    log(`${seed.taskId} → ${moved.id} (${moved.project_id}, ${moved.stage}): ${seed.note}`);
  }
  return { projects: plan.projects.length, created, existing };
}
