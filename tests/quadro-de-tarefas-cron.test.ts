import { describe, expect, it } from 'vitest';
import { CHARGE_EVERY_MS, CHARGE_MAX, fieldIsFree, linkKind, planJustify, planVigia, VIGIA_MAX_PER_DAY, type CronCard } from '../src/shared/board/cron';
import { STALL_MS } from '../src/shared/board/rules';
import { renderBoardPage } from '../src/shared/board/page';

// Quadro de tarefas (t-1e354d15), PR 3 — the cron's decisions. What breaks without the owner seeing it: the vigia
// waking a session that said why it is parked (or one that is typing), a deadline nobody ever charges, a response on
// the link that never wakes the session, and the cron typing over someone's draft.

const NOW = Date.parse('2026-11-16T20:00:00Z');
const SESSION = '11111111-2222-4333-8444-555555555555';

function card(over: Partial<CronCard> = {}): CronCard {
  return {
    id: 'c-000000000001',
    projectId: 'donel-dev',
    stage: 'doing',
    stageSince: NOW - 2 * 60 * 60 * 1000,
    placeId: 'place:dev',
    version: 3,
    title: 'Quadro',
    sessionId: SESSION,
    wokenAt: null,
    chargedAt: null,
    chargeCount: 0,
    leaderNoticedAt: null,
    ...over,
  };
}

const idle = { alive: true, lastTurnAt: NOW - STALL_MS - 60_000 };
const justification = (due: number) => ({ text: 'esperando o Fazolin', link: 'https://seazone.slack.com/archives/C1/p1700000000000100', due });

describe('vigia', () => {
  it('acorda Fazendo parado sem justificativa; justificado, ocupado ou em outra coluna fica quieto', () => {
    expect(planVigia(card(), idle, [], NOW)).toMatchObject({ do: 'wake', session: SESSION, mark: 'woken' });
    expect(planVigia(card({ justification: justification(NOW + 3600_000) }), idle, [], NOW).do).toBe('skip');
    expect(planVigia(card(), { alive: true, lastTurnAt: NOW - 60_000 }, [], NOW).do).toBe('skip');
    expect(planVigia(card({ stage: 'blocked', justification: justification(NOW + 1) }), idle, [], NOW).do).toBe('skip');
  });

  it('sessão fechada ou no teto do dia vai ao Líder, uma vez a cada 2 h', () => {
    expect(planVigia(card(), { alive: false, lastTurnAt: idle.lastTurnAt }, [], NOW).do).toBe('leader');
    const wakes = Array.from({ length: VIGIA_MAX_PER_DAY }, (_, i) => NOW - (i + 1) * 3600_000).reverse();
    expect(planVigia(card(), idle, wakes, NOW).do).toBe('leader');
    expect(planVigia(card({ leaderNoticedAt: NOW - 60_000 }), idle, wakes, NOW).do).toBe('skip');
  });
});

describe('cron de justificativa', () => {
  it('resposta nova no link acorda; sem resposta espera o prazo', () => {
    const parked = card({ stage: 'blocked', justification: justification(NOW + 3600_000) });
    expect(planJustify(parked, true, NOW)).toMatchObject({ do: 'wake', mark: 'woken' });
    expect(planJustify(parked, false, NOW).do).toBe('skip');
    expect(planJustify(parked, null, NOW).do).toBe('skip');
  });

  it('prazo vencido cobra a cada 2 h, até 3 vezes; depois avisa o Líder', () => {
    const late = card({ stage: 'blocked', justification: justification(NOW - 60_000) });
    expect(planJustify(late, null, NOW)).toMatchObject({ do: 'wake', mark: 'charged' });
    expect(planJustify({ ...late, chargeCount: 1, chargedAt: NOW - 60_000 }, null, NOW).do).toBe('skip');
    expect(planJustify({ ...late, chargeCount: 1, chargedAt: NOW - CHARGE_EVERY_MS - 1 }, null, NOW).do).toBe('wake');
    expect(planJustify({ ...late, chargeCount: CHARGE_MAX, chargedAt: NOW - CHARGE_EVERY_MS - 1 }, null, NOW).do).toBe('leader');
  });

  it('reconhece link de PR do GitHub e de fio do Slack', () => {
    expect(linkKind('https://github.com/xansde/donel-dev/pull/451')).toEqual({ kind: 'github', owner: 'xansde', repo: 'donel-dev', type: 'pull', number: 451 });
    expect(linkKind('https://seazone.slack.com/archives/C0CG5GLUFKP/p1731700000000100?thread_ts=1').kind).toBe('slack');
    expect(linkKind('https://example.com/x').kind).toBe('other');
  });
});

describe('campo de entrada da sessão', () => {
  const ruler = '─'.repeat(40);
  it('livre só vazio; a sugestão esmaecida não conta como rascunho', () => {
    expect(fieldIsFree(`texto\n${ruler}\n❯ \n${ruler}\n  ? for shortcuts`).free).toBe(true);
    expect(fieldIsFree(`${ruler}\n❯ \x1b[2mtry "fix the bug"\x1b[0m\n${ruler}`).free).toBe(true);
    expect(fieldIsFree(`${ruler}\n❯ estou escrevendo\n${ruler}`)).toEqual({ free: false, why: 'campo com texto (rascunho de alguém)' });
    expect(fieldIsFree('Do you want to proceed?\n1. Yes').free).toBe(false);
  });
});

describe('página do quadro', () => {
  it('escapa o que vem dos cartões e só liga link http(s)', () => {
    const html = renderBoardPage(
      [{ project_id: 'donel-dev', name: 'Donel Dev', host: 'vps-pessoal', inbox: 0, todo: 0, doing: 0, blocked: 1, waiting_owner: 0, done: 0, overdue: 0, last_change: null }],
      [{ id: 'c-1', project_id: 'donel-dev', front: '<b>x</b>', title: '<script>alert(1)</script>', stage: 'blocked', stage_since: '2026-11-16T19:00:00Z', note: null, place_id: null, justification: 'y', justification_link: 'javascript:alert(1)', justification_due: '2026-11-16T21:00:00Z', due: null }],
      NOW,
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('href="javascript:');
  });
});
