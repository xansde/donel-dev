import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfigDto,
  ArchivePhaseSessionIpcInput,
  BoardFacts,
  CardRepoResolution,
  CopyTranscriptForResumeIpcInput,
  CopyTranscriptForResumeResult,
  CreateProjectIpcInput,
  CreateProjectResponse,
  DeleteProfileOutcome,
  DiscoveryTree,
  DonelApi,
  EntryColumnCard,
  GhAvailabilityDto,
  GithubReadRequest,
  GithubReadResponse,
  LauncherDefaultsDto,
  NotificationPreference,
  OpenDiscoveryIpcInput,
  PhaseArchivedPayload,
  PhaseDefaultsTable,
  ProfileDoctorReportDto,
  ProfileHeadroomMap,
  ProfileSummaryDto,
  ProjectBindingDto,
  ProjectInfo,
  ProjectScanMode,
  PtyCreateOptions,
  PtyCreateResult,
  PtyExitInfo,
  ResolveCardRepoIpcInput,
  ResolveCardReposIpcInput,
  SaveProjectBindingIpcInput,
  SaveProjectBindingResult,
  SemaphoreStateInfo,
  SemaphoreUpdate,
  SessionSummaryDto,
  TabColorToken,
  TranscriptChangedPayload,
  WatchPhaseIpcInput,
} from '../shared';
import {
  CONFIG_CHANNELS,
  DEVMODE_CHANNELS,
  GITHUB_CHANNELS,
  PROFILE_CHANNELS,
  PROJECT_BINDING_CHANNELS,
  PROJECT_CHANNELS,
  PTY_CHANNELS,
  SEMAPHORE_CHANNELS,
  SESSION_CHANNELS,
  TAB_CHANNELS,
  TRANSCRIPT_CHANNELS,
  TRANSCRIPT_COPY_CHANNELS,
} from '../shared';
// T504 (005-terminal-copy-paste) — canal do clipboard-bridge (main), aditivo
// aos imports acima (não reordena o bloco existente).
import { CLIPBOARD_CHANNELS } from '../shared';
// Spec 010 — canais e shapes da esteira nova.
import {
  ESTEIRA_CHANNELS,
  type ClaimSessionIpcInput,
  type CreateDiscoveryIpcInput,
  type DispatchIpcInput,
  type EndSessionIpcInput,
  type EsteiraCreateDiscoveryDto,
  type EsteiraDispatchDto,
  type EsteiraSnapshotDto,
  type ReleaseLockIpcInput,
} from '../shared/esteira/ipc';

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
    onTranscriptChanged: (listener: (payload: TranscriptChangedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TranscriptChangedPayload): void => {
        listener(payload);
      };
      ipcRenderer.on(TRANSCRIPT_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(TRANSCRIPT_CHANNELS.changed, handler);
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

  profiles: {
    list: () => ipcRenderer.invoke(PROFILE_CHANNELS.list) as Promise<ProfileSummaryDto[]>,

    create: (name: string) => ipcRenderer.invoke(PROFILE_CHANNELS.create, name) as Promise<ProfileSummaryDto[]>,

    activate: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.activate, slug) as Promise<ProfileSummaryDto[]>,

    doctor: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.doctor, slug) as Promise<ProfileDoctorReportDto>,

    repair: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.repair, slug) as Promise<ProfileDoctorReportDto>,

    // T205 — repassa `{ force }` cru pro main; o main é quem valida/normaliza
    // o payload (é IPC, não confia cegamente no que o renderer manda).
    headroom: (options?: { force?: boolean }) => ipcRenderer.invoke(PROFILE_CHANNELS.headroom, options) as Promise<ProfileHeadroomMap>,

    // Item 3 (rodada de feedback 30/07) — exclusão de perfil.
    delete: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.delete, slug) as Promise<DeleteProfileOutcome>,
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

  devMode: {
    get: () => ipcRenderer.invoke(DEVMODE_CHANNELS.get) as Promise<AppConfigDto>,

    openDiscovery: (input: OpenDiscoveryIpcInput) => ipcRenderer.invoke(DEVMODE_CHANNELS.openDiscovery, input) as Promise<AppConfigDto>,

    focusDiscovery: (cardId: string) => ipcRenderer.invoke(DEVMODE_CHANNELS.focusDiscovery, cardId) as Promise<AppConfigDto>,

    closeDiscovery: (cardId: string) => ipcRenderer.invoke(DEVMODE_CHANNELS.closeDiscovery, cardId) as Promise<AppConfigDto>,

    archivePhaseSession: (input: ArchivePhaseSessionIpcInput) =>
      ipcRenderer.invoke(DEVMODE_CHANNELS.archivePhaseSession, input) as Promise<AppConfigDto>,

    getDefaults: () => ipcRenderer.invoke(DEVMODE_CHANNELS.getDefaults) as Promise<AppConfigDto>,

    setDefaults: (defaults: PhaseDefaultsTable) => ipcRenderer.invoke(DEVMODE_CHANNELS.setDefaults, defaults) as Promise<AppConfigDto>,

    readTree: (cardId: string) => ipcRenderer.invoke(DEVMODE_CHANNELS.readTree, cardId) as Promise<DiscoveryTree>,

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
      ipcRenderer.on(DEVMODE_CHANNELS.phaseArchived, handler);
      return () => ipcRenderer.removeListener(DEVMODE_CHANNELS.phaseArchived, handler);
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

  // CA-24 (009-modo-dev-v3, lote 8) — "Reiniciar sessão em foco": copia o
  // `.jsonl` pro perfil ATIVO quando a sessão rodou em outro (achado 14).
  transcripts: {
    copyForResume: (input: CopyTranscriptForResumeIpcInput) =>
      ipcRenderer.invoke(TRANSCRIPT_COPY_CHANNELS.copyForResume, input) as Promise<CopyTranscriptForResumeResult>,
  },

  // Spec 010 — a esteira nova. O renderer NUNCA lê disco nem calcula macro
  // etapa: recebe o snapshot já derivado pelo main (D-13) e desenha o que está
  // nele. O que não está no snapshot, a tela não inventa.
  esteira: {
    snapshot: () => ipcRenderer.invoke(ESTEIRA_CHANNELS.snapshot) as Promise<EsteiraSnapshotDto>,

    scanOutbox: () => ipcRenderer.invoke(ESTEIRA_CHANNELS.scanOutbox) as Promise<EsteiraSnapshotDto>,

    createDiscovery: (input: CreateDiscoveryIpcInput) =>
      ipcRenderer.invoke(ESTEIRA_CHANNELS.createDiscovery, input) as Promise<EsteiraCreateDiscoveryDto>,

    dispatch: (input: DispatchIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.dispatch, input) as Promise<EsteiraDispatchDto>,

    // Batch B1 — os dois fatos do ciclo de vida da aba que o disparo abre:
    // alguém assumiu a sessão, e a sessão acabou sem a fase concluir.
    claimSession: (input: ClaimSessionIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.claimSession, input) as Promise<EsteiraSnapshotDto>,

    endSession: (input: EndSessionIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.endSession, input) as Promise<EsteiraSnapshotDto>,

    releaseLock: (input: ReleaseLockIpcInput) => ipcRenderer.invoke(ESTEIRA_CHANNELS.releaseLock, input) as Promise<EsteiraSnapshotDto>,

    onChanged: (listener: (state: EsteiraSnapshotDto) => void) => {
      const handler = (_event: unknown, state: EsteiraSnapshotDto): void => listener(state);
      ipcRenderer.on(ESTEIRA_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(ESTEIRA_CHANNELS.changed, handler);
    },
  },
};

contextBridge.exposeInMainWorld('donel', donelApi);
