// T027 (014-chat) — agrupamento de ações (contracts/conversation-rows.md §5).
// Puro e determinístico: a mesma sequência de linhas dá sempre os mesmos grupos
// e o id do grupo é estável enquanto ele cresce.

import type { ActionCategory, ActionGroupRow, ActionRow, ConversationRow, RowScope } from './rows';

const CATEGORY_ORDER: readonly ActionCategory[] = [
  'read', 'edit', 'write', 'bash', 'search', 'web', 'agent', 'skill', 'mcp', 'task', 'other',
];

const CATEGORY_VERB: Readonly<Record<ActionCategory, string>> = {
  read: 'leu',
  edit: 'editou',
  write: 'escreveu',
  bash: 'rodou',
  search: 'buscou',
  web: 'consultou a web',
  agent: 'lançou subagente',
  skill: 'usou skill',
  mcp: 'usou MCP',
  task: 'mexeu em tarefas',
  other: 'usou outras',
};

const MAX_LABEL_CATEGORIES = 3;

function emptyCounts(): Record<ActionCategory, number> {
  const c = {} as Record<ActionCategory, number>;
  for (const k of CATEGORY_ORDER) c[k] = 0;
  return c;
}

function sameScope(a: RowScope, b: RowScope): boolean {
  if (a === 'main' || b === 'main') return a === b;
  return a.agentId === b.agentId;
}

/** Header label: "N ações — leu a, editou b, rodou c" (top 3 by count, rest as "e mais k"). */
export function groupLabel(counts: Readonly<Record<ActionCategory, number>>): string {
  const present = CATEGORY_ORDER.map((category, order) => ({ category, order, n: counts[category] ?? 0 })).filter((e) => e.n > 0);
  const total = present.reduce((sum, e) => sum + e.n, 0);
  present.sort((a, b) => b.n - a.n || a.order - b.order);
  const shown = present.slice(0, MAX_LABEL_CATEGORIES);
  const rest = present.slice(MAX_LABEL_CATEGORIES).reduce((sum, e) => sum + e.n, 0);
  let text = shown.map((e) => `${CATEGORY_VERB[e.category]} ${e.n}`).join(', ');
  if (rest > 0) text += ` e mais ${rest}`;
  return `${total} ações — ${text}`;
}

/** Collapsed-header failure line: "1 falhou: Rodou `npm test`". Empty when nothing failed. */
export function failureLabel(failed: readonly ActionRow[]): string {
  if (failed.length === 0) return '';
  const head = failed.length === 1 ? '1 falhou' : `${failed.length} falharam`;
  const items = failed.map((a) => {
    const { verb, target } = a.summary;
    return target ? `${verb} \`${target}\`` : verb;
  });
  return `${head}: ${items.join(', ')}`;
}

function buildGroup(run: readonly (ActionRow | ConversationRow)[]): ActionGroupRow {
  const actions = run.filter((r): r is ActionRow => r.kind === 'action');
  const first = actions[0]!;
  const counts = emptyCounts();
  const failed: string[] = [];
  for (const a of actions) {
    counts[a.category] += 1;
    if (a.status === 'error') failed.push(a.id);
  }
  return {
    kind: 'action-group',
    id: `group:${first.toolUseId}`,
    turnId: first.turnId,
    at: first.at,
    scope: first.scope,
    // Actions and the thinking rows absorbed between them, in order.
    children: run.map((r) => r.id),
    counts,
    failed,
  };
}

/**
 * Replaces each run of 2+ actions (same turn and scope; `thinking` rows between
 * them are absorbed) with one `action-group` row. Everything else passes through.
 * Group `children` lists the action ids plus absorbed thinking ids, in order;
 * `counts` and `failed` cover actions only. Leading/trailing thinking stays outside.
 */
export function groupActions(rows: readonly ConversationRow[]): ConversationRow[] {
  const out: ConversationRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind !== 'action') {
      out.push(row);
      i += 1;
      continue;
    }
    // Extend the run: actions and thinking of the same turn/scope; remember where the last action is.
    let j = i + 1;
    let lastAction = i;
    while (j < rows.length) {
      const next = rows[j]!;
      if (next.kind !== 'action' && next.kind !== 'thinking') break;
      if (next.turnId !== row.turnId || !sameScope(next.scope, row.scope)) break;
      if (next.kind === 'action') lastAction = j;
      j += 1;
    }
    const run = rows.slice(i, lastAction + 1);
    if (run.filter((r) => r.kind === 'action').length >= 2) {
      out.push(buildGroup(run));
    } else {
      out.push(...run);
    }
    i = lastAction + 1;
  }
  return out;
}
