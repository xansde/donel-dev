import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, parseEsteiraResult, type ContractIssueCode } from '../src/shared/esteira/contract/resultContract';
import { resultToEvents } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { cardView, deliveryLine } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (A15) — o CANAL da entrega.
//
// Num repo com escada alfa→beta→stable, "concluído" sem destino se lê como
// "está na main". O card precisa dizer ONDE a coisa chegou — e não pode
// deduzir: o apelido do canal é vocabulário do repo, não do contrato.

const WI = { entity: 'work_item', id: 'wi-1' } as const;

function concluir(facts: unknown[]): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    kind: 'esteira.result',
    run: {
      run_id: 'run-1',
      phase: 'concluir',
      status: 'success',
      started_at: '2026-08-04T12:00:00.000Z',
      finished_at: '2026-08-04T12:30:00.000Z',
      failure: null,
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

const pr = (base: string | null, state: 'passed' | 'pending' | 'failed' = 'passed'): Record<string, unknown> => ({
  type: 'verification.recorded',
  subject: WI,
  verification_kind: 'pull-request',
  state,
  ref: 'https://github.com/exemplo/atlas/pull/128',
  base,
});

const fechada = (channel: string | null): Record<string, unknown> => ({
  type: 'phase.completed',
  subject: WI,
  phase: 'concluir',
  outcome: 'done',
  summary: null,
  channel,
});

/** O card mínimo: um discovery, um item e os eventos do run de concluir. */
function cardDo(doc: Record<string, unknown>) {
  const parsed = parseEsteiraResult(doc);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  const drafts = resultToEvents(parsed.result, { resultPath: 'C:/x.json' });
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

describe('A15 — o canal da entrega', () => {
  it('base e canal declarados: o card diz os dois', () => {
    expect(deliveryLine(cardDo(concluir([pr('staging'), fechada('alfa')])))).toBe('Entregue em staging (alfa).');
  });

  it('só a base: o card diz a base e NÃO inventa o canal', () => {
    expect(deliveryLine(cardDo(concluir([pr('staging'), fechada(null)])))).toBe('Entregue em staging.');
  });

  it('só o canal: o card diz o canal', () => {
    expect(deliveryLine(cardDo(concluir([pr(null), fechada('beta')])))).toBe('Entregue no canal beta.');
  });

  it('nenhum dos dois: o card não afirma nada sobre destino', () => {
    expect(deliveryLine(cardDo(concluir([pr(null), fechada(null)])))).toBeNull();
  });

  it('a base sobrevive ao store — é parte do desfecho, não decoração', () => {
    const card = cardDo(concluir([pr('staging'), fechada('alfa')]));
    expect(card.verifications[0].base).toBe('staging');
    expect(card.phases[0].channel).toBe('alfa');
  });

  it('PR ainda pending com base declarada NÃO é "entregue" — achado da captura tutorial-e2e (batch n1, 2026-08-05)', () => {
    // O fallback antigo aceitava `base` de QUALQUER estado, então um PR
    // 'pending' já produzia "Entregue em staging." lado a lado com "PR
    // aberto, ainda não verificado" — a mesma tela se contradizendo. O check
    // passado (de outra verificação, ex.: npm test numa fase anterior) só
    // cumpre o D-4 do run de exemplo; quem decide `deliveryLine` é o PR.
    const check = { type: 'verification.recorded', subject: WI, verification_kind: 'check', state: 'passed', ref: 'npm test' };
    expect(deliveryLine(cardDo(concluir([check, pr('staging', 'pending'), fechada(null)])))).toBeNull();
  });

  it('base fora de um PR é recusada — check e revisão não têm branch de destino', () => {
    const doc = concluir([
      { type: 'verification.recorded', subject: WI, verification_kind: 'check', state: 'passed', ref: 'npm test', base: 'staging' },
      fechada(null),
    ]);
    // O parser aceita a forma; quem cobra a coerência é o emissor da skill
    // (o app nunca recusa o que consegue ler sem ambiguidade). O que importa
    // aqui é que o campo não vaza para a frase do canal.
    expect(codesOf(doc)).toEqual([]);
    expect(deliveryLine(cardDo(doc))).toBeNull();
  });
});
