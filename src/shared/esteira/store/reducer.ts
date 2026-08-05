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
  MACRO_STAGES,
  STORE_SCHEMA_VERSION,
  WORK_ITEM_STATES,
  type ArtifactPointer,
  type DeclaredFactSummary,
  type DiscardedItemTombstone,
  type DiscoverySnapshot,
  type EntityId,
  type DecisionSnapshot,
  type EntityKind,
  type GateConfirmationSnapshot,
  type HumanReviewItem,
  type HumanReviewKind,
  type HumanReviewSnapshot,
  type HumanReviewState,
  type IngestAmnesty,
  type IngestedRunSnapshot,
  type IngestErrorSnapshot,
  type IngestRecovery,
  type LockRecord,
  type LockResource,
  type MacroStage,
  type MirrorQueueEntry,
  type MirrorSyncedEntry,
  type NoteSnapshot,
  type PhaseOutcome,
  type PhaseRisk,
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

/**
 * O nome da fase que FECHA o ciclo de um item. Mesma razao da constante acima:
 * `run.phase` e string livre por `[P-4]`, mas o contrato ja da semantica a este
 * nome (`x-required-facts` cobra `verification.recorded` com `state: passed`
 * quando ela sai com `outcome: done`). Quando P-4 fechar, muda aqui e so aqui.
 */
export const CONCLUDING_PHASE_NAME = 'concluir';

/**
 * O estado de um item depois de uma fase que o tomou por assunto — `[D-13]`
 * aplicado ao item: estado calculado do grafo, nunca digitado.
 *
 * Achado do roteiro `ciclo-completo-de-item` (04/08/2026): o card mostrava seis
 * fases concluidas e "PR mergeado e verificado" com o item "aberto" e a etapa
 * "Planejado". `open` nao era afirmacao de ninguem — era default de nascimento
 * inventado na ingestao, e nada o movia depois.
 *
 * Regras, na ordem em que sao escritas (a ordem E a precedencia):
 *
 * - `concluir` com desfecho `done`/`abandoned` fecha o item. `inconclusive` NAO
 *   fecha: desfecho ruim e um desfecho, desfecho falso e uma mentira.
 * - Qualquer outra fase assumida, concluida ou falha deixa o item `in-progress`.
 *   Falhar nao e "nao ter comecado".
 *
 * O que NAO chama esta funcao, de proposito: o DISPARO. O app grava
 * `phase.started` ao apenas preparar a fase (o mesmo fato torto que obrigou
 * `phaseLine` a receber um `claimed`), e preparar nao e comecar — "Preparada —
 * ninguem assumiu ainda" e justamente a distincao que a spec 010 existe para
 * fazer. Quem move o item e a sessao ASSUMIDA, que e o fato honesto sobre haver
 * alguem trabalhando. O primeiro roteiro deste batch fotografou as duas frases
 * juntas: "ninguem assumiu ainda" em cima, item "em curso" logo abaixo.
 */
export function workItemStateAfterPhase(phase: string, outcome: PhaseOutcome | null): WorkItemState {
  if (phase === CONCLUDING_PHASE_NAME) {
    if (outcome === 'done') return 'done';
    if (outcome === 'abandoned') return 'abandoned';
  }
  return 'in-progress';
}

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

  // A ordem aqui e a precedencia, e ela mudou depois do print 12 da captura
  // `gestos-do-card`: com um item concluido e outro aberto, a tela dizia
  // "Planejado" — trabalho ja fechado apresentado como trabalho que nunca
  // comecou. Pior, a etapa dependia de QUAL item estava aberto: o mesmo
  // conjunto (um aberto, um fechado) dava "Planejado" num print e "Execucao"
  // no outro, enquanto os dois se diziam "calculada dos fatos".
  const allConcluded = input.items.length > 0 && input.items.every((item) => item.state === 'done' || item.state === 'abandoned');
  if (allConcluded) return { stage: 'done', signals: [] };

  // Execucao e o estado de "comecou e nao terminou". Um item que JA se concluiu
  // alguma vez (`everConcluded`) e prova de que comecou — reaberto ou nao. E o
  // mesmo sinal que ja fazia a etapa RETROCEDER; ele so estava restrito ao item
  // reaberto, quando vale para qualquer item que ja teve desfecho.
  const running = input.items.some((item) => item.state === 'in-progress');
  const everStarted = input.items.some((item) => item.everConcluded);
  if (running || everStarted) return { stage: 'execution', signals: [] };

  // Planejado sobra para o que ele sempre quis dizer: existe plano e nenhum
  // item foi tocado por ninguem.
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

/** Sub-objeto opaco do payload (o conteudo de uma operacao de espelho). Ilegivel = vazio, nunca fatal. */
function payloadOf(node: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = node[key];
  return isPlainObject(value) ? value : {};
}

function oneOf<T extends string>(node: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  const value = node[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const ENTITY_KINDS: readonly EntityKind[] = ['discovery', 'plan', 'work_item'];

/** A5 — le `declaredFacts` do payload de `ingest.failed`. Entrada ilegivel e OMITIDA, nunca inventada. */
function declaredFactList(node: Record<string, unknown>, key: string): readonly DeclaredFactSummary[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DeclaredFactSummary[] => {
    if (!isPlainObject(entry)) return [];
    const factType = str(entry, 'factType');
    if (factType === null) return [];
    return [{ factType, entity: oneOf<EntityKind>(entry, 'entity', ENTITY_KINDS), id: str(entry, 'id'), title: str(entry, 'title') }];
  });
}

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

/** A8/A20 — le `LockResource` de um payload. `targetRepo` ausente = sem recurso (fase sem workspace). */
function lockResource(node: Record<string, unknown>, key: string): LockResource | null {
  const raw = node[key];
  if (!isPlainObject(raw)) return null;
  const targetRepo = str(raw, 'targetRepo');
  if (targetRepo === null) return null;
  return { targetRepo, branch: str(raw, 'branch'), treePath: str(raw, 'treePath') };
}

function entityKey(id: EntityId): string {
  return `${id.entity}:${id.id}`;
}

function relationKey(relation: string, from: EntityId, to: EntityId): string {
  return `${relation}|${entityKey(from)}|${entityKey(to)}`;
}

const HUMAN_REVIEW_KINDS: readonly HumanReviewKind[] = ['review', 'action'];
const HUMAN_REVIEW_STATES: readonly HumanReviewState[] = ['pending', 'done', 'waived'];
const WORK_ITEM_TYPES: readonly WorkItemType[] = ['issue', 'spec', 'process-map', 'adr', 'prototype', 'spike', 'eval'];
const RELATION_KINDS: readonly RelationKind[] = ['originated', 'flows_into', 'ships_with'];
const PHASE_OUTCOMES: readonly PhaseOutcome[] = ['done', 'abandoned', 'inconclusive'];
const VERIFICATION_KINDS: readonly VerificationKind[] = ['pull-request', 'check', 'review', 'conclusion', 'e2e-manual'];
const PHASE_RISKS: readonly PhaseRisk[] = ['trivial', 'sensivel'];
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
  seeded: boolean;
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
  seeded: boolean;
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
  modelEffortAssumed: boolean;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  inputPath: string | null;
  resultPath: string | null;
  claimed: boolean;
}

/**
 * A6 — o status ATUAL de um `resultPath`: a ultima palavra sobre ele, no
 * sentido do log. Um mesmo path so aparece numa das duas listas de saida
 * (`ingestErrors` OU `ingestRecoveries`) — nunca nas duas, porque a recuperacao
 * nao apaga o `ingest.failed` do LOG, so para de mostra-lo como pendente.
 */
type IngestPathStatus =
  | { readonly kind: 'failed'; readonly error: IngestErrorSnapshot }
  | { readonly kind: 'recovered'; readonly recovery: IngestRecovery }
  // F26 — o path foi ANISTIADO: nao entra em `ingestErrors` nem em
  // `ingestRecoveries` (ele nunca chegou a ser um `ingest.failed` gravado
  // nesta passada — ou, se foi, a anistia e a palavra mais recente sobre ele).
  | { readonly kind: 'amnestied'; readonly amnesty: IngestAmnesty };

interface MutableMirror {
  subject: EntityId;
  operation: string;
  payload: Record<string, unknown>;
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
  const gates = new Map<string, GateConfirmationSnapshot>();
  const decisions = new Map<string, DecisionSnapshot>();
  const humanReviews = new Map<string, HumanReviewSnapshot>();
  const notes: NoteSnapshot[] = [];
  const runs = new Map<string, IngestedRunSnapshot>();
  /** A6 — chave e `resultPath`: o ULTIMO evento sobre aquele arquivo decide o status de agora. */
  const ingestStatusByPath = new Map<string, IngestPathStatus>();
  const mirrorQueue = new Map<string, MutableMirror>();
  const mirrorSynced = new Map<string, MirrorSyncedEntry>();
  /** E2 — a lapide de cada item descartado, por id. */
  const tombstones = new Map<string, DiscardedItemTombstone>();
  /** F26 — todo `run_id` que ja passou pela ingestao, mesmo sem `run.ingested`. */
  const knownIngestRunIds = new Set<string>();

  const seenDedupeKeys = new Set<string>();
  let throughSeq = 0;

  /**
   * O estado do item acompanha a fase que o tomou por assunto. Fica aqui, num
   * lugar so, porque tres eventos diferentes (`phase.started`, `phase.completed`,
   * `phase.failed`) contam a mesma historia — e a palavra tem que nascer uma vez.
   */
  function moveItemByPhase(subject: EntityId, phase: string, outcome: PhaseOutcome | null): void {
    if (subject.entity !== 'work_item') return;
    const item = workItems.get(subject.id);
    if (item === undefined) return;
    const state = workItemStateAfterPhase(phase, outcome);
    workItems.set(subject.id, {
      ...item,
      state,
      everConcluded: item.everConcluded || state === 'done' || state === 'abandoned',
    });
  }

  for (const event of events) {
    if (event.seq > throughSeq) throughSeq = event.seq;

    // F26 — o `run_id` conta como CONHECIDO pelo simples fato de ter passado
    // pela ingestao, mesmo que o evento em si seja um duplicado descartado a
    // seguir (dedupe) ou um fato de um tempo em que `run.ingested` nao
    // existia ainda: e exatamente essa segunda situacao que os 10 runs
    // pre-ledger do incidente de 05/08 estao em.
    if (event.source.kind === 'ingest') knownIngestRunIds.add(event.source.run_id);

    // Dois eventos com a mesma chave natural sao o MESMO fato: o segundo e
    // descartado na leitura. E dai que vem a idempotencia da ingestao.
    if (event.dedupe_key !== null) {
      if (seenDedupeKeys.has(event.dedupe_key)) continue;
      seenDedupeKeys.add(event.dedupe_key);
    }

    const p = event.payload;
    // D-2 — a proveniencia do FATO. Entidade guarda a do nascimento (origem);
    // fase guarda a do ultimo fato (estado de agora). As duas regras estao
    // explicadas em `SeededFlag`, no formato.
    const fromSeed = event.source.kind === 'seed';

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
          // Marca de ORIGEM: quem nasceu de uma afirmacao continua tendo
          // nascido dela, mesmo depois de a skill declarar fatos por cima.
          seeded: current?.seeded ?? fromSeed,
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
          seeded: plans.get(id)?.seeded ?? fromSeed,
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
          seeded: current?.seeded ?? fromSeed,
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
        if (id === null) break;
        // E2 — a LAPIDE nasce do item COMO ELE ERA no instante do descarte,
        // antes de sair do mapa. Sem o item (fantasma, ja descartado antes) nao
        // ha o que gravar: uma lapide sem conteudo nao responde pergunta nenhuma.
        const item = workItems.get(id);
        if (item !== undefined) {
          tombstones.set(id, {
            id: item.id,
            discoveryId: item.discoveryId,
            title: item.title,
            itemType: item.itemType,
            discardedAt: str(p, 'at') ?? event.at,
            reason: str(p, 'reason'),
          });
        }
        workItems.delete(id);
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
          // A15 — a base do PR faz parte do desfecho num repo com escada de
          // canais: "concluido" sem destino se le como "esta na main".
          base: str(p, 'base'),
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
          channel: current?.channel ?? null,
          risk: current?.risk ?? null,
          seeded: fromSeed,
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
          // A15 — o canal so muda quando a fase declara um: nao se herda o
          // destino de uma entrega anterior nem se inventa um.
          channel: str(p, 'channel') ?? current?.channel ?? null,
          // A16 — o risco so muda quando a fase declara um: nao se herda a
          // regua de uma passagem anterior nem se classifica por ela.
          risk: oneOf<PhaseRisk>(p, 'risk', PHASE_RISKS) ?? current?.risk ?? null,
          // A fase e estado de AGORA: quem afirmou o ultimo desfecho define a
          // marca. Fase semeada e depois de fato executada vira observada.
          seeded: fromSeed,
        });
        // O item acompanha o que aconteceu com ele: sem isto, o card mostraria
        // seis fases concluidas e um item "aberto" — a mentira que o roteiro
        // `ciclo-completo-de-item` fotografou.
        moveItemByPhase(subject, phase, outcome);
        // A fase acabou: a trava dela cai junto. A skill DEVE declarar
        // `lock.released` (o corpus faz), mas depender só disso deixaria o card
        // preso para sempre quando ela morre no meio — a trava orfa que D-V3
        // combatia, reaparecendo por omissao em vez de por arquivo.
        locks.delete(key);
        // A sessao daquela fase tambem se encerra: fase concluida com sessao
        // aberta e o mesmo estado pendurado, com outro nome.
        for (const [sessionId, session] of sessions) {
          if (session.endedAt !== null) continue;
          if (session.phase !== phase) continue;
          if (session.subject.entity !== subject.entity || session.subject.id !== subject.id) continue;
          sessions.set(sessionId, { ...session, endedAt: str(p, 'at') ?? event.at });
        }
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
          channel: current?.channel ?? null,
          risk: current?.risk ?? null,
          seeded: fromSeed,
        });
        // Falhar nao e "nao ter comecado": o item continua em curso, e a falha
        // fica visivel na fase.
        moveItemByPhase(subject, phase, null);
        // Mesma regra do `phase.completed`: o run acabou (mal), a trava cai. O
        // card volta a aceitar disparo — e a falha continua visivel na fase.
        locks.delete(key);
        for (const [sessionId, session] of sessions) {
          if (session.endedAt !== null) continue;
          if (session.phase !== phase) continue;
          if (session.subject.entity !== subject.entity || session.subject.id !== subject.id) continue;
          sessions.set(sessionId, { ...session, endedAt: str(p, 'at') ?? event.at });
        }
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
          modelEffortAssumed: bool(p, 'modelEffortAssumed'),
          startedAt: str(p, 'startedAt') ?? event.at,
          endedAt: null,
          endReason: null,
          inputPath: str(p, 'inputPath'),
          resultPath: str(p, 'resultPath'),
          // Nasce NAO assumida: o app preparou, ninguem pegou ainda.
          claimed: str(p, 'cliSessionId') !== null,
        });
        // Sessao ASSUMIDA e o fato honesto de que alguem esta trabalhando no
        // item — e o unico que o move para "em curso" antes de a fase terminar.
        if (str(p, 'cliSessionId') !== null) moveItemByPhase(subject, phase, null);
        break;
      }

      case 'session.claimed': {
        // Batch B1 — a aba abriu e o CLI devolveu o id da sessao. E o unico
        // fato que separa "preparada" de "em andamento": ate ele chegar, o app
        // so tinha deixado um arquivo em disco.
        const id = str(p, 'id');
        const cliSessionId = str(p, 'cliSessionId');
        if (id === null || cliSessionId === null) break;
        const current = sessions.get(id);
        if (current === undefined) break;
        sessions.set(id, { ...current, cliSessionId, claimed: true });
        // A trava daquela fase passa a ter DONO com nome (D-11: dono, hora e
        // sessao). So a fase DESTA sessao — trava de fase irma nao herda dono.
        const lockKey = `${entityKey(current.subject)}|${current.phase}`;
        const lock = locks.get(lockKey);
        if (lock !== undefined) locks.set(lockKey, { ...lock, cliSessionId });
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
          // A7 — por que ESTA sessao terminou (nao a de handoff, que tem
          // sucessora e conta outra historia). `null` quando ninguem declarou.
          endReason: event.type === 'session.ended' ? str(p, 'reason') : current.endReason,
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
          resource: lockResource(p, 'resource'),
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

      case 'gate.confirmed': {
        // A9 — uma condicao por registro. Reconfirmar a MESMA condicao atualiza
        // quem confirmou; nao empilha, porque duas confirmacoes da mesma coisa
        // sao a mesma coisa confirmada.
        const subject = entityId(p, 'subject');
        const condition = str(p, 'condition');
        const confirmedBy = str(p, 'confirmedBy');
        if (subject === null || condition === null || confirmedBy === null) break;
        gates.set(`${entityKey(subject)}|${condition}`, {
          subject,
          condition,
          confirmedBy,
          confirmedAt: str(p, 'confirmedAt') ?? event.at,
        });
        break;
      }

      case 'decision.recorded': {
        // A18 — uma decisao por registro. Redecidir a MESMA coisa atualiza quem
        // confirmou e por que; decidir outra coisa e outra linha, porque uma
        // fase de conversa toma varias decisoes.
        const subject = entityId(p, 'subject');
        const decision = str(p, 'decision');
        const confirmedBy = str(p, 'confirmedBy');
        if (subject === null || decision === null || confirmedBy === null) break;
        decisions.set(`${entityKey(subject)}|${decision}`, {
          subject,
          decision,
          confirmedBy,
          rationale: str(p, 'rationale'),
          at: str(p, 'at') ?? event.at,
        });
        break;
      }

      case 'human_review.recorded': {
        // A10 — a lista e o estado de AGORA: redeclarar SUBSTITUI. Mesclar
        // deixaria conviver uma revisao respondida pela metade com a versao
        // anterior inteira, e a tela mostraria as duas como se fossem uma.
        const subject = entityId(p, 'subject');
        const phase = str(p, 'phase');
        const rawChecklist = Array.isArray(p.checklist) ? p.checklist : [];
        if (subject === null || phase === null) break;
        const checklist = rawChecklist.filter(isPlainObject).flatMap((entry): HumanReviewItem[] => {
          const item = str(entry, 'item');
          const kind = oneOf<HumanReviewKind>(entry, 'kind', HUMAN_REVIEW_KINDS);
          const state = oneOf<HumanReviewState>(entry, 'state', HUMAN_REVIEW_STATES);
          if (item === null || kind === null || state === null) return [];
          return [{ item, kind, state, detail: str(entry, 'detail') }];
        });
        if (checklist.length === 0) break;
        humanReviews.set(`${entityKey(subject)}|${phase}`, { subject, phase, checklist, at: str(p, 'at') ?? event.at });
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

      case 'run.ingested': {
        // A4 — o livro dos runs. Chave e o `run_id`: um run e um so, e e por
        // ele que a ingestao pergunta "isto ja entrou, e com que conteudo?".
        const runId = str(p, 'runId');
        const contentHash = str(p, 'contentHash');
        if (runId === null || contentHash === null) break;
        runs.set(runId, {
          runId,
          phase: str(p, 'phase') ?? '',
          kind: str(p, 'kind') ?? 'esteira.result',
          contentHash,
          complementsRunId: str(p, 'complementsRunId'),
          revisesRunId: str(p, 'revisesRunId'),
          subject: entityId(p, 'subject'),
          resultPath: str(p, 'resultPath'),
          at: str(p, 'at') ?? event.at,
        });
        break;
      }

      case 'ingest.failed': {
        const resultPath = str(p, 'resultPath');
        if (resultPath === null) break;
        const rawIssues = Array.isArray(p.issues) ? p.issues : [];
        ingestStatusByPath.set(resultPath, {
          kind: 'failed',
          error: {
            resultPath,
            at: str(p, 'at') ?? event.at,
            subject: entityId(p, 'subject'),
            issues: rawIssues
              .filter(isPlainObject)
              .map((issue) => ({ code: str(issue, 'code') ?? 'unknown', path: str(issue, 'path') ?? '', message: str(issue, 'message') ?? '' })),
            // A5 — o custo: o que o documento declararia, se entrasse.
            declaredFacts: declaredFactList(p, 'declaredFacts'),
          },
        });
        break;
      }

      case 'ingest.recovered': {
        // A6 — o MESMO path que falhou passou a ser legivel. Isto NAO apaga o
        // `ingest.failed` do log (ele continua la, evento anterior); so troca o
        // status DE AGORA daquele path — e e por isso que a chave e o path, nao
        // um id novo: recuperar e suceder, nao e um fato solto.
        const resultPath = str(p, 'resultPath');
        if (resultPath === null) break;
        ingestStatusByPath.set(resultPath, {
          kind: 'recovered',
          recovery: {
            resultPath,
            at: str(p, 'at') ?? event.at,
            runId: str(p, 'runId'),
            subject: entityId(p, 'subject'),
            recoveredCodes: strList(p, 'recoveredCodes'),
            how: str(p, 'how') ?? '',
          },
        });
        break;
      }

      case 'ingest.amnestied': {
        // F26 — este path nao aparece como erro, sob nenhuma hipotese: o
        // `run_id` ja consta no livro, ingerido por um contrato mais antigo.
        // Chave e o path, igual `ingest.failed`/`ingest.recovered`: o ULTIMO
        // evento sobre aquele arquivo decide o status de agora.
        const resultPath = str(p, 'resultPath');
        // F26 — `runId` pode ser `null`: a anistia por CORTE DE DATA nao exige
        // um `run_id` legivel, so um timestamp anterior ao corte. Ver
        // `IngestAmnesty.runId`.
        if (resultPath === null) break;
        const rawIssues = Array.isArray(p.issues) ? p.issues : [];
        ingestStatusByPath.set(resultPath, {
          kind: 'amnestied',
          amnesty: {
            resultPath,
            at: str(p, 'at') ?? event.at,
            runId: str(p, 'runId'),
            subject: entityId(p, 'subject'),
            issues: rawIssues
              .filter(isPlainObject)
              .map((issue) => ({ code: str(issue, 'code') ?? 'unknown', path: str(issue, 'path') ?? '', message: str(issue, 'message') ?? '' })),
          },
        });
        break;
      }

      case 'mirror.queued': {
        const subject = entityId(p, 'subject');
        const operation = str(p, 'operation');
        if (subject === null || operation === null) break;
        const key = `${entityKey(subject)}|${operation}`;
        const current = mirrorQueue.get(key);
        // Re-enfileirar a MESMA operacao atualiza o conteudo e preserva a
        // contagem: a fila guarda a intencao de AGORA (reenviar a coluna velha
        // seria espelhar um passado que ja nao existe), e zerar `attempts` a
        // cada gesto faria o teto de tentativas nunca chegar.
        mirrorQueue.set(key, {
          subject,
          operation,
          payload: payloadOf(p, 'payload'),
          queuedAt: current?.queuedAt ?? str(p, 'queuedAt') ?? event.at,
          attempts: current?.attempts ?? 0,
          lastError: current?.lastError ?? null,
        });
        break;
      }

      case 'mirror.failed': {
        const subject = entityId(p, 'subject');
        const operation = str(p, 'operation');
        if (subject === null || operation === null) break;
        const key = `${entityKey(subject)}|${operation}`;
        const current = mirrorQueue.get(key) ?? {
          subject,
          operation,
          payload: payloadOf(p, 'payload'),
          queuedAt: event.at,
          attempts: 0,
          lastError: null,
        };
        mirrorQueue.set(key, { ...current, attempts: current.attempts + 1, lastError: str(p, 'error') });
        break;
      }

      case 'mirror.synced': {
        const subject = entityId(p, 'subject');
        const operation = str(p, 'operation');
        if (subject === null || operation === null) break;
        const key = `${entityKey(subject)}|${operation}`;
        const queued = mirrorQueue.get(key);
        mirrorQueue.delete(key);
        // O que o board passou a refletir. Sem este registro, a proxima
        // varredura de intencoes reenfileiraria a mesma etiqueta para sempre.
        mirrorSynced.set(key, {
          subject,
          operation,
          payload: 'payload' in p ? payloadOf(p, 'payload') : (queued?.payload ?? {}),
          at: str(p, 'at') ?? event.at,
        });
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
  // A6 — so o status DE AGORA de cada path: um path recuperado saiu da lista de
  // erros e entrou na de recuperacoes, sem que o `ingest.failed` original tenha
  // sido apagado do log (ele so nao aparece mais aqui).
  const statusList = [...ingestStatusByPath.values()];
  const errorList = statusList.filter((entry): entry is Extract<IngestPathStatus, { kind: 'failed' }> => entry.kind === 'failed').map((entry) => entry.error);
  const recoveryList = statusList
    .filter((entry): entry is Extract<IngestPathStatus, { kind: 'recovered' }> => entry.kind === 'recovered')
    .map((entry) => entry.recovery);
  const amnestyList = statusList
    .filter((entry): entry is Extract<IngestPathStatus, { kind: 'amnestied' }> => entry.kind === 'amnestied')
    .map((entry) => entry.amnesty);
  const mirrorList = [...mirrorQueue.values()];
  const phaseList = [...phases.values()];
  const tombstoneList = [...tombstones.values()];

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

    // O erro de ingestao pode estar ancorado em QUALQUER entidade do card: com
    // as fases de item (implementar, validar, documentar, concluir), a maioria
    // dos documentos recusados vem ancorada num work item. Olhar so o discovery
    // deixaria o card limpo na lista enquanto um `result.json` foi recusado —
    // o silencio que a spec inteira existe para acabar.
    //
    // E2 — o item DESCARTADO continua contando: um erro ou espelho pendente
    // ancorado nele nao vira orfao so porque o item saiu de `workItems`.
    const ownTombstones = tombstoneList.filter((tombstone) => tombstone.discoveryId === discovery.id);
    const owned = new Set<string>([
      `discovery:${discovery.id}`,
      ...ownPlans.map((plan) => `plan:${plan.id}`),
      ...ownItems.map((item) => `work_item:${item.id}`),
      ...ownTombstones.map((tombstone) => `work_item:${tombstone.id}`),
    ]);

    const signals: StageSignal[] = [...derived.signals];
    if (ownItems.some((item) => item.planId === null)) signals.push('orphan-item');
    if (errorList.some((error) => error.subject !== null && owned.has(`${error.subject.entity}:${error.subject.id}`))) {
      signals.push('ingest-error');
    }
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
      seeded: discovery.seeded,
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
    gates: [...gates.values()],
    decisions: [...decisions.values()],
    humanReviews: [...humanReviews.values()],
    notes,
    runs: [...runs.values()],
    knownIngestRunIds,
    ingestErrors: errorList,
    ingestRecoveries: recoveryList,
    ingestAmnesties: amnestyList,
    mirrorQueue: mirrorList.map(({ subject, operation, payload, queuedAt, attempts, lastError }) => ({
      subject,
      operation,
      payload,
      queuedAt,
      attempts,
      lastError,
    })) satisfies MirrorQueueEntry[],
    mirrorSynced: [...mirrorSynced.values()],
    tombstones: tombstoneList,
  };
}

/** Snapshot vazio — o que o app mostra antes de qualquer evento existir. */
export function emptySnapshot(builtAt?: string): StoreSnapshot {
  return reduceEvents([], { builtAt });
}
