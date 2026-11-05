// Tipos IPC compartilhados entre main/preload/renderer (plan.md "Arquitetura
// de processos"). CommandBuilder chega em T006 (TDD); os tipos abaixo cobrem
// os canais `pty:*` introduzidos em T004. Canais `projects:*` chegam no T007
// (src/shared/projects.ts) — os demais (sessions:*, profiles:*, config:*)
// chegam junto das tasks que os implementam.

import type { AccountId, DonelAccountsApi } from './accounts';
import type { DonelMigrationApi } from './migration';
import type { DonelConfigApi } from './config';
import type { DonelDevModeApi } from './devMode';
import type { DonelChatApi } from './chat/api';
import type { DonelPetApi } from './pet/ipc';
import type { DonelLiderApi } from './lider/ipc';
import type { DonelRotinasApi } from './rotinas/contract';
import type { DonelEsteiraApi } from './esteira/ipc';
import type { DonelGithubApi } from './github';
import type { DonelProjectBindingApi } from './projectBinding';
import type { DonelProjectsApi } from './projects';
import type { DonelStatusLineApi } from './statusLine';
import type { DonelProvidersApi } from './providers';
import type { DonelSessionsApi } from './sessions';
import type { DonelTabsApi } from './tabChannels';
import type { DonelMindscapeApi } from './mindscape/channels';
import type { DonelLedgerApi } from './ledger/channels';
import type { DonelRolesApi } from './roles';
import type { DonelRenewalApi } from './sessionRenewal';
import type { DonelLearningApi } from './learning/gestures';
import type { DonelHealthApi } from './health/ipc';
import type { DonelAppUpdateApi } from './appUpdate';
import type { DonelWorkspaceApi } from './workspace';
import type { DonelBrowserApi } from './browser/ipc';

// 015-jobu-pet — the Jobu contract (channels, payloads, validators) lives in ./pet/ipc.
export type { DonelPetApi } from './pet/ipc';

export { PROJECT_CHANNELS, sortProjects } from './projects';
export type { DonelProjectsApi, ProjectInfo } from './projects';

// CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero pelo app"
// (US-15 do backlog.md). Validação pura do nome da pasta + contrato IPC
// aqui; o encanamento de disco (mkdir, marcador CLAUDE.md, `git init`
// best-effort) vive em src/main/project-creator.ts.
export {
  isValidCreateProjectIpcInput,
  NEW_PROJECT_CHANNEL,
  resolveGithubCloneUrl,
  validateProjectFolderName,
} from './newProject';
export type {
  CreateProjectErrorReason,
  CreateProjectIpcInput,
  CreateProjectResponse,
  CreateProjectResult,
  ProjectFolderNameErrorReason,
  ProjectFolderNameValidation,
  ProjectSourceMode,
} from './newProject';

export { SESSION_CHANNELS, TRANSCRIPT_CHANNELS } from './sessions';
export type { DonelSessionsApi, SessionSummaryDto, SessionSwitchedPayload, SessionWhereLives, TranscriptChangedPayload } from './sessions';

// T710 (007/CA-11 2º momento) — decisão de esquecer a entrada órfã quando a
// retomada falha. Puro; medição do sinal em specs/008-fechar-pendencias/.
export { RESUME_FAILURE_WINDOW_MS, forgetIfOrphan, resumedSessionIdFromArgs, shouldForgetOnResumeFailure } from './resumeFailure';
export type { ResumeFailureSignal } from './resumeFailure';

export { CONFIG_CHANNELS } from './config';
export type { AppConfigDto, AutoModePrefs, ChatPrefs, DonelConfigApi, LauncherDefaultsDto, NotificationPreference, PetPrefs, PetPrefsInput, ProjectScanMode, SessionNamesMap, YoloPrefs } from './config';

// CA-26/CA-27 (009-modo-dev-v3, lote 1) — aba v3: reordenar (CA-26) e cor por
// aba (CA-27). Lógica pura em tabAppearance.ts; canais `tabs:*` em
// tabChannels.ts (arquivo separado — ver comentário de topo de lá).
export { isTabColorToken, reorderTabs, setTabColor, setTabOrder, TAB_COLOR_TOKENS } from './tabAppearance';
export type { TabAppearance, TabAppearanceMap, TabColorToken } from './tabAppearance';
export { TAB_CHANNELS } from './tabChannels';
export type { DonelTabsApi } from './tabChannels';

// 003-modo-dev (T301/T307) — estado próprio do Modo Dev + canais `devMode:*`.
export {
  DEVMODE_CHANNELS,
  archivePhaseSession,
  archivedPhaseSessionKey,
  closeDiscovery,
  focusDiscovery,
  isArchivedSessionProfileMismatch,
  isValidArchivePhaseSessionIpcInput,
  isValidCardId,
  isValidCardIdList,
  isValidOpenDiscoveryIpcInput,
  isValidResolveCardRepoIpcInput,
  isValidResolveCardReposIpcInput,
  isValidWatchPhaseIpcInput,
  linkDiscoveryRepo,
  openDiscovery,
} from './devMode';
export type {
  ArchivedPhaseSession,
  ArchivedPhaseSessions,
  ArchivePhaseSessionIpcInput,
  ArchivePhaseSessionKey,
  DevModeBoardConfig,
  DevModeDiscoveries,
  DevModeDiscovery,
  DevModeState,
  DonelDevModeApi,
  EsteiraPhase,
  OpenDiscoveryIpcInput,
  PhaseArchivedPayload,
  PhaseDefault,
  PhaseDefaultsTable,
  ResolveCardRepoIpcInput,
  ResolveCardReposIpcInput,
  WatchPhaseIpcInput,
} from './devMode';

export { DEFAULT_PHASE_DEFAULTS, resolveCommandText } from './devModeDefaults';

// CA-23 (009-modo-dev-v3, lote 3) — engrenagem de configuração por projeto:
// board (workspaceId/teamId) + repo do GitHub, hoje editados à mão fora do
// app (spec.md problema 8). Lógica pura + contrato IPC em src/shared/
// projectBinding.ts; o encanamento de disco (paths reais, atomicidade) vive
// em src/main/esteira-config.ts.
export {
  isValidSaveProjectBindingIpcInput,
  mergeBoardIds,
  mergeRepoEntry,
  mergeRepoGithub,
  PROJECT_BINDING_CHANNELS,
  readAllRepoEntries,
  readBoardIds,
  readProjectBinding,
  readRepoBoard,
  readRepoGithub,
  readRepoGithubExtra,
} from './projectBinding';
export type {
  DonelProjectBindingApi,
  ProjectBindingDto,
  RepoEntry,
  RepoEntryUpdate,
  RepoGithubUpdate,
  SaveProjectBindingIpcInput,
  SaveProjectBindingResult,
} from './projectBinding';

// CA-3/CA-5 (009-modo-dev-v3, lote 4) — canal IPC do GitHub reader
// (src/main/github-reader.ts): spec-issue, sub-issues nativas, PR da fase +
// etiquetas homologado/revertido-ciclo, por `gh` CLI via spawn. Só leitura.
export { GITHUB_CHANNELS, isValidGithubReadRequest } from './github';
export type { DonelGithubApi, GhAvailabilityDto, GithubReadRequest, GithubReadResponse } from './github';

// Spec 010 / B6 — `DiscoveryTree`/`PlanCardNode`/`PhaseNode` saíram com o
// leitor de árvore do modelo antigo: não há mais árvore de disco. O que o mapa consome hoje é
// a projeção do store (`renderer/src/DevMode/esteiraMapView.ts`).
/** Card da porta de entrada e os fatos do board — tipo só, `import type` erasa no build. */
export type { BoardFacts, EntryColumn, EntryColumnCard } from '../main/taskdex-board-client';
/** Issue #34 — resultado de `devMode:resolveCardRepo`; mesmo motivo do `DiscoveryTree` acima: tipo só, `import type` erasa no build. */
export type { CardRepoResolution, RepoCandidate } from '../main/cardRepoResolver';

// Spec 010 / B6 — o view-model do painel direito saiu com o modelo antigo
// (ele lia o nó de fase da árvore de disco). O painel é
// alimentado hoje por `renderer/src/DevMode/esteiraMapView.ts`, sobre o store.

// 004-nomear-sessoes — resolução do nome exibido de uma sessão (T401) e
// validação do nome digitado (T406). Usados no main (persistência) e no
// renderer (label da aba e da sidebar).
export {
  SESSION_NAME_MAX_LENGTH,
  extractCustomTitle,
  extractCustomTitleFromLine,
  normalizeSessionName,
  reconcileStoredName,
  resolveSessionName,
} from './sessionName';
export type { ResolveSessionNameInput, StoredSessionName } from './sessionName';

// 005-terminal-copy-paste (T502) — decisor puro tecla -> ação (copiar/colar/
// interromper por tipo de aba), usado pelo TerminalPane via
// `attachCustomKeyEventHandler`. Ver src/shared/terminalKeymap.ts.
export { IMAGE_PASTE_SEQUENCE, resolveTerminalKeyAction } from './terminalKeymap';
export type { TerminalKeyAction, TerminalKeyContext, TerminalKeyDescriptor } from './terminalKeymap';

// 011-contas-e-provedores (etapa 1) — motor de contas + mods. `CredentialPair`
// NUNCA sai de src/main/accounts/ (regra dura); tudo aqui é seguro de expor
// ao renderer.
export {
  ACCOUNT_CHANNELS,
  defaultAccountsConfig,
  defaultAutoSwitchPolicy,
  overallLoad,
} from './accounts';
export type {
  AccountId,
  AccountLoad,
  AccountsConfig,
  AccountsConfigDto,
  SeazonePoolConfig,
  AccountsViewDto,
  AccountSummary,
  AutoSwitchPolicy,
  BeginLoginOutcome,
  ConnectModInput,
  ConnectModOutcome,
  DonelAccountsApi,
  LocalAccountMeta,
  LoginStatusDto,
  ModId,
  RemotePlace,
  RemotePlaceView,
  RemoteSwitchOutcome,
  RemoveAccountOutcome,
  SwitchOutcome,
} from './accounts';

// 011-contas-e-provedores (etapa 2) — assistente de migração (temporário:
// existe enquanto houver `~/.claude-profiles`). Nenhum canal devolve
// conteúdo de arquivo de perfil, em nenhuma direção.
export { MIGRATION_CHANNELS } from './migration';
export type {
  ArchiveOutcome,
  ConsolidateResult,
  ConsolidationKind,
  DonelMigrationApi,
  ImportResult,
  McpDiff,
  MigrationPlan,
  MigrationPlanEntry,
  ProfileMigrationStep,
} from './migration';

// 011-contas-e-provedores (etapa 3) — registry de providers classe A. Mesmo
// espírito de accounts: nenhum campo aqui carrega valor de segredo (fica só
// no cofre, src/main/providers/provider-secrets.ts).
export { defaultProvidersConfig, PROVIDER_CHANNELS } from './providers';
export type {
  DonelProvidersApi,
  ProviderClass,
  ProviderEntry,
  ProviderId,
  ProviderSummaryDto,
  ProvidersConfigDto,
  ResolveLaunchResult,
  SetSecretResult,
  UpsertProviderInput,
  UpsertProviderResult,
  ValidationReason,
} from './providers';

/** Nomes dos canais IPC do domínio PTY (plan.md linha 37). */
export const PTY_CHANNELS = {
  create: 'pty:create',
  input: 'pty:input',
  resize: 'pty:resize',
  kill: 'pty:kill',
  data: 'pty:data',
  exit: 'pty:exit',
  preview: 'pty:preview',
  /** Sessões remotas — sessions still alive on the remote places (boot reattach). */
  remoteAlive: 'pty:remoteAlive',
} as const;

export interface PtyCreateOptions {
  /** Colunas iniciais (medidas pelo xterm/addon-fit no renderer). */
  cols: number;
  /** Linhas iniciais (medidas pelo xterm/addon-fit no renderer). */
  rows: number;
  /** Diretório de trabalho; default = home do usuário (T004 não tem contexto de projeto ainda). */
  cwd?: string;
  /**
   * 'shell' (default) = terminal livre (FR-008), spawna powershell.exe.
   * 'claude' (T005) = spawna o `claude` CLI direto no PTY (FR-006, plan.md
   * ponto 1) — o main process resolve o executável (PATH → fallback
   * `~/.local/bin/claude.exe`) e responde com erro CA-5 se não encontrar.
   */
  sessionType?: 'shell' | 'claude';
  /**
   * Argv extra do CommandBuilder (T008 — Launcher, FR-003/CA-1). Só tem
   * efeito quando `sessionType === 'claude'`; ignorado no terminal livre
   * (que sempre spawna `powershell.exe -NoLogo`, PtyManager.FREE_TERMINAL_ARGS).
   */
  args?: string[];
  /**
   * T1318 (011-contas-e-provedores, etapa 3, C13) — provider classe A
   * escolhido nesta sessão. Mutuamente exclusivo com o motor de contas
   * (D2): quando presente, o main resolve env/config dir pelo registry
   * (`resolveLaunch`) e IGNORA o motor. `undefined` = comportamento de hoje
   * (conta/perfil). Só tem efeito com `sessionType === 'claude'`.
   */
  providerId?: string;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — login isolado em andamento
   * (`accounts:beginLogin`, `IsolatedLoginManager`). O main resolve o
   * diretório (`getPendingDir`) e usa-o como `cwd`/`CLAUDE_CONFIG_DIR` desta
   * sessão — mutuamente exclusivo com `providerId`. Só tem efeito com
   * `sessionType === 'claude'`; esta aba nasce SEM argv do launcher, sem
   * hooks do semáforo (`--settings`) e sem `--session-id` — é só o `claude`
   * cru dentro de um diretório vazio, pro operador fazer `/login`.
   */
  accountLoginId?: string;
  /**
   * Sessão renovada em voo (B36) — this spawn replaces the session of a
   * renewal (`renewal:prepare`). The main links the new conversation to the
   * old one, so the tab's chat keeps showing the old history above a divider.
   * It changes nothing in the argv (the renderer already sent the args).
   */
  renewalId?: string;
  /**
   * Papéis de sessão (item 12a) — role of this session (`<userData>/papeis/<id>.md`), sent when the
   * renderer knows it (a place that had not started, the Launcher, a fork). Absent on a resume or a
   * renewal: the main reads the role of the place that holds the conversation in `mindscape.json`.
   */
  roleId?: string;
  /**
   * Sessões remotas — id of a remote place (`accounts.remotes`) where this session runs, inside a tmux
   * session that outlives the app. Absent = this computer. Only with `sessionType === 'claude'`.
   */
  remoteId?: string;
  /** Sessões remotas — names kept on the remote, so the next boot reopens the tab as it was. */
  tabName?: string;
  projectName?: string;
  /** Sessões remotas — place of the session that opened this one (`sessao_abrir`), kept so the next boot leaves it out of the tab bar. */
  openedBy?: string;
}

/** Sessões remotas — a session still alive on a remote place, found at boot. */
export interface RemoteAliveSession {
  readonly remoteId: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly projectName: string;
  readonly name: string;
  readonly launchArgs: readonly string[];
  readonly openedBy?: string;
}

/**
 * Prefixo reconhecido pelo renderer (TerminalPane) para distinguir o erro
 * "claude não encontrado" (CA-5) de qualquer outra falha de `pty:create`.
 * Compartilhado entre main e renderer para não duplicar a string literal.
 */
export const CLAUDE_NOT_FOUND_PREFIX = 'CLAUDE_NOT_FOUND:';

/**
 * Extrai o caminho esperado de um erro de `pty:create` rejeitado com o
 * prefixo `CLAUDE_NOT_FOUND:<path>` (CA-5), ou null se não for esse erro.
 * Puro (sem React/DOM) — usado pelo TerminalPane e testável isoladamente.
 */
export function parseClaudeNotFound(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const markerIndex = message.indexOf(CLAUDE_NOT_FOUND_PREFIX);
  if (markerIndex < 0) return null;
  return message.slice(markerIndex + CLAUDE_NOT_FOUND_PREFIX.length).trim();
}

export interface PtyCreateResult {
  ptyId: string;
  /**
   * T1219 (011-contas-e-provedores, etapa 2, C24) — CONTA ativa no momento
   * em que esta sessão nasceu (main/index.ts, motor de contas — ou o perfil
   * ativo legado enquanto o motor estiver inerte, C1/C10), o mesmo valor por
   * trás do `claudeConfigDir` passado a `PtyManager.create` (T014/FR-005).
   * Só preenchido pra `sessionType: 'claude'` — terminal livre (shell)
   * nunca aplica `CLAUDE_CONFIG_DIR`, então não tem "conta de nascimento"
   * (App.tsx usa isso pra distinguir os dois casos no rótulo da statusbar,
   * ver `sessionAccountLabel.ts`). `undefined` também é o valor legítimo de
   * um `pty:create` de shell — não é "ainda não resolvido". Campo chamava-se
   * `profile` até a etapa 1/início da 2 (`{slug, name}`) — renomeado junto
   * com a troca de vocabulário perfil → conta.
   */
  account?: { id: AccountId; label: string };
  /**
   * T404 (004-nomear-sessoes) — id da sessão do Claude para ESTA aba, o mesmo
   * que nomeia o `.jsonl` do transcript. O app não descobre esse id: ele o
   * IMPÕE no spawn (`--session-id <uuid>`, `session-correlation.ts:24-34`),
   * reusando o id do `-r` quando é retomada. Até aqui ele nunca chegava ao
   * renderer por caminho nenhum (o `SemaphoreUpdate` só leva
   * `ptyId`/`state`/`stateEnteredAt`); devolvê-lo no create é o caminho mais
   * barato — sem canal novo, sem estado novo — e é o que permite ao renderer
   * persistir o nome da sessão (CA-6). Só para `sessionType: 'claude'`:
   * terminal livre não tem sessão de Claude, e por isso não persiste nome (C4).
   */
  claudeSessionId?: string;
  /**
   * T1318 (011-contas-e-provedores, etapa 3, data-model.md §7) — preenchido
   * só quando a sessão nasceu de um provider classe A (`undefined` = sessão
   * de conta/perfil, o caso de hoje). Permite ao renderer rotular a
   * statusbar e resolver a origem do transcript/retomada (C17) sem carregar
   * nenhum valor de env sensível — `label` é o texto livre do operador.
   */
  provider?: { id: string; label: string };
}

export interface PtyExitInfo {
  exitCode: number;
  signal?: number;
}

/** API tipada exposta pelo preload em `window.donel.pty` (contextBridge). */
export interface DonelPtyApi {
  create(options: PtyCreateOptions): Promise<PtyCreateResult>;
  input(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  kill(ptyId: string): void;
  /** Ring buffer de ~50 linhas (ANSI stripado) — plan.md ponto 8, hover-preview futuro. */
  getPreview(ptyId: string): Promise<string[]>;
  /** Sessões remotas — sessions still alive on the remote places, to reopen at boot. */
  remoteAlive(): Promise<RemoteAliveSession[]>;
  /** Retorna função de unsubscribe. */
  onData(ptyId: string, listener: (data: string) => void): () => void;
  /** Retorna função de unsubscribe. */
  onExit(ptyId: string, listener: (info: PtyExitInfo) => void): () => void;
}

/** Nomes dos canais IPC do domínio semáforo (T009, FR-010). */
export const SEMAPHORE_CHANNELS = {
  update: 'semaphore:update',
} as const;

/**
 * Estados do semáforo expostos pro renderer. Definido localmente em vez de
 * reimportar `SessionState` de `@donel-dev/design-system` — este arquivo é
 * compartilhado com o MAIN process, que não deve puxar um pacote de UI (o
 * index do design-system importa CSS/fontes como efeito colateral). Os
 * valores têm que continuar batendo com `SessionState` (StateDot.tsx) —
 * são só os mesmos 5 nomes.
 */
export type SemaphoreState = 'working' | 'waiting' | 'permission' | 'error' | 'done';

export interface SemaphoreUpdate {
  readonly ptyId: string;
  readonly state: SemaphoreState;
  /** Epoch ms de quando `state` passou a valer (ui-spec §3 "há Xmin"; FR-010/CA-6 desempate por idade em `permission`). */
  readonly stateEnteredAt: number;
  /** #109 — see `SemaphoreStateInfo.awaitingBackgroundAgents`. */
  readonly awaitingBackgroundAgents?: true;
  /** Item 04 — see `SemaphoreStateInfo.unconfirmed`. */
  readonly unconfirmed?: true;
  /** Item 04 — see `SemaphoreStateInfo.pendingKinds`. */
  readonly pendingKinds?: readonly string[];
  /** Item 04 — see `SemaphoreStateInfo.turnFailure`. */
  readonly turnFailure?: string;
}

/** Payload do listener FILTRADO por ptyId (mesmo padrão de `PtyExitInfo`/`pty.onExit` — o `ptyId` já é conhecido pelo chamador, não precisa vir de novo dentro do payload). */
export interface SemaphoreStateInfo {
  readonly state: SemaphoreState;
  readonly stateEnteredAt: number;
  /** #109 — `waiting` with background agents still alive (the CLI will wake the session). Read by the renewal (B36): never swap then. */
  readonly awaitingBackgroundAgents?: boolean;
  /** Item 04 (cartão rico) — no hook heard yet: the `working` of the birth is a guess ("desconhecido"). */
  readonly unconfirmed?: boolean;
  /** Item 04 — kinds of the open pendings (`question`, `permission`, `plan`), with `permission`. */
  readonly pendingKinds?: readonly string[];
  /** Item 04 — the last turn ended in `StopFailure` with this code (`rate_limit`…, or `unknown`). */
  readonly turnFailure?: string;
}

/** API tipada exposta pelo preload em `window.donel.semaphore` (contextBridge). */
export interface DonelSemaphoreApi {
  /** Retorna função de unsubscribe. Mesmo padrão de `pty.onData`/`pty.onExit`: um canal IPC só (broadcast de todas as sessões), filtrado por `ptyId` na borda do preload. */
  onUpdate(ptyId: string, listener: (info: SemaphoreStateInfo) => void): () => void;
}

/** Nomes dos canais IPC do domínio clipboard (T504, plan.md Fatia 2 — mesmo padrão de PTY_CHANNELS). */
export const CLIPBOARD_CHANNELS = {
  hasImage: 'clipboard:hasImage',
  readText: 'clipboard:readText',
  writeText: 'clipboard:writeText',
} as const;

/**
 * API tipada exposta pelo preload em `window.donel.clipboard` (contextBridge).
 * O clipboard de verdade (`electron.clipboard`) vive no main process
 * (`src/main/clipboard-bridge.ts`) — o renderer nunca o alcança direto
 * (`contextIsolation: true`, sem `nodeIntegration`; plan.md decisão 6, não
 * usar `navigator.clipboard`).
 */
export interface DonelClipboardApi {
  hasImage(): Promise<boolean>;
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface DonelApi {
  pty: DonelPtyApi;
  projects: DonelProjectsApi;
  semaphore: DonelSemaphoreApi;
  /** Ponte da statusline — o JSON oficial do `statusLine` do CLI, por aba (src/shared/statusLine.ts). */
  statusLine: DonelStatusLineApi;
  sessions: DonelSessionsApi;
  /** 011-contas-e-provedores (etapa 1) — motor de contas + mods; nasce inerte (accounts.mod = null). */
  accounts: DonelAccountsApi;
  /** 011-contas-e-provedores (etapa 2) — assistente de migração de perfis → cofre. */
  migration: DonelMigrationApi;
  /** 011-contas-e-provedores (etapa 3) — registry de providers classe A; nasce inerte (`providers.entries = []`). */
  providers: DonelProvidersApi;
  /** T015 — ConfigStore (FR-007/FR-009); ver src/shared/config.ts. */
  config: DonelConfigApi;
  /** T504 (005-terminal-copy-paste) — clipboard-bridge no main, atrás de IPC. */
  clipboard: DonelClipboardApi;
  /** T307 (003-modo-dev) — estado do Modo Dev + leitura da árvore do discovery. */
  devMode: DonelDevModeApi;
  /** CA-26/CA-27 (009-modo-dev-v3) — cor + ordem da aba v3, persistidas por sessão claude. */
  tabs: DonelTabsApi;
  /** CA-23 (009-modo-dev-v3, lote 3) — engrenagem de configuração por projeto (board + repo GitHub). */
  projectBinding: DonelProjectBindingApi;
  /** CA-3/CA-5 (009-modo-dev-v3, lote 4) — leitura do GitHub por `gh` CLI (spec-issue, sub-issues, PR da fase). Só leitura. */
  github: DonelGithubApi;
  /** Spec 010 — a esteira nova (store de eventos + contrato com as skills), ao lado do Modo Dev atual. */
  esteira: DonelEsteiraApi;
  /** 014-chat — conversa da aba `claude` como chat (ler, paginar, abrir links). Com `chat.enabled = false` os pedidos rejeitam: não há handler. */
  chat: DonelChatApi;
  /** Mindscape V1 — one board per project, persisted in `mindscape.json` by the main. */
  mindscape: DonelMindscapeApi;
  /** Ledger com prova (item 19) — the tasks between places, in `ledger.json` (the main is the only writer). */
  ledger: DonelLedgerApi;
  /** Papéis de sessão (item 12a) — the roles in `<userData>/papeis/` (the main is the only writer). */
  roles: DonelRolesApi;
  /** Diário de gestos — what the owner does, kept only on this machine as examples for a local model (B35). */
  learning: DonelLearningApi;
  /** 015-jobu-pet — the Jobu on the desktop. Exposed in both windows (the main one and the pet's); each one uses its own half. */
  pet: DonelPetApi;
  /** Item 18 — the conversation with the Jobu as Líder, in its own window. */
  lider: DonelLiderApi;
  /** Saúde do computador — RAM, disco e processos que estão pesando, com a ação de encerrar um processo. */
  health: DonelHealthApi;
  /** B33 — versão nova do alfa: atualizar de dentro do app e reabrir as abas depois. */
  appUpdate: DonelAppUpdateApi;
  /** Sidebar — "Abrir no editor" (VS Code/Cursor) e branch atual da pasta da sessão/projeto. */
  workspace: DonelWorkspaceApi;
  /** Navegador integrado — o painel de navegador de cada aba de sessão, que o agente da sessão controla e o dono assume. */
  browser: DonelBrowserApi;
  /** Sessão renovada em voo (B36) — handoff instructions and reading the handoff header back. */
  renewal: DonelRenewalApi;
  /** Item 20 — what the routines in shadow would have woken today. */
  rotinas: DonelRotinasApi;
}
