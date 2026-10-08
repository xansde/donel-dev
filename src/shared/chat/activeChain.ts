// T023 (014-chat) - active chain of the transcript TREE,
// specs/014-chat/contracts/conversation-rows.md §3. Pure.
//
// The JSONL is a tree (`parentUuid`), not a list: rewinds and abandoned prompts
// make branches; hook attachments and parallel tool results are side leaves.
// Three entry points share one set of rules:
//   - `buildActiveChain(lines)` : whole set, in FILE order;
//   - `BackwardChain`           : lines fed from the end of the file (pager);
//   - `ForwardChain`            : lines fed as they are appended (follower).
//
// Rules (§3): leaf = LAST user/assistant/system node in file order; climb by
// `parentUuid`; `parentUuid: null` + `logicalParentUuid` jumps a compaction;
// unresolved parent = root; every line sharing a `message.id` with a chain line
// joins; `tool_result`s are pinned by `tool_use_id`. Attachments chained AFTER
// the leaf ("trailing", e.g. a prompt queued mid-turn) are part of the result.
// Noise attachments (`noise: true`) are chain links only - they are walked
// through but never listed in `lines`.

import type { TranscriptEntry } from './rows';

export type ChainLine = Extract<TranscriptEntry, { k: 'node' } | { k: 'unknown' }>;

export interface Compaction {
  /** uuid of the `compact_boundary` line. */
  readonly uuid: string;
  readonly logicalParentUuid: string;
}

export interface ActiveChain {
  readonly leafUuid: string | null;
  /** Climbed path, root first (includes noise links and the boundary lines). */
  readonly chainUuids: readonly string[];
  readonly compactions: readonly Compaction[];
  /** Chain + completions + trailing attachments, ready for the adapter (no noise nodes). */
  readonly lines: readonly ChainLine[];
}

// ---------------------------------------------------------------------------
// line accessors (also used by the adapter)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function messageBlocks(line: ChainLine): readonly unknown[] {
  const m = (line.data as Json).message;
  if (m === null || typeof m !== 'object') return [];
  const c = (m as Json).content;
  return Array.isArray(c) ? c : [];
}

/** `message.id` of an assistant line (groups the blocks of one API response). */
export function messageIdOf(line: ChainLine): string | null {
  if (line.k !== 'node' || line.role !== 'assistant') return null;
  const m = (line.data as Json).message;
  if (m === null || typeof m !== 'object') return null;
  const id = (m as Json).id;
  return typeof id === 'string' ? id : null;
}

/** `tool_use` ids carried by an assistant line. */
export function toolUseIdsOf(line: ChainLine): string[] {
  if (line.k !== 'node' || line.role !== 'assistant') return [];
  const ids: string[] = [];
  for (const b of messageBlocks(line)) {
    if (b !== null && typeof b === 'object' && (b as Json).type === 'tool_use' && typeof (b as Json).id === 'string') {
      ids.push((b as Json).id as string);
    }
  }
  return ids;
}

/** `tool_use_id` of the `tool_result` block of a user line. */
export function toolResultIdOf(line: ChainLine): string | null {
  if (line.k !== 'node' || line.role !== 'user') return null;
  for (const b of messageBlocks(line)) {
    if (b !== null && typeof b === 'object' && (b as Json).type === 'tool_result' && typeof (b as Json).tool_use_id === 'string') {
      return (b as Json).tool_use_id as string;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// lean per-line info (kept instead of the heavy entry)
// ---------------------------------------------------------------------------

type Kind = 'user' | 'assistant' | 'system' | 'attachment' | 'other';

interface Info {
  readonly uuid: string;
  readonly parent: string | null;
  readonly logical: string | null;
  readonly kind: Kind;
  readonly noise: boolean;
  readonly mid: string | null;
  readonly toolUseIds: readonly string[];
  readonly resultFor: string | null;
  /** `parentUuid: null` + `logicalParentUuid`: a compaction boundary. */
  readonly compaction: boolean;
}

function infoOf(line: ChainLine): Info | null {
  if (line.uuid === null) return null;
  if (line.k === 'unknown') {
    return { uuid: line.uuid, parent: line.parentUuid, logical: null, kind: 'other', noise: false, mid: null, toolUseIds: [], resultFor: null, compaction: false };
  }
  const logical = line.logicalParentUuid ?? null;
  return {
    uuid: line.uuid,
    parent: line.parentUuid,
    logical,
    kind: line.role,
    noise: line.noise === true,
    mid: messageIdOf(line),
    toolUseIds: toolUseIdsOf(line),
    resultFor: toolResultIdOf(line),
    compaction: line.parentUuid === null && logical !== null,
  };
}

/** user / assistant / system: the kinds that can be the leaf of the conversation. */
function isLeafKind(k: Kind): boolean {
  return k === 'user' || k === 'assistant' || k === 'system';
}

function nextParent(info: Info): string | null {
  return info.parent ?? (info.compaction ? info.logical : null);
}

/** Climbs from `start` to the root. Returns infos root-first. */
function climb(index: ReadonlyMap<string, Info>, start: string | null): { path: Info[]; compactions: Compaction[] } {
  const rev: Info[] = [];
  const compactions: Compaction[] = [];
  const seen = new Set<string>();
  let cur = start;
  while (cur !== null && !seen.has(cur)) {
    const info = index.get(cur);
    if (info === undefined) break; // unresolved parent = root
    seen.add(cur);
    rev.push(info);
    if (info.compaction && info.logical !== null) compactions.push({ uuid: info.uuid, logicalParentUuid: info.logical });
    cur = nextParent(info);
  }
  rev.reverse();
  compactions.reverse();
  return { path: rev, compactions };
}

// ---------------------------------------------------------------------------
// whole-set build
// ---------------------------------------------------------------------------

/** `lines` MUST be in file order. */
export function buildActiveChain(lines: readonly ChainLine[]): ActiveChain {
  const index = new Map<string, Info>();
  const byUuid = new Map<string, ChainLine>();
  const position = new Map<string, number>();
  const infos: (Info | null)[] = [];
  let leafIdx = -1;
  lines.forEach((l, i) => {
    const info = infoOf(l);
    infos.push(info);
    if (info === null) return;
    index.set(info.uuid, info);
    byUuid.set(info.uuid, l);
    position.set(info.uuid, i);
    if (isLeafKind(info.kind)) leafIdx = i;
  });
  if (leafIdx < 0) return { leafUuid: null, chainUuids: [], compactions: [], lines: [] };

  const leaf = infos[leafIdx] as Info;
  const { path, compactions } = climb(index, leaf.uuid);
  const onChain = new Set(path.map((p) => p.uuid));

  // trailing attachments chained after the leaf
  const tip = new Set<string>([leaf.uuid]);
  const trailing: ChainLine[] = [];
  for (let i = leafIdx + 1; i < lines.length; i += 1) {
    const info = infos[i];
    if (info === null || info.kind !== 'attachment' || info.parent === null || !tip.has(info.parent)) continue;
    tip.add(info.uuid);
    if (!info.noise) trailing.push(lines[i]);
  }

  // completion by message.id
  const chainMids = new Set<string>();
  const lastChainOfMid = new Map<string, string>();
  for (const p of path) {
    if (p.mid !== null) {
      chainMids.add(p.mid);
      lastChainOfMid.set(p.mid, p.uuid);
    }
  }
  const anchored = new Map<string, ChainLine[]>();
  const addExtra = (anchor: string, l: ChainLine): void => {
    const arr = anchored.get(anchor);
    if (arr === undefined) anchored.set(anchor, [l]);
    else arr.push(l);
  };
  const included = new Set<string>(onChain);
  const toolUseOwner = new Map<string, string>(); // tool_use id -> uuid of the line that carries it
  for (const p of path) for (const t of p.toolUseIds) toolUseOwner.set(t, p.uuid);
  const claimed = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const info = infos[i];
    if (info === null || included.has(info.uuid) || info.kind !== 'assistant' || info.mid === null || !chainMids.has(info.mid)) continue;
    addExtra(lastChainOfMid.get(info.mid) as string, lines[i]);
    included.add(info.uuid);
    claimed.add(info.uuid);
    for (const t of info.toolUseIds) toolUseOwner.set(t, info.uuid);
  }
  // tool_result pinned by tool_use_id
  for (let i = 0; i < lines.length; i += 1) {
    const info = infos[i];
    if (info === null || included.has(info.uuid) || info.resultFor === null) continue;
    const owner = toolUseOwner.get(info.resultFor);
    if (owner === undefined) continue;
    addExtra(owner, lines[i]);
    included.add(info.uuid);
  }

  const out: ChainLine[] = [];
  const emitted = new Set<string>();
  const emit = (uuid: string): void => {
    if (emitted.has(uuid)) return;
    emitted.add(uuid);
    const l = byUuid.get(uuid) as ChainLine;
    const info = index.get(uuid) as Info;
    if (!info.noise) out.push(l);
    const extras = anchored.get(uuid);
    if (extras !== undefined) {
      extras.sort((a, b) => (position.get(a.uuid as string) as number) - (position.get(b.uuid as string) as number));
      for (const e of extras) emit(e.uuid as string);
    }
  };
  for (const p of path) emit(p.uuid);
  out.push(...trailing);

  return { leafUuid: leaf.uuid, chainUuids: path.map((p) => p.uuid), compactions, lines: out };
}

// ---------------------------------------------------------------------------
// backward (pager) - §3.4
// ---------------------------------------------------------------------------

export type BackwardVerdict =
  /** The line is on the chain. `released` = held lines that now belong to it (file order). */
  | { readonly kind: 'chain'; readonly released: readonly ChainLine[]; readonly compaction?: Compaction }
  /** Off the chain, but completes a chain response / action (same message.id or tool_use_id). */
  | { readonly kind: 'extra' }
  /** Kept aside until its owner shows up (a `tool_result` before its `tool_use`, a block before its sibling). */
  | { readonly kind: 'held' }
  | { readonly kind: 'skip' };

export interface BackwardCursor {
  readonly leafUuid: string | null;
  readonly expectedParent: string | null;
  readonly rootReached?: boolean;
}

/** Upper bound of lines kept aside (memory guard; oldest evicted). */
export const MAX_HELD = 500;

export class BackwardChain {
  leafUuid: string | null;
  expectedParent: string | null;
  rootReached: boolean;

  private readonly chainMids = new Set<string>();
  private readonly chainToolUseIds = new Set<string>();
  private readonly heldByMid = new Map<string, ChainLine[]>();
  private readonly heldByResult = new Map<string, ChainLine[]>();
  /** Attachments seen before the leaf was found (file order reversed). */
  private trailingCandidates: ChainLine[] = [];
  private held = 0;

  constructor(init?: BackwardCursor) {
    this.leafUuid = init?.leafUuid ?? null;
    this.expectedParent = init?.expectedParent ?? null;
    this.rootReached = init?.rootReached ?? false;
  }

  get heldCount(): number {
    return this.held;
  }

  /** Feed lines in REVERSE file order. */
  push(line: ChainLine): BackwardVerdict {
    const info = infoOf(line);
    if (info === null) return { kind: 'skip' };

    if (this.leafUuid === null) {
      if (isLeafKind(info.kind)) {
        this.leafUuid = info.uuid;
        const released = this.trailingFor(info.uuid);
        return this.accept(info, released);
      }
      if (info.kind === 'attachment') {
        this.trailingCandidates.push(line);
        if (this.trailingCandidates.length > MAX_HELD) this.trailingCandidates.shift();
      }
      return { kind: 'skip' };
    }

    if (this.expectedParent !== null && info.uuid === this.expectedParent) return this.accept(info, []);
    if (this.rootReached) return { kind: 'skip' };

    if (info.mid !== null && this.chainMids.has(info.mid)) {
      this.registerExtra(info);
      return { kind: 'extra' };
    }
    if (info.resultFor !== null) {
      if (this.chainToolUseIds.has(info.resultFor)) return { kind: 'extra' };
      this.hold(this.heldByResult, info.resultFor, line);
      return { kind: 'held' };
    }
    if (info.mid !== null) {
      this.hold(this.heldByMid, info.mid, line);
      return { kind: 'held' };
    }
    return { kind: 'skip' };
  }

  private trailingFor(leaf: string): ChainLine[] {
    const tip = new Set<string>([leaf]);
    const out: ChainLine[] = [];
    for (const l of [...this.trailingCandidates].reverse()) {
      const i = infoOf(l);
      if (i === null || i.parent === null || !tip.has(i.parent)) continue;
      tip.add(i.uuid);
      if (!i.noise) out.push(l);
    }
    this.trailingCandidates = [];
    return out;
  }

  private accept(info: Info, released: ChainLine[]): BackwardVerdict {
    const next = nextParent(info);
    this.expectedParent = next;
    if (next === null) this.rootReached = true;
    const compaction: Compaction | undefined =
      info.compaction && info.logical !== null ? { uuid: info.uuid, logicalParentUuid: info.logical } : undefined;

    this.registerExtra(info);
    const out = released;
    const queue: Info[] = [info];
    while (queue.length > 0) {
      const cur = queue.pop() as Info;
      const owned: ChainLine[] = [];
      if (cur.mid !== null) owned.push(...this.take(this.heldByMid, cur.mid));
      for (const t of cur.toolUseIds) owned.push(...this.take(this.heldByResult, t));
      for (const l of owned) {
        out.push(l);
        const li = infoOf(l);
        if (li !== null) {
          this.registerExtra(li);
          queue.push(li);
        }
      }
    }
    return compaction === undefined ? { kind: 'chain', released: out } : { kind: 'chain', released: out, compaction };
  }

  private registerExtra(info: Info): void {
    if (info.mid !== null) this.chainMids.add(info.mid);
    for (const t of info.toolUseIds) this.chainToolUseIds.add(t);
  }

  private hold(map: Map<string, ChainLine[]>, key: string, line: ChainLine): void {
    const arr = map.get(key);
    if (arr === undefined) map.set(key, [line]);
    else arr.push(line);
    this.held += 1;
    while (this.held > MAX_HELD) {
      const oldest = this.oldestKey();
      if (oldest === null) break;
      const arr2 = oldest.map.get(oldest.key) as ChainLine[];
      arr2.shift();
      this.held -= 1;
      if (arr2.length === 0) oldest.map.delete(oldest.key);
    }
  }

  private oldestKey(): { map: Map<string, ChainLine[]>; key: string } | null {
    // Map iteration follows insertion order: the first key is the oldest one.
    for (const map of [this.heldByResult, this.heldByMid]) {
      const first = map.keys().next();
      if (first.done !== true) return { map, key: first.value };
    }
    return null;
  }

  /** Removes and returns held lines of `key`, in FILE order (they were pushed in reverse). */
  private take(map: Map<string, ChainLine[]>, key: string): ChainLine[] {
    const arr = map.get(key);
    if (arr === undefined) return [];
    map.delete(key);
    this.held -= arr.length;
    return arr.reverse();
  }
}

// ---------------------------------------------------------------------------
// forward (follower) - §3.5
// ---------------------------------------------------------------------------

export type ForwardVerdict =
  /** Hangs from the current tip. `leaf: false` = a chained attachment (the leaf does not move). */
  | { readonly kind: 'extend'; readonly leaf: boolean; readonly compaction?: Compaction }
  /** Off the chain but belongs to it (late result of a parallel call, late block) or is a side leaf. */
  | { readonly kind: 'side'; readonly reason: 'tool-result' | 'completion' | 'attachment' | 'other' }
  /** New node whose parent is not the tip: the timeline must be recomputed from the new leaf. */
  | { readonly kind: 'rewind'; readonly forkParentUuid: string | null; readonly previousLeafUuid: string | null };

export class ForwardChain {
  leafUuid: string | null;

  private tip = new Set<string>();
  private readonly index = new Map<string, Info>();
  private readonly mids = new Set<string>();
  private readonly toolUseIds = new Set<string>();

  constructor(init?: { leafUuid: string | null }) {
    this.leafUuid = init?.leafUuid ?? null;
    if (this.leafUuid !== null) this.tip.add(this.leafUuid);
  }

  /** Root-first uuids of the current chain (needs the lines pushed so far). */
  chainUuids(): string[] {
    return climb(this.index, this.leafUuid).path.map((p) => p.uuid);
  }

  /** Compactions crossed by the current chain. */
  compactions(): Compaction[] {
    return climb(this.index, this.leafUuid).compactions;
  }

  push(line: ChainLine): ForwardVerdict {
    const info = infoOf(line);
    if (info === null) return { kind: 'side', reason: 'other' };
    this.index.set(info.uuid, info);
    const verdict = this.decide(info);
    if (info.mid !== null) this.mids.add(info.mid);
    for (const t of info.toolUseIds) this.toolUseIds.add(t);
    return verdict;
  }

  private decide(info: Info): ForwardVerdict {
    if (!isLeafKind(info.kind)) {
      // attachments and unrecognised lines: pass-through when chained to the tip
      if (info.parent !== null && this.tip.has(info.parent)) {
        this.tip.add(info.uuid);
        return { kind: 'extend', leaf: false };
      }
      return { kind: 'side', reason: info.kind === 'attachment' ? 'attachment' : 'other' };
    }
    if (this.leafUuid === null) return this.moveLeaf(info);
    if (info.parent !== null && this.tip.has(info.parent)) return this.moveLeaf(info);
    if (info.compaction && info.logical !== null) return this.moveLeaf(info, { uuid: info.uuid, logicalParentUuid: info.logical });
    if (info.resultFor !== null && this.toolUseIds.has(info.resultFor)) return { kind: 'side', reason: 'tool-result' };
    if (info.kind === 'assistant' && info.mid !== null && this.mids.has(info.mid)) return { kind: 'side', reason: 'completion' };
    const previousLeafUuid = this.leafUuid;
    this.leafUuid = info.uuid;
    this.tip = new Set([info.uuid]);
    return { kind: 'rewind', forkParentUuid: info.parent, previousLeafUuid };
  }

  private moveLeaf(info: Info, compaction?: Compaction): ForwardVerdict {
    this.leafUuid = info.uuid;
    this.tip = new Set([info.uuid]);
    return compaction === undefined ? { kind: 'extend', leaf: true } : { kind: 'extend', leaf: true, compaction };
  }
}
