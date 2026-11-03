// Segundo plano visível (refinamento de 03/11, docs/refinamentos/segundo-plano-visivel.md) - what a session left
// running in the background, derived from the FLAT conversation rows (the adapter already folded the launch, the
// launch result, the `<task-notification>` and `TaskStop` into each row). Pure: the main computes it for the
// live state of every tab; the chat, the tab bar and the status bar only read it.
//
// The rule that must never lie: "rodando" = launched and no end seen, AND the CLI process that launched it is
// the one alive now. A background task dies with its process, so a launch from before this process (a resumed
// conversation) or a session that ended can no longer be running: it is `unknown`, never a guessed end.

import type { BackgroundState, BackgroundTask, ConversationRow, SubagentStatus } from './rows';

export interface DeriveBackgroundOptions {
  /** The tab's CLI process is alive. */
  readonly processAlive: boolean;
  /** When this process started (epoch ms): launches written before it belong to a dead process. */
  readonly processSince?: number;
  /** How many ended tasks to keep after the running ones (newest first). Default 5. */
  readonly keepEnded?: number;
}

const AGENT_STATE: Readonly<Record<SubagentStatus, BackgroundState>> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped',
  stopped: 'stopped',
  unknown: 'unknown',
};

function launchOf(row: ConversationRow): BackgroundTask | null {
  if (row.kind === 'action' && row.background !== undefined) {
    const monitor = row.tool === 'Monitor';
    const label = row.background.label ?? row.summary.target ?? (monitor ? 'monitor' : row.tool);
    return {
      id: row.toolUseId,
      rowId: row.id,
      kind: monitor ? 'monitor' : 'command',
      label,
      startedAt: row.at,
      state: row.background.state,
      ...(row.background.endedAt !== undefined ? { endedAt: row.background.endedAt } : {}),
    };
  }
  if (row.kind === 'subagent' && row.background && row.scope === 'main') {
    return {
      id: row.toolUseId,
      rowId: row.id,
      kind: 'agent',
      label: row.description !== '' ? row.description : row.agentType,
      startedAt: row.startedAt,
      state: AGENT_STATE[row.status],
      ...(row.endedAt !== undefined ? { endedAt: row.endedAt } : {}),
    };
  }
  return null;
}

/** Running tasks first (in launch order), then the last `keepEnded` that ended (newest first). */
export function deriveBackgroundTasks(rows: readonly ConversationRow[], opts: DeriveBackgroundOptions): BackgroundTask[] {
  const running: BackgroundTask[] = [];
  const ended: BackgroundTask[] = [];
  for (const row of rows) {
    const task = launchOf(row);
    if (task === null) continue;
    if (task.state === 'running') {
      const launched = Date.parse(task.startedAt);
      const fromDeadProcess = opts.processSince !== undefined && Number.isFinite(launched) && launched < opts.processSince;
      if (!opts.processAlive || fromDeadProcess) ended.push({ ...task, state: 'unknown' });
      else running.push(task);
    } else {
      ended.push(task);
    }
  }
  const when = (t: BackgroundTask): number => Date.parse(t.endedAt ?? t.startedAt) || 0;
  ended.sort((a, b) => when(b) - when(a));
  return [...running, ...ended.slice(0, opts.keepEnded ?? 5)];
}

export function runningCount(tasks: readonly BackgroundTask[] | null | undefined): number {
  let n = 0;
  for (const t of tasks ?? []) if (t.state === 'running') n += 1;
  return n;
}

/** Cheap equality key (the hub emits a live update only when this changes). */
export function backgroundKey(tasks: readonly BackgroundTask[]): string {
  return tasks.map((t) => `${t.id}:${t.state}`).join(',');
}

// ---- pt-BR labels (shared by the chat, the tab bar and the status bar) ----------------------------------

export const BACKGROUND_STATE_LABEL: Readonly<Record<BackgroundState, string>> = {
  running: 'rodando',
  completed: 'terminou',
  failed: 'falhou',
  stopped: 'parada',
  unknown: 'estado desconhecido',
};

export const BACKGROUND_KIND_LABEL: Readonly<Record<BackgroundTask['kind'], string>> = {
  command: 'comando',
  agent: 'agente',
  monitor: 'monitor',
};

/** "2 em segundo plano". */
export function backgroundCountLabel(n: number): string {
  return `${n} em segundo plano`;
}

/** "há 3 min" / "há 1 h 05". */
export function sinceLabel(fromIso: string, now: number): string {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return '';
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h} h ${String(m % 60).padStart(2, '0')}`;
}
