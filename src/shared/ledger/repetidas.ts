// Livro F7 — pedidos repetidos e tarefa-pai, só simulação (docs/planos/ledger-bom.md). Pure: it reads views of tasks
// and proposes groups; nothing is written. The F9 lançamento `agrupar` is what would record a group.
//
// Two tasks carry the same request when, after normalizing (case, accents, punctuation, spaces), the first
// REQUEST_HEAD_CHARS characters are equal, they were born on the same board and the later one came at most
// REPEAT_WINDOW_MS after the group's root (the oldest). The head, not the whole text, because a request split into
// several tasks keeps the owner's literal sentence on top and only the tail changes (the same Slack message cited, then
// one ask per task). On the copy of 07/11 the whole text gives 41 groups / 99 tasks; the head adds the 8 split ones:
// 49 / 116, the count the plan measured.

export const REQUEST_HEAD_CHARS = 240;
export const REPEAT_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface PedidoView {
  readonly id: string;
  /** The board (project folder); `null` = unknown (a task born after the copy that gave the boards). */
  readonly board: string | null;
  /** The literal request. */
  readonly request: string;
  /** Ms; `null` = unknown. */
  readonly createdAt: number | null;
}

export interface RepeatGroup {
  /** The oldest task: it keeps the owner's sentence and becomes the parent. */
  readonly root: string;
  /** The others, oldest first. */
  readonly children: readonly string[];
  readonly board: string | null;
  /** Every task of the group has exactly the same normalized request (not only the same head). */
  readonly sameText: boolean;
}

export function normalizeRequest(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

interface Cluster {
  readonly root: PedidoView;
  board: string | null;
  readonly members: PedidoView[];
}

const byAge = (a: PedidoView, b: PedidoView): number =>
  (a.createdAt ?? Number.POSITIVE_INFINITY) - (b.createdAt ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id);

/** Same board, or one of them unknown; and inside the window of the root (an unknown date does not break it). */
function fits(cluster: Cluster, item: PedidoView): boolean {
  if (cluster.board !== null && item.board !== null && cluster.board !== item.board) return false;
  if (cluster.root.createdAt === null || item.createdAt === null) return true;
  return item.createdAt - cluster.root.createdAt <= REPEAT_WINDOW_MS;
}

export function repeatGroups(items: readonly PedidoView[]): RepeatGroup[] {
  const buckets = new Map<string, PedidoView[]>();
  for (const item of items) {
    const head = normalizeRequest(item.request).slice(0, REQUEST_HEAD_CHARS);
    if (!head) continue;
    const bucket = buckets.get(head);
    if (bucket) bucket.push(item);
    else buckets.set(head, [item]);
  }
  const groups: RepeatGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const clusters: Cluster[] = [];
    for (const item of [...bucket].sort(byAge)) {
      // The newest root that fits: a task of unknown date is newer than every dated one.
      const cluster = [...clusters].reverse().find((candidate) => fits(candidate, item));
      if (!cluster) clusters.push({ root: item, board: item.board, members: [item] });
      else {
        cluster.members.push(item);
        cluster.board ??= item.board;
      }
    }
    for (const cluster of clusters) {
      if (cluster.members.length < 2) continue;
      const texts = new Set(cluster.members.map((member) => normalizeRequest(member.request)));
      groups.push({ root: cluster.root.id, children: cluster.members.slice(1).map((member) => member.id), board: cluster.board, sameText: texts.size === 1 });
    }
  }
  return groups;
}

/** child id → root id. */
export function rootOf(groups: readonly RepeatGroup[]): Map<string, string> {
  return new Map(groups.flatMap((group) => group.children.map((child): [string, string] => [child, group.root])));
}
