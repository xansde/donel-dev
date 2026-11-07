// Painel de progresso do Jobu (owner, 07/11: "Não consigo saber quais demandas que eu solicitei você está tocando ou
// não") — only the owner's asks, by front, each in one of four states, and what ended leaves the list.
import { describe, expect, it } from 'vitest';
import { applyLedgerOp, emptyLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerForOwner, type LedgerOp } from '../src/shared/ledger/contract';
import { jobuProgress } from '../src/shared/pet/progress';

const H = 60 * 60 * 1000;
const T0 = new Date(2026, 10, 7, 9, 0).getTime();
const lider: LedgerActor = { kind: 'lugar', placeId: 'place:lider', roleId: 'lider' };
const dev: LedgerActor = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' };
const revisor: LedgerActor = { kind: 'lugar', placeId: 'place:rev', roleId: 'revisor' };
const proofs = [{ kind: 'texto' as const, text: 'ok' }];
const FOR_OWNER: LedgerForOwner = {
  question: 'Aceito assim?',
  summary: 'Feito e testado.',
  options: [
    { label: 'Aceitar', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
    { label: 'Refazer', effect: 'Volta para quem fez.', closes: 'rejeitada' },
  ],
  why: 'Os testes passaram.',
  risk: 'Baixo.',
};

function run(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp, now: number, id = 'x'): LedgerDoc {
  const result = applyLedgerOp(doc, actor, op, { now, newId: () => id });
  if (!result.ok) throw new Error(result.reason);
  return result.doc;
}

interface Ask {
  readonly id: string;
  readonly frente?: string;
  readonly requestedBy?: string;
  readonly risk?: 'baixo' | 'alto';
  readonly title?: string;
  readonly request?: string;
}

function ask(doc: LedgerDoc, { id, frente, requestedBy = 'dono', risk = 'baixo', title, request = `Fazer ${id}` }: Ask, at = T0): LedgerDoc {
  return run(doc, lider, { op: 'criar', projectPath: '/w/atlas', request, doneWhen: 'feito', due: '2026-11-09', ownerPlaceId: 'place:dev', risk, ...(title ? { title } : {}), ...(requestedBy ? { requestedBy } : {}), ...(frente ? { frente } : {}) }, at, id);
}

describe('jobuProgress', () => {
  it('shows only the owner asks, grouped by front, with a short title; no front goes last, as "Sem frente"', () => {
    let doc = emptyLedgerDoc();
    doc = ask(doc, { id: 'a', frente: 'Ledger', title: 'Caixa do dono' });
    doc = ask(doc, { id: 'b', frente: 'Oráculo na VPS', request: 'E se o oráculo rodar dentro do VPS? Sei que é pedir demais para hoje' });
    doc = ask(doc, { id: 'c' });
    doc = ask(doc, { id: 'd', frente: 'Ledger', requestedBy: 'Gabriel Horst (Slack)' });
    doc = ask(doc, { id: 'e', frente: 'Ledger', requestedBy: '' });

    const { fronts } = jobuProgress(doc, T0 + H);
    expect(fronts.map((front) => [front.name, front.tasks.map((task) => task.id)])).toEqual([
      ['Ledger', ['a']],
      ['Oráculo na VPS', ['b']],
      ['', ['c']],
    ]);
    expect(fronts[0]!.tasks[0]!.title).toBe('Caixa do dono');
    // No title: the first sentence of the request, never the whole of it.
    expect(fronts[1]!.tasks[0]!.title).toBe('E se o oráculo rodar dentro do VPS?');
  });

  it('says each ask in one of four states, and who has it', () => {
    let doc = emptyLedgerDoc();
    for (const id of ['aberta', 'rodando', 'calada', 'carta', 'revisao', 'esquecida', 'voltou']) doc = ask(doc, { id, frente: 'F', risk: id === 'carta' ? 'alto' : 'baixo' });
    for (const id of ['rodando', 'calada', 'carta', 'revisao', 'esquecida', 'voltou']) doc = run(doc, dev, { op: 'assumir', id }, T0 + H);
    doc = run(doc, dev, { op: 'entregar', id: 'esquecida', proofs }, T0 + 2 * H);
    doc = run(doc, dev, { op: 'entregar', id: 'voltou', proofs }, T0 + 2 * H);
    doc = run(doc, revisor, { op: 'rejeitar', id: 'voltou', reason: 'faltou Y' }, T0 + 3 * H);
    const now = T0 + 26 * H;
    doc = run(doc, dev, { op: 'entregar', id: 'carta', proofs, forOwner: FOR_OWNER }, now - H);
    doc = run(doc, dev, { op: 'entregar', id: 'revisao', proofs }, now - H);
    doc = run(doc, dev, { op: 'entregar', id: 'rodando', proofs }, now - H);
    doc = run(doc, revisor, { op: 'rejeitar', id: 'rodando', reason: 'faltou Z' }, now - H);
    doc = run(doc, dev, { op: 'assumir', id: 'rodando' }, now - H / 2);
    // The Líder naming the front an hour ago is no news from who has it.
    doc = run(doc, lider, { op: 'frente', id: 'calada', frente: 'F' }, now - H);

    const tasks = jobuProgress(doc, now).fronts[0]!.tasks;
    const byId = Object.fromEntries(tasks.map((task) => [task.id, [task.state, task.who]]));
    expect(byId).toEqual({
      carta: ['esperando', 'você decide na carta'],
      voltou: ['travado', 'voltou da revisão; ninguém retomou'],
      rodando: ['tocando', 'Dev'],
      revisao: ['tocando', 'entregue; o Revisor confere'],
      aberta: ['parado', 'ninguém assumiu'],
      // A day without a word from who took it is not "tocando".
      calada: ['parado', 'Dev, sem notícia há 1 d'],
      esquecida: ['parado', 'entregue há 24 h; ninguém conferiu'],
    });
    // What needs the owner comes first.
    expect(tasks.map((task) => task.state)).toEqual(['esperando', 'travado', 'tocando', 'tocando', 'parado', 'parado', 'parado']);
  });

  it('what ended leaves the list: accepted today only counts, cancelled vanishes, and the bar counts the steps of the front', () => {
    let doc = emptyLedgerDoc();
    for (const id of ['feita', 'ontem', 'rodando', 'cancelada']) doc = ask(doc, { id, frente: 'F' }, T0 - 30 * H);
    doc = ask(doc, { id: 'so-feita', frente: 'G' }, T0 - 30 * H);
    for (const id of ['feita', 'ontem', 'rodando', 'so-feita']) doc = run(doc, dev, { op: 'assumir', id }, T0 - 29 * H);
    for (const id of ['feita', 'ontem', 'so-feita']) doc = run(doc, dev, { op: 'entregar', id, proofs }, T0 - 28 * H);
    doc = run(doc, revisor, { op: 'aceitar', id: 'ontem' }, T0 - 27 * H);
    doc = run(doc, revisor, { op: 'aceitar', id: 'feita' }, T0);
    doc = run(doc, revisor, { op: 'aceitar', id: 'so-feita' }, T0);
    doc = run(doc, lider, { op: 'cancelar', id: 'cancelada', reason: 'não vai sair' }, T0);
    doc = run(doc, dev, { op: 'entregar', id: 'rodando', proofs }, T0 + H);

    const progress = jobuProgress(doc, T0 + 2 * H);
    // A front with nothing left alive leaves too; its accept still counts today.
    expect(progress.fronts.map((front) => front.name)).toEqual(['F']);
    const front = progress.fronts[0]!;
    expect(front.tasks.map((task) => task.id)).toEqual(['rodando']);
    expect(front.doneToday).toBe(1);
    // rodando delivered (2 of 3) + feita accepted today (3 of 3).
    expect([front.steps, front.totalSteps]).toEqual([5, 6]);
    expect(progress.doneToday.map((task) => task.id).sort()).toEqual(['feita', 'so-feita']);
  });
});
