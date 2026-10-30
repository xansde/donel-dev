import { contextBridge, ipcRenderer, webUtils } from 'electron';
// G5 (batch N5) — guarda contra segundo assinante silencioso de canal IPC:
// todo `onX` abaixo passa por aqui em vez de `ipcRenderer.on` direto.
import { subscribeChannel } from './subscribeChannel';
import { CHAT_CHANNELS } from '../shared/chat/ipc';
// 015-jobu-pet — the pet channels; same names as the contract (specs/015-jobu-pet/contracts/ipc-pet.md).
import { PET_CHANNELS } from '../shared/pet/ipc';
import type { PetActivateSessionPayload, PetDragPayload, PetOpenTarget, PetPrefsChangedPayload, PetTabsPayload } from '../shared/pet/ipc';
import type { PetView } from '../shared/pet/types';
import type {
  ChatAckLookupOutput,
  ChatAnswerOutput,
  ChatConversationSwitchedEvent,
  ChatFocusPendingEvent,
  ChatLiveEvent,
  ChatLoadOlderOutput,
  ChatPromptSignalEvent,
  ChatReceptionEvent,
  ChatRowDetailInput,
  ChatRowsEvent,
  ChatCatalogOutput,
  ChatFilesOutput,
  ChatSaveImageOutput,
  ChatSnapshot,
  PendingAnswer,
  RowDetail,
} from '../shared/chat/ipc';
import type { RowScope, TerminalNeededReason } from '../shared/chat/rows';
import type {
  AccountsConfigDto,
  AccountsViewDto,
  AppConfigDto,
  ArchiveOutcome,
  BeginLoginOutcome,
  ConnectModInput,
  ConnectModOutcome,
  ConsolidateResult,
  ImportResult,
  MigrationPlan,
  ArchivePhaseSessionIpcInput,
  BoardFacts,
  CardRepoResolution,
  CreateProjectIpcInput,
  CreateProjectResponse,
  DonelApi,
  EntryColumnCard,
  GhAvailabilityDto,
  GithubReadRequest,
  GithubReadResponse,
  ChatPrefs,
  LauncherDefaultsDto,
  LoginStatusDto,
  NotificationPreference,
  OpenDiscoveryIpcInput,
  PhaseArchivedPayload,
  PhaseDefaultsTable,
  PetPrefsInput,
  ProjectBindingDto,
  ProjectInfo,
  ProjectScanMode,
  PtyCreateOptions,
  PtyCreateResult,
  PtyExitInfo,
  RemoveAccountOutcome,
  ResolveCardRepoIpcInput,
  ResolveCardReposIpcInput,
  SaveProjectBindingIpcInput,
  SaveProjectBindingResult,
  SemaphoreStateInfo,
  SemaphoreUpdate,
  SessionSummaryDto,
  SwitchOutcome,
  TabColorToken,
  TranscriptChangedPayload,
  SessionSwitchedPayload,
  WatchPhaseIpcInput,
} from '../shared';
import type { AccountId } from '../shared';
import {
  ACCOUNT_CHANNELS,
  CONFIG_CHANNELS,
  DEVMODE_CHANNELS,
  GITHUB_CHANNELS,
  MIGRATION_CHANNELS,
  PROJECT_BINDING_CHANNELS,
  PROJECT_CHANNELS,
  PROVIDER_CHANNELS,
  PTY_CHANNELS,
  SEMAPHORE_CHANNELS,
  SESSION_CHANNELS,
  TAB_CHANNELS,
  TRANSCRIPT_CHANNELS,
} from '../shared';
import type { ProviderId, ProviderSummaryDto, SetSecretResult, UpsertProviderInput, UpsertProviderResult } from '../shared';
// T504 (005-terminal-copy-paste) — canal do clipboard-bridge (main), aditivo
// aos imports acima (não reordena o bloco existente).
import { CLIPBOARD_CHANNELS } from '../shared';
// Spec 010 — canais e shapes da esteira nova.
import {
  ESTEIRA_CHANNELS,
  type AddNoteIpcInput,
  type ClaimSessionIpcInput,
  type CreateDiscoveryIpcInput,
  type DiscardWorkItemIpcInput,
  type DispatchIpcInput,
  type EndSessionIpcInput,
  type EsteiraCreateDiscoveryDto,
  type EsteiraDispatchDto,
  type EsteiraGestureDto,
  type EsteiraSeedDto,
  type EsteiraSnapshotDto,
  type ReadArtifactTextDto,
  type ReadArtifactTextIpcInput,
  type ReleaseLockIpcInput,
  type SeedIpcInput,
  type SetDiscoveryReposIpcInput,
  type SetStageOverrideIpcInput,
  type SetWorkItemStateIpcInput,
} from '../shared/esteira/ipc';

import { MINDSCAPE_CHANNELS } from '../shared/mindscape/channels';
import type { MindscapeReadImageResult, MindscapeSaveImageResult, MindscapeSaveResult, MindscapeTurnEndedPayload } from '../shared/mindscape/channels';
import type { MindscapeDoc } from '../shared/mindscape/model';

// contextIsolation: true + sem nodeIntegration (src/main/index.ts) — este
// arquivo é o único ponto por onde o renderer alcança o main process, via
// `window.donel.*` tipado de ponta a ponta (plan.md "Arquitetura de
// processos"). Canais `pty:*` chegam em T004; `projects:*` chega no T007;
// `sessions:*` chega no T013; `profiles:*` chega no T014; `config:*` chega
// no T015 (ConfigStore formal, FR-007/FR-009).

const donelApi: DonelApi = {
  pty: {
    create: (options: PtyCreateOptions) =>
      ipcRenderer.invoke(PTY_CHANNELS.create, options) as Promise<PtyCreateResult>,

    input: (ptyId: string, data: string) => {
      ipcRenderer.send(PTY_CHANNELS.input, ptyId, data);
    },

    resize: (ptyId: string, cols: number, rows: number) => {
      ipcRenderer.send(PTY_CHANNELS.resize, ptyId, cols, rows);
    },

    kill: (ptyId: string) => {
      ipcRenderer.send(PTY_CHANNELS.kill, ptyId);
    },

    getPreview: (ptyId: string) => ipcRenderer.invoke(PTY_CHANNELS.preview, ptyId) as Promise<string[]>,

    // NÃO passa por `subscribeChannel` (G5): este canal é broadcast DE
    // PROPÓSITO — uma aba, um `TerminalPane`, um listener, todos no MESMO
    // canal, cada um filtrando pelo próprio `ptyId`. Múltiplos assinantes
    // aqui são o desenho certo, não o bug que G5 existe para pegar.
    onData: (ptyId: string, listener: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, eventPtyId: string, data: string): void => {
        if (eventPtyId === ptyId) listener(data);
      };
      ipcRenderer.on(PTY_CHANNELS.data, handler);
      return () => ipcRenderer.removeListener(PTY_CHANNELS.data, handler);
    },

    onExit: (ptyId: string, listener: (info: PtyExitInfo) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, eventPtyId: string, info: PtyExitInfo): void => {
        if (eventPtyId === ptyId) listener(info);
      };
      ipcRenderer.on(PTY_CHANNELS.exit, handler);
      return () => ipcRenderer.removeListener(PTY_CHANNELS.exit, handler);
    },
  },

  projects: {
    list: () => ipcRenderer.invoke(PROJECT_CHANNELS.list) as Promise<ProjectInfo[]>,

    setFavorite: (path: string, favorite: boolean) =>
      ipcRenderer.invoke(PROJECT_CHANNELS.favorite, path, favorite) as Promise<ProjectInfo[]>,

    // CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero" (US-15).
    create: (input: CreateProjectIpcInput) => ipcRenderer.invoke(PROJECT_CHANNELS.create, input) as Promise<CreateProjectResponse>,
  },

  semaphore: {
    // Um canal IPC só (broadcast de todas as sessões) — filtrado por ptyId
    // aqui, mesmo padrão de pty.onData/pty.onExit acima.
    onUpdate: (ptyId: string, listener: (info: SemaphoreStateInfo) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, update: SemaphoreUpdate): void => {
        if (update.ptyId === ptyId) listener({ state: update.state, stateEnteredAt: update.stateEnteredAt });
      };
      ipcRenderer.on(SEMAPHORE_CHANNELS.update, handler);
      return () => ipcRenderer.removeListener(SEMAPHORE_CHANNELS.update, handler);
    },
  },

  sessions: {
    list: (projectPath: string) =>
      ipcRenderer.invoke(SESSION_CHANNELS.list, projectPath) as Promise<SessionSummaryDto[]>,
    // T406 (004) — grava/limpa o nome dado pela UI. `name` vazio apaga (C5).
    setName: (sessionId: string, name: string, seenTitle: string | null) =>
      ipcRenderer.invoke(SESSION_CHANNELS.setName, sessionId, name, seenTitle) as Promise<AppConfigDto>,

    // T412 (004) — push do watcher de transcript (CA-4). Sem filtro por
    // sessionId aqui, ao contrário de `pty.onData`: é UMA assinatura no App
    // para TODAS as abas vivas, e quem despacha por sessão é o renderer.
    // G5 — canal pensado para UMA assinatura só (o comentário acima já dizia
    // "UMA assinatura no App para TODAS as abas vivas"); `subscribeChannel`
    // torna essa intenção auditável, não só comentada.
    onTranscriptChanged: (listener: (payload: TranscriptChangedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TranscriptChangedPayload): void => {
        listener(payload);
      };
      return subscribeChannel(ipcRenderer, TRANSCRIPT_CHANNELS.changed, handler);
    },

    // T016 (014-chat, FR-033) — troca de conversa da aba (`/clear`, `/resume`).
    onSessionSwitched: (listener: (payload: SessionSwitchedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SessionSwitchedPayload): void => {
        listener(payload);
      };
      return subscribeChannel(ipcRenderer, TRANSCRIPT_CHANNELS.switched, handler);
    },

    // T705 (007-favoritos-sessoes) — os três canais de escrita do registro.
    registerVisit: (sessionId: string, projectPath: string, label: string) =>
      ipcRenderer.invoke(SESSION_CHANNELS.registerVisit, sessionId, projectPath, label) as Promise<AppConfigDto>,

    setPinned: (sessionId: string, pinned: boolean) =>
      ipcRenderer.invoke(SESSION_CHANNELS.setPinned, sessionId, pinned) as Promise<AppConfigDto>,

    forget: (sessionId: string) => ipcRenderer.invoke(SESSION_CHANNELS.forget, sessionId) as Promise<AppConfigDto>,

    // T710/CA-11 (2º momento) — o main confere o `.jsonl` antes de remover.
    forgetIfOrphan: (sessionId: string) => ipcRenderer.invoke(SESSION_CHANNELS.forgetIfOrphan, sessionId) as Promise<AppConfigDto>,

    // T706/CA-8 — a única leitura de disco da feature, guardada no main.
    seedProject: (projectPath: string) => ipcRenderer.invoke(SESSION_CHANNELS.seedProject, projectPath) as Promise<AppConfigDto>,
  },

  // 011-contas-e-provedores (etapa 1) — motor de contas + mods (nasce inerte,
  // accounts.mod = null). `ConnectModInput` é write-only: o segredo digitado
  // nunca volta em NENHUM canal de leitura abaixo.
  accounts: {
    list: (options?: { force?: boolean }) => ipcRenderer.invoke(ACCOUNT_CHANNELS.list, options) as Promise<AccountsViewDto>,

    switch: (id: AccountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.switch, id) as Promise<SwitchOutcome>,

    getConfig: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.getConfig) as Promise<AccountsConfigDto>,

    setConfig: (patch: Partial<AccountsConfigDto>) => ipcRenderer.invoke(ACCOUNT_CHANNELS.setConfig, patch) as Promise<AccountsConfigDto>,

    connectMod: (input: ConnectModInput) => ipcRenderer.invoke(ACCOUNT_CHANNELS.connectMod, input) as Promise<ConnectModOutcome>,

    disconnectMod: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.disconnectMod) as Promise<AccountsConfigDto>,

    // 011-contas-e-provedores, etapa 3, Fase 1 — remove uma conta cadastrada
    // (bloqueado para a ATIVA; ver `RemoveAccountOutcome`).
    removeAccount: (id: AccountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.removeAccount, id) as Promise<RemoveAccountOutcome>,

    // G5 — o canal cujo segundo assinante silencioso já custou ~80ms no boot
    // (T1232/011, etapa 2): `App.tsx` abria a própria assinatura além da que
    // `AccountsPanel` já mantinha. A correção de então tirou a duplicata; esta
    // guarda pega a PRÓXIMA vez que alguém reintroduzir o mesmo padrão.
    onChanged: (listener: (view: AccountsViewDto) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, view: AccountsViewDto): void => listener(view);
      return subscribeChannel(ipcRenderer, ACCOUNT_CHANNELS.changed, handler);
    },

    // 011-contas-e-provedores, etapa 3, Fase 1.2 — login isolado
    // (IsolatedLoginManager, main/accounts/isolated-login.ts). `beginLogin`
    // só pede o rótulo (LGPD — nunca o e-mail/nome da conta); o `loginId` do
    // retorno alimenta o `pty:create` seguinte (`accountLoginId`).
    beginLogin: (label: string) => ipcRenderer.invoke(ACCOUNT_CHANNELS.beginLogin, label) as Promise<BeginLoginOutcome>,

    cancelLogin: (loginId: string) => ipcRenderer.invoke(ACCOUNT_CHANNELS.cancelLogin, loginId) as Promise<void>,

    onLoginChanged: (listener: (status: LoginStatusDto) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: LoginStatusDto): void => listener(status);
      return subscribeChannel(ipcRenderer, ACCOUNT_CHANNELS.loginChanged, handler);
    },

    // 011-contas-e-provedores, etapa 3, Fase 2 (D3) — login isolado apontado
    // pra uma conta já cadastrada ("Reconectar"). O rótulo vem da conta, não
    // é digitado de novo.
    beginReconnect: (id: AccountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.beginReconnect, id) as Promise<BeginLoginOutcome>,
  },

  // T1214 (011-contas-e-provedores, etapa 2) — assistente de migração
  // (contracts/migration-etapa-2.md). Temporário: existe enquanto houver
  // `~/.claude-profiles`. Nenhum canal devolve conteúdo de arquivo de perfil.
  migration: {
    scan: () => ipcRenderer.invoke(MIGRATION_CHANNELS.scan) as Promise<MigrationPlan>,

    importCredentials: (profileSlug: string) =>
      ipcRenderer.invoke(MIGRATION_CHANNELS.importCredentials, profileSlug) as Promise<ImportResult>,

    consolidateTranscripts: (profileSlug: string) =>
      ipcRenderer.invoke(MIGRATION_CHANNELS.consolidateTranscripts, profileSlug) as Promise<ConsolidateResult>,

    markMcpReviewed: (profileSlug: string) =>
      ipcRenderer.invoke(MIGRATION_CHANNELS.markMcpReviewed, profileSlug) as Promise<MigrationPlan>,

    archive: () => ipcRenderer.invoke(MIGRATION_CHANNELS.archive) as Promise<ArchiveOutcome>,
  },

  // T1318 (011-contas-e-provedores, etapa 3) — registry de providers classe
  // A; nasce inerte (`providers.entries = []`). `UpsertProviderInput` nunca
  // carrega o VALOR de um segredo — só `setSecret` grava segredo, e devolve
  // só o status (write-only, C19). Não existe canal `resolveLaunch`: essa
  // resolução acontece dentro do `pty:create`, no main, pro env nunca
  // atravessar este arquivo (contracts/provider-registry.md).
  providers: {
    list: () => ipcRenderer.invoke(PROVIDER_CHANNELS.list) as Promise<readonly ProviderSummaryDto[]>,

    upsert: (input: UpsertProviderInput) => ipcRenderer.invoke(PROVIDER_CHANNELS.upsert, input) as Promise<UpsertProviderResult>,

    remove: (id: ProviderId) => ipcRenderer.invoke(PROVIDER_CHANNELS.remove, id) as Promise<readonly ProviderSummaryDto[]>,

    setSecret: (id: ProviderId, envKey: string, value: string) =>
      ipcRenderer.invoke(PROVIDER_CHANNELS.setSecret, id, envKey, value) as Promise<SetSecretResult>,
  },

  config: {
    get: () => ipcRenderer.invoke(CONFIG_CHANNELS.get) as Promise<AppConfigDto>,

    setProjectRoots: (roots: string[]) => ipcRenderer.invoke(CONFIG_CHANNELS.setProjectRoots, roots) as Promise<AppConfigDto>,

    setNotificationPreference: (preference: NotificationPreference) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setNotificationPreference, preference) as Promise<AppConfigDto>,
    setProjectScanMode: (mode: ProjectScanMode) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setProjectScanMode, mode) as Promise<AppConfigDto>,

    setLauncherDefaults: (defaults: LauncherDefaultsDto) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setLauncherDefaults, defaults) as Promise<AppConfigDto>,

    setChatPrefs: (prefs: Partial<ChatPrefs>) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setChatPrefs, prefs) as Promise<AppConfigDto>,

    // T014 (015-jobu-pet) — the Jobu switch; the main applies it at once (creates/destroys the pet window).
    setPetPrefs: (prefs: PetPrefsInput) => ipcRenderer.invoke(CONFIG_CHANNELS.setPetPrefs, prefs) as Promise<AppConfigDto>,
    setCollapsedFavorites: (collapsed: string[]) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setCollapsedFavorites, collapsed) as Promise<AppConfigDto>,
  },

  // T504 (005-terminal-copy-paste) — clipboard-bridge do main atrás de IPC
  // (plan.md decisão 6: nunca `navigator.clipboard` no renderer).
  clipboard: {
    hasImage: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.hasImage) as Promise<boolean>,

    readText: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.readText) as Promise<string>,

    writeText: (text: string) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text) as Promise<void>,
  },

  // T307 (003-modo-dev) — estado do Modo Dev (CA-21/CA-4) + leitura da árvore
  // do discovery (CA-7). Nenhum canal aqui escreve no TaskDex/vault.
  // CA-26/CA-27 (009-modo-dev-v3, lote 1) — cor + ordem da aba v3, por sessão claude.
  tabs: {
    setColor: (sessionId: string, color: TabColorToken) =>
      ipcRenderer.invoke(TAB_CHANNELS.setColor, sessionId, color) as Promise<AppConfigDto>,

    setOrder: (sessionId: string, order: number) =>
      ipcRenderer.invoke(TAB_CHANNELS.setOrder, sessionId, order) as Promise<AppConfigDto>,
  },

  // Mindscape V1 — the board document (main is the only writer).
  mindscape: {
    load: () => ipcRenderer.invoke(MINDSCAPE_CHANNELS.load) as Promise<MindscapeDoc>,
    save: (doc: MindscapeDoc) => ipcRenderer.invoke(MINDSCAPE_CHANNELS.save, doc) as Promise<MindscapeSaveResult>,
    onTurnEnded: (listener: (payload: MindscapeTurnEndedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: MindscapeTurnEndedPayload): void => listener(payload);
      ipcRenderer.on(MINDSCAPE_CHANNELS.turnEnded, handler);
      return () => ipcRenderer.removeListener(MINDSCAPE_CHANNELS.turnEnded, handler);
    },
    // Desenho, fatia 06 — the prints: bytes in, imageId out (the main names and checks the file).
    saveImage: (bytes: ArrayBuffer, mediaType: string) =>
      ipcRenderer.invoke(MINDSCAPE_CHANNELS.saveImage, { bytes, mediaType }) as Promise<MindscapeSaveImageResult>,
    readImage: (imageId: string) => ipcRenderer.invoke(MINDSCAPE_CHANNELS.readImage, imageId) as Promise<MindscapeReadImageResult>,
  },

  devMode: {
    get: () => ipcRenderer.invoke(DEVMODE_CHANNELS.get) as Promise<AppConfigDto>,

    openDiscovery: (input: OpenDiscoveryIpcInput) => ipcRenderer.invoke(DEVMODE_CHANNELS.openDiscovery, input) as Promise<AppConfigDto>,

    focusDiscovery: (cardId: string) => ipcRenderer.invoke(DEVMODE_CHANNELS.focusDiscovery, cardId) as Promise<AppConfigDto>,

    closeDiscovery: (cardId: string) => ipcRenderer.invoke(DEVMODE_CHANNELS.closeDiscovery, cardId) as Promise<AppConfigDto>,

    archivePhaseSession: (input: ArchivePhaseSessionIpcInput) =>
      ipcRenderer.invoke(DEVMODE_CHANNELS.archivePhaseSession, input) as Promise<AppConfigDto>,

    getDefaults: () => ipcRenderer.invoke(DEVMODE_CHANNELS.getDefaults) as Promise<AppConfigDto>,

    setDefaults: (defaults: PhaseDefaultsTable) => ipcRenderer.invoke(DEVMODE_CHANNELS.setDefaults, defaults) as Promise<AppConfigDto>,


    // T311 (Batch B) — CA-1: consulta restrita da porta de entrada.
    listEntryCards: (repoPath?: string) => ipcRenderer.invoke(DEVMODE_CHANNELS.listEntryCards, repoPath) as Promise<readonly EntryColumnCard[]>,

    // T327 (Batch D) — CA-12: os 4 fatos do board para os cards do discovery
    // em foco. Leitura pura — não existe canal simétrico de escrita.
    readBoardFacts: (cardIds: readonly string[]) =>
      ipcRenderer.invoke(DEVMODE_CHANNELS.readBoardFacts, cardIds) as Promise<Record<string, BoardFacts>>,

    // T315 (Batch B) — CA-6: watcher do manifesto por etapa + push do evento.
    watchPhase: (input: WatchPhaseIpcInput) => ipcRenderer.invoke(DEVMODE_CHANNELS.watchPhase, input) as Promise<void>,

    unwatchPhase: (input: WatchPhaseIpcInput) => ipcRenderer.invoke(DEVMODE_CHANNELS.unwatchPhase, input) as Promise<void>,

    onPhaseArchived: (listener: (payload: PhaseArchivedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: PhaseArchivedPayload): void => {
        listener(payload);
      };
      return subscribeChannel(ipcRenderer, DEVMODE_CHANNELS.phaseArchived, handler);
    },

    // Issue #34 (P0) — resolve o repo-alvo do card por rastro em disco, nunca
    // pelo repo em foco na sidebar.
    resolveCardRepo: (input: ResolveCardRepoIpcInput) =>
      ipcRenderer.invoke(DEVMODE_CHANNELS.resolveCardRepo, input) as Promise<CardRepoResolution>,

    // Issue #38 — a mesma resolução, em lote, pra lista inteira da porta de
    // entrada num só IPC (nunca um IPC por linha dentro do loop de render).
    resolveCardRepos: (input: ResolveCardReposIpcInput) =>
      ipcRenderer.invoke(DEVMODE_CHANNELS.resolveCardRepos, input) as Promise<Record<string, CardRepoResolution>>,
  },

  // CA-23 (009-modo-dev-v3, lote 3) — engrenagem de configuração por projeto
  // (board TaskDex + repo GitHub). Nenhum canal escreve em TaskDex/GitHub —
  // só nos dois arquivos de config locais que a esteira já lia.
  projectBinding: {
    get: (repoPath: string) => ipcRenderer.invoke(PROJECT_BINDING_CHANNELS.get, repoPath) as Promise<ProjectBindingDto>,

    save: (input: SaveProjectBindingIpcInput) =>
      ipcRenderer.invoke(PROJECT_BINDING_CHANNELS.save, input) as Promise<SaveProjectBindingResult>,
  },

  // CA-3/CA-5 (009-modo-dev-v3, lote 4) — GitHub por `gh` CLI (spec-issue,
  // sub-issues, PR da fase). Nenhum canal escreve no GitHub.
  github: {
    read: (request: GithubReadRequest) => ipcRenderer.invoke(GITHUB_CHANNELS.read, request) as Promise<GithubReadResponse>,

    checkAvailability: () => ipcRenderer.invoke(GITHUB_CHANNELS.checkAvailability) as Promise<GhAvailabilityDto>,
  },

  // Spec 010 — a esteira nova. O renderer NUNCA lê disco nem calcula macro
  // etapa: recebe o snapshot já derivado pelo main (D-13) e desenha o que está
  // nele. O que não está no snapshot, a tela não inventa.
  esteira: {
    snapshot: () => ipcRenderer.invoke(ESTEIRA_CHANNELS.snapshot) as Promise<EsteiraSnapshotDto>,

    scanOutbox: () => ipcRenderer.invoke(ESTEIRA_CHANNELS.scanOutbox) as Promise<EsteiraSnapshotDto>,

    createDiscovery: (input: CreateDiscoveryIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.createDiscovery, input) as Promise<EsteiraCreateDiscoveryDto>,

    // D-2 — o documento de seed vai CRU para o main: quem o le e o parser puro,
    // para a redacao do erro (com caminho do campo) nascer de um lugar so.
    seed: (input: SeedIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.seed, input) as Promise<EsteiraSeedDto>,

    dispatch: (input: DispatchIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.dispatch, input) as Promise<EsteiraDispatchDto>,

    // Batch B1 — os dois fatos do ciclo de vida da aba que o disparo abre:
    // alguém assumiu a sessão, e a sessão acabou sem a fase concluir.
    claimSession: (input: ClaimSessionIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.claimSession, input) as Promise<EsteiraSnapshotDto>,

    endSession: (input: EndSessionIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.endSession, input) as Promise<EsteiraSnapshotDto>,

    releaseLock: (input: ReleaseLockIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.releaseLock, input) as Promise<EsteiraSnapshotDto>,

    // Os gestos que o store já entendia e a tela não oferecia (B3): ajuste de
    // macro etapa, estado do item, descarte (D-16) e nota. Criação de item NÃO
    // está aqui de propósito — D-16 manda ela passar sempre pela skill.
    setStageOverride: (input: SetStageOverrideIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.setStageOverride, input) as Promise<EsteiraGestureDto>,
    setDiscoveryRepos: (input: SetDiscoveryReposIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.setDiscoveryRepos, input) as Promise<EsteiraGestureDto>,

    setWorkItemState: (input: SetWorkItemStateIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.setWorkItemState, input) as Promise<EsteiraGestureDto>,

    discardWorkItem: (input: DiscardWorkItemIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.discardWorkItem, input) as Promise<EsteiraGestureDto>,

    addNote: (input: AddNoteIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.addNote, input) as Promise<EsteiraGestureDto>,

    // D-12 — reenvio do espelho. O board é destino opcional: falhar aqui nunca
    // muda o que já aconteceu localmente.
    retryMirror: () => ipcRenderer.invoke(ESTEIRA_CHANNELS.retryMirror) as Promise<EsteiraSnapshotDto>,

    // C3 — lê o texto de um artefato (D-8), só leitura.
    readArtifactText: (input: ReadArtifactTextIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.readArtifactText, input) as Promise<ReadArtifactTextDto>,

    onChanged: (listener: (state: EsteiraSnapshotDto) => void) => {
      const handler = (_event: unknown, state: EsteiraSnapshotDto): void => listener(state);
      return subscribeChannel(ipcRenderer, ESTEIRA_CHANNELS.changed, handler);
    },
  },

  // 014-chat (T049) — conversa da aba como chat. Cada evento tem UM assinante (a
  // `ChatStore` do renderer, que distribui por ptyId): trava do subscribeChannel.
  chat: {
    attach: (ptyId: string) => ipcRenderer.invoke(CHAT_CHANNELS.attach, { ptyId }) as Promise<ChatSnapshot>,
    detach: (ptyId: string) => ipcRenderer.invoke(CHAT_CHANNELS.detach, { ptyId }) as Promise<void>,
    loadOlder: (ptyId: string, scope: RowScope, cursor: string) =>
      ipcRenderer.invoke(CHAT_CHANNELS.loadOlder, { ptyId, scope, cursor }) as Promise<ChatLoadOlderOutput>,
    rowDetail: (input: ChatRowDetailInput) => ipcRenderer.invoke(CHAT_CHANNELS.rowDetail, input) as Promise<RowDetail>,
    openExternal: (url: string) => ipcRenderer.invoke(CHAT_CHANNELS.openExternal, { url }) as Promise<void>,
    openGenerated: (ptyId: string, path: string) => ipcRenderer.invoke(CHAT_CHANNELS.openGenerated, { ptyId, path }) as Promise<void>,

    catalog: (ptyId: string) => ipcRenderer.invoke(CHAT_CHANNELS.catalog, { ptyId }) as Promise<ChatCatalogOutput>,
    files: (ptyId: string, query: string, limit: number) =>
      ipcRenderer.invoke(CHAT_CHANNELS.files, { ptyId, query, limit }) as Promise<ChatFilesOutput>,

    saveImage: (ptyId: string, bytes: ArrayBuffer, mediaType: string) =>
      ipcRenderer.invoke(CHAT_CHANNELS.saveImage, { ptyId, bytes, mediaType }) as Promise<ChatSaveImageOutput>,
    pathForFile: (file: unknown): string => {
      try {
        return webUtils.getPathForFile(file as File);
      } catch {
        return '';
      }
    },
    ackLookup: (ptyId: string, text: string, since: string) =>
      ipcRenderer.invoke(CHAT_CHANNELS.ackLookup, { ptyId, text, since }) as Promise<ChatAckLookupOutput>,
    screenState: (ptyId: string, terminalNeeded: TerminalNeededReason | null) =>
      ipcRenderer.invoke(CHAT_CHANNELS.screenState, { ptyId, terminalNeeded }) as Promise<void>,

    // T076/T079 - pendencias e foco
    answer: (ptyId: string, pendingId: string, answer: PendingAnswer) =>
      ipcRenderer.invoke(CHAT_CHANNELS.answer, { ptyId, pendingId, answer }) as Promise<ChatAnswerOutput>,
    focusState: (activePtyId: string | null, tabNames?: Readonly<Record<string, string>>) =>
      ipcRenderer.invoke(CHAT_CHANNELS.focusState, { activePtyId, ...(tabNames !== undefined ? { tabNames } : {}) }) as Promise<void>,
    onFocusPending: (listener: (event: ChatFocusPendingEvent) => void) => {
      const handler = (_event: unknown, payload: ChatFocusPendingEvent): void => listener(payload);
      return subscribeChannel(ipcRenderer, CHAT_CHANNELS.focusPending, handler);
    },

    onRows: (listener: (event: ChatRowsEvent) => void) => {
      const handler = (_event: unknown, payload: ChatRowsEvent): void => listener(payload);
      return subscribeChannel(ipcRenderer, CHAT_CHANNELS.rows, handler);
    },
    onLive: (listener: (event: ChatLiveEvent) => void) => {
      const handler = (_event: unknown, payload: ChatLiveEvent): void => listener(payload);
      return subscribeChannel(ipcRenderer, CHAT_CHANNELS.live, handler);
    },
    onConversationSwitched: (listener: (event: ChatConversationSwitchedEvent) => void) => {
      const handler = (_event: unknown, payload: ChatConversationSwitchedEvent): void => listener(payload);
      return subscribeChannel(ipcRenderer, CHAT_CHANNELS.conversationSwitched, handler);
    },
    onReception: (listener: (event: ChatReceptionEvent) => void) => {
      const handler = (_event: unknown, payload: ChatReceptionEvent): void => listener(payload);
      return subscribeChannel(ipcRenderer, CHAT_CHANNELS.reception, handler);
    },
    onPromptSignal: (listener: (event: ChatPromptSignalEvent) => void) => {
      const handler = (_event: unknown, payload: ChatPromptSignalEvent): void => listener(payload);
      return subscribeChannel(ipcRenderer, CHAT_CHANNELS.promptSignal, handler);
    },
  },

  // 015-jobu-pet — exposed in BOTH windows (the pet loads the same preload, R18); each one uses its own
  // half. Each `onX` has ONE subscriber (the App in the main window, the PetApp in the pet): a lock of subscribeChannel.
  // Everything that leaves the pet is `send` (no reply): the main never blocks a gesture waiting for a return.
  pet: {
    // --- main window ---
    sendTabs: (payload: PetTabsPayload) => {
      ipcRenderer.send(PET_CHANNELS.tabs, payload);
    },
    onActivateSession: (listener: (payload: PetActivateSessionPayload) => void) => {
      const handler = (_event: unknown, payload: PetActivateSessionPayload): void => listener(payload);
      return subscribeChannel(ipcRenderer, PET_CHANNELS.activateSession, handler);
    },
    onPrefsChanged: (listener: (payload: PetPrefsChangedPayload) => void) => {
      const handler = (_event: unknown, payload: PetPrefsChangedPayload): void => listener(payload);
      return subscribeChannel(ipcRenderer, PET_CHANNELS.prefsChanged, handler);
    },

    // --- pet window ---
    ready: () => {
      ipcRenderer.send(PET_CHANNELS.ready);
    },
    onView: (listener: (view: PetView) => void) => {
      const handler = (_event: unknown, view: PetView): void => listener(view);
      return subscribeChannel(ipcRenderer, PET_CHANNELS.view, handler);
    },
    onCloseList: (listener: () => void) => {
      const handler = (): void => listener();
      return subscribeChannel(ipcRenderer, PET_CHANNELS.closeList, handler);
    },
    setInteractive: (interactive: boolean) => {
      ipcRenderer.send(PET_CHANNELS.interactive, { interactive });
    },
    click: () => {
      ipcRenderer.send(PET_CHANNELS.click);
    },
    open: (target: PetOpenTarget) => {
      ipcRenderer.send(PET_CHANNELS.open, { target });
    },
    setListOpen: (open: boolean) => {
      ipcRenderer.send(PET_CHANNELS.listOpen, { open });
    },
    openContextMenu: (point?: PetDragPayload) => {
      ipcRenderer.send(PET_CHANNELS.contextMenu, point);
    },
    dragStart: (screenX: number, screenY: number) => {
      ipcRenderer.send(PET_CHANNELS.dragStart, { screenX, screenY });
    },
    dragMove: (screenX: number, screenY: number) => {
      ipcRenderer.send(PET_CHANNELS.dragMove, { screenX, screenY });
    },
    dragEnd: (screenX: number, screenY: number) => {
      ipcRenderer.send(PET_CHANNELS.dragEnd, { screenX, screenY });
    },
    resizeStep: (direction: 1 | -1) => {
      ipcRenderer.send(PET_CHANNELS.resizeStep, { direction });
    },
  },
};

contextBridge.exposeInMainWorld('donel', donelApi);
