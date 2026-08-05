import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, parseEsteiraResult, type ContractIssueCode } from '../src/shared/esteira/contract/resultContract';
import { resultToEvents } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { cardView, gateLines } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 — os fatos que dependem de GENTE: gate confirmado (A9), decisão
// tomada (A18), revisão humana (A10) e gesto humano esperado (A19).
//
// O que eles têm em comum, e por que moram no mesmo arquivo: nenhum deles é
// dedutível do repo. Enquanto viviam como texto (blockquote no `tasks.md`,
// frase no `summary`), o app tinha duas opções ruins — adivinhar ou calar. Os
// dois vícios que a spec 010 existe para extinguir.

const RUN = {
  run_id: 'run-1',
  phase: 'discovery',
  status: 'success',
  started_at: '2026-08-04T12:00:00.000Z',
  finished_at: '2026-08-04T12:30:00.000Z',
  failure: null,
};

export function resultWith(facts: unknown[], run: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    kind: 'esteira.result',
    run: { ...RUN, ...run },
    actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
    subject: { discovery_id: 'dsc-1', plan_id: null, work_item_id: null },
    workspace: null,
    facts,
  };
}

export function codesOf(input: unknown): ContractIssueCode[] {
  const parsed = parseEsteiraResult(input);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.code);
}

const DSC = { entity: 'discovery', id: 'dsc-1' } as const;

const gate = (condition: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'gate.confirmed',
  subject: DSC,
  condition,
  confirmed_by: 'dono do repo',
  confirmed_at: null,
  ...extra,
});

const completedDiscovery = (outcome = 'done'): Record<string, unknown> => ({
  type: 'phase.completed',
  subject: DSC,
  phase: 'discovery',
  outcome,
  summary: null,
});

const discoveryRecorded = (): Record<string, unknown> => ({
  type: 'discovery.recorded',
  discovery_id: 'dsc-1',
  title: 'Fila trava sem sinal',
  problem: null,
  tracker: null,
  target_repo: null,
  scope_repos: [],
});

// ---------------------------------------------------------------------------
// A9 — gate.confirmed
// ---------------------------------------------------------------------------

describe('A9 — a confirmação de gate é fato, não blockquote', () => {
  it('o parser aceita a confirmação com condição e quem confirmou', () => {
    const parsed = parseEsteiraResult(
      resultWith([discoveryRecorded(), gate('o repo alvo é atlas', { confirmed_at: '2026-08-04T12:10:00.000Z' }), completedDiscovery()]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fact = parsed.result.facts.find((entry) => entry.type === 'gate.confirmed');
    expect(fact).toEqual({
      type: 'gate.confirmed',
      subject: { entity: 'discovery', id: 'dsc-1' },
      condition: 'o repo alvo é atlas',
      confirmed_by: 'dono do repo',
      confirmed_at: '2026-08-04T12:10:00.000Z',
    });
  });

  it('confirmação sem quem confirmou é recusada — aval sem gente é o app se dando o próprio aval', () => {
    const semGente = { ...gate('o repo alvo é atlas') };
    delete semGente.confirmed_by;
    expect(codesOf(resultWith([discoveryRecorded(), semGente, completedDiscovery()]))).toContain('missing_field');
  });

  it('gate COMPOSTO vira duas linhas no store — meia-confirmação passa a ser expressável', () => {
    const parsed = parseEsteiraResult(
      resultWith([discoveryRecorded(), gate('a spec está aprovada'), gate('o repo alvo é atlas'), completedDiscovery()]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const drafts = resultToEvents(parsed.result, { resultPath: 'C:/tmp/result.json' });
    const gates = drafts.filter((draft) => draft.type === 'gate.confirmed');
    expect(gates).toHaveLength(2);
    // Chaves naturais distintas: uma condição confirmada não cobre a outra.
    expect(new Set(gates.map((draft) => draft.dedupe_key)).size).toBe(2);
  });

  it('o reducer guarda uma condição por registro e a reconfirmação atualiza quem confirmou', () => {
    const events: StoreEvent[] = [
      {
        seq: 1,
        event_id: 'evt-1',
        at: '2026-08-04T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: 'a',
        payload: { subject: DSC, condition: 'a spec está aprovada', confirmedBy: 'revisor', confirmedAt: '2026-08-04T12:05:00.000Z' },
      },
      {
        seq: 2,
        event_id: 'evt-2',
        at: '2026-08-05T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: 'b',
        payload: { subject: DSC, condition: 'a spec está aprovada', confirmedBy: 'dono do repo', confirmedAt: '2026-08-05T09:00:00.000Z' },
      },
      {
        seq: 3,
        event_id: 'evt-3',
        at: '2026-08-05T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: 'c',
        payload: { subject: DSC, condition: 'o repo alvo é atlas', confirmedBy: 'dono do repo' },
      },
    ];

    const snapshot = reduceEvents(events, { builtAt: '2026-08-05T13:00:00.000Z' });
    expect(snapshot.gates).toHaveLength(2);
    const aprovada = snapshot.gates.find((entry) => entry.condition === 'a spec está aprovada');
    expect(aprovada?.confirmedBy).toBe('dono do repo');
    // Sem `confirmedAt` declarado, a hora do evento — nunca uma hora inventada.
    expect(snapshot.gates.find((entry) => entry.condition === 'o repo alvo é atlas')?.confirmedAt).toBe('2026-08-05T12:30:00.000Z');
  });

  it('o card mostra uma linha por condição, com quem confirmou', () => {
    const events: StoreEvent[] = [
      {
        seq: 1,
        event_id: 'evt-1',
        at: '2026-08-04T12:30:00.000Z',
        type: 'discovery.created',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { id: 'dsc-1', title: 'Fila trava sem sinal' },
      },
      {
        seq: 2,
        event_id: 'evt-2',
        at: '2026-08-04T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { subject: DSC, condition: 'o repo alvo é atlas', confirmedBy: 'dono do repo', confirmedAt: '2026-08-04T12:10:00.000Z' },
      },
    ];

    const card = cardView(reduceEvents(events), 'dsc-1');
    expect(card).not.toBeNull();
    const lines = gateLines(card!);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('«o repo alvo é atlas»');
    expect(lines[0].text).toContain('confirmado por dono do repo');
  });
});
