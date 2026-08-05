import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, parseEsteiraResult, type ContractIssueCode } from '../src/shared/esteira/contract/resultContract';
import { resultToEvents } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { cardView, reviewChecklist, reviewChecklistTitle } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (A10 + A19) — o que sobrou para VOCÊ.
//
// A10: a lista viajava como texto no `summary` — uma frase corrida com três
// coisas dentro, que ninguém lê como lista e ninguém marca como feita. E no
// `summary` não cabe a distinção que importa: "confira o que eu fiz" e "faça o
// que eu não podia fazer" são pedidos diferentes.
//
// A19: esperar por gente NÃO é falha da fase. Falha é o que a fase deveria ter
// feito e não fez; pintar espera de vermelho ensina a ignorar o vermelho.

const WI = { entity: 'work_item', id: 'wi-1' } as const;

function resultWith(facts: unknown[], run: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    kind: 'esteira.result',
    run: {
      run_id: 'run-1',
      phase: 'validar',
      status: 'success',
      started_at: '2026-08-04T12:00:00.000Z',
      finished_at: '2026-08-04T12:30:00.000Z',
      failure: null,
      ...run,
    },
    actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
    subject: { discovery_id: 'dsc-1', plan_id: null, work_item_id: 'wi-1' },
    workspace: null,
    facts,
  };
}

function codesOf(input: unknown): ContractIssueCode[] {
  const parsed = parseEsteiraResult(input);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.code);
}

const confira = (item: string, state = 'pending', detail: string | null = null) => ({ item, kind: 'review', state, detail });
const faca = (item: string, state = 'pending', detail: string | null = null) => ({ item, kind: 'action', state, detail });

const review = (checklist: unknown[], phase = 'validar'): Record<string, unknown> => ({
  type: 'human_review.recorded',
  subject: WI,
  phase,
  checklist,
});

const validado = (facts: unknown[]): Record<string, unknown> =>
  resultWith([
    { type: 'verification.recorded', subject: WI, verification_kind: 'review', state: 'passed', ref: 'sem bloqueio' },
    ...facts,
    { type: 'phase.completed', subject: WI, phase: 'validar', outcome: 'done', summary: null },
  ]);

/** O card mínimo em que a lista aparece: um discovery, um item e os eventos do run. */
function cardComEventos(drafts: readonly { type: string; at: string; dedupe_key: string | null; payload: Record<string, unknown> }[]) {
  const events: StoreEvent[] = [
    {
      seq: 1,
      event_id: 'e1',
      at: '2026-08-04T11:00:00.000Z',
      type: 'discovery.created',
      source: { kind: 'app' },
      dedupe_key: null,
      payload: { id: 'dsc-1', title: 'Fila trava sem sinal' },
    },
    {
      seq: 2,
      event_id: 'e2',
      at: '2026-08-04T11:00:00.000Z',
      type: 'work_item.created',
      source: { kind: 'app' },
      dedupe_key: null,
      payload: { id: 'wi-1', discoveryId: 'dsc-1', itemType: 'issue', title: 'Expor estado', targetRepo: 'atlas' },
    },
    ...drafts.map((draft, index) => ({
      seq: index + 3,
      event_id: `e${index + 3}`,
      at: draft.at,
      type: draft.type,
      source: { kind: 'app' } as const,
      dedupe_key: draft.dedupe_key,
      payload: draft.payload,
    })),
  ];
  return cardView(reduceEvents(events, { builtAt: '2026-08-04T13:00:00.000Z' }), 'dsc-1')!;
}

describe('A10 — revisão humana é lista estruturada, não frase no summary', () => {
  it('o parser aceita a lista com as duas naturezas', () => {
    const parsed = parseEsteiraResult(validado([review([confira('o teste cobre lote vazio'), faca('aprovar o PR')])]));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
    const fact = parsed.result.facts.find((entry) => entry.type === 'human_review.recorded');
    expect(fact?.type === 'human_review.recorded' && fact.checklist.map((entry) => entry.kind)).toEqual(['review', 'action']);
  });

  it('lista vazia é recusada — "tem coisa para você" sem dizer o que é não ajuda ninguém', () => {
    expect(codesOf(validado([review([])]))).toContain('empty_facts');
  });

  it('item sem natureza declarada é recusado — confira e faça são pedidos diferentes', () => {
    expect(codesOf(validado([review([{ item: 'algo', state: 'pending', detail: null }])]))).toContain('missing_field');
  });

  it('redeclarar a lista SUBSTITUI: metade respondida não convive com a versão inteira', () => {
    const parsed = parseEsteiraResult(validado([review([confira('o teste cobre lote vazio'), faca('aprovar o PR')])]));
    if (!parsed.ok) throw new Error('fixture inválida');
    const primeiro = resultToEvents(parsed.result, { resultPath: 'C:/a.json' }).find(
      (draft) => draft.type === 'human_review.recorded',
    )!;

    const events: StoreEvent[] = [
      { seq: 1, event_id: 'e1', at: primeiro.at, type: primeiro.type, source: { kind: 'app' }, dedupe_key: null, payload: primeiro.payload },
      {
        seq: 2,
        event_id: 'e2',
        at: '2026-08-05T12:00:00.000Z',
        type: 'human_review.recorded',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: {
          subject: WI,
          phase: 'validar',
          checklist: [{ item: 'o teste cobre lote vazio', kind: 'review', state: 'done', detail: 'conferido, cobre' }],
        },
      },
    ];

    const snapshot = reduceEvents(events, { builtAt: '2026-08-05T13:00:00.000Z' });
    expect(snapshot.humanReviews).toHaveLength(1);
    expect(snapshot.humanReviews[0].checklist).toHaveLength(1);
    expect(snapshot.humanReviews[0].checklist[0].state).toBe('done');
  });

  it('o card mostra verbo, item e estado — e o título conta o que falta', () => {
    const card = cardComEventos([
      {
        type: 'human_review.recorded',
        at: '2026-08-04T12:30:00.000Z',
        dedupe_key: null,
        payload: {
          subject: WI,
          phase: 'validar',
          checklist: [
            { item: 'o teste cobre lote vazio', kind: 'review', state: 'pending', detail: 'tests/fila.test.ts' },
            { item: 'aprovar o PR', kind: 'action', state: 'done', detail: null },
          ],
        },
      },
    ]);

    const lines = reviewChecklist(card);
    expect(lines.map((line) => line.text)).toEqual([
      'Confira: o teste cobre lote vazio — aguardando você',
      'Você precisa: aprovar o PR — respondido',
    ]);
    expect(lines[0].detail).toBe('tests/fila.test.ts');
    expect(reviewChecklistTitle(lines)).toBe('Revisão da fase (1 item aguardando você)');
  });
});

describe('A19 — esperar por gente não é falha da fase', () => {
  const comGestoPendente = (): Record<string, unknown> =>
    resultWith(
      [
        { type: 'verification.recorded', subject: WI, verification_kind: 'check', state: 'passed', ref: 'npm test' },
        review([faca('abrir o PR contra staging')], 'implementar'),
        { type: 'phase.completed', subject: WI, phase: 'implementar', outcome: 'done', summary: 'Falta só o PR, que é gesto seu.' },
      ],
      { phase: 'implementar' },
    );

  it('a fase sai CONCLUÍDA com o gesto humano pendente, e o run é success', () => {
    const parsed = parseEsteiraResult(comGestoPendente());
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
    expect(parsed.result.run.status).toBe('success');
  });

  it('a pendência humana vai NOMEADA, com tom de "há algo a fazer" — nunca de erro', () => {
    const parsed = parseEsteiraResult(comGestoPendente());
    if (!parsed.ok) throw new Error('fixture inválida');

    const card = cardComEventos(resultToEvents(parsed.result, { resultPath: 'C:/x.json' }));
    const aguardando = reviewChecklist(card).filter((line) => line.state === 'pending');
    expect(aguardando.map((line) => line.text)).toEqual(['Você precisa: abrir o PR contra staging — aguardando você']);
    expect(aguardando[0].tone).toBe('attention');
    expect(aguardando.every((line) => line.tone !== 'error')).toBe(true);

    // E a fase segue concluída: a espera não a rebaixa, e o card não ganha
    // sinal de erro por causa dela.
    expect(card.phases.find((phase) => phase.phase === 'implementar')?.outcome).toBe('done');
    expect(card.signals.every((signal) => signal.tone !== 'error')).toBe(true);
  });
});
