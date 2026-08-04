// Spec 010 (D-10) — lado APP do contrato de IDA (`run-input.json`), decidido em
// 2026-08-03 (lacuna 2 do handoff da fase 1). O arquivo canonico e o JSON
// Schema vizinho (`v1/esteira-run-input.schema.json`), lido pelos dois lados.
//
// A assimetria com `resultContract.ts` e proposital e importante:
//
//   result.json  — a skill PRODUZ, o app CONSOME  → `CONSUMED_PATHS`
//   run-input.json — o app PRODUZ, a skill CONSOME → `PRODUCED_PATHS`
//
// Por isso este modulo tem as DUAS metades: `buildRunInput` (o produtor, que e
// o papel do app) e `parseRunInput` (o validador, que e o espelho do que a
// skill fara — e o que permite fechar o ciclo no teste de contrato daqui,
// antes de o fork existir).
//
// Sem isto, metade da troca ficaria em texto livre (`ctx.md`) enquanto a outra
// metade tem schema: o mesmo desencontro de campo, so que na direcao da ida.
//
// Modulo puro: sem I/O, sem Electron, nunca lanca.

import {
  Collector,
  ID_PATTERN,
  PHASE_PATTERN,
  SEMVER_PATTERN,
  TIMESTAMP_PATTERN,
  isPlainObject,
  majorOf,
  optionalPattern,
  optionalString,
  rejectUnknownKeys,
  requireEnum,
  requirePattern,
  requireString,
  requireStringList,
  type ContractIssue,
} from './parsing';
import type { MacroStage, StoreSnapshot, WorkItemState, WorkItemType } from '../store/storeFormat';

/** Versao do contrato de ida que este app escreve. Major diferente = a skill recusa rodar. */
export const RUN_INPUT_CONTRACT_VERSION = '1.0.0';

const WORK_ITEM_TYPES: readonly WorkItemType[] = ['issue', 'spec', 'process-map', 'adr', 'prototype', 'spike', 'eval'];
const WORK_ITEM_STATES: readonly WorkItemState[] = ['open', 'in-progress', 'done', 'abandoned'];
const MACRO_STAGES: readonly MacroStage[] = ['discovery', 'planned', 'execution', 'done'];
const PHASE_OUTCOMES = ['done', 'abandoned', 'inconclusive'] as const;

export type RunInputPhaseOutcome = (typeof PHASE_OUTCOMES)[number];

export interface RunInputTracker {
  readonly provider: string;
  readonly card_id: string;
}

export interface RunInputRun {
  readonly run_id: string;
  readonly phase: string;
  readonly requested_at: string;
  readonly continues_session_id: string | null;
  readonly handoff_reason: string | null;
}

export interface RunInputSubject {
  readonly discovery_id: string;
  readonly plan_id: string | null;
  readonly work_item_id: string | null;
}

export interface RunInputWorkspace {
  readonly target_repo: string;
  readonly repo_path: string | null;
  readonly worktree_path: string | null;
  readonly branch: string | null;
}

export interface RunInputOutbox {
  readonly result_path: string;
}

export interface RunInputDiscovery {
  readonly id: string;
  readonly title: string;
  readonly problem: string | null;
  readonly tracker: RunInputTracker | null;
  readonly target_repo: string | null;
  readonly scope_repos: readonly string[];
}

export interface RunInputPlan {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
}

export interface RunInputWorkItem {
  readonly id: string;
  readonly title: string;
  readonly item_type: WorkItemType;
  readonly state: WorkItemState;
  readonly target_repo: string | null;
  readonly scope_repos: readonly string[];
}

export interface RunInputHistoryEntry {
  readonly phase: string;
  readonly outcome: RunInputPhaseOutcome | null;
  readonly summary: string | null;
  readonly completed_at: string | null;
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export interface RunInputNote {
  readonly text: string;
  readonly at: string;
}

export interface RunInputContext {
  readonly discovery: RunInputDiscovery;
  readonly plan: RunInputPlan | null;
  readonly work_item: RunInputWorkItem | null;
  readonly derived_stage: MacroStage;
  readonly history: readonly RunInputHistoryEntry[];
  readonly notes: readonly RunInputNote[];
}

export interface EsteiraRunInput {
  readonly contract_version: string;
  readonly kind: 'esteira.run-input';
  readonly run: RunInputRun;
  readonly subject: RunInputSubject;
  readonly workspace: RunInputWorkspace | null;
  readonly outbox: RunInputOutbox;
  readonly context: RunInputContext;
}

/**
 * Todo campo que o app promete GRAVAR, em notacao canonica — o espelho de
 * `CONSUMED_PATHS`. Campo declarado no schema e nunca gravado (ou gravado e nao
 * declarado) reprova o teste de contrato: a lista existe para que "o app
 * escreve X" seja afirmacao verificavel, nao leitura de codigo feita por
 * alguem de boa vontade.
 */
export const PRODUCED_PATHS: readonly string[] = [
  'contract_version',
  'kind',
  'run.run_id',
  'run.phase',
  'run.requested_at',
  'run.continues_session_id',
  'run.handoff_reason',
  'subject.discovery_id',
  'subject.plan_id',
  'subject.work_item_id',
  'workspace.target_repo',
  'workspace.repo_path',
  'workspace.worktree_path',
  'workspace.branch',
  'outbox.result_path',
  'context.discovery.id',
  'context.discovery.title',
  'context.discovery.problem',
  'context.discovery.tracker.provider',
  'context.discovery.tracker.card_id',
  'context.discovery.target_repo',
  'context.discovery.scope_repos[]',
  'context.plan.id',
  'context.plan.title',
  'context.plan.summary',
  'context.work_item.id',
  'context.work_item.title',
  'context.work_item.item_type',
  'context.work_item.state',
  'context.work_item.target_repo',
  'context.work_item.scope_repos[]',
  'context.derived_stage',
  'context.history[].phase',
  'context.history[].outcome',
  'context.history[].summary',
  'context.history[].completed_at',
  'context.history[].failure.code',
  'context.history[].failure.message',
  'context.notes[].text',
  'context.notes[].at',
];

export type ParseRunInput =
  | { readonly ok: true; readonly input: EsteiraRunInput }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

// ---------------------------------------------------------------------------
// Validador — o espelho do que a skill faz ao receber o arquivo
// ---------------------------------------------------------------------------

function parseTracker(raw: unknown, path: string, c: Collector): RunInputTracker | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    c.add('wrong_type', path, 'field "tracker" must be an object or null');
    return null;
  }
  rejectUnknownKeys(raw, ['provider', 'card_id'], path, c);
  const provider = requireString(raw, 'provider', path, c);
  const cardId = requireString(raw, 'card_id', path, c);
  if (provider === null || cardId === null) return null;
  return { provider, card_id: cardId };
}

function parseRun(raw: unknown, c: Collector): RunInputRun | null {
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', 'run', 'field "run" must be an object');
    return null;
  }
  rejectUnknownKeys(raw, ['run_id', 'phase', 'requested_at', 'continues_session_id', 'handoff_reason'], 'run', c);
  const runId = requirePattern(raw, 'run_id', ID_PATTERN, 'run', c);
  const phase = requirePattern(raw, 'phase', PHASE_PATTERN, 'run', c);
  const requestedAt = requirePattern(raw, 'requested_at', TIMESTAMP_PATTERN, 'run', c);
  const continuesSessionId = optionalString(raw, 'continues_session_id', 'run', c);
  const handoffReason = optionalString(raw, 'handoff_reason', 'run', c);
  if (runId === null || phase === null || requestedAt === null) return null;
  return { run_id: runId, phase, requested_at: requestedAt, continues_session_id: continuesSessionId, handoff_reason: handoffReason };
}

function parseSubject(raw: unknown, c: Collector): RunInputSubject | null {
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', 'subject', 'field "subject" must be an object');
    return null;
  }
  rejectUnknownKeys(raw, ['discovery_id', 'plan_id', 'work_item_id'], 'subject', c);
  const discoveryId = requirePattern(raw, 'discovery_id', ID_PATTERN, 'subject', c);
  const planId = optionalPattern(raw, 'plan_id', ID_PATTERN, 'subject', c);
  const workItemId = optionalPattern(raw, 'work_item_id', ID_PATTERN, 'subject', c);
  if (discoveryId === null) return null;
  return { discovery_id: discoveryId, plan_id: planId, work_item_id: workItemId };
}

function parseWorkspace(raw: unknown, c: Collector): RunInputWorkspace | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    c.add('wrong_type', 'workspace', 'field "workspace" must be an object or null');
    return null;
  }
  rejectUnknownKeys(raw, ['target_repo', 'repo_path', 'worktree_path', 'branch'], 'workspace', c);
  const targetRepo = requireString(raw, 'target_repo', 'workspace', c);
  if (targetRepo === null) return null;
  return {
    target_repo: targetRepo,
    repo_path: optionalString(raw, 'repo_path', 'workspace', c),
    worktree_path: optionalString(raw, 'worktree_path', 'workspace', c),
    branch: optionalString(raw, 'branch', 'workspace', c),
  };
}

function parseContext(raw: unknown, c: Collector): RunInputContext | null {
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', 'context', 'field "context" must be an object');
    return null;
  }
  rejectUnknownKeys(raw, ['discovery', 'plan', 'work_item', 'derived_stage', 'history', 'notes'], 'context', c);

  const rawDiscovery = raw.discovery;
  let discovery: RunInputDiscovery | null = null;
  if (!isPlainObject(rawDiscovery)) {
    c.add(rawDiscovery === undefined ? 'missing_field' : 'wrong_type', 'context.discovery', 'field "discovery" must be an object');
  } else {
    rejectUnknownKeys(rawDiscovery, ['id', 'title', 'problem', 'tracker', 'target_repo', 'scope_repos'], 'context.discovery', c);
    const id = requirePattern(rawDiscovery, 'id', ID_PATTERN, 'context.discovery', c);
    const title = requireString(rawDiscovery, 'title', 'context.discovery', c);
    const tracker = parseTracker(rawDiscovery.tracker, 'context.discovery.tracker', c);
    if (id !== null && title !== null) {
      discovery = {
        id,
        title,
        problem: optionalString(rawDiscovery, 'problem', 'context.discovery', c),
        tracker,
        target_repo: optionalString(rawDiscovery, 'target_repo', 'context.discovery', c),
        scope_repos: requireStringList(rawDiscovery, 'scope_repos', 'context.discovery', c),
      };
    }
  }

  let plan: RunInputPlan | null = null;
  const rawPlan = raw.plan;
  if (rawPlan !== undefined && rawPlan !== null) {
    if (!isPlainObject(rawPlan)) {
      c.add('wrong_type', 'context.plan', 'field "plan" must be an object or null');
    } else {
      rejectUnknownKeys(rawPlan, ['id', 'title', 'summary'], 'context.plan', c);
      const id = requirePattern(rawPlan, 'id', ID_PATTERN, 'context.plan', c);
      const title = requireString(rawPlan, 'title', 'context.plan', c);
      if (id !== null && title !== null) plan = { id, title, summary: optionalString(rawPlan, 'summary', 'context.plan', c) };
    }
  }

  let workItem: RunInputWorkItem | null = null;
  const rawItem = raw.work_item;
  if (rawItem !== undefined && rawItem !== null) {
    if (!isPlainObject(rawItem)) {
      c.add('wrong_type', 'context.work_item', 'field "work_item" must be an object or null');
    } else {
      rejectUnknownKeys(rawItem, ['id', 'title', 'item_type', 'state', 'target_repo', 'scope_repos'], 'context.work_item', c);
      const id = requirePattern(rawItem, 'id', ID_PATTERN, 'context.work_item', c);
      const title = requireString(rawItem, 'title', 'context.work_item', c);
      const itemType = requireEnum<WorkItemType>(rawItem, 'item_type', WORK_ITEM_TYPES, 'context.work_item', c);
      const state = requireEnum<WorkItemState>(rawItem, 'state', WORK_ITEM_STATES, 'context.work_item', c);
      const targetRepo = optionalString(rawItem, 'target_repo', 'context.work_item', c);
      const scopeRepos = requireStringList(rawItem, 'scope_repos', 'context.work_item', c);
      if (id !== null && title !== null && itemType !== null && state !== null) {
        workItem = { id, title, item_type: itemType, state, target_repo: targetRepo, scope_repos: scopeRepos };
      }
    }
  }

  const derivedStage = requireEnum<MacroStage>(raw, 'derived_stage', MACRO_STAGES, 'context', c);

  const history: RunInputHistoryEntry[] = [];
  const rawHistory = raw.history;
  if (!Array.isArray(rawHistory)) {
    c.add(rawHistory === undefined ? 'missing_field' : 'wrong_type', 'context.history', 'field "history" must be an array');
  } else {
    rawHistory.forEach((entry, index) => {
      const path = `context.history[${index}]`;
      if (!isPlainObject(entry)) {
        c.add('wrong_type', path, 'history entry must be an object');
        return;
      }
      rejectUnknownKeys(entry, ['phase', 'outcome', 'summary', 'completed_at', 'failure'], path, c);
      const phase = requirePattern(entry, 'phase', PHASE_PATTERN, path, c);
      const outcome = entry.outcome === undefined || entry.outcome === null
        ? null
        : requireEnum<RunInputPhaseOutcome>(entry, 'outcome', PHASE_OUTCOMES, path, c);
      let failure: RunInputHistoryEntry['failure'] = null;
      const rawFailure = entry.failure;
      if (rawFailure !== undefined && rawFailure !== null) {
        if (!isPlainObject(rawFailure)) {
          c.add('wrong_type', `${path}.failure`, 'field "failure" must be an object or null');
        } else {
          rejectUnknownKeys(rawFailure, ['code', 'message'], `${path}.failure`, c);
          const code = requireString(rawFailure, 'code', `${path}.failure`, c);
          const message = requireString(rawFailure, 'message', `${path}.failure`, c);
          if (code !== null && message !== null) failure = { code, message };
        }
      }
      if (phase === null) return;
      history.push({
        phase,
        outcome,
        summary: optionalString(entry, 'summary', path, c),
        completed_at: optionalPattern(entry, 'completed_at', TIMESTAMP_PATTERN, path, c),
        failure,
      });
    });
  }

  const notes: RunInputNote[] = [];
  const rawNotes = raw.notes;
  if (!Array.isArray(rawNotes)) {
    c.add(rawNotes === undefined ? 'missing_field' : 'wrong_type', 'context.notes', 'field "notes" must be an array');
  } else {
    rawNotes.forEach((entry, index) => {
      const path = `context.notes[${index}]`;
      if (!isPlainObject(entry)) {
        c.add('wrong_type', path, 'note must be an object');
        return;
      }
      rejectUnknownKeys(entry, ['text', 'at'], path, c);
      const text = requireString(entry, 'text', path, c);
      const at = requirePattern(entry, 'at', TIMESTAMP_PATTERN, path, c);
      if (text !== null && at !== null) notes.push({ text, at });
    });
  }

  if (discovery === null || derivedStage === null) return null;
  return { discovery, plan, work_item: workItem, derived_stage: derivedStage, history, notes };
}

/** Le um `run-input.json`. Nunca lanca; `ok: false` sempre traz issues com caminho. */
export function parseRunInput(input: unknown): ParseRunInput {
  const c = new Collector();

  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ code: 'not_an_object', path: '', message: 'run input must be a JSON object' }] };
  }

  rejectUnknownKeys(input, ['contract_version', 'kind', 'run', 'subject', 'workspace', 'outbox', 'context'], '', c);

  if (input.kind !== 'esteira.run-input') c.add('wrong_kind', 'kind', 'kind must be "esteira.run-input"');

  const contractVersion = requirePattern(input, 'contract_version', SEMVER_PATTERN, '', c);
  if (contractVersion !== null && majorOf(contractVersion) !== majorOf(RUN_INPUT_CONTRACT_VERSION)) {
    c.add('unsupported_major', 'contract_version', `unsupported contract major: got ${contractVersion}, app implements ${RUN_INPUT_CONTRACT_VERSION}`);
  }

  const run = parseRun(input.run, c);
  const subject = parseSubject(input.subject, c);
  const workspace = parseWorkspace(input.workspace, c);
  const context = parseContext(input.context, c);

  let outbox: RunInputOutbox | null = null;
  const rawOutbox = input.outbox;
  if (!isPlainObject(rawOutbox)) {
    c.add(rawOutbox === undefined ? 'missing_field' : 'wrong_type', 'outbox', 'field "outbox" must be an object');
  } else {
    rejectUnknownKeys(rawOutbox, ['result_path'], 'outbox', c);
    const resultPath = requireString(rawOutbox, 'result_path', 'outbox', c);
    if (resultPath !== null) outbox = { result_path: resultPath };
  }

  // D-6, cobrado dos DOIS lados: item do tipo `issue` sem repo alvo nao dispara.
  // Nunca ha fallback para "o projeto em foco" — foi assim que uma fase abriu no
  // repo errado (evidencia 2 da spec).
  if (context?.work_item?.item_type === 'issue' && (workspace === null || workspace.target_repo.length === 0)) {
    c.add('issue_without_target_repo', 'workspace.target_repo', 'work item of type "issue" requires a target repo to dispatch');
  }

  if (c.failed || run === null || subject === null || context === null || outbox === null) {
    const issues = c.failed ? c.issues : [{ code: 'missing_field' as const, path: '', message: 'incomplete run input' }];
    return { ok: false, issues };
  }

  return {
    ok: true,
    input: { contract_version: contractVersion ?? RUN_INPUT_CONTRACT_VERSION, kind: 'esteira.run-input', run, subject, workspace, outbox, context },
  };
}

export function parseRunInputText(text: string): ParseRunInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    return { ok: false, issues: [{ code: 'invalid_json', path: '', message: detail }] };
  }
  return parseRunInput(parsed);
}

// ---------------------------------------------------------------------------
// Produtor — o papel do app
// ---------------------------------------------------------------------------

export interface BuildRunInputOptions {
  readonly runId: string;
  readonly phase: string;
  readonly requestedAt: string;
  readonly discoveryId: string;
  readonly planId?: string | null;
  readonly workItemId?: string | null;
  /** Alvo EXPLICITO (D-6). Nunca derivado do projeto em foco. */
  readonly workspace?: RunInputWorkspace | null;
  /** Onde a skill deve devolver o `result.json`. */
  readonly resultPath: string;
  readonly continuesSessionId?: string | null;
  readonly handoffReason?: string | null;
}

export type BuildRunInputResult =
  | { readonly ok: true; readonly input: EsteiraRunInput }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

/**
 * Monta o `run-input.json` a partir do snapshot do store. Recusa quando o
 * assunto nao existe ou quando o alvo falta — recusar e o comportamento certo:
 * disparar uma fase com contexto incompleto e como o app afirmar algo que nao
 * sabe, so que do lado da ida.
 */
export function buildRunInput(snapshot: StoreSnapshot, options: BuildRunInputOptions): BuildRunInputResult {
  const issues: ContractIssue[] = [];

  const discovery = snapshot.discoveries.find((entry) => entry.id === options.discoveryId);
  if (discovery === undefined) {
    issues.push({ code: 'missing_field', path: 'subject.discovery_id', message: `discovery ${options.discoveryId} is not in the store` });
  }

  const planId = options.planId ?? null;
  const plan = planId === null ? null : snapshot.plans.find((entry) => entry.id === planId);
  if (planId !== null && plan === undefined) {
    issues.push({ code: 'missing_field', path: 'subject.plan_id', message: `plan ${planId} is not in the store` });
  }

  const workItemId = options.workItemId ?? null;
  const workItem = workItemId === null ? null : snapshot.workItems.find((entry) => entry.id === workItemId);
  if (workItemId !== null && workItem === undefined) {
    issues.push({ code: 'missing_field', path: 'subject.work_item_id', message: `work item ${workItemId} is not in the store` });
  }

  const workspace = options.workspace ?? null;
  if (workItem?.itemType === 'issue' && workspace === null) {
    issues.push({ code: 'issue_without_target_repo', path: 'workspace.target_repo', message: 'work item of type "issue" requires a target repo to dispatch' });
  }

  if (issues.length > 0 || discovery === undefined) return { ok: false, issues };

  // O historico e das fases do PROPRIO assunto e das que vieram antes dele na
  // cadeia (discovery → plano → item): e o que deixa a skill distinguir "nao
  // aconteceu" de "aconteceu e terminou assim".
  const subjects = new Set<string>([`discovery:${discovery.id}`]);
  if (plan) subjects.add(`plan:${plan.id}`);
  if (workItem) subjects.add(`work_item:${workItem.id}`);

  const history = snapshot.phases
    .filter((phase) => subjects.has(`${phase.subject.entity}:${phase.subject.id}`))
    .map((phase) => ({
      phase: phase.phase,
      outcome: phase.outcome,
      summary: phase.summary,
      completed_at: phase.completedAt,
      failure: phase.failure,
    }));

  const notes = snapshot.notes
    .filter((note) => subjects.has(`${note.subject.entity}:${note.subject.id}`))
    .map((note) => ({ text: note.text, at: note.at }));

  return {
    ok: true,
    input: {
      contract_version: RUN_INPUT_CONTRACT_VERSION,
      kind: 'esteira.run-input',
      run: {
        run_id: options.runId,
        phase: options.phase,
        requested_at: options.requestedAt,
        continues_session_id: options.continuesSessionId ?? null,
        handoff_reason: options.handoffReason ?? null,
      },
      subject: { discovery_id: discovery.id, plan_id: plan?.id ?? null, work_item_id: workItem?.id ?? null },
      workspace,
      outbox: { result_path: options.resultPath },
      context: {
        discovery: {
          id: discovery.id,
          title: discovery.title,
          problem: discovery.problem,
          tracker: discovery.tracker === null ? null : { provider: discovery.tracker.provider, card_id: discovery.tracker.cardId },
          target_repo: discovery.targetRepo,
          scope_repos: discovery.scopeRepos,
        },
        plan: plan === null || plan === undefined ? null : { id: plan.id, title: plan.title, summary: plan.summary },
        work_item:
          workItem === null || workItem === undefined
            ? null
            : {
                id: workItem.id,
                title: workItem.title,
                item_type: workItem.itemType,
                state: workItem.state,
                target_repo: workItem.targetRepo,
                scope_repos: workItem.scopeRepos,
              },
        // A etapa vai CALCULADA pelo app (D-13). A skill a le; nunca a decide.
        derived_stage: discovery.stageOverride?.value ?? discovery.derivedStage,
        history,
        notes,
      },
    },
  };
}
