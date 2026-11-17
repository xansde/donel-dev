import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OWNER_REASONS,
  STAGES,
  STALL_MS,
  checkMove,
  isStalled,
  type BoardCard,
} from '../src/shared/board/rules';

// Quadro de tarefas (t-1e354d15, dono 16/11): the ledger is a task board in the owner's Supabase, schema `board`.
// What breaks without the owner seeing it: a session that is not the board's Líder putting a card in "Esperando você"
// (it lands on the owner's desk), a card parked in "Travado" with no link and no deadline (nobody ever wakes it), and
// the vigia waking a session that said why it is parked, and a session closing or taking another place's card. The same
// rules live in docs/board/schema.sql (and docs/board/probe.sql proves them on a database); the last test keeps the
// lists equal.

const NOW = Date.parse('2026-11-16T18:00:00Z');
const DEV = 'place:dev';
const OTHER = 'place:outro';

function card(over: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'c-00000001',
    projectId: 'donel-dev',
    stage: 'doing',
    stageSince: NOW - 60 * 60 * 1000,
    placeId: DEV,
    version: 3,
    ...over,
  };
}

const full = { text: 'esperando o Fazolin', link: 'https://seazone.slack.com/archives/C1/p1', due: NOW + 3600_000 };

describe('mover cartão', () => {
  it('Esperando você: só o Líder que o retrato mostra, e só com um dos motivos do dono', () => {
    const base = { card: card(), to: 'waiting_owner' as const, actor: DEV, now: NOW, expectedVersion: 3 };
    expect(checkMove({ ...base, actorIsLeader: false, ownerReason: 'money' }).ok).toBe(false);
    expect(checkMove({ ...base, actorIsLeader: true }).ok).toBe(false);
    expect(checkMove({ ...base, actorIsLeader: true, ownerReason: 'parece importante' as never }).ok).toBe(false);
    expect(checkMove({ ...base, actorIsLeader: true, ownerReason: 'laya' }).ok).toBe(true);
  });

  it('triagem é do Líder; Fazendo de outro lugar não se fecha nem se toma; sem dono só se pega de A fazer', () => {
    const dev = { actor: DEV, actorIsLeader: false, now: NOW, expectedVersion: 3 };
    expect(checkMove({ ...dev, card: card({ stage: 'inbox', placeId: null }), to: 'todo' }).ok).toBe(false);
    expect(checkMove({ ...dev, card: card({ stage: 'inbox', placeId: null }), to: 'doing' }).ok).toBe(false);
    expect(checkMove({ ...dev, card: card({ stage: 'todo', placeId: null }), to: 'doing' }).ok).toBe(true);
    expect(checkMove({ ...dev, card: card({ placeId: OTHER }), to: 'done', doneSummary: 'fechei' }).ok).toBe(false);
    expect(checkMove({ ...dev, card: card({ placeId: OTHER }), to: 'doing', justification: full }).ok).toBe(false);
    expect(checkMove({ ...dev, card: card(), to: 'doing', assignPlace: OTHER }).ok).toBe(false);
    expect(checkMove({ ...dev, card: card(), to: 'doing', front: 'Outra' }).ok).toBe(false);
    expect(checkMove({ ...dev, card: card({ stage: 'inbox', placeId: null }), to: 'todo', actorIsLeader: true, assignPlace: OTHER, front: 'Custos' }).ok).toBe(true);
    expect(checkMove({ ...dev, actor: ' \n', card: card(), to: 'done', doneSummary: 'x' }).ok).toBe(false);
  });

  it('Travado exige justificativa com link e prazo no futuro; brancos não contam', () => {
    const base = { card: card(), to: 'blocked' as const, actor: DEV, actorIsLeader: false, now: NOW, expectedVersion: 3 };
    expect(checkMove(base).ok).toBe(false);
    expect(checkMove({ ...base, justification: { ...full, link: '' } }).ok).toBe(false);
    expect(checkMove({ ...base, justification: { ...full, link: `${full.link}\n` } }).ok).toBe(false);
    expect(checkMove({ ...base, justification: { ...full, text: '\t' } }).ok).toBe(false);
    expect(checkMove({ ...base, justification: { ...full, due: NOW - 1 } }).ok).toBe(false);
    expect(checkMove({ ...base, justification: full }).ok).toBe(true);
    // a note edit in Fazendo keeps working with an expired justification on the card (the database accepts it)
    expect(checkMove({ ...base, to: 'doing', keptJustification: { ...full, due: NOW - 1 } }).ok).toBe(true);
    // in Travado the kept one must still be valid
    expect(checkMove({ ...base, card: card({ stage: 'blocked' }), keptJustification: full }).ok).toBe(true);
    expect(checkMove({ ...base, card: card({ stage: 'blocked' }), keptJustification: { ...full, due: NOW - 1 } }).ok).toBe(false);
  });

  it('Feito exige o resumo; versão velha é recusada', () => {
    const base = { card: card(), to: 'done' as const, actor: DEV, actorIsLeader: false, now: NOW, expectedVersion: 3 };
    expect(checkMove(base).ok).toBe(false);
    expect(checkMove({ ...base, doneSummary: '\n\t' }).ok).toBe(false);
    expect(checkMove({ ...base, doneSummary: 'PR #450 mesclado' }).ok).toBe(true);
    expect(checkMove({ ...base, doneSummary: 'PR #450 mesclado', expectedVersion: 2 }).ok).toBe(false);
  });
});

describe('vigia: parado', () => {
  const idle = NOW - STALL_MS - 1;
  it('acorda só Fazendo parado e sem justificativa', () => {
    expect(isStalled(card(), idle, NOW)).toBe(true);
    expect(isStalled(card(), NOW - 60_000, NOW)).toBe(false);
    const parked = card({ justification: { text: 'esperando CI', link: 'https://github.com/x/y/pull/1', due: NOW + 60_000 } });
    expect(isStalled(parked, idle, NOW)).toBe(false);
    // expired: the justification cron charges it; the vigia does not wake the same session too
    const expired = card({ justification: { text: 'esperando CI', link: 'https://github.com/x/y/pull/1', due: NOW - 60_000 } });
    expect(isStalled(expired, idle, NOW)).toBe(false);
    for (const stage of ['inbox', 'todo', 'blocked', 'waiting_owner', 'done'] as const) {
      expect(isStalled(card({ stage }), idle, NOW)).toBe(false);
    }
  });
});

describe('schema.sql e regras TS', () => {
  const sql = readFileSync(join(__dirname, '..', 'docs', 'board', 'schema.sql'), 'utf8');
  // Every list marked in the SQL (CHECKs, stage_rank, move_card) equals the TS one: the list starts at the first "(" or
  // "[" after the marker.
  const listsAt = (marker: string): string[][] =>
    [...sql.matchAll(new RegExp(`${marker}[^(\\[]*[(\\[]([^)\\]]*)[)\\]]`, 'g'))].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!));
  it('as listas de colunas e de motivos do dono são as mesmas, em todo lugar marcado', () => {
    const stages = listsAt('-- stages');
    const reasons = listsAt('-- owner_reasons');
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
    for (const list of stages) expect(list).toEqual([...STAGES]);
    for (const list of reasons) expect(list).toEqual([...OWNER_REASONS]);
  });
});
