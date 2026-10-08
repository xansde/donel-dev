// T031 (014-chat) — Modo Foco (data-model.md §5, FR-009): transformação de vista
// pura. Por rodada mostra a mensagem do dono e a resposta final; o resto vira
// um bloco recolhido. Exceção (D-C19): a mensagem do Claude que lança
// subagentes e as linhas `subagent` ficam fora da dobra, na posição delas.

import type { ConversationRow, FocusItem, Turn } from './rows';

// Trailing characters ignored when deciding whether a note ends in a question:
// whitespace and closing/emphasis markdown (never "." — "?." is not a question).
const TRAILING_MARKDOWN = /[\s*_`~)\]>"'”’]+$/u;

function endsWithQuestion(markdown: string): boolean {
  return markdown.replace(TRAILING_MARKDOWN, '').endsWith('?');
}

function actionsIn(row: ConversationRow): number {
  if (row.kind === 'action') return 1;
  if (row.kind === 'action-group') return Object.values(row.counts).reduce((a, b) => a + b, 0);
  return 0;
}

/** Ids of assistant rows that launch the subagent rows following them (thinking in between is skipped). */
function launcherIds(ids: readonly string[], byId: ReadonlyMap<string, ConversationRow>): Set<string> {
  const launchers = new Set<string>();
  for (let k = 0; k < ids.length; k += 1) {
    if (byId.get(ids[k]!)?.kind !== 'subagent') continue;
    for (let b = k - 1; b >= 0; b -= 1) {
      const prev = byId.get(ids[b]!);
      if (prev?.kind === 'subagent' || prev?.kind === 'thinking') continue;
      if (prev?.kind === 'assistant') launchers.add(prev.id);
      break;
    }
  }
  return launchers;
}

/**
 * Folds each turn for Focus Mode. A turn still in progress shows the owner
 * message plus the partial folded block (its `finalRowId` is ignored until it
 * closes). Folded `actions` counts actions inside groups; `notes` counts
 * assistant rows; other folded rows (thinking, skills, notices...) only appear in `rows`.
 */
export function foldForFocus(turns: readonly Turn[], rows: readonly ConversationRow[]): FocusItem[] {
  const byId = new Map<string, ConversationRow>();
  for (const r of rows) byId.set(r.id, r);

  const out: FocusItem[] = [];
  for (const turn of turns) {
    const launchers = launcherIds(turn.rows, byId);
    const finalId = turn.complete ? turn.finalRowId : null;

    let pending: { actions: number; notes: number; hasQuestion: boolean; rows: string[] } | null = null;
    const flush = (): void => {
      if (pending && pending.rows.length > 0) out.push({ kind: 'folded', ...pending });
      pending = null;
    };

    for (const id of turn.rows) {
      const row = byId.get(id);
      const shown = row !== undefined && (row.kind === 'user' || row.kind === 'subagent' || id === finalId || launchers.has(id));
      if (shown) {
        flush();
        out.push({ kind: 'row', rowId: id });
        continue;
      }
      pending ??= { actions: 0, notes: 0, hasQuestion: false, rows: [] };
      pending.rows.push(id);
      if (!row) continue;
      pending.actions += actionsIn(row);
      if (row.kind === 'assistant') {
        pending.notes += 1;
        if (endsWithQuestion(row.markdown)) pending.hasQuestion = true;
      }
    }
    flush();
  }
  return out;
}
