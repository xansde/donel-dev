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
import type {
  EntityId,
  LockRecord,
  MacroStage,
  PhaseRunSnapshot,
  SessionSnapshot,
  StoreCompatibility,
  StoreSnapshot,
  WorkItemState,
} from './store/storeFormat';

export const ESTEIRA_CHANNELS = {
  /** Estado atual: snapshot derivado + de onde ele veio. */
  snapshot: 'esteira:snapshot',
  /** Varre o outbox agora (o boot e o watcher ja fazem isso sozinhos). */
  scanOutbox: 'esteira:scanOutbox',
  /** Gesto do app: nasce um discovery (o app gera o id). */
  createDiscovery: 'esteira:createDiscovery',
  /** Gesto do app (D-2): planta um discovery que JA existe, com planos, itens e o ponto em que estao. */
  seed: 'esteira:seed',
  /** Dispara uma fase: grava o `run-input.json`, trava e abre sessao. */
  dispatch: 'esteira:dispatch',
  /** Alguem assumiu a sessao preparada: o CLI devolveu o id dela (batch B1). */
  claimSession: 'esteira:claimSession',
  /** A sessao acabou sem a fase concluir — tipicamente a aba fechada (batch B1). */
  endSession: 'esteira:endSession',
  /** Libera a trava — o "gesto" de D-11. */
  releaseLock: 'esteira:releaseLock',
  /** D-13 — forca a macro etapa a mao, ou volta ao calculo (`value: null`). */
  setStageOverride: 'esteira:setStageOverride',
  /** D-6 — corrige a ancora e o escopo de um card que ja existe. */
  setDiscoveryRepos: 'esteira:setDiscoveryRepos',
  /** Abrir/comecar/concluir/abandonar um item — e o que move a macro etapa, inclusive PARA TRAS. */
  setWorkItemState: 'esteira:setWorkItemState',
  /** D-16 — descarta um item num gesto; o evento fica no log, a entidade sai do snapshot. */
  discardWorkItem: 'esteira:discardWorkItem',
  /** Nota amarrada ao card ou a um item. */
  addNote: 'esteira:addNote',
  /** Reenvia o que o board nao recebeu (D-12). Gesto humano: ignora o teto de tentativas. */
  retryMirror: 'esteira:retryMirror',
  /**
   * C3 — le o TEXTO de um artefato ja conhecido pelo store (D-8), so leitura.
   * O `path` chega ABSOLUTO, ja resolvido no renderer contra a lista de
   * projetos conhecidos — a MESMA fronteira de confianca de onde a sessao de
   * terminal abre (D-6): o app ja executa shell nesses caminhos sem validacao
   * extra, e ler um arquivo de texto e uma capacidade menor que essa.
   */
  readArtifactText: 'esteira:readArtifactText',
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
  /**
   * Quantos `result.json` NOVOS entraram no historico na ultima varredura.
   * Existe porque a tela so sabia contar recusa e, por isso, anunciava "nada
   * novo" no mesmo instante em que o card mudava de etapa embaixo da frase.
   */
  readonly ingestedOnLastScan: number;
  /** Quantos arquivos a varredura NAO conseguiu ler. "Nao li" nao e "nao aconteceu". */
  readonly unreadableOnLastScan: number;
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

/**
 * D-2 — o seed. O renderer manda o DOCUMENTO cru, e quem o lê é o parser puro
 * no main: a redação do erro (com caminho do campo) precisa nascer de um lugar
 * só, e é o mesmo rigor dos dois contratos da esteira. Um formulário por campo
 * também violaria D-16 — criar item é gesto da skill; semear é outra coisa,
 * declarada de uma vez e marcada como afirmação.
 */
export interface SeedIpcInput {
  readonly document: string;
}

export function isValidSeedIpcInput(input: unknown): input is SeedIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<SeedIpcInput>;
  return typeof candidate.document === 'string' && candidate.document.trim().length > 0;
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
  readonly model?: string | null;
  readonly effort?: string | null;
  /** A21 — `true` so quando model/effort vieram de DEFAULT, sem confirmacao explicita (P33). */
  readonly modelEffortAssumed?: boolean;
  /** A1 — confirma a reabertura explicita de uma fase ja concluida sobre o mesmo assunto. */
  readonly confirmReopen?: boolean;
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
  if (candidate.model !== null && candidate.model !== undefined && typeof candidate.model !== 'string') return false;
  if (candidate.effort !== null && candidate.effort !== undefined && typeof candidate.effort !== 'string') return false;
  if (candidate.modelEffortAssumed !== undefined && typeof candidate.modelEffortAssumed !== 'boolean') return false;
  if (candidate.confirmReopen !== undefined && typeof candidate.confirmReopen !== 'boolean') return false;
  return true;
}

/**
 * Batch B1 — a aba nasceu e o CLI devolveu o id da sessao. E o fato que
 * autoriza o card a dizer "em andamento": antes dele, o app so tinha separado
 * o contexto em disco.
 */
export interface ClaimSessionIpcInput {
  readonly sessionId: string;
  readonly cliSessionId: string;
}

export function isValidClaimSessionIpcInput(input: unknown): input is ClaimSessionIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<ClaimSessionIpcInput>;
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.trim().length === 0) return false;
  return typeof candidate.cliSessionId === 'string' && candidate.cliSessionId.trim().length > 0;
}

/**
 * Batch B1 — a sessao acabou sem a fase concluir (aba fechada). O card NAO pode
 * ficar preso num estado sem saida: a trava cai junto, porque trava sem sessao
 * e a trava orfa que matou o modelo anterior.
 */
export interface EndSessionIpcInput {
  readonly sessionId: string;
  readonly reason: string | null;
}

export function isValidEndSessionIpcInput(input: unknown): input is EndSessionIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<EndSessionIpcInput>;
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.trim().length === 0) return false;
  return candidate.reason === null || candidate.reason === undefined || typeof candidate.reason === 'string';
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

/**
 * D-6 — corrigir a ancora e o escopo de um card que ja existe.
 *
 * Nasceu do dogfooding de 06/08: o card so podia declarar repo no instante em
 * que nascia, e num campo de texto livre. Quem descobriu depois que o alvo
 * estava errado — ou que o trabalho atravessava um segundo servico — nao tinha
 * gesto nenhum; ficava com um card que nao dispara e sem como conserta-lo.
 *
 * Os dois campos viajam JUNTOS de propósito: alvo e escopo sao a mesma decisao
 * ("onde isto acontece"), e salva-los separado deixaria o card num estado
 * intermediario onde a ancora nao pertence ao proprio escopo.
 */
export interface SetDiscoveryReposIpcInput {
  readonly discoveryId: string;
  /** A ancora: onde a sessao senta. `null` e legitimo — discovery investiga problema, nao repo. */
  readonly targetRepo: string | null;
  /** O alcance: o que a mudanca toca. Microsservico atravessa repo por natureza. */
  readonly scopeRepos: readonly string[];
}

export function isValidSetDiscoveryReposIpcInput(input: unknown): input is SetDiscoveryReposIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<SetDiscoveryReposIpcInput>;
  if (typeof candidate.discoveryId !== 'string' || candidate.discoveryId.trim().length === 0) return false;
  if (candidate.targetRepo !== null && candidate.targetRepo !== undefined && typeof candidate.targetRepo !== 'string') return false;
  if (candidate.scopeRepos !== undefined && !Array.isArray(candidate.scopeRepos)) return false;
  if (candidate.scopeRepos?.some((repo) => typeof repo !== 'string' || repo.trim().length === 0)) return false;
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
 * C3 — o pedido de leitura de um artefato. Restrito a `.md`: este canal
 * existe pra `tasks.md` (e documentos irmãos), não é um leitor de arquivo
 * genérico — abrir pra qualquer extensão seria uma capacidade nova que
 * ninguém revisou.
 */
export interface ReadArtifactTextIpcInput {
  readonly path: string;
}

export function isValidReadArtifactTextIpcInput(input: unknown): input is ReadArtifactTextIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<ReadArtifactTextIpcInput>;
  return typeof candidate.path === 'string' && candidate.path.trim().length > 0 && candidate.path.toLowerCase().endsWith('.md');
}

/** `not-found`/`read-error` nunca lançam pro renderer — degradam por omissão (o mesmo padrão de `FileReadIoDeps`, que nunca lança). */
export type ReadArtifactTextDto =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'not-found' | 'read-error' | 'invalid-input' };

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
  /** A8/A20 — o repo+caminho que esta fase tocaria ja esta ocupado por outro assunto (irmao). */
  | { readonly ok: false; readonly reason: 'resource-busy'; readonly lock: LockRecord; readonly state: EsteiraSnapshotDto }
  /** A1 — a fase ja concluiu sobre este assunto; redisparar exige `confirmReopen: true`. */
  | { readonly ok: false; readonly reason: 'phase-done'; readonly phase: PhaseRunSnapshot; readonly state: EsteiraSnapshotDto }
  /** B3 — ja existe uma sessao VIVA para este MESMO assunto+fase. */
  | { readonly ok: false; readonly reason: 'session-active'; readonly session: SessionSnapshot; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'invalid-target'; readonly issues: readonly ContractIssue[]; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'store-refused' | 'write-failed' | 'invalid-input'; readonly state: EsteiraSnapshotDto };

export type EsteiraCreateDiscoveryDto =
  | { readonly ok: true; readonly discoveryId: string; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'store-refused' | 'invalid-input'; readonly state: EsteiraSnapshotDto };

export type EsteiraSeedDto =
  | {
      readonly ok: true;
      readonly discoveryId: string;
      readonly planIds: readonly string[];
      readonly workItemIds: readonly string[];
      readonly state: EsteiraSnapshotDto;
    }
  /** Documento fora do formato: nada foi escrito, e a razao vem com o CAMINHO do campo. */
  | { readonly ok: false; readonly reason: 'invalid-seed'; readonly issues: readonly ContractIssue[]; readonly state: EsteiraSnapshotDto }
  | { readonly ok: false; readonly reason: 'store-refused' | 'invalid-input'; readonly state: EsteiraSnapshotDto };

/** API tipada exposta em `window.donel.esteira`. */
export interface DonelEsteiraApi {
  snapshot(): Promise<EsteiraSnapshotDto>;
  scanOutbox(): Promise<EsteiraSnapshotDto>;
  createDiscovery(input: CreateDiscoveryIpcInput): Promise<EsteiraCreateDiscoveryDto>;
  seed(input: SeedIpcInput): Promise<EsteiraSeedDto>;
  dispatch(input: DispatchIpcInput): Promise<EsteiraDispatchDto>;
  claimSession(input: ClaimSessionIpcInput): Promise<EsteiraSnapshotDto>;
  endSession(input: EndSessionIpcInput): Promise<EsteiraSnapshotDto>;
  releaseLock(input: ReleaseLockIpcInput): Promise<EsteiraSnapshotDto>;
  setStageOverride(input: SetStageOverrideIpcInput): Promise<EsteiraGestureDto>;
  setDiscoveryRepos(input: SetDiscoveryReposIpcInput): Promise<EsteiraGestureDto>;
  setWorkItemState(input: SetWorkItemStateIpcInput): Promise<EsteiraGestureDto>;
  discardWorkItem(input: DiscardWorkItemIpcInput): Promise<EsteiraGestureDto>;
  addNote(input: AddNoteIpcInput): Promise<EsteiraGestureDto>;
  /**
   * D-12 — reenvia a fila do espelho. E o UNICO caminho do espelho que espera
   * resposta, porque quem clicou quer saber se foi; todo o resto acontece
   * atras, sem segurar gesto nenhum.
   */
  retryMirror(): Promise<EsteiraSnapshotDto>;
  /** C3 — le o texto de um artefato (D-8), so leitura, restrito a `.md`. */
  readArtifactText(input: ReadArtifactTextIpcInput): Promise<ReadArtifactTextDto>;
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
