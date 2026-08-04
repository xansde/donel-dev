// Spec 010 (D-10) — lado APP do contrato `result.json`. O arquivo canonico do
// contrato e o JSON Schema vizinho (`v1/esteira-result.schema.json`), que o
// fork `esteira-donel-3.0.0` le na mesma versao; este modulo e a leitura que o
// app promete fazer dele. Os dois lados sao amarrados pelo teste de cobertura
// (`tests/esteiraContractCoverage.test.ts`), que compara CONSUMED_PATHS com os
// campos declarados no schema — e por um teste espelho do lado da skill.
//
// Por que fatos e nao `outputs.<campo>`: o bug de 03/08 (evidencia 1 da spec)
// foi o app deduzir "houve plano" de `outputs.plan_cards[]`, um campo OPCIONAL
// que a skill 2.1.0 nunca gravou — ausencia lida como "nao aconteceu". Aqui a
// skill DECLARA o que aconteceu; o que ela nao declara nao aconteceu, e o que
// ela declara errado vira erro de ingestao com caminho, nunca silencio.
//
// Os tipos espelham o JSON em snake_case de proposito: sao o contrato, nao o
// modelo interno do app. A traducao para o modelo do store acontece na
// ingestao — fora do passo zero.
//
// Modulo puro: sem I/O, sem dependencia de Electron, nunca lanca.

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

/** Versao do contrato que este app implementa. Major diferente = recusa de ingestao. */
export const CONTRACT_VERSION = '1.0.0';

export type ResultStatus = 'success' | 'failed' | 'aborted';
export type PhaseOutcome = 'done' | 'abandoned' | 'inconclusive';
export type EntityKind = 'discovery' | 'plan' | 'work_item';
export type RelationKind = 'originated' | 'flows_into' | 'ships_with';
export type ArtifactLocation = 'repo' | 'disk';
export type VerificationKind = 'pull-request' | 'check' | 'review' | 'conclusion';
export type VerificationState = 'pending' | 'passed' | 'failed';
export type LockHolderKind = 'skill' | 'app';

/** Tipos de item de D-4. Teste e CI/CD NAO sao tipos, por decisao da spec. */
export const WORK_ITEM_TYPES = ['issue', 'spec', 'process-map', 'adr', 'prototype', 'spike', 'eval'] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export interface EntityRef {
  readonly entity: EntityKind;
  readonly id: string;
}

export interface TrackerRef {
  readonly provider: string;
  readonly card_id: string;
}

export interface ResultRun {
  readonly run_id: string;
  readonly phase: string;
  readonly status: ResultStatus;
  readonly started_at: string;
  readonly finished_at: string;
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export interface ResultActor {
  readonly tool: string;
  readonly tool_version: string;
  readonly executor: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly cli_session_id: string | null;
}

export interface ResultSubject {
  readonly discovery_id: string;
  readonly plan_id: string | null;
  readonly work_item_id: string | null;
}

export interface ResultWorkspace {
  readonly target_repo: string;
  readonly repo_path: string | null;
  readonly worktree_path: string | null;
  readonly branch: string | null;
}

export type EsteiraFact =
  | {
      readonly type: 'discovery.recorded';
      readonly discovery_id: string;
      readonly title: string;
      readonly problem: string | null;
      readonly tracker: TrackerRef | null;
      readonly target_repo: string | null;
      readonly scope_repos: readonly string[];
    }
  | {
      readonly type: 'plan.recorded';
      readonly plan_id: string;
      readonly discovery_id: string;
      readonly title: string;
      readonly summary: string | null;
    }
  | {
      readonly type: 'work_item.recorded';
      readonly work_item_id: string;
      readonly plan_id: string | null;
      readonly item_type: WorkItemType;
      readonly title: string;
      readonly target_repo: string | null;
      readonly scope_repos: readonly string[];
    }
  | {
      readonly type: 'relation.recorded';
      readonly relation: RelationKind;
      readonly from: EntityRef;
      readonly to: EntityRef;
    }
  | {
      readonly type: 'artifact.recorded';
      readonly owner: EntityRef;
      readonly artifact_kind: string;
      readonly location: ArtifactLocation;
      readonly repo: string | null;
      readonly path: string;
    }
  | {
      readonly type: 'verification.recorded';
      readonly subject: EntityRef;
      readonly verification_kind: VerificationKind;
      readonly state: VerificationState;
      readonly ref: string | null;
    }
  | {
      readonly type: 'phase.completed';
      readonly subject: EntityRef;
      readonly phase: string;
      readonly outcome: PhaseOutcome;
      readonly summary: string | null;
    }
  | {
      readonly type: 'lock.acquired';
      readonly subject: EntityRef;
      readonly phase: string;
      readonly holder: { readonly kind: LockHolderKind; readonly acquired_at: string; readonly cli_session_id: string | null };
    }
  | {
      readonly type: 'lock.released';
      readonly subject: EntityRef;
      readonly phase: string;
    }
  | {
      readonly type: 'note.recorded';
      readonly subject: EntityRef;
      readonly text: string;
    };

export type FactType = EsteiraFact['type'];

export const FACT_TYPES: readonly FactType[] = [
  'discovery.recorded',
  'plan.recorded',
  'work_item.recorded',
  'relation.recorded',
  'artifact.recorded',
  'verification.recorded',
  'phase.completed',
  'lock.acquired',
  'lock.released',
  'note.recorded',
];

export interface EsteiraResult {
  readonly contract_version: string;
  readonly kind: 'esteira.result';
  readonly run: ResultRun;
  readonly actor: ResultActor;
  readonly subject: ResultSubject;
  readonly workspace: ResultWorkspace | null;
  readonly facts: readonly EsteiraFact[];
}

/**
 * Os codigos e o formato do issue moram em `parsing.ts`, compartilhados com o
 * contrato de IDA (`runInput.ts`): duas copias das mesmas regras seriam duas
 * chances de elas divergirem. O que NAO pode acontecer e a ausencia do issue —
 * documento fora do contrato vira erro VISIVEL (D-10), nunca "fase nao
 * realizada".
 */
export type { ContractIssue, ContractIssueCode } from './parsing';

export type ParseEsteiraResult =
  | { readonly ok: true; readonly result: EsteiraResult }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

/**
 * Todo campo que o app promete LER, em notacao canonica. E metade do teste de
 * contrato: campo lido aqui e nao declarado no schema (ou vice-versa) reprova
 * a suite. Manter em sincronia com o parser abaixo — a lista existe justamente
 * porque "o app le X" precisa ser uma afirmacao verificavel, nao uma leitura
 * do codigo feita por alguem com boa vontade.
 */
export const CONSUMED_PATHS: readonly string[] = [
  'contract_version',
  'kind',
  'run.run_id',
  'run.phase',
  'run.status',
  'run.started_at',
  'run.finished_at',
  'run.failure.code',
  'run.failure.message',
  'actor.tool',
  'actor.tool_version',
  'actor.executor',
  'actor.model',
  'actor.effort',
  'actor.cli_session_id',
  'subject.discovery_id',
  'subject.plan_id',
  'subject.work_item_id',
  'workspace.target_repo',
  'workspace.repo_path',
  'workspace.worktree_path',
  'workspace.branch',
  'facts[discovery.recorded].type',
  'facts[discovery.recorded].discovery_id',
  'facts[discovery.recorded].title',
  'facts[discovery.recorded].problem',
  'facts[discovery.recorded].tracker.provider',
  'facts[discovery.recorded].tracker.card_id',
  'facts[discovery.recorded].target_repo',
  'facts[discovery.recorded].scope_repos[]',
  'facts[plan.recorded].type',
  'facts[plan.recorded].plan_id',
  'facts[plan.recorded].discovery_id',
  'facts[plan.recorded].title',
  'facts[plan.recorded].summary',
  'facts[work_item.recorded].type',
  'facts[work_item.recorded].work_item_id',
  'facts[work_item.recorded].plan_id',
  'facts[work_item.recorded].item_type',
  'facts[work_item.recorded].title',
  'facts[work_item.recorded].target_repo',
  'facts[work_item.recorded].scope_repos[]',
  'facts[relation.recorded].type',
  'facts[relation.recorded].relation',
  'facts[relation.recorded].from.entity',
  'facts[relation.recorded].from.id',
  'facts[relation.recorded].to.entity',
  'facts[relation.recorded].to.id',
  'facts[artifact.recorded].type',
  'facts[artifact.recorded].owner.entity',
  'facts[artifact.recorded].owner.id',
  'facts[artifact.recorded].artifact_kind',
  'facts[artifact.recorded].location',
  'facts[artifact.recorded].repo',
  'facts[artifact.recorded].path',
  'facts[verification.recorded].type',
  'facts[verification.recorded].subject.entity',
  'facts[verification.recorded].subject.id',
  'facts[verification.recorded].verification_kind',
  'facts[verification.recorded].state',
  'facts[verification.recorded].ref',
  'facts[phase.completed].type',
  'facts[phase.completed].subject.entity',
  'facts[phase.completed].subject.id',
  'facts[phase.completed].phase',
  'facts[phase.completed].outcome',
  'facts[phase.completed].summary',
  'facts[lock.acquired].type',
  'facts[lock.acquired].subject.entity',
  'facts[lock.acquired].subject.id',
  'facts[lock.acquired].phase',
  'facts[lock.acquired].holder.kind',
  'facts[lock.acquired].holder.acquired_at',
  'facts[lock.acquired].holder.cli_session_id',
  'facts[lock.released].type',
  'facts[lock.released].subject.entity',
  'facts[lock.released].subject.id',
  'facts[lock.released].phase',
  'facts[note.recorded].type',
  'facts[note.recorded].subject.entity',
  'facts[note.recorded].subject.id',
  'facts[note.recorded].text',
];

function parseEntityRef(node: Record<string, unknown>, key: string, path: string, c: Collector): EntityRef | null {
  const raw = node[key];
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', `${path}.${key}`, `field "${key}" must be an entity ref`);
    return null;
  }
  const refPath = `${path}.${key}`;
  rejectUnknownKeys(raw, ['entity', 'id'], refPath, c);
  const entity = requireEnum<EntityKind>(raw, 'entity', ['discovery', 'plan', 'work_item'], refPath, c);
  const id = requirePattern(raw, 'id', ID_PATTERN, refPath, c);
  if (entity === null || id === null) return null;
  return { entity, id };
}

function parseRun(raw: unknown, c: Collector): ResultRun | null {
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', 'run', 'field "run" must be an object');
    return null;
  }
  rejectUnknownKeys(raw, ['run_id', 'phase', 'status', 'started_at', 'finished_at', 'failure'], 'run', c);

  const runId = requirePattern(raw, 'run_id', ID_PATTERN, 'run', c);
  const phase = requirePattern(raw, 'phase', PHASE_PATTERN, 'run', c);
  const status = requireEnum<ResultStatus>(raw, 'status', ['success', 'failed', 'aborted'], 'run', c);
  const startedAt = requirePattern(raw, 'started_at', TIMESTAMP_PATTERN, 'run', c);
  const finishedAt = requirePattern(raw, 'finished_at', TIMESTAMP_PATTERN, 'run', c);

  let failure: ResultRun['failure'] = null;
  const rawFailure = raw.failure;
  if (rawFailure !== undefined && rawFailure !== null) {
    if (!isPlainObject(rawFailure)) {
      c.add('wrong_type', 'run.failure', 'field "failure" must be an object or null');
    } else {
      rejectUnknownKeys(rawFailure, ['code', 'message'], 'run.failure', c);
      const code = requireString(rawFailure, 'code', 'run.failure', c);
      const message = requireString(rawFailure, 'message', 'run.failure', c);
      if (code !== null && message !== null) failure = { code, message };
    }
  }

  // Um desfecho ruim precisa ser LEGIVEL: status != success sem failure e
  // exatamente o "nao sei o que houve" que a spec quer extinguir.
  if (status !== null && status !== 'success' && failure === null) {
    c.add('failure_missing', 'run.failure', 'run.failure is required when status is not "success"');
  }
  if (status === 'success' && failure !== null) {
    c.add('failure_unexpected', 'run.failure', 'run.failure must be null when status is "success"');
  }

  if (runId === null || phase === null || status === null || startedAt === null || finishedAt === null) return null;
  return { run_id: runId, phase, status, started_at: startedAt, finished_at: finishedAt, failure };
}

function parseActor(raw: unknown, c: Collector): ResultActor | null {
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', 'actor', 'field "actor" must be an object');
    return null;
  }
  rejectUnknownKeys(raw, ['tool', 'tool_version', 'executor', 'model', 'effort', 'cli_session_id'], 'actor', c);
  const tool = requireString(raw, 'tool', 'actor', c);
  const toolVersion = requirePattern(raw, 'tool_version', /^\d+\.\d+\.\d+/, 'actor', c);
  const actor: ResultActor = {
    tool: tool ?? '',
    tool_version: toolVersion ?? '',
    executor: optionalString(raw, 'executor', 'actor', c),
    model: optionalString(raw, 'model', 'actor', c),
    effort: optionalString(raw, 'effort', 'actor', c),
    cli_session_id: optionalString(raw, 'cli_session_id', 'actor', c),
  };
  if (tool === null || toolVersion === null) return null;
  return actor;
}

function parseSubject(raw: unknown, c: Collector): ResultSubject | null {
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

function parseWorkspace(raw: unknown, c: Collector): ResultWorkspace | null {
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

function parseFact(raw: unknown, path: string, c: Collector): EsteiraFact | null {
  if (!isPlainObject(raw)) {
    c.add('wrong_type', path, 'fact must be an object');
    return null;
  }
  const type = raw.type;
  if (typeof type !== 'string' || !(FACT_TYPES as readonly string[]).includes(type)) {
    c.add('unknown_fact_type', `${path}.type`, `unknown fact type ${JSON.stringify(type)}`);
    return null;
  }

  const factType = type as FactType;
  switch (factType) {
    case 'discovery.recorded': {
      rejectUnknownKeys(raw, ['type', 'discovery_id', 'title', 'problem', 'tracker', 'target_repo', 'scope_repos'], path, c);
      const discoveryId = requirePattern(raw, 'discovery_id', ID_PATTERN, path, c);
      const title = requireString(raw, 'title', path, c);
      let tracker: TrackerRef | null = null;
      const rawTracker = raw.tracker;
      if (rawTracker !== undefined && rawTracker !== null) {
        if (!isPlainObject(rawTracker)) {
          c.add('wrong_type', `${path}.tracker`, 'field "tracker" must be an object or null');
        } else {
          rejectUnknownKeys(rawTracker, ['provider', 'card_id'], `${path}.tracker`, c);
          const provider = requireString(rawTracker, 'provider', `${path}.tracker`, c);
          const cardId = requireString(rawTracker, 'card_id', `${path}.tracker`, c);
          if (provider !== null && cardId !== null) tracker = { provider, card_id: cardId };
        }
      }
      const scopeRepos = requireStringList(raw, 'scope_repos', path, c);
      const problem = optionalString(raw, 'problem', path, c);
      const targetRepo = optionalString(raw, 'target_repo', path, c);
      if (discoveryId === null || title === null) return null;
      return { type: factType,discovery_id: discoveryId, title, problem, tracker, target_repo: targetRepo, scope_repos: scopeRepos };
    }
    case 'plan.recorded': {
      rejectUnknownKeys(raw, ['type', 'plan_id', 'discovery_id', 'title', 'summary'], path, c);
      const planId = requirePattern(raw, 'plan_id', ID_PATTERN, path, c);
      const discoveryId = requirePattern(raw, 'discovery_id', ID_PATTERN, path, c);
      const title = requireString(raw, 'title', path, c);
      const summary = optionalString(raw, 'summary', path, c);
      if (planId === null || discoveryId === null || title === null) return null;
      return { type: factType,plan_id: planId, discovery_id: discoveryId, title, summary };
    }
    case 'work_item.recorded': {
      rejectUnknownKeys(raw, ['type', 'work_item_id', 'plan_id', 'item_type', 'title', 'target_repo', 'scope_repos'], path, c);
      const workItemId = requirePattern(raw, 'work_item_id', ID_PATTERN, path, c);
      const planId = optionalPattern(raw, 'plan_id', ID_PATTERN, path, c);
      const itemType = requireEnum<WorkItemType>(raw, 'item_type', WORK_ITEM_TYPES, path, c);
      const title = requireString(raw, 'title', path, c);
      const targetRepo = optionalString(raw, 'target_repo', path, c);
      const scopeRepos = requireStringList(raw, 'scope_repos', path, c);
      // D-6: issue tem EXATAMENTE um alvo. Sem repo, nao dispara — e a regra
      // que impede a repeticao da evidencia 2 (fase abrindo no repo errado).
      if (itemType === 'issue' && (targetRepo === null || targetRepo.length === 0)) {
        c.add('issue_without_target_repo', `${path}.target_repo`, 'work item of type "issue" requires exactly one target_repo');
      }
      if (workItemId === null || itemType === null || title === null) return null;
      return { type: factType,work_item_id: workItemId, plan_id: planId, item_type: itemType, title, target_repo: targetRepo, scope_repos: scopeRepos };
    }
    case 'relation.recorded': {
      rejectUnknownKeys(raw, ['type', 'relation', 'from', 'to'], path, c);
      const relation = requireEnum<RelationKind>(raw, 'relation', ['originated', 'flows_into', 'ships_with'], path, c);
      const from = parseEntityRef(raw, 'from', path, c);
      const to = parseEntityRef(raw, 'to', path, c);
      if (relation === null || from === null || to === null) return null;
      return { type: factType,relation, from, to };
    }
    case 'artifact.recorded': {
      rejectUnknownKeys(raw, ['type', 'owner', 'artifact_kind', 'location', 'repo', 'path'], path, c);
      const owner = parseEntityRef(raw, 'owner', path, c);
      const artifactKind = requireString(raw, 'artifact_kind', path, c);
      const location = requireEnum<ArtifactLocation>(raw, 'location', ['repo', 'disk'], path, c);
      const repo = optionalString(raw, 'repo', path, c);
      const artifactPath = requireString(raw, 'path', path, c);
      // D-8: o ponteiro tem que ser resolvivel. `repo` sem location=repo (ou o
      // contrario) e um ponteiro que nao leva a lugar nenhum.
      if (location === 'repo' && repo === null) {
        c.add('artifact_repo_mismatch', `${path}.repo`, 'artifact with location "repo" requires "repo"');
      }
      if (location === 'disk' && repo !== null) {
        c.add('artifact_repo_mismatch', `${path}.repo`, 'artifact with location "disk" must not carry "repo"');
      }
      if (owner === null || artifactKind === null || location === null || artifactPath === null) return null;
      return { type: factType,owner, artifact_kind: artifactKind, location, repo, path: artifactPath };
    }
    case 'verification.recorded': {
      rejectUnknownKeys(raw, ['type', 'subject', 'verification_kind', 'state', 'ref'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const verificationKind = requireEnum<VerificationKind>(raw, 'verification_kind', ['pull-request', 'check', 'review', 'conclusion'], path, c);
      const state = requireEnum<VerificationState>(raw, 'state', ['pending', 'passed', 'failed'], path, c);
      const ref = optionalString(raw, 'ref', path, c);
      if (subject === null || verificationKind === null || state === null) return null;
      return { type: factType,subject, verification_kind: verificationKind, state, ref };
    }
    case 'phase.completed': {
      rejectUnknownKeys(raw, ['type', 'subject', 'phase', 'outcome', 'summary'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const phase = requirePattern(raw, 'phase', PHASE_PATTERN, path, c);
      const outcome = requireEnum<PhaseOutcome>(raw, 'outcome', ['done', 'abandoned', 'inconclusive'], path, c);
      const summary = optionalString(raw, 'summary', path, c);
      if (subject === null || phase === null || outcome === null) return null;
      return { type: factType,subject, phase, outcome, summary };
    }
    case 'lock.acquired': {
      rejectUnknownKeys(raw, ['type', 'subject', 'phase', 'holder'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const phase = requirePattern(raw, 'phase', PHASE_PATTERN, path, c);
      const rawHolder = raw.holder;
      let holder: { kind: LockHolderKind; acquired_at: string; cli_session_id: string | null } | null = null;
      if (!isPlainObject(rawHolder)) {
        c.add(rawHolder === undefined ? 'missing_field' : 'wrong_type', `${path}.holder`, 'field "holder" must be an object');
      } else {
        rejectUnknownKeys(rawHolder, ['kind', 'acquired_at', 'cli_session_id'], `${path}.holder`, c);
        const kind = requireEnum<LockHolderKind>(rawHolder, 'kind', ['skill', 'app'], `${path}.holder`, c);
        const acquiredAt = requirePattern(rawHolder, 'acquired_at', TIMESTAMP_PATTERN, `${path}.holder`, c);
        const cliSessionId = optionalString(rawHolder, 'cli_session_id', `${path}.holder`, c);
        if (kind !== null && acquiredAt !== null) holder = { kind, acquired_at: acquiredAt, cli_session_id: cliSessionId };
      }
      if (subject === null || phase === null || holder === null) return null;
      return { type: factType,subject, phase, holder };
    }
    case 'lock.released': {
      rejectUnknownKeys(raw, ['type', 'subject', 'phase'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const phase = requirePattern(raw, 'phase', PHASE_PATTERN, path, c);
      if (subject === null || phase === null) return null;
      return { type: factType,subject, phase };
    }
    case 'note.recorded': {
      rejectUnknownKeys(raw, ['type', 'subject', 'text'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const text = requireString(raw, 'text', path, c);
      if (subject === null || text === null) return null;
      return { type: factType,subject, text };
    }
  }
}

/**
 * Le um `result.json` ja parseado (ou o texto cru, via `parseEsteiraResultText`).
 * Nunca lanca. `ok: false` sempre traz PELO MENOS um issue com caminho — e o
 * que a UI transforma em "erro de ingestao" visivel no card.
 */
export function parseEsteiraResult(input: unknown): ParseEsteiraResult {
  const c = new Collector();

  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ code: 'not_an_object', path: '', message: 'result must be a JSON object' }] };
  }

  rejectUnknownKeys(input, ['contract_version', 'kind', 'run', 'actor', 'subject', 'workspace', 'facts'], '', c);

  if (input.kind !== 'esteira.result') {
    c.add('wrong_kind', 'kind', 'kind must be "esteira.result"');
  }

  const contractVersion = requirePattern(input, 'contract_version', SEMVER_PATTERN, '', c);
  // O major e a fronteira de compatibilidade: canal que nao entende a versao
  // recusa com erro visivel em vez de adivinhar (mesma disciplina do store).
  if (contractVersion !== null && majorOf(contractVersion) !== majorOf(CONTRACT_VERSION)) {
    c.add('unsupported_major', 'contract_version', `unsupported contract major: got ${contractVersion}, app implements ${CONTRACT_VERSION}`);
  }

  const run = parseRun(input.run, c);
  const actor = parseActor(input.actor, c);
  const subject = parseSubject(input.subject, c);
  const workspace = parseWorkspace(input.workspace, c);

  const rawFacts = input.facts;
  const facts: EsteiraFact[] = [];
  if (!Array.isArray(rawFacts)) {
    c.add(rawFacts === undefined ? 'missing_field' : 'wrong_type', 'facts', 'field "facts" must be an array');
  } else if (rawFacts.length === 0) {
    c.add('empty_facts', 'facts', 'facts must not be empty — a run that declares nothing has no result to ingest');
  } else {
    rawFacts.forEach((raw, index) => {
      const fact = parseFact(raw, `facts[${index}]`, c);
      if (fact !== null) facts.push(fact);
    });
  }

  // A promessa do outro lado, verificada aqui: run bem-sucedido SEM
  // `phase.completed` seria de novo o app tendo que adivinhar se terminou.
  if (run !== null && run.status === 'success') {
    if (!facts.some((fact) => fact.type === 'phase.completed')) {
      c.add('missing_required_fact', 'facts', 'a successful run must declare a "phase.completed" fact');
    }
    if (run.phase === 'discovery' && !facts.some((fact) => fact.type === 'discovery.recorded')) {
      c.add('missing_required_fact', 'facts', 'a successful "discovery" run must declare a "discovery.recorded" fact');
    }
  }

  if (c.failed || run === null || actor === null || subject === null) {
    const issues = c.failed ? c.issues : [{ code: 'missing_field' as const, path: '', message: 'incomplete result' }];
    return { ok: false, issues };
  }

  return {
    ok: true,
    result: { contract_version: contractVersion ?? CONTRACT_VERSION, kind: 'esteira.result', run, actor, subject, workspace, facts },
  };
}

/** Mesmo contrato, a partir do texto do arquivo. JSON invalido vira issue, nunca excecao. */
export function parseEsteiraResultText(text: string): ParseEsteiraResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    return { ok: false, issues: [{ code: 'invalid_json', path: '', message: detail }] };
  }
  return parseEsteiraResult(parsed);
}
