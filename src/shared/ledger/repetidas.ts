// Livro F7 — pedidos repetidos e tarefa-pai, só simulação (docs/planos/ledger-bom.md). Pure: it reads views of tasks
// and proposes groups; nothing is written. The F9 lançamento `agrupar` is what would record a group.
//
// Two tasks carry the same request when they carry the same sentence of who asked (`requestKey`), were born on the
// same board and the later one came at most REPEAT_WINDOW_MS after the group's root (the oldest). The sentence of who
// asked is, in this order: the message cited on the first line (the Slack permalink of "Fulano, DM, data — link"),
// the sentence quoted at the start ("…" or «…», then who said it and the context), or the whole text normalized. No
// length cut: a rule that depends on where the text is cut was tuned to a count, not to what the requests are.
//
// A group is a parent request with its children (T1, "N de M prontas"): most groups are SISTERS (one request split
// into tasks, each with its own criterion), not copies. `sameWork` says when every member also has the same
// criterion: only then is a member provably the same work as the root (the cleanup archives only those).

export const REPEAT_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface PedidoView {
  readonly id: string;
  /** The board (project folder); `null` = unknown (a task born after the copy that gave the boards). */
  readonly board: string | null;
  /** The literal request. */
  readonly request: string;
  /** Ms; `null` = unknown. */
  readonly createdAt: number | null;
  /** When `createdAt` is unknown: the task was born after this (the instant of the copy that gave the dates). */
  readonly bornAfter?: number;
  /** Done when… (the criterion); compared to tell a copy of the same work from a sister. */
  readonly criterion?: string;
}

export interface RepeatGroup {
  /** The oldest task: it keeps the owner's sentence and becomes the parent. */
  readonly root: string;
  /** The others, oldest first. */
  readonly children: readonly string[];
  readonly board: string | null;
  /** Every task of the group has exactly the same normalized request text. */
  readonly sameText: boolean;
  /** Same text and the same normalized criterion in every task: copies of one work, not sisters. */
  readonly sameWork: boolean;
  /** Some member has no known date: the window was checked only with the bounds (born after the copy, before now). */
  readonly undated: boolean;
}

export function normalizeRequest(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const SLACK_PERMALINK = /https:\/\/[\w.-]*slack\.com\/archives\/[A-Z0-9]+\/p\d+/;
const LEADING_QUOTE = /^\s*(?:"((?:[^"\\]|\\.)+)"|«([^»]+)»|“([^”]+)”)/;

/** The sentence of who asked, normalized (see the header); `''` = nothing to compare. */
export function requestKey(text: string): string {
  const cited = SLACK_PERMALINK.exec(text.split('\n', 1)[0] ?? '');
  if (cited) return `slack ${cited[0]}`;
  const quoted = LEADING_QUOTE.exec(text);
  const sentence = quoted ? normalizeRequest(quoted[1] ?? quoted[2] ?? quoted[3] ?? '') : '';
  return sentence || normalizeRequest(text);
}

interface Cluster {
  readonly root: PedidoView;
  board: string | null;
  readonly members: PedidoView[];
}

export interface RepeatOptions {
  /** The instant of the list: the latest a task of unknown date can have been born. Absent = unknown dates never join. */
  readonly now?: number;
}

/** The earliest and latest the task can have been born. */
function birth(item: PedidoView, now: number | undefined): readonly [number, number] {
  if (item.createdAt !== null) return [item.createdAt, item.createdAt];
  return [item.bornAfter ?? Number.NEGATIVE_INFINITY, now ?? Number.POSITIVE_INFINITY];
}

const byAge = (a: PedidoView, b: PedidoView): number =>
  (a.createdAt ?? a.bornAfter ?? Number.POSITIVE_INFINITY) - (b.createdAt ?? b.bornAfter ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id);

/** Same board, or one of them unknown; and provably inside the window of the root, even at the far ends of the bounds. */
function fits(cluster: Cluster, item: PedidoView, now: number | undefined): boolean {
  if (cluster.board !== null && item.board !== null && cluster.board !== item.board) return false;
  const [rootFirst, rootLast] = birth(cluster.root, now);
  const [itemFirst, itemLast] = birth(item, now);
  return Math.max(itemLast - rootFirst, rootLast - itemFirst) <= REPEAT_WINDOW_MS;
}

const sameAll = (values: readonly string[]): boolean => new Set(values).size === 1;

export function repeatGroups(items: readonly PedidoView[], options: RepeatOptions = {}): RepeatGroup[] {
  const buckets = new Map<string, PedidoView[]>();
  for (const item of items) {
    const key = requestKey(item.request);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const groups: RepeatGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const clusters: Cluster[] = [];
    for (const item of [...bucket].sort(byAge)) {
      // The newest root that fits: a task of unknown date is newer than every dated one.
      const cluster = [...clusters].reverse().find((candidate) => fits(candidate, item, options.now));
      if (!cluster) clusters.push({ root: item, board: item.board, members: [item] });
      else {
        cluster.members.push(item);
        cluster.board ??= item.board;
      }
    }
    for (const cluster of clusters) {
      if (cluster.members.length < 2) continue;
      const sameText = sameAll(cluster.members.map((member) => normalizeRequest(member.request)));
      groups.push({
        root: cluster.root.id,
        children: cluster.members.slice(1).map((member) => member.id),
        board: cluster.board,
        sameText,
        sameWork: sameText && sameAll(cluster.members.map((member) => normalizeRequest(member.criterion ?? ''))) && cluster.members.every((member) => member.criterion),
        undated: cluster.members.some((member) => member.createdAt === null),
      });
    }
  }
  return groups;
}

/** child id → root id. */
export function rootOf(groups: readonly RepeatGroup[]): Map<string, string> {
  return new Map(groups.flatMap((group) => group.children.map((child): [string, string] => [child, group.root])));
}
