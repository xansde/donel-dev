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
  /** A4 — o run ao qual este complemento se ancora. `null` num result normal. */
  readonly complements_run_id: string | null;
  /** A13 — o run cujo desfecho este revisa. `null` quando nao ha revisao. */
  readonly revises_run_id: string | null;
}

/** A4 — os dois tipos de documento que o outbox aceita. */
export type ResultKind = 'esteira.result' | 'esteira.result.complement';
export const RESULT_KINDS: readonly ResultKind[] = ['esteira.result', 'esteira.result.complement'];

/**
 * A4/A13 — a convencao de sufixo, num lugar so. Um run NAO se reescreve:
 * complemento e revisao sao runs NOVOS ancorados no anterior, e o sufixo faz o
 * parentesco visivel a olho nu no nome do arquivo do outbox — que e onde alguem
 * vai procurar quando o card disser "houve revisao".
 *
 * O padrao de id (`[A-Za-z0-9._:-]`) aceita ponto, entao o sufixo cabe sem
 * ampliar o alfabeto.
 */
export const COMPLEMENT_SUFFIX = /^(.+)\.c(\d+)$/;
export const REVISION_SUFFIX = /^(.+)\.rev(\d+)$/;

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
    }
  | {
      readonly type: 'gate.confirmed';
      readonly subject: EntityRef;
      readonly condition: string;
      readonly confirmed_by: string;
      readonly confirmed_at: string | null;
    }
  | {
      readonly type: 'decision.recorded';
      readonly subject: EntityRef;
      readonly decision: string;
      readonly confirmed_by: string;
      readonly rationale: string | null;
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
  'gate.confirmed',
  'decision.recorded',
];

export interface EsteiraResult {
  readonly contract_version: string;
  readonly kind: ResultKind;
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
  'run.complements_run_id',
  'run.revises_run_id',
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
  'facts[gate.confirmed].type',
  'facts[gate.confirmed].subject.entity',
  'facts[gate.confirmed].subject.id',
  'facts[gate.confirmed].condition',
  'facts[gate.confirmed].confirmed_by',
  'facts[gate.confirmed].confirmed_at',
  'facts[decision.recorded].type',
  'facts[decision.recorded].subject.entity',
  'facts[decision.recorded].subject.id',
  'facts[decision.recorded].decision',
  'facts[decision.recorded].confirmed_by',
  'facts[decision.recorded].rationale',
];

/**
 * `x-required-facts` do schema, do lado do app — a promessa que cada fase faz,
 * cobrada na ingestao. Copia LITERAL da tabela do arquivo canonico, pelo mesmo
 * motivo de `CONSUMED_PATHS`: este modulo e puro e nao le disco, entao a
 * sincronia e garantida por teste (`esteiraContractCoverage`), nao por leitura
 * de codigo feita por alguem de boa vontade. O lado skill le o schema direto.
 *
 * So vale para run `success`: o que se cobra e promessa CUMPRIDA. Um run que
 * falhou ja tem `failure` com codigo e motivo, e cobrar dele os fatos da fase
 * seria transformar um desfecho legivel em documento recusado.
 */
export const REQUIRED_FACTS_ANY_SUCCESS: readonly FactType[] = ['phase.completed'];

export const REQUIRED_FACTS_BY_PHASE: Readonly<Record<string, readonly FactType[]>> = {
  // A entidade E o assunto do run: uma discovery que abandonou continua sendo a
  // discovery que aquele run declarou. Por isso ela e cobrada em QUALQUER
  // desfecho — ao contrario do PRODUTO das outras fases, que so se cobra de
  // quem diz ter chegado nele.
  discovery: ['discovery.recorded'],
};

/**
 * A3 — o produto de cada fase, cobrado apenas de quem declara ter CHEGADO nele
 * (`phase.completed.outcome = done`).
 *
 * Antes a cobranca era por `status: success`, e isso obrigava um run que parou
 * num gate a declarar uma `verification.recorded` com `state: pending` so para
 * caber no contrato — o contrato empurrando a skill a inventar fato, que e a
 * inverdade de 03/08 entrando pela porta do gate. Desfecho ruim continua
 * valido e nao pede nada.
 *
 * A cobranca e por FASE FECHADA, nao por `run.phase`: um result que fecha N
 * fases (A22) responde pelo produto de cada uma que declarou `done`.
 */
export const REQUIRED_FACTS_BY_PHASE_WHEN_DONE: Readonly<Record<string, readonly FactType[]>> = {
  // Plano concluido sem nenhum item e o card F3 da evidencia 1 pelo avesso: a
  // fase diz que terminou bem e nao deixa nada para a seguinte tomar.
  plano: ['work_item.recorded'],
  // O que a fase produziu tem que poder ser conferido: o check que ela escreveu
  // e rodou, o documento pronto para revisao, ou a resposta do spike (D-4).
  implementar: ['verification.recorded'],
  // "Rodar a verificacao e validar" (D-4) — sem ela declarada, nao ha registro
  // do que foi examinado.
  validar: ['verification.recorded'],
  // D-8: o store guarda o PONTEIRO. Documento sem endereco nao responde "cade o
  // artefato?".
  documentar: ['artifact.recorded'],
  // D-4: o ciclo termina com PR verificado, documento aceito ou conclusao
  // registrada.
  concluir: ['verification.recorded'],
};

/**
 * Fases em que `phase.completed` com `outcome: "done"` exige uma
 * `verification.recorded` que **passou**. E o dente de D-4 ("PR mergeado e
 * verificado"): concluir sem evidencia seria o app afirmando o que nao leu, que
 * e o pecado que a spec 010 inteira existe para extinguir. Desfecho ruim
 * continua valido — `abandoned`/`inconclusive` nao pedem nada.
 */
export const PHASES_REQUIRING_PASSED_VERIFICATION: readonly string[] = ['concluir'];

/**
 * A18 — os fatos que carregam a palavra de uma PESSOA. Os dois nomeiam quem
 * confirmou no mesmo campo (`confirmed_by`) de proposito: a regra que fecha a
 * fase de conversa pergunta "houve fato humano com dono?", e um nome so evita
 * duas leituras da mesma pergunta.
 */
export const HUMAN_DECISION_FACTS: readonly FactType[] = ['gate.confirmed', 'decision.recorded'];

/**
 * A18 — as fases de CONVERSA. Elas existem para produzir decisao: fase que nao
 * perguntou nada nao fechou coisa nenhuma, e deixa-la sair "concluida" sem
 * nenhum fato humano seria a tela sem lastro que D-4 ja combate do outro lado.
 * Desfecho ruim nao pede nada — abandonar sem perguntar e legitimo.
 */
export const PHASES_REQUIRING_HUMAN_DECISION: readonly string[] = ['discovery', 'plano'];

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
  rejectUnknownKeys(
    raw,
    ['run_id', 'phase', 'status', 'started_at', 'finished_at', 'failure', 'complements_run_id', 'revises_run_id'],
    'run',
    c,
  );

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

  const complementsRunId = optionalPattern(raw, 'complements_run_id', ID_PATTERN, 'run', c);
  const revisesRunId = optionalPattern(raw, 'revises_run_id', ID_PATTERN, 'run', c);

  if (runId === null || phase === null || status === null || startedAt === null || finishedAt === null) return null;
  return {
    run_id: runId,
    phase,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    failure,
    complements_run_id: complementsRunId,
    revises_run_id: revisesRunId,
  };
}

/**
 * A4/A13 — o parentesco entre runs, verificado. Um run que se diz complemento
 * (ou revisao) de outro tem que trazer o sufixo combinado sobre o run ancorado:
 * sem isso, o parentesco existe so no campo, e olhar o outbox nao conta a
 * historia. E foi olhar o outbox — arquivo por arquivo — que revelou a Concluir
 * regravando o MESMO `run_id` com desfecho revisto.
 */
function checkRunLineage(run: ResultRun, kind: ResultKind, c: Collector): void {
  if (kind === 'esteira.result.complement') {
    if (run.complements_run_id === null) {
      c.add('complement_without_anchor', 'run.complements_run_id', 'a complement result must declare "complements_run_id"');
    } else {
      const match = COMPLEMENT_SUFFIX.exec(run.run_id);
      if (match === null || match[1] !== run.complements_run_id) {
        c.add(
          'lineage_suffix_mismatch',
          'run.run_id',
          `a complement of "${run.complements_run_id}" must be named "${run.complements_run_id}.c<N>"`,
        );
      }
    }
  } else if (run.complements_run_id !== null) {
    c.add('complement_without_kind', 'run.complements_run_id', 'only a "esteira.result.complement" may declare "complements_run_id"');
  }

  if (run.revises_run_id === null) return;
  if (run.revises_run_id === run.run_id) {
    // Reescrever o proprio run e exatamente o que a revisao existe para
    // substituir: o run anterior tem que continuar legivel.
    c.add('lineage_suffix_mismatch', 'run.revises_run_id', 'a run cannot revise itself');
    return;
  }
  const match = REVISION_SUFFIX.exec(run.run_id);
  if (match === null || match[1] !== run.revises_run_id || Number.parseInt(match[2], 10) < 2) {
    c.add(
      'lineage_suffix_mismatch',
      'run.run_id',
      `a revision of "${run.revises_run_id}" must be named "${run.revises_run_id}.rev<N>" with N >= 2`,
    );
  }
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
    case 'gate.confirmed': {
      // A9 — uma condicao por fato. O gate composto virava UMA linha de texto no
      // tasks.md, e meia-confirmacao nao cabia nela: a tela dizia "confirmado"
      // com metade do gate em aberto.
      rejectUnknownKeys(raw, ['type', 'subject', 'condition', 'confirmed_by', 'confirmed_at'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const condition = requireString(raw, 'condition', path, c);
      const confirmedBy = requireString(raw, 'confirmed_by', path, c);
      const confirmedAt = optionalPattern(raw, 'confirmed_at', TIMESTAMP_PATTERN, path, c);
      if (subject === null || condition === null || confirmedBy === null) return null;
      return { type: factType, subject, condition, confirmed_by: confirmedBy, confirmed_at: confirmedAt };
    }
    case 'decision.recorded': {
      rejectUnknownKeys(raw, ['type', 'subject', 'decision', 'confirmed_by', 'rationale'], path, c);
      const subject = parseEntityRef(raw, 'subject', path, c);
      const decision = requireString(raw, 'decision', path, c);
      const confirmedBy = requireString(raw, 'confirmed_by', path, c);
      const rationale = optionalString(raw, 'rationale', path, c);
      if (subject === null || decision === null || confirmedBy === null) return null;
      return { type: factType, subject, decision, confirmed_by: confirmedBy, rationale };
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

  const kind = (RESULT_KINDS as readonly unknown[]).includes(input.kind) ? (input.kind as ResultKind) : null;
  if (kind === null) {
    c.add('wrong_kind', 'kind', `kind must be one of ${RESULT_KINDS.join(' | ')}`);
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

  if (run !== null && kind !== null) checkRunLineage(run, kind, c);

  // A4 — o complemento ACRESCENTA fatos a um run ja ingerido; ele nao conta a
  // fase de novo. Por isso nao e cobrado pela tabela (a fase ja respondeu por
  // ela no run ancorado) e nao pode declarar `phase.completed`: a fase contada
  // duas vezes viraria duas passagens no card sobre a mesma execucao.
  if (kind === 'esteira.result.complement') {
    for (const fact of facts) {
      if (fact.type !== 'phase.completed') continue;
      c.add('complement_redeclares_phase', 'facts', 'a complement must not declare "phase.completed" — it adds facts, it does not close the phase again');
      break;
    }
  }

  // A promessa do outro lado, verificada aqui: run bem-sucedido SEM os fatos
  // que a fase promete seria de novo o app tendo que adivinhar o que aconteceu.
  // A tabela vem do schema (`x-required-facts`), nao de regra escrita duas
  // vezes — e o teste de cobertura reprova se as duas se afastarem.
  if (run !== null && run.status === 'success' && kind === 'esteira.result') {
    // As fases que este result declara FECHADAS com desfecho bom. A cobranca de
    // produto (A3) e por elas, nao por `run.phase`: quem diz "documentar
    // concluida" mostra o artefato, mesmo que o run se chame `implementar`.
    const donePhases = facts
      .filter((fact): fact is Extract<EsteiraFact, { type: 'phase.completed' }> => fact.type === 'phase.completed')
      .filter((fact) => fact.outcome === 'done')
      .map((fact) => fact.phase);

    const required: { readonly factType: FactType; readonly because: string }[] = [
      ...REQUIRED_FACTS_ANY_SUCCESS.map((factType) => ({ factType, because: run.phase })),
      ...(REQUIRED_FACTS_BY_PHASE[run.phase] ?? []).map((factType) => ({ factType, because: run.phase })),
      ...donePhases.flatMap((phase) => (REQUIRED_FACTS_BY_PHASE_WHEN_DONE[phase] ?? []).map((factType) => ({ factType, because: phase }))),
    ];

    for (const { factType, because } of required) {
      if (!facts.some((fact) => fact.type === factType)) {
        c.add('missing_required_fact', 'facts', `a successful "${because}" run must declare a "${factType}" fact`);
      }
    }

    // A18 — a fase de conversa fecha com o que alguem DISSE. Sem nenhum fato
    // humano, "discovery concluida" e uma fase que nao perguntou nada saindo
    // como se tivesse decidido algo.
    for (const phase of donePhases) {
      if (!PHASES_REQUIRING_HUMAN_DECISION.includes(phase)) continue;
      if (facts.some((fact) => (HUMAN_DECISION_FACTS as readonly string[]).includes(fact.type))) continue;
      c.add(
        'done_without_human_decision',
        'facts',
        `a "${phase}" run completed as "done" must declare at least one of ${HUMAN_DECISION_FACTS.join(' | ')}`,
      );
    }

    // D-4 com dente: a fase que declara o ciclo ENCERRADO precisa da evidencia
    // que o encerra. Sem isto, "Concluído" na tela seria palavra sem lastro —
    // a inverdade de 03/08 na direcao contraria.
    for (const phase of donePhases) {
      if (!PHASES_REQUIRING_PASSED_VERIFICATION.includes(phase)) continue;
      const passed = facts.some((fact) => fact.type === 'verification.recorded' && fact.state === 'passed');
      if (!passed) {
        c.add(
          'done_without_passed_verification',
          'facts',
          `a "${phase}" run completed as "done" must declare a "verification.recorded" fact with state "passed"`,
        );
      }
    }
  }

  if (c.failed || run === null || actor === null || subject === null) {
    const issues = c.failed ? c.issues : [{ code: 'missing_field' as const, path: '', message: 'incomplete result' }];
    return { ok: false, issues };
  }

  return {
    ok: true,
    result: { contract_version: contractVersion ?? CONTRACT_VERSION, kind: kind ?? 'esteira.result', run, actor, subject, workspace, facts },
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
