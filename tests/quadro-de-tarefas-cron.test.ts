import { describe, expect, it } from 'vitest';
import { afterBusyField, BUSY_MAX, CHARGE_EVERY_MS, CHARGE_MAX, fieldHoldsOnlyNotice, fieldIsFree, followLaneLeaders, groupNotices, LABEL, linkKind, othersOnGithub, othersOnSlack, pickLeader, planJustify, planVigia, responseSince, VIGIA_MAX_PER_DAY, withShadowNotice, type CronCard } from '../src/shared/board/cron';
import { STALL_MS } from '../src/shared/board/rules';
import { renderBoardPage } from '../src/shared/board/page';
import { sessionResolver } from '../src/board-cron/semente';
import type { BoardPicture } from '../src/oraculo/portao';

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
    justifiedAt: null,
    ...over,
  };
}

const idle = { alive: true, idleSince: NOW - STALL_MS - 60_000 };
const closed = { alive: false, idleSince: null };
const justification = (due: number) => ({ text: 'esperando o Fazolin', link: 'https://seazone.slack.com/archives/C1/p1700000000000100', due });

describe('vigia', () => {
  it('acorda Fazendo parado sem justificativa; justificado, ocupado ou em outra coluna fica quieto', () => {
    expect(planVigia(card(), idle, [], NOW)).toMatchObject({ do: 'wake', session: SESSION, mark: 'woken' });
    expect(planVigia(card({ justification: justification(NOW + 3600_000) }), idle, [], NOW).do).toBe('skip');
    expect(planVigia(card(), { alive: true, idleSince: NOW - 60_000 }, [], NOW).do).toBe('skip');
    // a long tool call (no finished turn) is working, not stopped
    expect(planVigia(card(), { alive: true, idleSince: null }, [], NOW).do).toBe('skip');
    expect(planVigia(card({ stage: 'blocked', justification: justification(NOW + 1) }), idle, [], NOW).do).toBe('skip');
  });

  it('campo ocupado em 3 rondas seguidas chega ao Líder, sem calar o aviso de cobrança esgotada', () => {
    expect(BUSY_MAX).toBe(3);
    for (let busy = 1; busy < BUSY_MAX; busy++) expect(afterBusyField(card(), busy, 'campo com texto', null, NOW).do).toBe('skip');
    const escalated = afterBusyField(card(), BUSY_MAX, 'campo com texto', null, NOW);
    expect(escalated).toMatchObject({ do: 'leader', via: 'busy' });
    // the Líder not reached yet: still escalating from the 4th round on, not 3 rounds later
    expect(afterBusyField(card(), BUSY_MAX + 1, 'campo com texto', null, NOW).do).toBe('leader');
    // heard: again only after 2 h, by its own mark
    expect(afterBusyField(card(), BUSY_MAX, 'campo com texto', NOW - 60_000, NOW).do).toBe('skip');
    expect(afterBusyField(card(), BUSY_MAX, 'campo com texto', NOW - 3 * 3600_000, NOW).do).toBe('leader');
    // the card's leader mark (written by the once-per-stage notices) is not the busy one's business, and vice versa:
    // a charge run out still reaches the Líder after a busy escalation (which marks nothing on the card)
    expect(afterBusyField(card({ leaderNoticedAt: NOW - 60_000 }), BUSY_MAX, 'campo com texto', null, NOW).do).toBe('leader');
    const runOut = card({ justification: justification(NOW - 60_000), chargeCount: CHARGE_MAX, chargedAt: NOW - CHARGE_EVERY_MS - 1 });
    expect(planJustify(runOut, null, idle, NOW).do).toBe('leader');
  });

  it('em sombra, o aviso simulado ao Líder segura a repetição até o cartão mudar de coluna', () => {
    const wakes = Array.from({ length: VIGIA_MAX_PER_DAY }, (_, i) => NOW - (i + 1) * 3600_000).reverse();
    const notice = { at: NOW - 60_000, stageSince: card().stageSince };
    expect(planVigia(withShadowNotice(card({ leaderNoticedAt: null }), notice), idle, wakes, NOW).do).toBe('skip');
    expect(planVigia(withShadowNotice(card({ stageSince: NOW - 90 * 60_000 }), notice), idle, wakes, NOW).do).toBe('leader');
    // the real mark (from the database) does not count in shadow: the shadow keeps its own
    expect(planVigia(withShadowNotice(card({ leaderNoticedAt: NOW - 60_000 }), undefined), idle, wakes, NOW).do).toBe('leader');
  });

  it('sessão fechada ou no teto do dia vai ao Líder, uma vez a cada 2 h', () => {
    expect(planVigia(card(), closed, [], NOW)).toMatchObject({ do: 'leader', closed: SESSION });
    const wakes = Array.from({ length: VIGIA_MAX_PER_DAY }, (_, i) => NOW - (i + 1) * 3600_000).reverse();
    expect(planVigia(card(), idle, wakes, NOW).do).toBe('leader');
    expect(planVigia(card({ leaderNoticedAt: NOW - 60_000 }), idle, wakes, NOW).do).toBe('skip');
  });

  it('entregue no Oráculo esperando o aceite não é parado; rejeitada volta a ser; aceita vai ao Líder uma vez', () => {
    expect(planVigia(card({ desk: { state: 'entregue', closed: false } }), idle, [], NOW).do).toBe('skip');
    expect(planVigia(card({ desk: { state: 'rejeitada', closed: false } }), idle, [], NOW).do).toBe('wake');
    expect(planVigia(card({ desk: { state: 'entregue', closed: false } }), closed, [], NOW).do).toBe('skip');
    // accepted on the desk and still in Fazendo: the Líder hears it once, to move it to Feito
    expect(planVigia(card({ desk: { state: 'aceita', closed: true } }), idle, [], NOW)).toMatchObject({ do: 'leader' });
    expect(planVigia(card({ desk: { state: 'aceita', closed: true }, leaderNoticedAt: NOW - 9 * 3600_000 }), idle, [], NOW).do).toBe('skip');
  });

  it('o aviso vai ao Líder da raia vivo; sem ele, ao Líder único vivo; sem nenhum, diz por quê', () => {
    const lane = { leader_place: 'place:lider', leader_session: 'aaaaaaaa-1111' };
    const alive = (live: string[]) => (sid: string) => live.includes(sid);
    expect(pickLeader(lane, alive(['aaaaaaaa-1111']), 'bbbbbbbb-2222')).toEqual({ kind: 'lane', session: 'aaaaaaaa-1111', place: 'place:lider' });
    expect(pickLeader(lane, alive(['bbbbbbbb-2222']), 'bbbbbbbb-2222')).toMatchObject({ kind: 'reserve', session: 'bbbbbbbb-2222' });
    expect(pickLeader(undefined, alive([]), 'bbbbbbbb-2222')).toMatchObject({ kind: 'none', why: 'a raia não tem Líder registrado' });
  });
});

describe('raia segue o Líder e um aviso por sessão (devolução de 20/11)', () => {
  it('a raia passa à sessão viva aqui que segura o lugar; a do Líder único, à escolha do daemon; de outra máquina, não', () => {
    const bizops = 'C:\\Users\\dono\\seazone\\BizOps';
    const STALE = '757511b0-6326-414c-8ed5-5417c83c36b4';
    const LIVE = '0af17ef9-93a7-4e25-9d2e-19537600c285';
    const ALL_OLD = 'd908a6ae-0720-4365-b775-f973d88e9d7b';
    const ALL_NOW = 'eeeeeeee-0720-4365-b775-f973d88e9d7b';
    const REMOTE = 'bbbbbbbb-1111-4222-8333-444444444444';
    const leaderCard = { kind: 'session', id: 'place:e8e2842d', sessionId: LIVE, previous: [], x: 0, y: 0, roleId: 'lider' };
    // the stale holder (closed, never renewed) is still in the picture; the freshest board says the place's conversation
    const picture = {
      at: NOW,
      sessoes: {
        [STALE]: { quemSou: { lugar: 'place:e8e2842d', pasta: bizops }, listar: [], at: NOW - 3600_000 },
        'cccccccc-1111-4222-8333-444444444444': { quemSou: { lugar: 'place:dev', pasta: bizops }, listar: [], at: NOW, board: { cards: { 'place:e8e2842d': leaderCard } } },
      },
    } as unknown as BoardPicture;
    // another machine's picture (portoes-retrato): its Líder is not in this tmux
    const satellite = { at: NOW, sessoes: { [REMOTE]: { quemSou: { lugar: 'place:remoto', pasta: '/home/u/seazone/Teamzone' }, listar: [], at: NOW, maquina: 'homologacoes' } } } as unknown as BoardPicture;
    const here = new Set([LIVE, ALL_NOW]);
    const sessionOf = sessionResolver([picture, satellite], (sid) => here.has(sid));
    const lane = (project_id: string, leader_place: string, leader_session: string) => ({ project_id, leader_place, leader_session, leader_seen_at: null });
    const lanes = [lane('bizops', 'place:e8e2842d', STALE), lane('donel-dev', 'lider', ALL_OLD), lane('teamzone', 'place:remoto', ALL_OLD), lane('atlas', 'lider', ALL_NOW)];
    expect(followLaneLeaders(lanes, sessionOf, () => ALL_NOW)).toEqual([
      { project: 'bizops', place: 'place:e8e2842d', session: LIVE, was: STALE },
      { project: 'donel-dev', place: 'lider', session: ALL_NOW, was: ALL_OLD },
    ]);
    // nothing alive resolves: the lane keeps what it has (the reserve, as before)
    expect(followLaneLeaders(lanes, sessionResolver([picture, satellite], () => false), () => null)).toEqual([]);
    // the seed's reading (no liveness) still names the stale holder: why the lane asks for a session alive here
    expect(sessionResolver([picture])('bizops', 'place:e8e2842d')).toBe(STALE);
  });

  it('a mesma sessão recebe um aviso só na ronda, com todos os cartões; um cartão só segue com o texto dele', () => {
    const A = 'aaaaaaaa-1111';
    const B = 'bbbbbbbb-2222';
    const notices = [
      { session: A, card: 'c-1', text: `${LABEL} O cartão c-1 está parado.` },
      { session: B, card: 'c-9', text: `${LABEL} O cartão c-9 está parado.` },
      { session: A, card: 'c-2', text: `${LABEL} O cartão c-2 está parado.` },
      { session: A, card: 'c-3', text: `${LABEL} O prazo do cartão c-3 venceu.` },
    ];
    const groups = groupNotices(notices, (n) => n.session, (n) => n.text);
    expect(groups.map((g) => [g.session, g.items.map((n) => n.card)])).toEqual([
      [A, ['c-1', 'c-2', 'c-3']],
      [B, ['c-9']],
    ]);
    expect(groups[0]!.text.split(LABEL).length - 1).toBe(1);
    for (const id of ['c-1', 'c-2', 'c-3']) expect(groups[0]!.text).toContain(`cartão ${id}`);
    expect(groups[1]!.text).toBe(notices[1]!.text);
  });
});

describe('a resposta no link é de outra pessoa', () => {
  const since = NOW - 3600_000;
  const at = new Date(NOW - 60_000).toISOString();
  it('GitHub: comentário, review, merge ou fechamento da própria conta não conta', () => {
    expect(othersOnGithub({ comments: [{ user: { login: 'xande-seazone' }, created_at: at }] }, 'xande-seazone', since)).toBe(false);
    expect(othersOnGithub({ comments: [{ user: { login: 'fazolin' }, created_at: at }] }, 'xande-seazone', since)).toBe(true);
    expect(othersOnGithub({ comments: [], reviews: [{ user: { login: 'Xande-Seazone' }, submitted_at: at }] }, 'xande-seazone', since)).toBe(false);
    expect(othersOnGithub({ comments: [], pull: { merged_at: at, merged_by: { login: 'xande-seazone' } }, issue: { closed_at: at, closed_by: { login: 'xande-seazone' } } }, 'xande-seazone', since)).toBe(false);
    expect(othersOnGithub({ comments: [], issue: { closed_at: at, closed_by: { login: 'dono' } } }, 'xande-seazone', since)).toBe(true);
    // older than the justification: never
    expect(othersOnGithub({ comments: [{ user: { login: 'fazolin' }, created_at: new Date(since - 1).toISOString() }] }, 'xande-seazone', since)).toBe(false);
  });

  it('Slack: só mensagem nova de outro autor do fio acorda', () => {
    const ts = (ms: number) => (ms / 1000).toFixed(6);
    const fio = [
      `--- 20/11 09:00 Alexandre Heckert Lentz (ts ${ts(since - 60_000)})`,
      'pergunta ao Fazolin',
      `--- 20/11 10:58 Alexandre Heckert Lentz (ts ${ts(NOW - 60_000)})`,
      'cobrando de novo (ts 9999999999.000000)',
    ].join('\n');
    const self = ['Alexandre Heckert Lentz', 'U0102UQT77A'];
    expect(othersOnSlack(fio, self, since)).toBe(false);
    expect(othersOnSlack(`${fio}\n--- 20/11 10:59 Pedro Fazolin (ts ${ts(NOW - 30_000)}) [mensagem do link]\nfeito`, self, since)).toBe(true);
    expect(othersOnSlack(`--- 20/11 10:59 U0102UQT77A (ts ${ts(NOW - 30_000)})`, self, since)).toBe(false);
  });
});

describe('cron de justificativa', () => {
  it('resposta nova no link acorda; sem resposta espera o prazo', () => {
    const parked = card({ stage: 'blocked', justification: justification(NOW + 3600_000) });
    expect(planJustify(parked, true, idle, NOW)).toMatchObject({ do: 'wake', mark: 'woken' });
    expect(planJustify(parked, false, idle, NOW).do).toBe('skip');
    expect(planJustify(parked, null, idle, NOW).do).toBe('skip');
  });

  it('a resposta conta só depois da justificativa, mesmo sem mudar de coluna', () => {
    const justifiedLater = card({ justification: justification(NOW + 3600_000), justifiedAt: NOW - 10 * 60_000 });
    expect(responseSince(justifiedLater)).toBe(NOW - 10 * 60_000);
  });

  it('prazo vencido cobra a cada 2 h, até 3 vezes; depois avisa o Líder', () => {
    const late = card({ stage: 'blocked', justification: justification(NOW - 60_000) });
    expect(planJustify(late, null, idle, NOW)).toMatchObject({ do: 'wake', mark: 'charged' });
    expect(planJustify({ ...late, chargeCount: 1, chargedAt: NOW - 60_000 }, null, idle, NOW).do).toBe('skip');
    expect(planJustify({ ...late, chargeCount: 1, chargedAt: NOW - CHARGE_EVERY_MS - 1 }, null, idle, NOW).do).toBe('wake');
    // after the last charge, one more interval before the Líder; and the Líder hears it once in this stage
    expect(planJustify({ ...late, chargeCount: CHARGE_MAX, chargedAt: NOW - 60_000 }, null, idle, NOW).do).toBe('skip');
    expect(planJustify({ ...late, chargeCount: CHARGE_MAX, chargedAt: NOW - CHARGE_EVERY_MS - 1 }, null, idle, NOW).do).toBe('leader');
    expect(planJustify({ ...late, chargeCount: CHARGE_MAX, chargedAt: NOW - 9 * CHARGE_EVERY_MS, leaderNoticedAt: NOW - 8 * CHARGE_EVERY_MS }, null, idle, NOW).do).toBe('skip');
  });

  it('sessão que não está aberta aqui vai direto ao Líder, em vez de cobrar no vazio', () => {
    const late = card({ stage: 'blocked', justification: justification(NOW - 60_000) });
    expect(planJustify(late, null, closed, NOW).do).toBe('leader');
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

  it('o aviso que não entrou só é limpo quando a caixa tem só ele; o que o dono acrescentou ou colou fica', () => {
    const notice = '[quadro de tarefas · VPS] card parado há 3 dias: justifique no card';
    expect(fieldHoldsOnlyNotice(notice, notice)).toBe(true);
    expect(fieldHoldsOnlyNotice('[quadro de tarefas · VPS] card parado há 3 dias: justi fique no card', notice)).toBe(true); // wrapped
    expect(fieldHoldsOnlyNotice('[Pasted text #1 +4 lines]', notice)).toBe(true); // a long notice shown as a paste
    expect(fieldHoldsOnlyNotice(`${notice} e mais o que o dono escreveu`, notice)).toBe(false);
    expect(fieldHoldsOnlyNotice('[Pasted text #1 +4 lines][Pasted text #2]', notice)).toBe(false); // the owner pasted too
    expect(fieldHoldsOnlyNotice('[Pasted text #1] oi', notice)).toBe(false);
    expect(fieldHoldsOnlyNotice('rascunho do dono', notice)).toBe(false);
    expect(fieldHoldsOnlyNotice('', notice)).toBe(false);
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
