import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, parseEsteiraResult, type ContractIssueCode } from '../src/shared/esteira/contract/resultContract';
import { resultToEvents } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { cardView, verificationLines } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (A16) — o roteiro e2e MANUAL como check de verdade.
//
// O defeito: o gate de e2e conferia a EXISTENCIA do arquivo de roteiro na
// branch. "Escrito" e "rodado" viraram a mesma coisa, e uma fase fechou verde
// sem ninguém ter validado. Agora o roteiro é uma verificação de tipo próprio
// (`e2e-manual`), cujo `state` só sai de `pending` com resultado colhido do
// dono — e o aval humano não sai junto de um e2e que ninguém rodou.

const WI = { entity: 'work_item', id: 'wi-1' } as const;

function validar(facts: unknown[]): Record<string, unknown> {
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

const verificacao = (kind: string, state: string, ref: string | null = null): Record<string, unknown> => ({
  type: 'verification.recorded',
  subject: WI,
  verification_kind: kind,
  state,
  ref,
});

const e2e = (state: string): Record<string, unknown> =>
  verificacao('e2e-manual', state, '.claude/skills/tutorial-e2e/roteiros/fila.spec.ts');

const fechada = (risk: string | null): Record<string, unknown> => ({
  type: 'phase.completed',
  subject: WI,
  phase: 'validar',
  outcome: 'done',
  summary: null,
  risk,
  channel: null,
});

const gate = (): Record<string, unknown> => ({
  type: 'gate.confirmed',
  subject: WI,
  condition: 'pode seguir para concluir',
  confirmed_by: 'dono do repo',
  confirmed_at: null,
});

describe('A16 — o roteiro e2e manual é um check, não um arquivo na branch', () => {
  it('validar SENSÍVEL sem declarar o e2e é recusada', () => {
    expect(codesOf(validar([verificacao('review', 'passed'), fechada('sensivel')]))).toContain('sensitive_without_e2e');
  });

  it('validar sensível com o e2e ainda PENDENTE é aceita — esperar você rodar é legítimo (A19)', () => {
    expect(parseEsteiraResult(validar([verificacao('pull-request', 'pending'), e2e('pending'), fechada('sensivel')])).ok).toBe(true);
  });

  it('aprovação humana com o e2e pendente é recusada — era assim que a fase fechava verde', () => {
    const comReview = validar([verificacao('review', 'passed', 'aprovado por 1 revisor'), e2e('pending'), fechada('sensivel')]);
    expect(codesOf(comReview)).toContain('approval_before_e2e');

    const comGate = validar([verificacao('pull-request', 'pending'), e2e('pending'), gate(), fechada('sensivel')]);
    expect(codesOf(comGate)).toContain('approval_before_e2e');
  });

  it('com o e2e PASSADO, a aprovação humana é aceita', () => {
    const doc = validar([verificacao('review', 'passed', 'aprovado por 1 revisor'), e2e('passed'), fechada('sensivel')]);
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('com o e2e que FALHOU, a aprovação também é aceita — o dono viu e decidiu, que é o ponto', () => {
    const doc = validar([verificacao('review', 'passed', 'aprovado mesmo assim'), e2e('failed'), fechada('sensivel')]);
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('risco TRIVIAL não liga o gate — a régua é por risco, não por fase', () => {
    expect(parseEsteiraResult(validar([verificacao('review', 'passed'), fechada('trivial')])).ok).toBe(true);
  });

  it('fase que não classificou o risco não é cobrada — o app não classifica por ela', () => {
    expect(parseEsteiraResult(validar([verificacao('review', 'passed'), fechada(null)])).ok).toBe(true);
  });

  it('risco fora do contrato é recusado', () => {
    expect(codesOf(validar([verificacao('review', 'passed'), fechada('meio-sensivel')]))).toContain('not_in_enum');
  });

  it('o risco chega ao store, e o card distingue "escrito" de "rodado por você"', () => {
    const parsed = parseEsteiraResult(validar([verificacao('pull-request', 'pending'), e2e('pending'), fechada('sensivel')]));
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

    const card = cardView(reduceEvents(events, { builtAt: '2026-08-04T13:00:00.000Z' }), 'dsc-1')!;
    expect(card.phases.find((phase) => phase.phase === 'validar')?.risk).toBe('sensivel');
    const linhas = verificationLines(card).map((line) => line.text);
    expect(linhas).toContain('roteiro e2e escrito, esperando você rodar');
  });
});
