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
  type BoardLane,
} from '../src/shared/board/rules';

// Quadro de tarefas (t-1e354d15, dono 16/11): the ledger is a task board in the owner's Supabase, schema `board`.
// What breaks without the owner seeing it: a session that is not the board's Líder putting a card in "Esperando você"
// (it lands on the owner's desk), a card parked in "Travado" with no link and no deadline (nobody ever wakes it), and
// the vigia waking a session that said why it is parked. The same rules live in docs/board/schema.sql; the last test
// keeps the two lists equal.

const NOW = Date.parse('2026-11-16T18:00:00Z');
const LEADER = 'place:lider';
const DEV = 'place:dev';
const lane: BoardLane = { projectId: 'donel-dev', leaderPlace: LEADER };

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

describe('mover cartão', () => {
  it('só o Líder do quadro põe em Esperando você, e só com um dos motivos do dono', () => {
    const base = { card: card(), to: 'waiting_owner' as const, lane, now: NOW, expectedVersion: 3 };
    expect(checkMove({ ...base, actor: DEV, ownerReason: 'money' }).ok).toBe(false);
    expect(checkMove({ ...base, actor: LEADER }).ok).toBe(false);
    expect(checkMove({ ...base, actor: LEADER, ownerReason: 'parece importante' as never }).ok).toBe(false);
    expect(checkMove({ ...base, actor: LEADER, ownerReason: 'laya' }).ok).toBe(true);
    expect(checkMove({ ...base, lane: { projectId: 'donel-dev', leaderPlace: null }, actor: LEADER, ownerReason: 'money' }).ok).toBe(false);
  });

  it('Travado exige justificativa com link e prazo no futuro', () => {
    const base = { card: card(), to: 'blocked' as const, actor: DEV, lane, now: NOW, expectedVersion: 3 };
    const full = { text: 'esperando o Fazolin', link: 'https://seazone.slack.com/archives/C1/p1', due: NOW + 3600_000 };
    expect(checkMove(base).ok).toBe(false);
    expect(checkMove({ ...base, justification: { ...full, link: '' } }).ok).toBe(false);
    expect(checkMove({ ...base, justification: { ...full, due: NOW - 1 } }).ok).toBe(false);
    expect(checkMove({ ...base, justification: full }).ok).toBe(true);
    // justifying in place (Fazendo → Fazendo) is refused the same way when incomplete, as the database does
    expect(checkMove({ ...base, to: 'doing', justification: { ...full, due: NOW - 1 } }).ok).toBe(false);
  });

  it('Feito exige o resumo; versão velha é recusada', () => {
    const base = { card: card(), to: 'done' as const, actor: DEV, lane, now: NOW, expectedVersion: 3 };
    expect(checkMove(base).ok).toBe(false);
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
  const listIn = (marker: string): string[] => {
    const m = new RegExp(`${marker}[^(]*\\(([^)]*)\\)`).exec(sql);
    if (!m) throw new Error(`marcador ${marker} não achado em schema.sql`);
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };
  it('as listas de colunas e de motivos do dono são as mesmas', () => {
    expect(listIn('-- stages')).toEqual([...STAGES]);
    expect(listIn('-- owner_reasons')).toEqual([...OWNER_REASONS]);
  });
});
