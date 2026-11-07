// Faxina noturna do Oráculo (t-2c18d666, Líder 06/11) — the pure rules of the nightly round, no LLM, no fs. The
// runner (`src/main/rotinas/oraculo-faxina.ts`) gives the ledger, the boards, the live sessions and what `gh` says of
// each PR, and writes what these rules decide.
//
// 1. A LOW risk task, delivered or rejected, whose current delivery carries a PR that GitHub says merged, ends as
//    cancelled with "concluída: PR #n mesclado em AAAA-MM-DD" (a rejected task whose PR went in later stayed
//    rejected forever: t-c86b9505, t-12786061). HIGH risk never ends by itself: it is only written to the log.
// 2. A task open, running or rejected whose owner place is gone (closed, never started, out of the board) and that
//    nobody touched for ORPHAN_AGE_MS passes to the first live place above it, or to the Líder único — the same
//    rule as the pass-on of a place that closes (`firstLiveAbove`, reach.ts), for the orphans that rule never saw.
//
// Nothing here bumps the ledger: a cancel is the `rejeitada` event with the `cancelada` mark, a pass is the transfer's
// `criada` event; the words go in their `text` (v4, read by the installed Alfa).

import { LEADER_OF_ALL } from '../mindscape/leader';
import { placeHasStarted, type MindscapeDoc } from '../mindscape/model';
import { firstLiveAbove } from '../mindscape/reach';
import { isClosed, lastDelivery, type LedgerDoc, type LedgerTask } from './contract';

/** A task nobody touched for this long, with its owner place gone, is an old orphan. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
/** The first nights only write what they would do. */
export const SHADOW_NIGHTS = 3;

export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** `https://github.com/<owner>/<repo>/pull/<n>`, the key of the `gh` answer. */
  readonly url: string;
}

export type PrState = { readonly merged: true; readonly mergedAt: string } | { readonly merged: false } | { readonly error: string };

const PR_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

/** The PRs of the current delivery: its links and the links written in its text proofs. */
export function prRefsOf(task: LedgerTask): PrRef[] {
  const delivery = lastDelivery(task);
  const texts = (delivery?.proofs ?? []).map((proof) => (proof.kind === 'link' ? proof.url : proof.kind === 'texto' ? proof.text : ''));
  const refs = new Map<string, PrRef>();
  for (const text of texts) {
    for (const match of text.matchAll(PR_URL)) {
      const [, owner, repo, number] = match;
      const url = `https://github.com/${owner}/${repo}/pull/${number}`;
      if (!refs.has(url)) refs.set(url, { owner: owner!, repo: repo!, number: Number(number), url });
    }
  }
  return [...refs.values()];
}

/** The tasks the round asks `gh` about: not closed, not a Slack letter, delivered or rejected, with a PR. */
export function prCandidates(doc: LedgerDoc): { readonly task: LedgerTask; readonly refs: readonly PrRef[] }[] {
  return Object.values(doc.tasks).flatMap((task) => {
    if (isClosed(task) || task.slack || (task.state !== 'entregue' && task.state !== 'rejeitada')) return [];
    const refs = prRefsOf(task);
    return refs.length ? [{ task, refs }] : [];
  });
}

export function mergedReason(pr: PrRef, mergedAt: string): string {
  return `concluída: PR #${pr.number} mesclado em ${mergedAt.slice(0, 10)}`;
}

export type MergedDecision =
  | { readonly kind: 'cancelar'; readonly task: LedgerTask; readonly pr: PrRef; readonly reason: string }
  | { readonly kind: 'fica-risco-alto'; readonly task: LedgerTask; readonly pr: PrRef; readonly mergedAt: string };

/** Rule 1: low risk + a merged PR → cancel as done; high risk + merged → stays (logged); no merged PR → nothing. */
export function mergedDecisions(doc: LedgerDoc, states: ReadonlyMap<string, PrState>): MergedDecision[] {
  return prCandidates(doc).flatMap(({ task, refs }) => {
    for (const pr of refs) {
      const state = states.get(pr.url);
      if (!state || !('merged' in state) || !state.merged) continue;
      return [task.risk === 'baixo' ? { kind: 'cancelar' as const, task, pr, reason: mergedReason(pr, state.mergedAt) } : { kind: 'fica-risco-alto' as const, task, pr, mergedAt: state.mergedAt }];
    }
    return [];
  });
}

export type GoneHow = 'fechou' | 'não começou' | 'saiu do quadro';

export interface OldOrphan {
  readonly task: LedgerTask;
  readonly how: GoneHow;
  /** A live place of the same board, or `'lider'`. */
  readonly to: string;
}

export function orphanPassReason(placeId: string, how: GoneHow): string {
  return `passada sozinha pela faxina: o lugar ${placeId} ${how} e a tarefa ficou mais de um dia sem dono`;
}

/**
 * Rule 2: the old orphans and who takes each one. A board missing from `boards` is unknown: none of its tasks moves.
 * A place is live when its conversation is open in a session (`liveSessionIds`).
 */
export function oldOrphans(doc: LedgerDoc, boards: MindscapeDoc, liveSessionIds: ReadonlySet<string>, now: number): OldOrphan[] {
  return Object.values(doc.tasks).flatMap((task): OldOrphan[] => {
    if (isClosed(task) || task.slack || task.ownerPlaceId === LEADER_OF_ALL) return [];
    if (task.state !== 'aberta' && task.state !== 'em-execucao' && task.state !== 'rejeitada') return [];
    if (now - (task.events.at(-1)?.at ?? task.createdAt) < ORPHAN_AGE_MS) return [];
    const board = boards.boards[task.projectPath];
    if (!board) return [];
    const isLive = (placeId: string): boolean => {
      const card = board.cards[placeId];
      return card?.kind === 'session' && card.sessionId !== undefined && liveSessionIds.has(card.sessionId);
    };
    const card = board.cards[task.ownerPlaceId];
    if (card?.kind !== 'session') return [{ task, how: 'saiu do quadro', to: LEADER_OF_ALL }];
    if (isLive(task.ownerPlaceId)) return [];
    const how: GoneHow = placeHasStarted(card) ? 'fechou' : 'não começou';
    return [{ task, how, to: firstLiveAbove(board, task.ownerPlaceId, isLive) ?? LEADER_OF_ALL }];
  });
}
