// Spec 010 (D-9, D-13) — vertical pequeno, passo 2: o REDUCER. Le a lista de
// eventos do `events.jsonl` (ja parseada por `storeFormat.parseEventLine`) e
// devolve o `StoreSnapshot`. Modulo PURO: sem fs, sem Electron, nunca lanca.
//
// Tres promessas, cada uma nascida de um modo de falha real:
//
// 1. **Dedupe por `dedupe_key`** — reingerir o mesmo `result.json` nao duplica
//    fato. E o que permite ao watcher reler um arquivo sem medo.
// 2. **Preserva o que nao entende** — evento de tipo desconhecido (gravado por
//    um canal mais novo) e ignorado na derivacao, nunca apagado nem fatal.
// 3. **A macro etapa e DERIVADA** (D-13), nunca digitada. Ausencia de dado
//    jamais vira "nao realizada": discovery concluido sem plano e um estado
//    legitimo, com sinal proprio (`completed-without-plan`) — foi ler ausencia
//    como negacao que produziu a inverdade de 03/08.
//
// Payload malformado nao derruba a leitura: o evento e ignorado e os demais
// seguem. O store e historico; um registro ilegivel nao pode custar os outros.

import {
  LIFECYCLE_BY_ITEM_TYPE,
  STORE_SCHEMA_VERSION,
  type ArtifactPointer,
  type DiscoverySnapshot,
  type EntityId,
  type EntityKind,
  type IngestErrorSnapshot,
  type LockRecord,
  type MacroStage,
  type MirrorQueueEntry,
  type NoteSnapshot,
  type PhaseOutcome,
  type PhaseRunSnapshot,
  type PlanSnapshot,
  type RelationKind,
  type RelationSnapshot,
  type SessionSnapshot,
  type StageOverride,
  type StoreEvent,
  type StoreSnapshot,
  type TrackerRef,
  type VerificationKind,
  type VerificationSnapshot,
  type VerificationState,
  type WorkItemSnapshot,
  type WorkItemState,
  type WorkItemType,
} from './storeFormat';

/**
 * O nome da fase de descoberta. `run.phase` e string livre no contrato porque
 * `[P-4]` deixou os nomes por ciclo de vida em aberto — mas a derivacao de
 * etapa precisa reconhecer UMA fase pelo nome. Constante isolada: quando P-4
 * fechar, muda aqui e em nenhum outro lugar.
 */
export const DISCOVERY_PHASE_NAME = 'discovery';

export type StageSignal = DiscoverySnapshot['stageSignals'][number];

export interface StageItemInput {
  readonly state: WorkItemState;
  /** Ja esteve `done`/`abandoned` alguma vez. E o que faz a etapa RETROCEDER quando o item e reaberto. */
  readonly everConcluded: boolean;
}

export interface StageInput {
  readonly discoveryConcluded: boolean;
  readonly discoveryOutcome: PhaseOutcome | null;
  readonly planCount: number;
  readonly items: readonly StageItemInput[];
}

export interface StageResult {
  readonly stage: MacroStage;
  readonly signals: readonly StageSignal[];
}

/**
 * A tabela de `passo-zero.md` §2, na ordem em que ela e escrita — a ordem E a
 * precedencia. Nao consulta o grafo: recebe o resumo ja extraido, para ser
 * testavel linha a linha.
 */
export function deriveStage(input: StageInput): StageResult {
  if (!input.discoveryConcluded) return { stage: 'discovery', signals: [] };

  if (input.planCount === 0) {
    // O card F3 da evidencia 1: discovery concluido, nenhum plano. Estado
    // LEGITIMO — o sinal existe para que ele apareca como o que e, em vez de
    // ser confundido com "a fase nunca rodou".
    // Abandonado/inconclusivo nao ganham o sinal: nao planejar depois de
    // desistir nao e a mesma coisa que concluir sem planejar.
    const signals: StageSignal[] = input.discoveryOutcome === 'done' ? ['completed-without-plan'] : [];
    return { stage: 'discovery', signals };
  }

  const reopened = input.items.some((item) => item.everConcluded && item.state !== 'done' && item.state !== 'abandoned');
  const running = input.items.some((item) => item.state === 'in-progress');
  if (reopened || running) return { stage: 'execution', signals: [] };

  const allConcluded = input.items.length > 0 && input.items.every((item) => item.state === 'done' || item.state === 'abandoned');
  if (allConcluded) return { stage: 'done', signals: [] };

  return { stage: 'planned', signals: [] };
}

// ---------------------------------------------------------------------------
// Leitura defensiva de payload — o payload vem do disco e pode estar corrompido
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strList(node: Record<string, unknown>, key: string): readonly string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function bool(node: Record<string, unknown>, key: string): boolean {
  return node[key] === true;
}

function oneOf<T extends string>(node: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  const value = node[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const ENTITY_KINDS: readonly EntityKind[] = ['discovery', 'plan', 'work_item'];

function entityId(node: Record<string, unknown>, key: string): EntityId | null {
  const raw = node[key];
  if (!isPlainObject(raw)) return null;
  const entity = oneOf<EntityKind>(raw, 'entity', ENTITY_KINDS);
  const id = str(raw, 'id');
  if (entity === null || id === null) return null;
  return { entity, id };
}

function trackerRef(node: Record<string, unknown>, key: string): TrackerRef | null {
  const raw = node[key];
  if (!isPlainObject(raw)) return null;
  const provider = str(raw, 'provider');
  const cardId = str(raw, 'cardId');
  if (provider === null || cardId === null) return null;
  return { provider, cardId };
}

function entityKey(id: EntityId): string {
  return `${id.entity}:${id.id}`;
}

function relationKey(relation: string, from: EntityId, to: EntityId): string {
  return `${relation}|${entityKey(from)}|${entityKey(to)}`;
}

const WORK_ITEM_TYPES: readonly WorkItemType[] = ['issue', 'spec', 'process-map', 'adr', 'prototype', 'spike', 'eval'];
const WORK_ITEM_STATES: readonly WorkItemState[] = ['open', 'in-progress', 'done', 'abandoned'];
const MACRO_STAGES: readonly MacroStage[] = ['discovery', 'planned', 'execution', 'done'];
const RELATION_KINDS: readonly RelationKind[] = ['originated', 'flows_into', 'ships_with'];
const PHASE_OUTCOMES: readonly PhaseOutcome[] = ['done', 'abandoned', 'inconclusive'];
const VERIFICATION_KINDS: readonly VerificationKind[] = ['pull-request', 'check', 'review', 'conclusion'];
const VERIFICATION_STATES: readonly VerificationState[] = ['pending', 'passed', 'failed'];

// ---------------------------------------------------------------------------
// Estado interno da reducao (mutavel aqui dentro, congelado na saida)
// ---------------------------------------------------------------------------

interface MutableDiscovery {
  id: string;
  title: string;
  problem: string | null;
  tracker: TrackerRef | null;
  targetRepo: string | null;
  scopeRepos: readonly string[];
  createdAt: string;
  stageOverride: StageOverride | null;
}

interface MutableWorkItem {
  id: string;
  discoveryId: string;
  planId: string | null;
  itemType: WorkItemType;
  title: string;
  targetRepo: string | null;
  scopeRepos: readonly string[];
  state: WorkItemState;
  everConcluded: boolean;
  createdBySkill: boolean;
  createdAt: string;
}

interface MutableSession {
  id: string;
  cliSessionId: string | null;
  subject: EntityId;
  phase: string;
  continuesSessionId: string | null;
  handoffReason: string | null;
  cwd: string | null;
  model: string | null;
  effort: string | null;
  startedAt: string;
  endedAt: string | null;
  inputPath: string | null;
  resultPath: string | null;
  claimed: boolean;
}

interface MutableMirror {
  subject: EntityId;
  operation: string;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface ReduceOptions {
  /** Injetavel para teste; default e a hora atual. */
  readonly builtAt?: string;
}

export function reduceEvents(events: readonly StoreEvent[], options: ReduceOptions = {}): StoreSnapshot {
  const discoveries = new Map<string, MutableDiscovery>();
  const plans = new Map<string, PlanSnapshot>();
  const workItems = new Map<string, MutableWorkItem>();
  const sessions = new Map<string, MutableSession>();
  const relations = new Map<string, RelationSnapshot>();
  const artifacts = new Map<string, ArtifactPointer>();
  const locks = new Map<string, LockRecord>();
  const phases = new Map<string, PhaseRunSnapshot>();
  const verifications = new Map<string, VerificationSnapshot>();
  const notes: NoteSnapshot[] = [];
  const ingestErrors: IngestErrorSnapshot[] = [];
  const mirrorQueue = new Map<string, MutableMirror>();

  const seenDedupeKeys = new Set<string>();
  let throughSeq = 0;

  for (const event of events) {
    if (event.seq > throughSeq) throughSeq = event.seq;

    // Dois eventos com a mesma chave natural sao o MESMO fato: o segundo e
    // descartado na leitura. E dai que vem a idempotencia da ingestao.
    if (event.dedupe_key !== null) {
      if (seenDedupeKeys.has(event.dedupe_key)) continue;
      seenDedupeKeys.add(event.dedupe_key);
    }

    const p = event.payload;

    switch (event.type) {
      case 'discovery.created':
      case 'discovery.updated': {
        const id = str(p, 'id');
        if (id === null) break;
        const current = discoveries.get(id);
        if (current === undefined && event.type === 'discovery.updated') break;
        const title = str(p, 'title') ?? current?.title;
        if (title === undefined) break;
        discoveries.set(id, {
          id,
          title,
          problem: str(p, 'problem') ?? current?.problem ?? null,
          tracker: trackerRef(p, 'tracker') ?? current?.tracker ?? null,
          targetRepo: str(p, 'targetRepo') ?? current?.targetRepo ?? null,
          scopeRepos: 'scopeRepos' in p ? strList(p, 'scopeRepos') : (current?.scopeRepos ?? []),
          createdAt: current?.createdAt ?? str(p, 'createdAt') ?? event.at,
          stageOverride: current?.stageOverride ?? null,
        });
        break;
      }

      case 'plan.created': {
        const id = str(p, 'id');
        const discoveryId = str(p, 'discoveryId');
        const title = str(p, 'title');
        if (id === null || discoveryId === null || title === null) break;
        plans.set(id, {
          id,
          discoveryId,
          title,
          summary: str(p, 'summary'),
          createdAt: str(p, 'createdAt') ?? event.at,
        });
        break;
      }

      case 'work_item.created': {
        const id = str(p, 'id');
        const discoveryId = str(p, 'discoveryId');
        const itemType = oneOf<WorkItemType>(p, 'itemType', WORK_ITEM_TYPES);
        const title = str(p, 'title');
        if (id === null || discoveryId === null || itemType === null || title === null) break;
        const current = workItems.get(id);
        const state = oneOf<WorkItemState>(p, 'state', WORK_ITEM_STATES) ?? current?.state ?? 'open';
        workItems.set(id, {
          id,
          discoveryId,
          planId: str(p, 'planId'),
          itemType,
          title,
          targetRepo: str(p, 'targetRepo'),
          scopeRepos: strList(p, 'scopeRepos'),
          state,
          everConcluded: (current?.everConcluded ?? false) || state === 'done' || state === 'abandoned',
          createdBySkill: bool(p, 'createdBySkill'),
          createdAt: current?.createdAt ?? str(p, 'createdAt') ?? event.at,
        });
        break;
      }

      case 'work_item.updated': {
        const id = str(p, 'id');
        if (id === null) break;
        const current = workItems.get(id);
        if (current === undefined) break; // nunca cria fantasma a partir de um update
        const state = oneOf<WorkItemState>(p, 'state', WORK_ITEM_STATES) ?? current.state;
        workItems.set(id, {
          ...current,
          title: str(p, 'title') ?? current.title,
          planId: 'planId' in p ? str(p, 'planId') : current.planId,
          targetRepo: 'targetRepo' in p ? str(p, 'targetRepo') : current.targetRepo,
          scopeRepos: 'scopeRepos' in p ? strList(p, 'scopeRepos') : current.scopeRepos,
          state,
          everConcluded: current.everConcluded || state === 'done' || state === 'abandoned',
        });
        break;
      }

      case 'work_item.discarded': {
        // D-16: item nascido pela skill se descarta num gesto. O evento fica no
        // log (historico nunca some); a entidade sai do snapshot.
        const id = str(p, 'id');
        if (id !== null) workItems.delete(id);
        break;
      }

      case 'relation.added': {
        const relation = oneOf<RelationKind>(p, 'relation', RELATION_KINDS);
        const from = entityId(p, 'from');
        const to = entityId(p, 'to');
        if (relation === null || from === null || to === null) break;
        relations.set(relationKey(relation, from, to), { relation, from, to, recordedAt: str(p, 'recordedAt') ?? event.at });
        break;
      }

      case 'relation.removed': {
        const relation = oneOf<RelationKind>(p, 'relation', RELATION_KINDS);
        const from = entityId(p, 'from');
        const to = entityId(p, 'to');
        if (relation === null || from === null || to === null) break;
        relations.delete(relationKey(relation, from, to));
        break;
      }

      case 'artifact.pinned': {
        const owner = entityId(p, 'owner');
        const artifactKind = str(p, 'artifactKind');
        const location = oneOf<'repo' | 'disk'>(p, 'location', ['repo', 'disk']);
        const path = str(p, 'path');
        if (owner === null || artifactKind === null || location === null || path === null) break;
        artifacts.set(`${entityKey(owner)}|${artifactKind}|${path}`, {
          owner,
          artifactKind,
          location,
          repo: str(p, 'repo'),
          path,
          recordedAt: str(p, 'recordedAt') ?? event.at,
        });
        break;
      }

      case 'verification.updated': {
        const subject = entityId(p, 'subject');
        const verificationKind = oneOf<VerificationKind>(p, 'verificationKind', VERIFICATION_KINDS);
        const state = oneOf<VerificationState>(p, 'state', VERIFICATION_STATES);
        if (subject === null || verificationKind === null || state === null) break;
        const ref = str(p, 'ref');
        verifications.set(`${entityKey(subject)}|${verificationKind}|${ref ?? ''}`, {
          subject,
          verificationKind,
          state,
          ref,
          recordedAt: str(p, 'recordedAt') ?? event.at,
        });
        break;
      }

      case 'phase.started': {
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        if (subject === null || phase === null) break;
        const key = `${entityKey(subject)}|${phase}`;
        const current = phases.get(key);
        phases.set(key, {
          subject,
          phase,
          startedAt: str(p, 'at') ?? event.at,
          completedAt: current?.completedAt ?? null,
          outcome: current?.outcome ?? null,
          summary: current?.summary ?? null,
          // Recomecar a fase limpa a falha anterior: o card mostra o estado de
          // AGORA, e o historico continua no log.
          failure: null,
          lastRunId: str(p, 'runId') ?? current?.lastRunId ?? null,
        });
        break;
      }

      case 'phase.completed': {
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        const outcome = oneOf<PhaseOutcome>(p, 'outcome', PHASE_OUTCOMES);
        if (subject === null || phase === null || outcome === null) break;
        const key = `${entityKey(subject)}|${phase}`;
        const current = phases.get(key);
        phases.set(key, {
          subject,
          phase,
          startedAt: current?.startedAt ?? null,
          completedAt: str(p, 'at') ?? event.at,
          outcome,
          summary: str(p, 'summary'),
          failure: null,
          lastRunId: str(p, 'runId') ?? current?.lastRunId ?? null,
        });
        break;
      }

      case 'phase.failed': {
        // Um run que terminou mal e FATO — sem este registro, "falhou" ficaria
        // indistinguivel de "nunca rodou", que e a inverdade que a spec extingue.
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        if (subject === null || phase === null) break;
        const rawFailure = p.failure;
        const failure = isPlainObject(rawFailure)
          ? { code: str(rawFailure, 'code') ?? 'unknown', message: str(rawFailure, 'message') ?? '' }
          : null;
        const key = `${entityKey(subject)}|${phase}`;
        const current = phases.get(key);
        phases.set(key, {
          subject,
          phase,
          startedAt: current?.startedAt ?? null,
          // Falhar NAO conclui a fase: `completedAt` continua nulo, e e por isso
          // que a macro etapa nao avanca por causa de um run ruim.
          completedAt: current?.completedAt ?? null,
          outcome: current?.outcome ?? null,
          summary: current?.summary ?? null,
          failure,
          lastRunId: str(p, 'runId') ?? current?.lastRunId ?? null,
        });
        break;
      }

      case 'session.started': {
        const id = str(p, 'id');
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        if (id === null || subject === null || phase === null) break;
        sessions.set(id, {
          id,
          cliSessionId: str(p, 'cliSessionId'),
          subject,
          phase,
          continuesSessionId: str(p, 'continuesSessionId'),
          handoffReason: str(p, 'handoffReason'),
          cwd: str(p, 'cwd'),
          model: str(p, 'model'),
          effort: str(p, 'effort'),
          startedAt: str(p, 'startedAt') ?? event.at,
          endedAt: null,
          inputPath: str(p, 'inputPath'),
          resultPath: str(p, 'resultPath'),
          // Nasce NAO assumida: o app preparou, ninguem pegou ainda.
          claimed: str(p, 'cliSessionId') !== null,
        });
        break;
      }

      case 'session.ended':
      case 'session.handed-off': {
        const id = str(p, 'id');
        if (id === null) break;
        const current = sessions.get(id);
        if (current === undefined) break;
        sessions.set(id, {
          ...current,
          endedAt: str(p, 'at') ?? event.at,
          // O motivo do handoff fica na sessao que ENCERRA e na que continua —
          // a cadeia da fase precisa ser legivel dos dois lados.
          handoffReason: event.type === 'session.handed-off' ? (str(p, 'reason') ?? current.handoffReason) : current.handoffReason,
        });
        break;
      }

      case 'lock.acquired': {
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        const acquiredAt = str(p, 'acquiredAt') ?? event.at;
        if (subject === null || phase === null) break;
        locks.set(`${entityKey(subject)}|${phase}`, {
          subject,
          phase,
          holderKind: oneOf<'skill' | 'app'>(p, 'holderKind', ['skill', 'app']) ?? 'app',
          acquiredAt,
          cliSessionId: str(p, 'cliSessionId'),
          mirroredLabel: str(p, 'mirroredLabel'),
        });
        break;
      }

      case 'lock.released': {
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        if (subject === null || phase === null) break;
        locks.delete(`${entityKey(subject)}|${phase}`);
        break;
      }

      case 'stage.overridden': {
        const discoveryId = str(p, 'discoveryId');
        const value = oneOf<MacroStage>(p, 'value', MACRO_STAGES);
        const by = str(p, 'by');
        if (discoveryId === null || value === null || by === null) break;
        const current = discoveries.get(discoveryId);
        if (current === undefined) break;
        current.stageOverride = { value, by, at: str(p, 'at') ?? event.at, reason: str(p, 'reason') };
        break;
      }

      case 'stage.override.cleared': {
        const discoveryId = str(p, 'discoveryId');
        if (discoveryId === null) break;
        const current = discoveries.get(discoveryId);
        if (current !== undefined) current.stageOverride = null;
        break;
      }

      case 'note.added': {
        const subject = entityId(p, 'subject');
        const text = str(p, 'text');
        if (subject === null || text === null) break;
        notes.push({ subject, text, at: str(p, 'at') ?? event.at });
        break;
      }

      case 'ingest.failed': {
        const resultPath = str(p, 'resultPath');
        if (resultPath === null) break;
        const rawIssues = Array.isArray(p.issues) ? p.issues : [];
        ingestErrors.push({
          resultPath,
          at: str(p, 'at') ?? event.at,
          subject: entityId(p, 'subject'),
          issues: rawIssues
            .filter(isPlainObject)
            .map((issue) => ({ code: str(issue, 'code') ?? 'unknown', path: str(issue, 'path') ?? '', message: str(issue, 'message') ?? '' })),
        });
        break;
      }

      case 'mirror.queued': {
        const subject = entityId(p, 'subject');
        const operation = str(p, 'operation');
        if (subject === null || operation === null) break;
        const key = `${entityKey(subject)}|${operation}`;
        if (!mirrorQueue.has(key)) {
          mirrorQueue.set(key, { subject, operation, queuedAt: str(p, 'queuedAt') ?? event.at, attempts: 0, lastError: null });
        }
        break;
      }

      case 'mirror.failed': {
        const subject = entityId(p, 'subject');
        const operation = str(p, 'operation');
        if (subject === null || operation === null) break;
        const key = `${entityKey(subject)}|${operation}`;
        const current = mirrorQueue.get(key) ?? { subject, operation, queuedAt: event.at, attempts: 0, lastError: null };
        mirrorQueue.set(key, { ...current, attempts: current.attempts + 1, lastError: str(p, 'error') });
        break;
      }

      case 'mirror.synced': {
        const subject = entityId(p, 'subject');
        const operation = str(p, 'operation');
        if (subject === null || operation === null) break;
        mirrorQueue.delete(`${entityKey(subject)}|${operation}`);
        break;
      }

      default:
        // Tipo desconhecido: ignorado na derivacao, JAMAIS apagado do log. O
        // envelope e legivel por um canal que nao conhece o payload — foi para
        // isso que ele foi desenhado.
        break;
    }
  }

  const planList = [...plans.values()];
  const itemList = [...workItems.values()];
  const errorList = ingestErrors;
  const mirrorList = [...mirrorQueue.values()];
  const phaseList = [...phases.values()];

  const discoveryList: DiscoverySnapshot[] = [...discoveries.values()].map((discovery) => {
    const ownPlans = planList.filter((plan) => plan.discoveryId === discovery.id);
    const ownItems = itemList.filter((item) => item.discoveryId === discovery.id);
    const discoveryPhase = phaseList.find(
      (phase) => phase.phase === DISCOVERY_PHASE_NAME && phase.subject.entity === 'discovery' && phase.subject.id === discovery.id,
    );

    const derived = deriveStage({
      discoveryConcluded: discoveryPhase?.completedAt != null,
      discoveryOutcome: discoveryPhase?.outcome ?? null,
      planCount: ownPlans.length,
      items: ownItems.map((item) => ({ state: item.state, everConcluded: item.everConcluded })),
    });

    const signals: StageSignal[] = [...derived.signals];
    if (ownItems.some((item) => item.planId === null)) signals.push('orphan-item');
    if (errorList.some((error) => error.subject?.entity === 'discovery' && error.subject.id === discovery.id)) signals.push('ingest-error');
    if (mirrorList.some((entry) => entry.subject.entity === 'discovery' && entry.subject.id === discovery.id)) signals.push('mirror-pending');

    return {
      id: discovery.id,
      title: discovery.title,
      problem: discovery.problem,
      tracker: discovery.tracker,
      targetRepo: discovery.targetRepo,
      scopeRepos: discovery.scopeRepos,
      createdAt: discovery.createdAt,
      derivedStage: derived.stage,
      stageSignals: signals,
      stageOverride: discovery.stageOverride,
    };
  });

  return {
    kind: 'esteira.store.snapshot',
    schema_version: STORE_SCHEMA_VERSION,
    through_seq: throughSeq,
    built_at: options.builtAt ?? new Date().toISOString(),
    discoveries: discoveryList,
    plans: planList,
    workItems: itemList.map(({ everConcluded: _everConcluded, ...item }) => ({
      ...item,
      lifecycle: LIFECYCLE_BY_ITEM_TYPE[item.itemType],
    })) satisfies WorkItemSnapshot[],
    sessions: [...sessions.values()] satisfies SessionSnapshot[],
    relations: [...relations.values()],
    artifacts: [...artifacts.values()],
    locks: [...locks.values()],
    phases: phaseList,
    verifications: [...verifications.values()],
    notes,
    ingestErrors: errorList,
    mirrorQueue: mirrorList.map(({ subject, operation, queuedAt, attempts, lastError }) => ({
      subject,
      operation,
      queuedAt,
      attempts,
      lastError,
    })) satisfies MirrorQueueEntry[],
  };
}

/** Snapshot vazio — o que o app mostra antes de qualquer evento existir. */
export function emptySnapshot(builtAt?: string): StoreSnapshot {
  return reduceEvents([], { builtAt });
}
