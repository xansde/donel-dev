import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RemoteHealthReport } from '../src/shared/health/remote';
import { applyLedgerOp, closedAlone, emptyLedgerDoc, eventNote, lastDelivery, type LedgerOp } from '../src/shared/ledger/contract';
import { actorLabel } from '../src/shared/ledger/labels';
import { actorName } from '../src/shared/ledger/mirror';
import { ownerInbox } from '../src/shared/ledger/inbox';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createVigiaService } from '../src/main/vigia/vigia-service';
import { LATE_LINE, liveCard, NO_AFFECTED, parsePostMortem, passedRecord, passedTitle, probableCause, buildPostMortemScript } from '../src/shared/vigia/aviso';

// Aviso do vigia bem estruturado (t-0358187b). Dono, 17/11: "essas cartas sem a data/hora da queda na primeira carta é
// uma falha" e "esse tipo de aviso tá mal estruturado ainda". A capa diz a máquina, o início e o fim em horário de
// Brasília e a duração; o corpo diz o que parou, a causa medida e o que o time faz; a trava que passou sozinha é
// registro, sem pergunta; só a viva ou a que volta 3 vezes em 24 h pede decisão; com o Oráculo fora, o registro espera
// na fila e sai depois com o horário certo.

const MIN = 60_000;
/** 17/11/2026 07:30 em Brasília (UTC−3). */
const QUEDA_VPS = Date.UTC(2026, 10, 17, 10, 30);
const VOLTA_VPS = Date.UTC(2026, 10, 17, 11, 8);
const QUEDA_HOMOLOG = Date.UTC(2026, 10, 17, 13, 6);
const VOLTA_HOMOLOG = Date.UTC(2026, 10, 17, 13, 17);

/** What the VPS pessoal's own `sar` recorded of 17/11 07:20–08:18 (the real reading of that morning). */
const SAR_DA_QUEDA = 'DONEL_PM_OK\nDONEL_PM ncpu 4\nDONEL_PM boot 1763297760\nDONEL_PM load 287.33 294\nDONEL_PM swap 68.32\nDONEL_PM oom 0\n';

describe('capa: a máquina, o início e o fim em horário de Brasília, e a duração', () => {
  it('as quedas reais de 17/11', () => {
    expect(passedTitle('VPS pessoal', 'vps-fora', QUEDA_VPS, VOLTA_VPS)).toBe('VPS pessoal fora do ar 17/11 07:30–08:08 (38 min)');
    expect(passedTitle('Homologações', 'vps-fora', QUEDA_HOMOLOG, VOLTA_HOMOLOG)).toBe('Homologações fora do ar 17/11 10:06–10:17 (11 min)');
  });

  it('virando a meia-noite e passando de uma hora, sem passar de 60 caracteres', () => {
    const start = Date.UTC(2026, 10, 18, 2, 50); // 17/11 23:50
    const title = passedTitle('Homologações', 'vps-fora', start, start + 85 * MIN);
    expect(title).toContain('17/11 23:50–18/11 01:15');
    expect(title.length).toBeLessThanOrEqual(60);
  });
});

describe('corpo: o que parou, a causa medida e o que o time faz', () => {
  it('a leitura do sar vira a causa, com os números que a sustentam', () => {
    const pm = parsePostMortem(SAR_DA_QUEDA);
    expect(pm).toEqual({ ncpu: 4, bootAt: 1763297760_000, maxLoad: 287.33, maxBlocked: 294, maxSwapPct: 68.32, oomKills: 0 });
    const cause = probableCause({ kind: 'vps-fora', detail: 'VPS pessoal não responde', start: QUEDA_VPS, end: VOLTA_VPS, pm, downTogether: [] });
    expect(cause.kind).toBe('carga');
    expect(cause.reading).toContain('carga até 287,3 em 4 CPUs');
    expect(cause.reading).toContain('294 processos bloqueados');
    expect(cause.reading).toContain('swap até 68%');
    expect(cause.reading).toContain('nenhum processo morto por falta de memória');
  });

  it('reinício, falta de memória, rede do PC e sem leitura têm cada um a sua causa', () => {
    const base = { ncpu: 4, bootAt: 1, maxLoad: 1, maxBlocked: 0, maxSwapPct: 10, oomKills: 0 };
    const cause = (pm: typeof base | null, downTogether: string[] = []) => probableCause({ kind: 'vps-fora', detail: 'x', start: QUEDA_VPS, end: VOLTA_VPS, pm, downTogether }).kind;
    expect(cause({ ...base, bootAt: QUEDA_VPS + 20 * MIN })).toBe('reinicio');
    expect(cause({ ...base, oomKills: 3 })).toBe('memoria');
    expect(cause(base, ['Homologações'])).toBe('rede-pc');
    expect(cause(base)).toBe('rede');
    expect(cause(null)).toBe('desconhecida');
  });

  it('o registro diz as sessões, o trabalho delas no Oráculo e quem faz o quê', () => {
    const cause = probableCause({ kind: 'vps-fora', detail: 'x', start: QUEDA_VPS, end: VOLTA_VPS, pm: parsePostMortem(SAR_DA_QUEDA), downTogether: [] });
    const record = passedRecord({
      label: 'VPS pessoal',
      kind: 'vps-fora',
      firstSeen: QUEDA_VPS,
      endedAt: VOLTA_VPS,
      cause,
      affected: { sessions: ['Dev · celular', 'Líder'], tasks: [{ id: 't-1234abcd', title: 'Botões com tamanho fixo' }], readAt: QUEDA_VPS - 5 * MIN, tasksRead: true },
    });
    expect(record.title).toBe('VPS pessoal fora do ar 17/11 07:30–08:08 (38 min)');
    expect(record.body).toContain('Sessões na máquina (2, lidas às 07:25): Dev · celular, Líder.');
    expect(record.body).toContain('«Botões com tamanho fixo» (t-1234abcd)');
    expect(record.body).toContain('Causa provável: carga extrema na máquina');
    // Only what really happens: the vigia's own steps; nobody is promised work by a lock that passed (revisão do #555).
    expect(record.body).toContain('ninguém foi acionado');
    expect(record.body).toContain('(dono: vigia de travas)');
    expect(record.body).not.toContain('Líder do quadro');
    expect(record.body).not.toContain('Já viu');
  });

  it('sem ler as sessões, o registro diz que o trabalho não foi lido (nunca "nenhum")', () => {
    const cause = probableCause({ kind: 'vps-fora', detail: 'x', start: QUEDA_VPS, end: VOLTA_VPS, pm: null, downTogether: [] });
    const record = passedRecord({ label: 'VPS pessoal', kind: 'vps-fora', firstSeen: QUEDA_VPS, endedAt: VOLTA_VPS, cause, affected: { sessions: [], tasks: [], readAt: null, tasksRead: false } });
    expect(record.body).toContain('Trabalho em andamento delas no Oráculo: não lido');
    expect(record.body).not.toContain('Oráculo: nenhum');
  });

  it('o script da causa só lê, e lê a janela por horário absoluto (não depende do fuso da máquina)', () => {
    const script = buildPostMortemScript(QUEDA_VPS, VOLTA_VPS);
    expect(script).toContain(`@${QUEDA_VPS / 1000 - 600}`);
    expect(script).not.toMatch(/(^|[;&|(]\s*)(rm|kill|pkill|tee|mv|cp)\s|>\s*\/(?!dev\/null)/m);
    expect(parsePostMortem('nada')).toBeNull();
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function report(placeId: string, label: string, at: number, sessions: Array<{ sid: string; name: string }>): RemoteHealthReport {
  return {
    id: placeId,
    label,
    status: 'ok',
    checkedAt: at,
    lastOkAt: at,
    severity: 'ok',
    reading: { readAt: at, sessionDetails: sessions.map((s) => ({ ...s, pane: 'busy', paneActivityAt: at, lastAt: at, transcript: true, turn: 'open', last: 'tool', retry: null })) },
  } as unknown as RemoteHealthReport;
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-aviso-'));
  dirs.push(dir);
  const state = { clock: QUEDA_VPS - 10 * MIN, reached: true, oraculoUp: true, loseNext: null as LedgerOp['op'] | null };
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => state.clock });
  const notes: string[] = [];
  const ops: LedgerOp[] = [];
  const leaderNotices: string[] = [];
  const vigia = createVigiaService({
    places: () => [{ id: 'vps', label: 'VPS pessoal', sshTarget: 'vps' }],
    run: async (_target, script) => {
      if (!state.reached) return { code: 255, stdout: '', stderr: 'ssh: connect to host vps port 22: Connection timed out', timedOut: false };
      return { code: 0, stdout: script.includes('DONEL_PM') ? SAR_DA_QUEDA : 'DONEL_VIGIA_OK\n', stderr: '', timedOut: false };
    },
    reports: () => [report('vps', 'VPS pessoal', state.clock, [{ sid: 's-dev', name: 'Dev · celular' }])],
    apply: async (actor, op) => {
      if (!state.oraculoUp) return { ok: false, reason: 'O Oráculo não respondeu.' };
      ops.push(op);
      const result = await ledger.apply(actor, op);
      if (state.loseNext === op.op) {
        // Written, but the answer was lost on the way back (the remote ledger says "pode ter sido gravada").
        state.loseNext = null;
        return { ok: false, reason: 'a operação pode ter sido gravada' };
      }
      return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
    },
    tasks: () => Object.values(ledger.load().doc.tasks),
    projectPath: () => '/projetos/donel',
    placeOfSession: (sid) => (sid === 's-dev' ? { projectPath: '/projetos/donel', placeId: 'p-dev' } : undefined),
    cofre: () => null,
    notify: (title, body) => notes.push(`${title} | ${body}`),
    avisarLider: async (message) => {
      leaderNotices.push(message.text);
      return 'lider';
    },
    statePath: join(dir, 'vigia-travas.json'),
    now: () => state.clock,
  });
  const at = async (when: number): Promise<void> => {
    state.clock = when;
    await vigia.round();
  };
  /** One fall of the place from `start` to `end`, read every 5 min. */
  const fall = async (start: number, end: number): Promise<void> => {
    state.reached = false;
    for (let t = start; t < end; t += 5 * MIN) await at(t);
    state.reached = true;
    await at(end);
  };
  return { state, ledger, notes, ops, leaderNotices, at, fall, statePath: join(dir, 'vigia-travas.json') };
}

describe('serviço: a trava que passou é registro; a viva e a repetida pedem decisão', () => {
  it('a queda de 07:30–08:08: carta viva com a máquina e o horário; quando passa, ela some e fica o registro, sem pedir nada', async () => {
    const t = setup();
    const work = await t.ledger.apply({ kind: 'lugar', placeId: 'p-dev', roleId: 'dev' }, { op: 'criar', projectPath: '/projetos/donel', title: 'Botões com tamanho fixo', request: 'x', doneWhen: 'y', due: '2026-11-17', ownerPlaceId: 'p-dev', risk: 'baixo' });
    if (!work.ok) throw new Error(work.reason);
    await t.ledger.apply({ kind: 'lugar', placeId: 'p-dev', roleId: 'dev' }, { op: 'assumir', id: work.task.id });
    await t.at(QUEDA_VPS - 5 * MIN); // the sessions are read before the fall
    t.state.reached = false;
    await t.at(QUEDA_VPS);
    await t.at(QUEDA_VPS + 5 * MIN);
    const live = ownerInbox((await t.ledger.load()).doc, null, t.state.clock);
    expect(live).toHaveLength(1);
    expect(live[0]!.task.title).toBe('VPS pessoal fora do ar desde 17/11 07:30');
    const question = live[0]!.task.events.at(-1)!.forOwner!;
    expect(question.question).toBe('Chamo o Líder único para destravar a máquina VPS pessoal?');
    expect(question.summary).toContain('Uma sessão está parada nela, com uma tarefa em andamento.');
    expect(JSON.stringify(live[0]!.task.events[0])).toContain('Travas das máquinas');

    for (let when = QUEDA_VPS + 10 * MIN; when < VOLTA_VPS; when += 5 * MIN) await t.at(when);
    t.state.reached = true;
    await t.at(VOLTA_VPS);
    const { doc } = await t.ledger.load();
    expect(ownerInbox(doc, null, t.state.clock)).toEqual([]);
    const records = Object.values(doc.tasks).filter((task) => closedAlone(task));
    expect(records).toHaveLength(1);
    expect(records[0]!.title).toBe('VPS pessoal fora do ar 17/11 07:30–08:08 (38 min)');
    const body = JSON.stringify(records[0]!.events);
    expect(body).toContain('Dev · celular');
    expect(body).toContain('Botões com tamanho fixo');
    expect(body).toContain('carga até 287,3 em 4 CPUs');
  });

  it('com o Oráculo fora a queda toda, o aviso espera na fila e sai depois com o horário da queda', async () => {
    const t = setup();
    t.state.oraculoUp = false;
    await t.fall(QUEDA_VPS, VOLTA_VPS);
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0]).toContain('17/11 07:30');
    expect(JSON.parse(readFileSync(t.statePath, 'utf8')).records).toHaveLength(1);
    t.state.oraculoUp = true;
    await t.at(VOLTA_VPS + 40 * MIN);
    const { doc } = await t.ledger.load();
    expect(ownerInbox(doc, null, t.state.clock)).toEqual([]);
    const records = Object.values(doc.tasks).filter((task) => closedAlone(task));
    expect(records.map((task) => task.title)).toEqual(['VPS pessoal fora do ar 17/11 07:30–08:08 (38 min)']);
    expect(JSON.stringify(records[0]!.events)).toContain(LATE_LINE);
    expect(JSON.parse(readFileSync(t.statePath, 'utf8')).records).toEqual([]);
  });

  it('a mesma queda 3 vezes em 24 h vira uma carta com pergunta real; "Investigar" abre a tarefa ao Líder único', async () => {
    const t = setup();
    await t.fall(QUEDA_VPS, QUEDA_VPS + 20 * MIN);
    await t.fall(QUEDA_VPS + 3 * 60 * MIN, QUEDA_VPS + 3 * 60 * MIN + 15 * MIN);
    expect(ownerInbox((await t.ledger.load()).doc, null, t.state.clock)).toEqual([]);
    await t.fall(QUEDA_VPS + 6 * 60 * MIN, QUEDA_VPS + 6 * 60 * MIN + 30 * MIN);
    const inbox = ownerInbox((await t.ledger.load()).doc, null, t.state.clock);
    expect(inbox).toHaveLength(1);
    const card = inbox[0]!.task;
    expect(card.title).toBe('VPS pessoal caiu 3 vezes em 24 h');
    const forOwner = card.events.at(-1)!.forOwner!;
    expect(forOwner.question).toContain('Mando investigar');
    expect(forOwner.summary).toContain('17/11 07:30–07:50 (20 min)');
    expect(forOwner.summary).toContain('17/11 13:30–14:00 (30 min)');
    // A 4th fall the same day does not make a second card.
    await t.fall(QUEDA_VPS + 9 * 60 * MIN, QUEDA_VPS + 9 * 60 * MIN + 10 * MIN);
    expect(ownerInbox((await t.ledger.load()).doc, null, t.state.clock)).toHaveLength(1);

    expect((await t.ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: card.id, option: 'Investigar' })).ok).toBe(true);
    await t.at(t.state.clock + 5 * MIN);
    const investigation = Object.values((await t.ledger.load()).doc.tasks).filter((task) => task.ownerPlaceId === 'lider');
    expect(investigation).toHaveLength(1);
    expect(investigation[0]!.request).toContain(card.id);
    await t.at(t.state.clock + 5 * MIN);
    expect(Object.values((await t.ledger.load()).doc.tasks).filter((task) => task.ownerPlaceId === 'lider')).toHaveLength(1);
  });
});

describe('o que o dono lê do vigia: a 1ª frase uma vez só e quem entregou com nome (t-f4cd92fb)', () => {
  it('a carta viva e o registro da queda dizem "VPS pessoal fora do ar" uma vez só, entregues pelo Vigia de travas, nunca "Servico"', async () => {
    const t = setup();
    t.state.reached = false;
    await t.at(QUEDA_VPS);
    await t.at(QUEDA_VPS + 5 * MIN);
    t.state.reached = true;
    await t.at(QUEDA_VPS + 10 * MIN);
    const tasks = Object.values((await t.ledger.load()).doc.tasks).filter((task) => task.ownerPlaceId === 'servico:vigia');
    const live = tasks.find((task) => task.risk === 'alto')!;
    const record = tasks.find((task) => closedAlone(task))!;
    for (const task of [live, record]) {
      const delivery = lastDelivery(task)!;
      // What the PC's card and the phone's Missões show together: the title (the same as forOwner.title), the
      // question, the summary, the note and the text proof.
      const read = [task.title, delivery.forOwner?.question, delivery.forOwner?.summary, eventNote(delivery), ...(delivery.proofs ?? []).map((proof) => (proof.kind === 'texto' ? proof.text : ''))].join('\n');
      expect(read.split('VPS pessoal fora do ar').length - 1).toBe(1);
      expect(actorName(delivery.by, task.projectPath, undefined, 'Alexandre')).toBe('Vigia de travas');
      expect(actorLabel(delivery.by, task.projectPath, undefined)).toBe('Vigia de travas');
    }
    // The records written before this fix (roleId "servico") are named the same way when read.
    expect(actorName({ kind: 'lugar', placeId: 'servico:vigia', roleId: 'servico' }, '/projetos/donel', undefined, 'Alexandre')).toBe('Vigia de travas');
  });
});

describe('serviço: o que o dono escolhe e o que se perde no caminho', () => {
  it('na carta viva, "Chamar o Líder único" abre uma tarefa ao Líder único, uma só', async () => {
    const t = setup();
    t.state.reached = false;
    await t.at(QUEDA_VPS);
    await t.at(QUEDA_VPS + 5 * MIN);
    const card = ownerInbox((await t.ledger.load()).doc, null, t.state.clock)[0]!.task;
    expect((await t.ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: card.id, option: 'Chamar o Líder único' })).ok).toBe(true);
    await t.at(QUEDA_VPS + 10 * MIN);
    await t.at(QUEDA_VPS + 15 * MIN);
    const leader = Object.values((await t.ledger.load()).doc.tasks).filter((task) => task.ownerPlaceId === 'lider');
    expect(leader.map((task) => task.title)).toEqual(['Destravar: VPS pessoal fora do ar']);
    expect(leader[0]!.request).toContain('17/11 07:30');
    // The Líder único is told (once), not left to find it on his next read (ressalva do #555).
    expect(t.leaderNotices).toHaveLength(1);
    expect(t.leaderNotices[0]).toContain(leader[0]!.id);
  });

  it('a resposta do Oráculo se perde ao criar a tarefa do Líder único: na rodada seguinte não sai outra', async () => {
    const t = setup();
    t.state.reached = false;
    await t.at(QUEDA_VPS);
    await t.at(QUEDA_VPS + 5 * MIN);
    const card = ownerInbox((await t.ledger.load()).doc, null, t.state.clock)[0]!.task;
    expect((await t.ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: card.id, option: 'Chamar o Líder único' })).ok).toBe(true);
    t.state.loseNext = 'criar';
    await t.at(QUEDA_VPS + 10 * MIN);
    await t.at(QUEDA_VPS + 15 * MIN);
    await t.at(QUEDA_VPS + 20 * MIN);
    expect(Object.values((await t.ledger.load()).doc.tasks).filter((task) => task.ownerPlaceId === 'lider')).toHaveLength(1);
  });

  it('sem leitura do trabalho, a capa da carta viva não conta tarefas', () => {
    const live = liveCard({ label: 'VPS pessoal', kind: 'vps-fora', firstSeen: QUEDA_VPS, detail: 'x', affected: { sessions: ['a', 'b'], tasks: [{ id: 't-1', title: 'x' }], readAt: QUEDA_VPS, tasksRead: false } });
    expect(live.forOwner.summary).toContain('2 sessões estão paradas nela.');
    expect(live.forOwner.summary).not.toContain('tarefa');
  });

  it('a resposta do Oráculo se perde na entrega do registro: na rodada seguinte não sai um segundo registro', async () => {
    const t = setup();
    t.state.reached = false;
    await t.at(QUEDA_VPS);
    await t.at(QUEDA_VPS + 5 * MIN);
    t.state.reached = true;
    t.state.loseNext = 'entregar';
    await t.at(QUEDA_VPS + 10 * MIN);
    await t.at(QUEDA_VPS + 15 * MIN);
    await t.at(QUEDA_VPS + 20 * MIN);
    const records = Object.values((await t.ledger.load()).doc.tasks).filter((task) => task.ownerPlaceId === 'servico:vigia' && task.risk === 'baixo');
    expect(records).toHaveLength(1);
    expect(closedAlone(records[0]!)).toBe(true);
    expect(JSON.parse(readFileSync(t.statePath, 'utf8')).records).toEqual([]);
  });

  it('dois registros da mesma máquina no mesmo dia não se confundem', async () => {
    const t = setup();
    await t.fall(QUEDA_VPS, QUEDA_VPS + 20 * MIN);
    await t.fall(QUEDA_VPS + 60 * MIN, QUEDA_VPS + 75 * MIN);
    const titles = Object.values((await t.ledger.load()).doc.tasks).filter((task) => closedAlone(task)).map((task) => task.title);
    expect(titles).toEqual(['VPS pessoal fora do ar 17/11 07:30–07:50 (20 min)', 'VPS pessoal fora do ar 17/11 08:30–08:45 (15 min)']);
  });
});

describe('repetição e registro: o que o dono lê é verdade', () => {
  it('a carta de repetição viva segura a próxima: sem resposta em 24 h, não sai uma segunda', async () => {
    const t = setup();
    for (const h of [0, 3, 6]) await t.fall(QUEDA_VPS + h * 60 * MIN, QUEDA_VPS + h * 60 * MIN + 15 * MIN);
    expect(ownerInbox((await t.ledger.load()).doc, null, t.state.clock)).toHaveLength(1);
    // More than 24 h later, still unanswered, and 3 more falls: the live card stays the only one.
    for (const h of [27, 29, 31]) await t.fall(QUEDA_VPS + h * 60 * MIN, QUEDA_VPS + h * 60 * MIN + 15 * MIN);
    const repeats = ownerInbox((await t.ledger.load()).doc, null, t.state.clock).filter((item) => item.task.title?.includes('vezes em 24 h'));
    expect(repeats).toHaveLength(1);
  });

  it('o registro só diz que mediu a causa quando mediu', () => {
    const semLeitura = probableCause({ kind: 'vps-fora', detail: 'x', start: QUEDA_VPS, end: VOLTA_VPS, pm: null, downTogether: [] });
    const semMedida = passedRecord({ label: 'VPS pessoal', kind: 'vps-fora', firstSeen: QUEDA_VPS, endedAt: VOLTA_VPS, cause: semLeitura, affected: NO_AFFECTED });
    expect(semMedida.body).not.toContain('mediu a causa');
    expect(semMedida.body).toContain('não conseguiu medir a causa');
    const cofre = probableCause({ kind: 'cofre', detail: 'o cofre está trancado', start: QUEDA_VPS, end: VOLTA_VPS, pm: null, downTogether: [] });
    expect(passedRecord({ label: 'VPS pessoal', kind: 'cofre', firstSeen: QUEDA_VPS, endedAt: VOLTA_VPS, cause: cofre, affected: NO_AFFECTED }).body).not.toContain('mediu a causa');
    const medida = probableCause({ kind: 'vps-fora', detail: 'x', start: QUEDA_VPS, end: VOLTA_VPS, pm: parsePostMortem(SAR_DA_QUEDA), downTogether: [] });
    expect(passedRecord({ label: 'VPS pessoal', kind: 'vps-fora', firstSeen: QUEDA_VPS, endedAt: VOLTA_VPS, cause: medida, affected: NO_AFFECTED }).body).toContain('mediu a causa na máquina');
  });

  it.skipIf(process.platform === 'win32')('a janela do sar que vira a meia-noite lê os dois dias (sar e arquivos de mentira)', () => {
    // 19/11 23:50 a 20/11 00:30 em Brasília; o pico de carga (9,5) está no arquivo do dia 20, às 00:20.
    const dir = mkdtempSync(join(tmpdir(), 'sar-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'sa19'), '23:50:01 18 917 1.10 0.25 0.47 0\n');
    writeFileSync(join(dir, 'sa20'), '00:10:01 18 869 0.30 0.27 0.34 0\n00:20:01 19 889 9.50 0.64 0.42 7\n');
    // A fake sar: prints the lines of the file (-f) between -s and -e; -S prints a swap line.
    writeFileSync(join(dir, 'bin', 'sar'), `#!/bin/sh\nmodo=$1; shift\nwhile [ $# -gt 0 ]; do case $1 in -f) f=$2;; -s) s=$2;; -e) e=$2;; esac; shift; done\nif [ "$modo" = "-S" ]; then echo "00:20:01 1 1 40.00 0 0"; exit 0; fi\nawk -v s="$s" -v e="$e" '$1 >= s && $1 <= e' "$f"\n`);
    chmodSync(join(dir, 'bin', 'sar'), 0o755);
    const script = buildPostMortemScript(Date.UTC(2026, 10, 20, 2, 50), Date.UTC(2026, 10, 20, 3, 30));
    const run = spawnSync('sh', ['-c', script], { env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, TZ: 'America/Sao_Paulo', DONEL_SA_DIR: dir }, encoding: 'utf8' });
    const pm = parsePostMortem(run.stdout);
    expect(pm?.maxLoad).toBe(9.5);
    expect(pm?.maxBlocked).toBe(7);
  });
});

describe('fila: a carta de repetição com o Oráculo fora', () => {
  it('a 3ª queda passa com o Oráculo fora: a carta de repetição sai quando ele volta', async () => {
    const t = setup();
    await t.fall(QUEDA_VPS, QUEDA_VPS + 20 * MIN);
    await t.fall(QUEDA_VPS + 3 * 60 * MIN, QUEDA_VPS + 3 * 60 * MIN + 15 * MIN);
    t.state.oraculoUp = false;
    await t.fall(QUEDA_VPS + 6 * 60 * MIN, QUEDA_VPS + 6 * 60 * MIN + 30 * MIN);
    await t.at(t.state.clock + 5 * MIN);
    t.state.oraculoUp = true;
    await t.at(t.state.clock + 5 * MIN);
    const inbox = ownerInbox((await t.ledger.load()).doc, null, t.state.clock);
    expect(inbox.map((item) => item.task.title)).toEqual(['VPS pessoal caiu 3 vezes em 24 h']);
    expect(Object.values((await t.ledger.load()).doc.tasks).filter((task) => closedAlone(task))).toHaveLength(3);
    await t.at(t.state.clock + 5 * MIN);
    expect(ownerInbox((await t.ledger.load()).doc, null, t.state.clock)).toHaveLength(1);
  });
});

describe('regra do Oráculo: só o registro do vigia fecha sozinho', () => {
  const ctx = (id: string) => ({ now: QUEDA_VPS, newId: () => id });
  const born = (placeId: string) => {
    const actor = { kind: 'lugar' as const, placeId, roleId: 'servico' };
    let doc = emptyLedgerDoc();
    const made = applyLedgerOp(doc, actor, { op: 'criar', projectPath: '/p', request: 'x', doneWhen: 'y', due: '2026-11-17', ownerPlaceId: placeId, risk: 'baixo' }, ctx('t-1'));
    if (!made.ok) throw new Error(made.reason);
    doc = made.doc;
    const taken = applyLedgerOp(doc, actor, { op: 'assumir', id: 't-1' }, ctx('t-1'));
    if (!taken.ok) throw new Error(taken.reason);
    return { actor, doc: taken.doc };
  };
  const deliver = { op: 'entregar' as const, id: 't-1', proofs: [{ kind: 'texto' as const, text: 'registro' }], closeAlone: true as const };

  it('o vigia fecha o próprio registro de risco baixo; outro serviço não', () => {
    const vigia = born('servico:vigia');
    const closed = applyLedgerOp(vigia.doc, vigia.actor, deliver, ctx('t-1'));
    expect(closed.ok && closedAlone(closed.task)).toBe(true);
    const other = born('servico:slack');
    expect(applyLedgerOp(other.doc, other.actor, deliver, ctx('t-1')).ok).toBe(false);
  });
});
