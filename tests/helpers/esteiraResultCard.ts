// Shared scaffolding for the specs that turn `esteira.result` facts into a card
// (A4, A9, A10, A13, A15, A16, A18, A19, A22): build a result document, parse it,
// translate it to store events, reduce and project the card.
import { CONTRACT_VERSION, parseEsteiraResult, type ContractIssueCode } from '../../src/shared/esteira/contract/resultContract';
import { resultToEvents } from '../../src/shared/esteira/ingest/resultToEvents';
import { cardView } from '../../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../../src/shared/esteira/store/storeFormat';

export interface ResultDocOptions {
  phase?: string;
  /** `null` builds a discovery-level result (no work item in the subject). */
  workItemId?: string | null;
  run?: Record<string, unknown>;
}

/** A minimal valid `esteira.result` document wrapping the given facts. */
export function resultDoc(facts: unknown[], options: ResultDocOptions = {}): Record<string, unknown> {
  const { phase = 'discovery', workItemId = null, run = {} } = options;
  return {
    contract_version: CONTRACT_VERSION,
    kind: 'esteira.result',
    run: {
      run_id: 'run-1',
      phase,
      status: 'success',
      started_at: '2026-08-04T12:00:00.000Z',
      finished_at: '2026-08-04T12:30:00.000Z',
      failure: null,
      ...run,
    },
    actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
    subject: { discovery_id: 'dsc-1', plan_id: null, work_item_id: workItemId },
    workspace: null,
    facts,
  };
}

export function codesOf(input: unknown): ContractIssueCode[] {
  const parsed = parseEsteiraResult(input);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.code);
}

type Draft = { type: string; at: string; dedupe_key: string | null; payload: Record<string, unknown> };

/** The app-side seed of a card: one discovery and one work item. */
export function seedEvents(): StoreEvent[] {
  return [
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
  ];
}

/** The minimal card: a discovery, a work item and the events of one run. */
export function cardFromDrafts(drafts: readonly Draft[]) {
  const events: StoreEvent[] = [
    ...seedEvents(),
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

/** Parses the document (throwing on contract issues) and projects its card. */
export function cardFromResult(doc: Record<string, unknown>) {
  const parsed = parseEsteiraResult(doc);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  return cardFromDrafts(resultToEvents(parsed.result, { resultPath: 'C:/x.json' }));
}
