// Spec 010 (D-2) — o SEED: o caminho explicito para plantar um discovery que ja
// esta em andamento. Modulo PURO: sem fs, sem Electron, nunca lanca.
//
// Por que ele existe: o store nasce limpo de proposito — importacao de legado
// esta fora de escopo, e continua fora. Mas o trabalho em curso e real, e sem
// este caminho a unica saida seria escrever JSON na mao dentro do
// `events.jsonl`, que e exatamente o que o formato append-only foi desenhado
// para evitar. "Sem edicao manual as cegas" e a promessa deste modulo: o
// documento e lido com o mesmo rigor dos dois contratos da esteira — campo
// desconhecido e ERRO, com caminho —, em vez de aceito e transformado numa tela
// que mente depois.
//
// A diferenca que atravessa tudo daqui para frente:
//
//   SEMEADO   = afirmacao de uma pessoa ("isto ja existe, esta neste ponto")
//   DECLARADO = fato observado, que uma skill gravou num `result.json`
//
// As duas coisas viram evento no mesmo log, mas NAO sao a mesma coisa. A
// distincao viaja no `source` do evento (`{ kind: 'seed' }`, que o formato ja
// previa) e reaparece no snapshot como `seeded`, para a tela poder mostrar cada
// um pelo que e. Confundi-los seria a inverdade da spec 010 por uma porta nova:
// o app afirmando como observado o que ninguem observou.
//
// O documento e escrito por uma pessoa e usa snake_case, como o `result.json` e
// o `run-input.json` — os tres sao documentos que um humano le. A traducao para
// o camelCase do store acontece aqui, e em nenhum outro lugar.

import {
  Collector,
  PHASE_PATTERN,
  isPlainObject,
  optionalString,
  rejectUnknownKeys,
  requireEnum,
  requireString,
  requireStringList,
  type ContractIssue,
} from '../contract/parsing';
import type { EventDraft } from '../ingest/resultToEvents';
import type { PhaseOutcome, TrackerRef, WorkItemState, WorkItemType } from './storeFormat';

const WORK_ITEM_TYPES: readonly WorkItemType[] = ['issue', 'spec', 'process-map', 'adr', 'prototype', 'spike', 'eval'];
const WORK_ITEM_STATES: readonly WorkItemState[] = ['open', 'in-progress', 'done', 'abandoned'];
const PHASE_OUTCOMES: readonly PhaseOutcome[] = ['done', 'abandoned', 'inconclusive'];

export interface SeedDiscoveryInput {
  readonly title: string;
  readonly problem: string | null;
  readonly targetRepo: string | null;
  readonly scopeRepos: readonly string[];
  readonly tracker: TrackerRef | null;
}

export interface SeedPlanInput {
  /** Chave LOCAL do documento, so para os itens apontarem. O id real quem gera e o app. */
  readonly ref: string | null;
  readonly title: string;
  readonly summary: string | null;
}

export interface SeedItemInput {
  readonly title: string;
  readonly itemType: WorkItemType;
  /** "Em que ponto esta" — o estado afirmado. E dele que a macro etapa se deriva. */
  readonly state: WorkItemState;
  readonly planRef: string | null;
  /** Ja resolvido: quando o documento omite, herda o repo do discovery (D-6). */
  readonly targetRepo: string | null;
  readonly scopeRepos: readonly string[];
}

/**
 * Uma fase que o humano afirma ter acontecido. Semeada e sempre fase
 * CONCLUIDA: "fase em curso" sem sessao nem trava seria um estado pendurado, do
 * tipo que a spec existe para extinguir.
 */
export interface SeedPhaseInput {
  readonly phase: string;
  readonly outcome: PhaseOutcome;
  readonly summary: string | null;
}

export interface SeedInput {
  readonly discovery: SeedDiscoveryInput;
  readonly phases: readonly SeedPhaseInput[];
  readonly plans: readonly SeedPlanInput[];
  readonly items: readonly SeedItemInput[];
}

export type ParseSeedResult =
  | { readonly ok: true; readonly seed: SeedInput }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

/**
 * O documento que o botao "Exemplo" entrega. Fica ao lado do parser de
 * proposito: exemplo que o proprio parser recusa e a armadilha classica de
 * template solto — o teste amarra os dois.
 */
export const SEED_DOCUMENT_EXAMPLE = `{
  "discovery": {
    "title": "O que ja esta em andamento",
    "problem": "Uma frase sobre o problema que este trabalho investiga.",
    "target_repo": "donel-dev",
    "scope_repos": ["donel-dev"]
  },
  "phases": [
    { "phase": "discovery", "outcome": "done", "summary": "O que a descoberta concluiu." }
  ],
  "plans": [
    { "ref": "p1", "title": "O plano que ja existe", "summary": "O que ele trata." }
  ],
  "items": [
    { "title": "O item que esta em curso", "type": "issue", "state": "in-progress", "plan": "p1" },
    { "title": "O item que ainda nao comecou", "type": "spike", "state": "open", "plan": "p1" }
  ]
}`;

export function parseSeedDocument(text: string): ParseSeedResult {
  const c = new Collector();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    c.add('invalid_json', '', 'seed document is not valid JSON');
    return { ok: false, issues: c.issues };
  }

  if (!isPlainObject(parsed)) {
    c.add('not_an_object', '', 'seed document must be a JSON object');
    return { ok: false, issues: c.issues };
  }

  rejectUnknownKeys(parsed, ['discovery', 'phases', 'plans', 'items'], '', c);

  const discovery = parseDiscovery(parsed.discovery, c);
  const phases = parsePhases(parsed.phases, c);
  const plans = parsePlans(parsed.plans, c);
  const items = parseItems(parsed.items, plans, discovery?.targetRepo ?? null, c);

  if (c.failed || discovery === null) return { ok: false, issues: c.issues };
  return { ok: true, seed: { discovery, phases, plans, items } };
}

function parseDiscovery(raw: unknown, c: Collector): SeedDiscoveryInput | null {
  if (raw === undefined || raw === null) {
    c.add('missing_field', 'discovery', 'required field "discovery" is missing');
    return null;
  }
  if (!isPlainObject(raw)) {
    c.add('wrong_type', 'discovery', 'field "discovery" must be an object');
    return null;
  }

  rejectUnknownKeys(raw, ['title', 'problem', 'target_repo', 'scope_repos', 'tracker'], 'discovery', c);
  const title = requireString(raw, 'title', 'discovery', c);
  const problem = optionalString(raw, 'problem', 'discovery', c);
  const targetRepo = optionalString(raw, 'target_repo', 'discovery', c);
  const scopeRepos = requireStringList(raw, 'scope_repos', 'discovery', c);
  const tracker = parseTracker(raw.tracker, c);

  if (title === null) return null;
  return { title, problem, targetRepo, scopeRepos, tracker };
}

function parseTracker(raw: unknown, c: Collector): TrackerRef | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    c.add('wrong_type', 'discovery.tracker', 'field "tracker" must be an object or null');
    return null;
  }
  rejectUnknownKeys(raw, ['provider', 'card_id'], 'discovery.tracker', c);
  const provider = requireString(raw, 'provider', 'discovery.tracker', c);
  const cardId = requireString(raw, 'card_id', 'discovery.tracker', c);
  if (provider === null || cardId === null) return null;
  return { provider, cardId };
}

function parseList(raw: unknown, key: string, c: Collector): readonly unknown[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    c.add('wrong_type', key, `field "${key}" must be an array`);
    return [];
  }
  return raw;
}

function parsePhases(raw: unknown, c: Collector): readonly SeedPhaseInput[] {
  const phases: SeedPhaseInput[] = [];
  parseList(raw, 'phases', c).forEach((entry, index) => {
    const path = `phases[${index}]`;
    if (!isPlainObject(entry)) {
      c.add('wrong_type', path, 'each phase must be an object');
      return;
    }
    rejectUnknownKeys(entry, ['phase', 'outcome', 'summary'], path, c);
    const phase = requireString(entry, 'phase', path, c);
    if (phase !== null && !PHASE_PATTERN.test(phase)) {
      c.add('bad_format', `${path}.phase`, `field "phase" does not match ${String(PHASE_PATTERN)}`);
    }
    const outcome = requireEnum<PhaseOutcome>(entry, 'outcome', PHASE_OUTCOMES, path, c);
    const summary = optionalString(entry, 'summary', path, c);
    if (phase === null || outcome === null || !PHASE_PATTERN.test(phase)) return;
    phases.push({ phase, outcome, summary });
  });
  return phases;
}

function parsePlans(raw: unknown, c: Collector): readonly SeedPlanInput[] {
  const plans: SeedPlanInput[] = [];
  const seenRefs = new Set<string>();

  parseList(raw, 'plans', c).forEach((entry, index) => {
    const path = `plans[${index}]`;
    if (!isPlainObject(entry)) {
      c.add('wrong_type', path, 'each plan must be an object');
      return;
    }
    rejectUnknownKeys(entry, ['ref', 'title', 'summary'], path, c);
    const ref = optionalString(entry, 'ref', path, c);
    const title = requireString(entry, 'title', path, c);
    const summary = optionalString(entry, 'summary', path, c);

    if (ref !== null) {
      // Ref repetido amarraria o item no plano errado, calado. Melhor recusar.
      if (seenRefs.has(ref)) c.add('bad_format', `${path}.ref`, `plan ref "${ref}" is declared twice`);
      seenRefs.add(ref);
    }
    if (title === null) return;
    plans.push({ ref, title, summary });
  });

  return plans;
}

function parseItems(
  raw: unknown,
  plans: readonly SeedPlanInput[],
  discoveryRepo: string | null,
  c: Collector,
): readonly SeedItemInput[] {
  const items: SeedItemInput[] = [];
  const refs = new Set(plans.map((plan) => plan.ref).filter((ref): ref is string => ref !== null));

  parseList(raw, 'items', c).forEach((entry, index) => {
    const path = `items[${index}]`;
    if (!isPlainObject(entry)) {
      c.add('wrong_type', path, 'each item must be an object');
      return;
    }
    rejectUnknownKeys(entry, ['title', 'type', 'state', 'plan', 'target_repo', 'scope_repos'], path, c);
    const title = requireString(entry, 'title', path, c);
    const itemType = requireEnum<WorkItemType>(entry, 'type', WORK_ITEM_TYPES, path, c);
    const state = requireEnum<WorkItemState>(entry, 'state', WORK_ITEM_STATES, path, c);
    const planRef = optionalString(entry, 'plan', path, c);
    const scopeRepos = requireStringList(entry, 'scope_repos', path, c);
    // D-6 — o item herda o repo do discovery por default; o documento pode trocar.
    const targetRepo = optionalString(entry, 'target_repo', path, c) ?? discoveryRepo;

    if (planRef !== null && !refs.has(planRef)) {
      // Ref orfa viraria item sem plano CALADO — o sinal `orphan-item` diria
      // "item sem plano" quando a verdade e "voce escreveu um ref que nao existe".
      c.add('missing_required_fact', `${path}.plan`, `item references plan ref "${planRef}", which is not declared`);
    }
    // D-6 — `issue` tem exatamente um repo alvo; sem repo, nao dispara. Semear
    // uma issue sem alvo criaria um item que o app nunca poderia disparar.
    if (itemType === 'issue' && (targetRepo === null || targetRepo.length === 0)) {
      c.add('issue_without_target_repo', `${path}.target_repo`, 'seeded work item of type "issue" requires exactly one target_repo');
    }

    if (title === null || itemType === null || state === null) return;
    items.push({ title, itemType, state, planRef, targetRepo, scopeRepos });
  });

  return items;
}

export interface SeedToEventsOptions {
  /** Hora do GESTO. Um fato semeado nao tem hora observada — a honesta e a de agora, e a tela marca que foi semeada. */
  readonly at: string;
  readonly newId: (prefix: string) => string;
}

export interface SeedPlanOutput {
  readonly events: readonly EventDraft[];
  readonly discoveryId: string;
  readonly planIds: readonly string[];
  readonly workItemIds: readonly string[];
}

/**
 * A afirmacao vira fato local. Os ids sao do APP (a skill nao participou deste
 * gesto), e nenhum evento carrega `dedupe_key`: semear duas vezes sao dois
 * gestos, nao um fato repetido — e apagar o segundo esconderia um engano do
 * operador em vez de mostra-lo.
 *
 * Quem escreve isto no log passa `source: { kind: 'seed' }` (o writer ja aceita)
 * — e dai que a tela tira a marca de "semeado".
 */
export function seedToEvents(seed: SeedInput, options: SeedToEventsOptions): SeedPlanOutput {
  const { at, newId } = options;
  const events: EventDraft[] = [];

  const discoveryId = newId('dsc');
  events.push({
    type: 'discovery.created',
    at,
    dedupe_key: null,
    payload: {
      id: discoveryId,
      title: seed.discovery.title,
      problem: seed.discovery.problem,
      tracker: seed.discovery.tracker,
      targetRepo: seed.discovery.targetRepo,
      scopeRepos: seed.discovery.scopeRepos,
      createdAt: at,
    },
  });

  const planIdByRef = new Map<string, string>();
  const planIds: string[] = [];
  for (const plan of seed.plans) {
    const planId = newId('pln');
    planIds.push(planId);
    if (plan.ref !== null) planIdByRef.set(plan.ref, planId);
    events.push({
      type: 'plan.created',
      at,
      dedupe_key: null,
      payload: { id: planId, discoveryId, title: plan.title, summary: plan.summary, createdAt: at },
    });
    // D-5 — "discovery originou plano" e relacao de primeira classe. Um card
    // semeado tem o mesmo grafo de um declarado por skill; so a proveniencia muda.
    events.push({
      type: 'relation.added',
      at,
      dedupe_key: null,
      payload: {
        relation: 'originated',
        from: { entity: 'discovery', id: discoveryId },
        to: { entity: 'plan', id: planId },
        recordedAt: at,
      },
    });
  }

  const workItemIds: string[] = [];
  for (const item of seed.items) {
    const workItemId = newId('wki');
    workItemIds.push(workItemId);
    events.push({
      type: 'work_item.created',
      at,
      dedupe_key: null,
      payload: {
        id: workItemId,
        discoveryId,
        planId: item.planRef === null ? null : (planIdByRef.get(item.planRef) ?? null),
        itemType: item.itemType,
        title: item.title,
        targetRepo: item.targetRepo,
        scopeRepos: item.scopeRepos,
        state: item.state,
        // D-16 nao muda: item nascido pela SKILL e outra coisa. Semear e
        // afirmacao humana, e o log ja carrega isso no `source`.
        createdBySkill: false,
        createdAt: at,
      },
    });
  }

  for (const phase of seed.phases) {
    events.push({
      type: 'phase.completed',
      at,
      dedupe_key: null,
      payload: {
        subject: { entity: 'discovery', id: discoveryId },
        phase: phase.phase,
        outcome: phase.outcome,
        summary: phase.summary,
        at,
      },
    });
  }

  return { events, discoveryId, planIds, workItemIds };
}
