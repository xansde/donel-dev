// Spec 010 — vertical pequeno, passo 2: a fronteira IPC da esteira nova.
// Canais + shapes + validacao PURA (o main so muta depois de validar, mesmo
// padrao de `devMode.ts`).
//
// O que passa por aqui e SO o que o app ja tem no store: o renderer nunca le
// disco, nunca fala com a skill e nunca calcula macro etapa. A etapa vem
// derivada do main (D-13), e a tela e projecao — se o dado nao esta no
// snapshot, a tela nao o inventa.

import type { ContractIssue } from './contract/parsing';
import { MACRO_STAGES, WORK_ITEM_STATES } from './store/storeFormat';
import type { EntityId, LockRecord, MacroStage, StoreCompatibility, StoreSnapshot, WorkItemState } from './store/storeFormat';

export const ESTEIRA_CHANNELS = {
  /** Estado atual: snapshot derivado + de onde ele veio. */
  snapshot: 'esteira:snapshot',
  /** Varre o outbox agora (o boot e o watcher ja fazem isso sozinhos). */
  scanOutbox: 'esteira:scanOutbox',
  /** Gesto do app: nasce um discovery (o app gera o id). */
  createDiscovery: 'esteira:createDiscovery',
  /** Dispara uma fase: grava o `run-input.json`, trava e abre sessao. */
  dispatch: 'esteira:dispatch',
  /** Libera a trava — o "gesto" de D-11. */
  releaseLock: 'esteira:releaseLock',
  /** D-13 — forca a macro etapa a mao, ou volta ao calculo (`value: null`). */
  setStageOverride: 'esteira:setStageOverride',
  /** Abrir/comecar/concluir/abandonar um item — e o que move a macro etapa, inclusive PARA TRAS. */
  setWorkItemState: 'esteira:setWorkItemState',
  /** D-16 — descarta um item num gesto; o evento fica no log, a entidade sai do snapshot. */
  discardWorkItem: 'esteira:discardWorkItem',
  /** Nota amarrada ao card ou a um item. */
  addNote: 'esteira:addNote',
  /** main → renderer: o store mudou (ingestao, disparo, gesto de outro canal). */
  changed: 'esteira:changed',
} as const;

export interface EsteiraSnapshotDto {
  readonly snapshot: StoreSnapshot;
  /** `read-only`/`needs-migration`/`unreadable` = a tela mostra que NAO da para escrever, em vez de falhar calada. */
  readonly compatibility: StoreCompatibility;
  readonly storeDir: string;
  readonly inboxDir: string;
  readonly outboxDir: string;
  /** Quantos `result.json` do outbox foram recusados na ultima varredura. */
  readonly rejectedOnLastScan: number;
}

export interface CreateDiscoveryIpcInput {
  readonly title: string;
  readonly problem: string | null;
  /** D-6 — alvo default herdado pelos itens. `null` e legitimo: discovery investiga problema, nao repo. */
  readonly targetRepo: string | null;
  readonly scopeRepos: readonly string[];
  readonly tracker: { readonly provider: string; readonly cardId: string } | null;
}

export function isValidCreateDiscoveryIpcInput(input: unknown): input is CreateDiscoveryIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<CreateDiscoveryIpcInput>;
  if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) return false;
  if (candidate.problem !== null && candidate.problem !== undefined && typeof candidate.problem !== 'string') return false;
  if (candidate.targetRepo !== null && candidate.targetRepo !== undefined && typeof candidate.targetRepo !== 'string') return false;
  if (candidate.scopeRepos !== undefined && !Array.isArray(candidate.scopeRepos)) return false;
  if (candidate.scopeRepos?.some((repo) => typeof repo !== 'string' || repo.trim().length === 0)) return false;
  if (candidate.tracker !== null && candidate.tracker !== undefined) {
    const tracker = candidate.tracker as Partial<{ provider: string; cardId: string }>;
    if (typeof tracker.provider !== 'string' || typeof tracker.cardId !== 'string') return false;
  }
  return true;
}

export interface DispatchIpcInput {
  readonly phase: string;
  readonly discoveryId: string;
  readonly planId: string | null;
  readonly workItemId: string | null;
  /** Alvo EXPLICITO (D-6) — quem dispara diz o repo; o app nunca o deduz do projeto em foco. */
  readonly workspace: {
    readonly target_repo: string;
    readonly repo_path: string | null;
    readonly worktree_path: string | null;
    readonly branch: string | null;
  } | null;
  readonly continuesSessionId: string | null;
  readonly handoffReason: string | null;
}

export function isValidDispatchIpcInput(input: unknown): input is DispatchIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<DispatchIpcInput>;
  if (typeof candidate.phase !== 'string' || candidate.phase.trim().length === 0) return false;
  if (typeof candidate.discoveryId !== 'string' || candidate.discoveryId.trim().length === 0) return false;
  if (candidate.planId !== null && candidate.planId !== undefined && typeof candidate.planId !== 'string') return false;
  if (candidate.workItemId !== null && candidate.workItemId !== undefined && typeof candidate.workItemId !== 'string') return false;
  if (candidate.workspace !== null && candidate.workspace !== undefined) {
    const workspace = candidate.workspace as Partial<DispatchIpcInput['workspace']> & Record<string, unknown>;
    if (typeof workspace.target_repo !== 'string' || workspace.target_repo.trim().length === 0) return false;
  }
  return true;
}

export interface ReleaseLockIpcInput {
  readonly subject: EntityId;
  readonly phase: string;
}

export function isValidReleaseLockIpcInput(input: unknown): input is ReleaseLockIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<ReleaseLockIpcInput>;
  if (typeof candidate.phase !== 'string' || candidate.phase.trim().length === 0) return false;
  const subject = candidate.subject as Partial<EntityId> | undefined;
  if (typeof subject !== 'object' || subject === null) return false;
  if (subject.entity !== 'discovery' && subject.entity !== 'plan' && subject.entity !== 'work_item') return false;
  return typeof subject.id === 'string' && subject.id.trim().length > 0;
}

/**
 * D-13 — o ajuste manual da macro etapa. `value: null` e o gesto de LIMPAR: um
 * canal so para os dois lados do mesmo ajuste, porque "voltar ao calculado"
 * precisa ser tao barato quanto forcar — override caro de desfazer vira override
 * esquecido, e etapa esquecida e o "estado que mente" que a spec extingue.
 *
 * Quem ajustou (`by`) NAO vem do renderer: e o main que sabe em nome de quem o
 * app roda. Deixar a tela mandar o autor seria deixar o registro do ajuste ser
 * escrito por quem esta sendo registrado.
 */
export interface SetStageOverrideIpcInput {
  readonly discoveryId: string;
  readonly value: MacroStage | null;
  readonly reason: string | null;
}

export function isValidSetStageOverrideIpcInput(input: unknown): input is SetStageOverrideIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<SetStageOverrideIpcInput>;
  if (typeof candidate.discoveryId !== 'string' || candidate.discoveryId.trim().length === 0) return false;
  if (candidate.value !== null && candidate.value !== undefined && !MACRO_STAGES.includes(candidate.value)) return false;
  if (candidate.reason !== null && candidate.reason !== undefined && typeof candidate.reason !== 'string') return false;
  return true;
}

/** Abrir, comecar, concluir, abandonar — os quatro estados de D-4, um gesto cada. */
export interface SetWorkItemStateIpcInput {
  readonly workItemId: string;
  readonly state: WorkItemState;
}

export function isValidSetWorkItemStateIpcInput(input: unknown): input is SetWorkItemStateIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<SetWorkItemStateIpcInput>;
  if (typeof candidate.workItemId !== 'string' || candidate.workItemId.trim().length === 0) return false;
  return typeof candidate.state === 'string' && WORK_ITEM_STATES.includes(candidate.state);
}

/** D-16 — descartar item nascido pela skill. Sem bloqueio; o fato fica no log. */
export interface DiscardWorkItemIpcInput {
  readonly workItemId: string;
  readonly reason: string | null;
}

export function isValidDiscardWorkItemIpcInput(input: unknown): input is DiscardWorkItemIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<DiscardWorkItemIpcInput>;
  if (typeof candidate.workItemId !== 'string' || candidate.workItemId.trim().length === 0) return false;
  if (candidate.reason !== null && candidate.reason !== undefined && typeof candidate.reason !== 'string') return false;
  return true;
}

export interface AddNoteIpcInput {
  readonly subject: EntityId;
  readonly text: string;
}

export function isValidAddNoteIpcInput(input: unknown): input is AddNoteIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<AddNoteIpcInput>;
  if (typeof candidate.text !== 'string' || candidate.text.trim().length === 0) return false;
  const subject = candidate.subject as Partial<EntityId> | undefined;
  if (typeof subject !== 'object' || subject === null) return false;
  if (subject.entity !== 'discovery' && subject.entity !== 'plan' && subject.entity !== 'work_item') return false;
  return typeof subject.id === 'string' && subject.id.trim().length > 0;
}

/**
 * A resposta dos gestos que so mudam o estado local. `unknown-subject` existe
 * porque o reducer ignora, calado, evento sobre entidade que nao existe: gravar
 * assim mesmo produziria um fato sobre um fantasma e uma tela que nao muda, sem
 * ninguem saber por que. Recusar antes de escrever, com a razao, e a mesma regra
 * de "o app nunca afirma o que nao leu", aplicada na escrita.
 */
export type EsteiraGestureDto =
  | { readonly ok: true; readonly state: EsteiraSnapshotDto }
  | {
      readonly ok: false;
      readonly reason: 'store-refused' | 'invalid-input' | 'unknown-subject' | 'locked';
      readonly state: EsteiraSnapshotDto;
    };

export type EsteiraDispatchDto =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly sessionId: string;
      readonly inputPath: string;
      readonly resultPath: string;
      readonly state: EsteiraSnapshotDto;
    }
  | { readonly ok: false; readonly reason: 'locked'; readonly lock: LockRecord; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'invalid-target'; readonly issues: readonly ContractIssue[]; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'store-refused' | 'write-failed' | 'invalid-input'; readonly state: EsteiraSnapshotDto };

export type EsteiraCreateDiscoveryDto =
  | { readonly ok: true; readonly discoveryId: string; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'store-refused' | 'invalid-input'; readonly state: EsteiraSnapshotDto };

/** API tipada exposta em `window.donel.esteira`. */
export interface DonelEsteiraApi {
  snapshot(): Promise<EsteiraSnapshotDto>;
  scanOutbox(): Promise<EsteiraSnapshotDto>;
  createDiscovery(input: CreateDiscoveryIpcInput): Promise<EsteiraCreateDiscoveryDto>;
  dispatch(input: DispatchIpcInput): Promise<EsteiraDispatchDto>;
  releaseLock(input: ReleaseLockIpcInput): Promise<EsteiraSnapshotDto>;
  setStageOverride(input: SetStageOverrideIpcInput): Promise<EsteiraGestureDto>;
  setWorkItemState(input: SetWorkItemStateIpcInput): Promise<EsteiraGestureDto>;
  discardWorkItem(input: DiscardWorkItemIpcInput): Promise<EsteiraGestureDto>;
  addNote(input: AddNoteIpcInput): Promise<EsteiraGestureDto>;
  /** Devolve a funcao de desinscricao (mesmo padrao dos outros canais de push). */
  onChanged(listener: (state: EsteiraSnapshotDto) => void): () => void;
}

/** Rotulos pt-BR das macro etapas — a UI nao inventa nome de etapa. */
export const MACRO_STAGE_LABEL: Readonly<Record<MacroStage, string>> = {
  discovery: 'Discovery',
  planned: 'Planejado',
  execution: 'Execução',
  done: 'Concluído',
};
