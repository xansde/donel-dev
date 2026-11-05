import { app, BrowserWindow, ipcMain, Notification, protocol, safeStorage, screen, shell, webContents } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { readUserDefaultPermissionMode, readUserStatusLine } from './cli-user-settings';
import { createStatusLineStore } from './statusline-store';
import { STATUS_LINE_CHANNELS, type StatusLineChangedPayload, type StatusLineSnapshot } from '../shared/statusLine';
import { appMcpAllowArgs, roleDeliveryFor, withResolvedPermissionMode } from '../shared/commandBuilder';
import type { DevModeBoardConfig } from '../shared/devMode';
// Spec 010 — esteira nova: serviço (store + ingestão + disparo) e a fronteira IPC.
import { createEsteiraService, type EsteiraService } from './esteira-service';
import { esteiraStoreDir } from './esteira-store';
import { createMindscapeStore, mindscapeFilePath } from './mindscape-store';
import { createRolesStore, type RolesStore } from './roles-store';
import { roleOfSession } from '../shared/mindscape/model';
import { ROLES_CHANNELS, type RoleSaveResult, type SessionRole } from '../shared/roles';
import { createMindscapeImages, mindscapeImagesDir } from './mindscape-images';
import { MINDSCAPE_CHANNELS } from '../shared/mindscape/channels';
// Sessão renovada em voo (B36).
import { createSessionRenewalService, type SessionRenewalService } from './session-renewal';
import { SESSION_RENEWAL_CHANNELS, sanitizeSessionRenewalPrefs, type HandoffStatus, type RenewalPrepared, type SessionRenewalPrefs } from '../shared/sessionRenewal';
import { LEARNING_CHANNELS, parseRendererGesture, type GestureEvent } from '../shared/learning/gestures';
import { createGestureDiary, type GestureDiary } from './gesture-diary';
import type { MindscapeReadImageResult, MindscapeSaveImageResult, MindscapeSaveResult, MindscapeTurnEndedPayload } from '../shared/mindscape/channels';
import type { MindscapeDoc } from '../shared/mindscape/model';
import { esteiraOutboxDir } from './esteira-ingest';
import { esteiraInboxDir } from './esteira-dispatch';
import { resolveBoardMirrorAdapter } from './esteira-mirror';
import { MIRROR_CONFIG_FILE, parseMirrorConfig } from '../shared/esteira/mirror/mirrorConfig';
import {
  ESTEIRA_CHANNELS,
  isValidAddNoteIpcInput,
  isValidClaimSessionIpcInput,
  isValidCreateDiscoveryIpcInput,
  isValidDiscardWorkItemIpcInput,
  isValidDispatchIpcInput,
  isValidEndSessionIpcInput,
  isValidReadArtifactTextIpcInput,
  isValidReleaseLockIpcInput,
  isValidSeedIpcInput,
  isValidSetDiscoveryReposIpcInput,
  isValidSetStageOverrideIpcInput,
  isValidSetWorkItemStateIpcInput,
  type EsteiraCreateDiscoveryDto,
  type EsteiraDispatchDto,
  type EsteiraGestureDto,
  type EsteiraSeedDto,
  type EsteiraSnapshotDto,
  type ReadArtifactTextDto,
} from '../shared/esteira/ipc';
import type {
  AccountId,
  AccountsConfigDto,
  AccountsViewDto,
  AppConfigDto,
  ArchiveOutcome,
  ArchivePhaseSessionIpcInput,
  BeginLoginOutcome,
  ConnectModInput,
  ConnectModOutcome,
  ConsolidateResult,
  ImportResult,
  MigrationPlan,
  CreateProjectResponse,
  GhAvailabilityDto,
  GithubReadRequest,
  GithubReadResponse,
  AutoModePrefs,
  ChatPrefs,
  LauncherDefaultsDto,
  NotificationPreference,
  OpenDiscoveryIpcInput,
  PhaseDefaultsTable,
  ProjectBindingDto,
  ProjectInfo,
  ProjectScanMode,
  PtyCreateOptions,
  PtyCreateResult,
  RemoteAliveSession,
  PhaseArchivedPayload,
  PtyExitInfo,
  RemoteSwitchOutcome,
  RemoveAccountOutcome,
  ResolveCardRepoIpcInput,
  ResolveCardReposIpcInput,
  SaveProjectBindingIpcInput,
  SaveProjectBindingResult,
  ModId,
  SemaphoreUpdate,
  SessionSummaryDto,
  SessionWhereLives,
  SwitchOutcome,
  TranscriptChangedPayload,
  SessionSwitchedPayload,
  WatchPhaseIpcInput,
  // 011-contas-e-provedores (etapa 3) — registry de providers classe A.
  ProviderId,
  ProviderSummaryDto,
  SetSecretResult,
  UpsertProviderInput,
  UpsertProviderResult,
} from '../shared';
import {
  ACCOUNT_CHANNELS,
  PROVIDER_CHANNELS,
  archivePhaseSession,
  CLAUDE_NOT_FOUND_PREFIX,
  closeDiscovery,
  CONFIG_CHANNELS,
  DEVMODE_CHANNELS,
  focusDiscovery,
  GITHUB_CHANNELS,
  MIGRATION_CHANNELS,
  isValidArchivePhaseSessionIpcInput,
  isValidCardId,
  isValidCardIdList,
  isValidCreateProjectIpcInput,
  isValidGithubReadRequest,
  isValidOpenDiscoveryIpcInput,
  isValidResolveCardRepoIpcInput,
  isValidResolveCardReposIpcInput,
  isValidSaveProjectBindingIpcInput,
  isValidWatchPhaseIpcInput,
  normalizeSessionName,
  openDiscovery,
  PROJECT_BINDING_CHANNELS,
  PROJECT_CHANNELS,
  PTY_CHANNELS,
  readAllRepoEntries,
  readRepoBoard,
  SEMAPHORE_CHANNELS,
  SESSION_CHANNELS,
  TAB_CHANNELS,
  TRANSCRIPT_CHANNELS,
} from '../shared';
import { createSystemResolveDeps, resolveClaudeExecutable, type ResolveClaudeDeps } from './claude-executable';
import {
  clearSessionName,
  CONFIG_FILE_NAME,
  createSystemConfigIoDeps,
  defaultAppConfig,
  LEGACY_ACTIVE_PROFILE_FILE_NAME,
  LEGACY_PROJECT_CONFIG_FILE_NAME,
  readAppConfig,
  sanitizeAutoModePrefs,
  sanitizeChatPrefs,
  sanitizePhaseDefaultsTable,
  setSessionName,
  toAppConfigDto,
  toggleFavorite,
  writeAppConfig,
  type AppConfig,
} from './config-store';
import { resolveCardRepo, resolveCardRepos, type CardRepoResolution } from './cardRepoResolver';
import {
  createSystemEsteiraConfigIoDeps,
  esteiraConfigDir,
  readProjectBindingFromDisk,
  reposConfigPath,
  trySaveProjectBindingToDisk,
} from './esteira-config';
import { createSystemFileReadIoDeps } from './file-io';
import { watchEsteiraResult, type EsteiraResultWatcherHandle } from './esteira-result-watcher';
import {
  checkGhAvailability,
  GithubReadCache,
  readPhasePullRequestFacts,
  readSpecIssueFacts,
  readSubIssueFacts,
} from './github-reader';
import {
  boardConfigFromCredential,
  listEntryColumnCards,
  loadTaskdexServiceCredential,
  createSystemBoardLocksReader,
  EMPTY_BOARD_LOCKS_READER,
  mergeLockedPhases,
  readBoardFactsFor,
  resolveBoardFactsReader,
  resolveBoardReader,
  type BoardFacts,
  type EntryColumnCard,
} from './taskdex-board-client';
import { createJsonRpcCallTool, createSystemHttpPostJson } from './taskdex-mcp-transport';
import {
  buildSessionHooksSettings,
  cleanupStaleHookSettings,
  planStatusLineBridge,
  removeSessionHooksSettings,
  statusLineBridgeMode,
  writeHooksSettingsFile,
  writeSessionHooksSettings,
} from './hooks-settings';
import { createHookBridge, type BridgeEvent, type HookBridge } from './hook-bridge';
import {
  buildAttachSshArgs,
  buildRemoteSetupScript,
  discoverRemoteSessions,
  findRemoteTranscript,
  parseRemoteSetupOutput,
  pickRemotePort,
  remoteDirFor,
  RemoteSessionRegistry,
  runRemoteScript,
  type RemoteFile,
  type RemoteSessionMeta,
} from './remote-session';
import { createDiagnosticsLog } from './chat/diagnostics-log';
import { resolveMainRepoRootSync } from './session-worktree';
import { ATTACHMENT_MAX_AGE_MS, AttachmentStore } from './chat/attachments';
import { createChatHub, type ChatHub, type ChatSourceInfo } from './chat/chat-hub';
import { registerChatIpcHandlers } from './chat/chat-ipc';
import { createCommandCatalogScanner } from './chat/command-catalog-scanner';
import { createProjectFiles } from './chat/project-files';
import { createPendingNotifier, type NotificationLike } from './chat/notifications';
import { createAttentionNotifier } from './attention/attention-notifier';
import { createTaskbarAttention, type AttentionSmokeSnapshot } from './attention/taskbar';
import { failureReasonText } from '../shared/attention/rule';
import { registerAssetScheme, registerAssetsProtocol } from './chat/assets-protocol';
import { CHAT_CHANNELS } from '../shared/chat/ipc';
// 011-contas-e-provedores (etapa 1) — motor de contas + mods. Nasce inerte
// (accounts.mod = null); toda a mecânica mora em src/main/accounts/, este
// arquivo só instancia/liga (T1125 — única task que toca o hub).
import { AccountEngine } from './accounts/account-engine';
// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — dono do ciclo de vida do
// motor: decide construir/reconstruir/atualizar via `needsEngineRebuild`.
import { AccountEngineHost } from './accounts/account-engine-host';
// 011-contas-e-provedores, etapa 3, Fase 2 (D3) — registro em memória
// compartilhado entre reconstruções do motor (item 1 do Bloco 3).
import { createReconnectRegistry } from './accounts/reconnect-registry';
// Fase 2 (revisão, R1) — uma renovação por conta de cada vez entre reconstruções do motor.
import { createRefreshCoordinator } from './accounts/refresh-coordinator';
// 011-contas-e-provedores, etapa 3, Fase 1 — planos PUROS de "remover conta"
// e "desconectar" (quais chaves o cofre perde, config final). Fase 1, Bloco
// 2 — o que o login isolado grava em `appConfig.accounts` depois de colher.
// Fase 2 (D3) — `planReconnect` decide se um `id` pode reconectar
// (`accounts:beginReconnect`, item 4 do Bloco 3).
import { applyHarvestedAccount, findAccountByFingerprint, findAccountById, planConnectSeazonePool, planDisconnect, planReconnect, planRemoveAccount } from './accounts/account-pool';
import type { AccountMod } from './accounts/account-mod';
// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — colhedor do login
// isolado (plan-etapa-3.md §4.2): `<userData>/accounts-login-<uuid>/`, poll
// do diretório, cofre, e a limpeza obrigatória no fim (sucesso ou falha).
import { IsolatedLoginManager, type IsolatedLoginFsDeps } from './accounts/isolated-login';
import { sanitizeAccountsConfig } from './accounts/accounts-config';
import { adoptRefreshedActivePair, applyAccountSwitch, createSystemClaudeStateIoDeps, readCurrentCredentialPair } from './accounts/claude-state';
import { accountFingerprintFromClaudeJsonText } from './accounts/credentials-file';
import { createLocalMod } from './accounts/mods/local-mod';
import { createRemoteClaudeState } from './accounts/remote-claude-state';
import { createSeazoneMod } from './accounts/mods/seazone-mod';
import { createLocalWithPoolMod } from './accounts/mods/local-with-pool-mod';
// 011-contas-e-provedores, etapa 3, Fase 1 (F2) — valida o par colado à mão (fallback do "conectar conta"; login isolado é a Fase 1.2).
import { buildPastedPair } from './accounts/pasted-pair';
import { createSystemVaultIoDeps, decryptVaultEntry, deleteVaultEntries, writeVaultEntry, type VaultLike } from './accounts/vault';
// 011-contas-e-provedores, etapa 3, Fase 1 — faxina do cofre no boot
// (plan-etapa-3.md §4.4): remove entrada de conta órfã + `seazone:session`,
// nunca `provider:*`.
import { reconcileAccountsVault } from './accounts/vault-reconciliation';
// 011-contas-e-provedores (etapa 2) — assistente de migração de perfis →
// cofre (T1214). Temporário: existe enquanto houver `~/.claude-profiles`.
import { archiveProfiles, createSystemArchiveIoDeps } from './accounts/migration/archive-profiles';
import { createSystemCredentialsImportDeps, importProfileCredentials } from './accounts/migration/credentials-import';
import { buildMigrationPlan } from './accounts/migration/migration-plan';
import { computeMcpDiffFromDisk } from './accounts/migration/mcp-diff';
import { createSystemProfileInventoryDeps, readProfileInventory } from './accounts/migration/profile-inventory';
import { executeTranscriptCopyOperations, planTranscriptConsolidation, readTranscriptConsolidationInput } from './accounts/migration/transcript-consolidation';
// 011-contas-e-provedores (etapa 3) — registry de providers classe A
// (T1319 — única task que toca o hub, mesma disciplina da etapa 1). Reusa o
// MESMO cofre da etapa 1 (accountsVaultPath/accountsVaultIo acima) —
// nenhum arquivo/mecanismo novo de segredo.
import { createProviderRegistry, type ProviderRegistry } from './providers/provider-registry';
import { deleteProviderSecrets, providerSecretsStatus, readProviderSecret, writeProviderSecret } from './providers/provider-secrets';
import { resolveSessionConfigDir } from './providers/session-config-dir';
import { createSystemScanDeps, defaultProjectRoots, mergeFavorites, scanProjects, sortProjects } from './project-scanner';
// CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero" (US-15).
import { createNewProject, createSystemCreateProjectDeps } from './project-creator';
import { PtyManager } from './pty-manager';
// C3 (015-jobu-pet) — "the owner closed the tab" vs. "the process left by itself".
import { consumeKillRequested, markKillRequested } from './pty-kill-intent';
// 015-jobu-pet — the Jobu on the desktop: service (core + window + tick), the window and the `pet:*` handlers.
import { guardNavigation } from './navigation-guard';
import { registerPetIpcHandlers } from './pet/pet-ipc';
import { createLiderService, type LiderService } from './lider/lider-service';
import { createPetService, type PetService } from './pet/pet-service';
import { createPetWindow } from './pet/pet-window';
import { createFullscreenWatcher } from './pet/fullscreen-watcher';
import { readPetSeams, type PetSmokeGlobal } from './pet/pet-seams';
// 016-jobu-faxina — "Fazer faxina": the sweep of repos, worktrees, branches and old sessions the Jobu runs from his menu.
import { createGitRunner } from './sweep/git';
import { createSweepRunner } from './sweep/sweep-service';
// Saúde do computador — samples RAM, disk and processes every minute; ends a process on request.
import { collectHealthSnapshot, lookupProcessName } from './health/collector';
import { createHealthService, type HealthService } from './health/health-service';
import { HEALTH_CHANNELS, type KillProcessOutcome } from '../shared/health/ipc';
// B33 — atualizar para a versão nova de dentro do app.
import { autoUpdater } from 'electron-updater';
import { createAppUpdateService, type AppUpdateService } from './app-update';
import { APP_UPDATE_CHANNELS, type AppUpdateApplyResult, type AppUpdateBoot, type AppUpdateStatus } from '../shared/appUpdate';
import type { HealthReport } from '../shared/health/types';
import { isValidPetPrefsInput } from '../shared/pet/ipc';
import type { PetDisplay } from '../shared/pet/types';
// T504 (005-terminal-copy-paste) — clipboard-bridge (T503), aditivo aos
// imports acima (não reordena o bloco existente).
import { hasImage, readText, writeText } from './clipboard-bridge';
import { CLIPBOARD_CHANNELS } from '../shared';
import { resolveClaudeCorrelation } from './session-correlation';
import { defaultClaudeHome, indexProjectSessions, resolveProjectSessionsDir } from './session-indexer';
import { seedProject } from './session-seed';
import { SessionSemaphoreManager } from './session-semaphore-manager';
import { readTranscriptLastAssistantText, TranscriptWatcherRegistry } from './transcript-watcher';
import { forgetIfOrphan } from '../shared/resumeFailure';
import { removeSession, setPinned, upsertVisit } from '../shared/sessionRegistry';
// CA-26/CA-27 (009-modo-dev-v3, lote 1) — cor + ordem da aba v3, por sessão claude.
import { isTabColorToken, setTabColor, setTabOrder } from '../shared/tabAppearance';
import { WORKSPACE_CHANNELS } from '../shared/workspace';
import { createSystemWorkspaceToolsDeps, createWorkspaceTools } from './workspace-tools';
import { createSessionWorktreeService } from './session-worktree-service';
import { worktreeNameFromArgs } from '../shared/sessionWorktree';
import { projectOfFolders, tabFolders, withProjectYolo } from '../shared/projectYolo';
import { isProcessAlive } from './process-alive';
import { createPullRequestStatusService, createSystemPullRequestStatusDeps, openPullRequestUrl } from './pull-request-status';
// Navegador interno — painel com WebContentsView por sessão (docs/design/navegador-interno.md).
import { createBrowserService, type BrowserService } from './browser/browser-service';
import { createBoardBridge } from './board-bridge';

// Scaffold T003 — janela única com o layout do shell (ui-spec §2).
// PtyManager chega em T004 (este arquivo). ProjectScanner chega no T007
// (este arquivo). SessionIndexer (T012/T013) e ProfileManager (T014) chegam
// nas tasks seguintes (plan.md "Arquitetura de processos"). ConfigStore
// formal chega no T015 (config-store.ts) — `appConfig` abaixo é a fonte de
// verdade única pra favoritos/roots/perfil ativo/defaults do launcher/
// notificação, substituindo os JSONs avulsos que T007/T014 usavam.

const ptyManager = new PtyManager();
/**
 * SEAM DE TESTE (011-contas-e-provedores, etapa 3, Fase 1, Bloco 2) — mesmo
 * espírito de `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE` (mais abaixo).
 * `resolveClaudeExecutable` prefere QUALQUER `claude.exe` do PATH a um shim
 * (`pickBestMatch`, claude-executable.ts) e cai no fallback
 * `~/.local/bin/claude.exe` — só pôr um `claude.cmd` falso na frente do PATH
 * não bastaria pra controlar qual `claude` o smoke abre (um `.exe` real, ou
 * o próprio fallback, venceria e abriria o CLI de verdade, violando a regra
 * dura de nunca abrir sessão `claude` real em teste). Quando
 * `DONEL_CLAUDE_EXECUTABLE_FIXTURE` aponta pra um caminho, `which` devolve
 * só ELE — nenhuma outra resolução de PATH entra na jogada. Fora de teste a
 * variável não existe -> resolução real (`createSystemResolveDeps`).
 */
function createClaudeResolveDeps(): ResolveClaudeDeps {
  const real = createSystemResolveDeps();
  const fixturePath = process.env.DONEL_CLAUDE_EXECUTABLE_FIXTURE;
  if (!fixturePath) return real;
  return { ...real, which: (command: string) => (command === 'claude' ? [fixturePath] : real.which(command)) };
}

// Resolvido uma vez (não muda durante a vida do processo) — plan.md ponto 2.
const claudeResolveDeps = createClaudeResolveDeps();
// Idem para o scan de projetos (T007) — mesmo padrão do claude-executable.
const projectScanDeps = createSystemScanDeps();
// CA-30 (009-modo-dev-v3, lote 9) — idem para a criação de projeto novo.
const createProjectDeps = createSystemCreateProjectDeps();

// T015 — ConfigStore formal (FR-007): carregado de verdade em
// `app.whenReady()` (migração dos JSONs legados de T007/T014 incluída, ver
// config-store.ts) — o valor abaixo é só o placeholder até lá (nunca
// consultado antes do boot terminar, já que todo IPC handler só é
// registrado DEPOIS do `whenReady().then(...)`). `projectRoots` deixa de
// ser uma const fixa: passa a vir de `appConfig.projectRoots` (editável
// pela UI de Preferências, feedback E2E rodada 3).
const configIoDeps = createSystemConfigIoDeps();
let appConfig: AppConfig = defaultAppConfig(defaultProjectRoots(homedir));
/**
 * G1 (011-contas-e-provedores, issue 08) — baseline do read-merge-write:
 * a config como ESTE processo a viu pela última vez em sync com o disco
 * (logo após o boot ler `config.json`, e logo após cada `persistAppConfig`
 * bem-sucedido). `writeAppConfig` só sobrescreve no disco as chaves de topo
 * que divergem desta baseline — o resto vem do disco FRESCO relido na hora
 * de gravar, preservando escrita concorrente de outro canal/processo mesmo
 * em chave já conhecida (ex.: `accounts.localAccounts`). `null` só antes do
 * boot terminar (nunca observável por um handler real, que só registra
 * depois do `whenReady().then(...)`).
 */
let lastSyncedAppConfig: AppConfig | null = null;

// T303/T305 (003-modo-dev) — leitura dos artefatos da Esteira em disco (raiz
// v3, CA-4: `~/.claude/esteira-state/<repo_slug>/`); injetável (mesmo padrão
// de `configIoDeps`), resolvido uma vez.
const fileIo = createSystemFileReadIoDeps();

// Credencial DE CADA USUÁRIO (`~/.claude/esteira-config/donel-board-credential.json`,
// fora do repo): quem tem uma fala com o board de verdade; quem não tem segue
// com a porta de entrada desligada, sem erro nenhum na tela. O token só existe
// aqui e dentro do transporte — nada disso vai para log.
const boardCredential = loadTaskdexServiceCredential({ readFileText: fileIo.readFileText, homedir });
const boardCallTool = boardCredential ? createJsonRpcCallTool(boardCredential, createSystemHttpPostJson()) : null;

/** O board da credencial do usuário é o default; o `config.json` do app, quando tem um, vence. */
const credentialBoardConfig = boardConfigFromCredential(boardCredential);

/**
 * Frente 2 (rodada de feedback 30/07, item 1) — "board é POR PROJETO agora":
 * quando `repoPath` vem preenchido (projeto selecionado), o board de
 * `repos.<repoSlug>.board` (repos.json, aditivo, `mergeRepoEntry`/
 * `readRepoBoard`) VENCE sobre o resto — `appConfig.devMode.boardConfig`
 * (override do `config.json`) e a credencial global entram só como fallback,
 * mesma ordem de antes. Sem `repoPath` (nenhum projeto selecionado ainda),
 * comportamento idêntico ao anterior.
 */
const effectiveBoardConfig = (repoPath?: string): DevModeBoardConfig | null => {
  if (repoPath && repoPath.trim()) {
    const reposText = fileIo.readFileText(reposConfigPath(ESTEIRA_CONFIG_DIR));
    const projectBoard = readRepoBoard(reposText, resolveRepoSlug(repoPath));
    if (projectBoard.workspaceId && projectBoard.teamId) {
      return { workspaceId: projectBoard.workspaceId, teamId: projectBoard.teamId };
    }
  }
  return appConfig.devMode.boardConfig ?? credentialBoardConfig;
};

// T311 (Batch B) — de onde vêm os cards da porta de entrada (CA-1). Ordem:
// fixture do roteiro de teste (`DONEL_DEVMODE_BOARD_FIXTURE`) → board real via
// MCP TaskDex → vazio.
const boardReader = resolveBoardReader(process.env, fileIo.readFileText, boardCallTool);

// T327 (Batch D) — fonte dos 4 fatos do espelho (CA-12), mesma ordem de
// precedência. Sem fixture e sem credencial, nenhum card tem fato: a árvore
// continua inteira, só não recebe anotação. Leitura pura, nunca escreve no board.
const boardFactsReader = resolveBoardFactsReader(
  process.env,
  fileIo.readFileText,
  boardCallTool,
  credentialBoardConfig,
);

/**
 * Achado do e2e 31/07 — a TRAVA (`esteira:em-andamento:<fase>`) é o único dos
 * 4 fatos do CA-12 que `get_task_details` não devolve, e sem ela uma fase que
 * rodou e não arquivou aparece como "não iniciada", sem o botão de liberar.
 * A varredura por etiqueta preenche esse buraco no MESMO carregamento dos
 * fatos (decisão dele: "quando carregar, enquanto abre o terminal, pode fazer
 * uma verificação rápida no board"). Sem credencial/board, degrada para
 * "nenhuma trava" — igual à falha de rede.
 */
const boardLocksReader =
  boardCallTool && credentialBoardConfig
    ? createSystemBoardLocksReader(boardCallTool, credentialBoardConfig)
    : EMPTY_BOARD_LOCKS_READER;

/**
 * CA-4 (009-modo-dev-v3) — raiz durável do handoff v3, fora de qualquer
 * checkout git (contrato `handoff-v3.md` §D.0-bis): `~/.claude/esteira-state`.
 * `DONEL_ESTEIRA_STATE_ROOT` (mesmo padrão de `DONEL_DEVMODE_BOARD_FIXTURE`,
 * `taskdex-board-client.ts`) permite ao smoke apontar para um tmpdir — sem
 * isso, um teste de disco real sujaria (ou dependeria de) o
 * `~/.claude/esteira-state` de verdade da máquina que roda o smoke.
 */
const ESTEIRA_STATE_ROOT = process.env.DONEL_ESTEIRA_STATE_ROOT || join(homedir(), '.claude', 'esteira-state');

/**
 * CA-23 (009-modo-dev-v3, lote 3) — mesmo diretório `~/.claude/esteira-config/`
 * que as skills da esteira já usam (`donel-board-credential.json`,
 * `repos.json`, contrato §D.0-bis/§I), com override de ambiente
 * (`DONEL_ESTEIRA_CONFIG_DIR`, mesmo espírito de `DONEL_ESTEIRA_STATE_ROOT`)
 * pra isolar o smoke do diretório REAL da máquina.
 */
const ESTEIRA_CONFIG_DIR = esteiraConfigDir(process.env, homedir);
const esteiraConfigIoDeps = createSystemEsteiraConfigIoDeps();

/**
 * CA-3 (009-modo-dev-v3, lote 4) — cache de TTL curto (20s,
 * github-reader.ts) compartilhado por todo o processo main: o mapa/painel
 * (lotes 7/8) podem reler o mesmo card/PR a cada render sem martelar `gh` de
 * novo. `checkGhAvailability` (mesmo módulo) já é memoizado à parte, por
 * sessão de app.
 */
const githubReadCache = new GithubReadCache();

/**
 * CA-4 — `repo_slug` é a CHAVE do repo-alvo em `repos.json → repos`
 * (`~/.claude/esteira-config/repos.json`, contrato §D.0-bis/§I), não o path.
 * A leitura da árvore (CA-4/CA-7) ainda usa o nome da pasta do checkout local
 * como aproximação — na prática a chave costuma coincidir com o basename do
 * repo (`spotsys`, `dalton`, ver exemplos do contrato), mas diverge se o
 * board apontar um checkout cujo nome de pasta não bate com a chave
 * escolhida em `repos.json` (risco conhecido, registrado no report do lote
 * 2). A engrenagem (CA-23, abaixo) usa a MESMA resolução para decidir em
 * qual entrada de `repos.json` gravar o campo `github` — é a chave que todo
 * o resto do app já assume, então divergir aqui criaria uma segunda noção de
 * "qual é o repo" dentro do mesmo processo.
 */
function resolveRepoSlug(repoPath: string): string {
  return basename(repoPath);
}

/**
 * T315 (Batch B) — um watcher de manifesto por ETAPA vigiada (CA-6), chave =
 * `discovery:card:fase:faseNum`. Vive aqui (e não no renderer) porque
 * `fs.watch` é main; o renderer só assina o push `devMode:phaseArchived`.
 * Nada aqui ESCREVE em disco — é watch de leitura, invariante 5 preservada.
 * `faseNum` entra na chave (CA-4/D.0-bis) para não colidir implementar/validar
 * de fases diferentes do mesmo card.
 */
const esteiraResultWatchers = new Map<string, EsteiraResultWatcherHandle>();

function phaseWatchKey(input: { discoveryCardId: string; cardId: string; phase: string; faseNum?: number | null }): string {
  return `${input.discoveryCardId}:${input.cardId}:${input.phase}:${input.faseNum ?? ''}`;
}

function disposeAllEsteiraResultWatchers(): void {
  for (const handle of esteiraResultWatchers.values()) handle.dispose();
  esteiraResultWatchers.clear();
}

// T1222 (011-contas-e-provedores, etapa 2) — o mecanismo de perfis
// (`profile-manager.ts`, `activeProfileSlug`/`activeProfileConfigDir`/
// `activeProfileName` em memória) morreu nesta etapa: a única config é
// `~/.claude`, o único lugar de conta é o motor (`account-engine.ts`).
// `claudeHomeDirFor`/`globalClaudeJsonPathFor` abaixo substituem os
// helpers homônimos de `profile-manager.ts` (join trivial sobre um
// `homedir()` já resolvido) — os dois únicos pontos que ainda precisavam
// deles são o switch de conta (`applyAccountsClaudeStateSwitch`) e a
// migração (`migrationHomedir()`), nenhum dos dois é sobre perfil.
function claudeHomeDirFor(home: string): string {
  return join(home, '.claude');
}

function globalClaudeJsonPathFor(home: string): string {
  return join(home, '.claude.json');
}

// T009 — semáforo de sessões (FR-010). `getRecentLines` reaproveita o ring
// buffer que o PtyManager já mantém (plan.md ponto 8) como sinal B da
// heurística de fallback (spike §"Fallback heurístico").
const semaphoreManager = new SessionSemaphoreManager({ getRecentLines: (ptyId) => ptyManager.getPreview(ptyId) });
/**
 * T014/T015 (014-chat, P4) — transporte dos hooks. Padrão: ponte HTTP com token por
 * aba e um `--settings` por sessão. `DONEL_HOOKS_TRANSPORT=legacy` volta ao caminho
 * antigo (encaminhador PowerShell + servidor `/hook` + mapa por session_id, arquivo
 * único) — a reversão por uma versão que o plano pede.
 */
const hooksTransport: 'bridge' | 'legacy' = process.env.DONEL_HOOKS_TRANSPORT === 'legacy' ? 'legacy' : 'bridge';
/** Legado: path do `--settings` único (hooks-settings.ts), resolvido no boot. `null` até `app.whenReady()` rodar (ou fora do modo legado). */
let hooksSettingsPath: string | null = null;
/** Ponte de hooks (transporte novo). `null` até o boot — ou se ela não subiu: sessões nascem sem semáforo, como no legado. */
let hookBridge: HookBridge | null = null;
/** Sessões remotas — live remote tabs of this run (transcript mirrors, end of the remote session). */
let remoteSessions: RemoteSessionRegistry | null = null;
/** `curl.exe` achado no boot (`where.exe curl`); `null` = fallback no encaminhador PowerShell que lê bytes. */
let curlPath: string | null = null;
/**
 * Ponte da statusline — o JSON oficial que o CLI entrega ao comando de `statusLine`, por aba
 * (cota 5h/7d, custo, contexto, modelo, PR...). `DONEL_STATUSLINE_BRIDGE=off` desliga;
 * por padrão é injetada sempre, com o chat ligado ou não (hooks-settings.ts).
 */
const statusLineBridgeModeSetting = statusLineBridgeMode(process.env.DONEL_STATUSLINE_BRIDGE);
const statusLineStore = createStatusLineStore();
/**
 * "Isolar em worktree" — qual aba roda em qual worktree do CLI; ao fechar a aba, remove a worktree sem trabalho
 * pendente e avisa quando ela fica (session-worktree.ts).
 */
const sessionWorktrees = createSessionWorktreeService({
  git: createGitRunner(),
  isProcessAlive,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  notifyKept: (payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(WORKSPACE_CHANNELS.worktreeKept, payload);
    }
  },
  openPath: (path) => shell.openPath(path),
  log: (line) => console.log(line),
});
/** Conversa ativa de cada aba (ptyId -> session id); muda com `/clear` e `/resume` (FR-033). */
const activeSessionByPty = new Map<string, string>();

/**
 * T048 (014-chat) — hub do chat (uma conversa por aba). `null` com `chat.enabled = false`
 * (lido no boot: mudar a preferência em tempo de execução só vale no próximo início do app)
 * ou sem ponte de hooks (transporte legado / ponte que não subiu).
 */
let chatHub: ChatHub | null = null;
/** T088 - imagens coladas na caixa do chat (limpas ao fechar a aba e, no boot, por idade). */
let chatAttachments: AttachmentStore | null = null;
/** Fonte INICIAL da conversa de cada aba `claude` (a troca de conversa é do hub, não daqui). */
const initialChatSourceByPty = new Map<string, ChatSourceInfo>();
/** Modo YOLO — the folder each claude tab was opened on: the CLI's own `cwd` moves, the tab's project does not. */
const tabCwdByPty = new Map<string, string>();
/** One `git rev-parse` per folder: the answer does not change while the app runs, and the hooks read it. */
const tabFoldersCache = new Map<string, readonly string[]>();

function tabFoldersOf(cwd: string): readonly string[] {
  let folders = tabFoldersCache.get(cwd);
  if (folders === undefined) {
    folders = tabFolders(cwd, resolveMainRepoRootSync(cwd));
    tabFoldersCache.set(cwd, folders);
  }
  return folders;
}

function isTabYolo(ptyId: string): boolean {
  const cwd = tabCwdByPty.get(ptyId);
  const { projects } = appConfig.yolo;
  return cwd !== undefined && projects.length > 0 && projectOfFolders(tabFoldersOf(cwd), projects) !== null;
}
/**
 * Sessão renovada em voo (B36) — the handoffs live in `<userData>/handoffs/`, never in the
 * project. Born at boot (needs `app.getPath`); `null` before it.
 */
let sessionRenewal: SessionRenewalService | null = null;
/** Papéis de sessão (item 12a) — `<userData>/papeis/`. Born at boot (needs `app.getPath`); `null` before it. */
let rolesStore: RolesStore | null = null;
/** Conta ativa vista no último `accounts:changed` — a troca vira aviso `account-switch` no chat. */
let lastBroadcastActiveAccountId: string | null | undefined;

// T046 (014-chat) — o esquema `donel-asset:` precisa ser registrado ANTES do `ready`.
registerAssetScheme(protocol);

function broadcastChat(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/** Primeiro `curl.exe` do PATH, ou `null` — nunca lança (o boot não pode cair por isso). */
function detectCurlPath(): string | null {
  try {
    const output = execFileSync('where.exe', ['curl'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 011-contas-e-provedores (etapa 1) — motor de contas + mods (T1125, única
// task que toca este arquivo). Nasce inerte (accounts.mod = null, C2): sem
// mod configurado, o motor (`accountEngineHost.current()`) existe mas
// `getState() === 'inert'` e o spawn de PTY segue exatamente como hoje
// (perfil ativo, ver mais abaixo).
// ---------------------------------------------------------------------------
const accountsVaultIo = createSystemVaultIoDeps();
const accountsClaudeStateIo = createSystemClaudeStateIoDeps();
/** `<userData>/accounts-vault.json` — só resolvido depois de `app.whenReady()` (precisa de `app.getPath`). */
let accountsVaultPath: string | null = null;
/** C5 — leitura apenas do `session-semaphore-manager` via `onUpdate` (API já pública; este arquivo NUNCA altera session-semaphore-manager.ts). ptyId em `working` entra, qualquer outro estado sai. */
const accountsBusyPtyIds = new Set<string>();
/** Sessões `claude` vivas nesta execução (C4 — poll de 5 min só enquanto houver ao menos uma). Adicionado no registro da sessão (registerPtyIpcHandlers), removido no `onExit` (createMainWindow). */
const accountsLiveSessionPtyIds = new Set<string>();
/**
 * 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — colhedor do login
 * isolado. Instanciado em `whenReady()` (precisa de `app.getPath`); `null`
 * antes disso e depois de `dispose()` — os handlers abaixo degradam com
 * graça (`?.`) se chamados fora dessa janela (não deveria acontecer).
 */
let isolatedLoginManager: IsolatedLoginManager | null = null;

/** Adaptador `VaultLike` sobre o cofre real — write-only pra fora de `accounts/` (nenhum getter daqui atravessa IPC; só os mods e este arquivo o enxergam). */
function createRealAccountsVaultAdapter(): VaultLike {
  return {
    read: (id: string) => (accountsVaultPath ? decryptVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, id) : null),
    write: (id: string, plainText: string) =>
      accountsVaultPath ? writeVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, id, plainText) : { kind: 'vault-unavailable' as const },
  };
}

/**
 * Deps de filesystem REAIS do login isolado — `removeDir` usa `rmSync` com
 * retry (Windows pode segurar por um instante o handle de um arquivo que o
 * `/login` acabou de fechar) e nunca lança (best-effort, a varredura do
 * próximo boot recolhe o que sobrar). `readText` nunca lança — ausência vira
 * `null` (o poll do login isolado trata isso como "ainda esperando").
 */
function createRealIsolatedLoginFsDeps(): IsolatedLoginFsDeps {
  return {
    mkdir: (path: string) => mkdirSync(path, { recursive: true }),
    removeDir: (path: string) => rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
    listDir: (path: string) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    readText: (path: string) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 011-contas-e-provedores (etapa 3) — registry de providers classe A (T1319).
// Todas as closures abaixo leem `appConfig`/`accountsVaultPath` AO VIVO (nunca
// capturam um valor antigo) — não precisa de um "rebuild" como o motor de
// contas, porque o registry não guarda estado próprio além do que já vive em
// `appConfig.providers` e no cofre. Nasce inerte (`providers.entries = []`,
// C14/D6): sem entrada, `providerRegistry.list()` devolve `[]` e o `pty:create`
// de sessão claude nunca entra no ramo `options.providerId` (T1319, acima).
// ---------------------------------------------------------------------------
const providerRegistry: ProviderRegistry = createProviderRegistry({
  getConfig: () => appConfig.providers,
  setConfig: (next) => {
    appConfig = { ...appConfig, providers: next };
    persistAppConfig();
  },
  readSecret: (providerId, envKey) =>
    accountsVaultPath ? readProviderSecret(accountsVaultPath, safeStorage, accountsVaultIo, providerId, envKey) : null,
  writeSecret: (providerId, envKey, value) =>
    accountsVaultPath
      ? writeProviderSecret(accountsVaultPath, safeStorage, accountsVaultIo, providerId, envKey, value)
      : { kind: 'vault-unavailable' as const },
  deleteSecrets: (providerId, envKeys) => {
    if (accountsVaultPath) deleteProviderSecrets(accountsVaultPath, accountsVaultIo, providerId, envKeys);
  },
  secretsStatus: (providerId, envKeys) =>
    accountsVaultPath ? providerSecretsStatus(accountsVaultPath, safeStorage, accountsVaultIo, providerId, envKeys) : 'vault-unavailable',
  // C16/D4 — `<userData>/providers/<configDirName>/`, criado VAZIO: nenhuma
  // cópia automática de MCPs/CLAUDE.md/settings.json do usuário.
  ensureConfigDir: (configDirName) => {
    const dir = join(app.getPath('userData'), 'providers', configDirName);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  },
});

/**
 * T1319 — handlers de `PROVIDER_CHANNELS` (contracts/provider-registry.md).
 * Não existe `providers:resolveLaunch`: essa resolução acontece só dentro do
 * `pty:create` (registerPtyIpcHandlers, acima), pro env nunca atravessar o
 * preload. `setSecret` é write-only — nunca ecoa o valor de volta.
 */
function registerProviderIpcHandlers(): void {
  ipcMain.handle(PROVIDER_CHANNELS.list, (): readonly ProviderSummaryDto[] => providerRegistry.list());

  ipcMain.handle(PROVIDER_CHANNELS.upsert, (_event, input: UpsertProviderInput): UpsertProviderResult => providerRegistry.upsert(input));

  ipcMain.handle(PROVIDER_CHANNELS.remove, (_event, id: ProviderId): readonly ProviderSummaryDto[] => {
    providerRegistry.remove(id);
    return providerRegistry.list();
  });

  ipcMain.handle(PROVIDER_CHANNELS.setSecret, (_event, id: ProviderId, envKey: string, value: string): SetSecretResult =>
    providerRegistry.setSecret(id, envKey, value),
  );
}

/**
 * SEAM DE TESTE (T1126/T1127/T1128, mesmo espírito de `DONEL_QUOTA_AXI_FIXTURE`
 * em quota-headroom.ts) — os smokes deste app rodam isolados do `%APPDATA%`
 * real e a regra do projeto proíbe abrir sessão `claude` real. Quando
 * `DONEL_ACCOUNTS_FAKE_MOD_FIXTURE` aponta pra um JSON `{ accounts, pairs }`,
 * o mod devolvido é 100% em memória — nenhuma chamada de rede, nenhum cofre —
 * mas passa pelo MESMO motor/claude-state que o caminho real usa. Fora de
 * teste a variável não existe -> mods reais (seazone/local) abaixo.
 */
function createFixtureAccountMod(fixturePath: string): AccountMod {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    accounts: readonly { id: string; label: string; plan: string | null; available: boolean; load: import('../shared/accounts').AccountLoad | null }[];
    pairs: Record<string, import('./accounts/account-mod').CredentialPair>;
    /**
     * 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — quando `true`,
     * `listAccounts` acrescenta as contas JÁ CONFIGURADAS
     * (`appConfig.accounts.localAccounts`) que não estão nesta fixture — é
     * o caso da conta que o COLHEDOR DO LOGIN ISOLADO grava de verdade em
     * `localAccounts` (fora desta fixture) — e `switchTo` de uma delas
     * devolve um par falso FIXO (nunca abre rede/sessão real). Ausente/
     * `false`: comportamento idêntico ao de sempre, só as contas da fixture
     * (os smokes existentes contam contas exatas e não podem ganhar uma a
     * mais por engano).
     */
    includeConfiguredLocalAccounts?: boolean;
    /**
     * 011-contas-e-provedores, etapa 3, Fase 2 (D3, item 6 do Bloco 3) —
     * rótulos de conta (da fixture OU configurada, se
     * `includeConfiguredLocalAccounts`) cuja `switchTo` deve falhar com
     * `expired-credentials` — simula o cenário que o motor reage marcando
     * `needsReconnect` (D3), sem precisar de um par de verdade vencido no
     * smoke. Ausente/lista vazia: nenhuma conta falha por este motivo
     * (comportamento de sempre).
     */
    expiredLabels?: string[];
  };
  const fixtureIds = new Set(raw.accounts.map((account) => account.id));
  const CONFIGURED_ACCOUNT_FAKE_PAIR: import('./accounts/account-mod').CredentialPair = {
    accessToken: 'fixture-access-configured',
    refreshToken: 'fixture-refresh-configured',
    expiresAt: 4102444800000,
    scopes: ['user:inference'],
  };
  /** Rótulo do `id` (fixture OU configurada, se `includeConfiguredLocalAccounts`); `null` se o id não pertence a nenhuma das duas — usado só pelo `expiredLabels` acima. */
  function fixtureAccountLabel(id: string): string | null {
    const fixtureAccount = raw.accounts.find((account) => account.id === id);
    if (fixtureAccount) return fixtureAccount.label;
    if (!raw.includeConfiguredLocalAccounts) return null;
    const configured = appConfig.accounts.localAccounts.find((account) => account.id === id);
    return configured?.label ?? null;
  }
  return {
    id: 'local',
    async listAccounts() {
      const configuredExtra = raw.includeConfiguredLocalAccounts
        ? appConfig.accounts.localAccounts
            .filter((account) => !fixtureIds.has(account.id))
            .map((account) => ({ id: account.id, label: account.label, plan: account.plan, available: true, load: null, active: false }))
        : [];
      return { kind: 'ok', accounts: [...raw.accounts.map((account) => ({ ...account, active: false })), ...configuredExtra] };
    },
    async switchTo(id) {
      const label = fixtureAccountLabel(id);
      if (label && raw.expiredLabels?.includes(label)) {
        return { kind: 'failed', reason: 'expired-credentials' };
      }
      const pair = raw.pairs[id];
      if (pair) return { kind: 'ok', pair };
      if (raw.includeConfiguredLocalAccounts && appConfig.accounts.localAccounts.some((account) => account.id === id)) {
        return { kind: 'ok', pair: CONFIGURED_ACCOUNT_FAKE_PAIR };
      }
      return { kind: 'failed', reason: 'unknown-account' };
    },
    async captureRotatedPair() {
      // Fixture não persiste nada — smoke só confere o efeito em claude-state.ts.
    },
  };
}

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D9) — uma linha JSON em
 * `<userData>/accounts-maintenance.log`, o mesmo arquivo da faxina do cofre e
 * da varredura de `accounts-login-*`. Só nomes e ids, nunca conteúdo de
 * credencial. Best-effort: falha de gravação vira log e nada mais.
 */
function appendAccountsMaintenanceLog(entry: Record<string, unknown>): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'accounts-maintenance.log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch (error) {
    console.error('[donel-dev] log de manutenção de contas: falha ao gravar (segue sem registro):', error);
  }
}

function resolveAccountMod(modId: ModId): AccountMod {
  const fixturePath = process.env.DONEL_ACCOUNTS_FAKE_MOD_FIXTURE;
  if (fixturePath) return createFixtureAccountMod(fixturePath);

  const vault = createRealAccountsVaultAdapter();
  if (modId === 'seazone') {
    return createSeazoneMod({ baseUrl: appConfig.accounts.seazone?.baseUrl ?? '', vault });
  }
  const localMod = createLocalMod({
    accounts: appConfig.accounts.localAccounts,
    vault,
    // 011-contas-e-provedores, etapa 3, Fase 2 (D7) — a carga da conta ATIVA
    // sai do par vivo do `claudeHome` (o mesmo alvo do switch), só leitura: o
    // par dela no cofre envelhece assim que o CLI renova o do `~/.claude`.
    // O motor é lido na hora da leitura de carga, nunca capturado aqui.
    getActiveAccountId: () => accountEngineHost.current()?.getActiveAccountId() ?? appConfig.accounts.activeAccountId,
    readLiveCredentialPair: () => readCurrentCredentialPair({ io: accountsClaudeStateIo, claudeHome: appConfig.accounts.claudeHome ?? claudeHomeDirFor(homedir()) }),
    // D9 (emenda da D4, decisão do dono em 13/09) — a leitura de carga renova
    // o par vencido de conta PARADA; recusa marca o mesmo registro do motor, e
    // cada renovação gravada fica no log de manutenção, só com o id.
    reconnectRegistry: accountsReconnectRegistry,
    // Fase 2 (revisão, R1) — o MESMO coordenador para todo mod que o motor
    // criar: uma renovação em voo num motor que está sendo substituído não
    // pode ser repetida pelo mod do motor novo (refresh token de uso único).
    refreshCoordinator: accountsRefreshCoordinator,
    onPairRefreshed: (id, trigger) => appendAccountsMaintenanceLog({ event: 'account-pair-refreshed', account: id, trigger }),
    // fix/renovacao-credencial — a falha também vai pro log (antes só o
    // sucesso ia, e uma conta caída em "Reconectar" não deixava rastro).
    onPairRefreshFailed: (id, trigger, reason) => appendAccountsMaintenanceLog({ event: 'account-pair-refresh-failed', account: id, trigger, reason }),
    // Lugares remotos — conta ativa numa VPS nunca é renovada por esta máquina (o CLI de lá renova).
    isHeldRemotely: (id) => (accountEngineHost.current()?.getConfig() ?? appConfig.accounts).remotes.some((place) => place.activeAccountId === id),
  });
  // Pool Seazone AO LADO das locais (sem trocar o mod): com o switcher
  // configurado, as contas dele entram no fim da lista como `seazone:<label>`
  // e o mod composto roteia switch/captura/keepAlive pelo dono do id. Sem
  // `seazone:session` no cofre, 401 ou switcher fora do ar, o pool só não
  // aparece — as locais seguem.
  const seazone = appConfig.accounts.seazone;
  if (!seazone) return localMod;
  return createLocalWithPoolMod({ local: localMod, pool: createSeazoneMod({ baseUrl: seazone.baseUrl, vault }) });
}

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (revisão, R1) — uma renovação por
 * conta de cada vez ENTRE instâncias do mod local: cada reconstrução do motor
 * cria um mod novo, e o coordenador sobrevive a todas elas, como o registro de
 * reconectar.
 */
const accountsRefreshCoordinator = createRefreshCoordinator();

/**
 * A sequência invariante inteira (captura → escreve `.credentials.json` → apaga
 * `oauthAccount`) — `claude-state.ts` é a ÚNICA escrita de credencial do
 * sistema. `claudeHome` respeita o override de `accounts.claudeHome` (C1);
 * default é o `~/.claude` real (nunca o de um perfil — motor e perfis não
 * escrevem no mesmo lugar ao mesmo tempo).
 *
 * O `.claude.json` acompanha o override: ele é sempre o IRMÃO do `claudeHome`
 * (em produção, `dirname(~/.claude)` é o próprio `~`, então nada muda). Antes
 * ele saía direto de `homedir()`, e o override movia só metade do alvo — um
 * switch com `claudeHome` isolado ainda apagava o bloco `oauthAccount` do
 * `~/.claude.json` DA MÁQUINA, derrubando o login do CLI de quem rodasse o
 * smoke. Achado da captura visual da etapa 1 (011), 04/08/2026.
 */
/** Mesma resolução de `claudeJsonPath` que `applyAccountsClaudeStateSwitch` já fazia inline — extraída pra ser reaproveitada pela leitura de fingerprint da checagem de corrida (emenda 22/09, revisão do item 5). */
function accountsClaudeJsonPath(): string {
  const overrideHome = appConfig.accounts.claudeHome;
  const realClaudeJsonPath = globalClaudeJsonPathFor(homedir());
  return overrideHome === null ? realClaudeJsonPath : join(dirname(overrideHome), basename(realClaudeJsonPath));
}

function applyAccountsClaudeStateSwitch(pair: import('./accounts/account-mod').CredentialPair, onRotatedPairCaptured: (pair: import('./accounts/account-mod').CredentialPair | null) => void | Promise<void>): Promise<void> {
  const overrideHome = appConfig.accounts.claudeHome;
  const claudeHome = overrideHome ?? claudeHomeDirFor(homedir());
  return applyAccountSwitch({ io: accountsClaudeStateIo, claudeHome, claudeJsonPath: accountsClaudeJsonPath(), onRotatedPairCaptured }, pair);
}

/**
 * Emenda 22/09 (revisão, item 5) — lê o fingerprint do `oauthAccount` ATUAL
 * de `~/.claude.json`, só leitura (mesmo parsing que `isolated-login.ts` já
 * usa pra reconhecer "é a mesma conta", `accountFingerprintFromClaudeJsonText`).
 * `null` se o arquivo não existir/estiver ilegível, ou o bloco `oauthAccount`
 * ainda não tiver sido re-escrito pelo CLI (ele some no passo 3 do switch).
 */
function readCurrentAccountsClaudeJsonFingerprint(): string | null {
  const text = accountsClaudeStateIo.readFileText(accountsClaudeJsonPath());
  return accountFingerprintFromClaudeJsonText(text);
}

function broadcastAccountsChanged(view: AccountsViewDto): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(ACCOUNT_CHANNELS.changed, view);
  }
  // T048 (014-chat) — troca de conta vira aviso no fim das conversas abertas (só o rótulo, nunca e-mail).
  const previous = lastBroadcastActiveAccountId;
  lastBroadcastActiveAccountId = view.activeAccountId;
  if (previous !== undefined && previous !== null && view.activeAccountId !== null && previous !== view.activeAccountId) {
    const knownLabel = view.accounts.find((account) => account.id === view.activeAccountId)?.label;
    const label = knownLabel ?? view.activeAccountId;
    chatHub?.notifyAccountSwitch(label);
    // 015-jobu-pet (T043, US4) — the Jobu looks at the mirror and shows the new account, with the chat on or not. The first
    // active account (from none to one) is not a switch: the same rule as the chat notice, right above. The bubble carries only the
    // LABEL the owner gave the account (FR-018): its id is an opaque UUID that tells nobody anything, so an account
    // that is not in the list (it does not happen: the active one always is) does not become a bubble with the id inside.
    if (knownLabel !== undefined) petService?.onAccountSwitched(knownLabel);
  }
}

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D3, item 1 do Bloco 3) — UM
 * registro compartilhado entre reconstruções do motor (F6): se cada
 * `createEngine` criasse o seu próprio, um rebuild (add/remove conta,
 * troca de mod) perderia toda marca de "precisa reconectar" pendente.
 */
const accountsReconnectRegistry = createReconnectRegistry();

/** Lugares remotos — `ssh` do sistema, sem senha (a rede da pessoa autentica: Tailscale, chave). */
const accountsRemoteClaudeState = createRemoteClaudeState();

/**
 * Dono do ciclo de vida do motor (F6, 011-contas-e-provedores etapa 3 Fase 1)
 * — substitui o antigo `rebuildAccountEngine()`, que reconstruía (dispose +
 * new) incondicionalmente a cada chamada. `AccountEngineHost.apply` decide
 * entre construir/reconstruir/atualizar via `needsEngineRebuild`
 * (account-pool.ts), então quem muda `appConfig.accounts` só chama
 * `applyAccountsEngineConfig()` abaixo, sem escolher na mão.
 */
const accountEngineHost = new AccountEngineHost({
  createEngine: (config) => {
    const engine = new AccountEngine({
      config,
      resolveMod: resolveAccountMod,
      applySwitch: applyAccountsClaudeStateSwitch,
      // Emenda 22/09 (item 2) — não decide mais SE o auto-switch troca; só
      // alimenta `sessionBusy` no log de `onAutoSwitchLogged` abaixo.
      isSessionBusy: () => accountsBusyPtyIds.size > 0,
      reconnectRegistry: accountsReconnectRegistry,
      // Emenda 22/09 (item 2) — uma linha em accounts-maintenance.log por
      // decisão de auto-switch que trocou ou tentou trocar, com from/to,
      // carga dos dois lados e se havia sessão ocupada (observabilidade —
      // não influencia mais a decisão).
      onAutoSwitchLogged: (entry) => appendAccountsMaintenanceLog({ event: 'auto-switch', ...entry }),
      // Emenda 22/09 (item 5) — mesma leitura só-leitura que o mod local usa
      // pra ler a carga da conta ativa (D7); aqui serve pra checagem de
      // corrida pós-switch (`scheduleRaceCheck`/`performRaceCheck`).
      readCurrentPair: () => readCurrentCredentialPair({ io: accountsClaudeStateIo, claudeHome: appConfig.accounts.claudeHome ?? claudeHomeDirFor(homedir()) }),
      // Emenda 22/09 (revisão, item 5) — desempate por IDENTIDADE (não por
      // token): ver `readCurrentAccountsClaudeJsonFingerprint`.
      readCurrentAccountFingerprint: () => readCurrentAccountsClaudeJsonFingerprint(),
      onSwitchOverwritten: (info) => appendAccountsMaintenanceLog({ event: 'switch-overwritten', account: info.to }),
      onSwitchPairRotated: (info) => appendAccountsMaintenanceLog({ event: 'switch-pair-rotated', account: info.to }),
      onSwitchCheckInconclusive: (info) => appendAccountsMaintenanceLog({ event: 'switch-check-inconclusive', account: info.to }),
      // fix/renovacao-credencial — cada vez que o par em disco foi guardado no
      // cofre (switch, leitura de carga ou encerramento), só ids.
      onLivePairCaptured: (info) => appendAccountsMaintenanceLog({ event: 'live-pair-captured', account: info.account, trigger: info.trigger, believedActive: info.believedActive }),
      // Pool Seazone (patch local v3) — o heartbeat da conta ativa do pool adota o par mais novo do switcher (só se o disco ainda tiver o enviado) e registra, só com ids, o que aconteceu.
      writeRefreshedActivePair: (expected, next) =>
        adoptRefreshedActivePair({ io: accountsClaudeStateIo, claudeHome: appConfig.accounts.claudeHome ?? claudeHomeDirFor(homedir()) }, expected, next),
      onPoolHeartbeatEvent: (event) => appendAccountsMaintenanceLog({ ...event }),
      // Lugares remotos (VPS) — o `~/.claude` de cada lugar por ssh; a conta de
      // cada lugar vai para o `config.json` assim que muda (como a ativa daqui).
      remoteState: accountsRemoteClaudeState,
      onRemotesChanged: (remotes) => {
        appConfig = { ...appConfig, accounts: { ...appConfig.accounts, remotes } };
        persistAppConfig();
      },
      onRemoteEvent: (event) => appendAccountsMaintenanceLog({ ...event }),
    });
    engine.onChanged(broadcastAccountsChanged);
    engine.start();
    engine.startPolling(() => accountsLiveSessionPtyIds.size > 0);
    return engine;
  },
  // 011-contas-e-provedores, etapa 3, Fase 1, Bloco 0 — uma troca decidida
  // pelo PRÓPRIO motor (auto-switch) só mudava a config em memória do
  // engine; `appConfig.accounts.activeAccountId` ficava com a conta VELHA, e
  // um rebuild subsequente (add/remove conta) renascia o motor a partir
  // dela — a próxima troca capturaria o par rotacionado na conta ERRADA.
  onActiveAccountChanged: (id) => {
    if (id === appConfig.accounts.activeAccountId) return;
    appConfig = { ...appConfig, accounts: { ...appConfig.accounts, activeAccountId: id } };
    persistAppConfig();
  },
});

/**
 * Aplica `appConfig.accounts` no motor — chamar depois de QUALQUER mudança
 * nela (boot, `accounts:setConfig`, `accounts:connectMod`,
 * `accounts:disconnectMod`, `accounts:removeAccount`,
 * `migration:importCredentials`). F6: quando o resultado é `rebuilt`, a lista
 * nova (ex.: conta recém-importada) só existe dentro do motor recém-criado —
 * ninguém pediu `listAccounts()` ainda, então disparamos aqui pra
 * `accounts:changed` já levar a lista atualizada ao renderer sem precisar
 * reiniciar o app. No boot (`built`) não dispara: o primeiro `accounts:list`
 * de verdade vem do próprio painel ao montar.
 */
function applyAccountsEngineConfig(): void {
  const result = accountEngineHost.apply(appConfig.accounts);
  if (result === 'rebuilt') {
    void accountEngineHost.current()?.listAccounts().catch(() => undefined);
  }
}

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D5, item 2 do Bloco 3) — dá baixa
 * em `accountsBusyPtyIds` (C5, só observabilidade desde a emenda 22/09).
 * Substitui os dois pontos que faziam `accountsBusyPtyIds.delete(ptyId)`
 * direto: o ramo não-`working` do `semaphoreManager.onUpdate` e o
 * `ptyManager.onExit` de `createMainWindow`.
 *
 * Emenda 22/09 (item 2) — não retoma mais `retryDeferredAutoSwitch` (removido
 * do motor junto com o adiamento por sessão ocupada): o auto-switch já troca
 * na hora, em `evaluateAutoSwitch`, sem esperar sessão nenhuma esvaziar.
 */
function releaseAccountsBusyPty(ptyId: string): void {
  accountsBusyPtyIds.delete(ptyId);
}

/**
 * Emenda 22/09 (item 4) — gatilho imediato: uma sessão que encerra por
 * `StopFailure` (limite da conta, ou qualquer outro erro de API — o payload
 * do hook não distingue os dois, então reavalia em qualquer `StopFailure`,
 * como o dono pediu) relê a carga e avalia o auto-switch NA HORA, sem
 * esperar o próximo tick do poll adaptativo (item 3).
 */
function triggerAccountsAutoSwitchOnStopFailure(): void {
  const engine = accountEngineHost.current();
  if (!engine) return;
  void engine
    .listAccounts()
    .then(() => {
      const current = accountEngineHost.current();
      // Fase 2 (revisão) — mesma guarda de accounts:list force=true: só
      // avalia se o motor não foi reconstruído durante a leitura.
      if (current === engine) return engine.evaluateAutoSwitch();
      return undefined;
    })
    .catch(() => undefined);
}

// Achado do T009 (ao escrever o `--settings` de hooks pela primeira vez):
// sem `setName`, o Electron só resolve o nome do app ("donel-dev", de
// package.json) quando invocado como `electron .` (dev, `npm run dev`) — ao
// rodar o build direto por caminho de script (`electron out/main/index.js`,
// exatamente como o smoke roteirizado e a instalação real via atalho fazem),
// ele cai pro default "Electron", e `app.getPath('userData')` (usado aqui E
// pelo `config.json` do ConfigStore, T015) vira `%APPDATA%\Electron` — uma
// pasta genérica compartilhada por QUALQUER outro app Electron mal-nomeado
// nesta máquina. `setName` força o nome certo em todo modo de execução,
// antes de qualquer `getPath('userData')`.
app.setName('donel-dev');

// Windows: sem isso, `new Notification()` sai atribuída a "Electron" (ou
// falha em silêncio fora do dev) — plan.md, risco "Notification API do
// Electron sem app.setAppUserModelId no Windows".
app.setAppUserModelId('com.seazone.doneldev');

/**
 * C1 (015-jobu-pet, R5) — the main window. The app assumed a single window: "any window" served as the
 * main one for the focus and for the click on the notification. With the Jobu there is a second one, which is never the
 * main one; whoever needs the main one asks here.
 */
let mainWindowRef: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindowRef !== null && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
}

/** Navegador interno — `null` until `app.whenReady()` (needs `userData`). */
let browserService: BrowserService | null = null;

/**
 * T020 (015-jobu-pet) — the Jobu service. `null` until the main window appears (R21: the pet window
 * is only born AFTER the main one's `ready-to-show`, so `firstWindow()` of the smokes is still
 * the main one) and again after it closes. With `pet.enabled = false` the service exists
 * but holds no window and no timer: the app is the one from before the pet.
 */
let petService: PetService | null = null;

/**
 * A system notification (Windows toast). Smoke-only seam (T081): with `DONEL_SMOKE_NOTIFICATIONS_LOG` it records
 * `{ title, body }` in that file instead of showing anything — the chat's pending toast and the session toasts alike.
 */
const smokeNotificationsLog = process.env.DONEL_SMOKE_NOTIFICATIONS_LOG || undefined;
function createSystemNotification(options: { title: string; body: string }): NotificationLike {
  if (smokeNotificationsLog !== undefined) {
    appendFileSync(smokeNotificationsLog, `${JSON.stringify(options)}\n`, 'utf8');
    return { on: () => undefined, show: () => undefined };
  }
  return new Notification(options);
}
function systemNotificationsSupported(): boolean {
  return smokeNotificationsLog !== undefined || Notification.isSupported();
}

/** With the notifications stub on, the smokes read the taskbar badge and flash from here (`electronApp.evaluate`). */
const attentionSmoke: AttentionSmokeSnapshot | null = smokeNotificationsLog === undefined ? null : { overlayCount: 0, flashing: false };
if (attentionSmoke !== null) (globalThis as typeof globalThis & { __donelAttentionSmoke?: AttentionSmokeSnapshot }).__donelAttentionSmoke = attentionSmoke;

/**
 * notificacoes-completas (30/10) — who finished, who needs the owner and who stopped with an error, without hunting
 * tabs: the Windows toast (when the Jobu is not on screen), the flash of the taskbar button and the badge over it
 * with the count of sessions waiting. The news is the pet core's, fed with or without the Jobu (`onNotices`); the
 * rule of which channel says what is src/shared/attention/rule.ts.
 */
const taskbarAttention = createTaskbarAttention(getMainWindow, attentionSmoke);
const attentionNotifier = createAttentionNotifier({
  preference: () => appConfig.notificationPreference,
  isPetEnabled: () => petService?.isEnabled() ?? false,
  // the chat raises its own toast for each pending, with what it is (T079): a `blocked` here would repeat it
  chatCoversPending: () => chatHub !== null,
  isWindowInFront: () => {
    const window = getMainWindow();
    return window !== null && window.isFocused() && window.isVisible() && !window.isMinimized();
  },
  isSupported: systemNotificationsSupported,
  createNotification: createSystemNotification,
  openSession: (ptyId) => petService?.openSession(ptyId),
  flashFrame: (flag) => taskbarAttention.flashFrame(flag),
  setOverlay: (count) => taskbarAttention.setOverlay(count),
});

function toPetDisplay(display: Electron.Display): PetDisplay {
  return { id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor };
}

function startPetService(): void {
  if (petService !== null) return;
  // The two TEST seams of the Jobu window (`DONEL_PET_SMOKE_INVISIBLE`, `DONEL_PET_CAPTURABLE`): off in the owner's app.
  const seams = readPetSeams(process.env);
  petService = createPetService({
    getMainWindow,
    config: () => appConfig.pet,
    persist: (next) => {
      appConfig = { ...appConfig, pet: next };
      persistAppConfig();
    },
    createWindow: (options) => createPetWindow(options, seams),
    // 016-jobu-faxina — the sweep of the menu "Fazer faxina", and the click of its bubble (the Explorer opens the folder).
    runSweep: createSweepRunner({
      git: createGitRunner(),
      now: () => Date.now(),
      getRoots: () => appConfig.projectRoots,
      getLastSweepAt: () => appConfig.sweep.lastSweepAt,
      setLastSweepAt: (ms) => {
        appConfig = { ...appConfig, sweep: { lastSweepAt: ms } };
        persistAppConfig();
      },
      claudeProjectsDir: join(defaultClaudeHome(), 'projects'),
      tempClaudeDir: join(tmpdir(), 'claude'),
      log: (line) => appendFile(join(app.getPath('userData'), 'sweep.log'), `${new Date().toISOString()} ${line}\n`, 'utf8'),
    }),
    openFolder: (path) => void shell.openPath(path),
    // notificacoes-completas — the news and the waiting count also go to the toast and the taskbar.
    onNotices: (events) => attentionNotifier.onNotices(events),
    onWaitingCountChanged: (count) => attentionNotifier.onWaitingCount(count),
    getDisplays: () => screen.getAllDisplays().map(toPetDisplay),
    getPrimaryDisplay: () => toPetDisplay(screen.getPrimaryDisplay()),
    now: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    // FR-034: with `DONEL_PET_CAPTURABLE=1` the protection against capture never turns on (the real screenshots of the docs).
    alwaysCapturable: seams.capturable,
    // T050 (R10): the full-screen helper only exists while the Jobu window is open.
    startFullscreenWatcher: (onChange) => createFullscreenWatcher({ onChange }),
    // T049 (FR-005): a monitor plugged in, unplugged or with its work area changed revalidates the position.
    subscribeDisplays: (listener) => {
      const handler = (): void => listener();
      screen.on('display-added', handler);
      screen.on('display-removed', handler);
      screen.on('display-metrics-changed', handler);
      return () => {
        screen.removeListener('display-added', handler);
        screen.removeListener('display-removed', handler);
        screen.removeListener('display-metrics-changed', handler);
      };
    },
  });
  petService.start();
  if (seams.ghost) {
    // The test hook of the ghost mode: what the full-screen watcher would do on seeing an app take the screen. Verification
    // with a REAL full screen belongs to the owner's checklist; the smoke only proves that the window hides and comes back when the service is told.
    const hooks = globalThis as PetSmokeGlobal;
    hooks.__donelPetSmoke = { ...hooks.__donelPetSmoke, setFullscreen: (active) => petService?.onFullscreenChanged(active) };
  }
}

/**
 * C1 (015-jobu-pet, R5/R21) — called on the `closed` of the main window, BEFORE `killAll`: the Jobu is a
 * second window and dies with the main one. Without this it would stay alive and `window-all-closed` would never
 * end the app.
 */
function onMainWindowClosed(): void {
  petService?.dispose();
  petService = null;
  // Item 18 — the link of the bubble of the Líder goes with the main window too.
  liderService?.dispose();
  liderService = null;
}

/** Item 18 (PDA mindscape-openrig) — the link between the main window and the bubble of the Líder on the Jobu. */
let liderService: LiderService | null = null;

function ensureLiderService(): LiderService {
  if (liderService !== null) return liderService;
  liderService = createLiderService({
    getMainWindow,
    petWebContents: () => {
      const id = petService?.petWebContentsId() ?? null;
      return id === null ? null : (webContents.fromId(id) ?? null);
    },
  });
  return liderService;
}

/**
 * Turns the Jobu on/off (`config:setPetPrefs`). Without a service (the main window has not appeared yet, or has already
 * closed) it only saves the preference; with a service it saves, applies and tells the main window (R19).
 */
function setPetEnabled(enabled: boolean): void {
  if (petService !== null) {
    petService.setEnabled(enabled);
    return;
  }
  if (appConfig.pet.enabled === enabled) return;
  appConfig = { ...appConfig, pet: { ...appConfig.pet, enabled } };
  persistAppConfig();
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e1116',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindowRef = mainWindow;

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    ensureLiderService(); // item 18 — the IPC of the Líder exists as soon as the main window reports
    startPetService(); // 015 (R21): the Jobu is only born after the main window appears
  });

  // 015-jobu-pet - the focus of the main window feeds the Jobu ("seen" = the active tab with the Donel in
  // front of the owner). In front means focused, visible and not minimized: a window minimized while it was
  // the active one went on answering `isFocused() === true` (measured: minimized, invisible and "focused"),
  // and with no `blur` to tell, a session on the active tab would be born seen with the Donel on the taskbar.
  // So the signal follows minimize, restore, show and hide as well.
  const reportPetFocus = (): void => {
    petService?.onMainFocusChanged(mainWindow.isFocused() && mainWindow.isVisible() && !mainWindow.isMinimized());
  };
  mainWindow.on('focus', reportPetFocus);
  mainWindow.on('focus', () => attentionNotifier.onWindowFocused()); // notificacoes-completas: the flash has served
  mainWindow.on('blur', reportPetFocus);
  mainWindow.on('minimize', reportPetFocus);
  mainWindow.on('restore', reportPetFocus);
  mainWindow.on('show', reportPetFocus);
  mainWindow.on('hide', reportPetFocus);

  // T045 (014-chat, R21): this window exposes `window.donel`, so it must never be navigated away (see navigation-guard.ts).
  guardNavigation(mainWindow.webContents);

  const unsubscribeData = ptyManager.onData((ptyId, data) => {
    mainWindow.webContents.send(PTY_CHANNELS.data, ptyId, data);
  });
  const unsubscribeExit = ptyManager.onExit((ptyId, exitCode, signal) => {
    const info: PtyExitInfo = { exitCode, signal };
    mainWindow.webContents.send(PTY_CHANNELS.exit, ptyId, info);

    // C3 (015-jobu-pet) — the exit consumes the intent that `pty:kill` marked: `true` = the owner closed
    // the tab (or Resume/Reopen killed it), `false` = the process left by itself. Consuming here, on every
    // exit, is what keeps the mark from staying forever; the Jobu gets the result (`byUser`).
    const closedByOwner = consumeKillRequested(ptyId);
    petService?.onSessionExited(ptyId, closedByOwner);
    void sessionWorktrees.onExit(ptyId, closedByOwner); // "Isolar em worktree": a aba fechou -> worktree sem trabalho sai
    // Sessões remotas — the owner closed the tab: the remote session ends too. App quitting or ssh dropping leaves it alive.
    if (closedByOwner) remoteSessions?.endRemote(ptyId);
    remoteSessions?.onPtyExit(ptyId);

    // T009 — onExit do node-pty (evento do SO) é a fonte de verdade pra
    // "encerrada"/"falha" (spike: kill forçado nunca dispara SessionEnd).
    // Só reage a ptyIds que o semáforo de fato registrou (sessão claude
    // real, T005+); uma futura aba de terminal livre (FR-008/T010) nunca
    // passou por `registerSession`, então isso é um no-op silencioso pra ela.
    if (semaphoreManager.getSnapshot(ptyId)) {
      semaphoreManager.onProcessExit(ptyId, exitCode);
      semaphoreManager.unregisterSession(ptyId);
    }

    // T412 (004) — baixa do watcher de transcript. AQUI e não no `SessionEnd`:
    // kill forçado não dispara o hook, e um watcher sobrevivente é handle
    // vazado. No-op para aba de terminal livre (nunca abriu watcher).
    transcriptWatchers.stop(ptyId);
    // T015 (014-chat) — baixa da ponte: apaga o `--settings` da sessão e esquece o token.
    // No-op para aba sem hooks (terminal livre, login isolado, transporte legado).
    hookBridge?.unregisterSession(ptyId);
    removeSessionHooksSettings(app.getPath('userData'), ptyId);
    statusLineStore.remove(ptyId);
    activeSessionByPty.delete(ptyId);
    tabCwdByPty.delete(ptyId);
    chatHub?.markEnded(ptyId);
    void chatAttachments?.releasePty(ptyId);
    // T1125 (011-contas-e-provedores, etapa 1, C4) — mesma baixa, pro poll de
    // 5 min do motor de contas parar de contar esta sessão como viva.
    // Fase 2 (D5) — `releaseAccountsBusyPty` também retoma um auto-switch
    // adiado se esta era a última sessão ocupada.
    releaseAccountsBusyPty(ptyId);
    accountsLiveSessionPtyIds.delete(ptyId);
    browserService?.releasePty(ptyId); // navegador interno: the session's browser dies with it
  });
  const unsubscribeSemaphore = semaphoreManager.onUpdate((update: SemaphoreUpdate) => {
    mainWindow.webContents.send(SEMAPHORE_CHANNELS.update, update);
  });

  // Fechar a janela mata todos os PTYs dela — evita processos powershell.exe
  // órfãos (plan.md risco de vazamento, DoD do ciclo de vida chega em T010).
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null; // C1
    onMainWindowClosed(); // C1/R21 — the Jobu dies with the main window, BEFORE killAll
    unsubscribeData();
    unsubscribeExit();
    unsubscribeSemaphore();
    // A janela morrendo mata os PTYs; os watchers deles vão junto (o `onExit`
    // de cada um já daria baixa, mas não depender disso é o que garante zero
    // handle sobrevivendo ao fechamento).
    transcriptWatchers.disposeAll();
    // T315 (003-modo-dev) — mesma higiene do registry de transcript: nenhum
    // `fs.watch` sobrevive ao fechamento da janela.
    disposeAllEsteiraResultWatchers();
    browserService?.destroyAll(); // navegador interno
    ptyManager.killAll();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * T412 (004-nomear-sessoes) — um watcher de transcript por aba `claude` VIVA
 * (não só a em foco: senão "troco de aba e o nome não segue"). Chave = `ptyId`,
 * porque é o `PtyManager.onExit` — a fonte de verdade de morte de sessão,
 * inclusive em kill forçado, onde o `SessionEnd` NÃO dispara (spike T002) — que
 * dá baixa neles.
 */
const transcriptWatchers = new TranscriptWatcherRegistry();

/**
 * Path do `.jsonl` da sessão. O CLI o deriva do `cwd` (slug do path absoluto) e
 * do diretório de config ATIVO. T1222 (etapa 2) — perfis mortos: nenhum
 * spawn passa mais `claudeConfigDir` (sempre `undefined`), então o parâmetro
 * aqui só sobrevive pra `sessions:forgetIfOrphan`/`seedProject` (T404/T706),
 * que também passam `undefined` desde a demolição.
 */
function resolveTranscriptPath(sessionId: string, cwd: string | undefined, claudeConfigDir: string | undefined): string {
  const claudeHome = claudeConfigDir ?? defaultClaudeHome();
  return join(resolveProjectSessionsDir(cwd ?? homedir(), claudeHome), `${sessionId}.jsonl`);
}

/**
 * B39 — the conversation is on this computer: in the project's folder of `~/.claude/projects` or in any other
 * (a worktree session). The mirror of a remote session (`remote-transcripts/`) does not count.
 */
function localTranscriptExists(sessionId: string, projectPath: string): boolean {
  if (existsSync(resolveTranscriptPath(sessionId, projectPath, undefined))) return true;
  const projectsDir = join(defaultClaudeHome(), 'projects');
  try {
    return readdirSync(projectsDir).some((folder) => existsSync(join(projectsDir, folder, `${sessionId}.jsonl`)));
  } catch {
    return false;
  }
}

/**
 * T710/CA-11 (2º momento) — caminho do `.jsonl` de cada sessão spawnada NESTA
 * execução do app, gravado no momento do spawn.
 *
 * Existe para o `sessions:forgetIfOrphan` conferir o arquivo EXATO: o caminho
 * depende do perfil de NASCIMENTO da aba (`CLAUDE_CONFIG_DIR`), e o perfil ativo
 * pode ter mudado entre o spawn e a falha — re-derivar pelo perfil de agora
 * poderia dar "arquivo ausente" para uma sessão que existe no home de outro
 * perfil, e apagar uma entrada boa. Chave = `sessionId` (não `ptyId`) porque é
 * essa a chave do registro de sessões.
 */
const spawnedTranscriptPaths = new Map<string, string>();

function startTranscriptWatcher(ptyId: string, filePath: string, sessionId: string): void {
  transcriptWatchers.start(ptyId, {
    sessionId,
    filePath,
    onChange: (payload: TranscriptChangedPayload) => {
      // Mesmo mecanismo de push do semáforo e do `pty:data` — nada de um
      // segundo caminho de notificação para o renderer.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(TRANSCRIPT_CHANNELS.changed, payload);
      }
    },
  });
}

/**
 * T016 (014-chat, FR-033) — a ponte avisou que a aba passou a outra conversa
 * (`/clear`, `/resume`, fork). Re-aponta o watcher de nome/contexto/cor para o
 * `.jsonl` novo (que pode ainda não existir) e avisa o renderer, que troca o
 * `claudeSessionId` da aba. O semáforo é por aba e não precisa de nada.
 */
function handleConversationSwitched(event: Extract<BridgeEvent, { type: 'conversation-switched' }>): void {
  const { ptyId, sessionId, source } = event;
  // Sessões remotas — the CLI names a path on the remote; the tab follows its local mirror.
  const transcriptPath = event.transcriptPath && remoteSessions?.has(ptyId) ? remoteSessions.repoint(ptyId, sessionId, event.transcriptPath) : event.transcriptPath;
  if (!transcriptPath) return; // sem caminho não há o que seguir; o payload do CLI sempre o traz.
  const previousSessionId = activeSessionByPty.get(ptyId) ?? null;
  if (previousSessionId === sessionId) return;
  activeSessionByPty.set(ptyId, sessionId);
  spawnedTranscriptPaths.set(sessionId, transcriptPath);
  transcriptWatchers.repoint(ptyId, { sessionId, transcriptPath });
  const payload: SessionSwitchedPayload = { ptyId, previousSessionId, sessionId, source };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(TRANSCRIPT_CHANNELS.switched, payload);
  }
}

/**
 * T048 (014-chat) — liga o hub do chat à ponte de hooks e registra os handlers `chat:*`.
 * Com `chat.enabled = false` (lido da config no boot), ou sem ponte, NADA é registrado e o
 * protocolo `donel-asset:` também não: o app é o de antes do chat.
 */
function registerChatDomain(): void {
  if (!appConfig.chat.enabled || hookBridge === null) return;
  const attachmentsRoot = join(app.getPath('userData'), 'chat-attachments');
  // T079 - notificacao do sistema quando uma pendencia abre (janela sem foco ou aba nao ativa).
  const notifier = createPendingNotifier({
    preference: () => appConfig.notificationPreference,
    // 015-jobu-pet (T033, R8) - with the Jobu on screen the bubble says it, and a Windows notification would repeat it.
    isPetEnabled: () => petService?.isEnabled() ?? false,
    // C1 (015-jobu-pet) — the MAIN window in focus, not "some window": the Jobu is another window of the app.
    isWindowFocused: () => getMainWindow()?.isFocused() ?? false,
    isSupported: systemNotificationsSupported,
    create: createSystemNotification, // smoke-only seam (T081) inside: records instead of showing
    onClick: (ptyId) => {
      const window = getMainWindow(); // C1 (015-jobu-pet) — the main one, not "the first live window"
      if (window === null) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.send(CHAT_CHANNELS.focusPending, { ptyId });
    },
  });
  const chatDiagnostics = createDiagnosticsLog(app.getPath('userData'));
  const hub = createChatHub({
    bridge: hookBridge,
    getSource: (ptyId) => initialChatSourceByPty.get(ptyId) ?? null,
    events: {
      rows: (event) => broadcastChat(CHAT_CHANNELS.rows, event),
      live: (event) => {
        // o semaforo da aba fica em `permission` ("esperando voce") enquanto houver pendencia aberta
        semaphoreManager.setPendingOpen(
          event.ptyId,
          event.live.pendings.length > 0,
          event.live.pendings.map((pending) => pending.kind),
        );
        broadcastChat(CHAT_CHANNELS.live, event);
      },
      pendingOpened: ({ ptyId, pending }) => {
        notifier.notifyPending(ptyId, pending);
        // 015-jobu-pet (T032) - the semaphore has just turned `permission`; this tells the Jobu what the pending is.
        petService?.onPendingOpened(ptyId, pending.kind);
      },
      conversationSwitched: (event) => broadcastChat(CHAT_CHANNELS.conversationSwitched, event),
      reception: (event) => broadcastChat(CHAT_CHANNELS.reception, event),
      promptSignal: (event) => broadcastChat(CHAT_CHANNELS.promptSignal, event),
    },
    diagnostics: chatDiagnostics,
    attachmentsRoot,
    // B36 — the "abrir" of the "Sessão renovada em voo" divider opens the handoff.
    handoffsRoot: join(app.getPath('userData'), 'handoffs'),
    mapTranscriptPath: (ptyId, sessionId, transcriptPath) => (remoteSessions?.has(ptyId) ? (remoteSessions.repoint(ptyId, sessionId, transcriptPath) ?? transcriptPath) : transcriptPath),
  });
  chatHub = hub;
  chatAttachments = new AttachmentStore({ root: attachmentsRoot });
  void chatAttachments.sweepOlderThan(ATTACHMENT_MAX_AGE_MS);
  const commandCatalog = createCommandCatalogScanner();
  const projectFiles = createProjectFiles();
  registerChatIpcHandlers({
    ipcMain,
    enabled: true,
    hub,
    attachments: chatAttachments,
    catalog: (cwd, transcriptPath) => commandCatalog.catalog(cwd, transcriptPath),
    files: (cwd, query, limit) => projectFiles.query(cwd, query, limit),
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    onFocusState: (input) => notifier.setFocusState(input.activePtyId, input.tabNames),
    onSendFailed: (entry) => chatDiagnostics.sendFailed(entry),
  });
  registerAssetsProtocol(protocol, { transcriptRoots: (ptyId) => hub.transcriptRoots(ptyId), attachmentsRoot });
}

/** Sessões remotas — origin URL and branch of the local project, so the remote clones the same repo. */
function localGitInfo(cwd: string): { repoUrl: string | null; branch: string | null } {
  const read = (args: string[]): string | null => {
    try {
      const out = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim();
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };
  return { repoUrl: read(['remote', 'get-url', 'origin']), branch: read(['branch', '--show-current']) };
}

/** Drops `--worktree <name>` (the remote session runs in the project folder; the mirror follows that transcript). */
function withoutWorktreeArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--worktree' || args[i] === '-w') {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

/**
 * Sessões remotas — `pty:create` of a `claude` tab that runs on a remote place (docs/adr/0006). The CLI runs in
 * a tmux session there; the PTY here is the ssh that shows it. Hooks and the browser MCP come back through
 * reverse tunnels; the transcript is mirrored into a local file the chat reads.
 */
async function createRemoteClaudeSession(options: PtyCreateOptions): Promise<PtyCreateResult> {
  const accountsConfig = accountEngineHost.current()?.getConfig() ?? appConfig.accounts;
  const place = accountsConfig.remotes.find((candidate) => candidate.id === options.remoteId);
  if (!place) throw new Error('Lugar remoto não encontrado — pode ter sido removido no painel Contas.');
  if (options.providerId) throw new Error('Provedor de terceiro ainda não roda em lugar remoto.');
  if (!remoteSessions) throw new Error('Sessões remotas ainda não estão prontas.');
  const localCwd = options.cwd ?? homedir();

  const launcherArgs = withoutWorktreeArgs(options.args ?? []);
  const { correlationId, extraArgs } = resolveClaudeCorrelation(launcherArgs, randomUUID);
  const ptyId = randomUUID();

  // Fresh tokens and ports; a live remote session answers with the ones its CLI already holds.
  const fresh: RemoteSessionMeta = {
    sid: correlationId,
    hookToken: randomBytes(16).toString('hex'),
    hookPort: pickRemotePort(),
    mcpToken: null,
    mcpPort: pickRemotePort(),
    localCwd,
    projectName: options.projectName ?? localCwd,
    name: options.tabName ?? options.projectName ?? localCwd,
    launchArgs: options.args ?? [],
    createdAt: new Date().toISOString(),
  };
  const files: RemoteFile[] = [];
  const claudeArgs: string[] = [...launcherArgs, ...extraArgs];

  const roleId = roleIdForSpawn(options.roleId, launcherArgs, options.renewalId);
  const rolePromptPath = roleId ? (rolesStore?.promptFileFor(roleId) ?? null) : null;
  if (rolePromptPath) {
    try {
      files.push({ name: 'role.md', content: readFileSync(rolePromptPath, 'utf8') });
      claudeArgs.push(...roleDeliveryFor('claude-code', '@S/role.md').args);
    } catch {
      // the session opens without the role, as a local one would
    }
  }

  const hooksOn = hookBridge !== null && hookBridge.port !== null;
  if (hooksOn) {
    const settings = buildSessionHooksSettings({
      port: fresh.hookPort,
      token: fresh.hookToken,
      curlPath: 'curl',
      statusLine: planStatusLineBridge({ mode: statusLineBridgeModeSetting, userStatusLine: null, chatEnabled: appConfig.chat.enabled }),
    });
    files.push({ name: 'settings.json', content: `${JSON.stringify(settings, null, 2)}\n` });
    claudeArgs.push('--settings', '@S/settings.json');
  }
  const mcp = fresh.mcpPort !== null ? (browserService?.prepareRemoteSession(ptyId, fresh.mcpPort) ?? null) : null;
  const meta: RemoteSessionMeta = { ...fresh, mcpToken: mcp?.token ?? null, mcpPort: mcp ? fresh.mcpPort : null };
  if (mcp) {
    files.push({ name: 'mcp.json', content: mcp.configFileContent });
    claudeArgs.push(...appMcpAllowArgs(), '--mcp-config', '@S/mcp.json');
  }
  const finalClaudeArgs = withResolvedPermissionMode(claudeArgs, readUserDefaultPermissionMode(undefined));

  await remoteSessions.waitEnded(correlationId);
  const git = localGitInfo(localCwd);
  const script = buildRemoteSetupScript({
    sid: correlationId,
    homeRelativeDir: remoteDirFor(localCwd, appConfig.projectRoots),
    repoUrl: git.repoUrl,
    branch: git.branch,
    files,
    claudeArgs: finalClaudeArgs,
    meta,
  });
  const setup = await runRemoteScript(place.sshTarget, script);
  const answer = parseRemoteSetupOutput(setup.stdout, setup.code);
  if (answer.kind === 'error') {
    browserService?.releasePty(ptyId);
    throw new Error(`${place.label}: ${answer.message}`);
  }
  const live = answer.kind === 'alive' ? answer.meta : meta;

  // The bridge and the MCP know this tab by the tokens the remote CLI holds.
  if (hooksOn && hookBridge) hookBridge.registerSession(ptyId, live.hookToken);
  if (answer.kind === 'alive') {
    browserService?.releasePty(ptyId);
    if (live.mcpPort !== null && live.mcpToken !== null) browserService?.prepareRemoteSession(ptyId, live.mcpPort, live.mcpToken);
  }
  const tunnels = [
    ...(hooksOn && hookBridge?.port ? [{ remotePort: live.hookPort, localPort: hookBridge.port }] : []),
    ...(live.mcpPort !== null && mcp ? [{ remotePort: live.mcpPort, localPort: mcp.localPort }] : []),
  ];

  try {
    ptyManager.create({
      id: ptyId,
      cols: options.cols,
      rows: options.rows,
      cwd: localCwd,
      command: process.platform === 'win32' ? 'ssh.exe' : 'ssh',
      args: buildAttachSshArgs({ sshTarget: place.sshTarget, sid: correlationId, tunnels }),
    });
  } catch (error) {
    hookBridge?.unregisterSession(ptyId);
    browserService?.releasePty(ptyId);
    throw error;
  }

  tabCwdByPty.set(ptyId, localCwd);
  activeSessionByPty.set(ptyId, correlationId);
  if (hooksOn) {
    semaphoreManager.registerSession(ptyId, correlationId);
    petService?.onSessionRegistered(ptyId);
    accountsBusyPtyIds.delete(ptyId);
  }
  accountsLiveSessionPtyIds.add(ptyId);
  browserService?.registerPty(ptyId);

  const mirror = remoteSessions.attach(ptyId, place.sshTarget, correlationId, answer.remoteDir);
  spawnedTranscriptPaths.set(correlationId, mirror);
  initialChatSourceByPty.set(ptyId, { sessionId: correlationId, transcriptPath: mirror, cwd: localCwd });
  startTranscriptWatcher(ptyId, mirror, correlationId);

  const accountId = place.activeAccountId;
  const accountLabel = accountId ? (accountEngineHost.current()?.getSnapshot().accounts.find((account) => account.id === accountId)?.label ?? accountId) : null;
  return { ptyId, claudeSessionId: correlationId, ...(accountId && accountLabel ? { account: { id: accountId, label: accountLabel } } : {}) };
}

function registerPtyIpcHandlers(): void {
  remoteSessions = new RemoteSessionRegistry(join(app.getPath('userData'), 'remote-transcripts'));
  ipcMain.handle(PTY_CHANNELS.remoteAlive, async (): Promise<RemoteAliveSession[]> => {
    const places = (accountEngineHost.current()?.getConfig() ?? appConfig.accounts).remotes;
    const found = await discoverRemoteSessions(places);
    return found.map(({ remoteId, meta }) => ({
      remoteId,
      sessionId: meta.sid,
      cwd: meta.localCwd,
      projectName: meta.projectName,
      name: meta.name,
      launchArgs: meta.launchArgs,
    }));
  });

  ipcMain.handle(PTY_CHANNELS.create, (_event, options: PtyCreateOptions): PtyCreateResult | Promise<PtyCreateResult> => {
    if (options.sessionType === 'claude' && options.remoteId && !options.accountLoginId) return createRemoteClaudeSession(options);
    if (options.sessionType === 'claude') {
      // T005 — spawna o `claude` CLI direto no PTY (plan.md ponto 1), não
      // dentro de um shell. Sem resolução → CA-5: o renderer reconhece o
      // prefixo e mostra o banner com o caminho esperado (nunca uma aba
      // quebrada sem explicação).
      const resolved = resolveClaudeExecutable(claudeResolveDeps);
      if (!resolved.found) {
        throw new Error(`${CLAUDE_NOT_FOUND_PREFIX}${resolved.expectedPath}`);
      }

      // 011-contas-e-provedores, etapa 3, Fase 1.2 — aba do login isolado:
      // SEM argv do launcher, SEM hooks do semáforo (`--settings`), SEM
      // `--session-id` — só o `claude` cru dentro do diretório efêmero do
      // login, pra o operador fazer `/login` de verdade. Mutuamente
      // exclusivo com `providerId` (mesmo espírito de C13/D2 — nenhuma
      // sessão nasce confusa sobre qual credencial está em jogo). Sai ANTES
      // de qualquer resolução de correlação/conta/provider abaixo: esta aba
      // não é uma sessão "de verdade" no sentido do resto deste handler.
      if (options.accountLoginId) {
        if (options.providerId) {
          throw new Error('accountLoginId e providerId são mutuamente exclusivos.');
        }
        const loginDir = isolatedLoginManager?.getPendingDir(options.accountLoginId) ?? null;
        if (!loginDir) {
          throw new Error('Login de conta não encontrado — pode ter sido cancelado.');
        }
        const loginPtyId = ptyManager.create({
          cols: options.cols,
          rows: options.rows,
          cwd: loginDir,
          command: resolved.launch.command,
          args: [...resolved.launch.argsPrefix],
          claudeConfigDir: loginDir,
        });
        isolatedLoginManager!.attachPty(options.accountLoginId, loginPtyId);
        return { ptyId: loginPtyId };
      }

      // T008 — argv do Launcher (CommandBuilder, FR-003/CA-1); vazio
      // preserva o comportamento antigo (T005: sessão sem flags).
      const launcherArgs = options.args ?? [];

      // T009 — correlação sessão<->aba (spike: `--session-id <uuid>`
      // determinístico) + hooks do semáforo (`--settings`, soma aditiva,
      // nunca toca ~/.claude/settings.json do usuário). Degrada com
      // graça se o servidor do semáforo não subiu no boot (app.whenReady):
      // a sessão continua funcionando, só sem os indicadores de estado.
      const { correlationId, extraArgs } = resolveClaudeCorrelation(launcherArgs, randomUUID);

      // T1222 (011-contas-e-provedores, etapa 2, D8/entregável) — com os
      // perfis demolidos, sessões SEM provider nunca mais recebem override de
      // `CLAUDE_CONFIG_DIR`: a única config é `~/.claude` (o motor escreve
      // credencial nela, ou em `accounts.claudeHome` só em teste). O
      // parâmetro `claudeConfigDir` do `PtyManager` é agora alimentado
      // exatamente pela porta que a etapa 3 (registry de providers) atravessa
      // — ver bloco `options.providerId` abaixo.
      //
      // T1319 (011-contas-e-provedores, etapa 3, C13/D2) — provider classe A
      // e motor de contas são MUTUAMENTE EXCLUSIVOS por sessão: com
      // `providerId`, o motor nem é consultado (nenhuma sessão nasce
      // autenticada por acidente com credencial de conta viajando para um
      // endpoint de terceiro).
      let accountsSnapshot: ReturnType<AccountEngine['getSnapshot']> | undefined;
      let motorActive = false;
      let envOverrides: Record<string, string> | undefined;
      let providerConfigDir: string | undefined;
      let spawnProvider: { id: string; label: string } | undefined;

      if (options.providerId) {
        const launchResult = providerRegistry.resolveLaunch(options.providerId);
        if (launchResult.kind !== 'ok') {
          // Nenhum valor de env cruza esta mensagem — só o NOME da variável
          // faltando, quando aplicável (C22, "erro nomeia a variável, nunca
          // o valor").
          const message =
            launchResult.kind === 'not-found'
              ? 'Provedor não encontrado — pode ter sido removido.'
              : launchResult.kind === 'unsupported-class'
                ? 'Este provedor ainda não é suportado nesta versão (classe B, C20).'
                : launchResult.kind === 'missing-secret'
                  ? `Falta configurar a variável "${launchResult.envKey}" deste provedor antes de lançar uma sessão.`
                  : 'O cofre de credenciais está indisponível neste dispositivo — não é possível lançar com provedor.';
          throw new Error(message);
        }
        envOverrides = launchResult.env;
        providerConfigDir = launchResult.configDir;
        const providerEntry = providerRegistry.list().find((entry) => entry.id === options.providerId);
        spawnProvider = { id: options.providerId, label: providerEntry?.label ?? options.providerId };
      } else {
        accountsSnapshot = accountEngineHost.current()?.getSnapshot();
        motorActive = accountsSnapshot !== undefined && accountsSnapshot.mod !== null;
      }

      // T1319 (C21/D3) — única resposta do app pra "qual CLAUDE_CONFIG_DIR
      // esta sessão usa": provider > motor > perfil. Perfis morreram na etapa
      // 2 (`activeProfileConfigDir` sempre `undefined` nesta árvore) — o
      // terceiro ramo já não existe, sem precisar tocar os dois primeiros.
      const claudeConfigDirForSession = resolveSessionConfigDir({
        providerConfigDir,
        accountsEngineActive: motorActive,
        activeProfileConfigDir: undefined,
      });

      // T015 (014-chat) — ponte: id da aba escolhido AQUI (o arquivo `--settings` leva o ptyId
      // no nome) e token registrado ANTES do spawn. Legado: arquivo único, sem token.
      // (Ponte da statusline: depois do config dir da sessão, que diz de onde ler a statusline do usuário.)
      const plannedPtyId = randomUUID();
      let sessionHooksSettingsPath: string | null = null;
      if (hooksTransport === 'bridge') {
        if (hookBridge && hookBridge.port !== null) {
          try {
            const token = hookBridge.registerSession(plannedPtyId);
            if (options.cwd) tabCwdByPty.set(plannedPtyId, options.cwd);
            sessionHooksSettingsPath = writeSessionHooksSettings({
              userDataDir: app.getPath('userData'),
              ptyId: plannedPtyId,
              port: hookBridge.port,
              token,
              curlPath,
              // Ponte da statusline — encadeia a do usuário (lida no config dir DESTA sessão
              // e no projeto); sem a dele, só com o chat desligado (hooks-settings.ts).
              statusLine: planStatusLineBridge({
                mode: statusLineBridgeModeSetting,
                userStatusLine: readUserStatusLine(claudeConfigDirForSession, options.cwd),
                chatEnabled: appConfig.chat.enabled,
              }),
              // "Isolar em worktree" — a worktree parte da branch ATUAL da pasta, não de origin/HEAD.
              isolatedWorktree: worktreeNameFromArgs(launcherArgs) !== null,
            });
          } catch (error) {
            // Degrada como o boot sem servidor: a sessão nasce sem semáforo, nunca sem terminal.
            console.error('[donel-dev] --settings da sessão não gravou — sessão sem hooks:', error);
            hookBridge.unregisterSession(plannedPtyId);
            tabCwdByPty.delete(plannedPtyId);
            sessionHooksSettingsPath = null;
          }
        }
      } else {
        sessionHooksSettingsPath = hooksSettingsPath;
      }
      const semaphoreArgs = sessionHooksSettingsPath ? ['--settings', sessionHooksSettingsPath] : [];
      // Navegador integrado — o MCP do app (`donel`) entregue ao CLI da sessão pela função por CLI
      // (`mcpDeliveryFor`, emenda agnóstica). Por último: `--mcp-config` é variádico e só opções podem vir depois.
      const browserMcpArgs = browserService?.prepareSession(plannedPtyId, 'claude-code') ?? [];
      // Papéis de sessão (item 12a) — the guidance of the role at every launch, resume and renewal
      // (`roleDeliveryFor`, one case per CLI). A missing role or file → the session opens without it.
      const roleId = roleIdForSpawn(options.roleId, launcherArgs, options.renewalId);
      const rolePromptPath = roleId ? (rolesStore?.promptFileFor(roleId) ?? null) : null;
      const roleArgs = rolePromptPath ? roleDeliveryFor('claude-code', rolePromptPath).args : [];
      const finalArgs = [...launcherArgs, ...extraArgs, ...roleArgs, ...semaphoreArgs, ...browserMcpArgs];
      // (T018: o `--permission-mode` resolvido entra mais abaixo, quando o config dir da sessão é conhecido.)

      let ptyId: string;
      try {
        ptyId = ptyManager.create({
          id: plannedPtyId,
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd,
          // FIX ambiente genérico (28/07) — `launch` embrulha shim `.cmd`/`.ps1`
          // (npm -g) no interpretador; ConPTY não executa script direto.
          command: resolved.launch.command,
          // T018 (014-chat, FR-030) — sessão `claude` sempre com modo de permissão
          // explícito: launcher > `permissions.defaultMode` do CLI do usuário > default.
          // Só este ramo: o shell e a aba de login (retorno antecipado acima) não passam por aqui.
          args: [
            ...resolved.launch.argsPrefix,
            ...withResolvedPermissionMode(finalArgs, readUserDefaultPermissionMode(claudeConfigDirForSession)),
          ],
          claudeConfigDir: claudeConfigDirForSession,
          envOverrides,
        });
      } catch (error) {
        // O spawn falhou: nada de token nem arquivo órfão.
        hookBridge?.unregisterSession(plannedPtyId);
        removeSessionHooksSettings(app.getPath('userData'), plannedPtyId);
        browserService?.releasePty(plannedPtyId);
        tabCwdByPty.delete(plannedPtyId);
        throw error;
      }

      activeSessionByPty.set(ptyId, correlationId);
      if (sessionHooksSettingsPath) {
        semaphoreManager.registerSession(ptyId, correlationId);
        // 015-jobu-pet (R2) — the semaphore announces a new session as `working` only because it is born
        // that way: for the Jobu that is not a turn. The pet forgets that emission and the tab stays
        // `idle` until the first real hook event (same reasoning as `accountsBusyPtyIds` right below).
        petService?.onSessionRegistered(ptyId);
        // 011-contas-e-provedores, etapa 3, Fase 2 (C5) — o semáforo nasce em
        // `working` enquanto o CLI sobe, e só sai dele num evento de hook (fim
        // de turno, notificação). Para o motor de contas isso não é "sessão
        // trabalhando": uma aba aberta e nunca usada adiaria o auto-switch para
        // sempre, com o painel dizendo "há sessão trabalhando". Só evento de
        // hook conta — a própria emissão do registro, que acabou de entrar no
        // conjunto, sai dele aqui (sem `releaseAccountsBusyPty`: não houve
        // transição de verdade para retomar nada).
        accountsBusyPtyIds.delete(ptyId);
      }
      // C4 — poll de 5 min do motor de contas só enquanto houver sessão viva.
      accountsLiveSessionPtyIds.add(ptyId);
      browserService?.registerPty(ptyId); // navegador interno: this session may open its panel

      // "Isolar em worktree" — o CLI roda a sessão DENTRO da worktree, e é sob ela que grava o `.jsonl`.
      const sessionCwd = sessionWorktrees.onSpawn(ptyId, options.cwd, options.args)?.path ?? options.cwd;

      // T412 (004) — reflexo AO VIVO do `/rename` (CA-4). O path do `.jsonl` já
      // é conhecido aqui: o id da sessão foi IMPOSTO no spawn logo acima.
      // T1319/C17 — com provider, o home consultado é o config dir DELE (mesmo
      // padrão de sempre com perfil/motor).
      const transcriptPath = resolveTranscriptPath(correlationId, sessionCwd, claudeConfigDirForSession);
      // T710 — guardado ANTES de qualquer coisa poder falhar: é o caminho que o
      // `forgetIfOrphan` vai conferir se esta retomada morrer (ver comentário de
      // `spawnedTranscriptPaths`).
      spawnedTranscriptPaths.set(correlationId, transcriptPath);
      // B36 — a renewed session carries the conversation it replaces: the tab's chat keeps it above a divider.
      const renewed = options.renewalId ? sessionRenewal?.get(options.renewalId) : undefined;
      initialChatSourceByPty.set(ptyId, {
        sessionId: correlationId,
        transcriptPath,
        cwd: sessionCwd ?? homedir(),
        ...(renewed && renewed.previousTranscriptPath
          ? {
              predecessor: {
                sessionId: renewed.previousSessionId,
                transcriptPath: renewed.previousTranscriptPath,
                handoffPath: renewed.handoffPath,
              },
            }
          : {}),
      });
      startTranscriptWatcher(ptyId, transcriptPath, correlationId);

      // T404 (004) — `correlationId` é o id da sessão do Claude (imposto no
      // spawn acima, ou herdado do `-r` numa retomada); devolvê-lo aqui é o
      // que dá ao renderer a chave para nomear/persistir esta sessão.
      // T1219/T1222 (etapa 2) — com o motor ativo, a conta devolvida é a
      // CONTA ativa dele (`{id, label}`); motor inerte (sem mod conectado,
      // C2) devolve `undefined` — não existe mais "conta ativa" fallback
      // (os perfis morreram; `computeSessionAccountLabel` cai no rótulo
      // global "Motor inerte" nesse caso).
      // T1319 (C13/D2) — com provider, `account` fica `undefined` de
      // propósito (mutuamente exclusivo) e `provider` é quem é preenchido.
      const spawnAccount =
        !spawnProvider && motorActive && accountsSnapshot?.activeAccountId
          ? {
              id: accountsSnapshot.activeAccountId,
              label: accountsSnapshot.accounts.find((account) => account.id === accountsSnapshot.activeAccountId)?.label ?? accountsSnapshot.activeAccountId,
            }
          : undefined;

      return { ptyId, claudeSessionId: correlationId, account: spawnAccount, provider: spawnProvider };
    }

    const ptyId = ptyManager.create(options);
    return { ptyId };
  });

  ipcMain.on(PTY_CHANNELS.input, (_event, ptyId: string, data: string) => {
    ptyManager.input(ptyId, data);
  });

  ipcMain.on(PTY_CHANNELS.resize, (_event, ptyId: string, cols: number, rows: number) => {
    ptyManager.resize(ptyId, cols, rows);
  });

  ipcMain.on(PTY_CHANNELS.kill, (_event, ptyId: string) => {
    markKillRequested(ptyId); // C3 (015-jobu-pet) — mark BEFORE killing: the exit that follows is "the owner's"
    ptyManager.kill(ptyId);
  });

  ipcMain.handle(PTY_CHANNELS.preview, (_event, ptyId: string): string[] => {
    return ptyManager.getPreview(ptyId);
  });
}

// T504 (005-terminal-copy-paste) — canais `clipboard:*` (T503 clipboard-bridge,
// plan.md decisão 6: clipboard vive no main, nunca no renderer). As três
// funções já degradam sozinhas em caso de exceção (clipboard-bridge.ts) —
// nada a fazer aqui além de repassar.
function registerClipboardIpcHandlers(): void {
  ipcMain.handle(CLIPBOARD_CHANNELS.hasImage, (): boolean => hasImage());

  ipcMain.handle(CLIPBOARD_CHANNELS.readText, (): string => readText());

  ipcMain.handle(CLIPBOARD_CHANNELS.writeText, (_event, text: string): void => {
    writeText(text);
  });
}

/** `%APPDATA%\donel-dev\config.json` (T015, config-store.ts) — só chamável após `app.whenReady()`. */
function getAppConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME);
}

/** Paths dos JSONs avulsos legados (T007/T014) — só usados pela migração de 1ª leitura (config-store.ts `readAppConfig`). */
function legacyConfigPaths(): { projectConfigPath: string; activeProfilePath: string } {
  const userDataDir = app.getPath('userData');
  return {
    projectConfigPath: join(userDataDir, LEGACY_PROJECT_CONFIG_FILE_NAME),
    activeProfilePath: join(userDataDir, LEGACY_ACTIVE_PROFILE_FILE_NAME),
  };
}

/**
 * Escrita atômica (FR-007) do `appConfig` em memória — chamada depois de TODA
 * mutação (favoritos, roots, perfil ativo, defaults do launcher, notificação).
 * G1 (issue 08): read-merge-write contra `lastSyncedAppConfig` (só as chaves
 * que ESTE processo mudou desde o último sync sobrescrevem o disco); depois
 * de gravar, `lastSyncedAppConfig` avança para o `appConfig` atual — é a
 * baseline da PRÓXIMA chamada.
 */
function persistAppConfig(): void {
  writeAppConfig(getAppConfigPath(), appConfig, configIoDeps, lastSyncedAppConfig);
  lastSyncedAppConfig = appConfig;
}

/** Scan + merge de favoritos + ordenação — a mesma pipeline usada por list e favorite (T007), agora sobre `appConfig.projectRoots`/`appConfig.favorites` (T015). */
function listProjectsWithFavorites(): ProjectInfo[] {
  const scanned = scanProjects(appConfig.projectRoots, projectScanDeps, appConfig.projectScanMode);
  return sortProjects(mergeFavorites(scanned, appConfig.favorites));
}

function registerProjectIpcHandlers(): void {
  ipcMain.handle(PROJECT_CHANNELS.list, (): ProjectInfo[] => listProjectsWithFavorites());
  ipcMain.handle(PROJECT_CHANNELS.tabFolders, (_event, cwd: unknown): readonly string[] =>
    typeof cwd === 'string' && cwd !== '' ? tabFoldersOf(cwd) : [],
  );

  ipcMain.handle(PROJECT_CHANNELS.favorite, (_event, path: string, favorite: boolean): ProjectInfo[] => {
    appConfig = { ...appConfig, favorites: toggleFavorite(appConfig.favorites, path, favorite) };
    persistAppConfig();
    return listProjectsWithFavorites();
  });

  /**
   * CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero pelo app"
   * (US-15). `allowedRoots` é SEMPRE `appConfig.projectRoots` (nunca uma
   * lista vinda do renderer — a allowlist de destino é decidida aqui, não
   * pelo payload IPC). Devolve resultado + lista já re-escaneada (mesmo
   * idioma de `PROJECT_CHANNELS.favorite`): projeto criado aparece na
   * sidebar/seletor sem round-trip extra.
   */
  ipcMain.handle(PROJECT_CHANNELS.create, async (_event, input: unknown): Promise<CreateProjectResponse> => {
    if (!isValidCreateProjectIpcInput(input)) {
      return { result: { ok: false, reason: 'empty' }, projects: listProjectsWithFavorites() };
    }
    const result = await createNewProject(input, appConfig.projectRoots, createProjectDeps);
    return { result, projects: listProjectsWithFavorites() };
  });
}

/** Roots vazias (após trim)/duplicadas nunca chegam no `appConfig` — mesma disciplina defensiva do resto do ConfigStore (nunca propaga lixo pro scan de projetos). Preserva a ORDEM recebida (1ª ocorrência de cada root). */
function sanitizeProjectRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const root of roots) {
    const trimmed = root.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * T015 — UI de Preferências (FR-007, feedback E2E rodada 3 "roots
 * configuráveis" + rodada 4 "notificação configurável") + `launcherDefaults`
 * (semeado a cada "▶ Iniciar" do Launcher, App.tsx `handleLaunch`).
 */
function registerConfigIpcHandlers(): void {
  ipcMain.handle(CONFIG_CHANNELS.get, (): AppConfigDto => toAppConfigDto(appConfig));

  ipcMain.handle(CONFIG_CHANNELS.setProjectRoots, (_event, roots: string[]): AppConfigDto => {
    appConfig = { ...appConfig, projectRoots: sanitizeProjectRoots(roots) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(CONFIG_CHANNELS.setNotificationPreference, (_event, preference: NotificationPreference): AppConfigDto => {
    appConfig = { ...appConfig, notificationPreference: preference };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /** FIX ambiente genérico (28/07) — critério da listagem de projetos; valor desconhecido degrada pro default. */
  ipcMain.handle(CONFIG_CHANNELS.setProjectScanMode, (_event, mode: ProjectScanMode): AppConfigDto => {
    appConfig = { ...appConfig, projectScanMode: mode === 'all' ? 'all' : 'markers' };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(CONFIG_CHANNELS.setLauncherDefaults, (_event, defaults: LauncherDefaultsDto): AppConfigDto => {
    appConfig = { ...appConfig, launcherDefaults: defaults };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /** T008 (014-chat) — atualização parcial de `chat`; campo que não é boolean é ignorado. */
  ipcMain.handle(CONFIG_CHANNELS.setChatPrefs, (_event, prefs: Partial<ChatPrefs>): AppConfigDto => {
    const patch = typeof prefs === 'object' && prefs !== null ? prefs : {};
    appConfig = {
      ...appConfig,
      chat: sanitizeChatPrefs({ ...appConfig.chat, ...patch }, appConfig.chat),
    };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /** Modo auto — atualização parcial; vale já, a ponte lê a preferência a cada pedido. */
  ipcMain.handle(CONFIG_CHANNELS.setAutoModePrefs, (_event, prefs: Partial<AutoModePrefs>): AppConfigDto => {
    const patch = typeof prefs === 'object' && prefs !== null ? prefs : {};
    appConfig = { ...appConfig, autoMode: sanitizeAutoModePrefs({ ...appConfig.autoMode, ...patch }, appConfig.autoMode) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /** Modo YOLO — vale já: a ponte lê a lista a cada pedido, e o que os pedidos abertos do projeto esperavam é aprovado aqui. */
  ipcMain.handle(CONFIG_CHANNELS.setProjectYolo, (_event, projectPath: unknown, enabled: unknown): AppConfigDto => {
    if (typeof projectPath !== 'string' || projectPath === '' || typeof enabled !== 'boolean') return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, yolo: { projects: withProjectYolo(appConfig.yolo.projects, projectPath, enabled) } };
    persistAppConfig();
    if (enabled) for (const ptyId of [...tabCwdByPty.keys()].filter(isTabYolo)) chatHub?.approveOpenPermissions(ptyId);
    return toAppConfigDto(appConfig);
  });

  /**
   * T020 (015-jobu-pet) — the Jobu switch. Only `enabled` comes from the renderer (position and size
   * are saved by the main, from the pet's gestures) and it applies at once, without a restart. An invalid
   * payload is a no-op: it returns the config as it is.
   */
  ipcMain.handle(CONFIG_CHANNELS.setPetPrefs, (_event, input: unknown): AppConfigDto => {
    if (isValidPetPrefsInput(input) && input.enabled !== undefined) setPetEnabled(input.enabled);
    return toAppConfigDto(appConfig);
  });

  /** B36 — sessão renovada em voo: partial update; an invalid field keeps its value. */
  ipcMain.handle(CONFIG_CHANNELS.setSessionRenewalPrefs, (_event, prefs: Partial<SessionRenewalPrefs>): AppConfigDto => {
    const patch = typeof prefs === 'object' && prefs !== null ? prefs : {};
    appConfig = { ...appConfig, sessionRenewal: sanitizeSessionRenewalPrefs({ ...appConfig.sessionRenewal, ...patch }, appConfig.sessionRenewal) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /** T708 (007) — substitui a lista INTEIRA de projetos com o grupo "Favoritos" colapsado (CA-1). */
  ipcMain.handle(CONFIG_CHANNELS.setCollapsedFavorites, (_event, collapsed: string[]): AppConfigDto => {
    appConfig = { ...appConfig, collapsedFavorites: Array.isArray(collapsed) ? collapsed.filter((path) => typeof path === 'string') : [] };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });
}

/**
 * T307 (003-modo-dev, Batch A) — canais `devMode:*` (CA-21/CA-4/CA-19).
 * Payload inválido (cardId/repoPath vazios, fase desconhecida) é NO-OP — o
 * main devolve o `AppConfigDto` atual sem mutar (validação pura em
 * `src/shared/devMode.ts`, testada isolada). **Nenhum canal aqui escreve no
 * TaskDex ou no vault** (invariante 5/CA-19) — só disco de leitura
 * e o `ConfigStore` local.
 */
function registerDevModeIpcHandlers(): void {
  ipcMain.handle(DEVMODE_CHANNELS.get, (): AppConfigDto => toAppConfigDto(appConfig));

  ipcMain.handle(DEVMODE_CHANNELS.openDiscovery, (_event, input: OpenDiscoveryIpcInput): AppConfigDto => {
    if (!isValidOpenDiscoveryIpcInput(input)) return toAppConfigDto(appConfig);
    appConfig = {
      ...appConfig,
      devMode: openDiscovery(appConfig.devMode, {
        cardId: input.cardId,
        repoPath: input.repoPath,
        epicId: input.epicId,
        openedAt: Date.now(),
      }),
    };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(DEVMODE_CHANNELS.focusDiscovery, (_event, cardId: string): AppConfigDto => {
    if (!isValidCardId(cardId)) return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, devMode: focusDiscovery(appConfig.devMode, cardId) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(DEVMODE_CHANNELS.closeDiscovery, (_event, cardId: string): AppConfigDto => {
    if (!isValidCardId(cardId)) return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, devMode: closeDiscovery(appConfig.devMode, cardId, Date.now()) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(DEVMODE_CHANNELS.archivePhaseSession, (_event, input: ArchivePhaseSessionIpcInput): AppConfigDto => {
    if (!isValidArchivePhaseSessionIpcInput(input)) return toAppConfigDto(appConfig);
    appConfig = {
      ...appConfig,
      devMode: archivePhaseSession(
        appConfig.devMode,
        { cardId: input.cardId, phase: input.phase },
        { sessionId: input.sessionId, accountId: input.accountId, archivedAt: Date.now() },
      ),
    };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(DEVMODE_CHANNELS.getDefaults, (): AppConfigDto => toAppConfigDto(appConfig));

  /** Tudo ou nada (mesma regra de `sanitizePhaseDefaultsTable`, T306): tabela malformada não muda o que já estava salvo. */
  ipcMain.handle(DEVMODE_CHANNELS.setDefaults, (_event, defaults: PhaseDefaultsTable): AppConfigDto => {
    appConfig = { ...appConfig, devMode: { ...appConfig.devMode, phaseDefaults: sanitizePhaseDefaultsTable(defaults) } };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  // Spec 010 / B6 — `devMode:readTree` saiu com o leitor de árvore do modelo antigo: não há
  // mais árvore de disco a montar. O mapa lê o STORE (`esteira:snapshot`).

  /**
   * T311/CA-1 — cards das 3 colunas de entrada do board configurado. Sem
   * board/sem fonte = `[]` (porta desligada, nunca erro). `repoPath` (item 1,
   * frente 2 da rodada de feedback 30/07) — projeto selecionado agora no
   * renderer; `effectiveBoardConfig` prefere o board DESSE projeto
   * (`repos.<repoSlug>.board`) e só cai pro board global sem ele.
   */
  ipcMain.handle(DEVMODE_CHANNELS.listEntryCards, async (_event, repoPath?: unknown): Promise<readonly EntryColumnCard[]> => {
    return listEntryColumnCards(effectiveBoardConfig(typeof repoPath === 'string' ? repoPath : undefined), boardReader);
  });

  /**
   * T327/CA-12 — os 4 fatos do board para os cards do discovery EM FOCO (a
   * lista vem do renderer; o main nunca varre o board). Payload inválido é
   * no-op (`{}`), card sem fato some do mapa. **Leitura pura** — não existe
   * canal simétrico de escrita (invariante 5/CA-14).
   */
  ipcMain.handle(DEVMODE_CHANNELS.readBoardFacts, async (_event, cardIds: readonly string[]): Promise<Record<string, BoardFacts>> => {
    if (!isValidCardIdList(cardIds)) return {};
    // As duas leituras em paralelo: os fatos são card a card, a trava é uma
    // varredura só do board (o filtro do TaskDex é por etiqueta, não por task).
    const [facts, locks] = await Promise.all([
      readBoardFactsFor(cardIds, boardFactsReader),
      boardLocksReader.fetchLockedPhases(),
    ]);
    return mergeLockedPhases(facts, locks);
  });

  /**
   * Issue #34 (P0) — resolve o repo-alvo do card por RASTRO EM DISCO
   * (`esteira-state/<repoSlug>/<cardId>/` ou o `.esteira/discovery/` legado
   * de cada repo conhecido em `repos.json`), nunca pelo repo em foco na
   * sidebar. `boardRepoPath` (o repo por trás do dropdown "Board" do modal)
   * só entra como último recurso, sem rastro nenhum — e só resolve sozinho
   * quando é dono de UM repo só; 2+ repos com o mesmo board viram `ambiguous`
   * (a UI pergunta, nunca chuta o `default_repo`). Payload inválido devolve
   * `unknown` — o mesmo "não sei" de um card sem repo nenhum encontrado.
   */
  ipcMain.handle(DEVMODE_CHANNELS.resolveCardRepo, (_event, input: ResolveCardRepoIpcInput): CardRepoResolution => {
    if (!isValidResolveCardRepoIpcInput(input)) return { kind: 'unknown' };
    const reposText = fileIo.readFileText(reposConfigPath(ESTEIRA_CONFIG_DIR));
    const repos = readAllRepoEntries(reposText);
    return resolveCardRepo(
      { cardId: input.cardId, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos, boardRepoPath: input.boardRepoPath },
      fileIo,
    );
  });

  /**
   * Issue #38 — mesma resolução do canal acima, só que para a LISTA inteira
   * da porta de entrada num único IPC: a lista rotulava todo card com o repo
   * do dropdown de board mesmo quando o card real era de outro repo que
   * compartilha o mesmo board (`spotsys`/`dalton`). Um `resolveCardRepo` por
   * linha dentro do loop de render da UI seria dezenas de IPCs a cada
   * abertura do modal — este canal lê `repos.json` UMA vez e resolve o lote
   * inteiro numa só invocação de main. Payload inválido devolve `{}` (mesmo
   * "nada a mostrar" do resto da API de leitura pura).
   */
  ipcMain.handle(
    DEVMODE_CHANNELS.resolveCardRepos,
    (_event, input: ResolveCardReposIpcInput): Record<string, CardRepoResolution> => {
      if (!isValidResolveCardReposIpcInput(input)) return {};
      const reposText = fileIo.readFileText(reposConfigPath(ESTEIRA_CONFIG_DIR));
      const repos = readAllRepoEntries(reposText);
      return resolveCardRepos(
        { cardIds: input.cardIds, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos, boardRepoPath: input.boardRepoPath },
        fileIo,
      );
    },
  );

  /**
   * T315/CA-6 — liga o watcher do `<fase>-result.json` daquela etapa. O
   * evento volta pelo `sender` que pediu o watch (nunca um broadcast global).
   * Idempotente: pedir duas vezes a mesma etapa não abre dois `fs.watch`.
   */
  ipcMain.handle(DEVMODE_CHANNELS.watchPhase, (event, input: WatchPhaseIpcInput): void => {
    if (!isValidWatchPhaseIpcInput(input)) return;
    const repoPath = appConfig.devMode.discoveries[input.discoveryCardId]?.repoPath;
    if (!repoPath) return;

    const key = phaseWatchKey(input);
    if (esteiraResultWatchers.has(key)) return;

    const sender = event.sender;
    const handle = watchEsteiraResult({
      esteiraStateRoot: ESTEIRA_STATE_ROOT,
      repoSlug: resolveRepoSlug(repoPath),
      fase: input.phase,
      cardId: input.cardId,
      faseNum: input.faseNum,
      // ACHADO DO SMOKE (T322): o diretório `handoffs/…` só nasce quando a
      // SKILL chega ao fim — e uma fase da Esteira leva minutos ou horas. Com
      // o default do módulo (1s × 30 = 30s) o watcher desistia muito antes do
      // manifesto existir, e o arquivamento do CA-6 nunca disparava fora de
      // um teste. Janela de espera aqui é ~1h (3s × 1200), um timer barato;
      // passado isso a fase segue visível como travada (CA-15) — só o
      // arquivamento automático deixa de acontecer.
      retryMs: 3_000,
      maxRetries: 1_200,
      onArchived: (archived) => {
        if (sender.isDestroyed()) return;
        const payload: PhaseArchivedPayload = {
          discoveryCardId: input.discoveryCardId,
          cardId: archived.cardId,
          phase: archived.fase,
          faseNum: archived.faseNum,
          manifestPath: archived.manifestPath,
        };
        sender.send(DEVMODE_CHANNELS.phaseArchived, payload);
      },
    });
    esteiraResultWatchers.set(key, handle);
  });

  ipcMain.handle(DEVMODE_CHANNELS.unwatchPhase, (_event, input: WatchPhaseIpcInput): void => {
    if (!isValidWatchPhaseIpcInput(input)) return;
    const key = phaseWatchKey(input);
    esteiraResultWatchers.get(key)?.dispose();
    esteiraResultWatchers.delete(key);
  });
}

// ---------------------------------------------------------------------------
// Spec 010 — a esteira nova (store de eventos + contrato com as skills). Nasce
// AO LADO do Modo Dev atual, sem tocar o mapa antigo (`[P-5]`: ele saiu no
// batch B6, quando o modelo novo provou a
// espinha — não antes, para dar para comparar os dois com o mesmo dado).
// ---------------------------------------------------------------------------

/** `null` até `app.whenReady()` — o serviço precisa do `userData` resolvido. */
let esteiraService: EsteiraService | null = null;

/**
 * Qual canal está escrevendo no store — só DIAGNÓSTICO no cabeçalho (a decisão
 * de compatibilidade é pelo `schema_version`, nunca pelo canal). Os três
 * instalados compartilham `app.getName()` de propósito (decisão de 28/07), então
 * o que os distingue é o executável.
 */
function appChannelName(): string {
  const executable = process.execPath.toLowerCase();
  if (executable.includes('alfa')) return 'alfa';
  if (executable.includes('beta')) return 'beta';
  return app.isPackaged ? 'stable' : 'dev';
}

function registerEsteiraIpcHandlers(): void {
  // D-12 — o espelho no tracker. O mapeamento etapa → coluna vem do ARQUIVO
  // (`~/.claude/esteira-config/donel-mirror.json`), nunca de constante no
  // código: as colunas mudam. Sem arquivo, ou sem adapter plugado, o app
  // trabalha exatamente como antes — o tracker é plugue, não requisito.
  const mirrorConfig = parseMirrorConfig(esteiraConfigIoDeps.readFileText(join(ESTEIRA_CONFIG_DIR, MIRROR_CONFIG_FILE)));

  esteiraService = createEsteiraService({
    storeDir: esteiraStoreDir(process.env, app.getPath('userData')),
    inboxDir: esteiraInboxDir(process.env, homedir),
    outboxDir: esteiraOutboxDir(process.env, homedir),
    channel: appChannelName(),
    mirror: { config: mirrorConfig, adapter: resolveBoardMirrorAdapter(process.env, mirrorConfig) },
  });

  // O store muda por três caminhos (ingestão do outbox, gesto da UI, outro
  // canal do app escrevendo no mesmo `userData`) — a tela ouve UM evento só.
  esteiraService.startWatching((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(ESTEIRA_CHANNELS.changed, state);
    }
  });

  ipcMain.handle(ESTEIRA_CHANNELS.snapshot, (): EsteiraSnapshotDto | null => esteiraService?.snapshotDto() ?? null);

  ipcMain.handle(ESTEIRA_CHANNELS.scanOutbox, (): EsteiraSnapshotDto | null => esteiraService?.scanOutbox() ?? null);

  ipcMain.handle(ESTEIRA_CHANNELS.createDiscovery, (_event, input: unknown): EsteiraCreateDiscoveryDto | null => {
    if (esteiraService === null) return null;
    // Payload inválido não muta nada — mesmo princípio dos canais `devMode:*`.
    if (!isValidCreateDiscoveryIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.createDiscovery(input);
  });

  // D-2 — semear trabalho em curso. Mesmo rigor do resto: payload invalido nao
  // muta nada, e documento fora do formato volta com o caminho do campo.
  ipcMain.handle(ESTEIRA_CHANNELS.seed, (_event, input: unknown): EsteiraSeedDto | null => {
    if (esteiraService === null) return null;
    if (!isValidSeedIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.seed(input);
  });

  ipcMain.handle(ESTEIRA_CHANNELS.dispatch, (_event, input: unknown): EsteiraDispatchDto | null => {
    if (esteiraService === null) return null;
    if (!isValidDispatchIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.dispatch(input);
  });

  // Batch B1 — a aba abriu e o CLI devolveu o id da sessão: é o fato que
  // separa "preparada" de "em andamento".
  ipcMain.handle(ESTEIRA_CHANNELS.claimSession, (_event, input: unknown): EsteiraSnapshotDto | null => {
    if (esteiraService === null) return null;
    if (!isValidClaimSessionIpcInput(input)) return esteiraService.snapshotDto();
    return esteiraService.claimSession(input);
  });

  // Batch B1 — a aba fechou sem a fase concluir: encerra a sessão e solta a
  // trava, para o card nunca ficar preso sem saída.
  ipcMain.handle(ESTEIRA_CHANNELS.endSession, (_event, input: unknown): EsteiraSnapshotDto | null => {
    if (esteiraService === null) return null;
    if (!isValidEndSessionIpcInput(input)) return esteiraService.snapshotDto();
    return esteiraService.endSession(input);
  });

  ipcMain.handle(ESTEIRA_CHANNELS.releaseLock, (_event, input: unknown): EsteiraSnapshotDto | null => {
    if (esteiraService === null) return null;
    if (!isValidReleaseLockIpcInput(input)) return esteiraService.snapshotDto();
    return esteiraService.releaseLock(input);
  });

  // Os gestos de B3. Todos seguem a mesma regra dos canais acima: payload
  // inválido não muta nada e volta com a razão, em vez de falhar calado.
  ipcMain.handle(ESTEIRA_CHANNELS.setStageOverride, (_event, input: unknown): EsteiraGestureDto | null => {
    if (esteiraService === null) return null;
    if (!isValidSetStageOverrideIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.setStageOverride(input);
  });

  ipcMain.handle(ESTEIRA_CHANNELS.setDiscoveryRepos, (_event, input: unknown): EsteiraGestureDto | null => {
    if (esteiraService === null) return null;
    if (!isValidSetDiscoveryReposIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.setDiscoveryRepos(input);
  });

  ipcMain.handle(ESTEIRA_CHANNELS.setWorkItemState, (_event, input: unknown): EsteiraGestureDto | null => {
    if (esteiraService === null) return null;
    if (!isValidSetWorkItemStateIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.setWorkItemState(input);
  });

  ipcMain.handle(ESTEIRA_CHANNELS.discardWorkItem, (_event, input: unknown): EsteiraGestureDto | null => {
    if (esteiraService === null) return null;
    if (!isValidDiscardWorkItemIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.discardWorkItem(input);
  });

  ipcMain.handle(ESTEIRA_CHANNELS.addNote, (_event, input: unknown): EsteiraGestureDto | null => {
    if (esteiraService === null) return null;
    if (!isValidAddNoteIpcInput(input)) return { ok: false, reason: 'invalid-input', state: esteiraService.snapshotDto() };
    return esteiraService.addNote(input);
  });

  // Único canal do espelho que espera resposta: é o gesto de quem clicou
  // "Reenviar". A drenagem normal acontece atrás de cada gesto local, sem
  // ninguém esperando por ela.
  ipcMain.handle(ESTEIRA_CHANNELS.retryMirror, async (): Promise<EsteiraSnapshotDto | null> => {
    if (esteiraService === null) return null;
    return esteiraService.retryMirror();
  });

  // C3 (batch N5) — lê o texto de um artefato apontado pelo store (D-8), só
  // leitura, restrito a `.md`. O `path` chega ABSOLUTO, já resolvido no
  // renderer contra a lista de projetos conhecidos — a MESMA fronteira de
  // confiança de onde a sessão de terminal abre (D-6): este canal não é uma
  // capacidade nova de acesso a disco, é uma MENOR que a que já existe
  // (spawn de shell). `fileIo` (`file-io.ts`) nunca lança — degrada por
  // omissão, mesmo padrão do resto do main.
  ipcMain.handle(ESTEIRA_CHANNELS.readArtifactText, (_event, input: unknown): ReadArtifactTextDto => {
    if (!isValidReadArtifactTextIpcInput(input)) return { ok: false, reason: 'invalid-input' };
    if (!fileIo.existsSync(input.path)) return { ok: false, reason: 'not-found' };
    const text = fileIo.readFileText(input.path);
    return text === null ? { ok: false, reason: 'read-error' } : { ok: true, text };
  });
}

/**
 * T013 — índice de sessões anteriores por projeto (FR-004, CA-2). Delega
 * inteiramente pro SessionIndexer (T012, TDD já fechado — não reescrito
 * aqui): stream das primeiras linhas, nunca o arquivo inteiro, `[]` sem
 * lançar pra projeto que nunca abriu sessão. Handler async porque
 * `indexProjectSessions` é async (leitura de disco); `ipcMain.handle` já
 * espera a Promise antes de responder o `invoke` do renderer.
 */
function registerSessionIpcHandlers(): void {
  // Ponte da statusline — leituras vivas por aba, para quem monta depois do primeiro push.
  ipcMain.handle(STATUS_LINE_CHANNELS.getAll, (): Record<string, StatusLineSnapshot> => statusLineStore.all());
  ipcMain.handle(SESSION_CHANNELS.list, async (_event, projectPath: string): Promise<SessionSummaryDto[]> => {
    return indexProjectSessions(projectPath);
  });

  /**
   * T406 (004) — primeira escrita do domínio de sessões. A validação do C5
   * (`normalizeSessionName`) roda AQUI, não só na UI, porque é este handler
   * que persiste: nome vazio depois do trim apaga a entrada; senão grava
   * `{ name, seenTitle, updatedAt }`, onde `seenTitle` é o `custom-title` que a
   * UI exibia na hora da edição (insumo do dirty-check do C2). `sessionId`
   * vazio é ignorado — aba `shell` não tem sessão do Claude e nomeia só em
   * memória (C4), então nunca deveria chegar aqui.
   */
  ipcMain.handle(
    SESSION_CHANNELS.setName,
    (_event, sessionId: string, name: string, seenTitle: string | null): AppConfigDto => {
      if (typeof sessionId !== 'string' || !sessionId) return toAppConfigDto(appConfig);

      const normalized = normalizeSessionName(name);
      const stampedSeenTitle = typeof seenTitle === 'string' && seenTitle ? seenTitle : null;

      const sessionNames =
        normalized === null
          ? clearSessionName(appConfig.sessionNames, sessionId)
          : setSessionName(appConfig.sessionNames, sessionId, {
              name: normalized,
              seenTitle: stampedSeenTitle,
              updatedAt: new Date().toISOString(),
            });

      appConfig = { ...appConfig, sessionNames };
      persistAppConfig();
      return toAppConfigDto(appConfig);
    },
  );

  /**
   * T705 (007-favoritos-sessoes) — upsert de uma visita no registro (D9/CA-7).
   * Só o RENDERER chama (plan.md §Fatia 2: um escritor só, o main só valida o
   * payload — a mesma disciplina defensiva do `setName` acima, com `typeof`
   * explícito mesmo o contrato TS já dizendo `string`). `upsertVisit` já é
   * no-op para `sessionId`/`projectPath`/`label` vazios (sessionRegistry.ts),
   * então a checagem aqui é só a primeira linha de defesa contra IPC malformado.
   */
  ipcMain.handle(
    SESSION_CHANNELS.registerVisit,
    (_event, sessionId: string, projectPath: string, label: string): AppConfigDto => {
      if (typeof sessionId !== 'string' || typeof projectPath !== 'string' || typeof label !== 'string') {
        return toAppConfigDto(appConfig);
      }
      appConfig = { ...appConfig, sessionRegistry: upsertVisit(appConfig.sessionRegistry, { sessionId, projectPath, label, atMs: Date.now() }) };
      persistAppConfig();
      return toAppConfigDto(appConfig);
    },
  );

  /** T705/CA-5 — fixa/desfixa a SESSÃO (persistido); `setPinned` (sessionRegistry.ts) já é no-op pra sessionId inexistente. */
  ipcMain.handle(SESSION_CHANNELS.setPinned, (_event, sessionId: string, pinned: boolean): AppConfigDto => {
    if (typeof sessionId !== 'string' || !sessionId) return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, sessionRegistry: setPinned(appConfig.sessionRegistry, sessionId, pinned === true) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /** T705/CA-11 — "esquecer" uma entrada órfã (retomar falhou, `.jsonl` sumiu). Canal PRÓPRIO — não reaproveita `setPinned` (desfixar e esquecer são operações diferentes). */
  ipcMain.handle(SESSION_CHANNELS.forget, (_event, sessionId: string): AppConfigDto => {
    if (typeof sessionId !== 'string' || !sessionId) return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, sessionRegistry: removeSession(appConfig.sessionRegistry, sessionId) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /**
   * B39 — Retomar opens a conversation where it lives. Here when its transcript is on this disk; else each
   * remote place is asked by ssh, and the one that has it runs the resume. A place that does not answer makes
   * the answer `unreachable`: the renderer says so instead of opening an empty session on this computer.
   */
  ipcMain.handle(SESSION_CHANNELS.whereLives, async (_event, sessionId: unknown, projectPath: unknown): Promise<SessionWhereLives> => {
    if (typeof sessionId !== 'string' || typeof projectPath !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(sessionId)) return { kind: 'local' };
    if (localTranscriptExists(sessionId, projectPath)) return { kind: 'local' };
    const places = (accountEngineHost.current()?.getConfig() ?? appConfig.accounts).remotes;
    if (places.length === 0) return { kind: 'local' };
    const answers = await findRemoteTranscript(places, remoteDirFor(projectPath, appConfig.projectRoots), sessionId);
    const found = answers.find((answer) => answer.answer === 'has');
    if (found) return { kind: 'remote', remoteId: found.id };
    const silent = answers.filter((answer) => answer.answer === 'unreachable');
    if (silent.length > 0) return { kind: 'unreachable', labels: silent.map((answer) => places.find((place) => place.id === answer.id)?.label ?? answer.id) };
    return { kind: 'local' };
  });

  /**
   * T710/CA-11 (2º momento) — o renderer viu a retomada morrer com código != 0
   * (`shouldForgetOnResumeFailure`, sinal medido em
   * `specs/008-fechar-pendencias/medicao-t710.md`) e pede o esquecimento. Aqui
   * mora a PROVA: só remove se o `.jsonl` daquela sessão não existir mesmo.
   * É o que impede um exit code != 0 de outra origem (cota estourada, `claude`
   * não encontrado, Ctrl+C precoce) de apagar uma entrada boa.
   *
   * O caminho conferido é o gravado NO SPAWN (`spawnedTranscriptPaths`, perfil
   * de nascimento da aba); o fallback re-deriva pelo `projectPath` da entrada
   * com o perfil ATIVO, para a sessão que nasceu em outra execução do app.
   */
  ipcMain.handle(SESSION_CHANNELS.forgetIfOrphan, (_event, sessionId: string): AppConfigDto => {
    if (typeof sessionId !== 'string' || !sessionId) return toAppConfigDto(appConfig);
    const entry = appConfig.sessionRegistry[sessionId];
    if (!entry) return toAppConfigDto(appConfig);

    const transcriptPath = spawnedTranscriptPaths.get(sessionId) ?? resolveTranscriptPath(sessionId, entry.projectPath, undefined);
    // B39 — a conversation of a remote place leaves its mirror here: not on this disk is not "gone".
    const mirrored = remoteSessions !== null && existsSync(remoteSessions.mirrorPathFor(sessionId));
    appConfig = {
      ...appConfig,
      sessionRegistry: forgetIfOrphan(appConfig.sessionRegistry, sessionId, mirrored || existsSync(transcriptPath)),
    };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  /**
   * T706/CA-8 — a ÚNICA leitura de disco desta feature; delega inteiramente
   * pro `seedProject` (T706, TDD já fechado): a guarda dura ("projeto já tem
   * entrada → não lê disco") vive lá, não aqui, para ser testável sem subir o
   * Electron. `claudeHome` é o do PERFIL ATIVO (mesmo valor usado em
   * `resolveTranscriptPath`/`claudeConfigDir` do spawn) — os transcripts do
   * perfil ativo vivem lá, não necessariamente em `~/.claude`.
   */
  ipcMain.handle(SESSION_CHANNELS.seedProject, async (_event, projectPath: string): Promise<AppConfigDto> => {
    if (typeof projectPath !== 'string' || !projectPath) return toAppConfigDto(appConfig);
    const sessionRegistry = await seedProject(
      appConfig.sessionRegistry,
      projectPath,
      appConfig.sessionNames,
      // Re-read after the disk read: a visit written meanwhile must not be lost.
      { indexProjectSessions, readLatestRegistry: () => appConfig.sessionRegistry },
      undefined,
    );
    appConfig = { ...appConfig, sessionRegistry };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });
}

/**
 * CA-26/CA-27 (009-modo-dev-v3, lote 1) — cor + ordem da aba v3, por sessão
 * claude. `sessionId` vazio ou payload malformado (cor fora dos 4 tokens,
 * `order` não-finita) é no-op — o handler nunca confia cegamente no que o
 * renderer manda, mesmo padrão de `SESSION_CHANNELS.setName`/`setPinned`.
 */
function registerTabIpcHandlers(): void {
  ipcMain.handle(TAB_CHANNELS.setColor, (_event, sessionId: string, color: unknown): AppConfigDto => {
    if (typeof sessionId !== 'string' || !sessionId || !isTabColorToken(color)) return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, tabAppearance: setTabColor(appConfig.tabAppearance, sessionId, color) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });

  ipcMain.handle(TAB_CHANNELS.setOrder, (_event, sessionId: string, order: unknown): AppConfigDto => {
    if (typeof sessionId !== 'string' || !sessionId || typeof order !== 'number') return toAppConfigDto(appConfig);
    appConfig = { ...appConfig, tabAppearance: setTabOrder(appConfig.tabAppearance, sessionId, order) };
    persistAppConfig();
    return toAppConfigDto(appConfig);
  });
}

/** Saúde do computador — `null` until the handlers are registered (whenReady) and again after the app closes. */
let healthService: HealthService | null = null;

/** The app's own pids: the main plus every helper Electron started (renderers, GPU, utility). */
function ownAppPids(): number[] {
  const pids = new Set<number>([process.pid]);
  for (const metric of app.getAppMetrics()) pids.add(metric.pid);
  return [...pids];
}

function registerHealthIpcHandlers(): void {
  healthService = createHealthService({
    collect: () => collectHealthSnapshot({ ownPids: ownAppPids }),
    onReport: (report) => {
      const window = getMainWindow();
      if (window) window.webContents.send(HEALTH_CHANNELS.changed, report);
    },
    ownPids: ownAppPids,
    lookupProcessName,
    terminate: (pid) => {
      process.kill(pid);
    },
  });
  healthService.start();
  ipcMain.handle(HEALTH_CHANNELS.get, (): HealthReport | null => healthService?.getReport() ?? null);
  ipcMain.handle(HEALTH_CHANNELS.refresh, async (): Promise<HealthReport | null> => (healthService ? healthService.refresh() : null));
  ipcMain.handle(HEALTH_CHANNELS.killProcess, async (_event, pid: unknown): Promise<KillProcessOutcome> =>
    healthService ? healthService.killProcess(pid) : { ok: false, reason: 'no-report' },
  );
  ipcMain.handle(HEALTH_CHANNELS.openTemp, (): Promise<string> => shell.openPath(app.getPath('temp')));
}

/** B33 — `null` until whenReady. */
let appUpdateService: AppUpdateService | null = null;

/**
 * B33 — the in-app update. Only the packaged alpha: electron-updater on the GitHub releases feed the alpha build
 * publishes (`app-update.yml`, written by the build), token from the `gh` of this PC.
 */
function registerAppUpdateIpcHandlers(): void {
  const channel = appChannelName();
  const applies = app.isPackaged && channel === 'alfa';
  appUpdateService = createAppUpdateService({
    enabled: applies,
    currentVersion: app.getVersion(),
    updater: () => autoUpdater,
    stateDir: join(app.getPath('userData'), 'app-update', channel),
    channel,
    onChanged: (status) => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send(APP_UPDATE_CHANNELS.changed, status);
    },
  });
  appUpdateService.start();
  const disabled: AppUpdateStatus = { enabled: false, currentVersion: app.getVersion(), available: null, failure: null };
  ipcMain.handle(APP_UPDATE_CHANNELS.get, (): AppUpdateStatus => appUpdateService?.status() ?? disabled);
  ipcMain.handle(APP_UPDATE_CHANNELS.apply, (_event, tabs: unknown): AppUpdateApplyResult =>
    appUpdateService ? appUpdateService.apply(tabs) : { ok: false, message: 'Atualização indisponível.' },
  );
  ipcMain.handle(APP_UPDATE_CHANNELS.takeBoot, (): AppUpdateBoot => appUpdateService?.takeBoot() ?? { tabs: [], failure: null });
  ipcMain.handle(APP_UPDATE_CHANNELS.check, async (): Promise<void> => {
    await appUpdateService?.check();
  });
}
/** Sidebar — "Abrir no editor" + branch atual. Spawn sem shell, argumentos em array (workspace-tools.ts). */
function registerWorkspaceIpcHandlers(): void {
  const tools = createWorkspaceTools(createSystemWorkspaceToolsDeps());
  ipcMain.handle(WORKSPACE_CHANNELS.editorStatus, () => tools.editorStatus());
  ipcMain.handle(WORKSPACE_CHANNELS.openInEditor, (_event, path: unknown) => tools.openInEditor(path));
  ipcMain.handle(WORKSPACE_CHANNELS.gitBranch, (_event, path: unknown) => tools.gitBranch(path));
  // B3 — PR da branch + checks/reviews, só leitura pelo `gh` (pull-request-status.ts).
  const pullRequests = createPullRequestStatusService(createSystemPullRequestStatusDeps(async (path) => (await tools.gitBranch(path)).branch));
  ipcMain.handle(WORKSPACE_CHANNELS.pullRequest, (_event, path: unknown, options: unknown) =>
    pullRequests.get(path, { details: (options as { details?: unknown } | undefined)?.details === true }),
  );
  ipcMain.handle(WORKSPACE_CHANNELS.openPullRequestUrl, (_event, url: unknown) => openPullRequestUrl(url, (safe) => shell.openExternal(safe)));
  ipcMain.handle(WORKSPACE_CHANNELS.openWorktreeFolder, (_event, path: unknown) => sessionWorktrees.openFolder(path));
}

/**
 * Mindscape (V1) — load/save of `mindscape.json`. The main is the only writer
 * and validates the payload (`parseMindscapeDoc`) before writing.
 * Desenho, fatia 06 — the prints in `mindscape-images/` beside it (save/read by
 * imageId), and the boot sweep of the orphans (never during the run).
 */
function registerMindscapeIpcHandlers(): void {
  const filePath = mindscapeFilePath(process.env, app.getPath('userData'));
  const store = createMindscapeStore(filePath, configIoDeps);
  ipcMain.handle(MINDSCAPE_CHANNELS.load, (): MindscapeDoc => store.load());
  ipcMain.handle(MINDSCAPE_CHANNELS.save, (_event, doc: unknown): MindscapeSaveResult => store.save(doc));
  const images = createMindscapeImages({ dir: mindscapeImagesDir(filePath) });
  ipcMain.handle(MINDSCAPE_CHANNELS.saveImage, (_event, payload: unknown): Promise<MindscapeSaveImageResult> => images.save(payload));
  ipcMain.handle(MINDSCAPE_CHANNELS.readImage, (_event, imageId: unknown): Promise<MindscapeReadImageResult> => images.read(imageId));
  // After the handlers: the sweep reads the raw file and never runs on a missing, invalid or newer one.
  void images.sweepOrphans(configIoDeps.readFileText(filePath)).catch(() => undefined);
}

/** Papéis de sessão (item 12a) — list and save of `<userData>/papeis/<id>.md`. */
function registerRolesIpcHandlers(): void {
  const store = createRolesStore(app.getPath('userData'));
  rolesStore = store;
  ipcMain.handle(ROLES_CHANNELS.list, (): SessionRole[] => store.list());
  ipcMain.handle(ROLES_CHANNELS.save, (_event, role: unknown): RoleSaveResult => store.save(role));
}

/**
 * Papéis de sessão (item 12a) — the role a `claude` spawn carries. Explicit from the renderer (a
 * place that had not started, the Launcher, a fork); else the role of the place that holds the
 * resumed conversation, or the conversation a renewal replaces. Read from `mindscape.json`, which
 * the renderer keeps saved; any failure → no role (the session still opens).
 */
function roleIdForSpawn(explicit: string | undefined, launcherArgs: readonly string[], renewalId: string | undefined): string | undefined {
  if (explicit) return explicit;
  const resumeIndex = launcherArgs.indexOf('-r');
  const resumed = resumeIndex !== -1 && !launcherArgs.includes('--fork-session') ? launcherArgs[resumeIndex + 1] : undefined;
  const predecessor = renewalId ? sessionRenewal?.get(renewalId)?.previousSessionId : undefined;
  const sessionId = resumed ?? predecessor;
  if (!sessionId) return undefined;
  try {
    const doc = createMindscapeStore(mindscapeFilePath(process.env, app.getPath('userData')), configIoDeps).load();
    return roleOfSession(doc, sessionId);
  } catch {
    return undefined;
  }
}

/**
 * Sessão renovada em voo (B36) — `renewal:prepare` writes the handoff instructions for the session
 * running in `ptyId` (its CURRENT conversation: `/clear` and `/resume` move it) and names the
 * handoff file; `renewal:status` reads the handoff header back. The turn, the context and the swap
 * are followed by the renderer; the decisions are pure (`shared/sessionRenewal.ts`).
 */
function registerSessionRenewalIpcHandlers(): void {
  const service = createSessionRenewalService({ handoffsDir: join(app.getPath('userData'), 'handoffs'), randomId: randomUUID });
  sessionRenewal = service;
  ipcMain.handle(SESSION_RENEWAL_CHANNELS.prepare, (_event, input: unknown): RenewalPrepared | null => {
    if (typeof input !== 'object' || input === null) return null;
    const { ptyId, contextTokens, limitTokens } = input as Record<string, unknown>;
    if (typeof ptyId !== 'string' || typeof contextTokens !== 'number' || typeof limitTokens !== 'number') return null;
    const sessionId = activeSessionByPty.get(ptyId);
    const initial = initialChatSourceByPty.get(ptyId);
    if (!sessionId || !initial) return null;
    const transcriptPath = chatHub?.transcriptPathOf(ptyId) ?? spawnedTranscriptPaths.get(sessionId) ?? null;
    try {
      const record = service.prepare({ sessionId, transcriptPath, cwd: chatHub?.cwdOf(ptyId) ?? initial.cwd, contextTokens, limitTokens });
      return {
        renewalId: record.id,
        previousSessionId: record.previousSessionId,
        handoffPath: record.handoffPath,
        requestPrompt: record.requestPrompt,
        firstPrompt: record.firstPrompt,
      };
    } catch (error) {
      console.error('[donel-dev] renovação: as instruções da passagem não gravaram:', error);
      return null;
    }
  });
  ipcMain.handle(SESSION_RENEWAL_CHANNELS.status, (_event, renewalId: unknown): HandoffStatus =>
    typeof renewalId === 'string' ? service.status(renewalId) : { kind: 'missing' },
  );
}

/**
 * Mindscape, fatia 03 — end of turn → post-it written by the session. The text
 * is the hook's `last_assistant_message`; when it is missing, the last
 * assistant message of the `.jsonl` tail (`transcript_path` of the hook, else
 * the path derived at spawn); neither → nothing is sent (the
 * post-it keeps the previous text). The main only forwards: the renderer
 * applies `writeSessionNote` and saves (single writer).
 */
/** Diário de gestos (B35) — created at boot (needs `app.getPath`); `null` before it. */
let gestureDiary: GestureDiary | null = null;
function recordGesture(event: GestureEvent): void {
  void gestureDiary?.record(event);
}

/**
 * Diário de gestos — the single writer of `<userData>/aprendizado/`. The session events come from
 * the hooks here in the main; the screen gestures come from the renderer, validated, and the main
 * stamps the time. Only on this machine: nothing is sent anywhere.
 */
function registerGestureDiary(): void {
  gestureDiary = createGestureDiary({ dir: join(app.getPath('userData'), 'aprendizado') });
  ipcMain.handle(LEARNING_CHANNELS.record, (_event, raw: unknown): void => {
    const gesture = parseRendererGesture(raw);
    if (gesture) recordGesture({ ...gesture, at: Date.now() });
  });
  semaphoreManager.onPromptSubmitted((ptyId, promptLength) => {
    const sessionId = activeSessionByPty.get(ptyId);
    if (sessionId) recordGesture({ type: 'pedido-enviado', sessionId, promptLength, at: Date.now() });
  });
}

function registerMindscapeTurnEnded(): void {
  semaphoreManager.onTurnEnded((ptyId, lastAssistantMessage, hookTranscriptPath) => {
    const sessionId = activeSessionByPty.get(ptyId);
    if (!sessionId) return;
    const at = Date.now();
    void (async () => {
      let text = lastAssistantMessage;
      if (text === null) {
        // The path the CLI names in the hook wins; the one derived at spawn is the backup.
        const transcriptPath = hookTranscriptPath ?? spawnedTranscriptPaths.get(sessionId);
        text = transcriptPath ? await readTranscriptLastAssistantText(transcriptPath) : null;
      }
      if (text === null) return;
      recordGesture({ type: 'turno-terminou', sessionId, text, at });
      const payload: MindscapeTurnEndedPayload = { sessionId, text, at };
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(MINDSCAPE_CHANNELS.turnEnded, payload);
      }
    })().catch(() => undefined);
  });
}

/**
 * CA-23 (009-modo-dev-v3, lote 3) — engrenagem de configuração por projeto:
 * lê/grava os dois JSONs externos que a esteira já lia (board TaskDex + repo
 * do GitHub), hoje editados à mão fora do app (spec.md problema 8).
 * `repoSlug` usa a MESMA resolução de `resolveRepoSlug` (comentário acima) —
 * é a chave que `repos.json → repos` já assume em todo o resto do app.
 * Payload inválido (`repoPath` vazio/ausente) é no-op: devolve DTO vazio,
 * nunca lança (mesmo espírito defensivo do resto dos handlers deste
 * arquivo). Nenhuma escrita em TaskDex/GitHub — só nestes dois arquivos de
 * config locais (invariante 5/CA-19 preservada: a Esteira em si continua só
 * lida).
 */
function registerProjectBindingIpcHandlers(): void {
  const EMPTY_BINDING: ProjectBindingDto = { workspaceId: '', teamId: '', github: '', githubExtra: [], hasOwnBoard: false };

  ipcMain.handle(PROJECT_BINDING_CHANNELS.get, (_event, repoPath: unknown): ProjectBindingDto => {
    if (typeof repoPath !== 'string' || !repoPath.trim()) return EMPTY_BINDING;
    return readProjectBindingFromDisk(ESTEIRA_CONFIG_DIR, resolveRepoSlug(repoPath), esteiraConfigIoDeps);
  });

  // FIX (#33) — `save` engolia payload inválido e falha de escrita no mesmo
  // DTO "vazio" que uma limpeza legítima de binding também produz. Agora
  // devolve `SaveProjectBindingResult` (ok/reason) — `trySaveProjectBindingToDisk`
  // já captura exceção de I/O; aqui só resta capturar a guarda de payload.
  ipcMain.handle(PROJECT_BINDING_CHANNELS.save, (_event, input: unknown): SaveProjectBindingResult => {
    if (!isValidSaveProjectBindingIpcInput(input)) return { ok: false, reason: 'invalid-input' };
    const typed = input as SaveProjectBindingIpcInput;
    return trySaveProjectBindingToDisk(
      ESTEIRA_CONFIG_DIR,
      resolveRepoSlug(typed.repoPath),
      typed.repoPath,
      { workspaceId: typed.workspaceId, teamId: typed.teamId, github: typed.github, githubExtra: typed.githubExtra },
      esteiraConfigIoDeps,
    );
  });
}

/**
 * CA-3/CA-5 (009-modo-dev-v3, lote 4) — GitHub por `gh` CLI (spec-issue,
 * sub-issues nativas, PR da fase + etiquetas homologado/revertido-ciclo).
 * `github:read` cobre os 3 fatos do CA-3 num canal só, discriminado por
 * `kind` (mesma allowlist de `github-reader.ts` — só leitura, achado 13).
 * `github:checkAvailability` é a degradação standalone (CA-6): `gh`
 * ausente/não autenticado vira `available: false`, nunca erro na tela nem
 * valor fabricado. Nenhum canal aqui escreve no GitHub.
 */
function registerGithubIpcHandlers(): void {
  ipcMain.handle(GITHUB_CHANNELS.read, async (_event, input: unknown): Promise<GithubReadResponse> => {
    if (!isValidGithubReadRequest(input)) return { status: 'unavailable' };
    const request = input as GithubReadRequest;

    switch (request.kind) {
      case 'spec-issue': {
        const data = await readSpecIssueFacts({ repo: request.repo, number: request.number }, { cache: githubReadCache });
        return data ? { status: 'ok', data } : { status: 'unavailable' };
      }
      case 'sub-issues': {
        // `[]` é resultado válido (spec-issue sem sub-issues) — sempre 'ok',
        // mesma degradação por omissão de `readDiscoveryPlanCards`.
        const data = await readSubIssueFacts({ repo: request.repo, number: request.number }, { cache: githubReadCache });
        return { status: 'ok', data };
      }
      case 'phase-pull-request': {
        const data = await readPhasePullRequestFacts(
          { repo: request.repo, number: request.number, head: request.head },
          { cache: githubReadCache },
        );
        return data ? { status: 'ok', data } : { status: 'unavailable' };
      }
    }
  });

  ipcMain.handle(GITHUB_CHANNELS.checkAvailability, async (): Promise<GhAvailabilityDto> => {
    const availability = await checkGhAvailability();
    return availability.available ? { available: true, reason: null } : { available: false, reason: availability.reason };
  });
}

/**
 * T1125 (011-contas-e-provedores, etapa 1) — handlers do motor de contas
 * (contracts/ipc-accounts.md). `connectMod` é o ÚNICO ponto por onde segredo
 * ENTRA (write-only, C11) — nenhum handler abaixo devolve `CredentialPair`,
 * token ou trecho deles; a config re-lida (`AccountsConfigDto`) nunca carrega
 * segredo (fica só no cofre).
 */
function registerAccountsIpcHandlers(): void {
  ipcMain.handle(ACCOUNT_CHANNELS.list, async (_event, options: unknown): Promise<AccountsViewDto> => {
    const engine = accountEngineHost.current();
    if (!engine) {
      // 011-contas-e-provedores, etapa 3, Fase 2 (D5) — view inerte também
      // precisa dos dois campos novos (motor sem mod nunca troca sozinho).
      return {
        mod: null,
        state: 'inert',
        unavailableReason: null,
        accounts: [],
        activeAccountId: null,
        autoSwitch: appConfig.accounts.autoSwitch,
        lastReadAt: null,
        autoSwitchState: 'idle',
        lastAutoSwitch: null,
        lastSwitchOverwritten: null,
        remotes: [],
      };
    }
    // 011-contas-e-provedores, etapa 3, Fase 2 (D5, item 3 do Bloco 3) —
    // checagem de tipo na fronteira IPC (o renderer pode mandar qualquer
    // coisa). `force: true` é o "Atualizar" do painel — o "sob demanda" da
    // C4: relê as contas E reavalia o auto-switch no mesmo gesto, sem
    // esperar o próximo poll de 5 min. A conta ativa trocada pelo motor já é
    // persistida por `onActiveAccountChanged` (accountEngineHost, F6) — não
    // duplicar aqui.
    const force = typeof options === 'object' && options !== null && (options as { readonly force?: unknown }).force === true;
    if (force) {
      await engine.listAccounts();
      // Fase 2 (revisão) — a leitura pode levar segundos (renovação na
      // leitura); se o motor foi reconstruído nesse meio-tempo, este `engine`
      // já foi descartado e não pode decidir troca nenhuma. Só avalia se ele
      // ainda é o motor atual, e a resposta é sempre a do motor atual.
      const current = accountEngineHost.current();
      if (current === engine) await engine.evaluateAutoSwitch();
      return (current ?? engine).getSnapshot();
    }
    return engine.listAccounts();
  });

  ipcMain.handle(ACCOUNT_CHANNELS.switch, async (_event, id: AccountId): Promise<SwitchOutcome> => {
    const engine = accountEngineHost.current();
    if (!engine) return { kind: 'failed', reason: 'io' };
    const from = engine.getActiveAccountId();
    const result = await engine.switchTo(id);
    // fix/renovacao-credencial — a troca manual não deixava rastro no log de
    // manutenção (só a automática), e a linha do tempo de uma conta ficava
    // com buracos. Só ids e o desfecho.
    appendAccountsMaintenanceLog({ event: 'manual-switch', outcome: result.kind, from, to: id, ...(result.kind === 'failed' ? { reason: result.reason } : {}) });
    if (result.kind === 'switched') {
      appConfig = { ...appConfig, accounts: { ...appConfig.accounts, activeAccountId: result.to } };
      persistAppConfig();
    }
    return result;
  });

  ipcMain.handle(ACCOUNT_CHANNELS.getConfig, (): AccountsConfigDto => appConfig.accounts);

  // Lugares remotos (VPS) — troca a conta de um lugar; `null` libera. Só ids no log.
  ipcMain.handle(ACCOUNT_CHANNELS.switchRemote, async (_event, placeId: unknown, accountId: unknown): Promise<RemoteSwitchOutcome> => {
    if (typeof placeId !== 'string' || !placeId) return { kind: 'failed', reason: 'unknown-place' };
    if (accountId !== null && (typeof accountId !== 'string' || !accountId)) return { kind: 'failed', reason: 'unknown-account' };
    const engine = accountEngineHost.current();
    if (!engine) return { kind: 'failed', reason: 'io' };
    return engine.switchRemote(placeId, accountId, 'manual');
  });

  ipcMain.handle(ACCOUNT_CHANNELS.setConfig, (_event, patch: unknown): AccountsConfigDto => {
    const merged = typeof patch === 'object' && patch !== null ? { ...appConfig.accounts, ...(patch as Partial<AccountsConfigDto>) } : appConfig.accounts;
    // Lugares remotos — o renderer adiciona, renomeia e remove lugares, mas a
    // conta de cada um só o motor muda (`switchRemote`). Um lugar com conta não
    // sai da lista: sumir com ele deixaria a conta livre para esta máquina
    // enquanto o CLI de lá ainda a renova.
    const currentRemotes = (accountEngineHost.current()?.getConfig() ?? appConfig.accounts).remotes;
    const requestedRemotes = Array.isArray(merged.remotes) ? merged.remotes : currentRemotes;
    const keptRemotes = requestedRemotes.map((place) => {
      const current = typeof place === 'object' && place !== null ? currentRemotes.find((candidate) => candidate.id === place.id) : undefined;
      return { ...place, activeAccountId: current?.activeAccountId ?? null };
    });
    const missingHeld = currentRemotes.filter((place) => place.activeAccountId !== null && !keptRemotes.some((candidate) => candidate.id === place.id));
    const mergedWithRemotes = { ...merged, remotes: [...keptRemotes, ...missingHeld] };
    appConfig = { ...appConfig, accounts: sanitizeAccountsConfig(mergedWithRemotes, appConfig.accounts) };
    persistAppConfig();
    applyAccountsEngineConfig(); // F6 — decide construir/reconstruir/atualizar, nunca mais "na mão" aqui.
    return appConfig.accounts;
  });

  /** Único ponto por onde segredo ENTRA (write-only, C11) — nunca ecoado de volta. `vault-unavailable` = `safeStorage.isEncryptionAvailable()` false: recusa conectar, sem fallback em texto plano. */
  ipcMain.handle(ACCOUNT_CHANNELS.connectMod, (_event, input: ConnectModInput): ConnectModOutcome => {
    if (!accountsVaultPath) return { kind: 'failed', reason: 'offline' };
    if (!safeStorage.isEncryptionAvailable()) return { kind: 'failed', reason: 'vault-unavailable' };

    if (input.mod === 'seazone') {
      if (!input.baseUrl?.trim() || !input.sessionRefreshToken?.trim()) return { kind: 'failed', reason: 'invalid-input' };
      const writeResult = writeVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, 'seazone:session', input.sessionRefreshToken);
      if (writeResult.kind !== 'ok') return { kind: 'failed', reason: 'vault-unavailable' };
      // Pool Seazone ao lado das locais — NÃO troca o mod nem toca
      // `localAccounts`/`activeAccountId`: só registra o switcher. A
      // reconstrução abaixo (F6) monta o mod composto quando o mod é `local`.
      appConfig = { ...appConfig, accounts: planConnectSeazonePool(appConfig.accounts, input.baseUrl) };
    } else {
      const label = input.label?.trim();
      if (!label) return { kind: 'failed', reason: 'invalid-input' };
      // F2 (011-contas-e-provedores, etapa 3, Fase 1) — `buildPastedPair`
      // decide o `expiresAt` final: ausente/null vira 0 (vencido de
      // propósito, o mod renova no 1º switch) em vez do prazo chutado que o
      // renderer mandava antes.
      const built = buildPastedPair(input);
      if (built.kind !== 'ok') return { kind: 'failed', reason: 'invalid-input' };

      const id = randomUUID();
      const writeResult = writeVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, id, JSON.stringify(built.pair));
      if (writeResult.kind !== 'ok') return { kind: 'failed', reason: 'vault-unavailable' };
      appConfig = {
        ...appConfig,
        accounts: { ...appConfig.accounts, mod: 'local', localAccounts: [...appConfig.accounts.localAccounts, { id, label, plan: null }] },
      };
    }

    persistAppConfig();
    applyAccountsEngineConfig(); // F6
    return { kind: 'connected', config: appConfig.accounts };
  });

  ipcMain.handle(ACCOUNT_CHANNELS.disconnectMod, (): AccountsConfigDto => {
    // 011-contas-e-provedores, etapa 3, Fase 1 — `planDisconnect` decide a
    // config final (default, preservando só `claudeHome`) e as chaves que o
    // cofre perde (contas locais + `seazone:session`, nunca `provider:*`).
    // Antes, desconectar só resetava a config e deixava os pares no cofre —
    // a origem das 8 entradas órfãs medidas em 13/09.
    const plan = planDisconnect(appConfig.accounts);
    appConfig = { ...appConfig, accounts: plan.config };
    persistAppConfig();
    applyAccountsEngineConfig(); // F6

    if (accountsVaultPath) {
      try {
        deleteVaultEntries(accountsVaultPath, accountsVaultIo, plan.vaultKeys);
      } catch (error) {
        // Best-effort: a faxina do próximo boot (vault-reconciliation.ts) recolhe a órfã. Nunca loga conteúdo, só o erro.
        console.error('[donel-dev] desconectar: falha ao apagar do cofre (recolhida na próxima faxina):', error);
      }
    }

    return appConfig.accounts;
  });

  /**
   * 011-contas-e-provedores, etapa 3, Fase 1 — "Remover conta" (plan-etapa-3.md
   * §4.3). Bloqueada para a conta ATIVA (`planRemoveAccount`, account-pool.ts).
   * Ordem: config primeiro (persist + motor + `listAccounts` quando
   * reconstruir), cofre depois, best-effort — se a escrita no cofre falhar, a
   * config já mudou (a UI já não lista mais a conta) e a faxina do próximo
   * boot recolhe a entrada órfã que sobrou.
   */
  ipcMain.handle(ACCOUNT_CHANNELS.removeAccount, (_event, id: unknown): RemoveAccountOutcome => {
    if (typeof id !== 'string' || !id) return { kind: 'failed', reason: 'unknown-account' };

    // Conta ativa num lugar remoto: o par vivo dela está lá. Remover aqui perderia a conta igual à ativa desta máquina.
    if (appConfig.accounts.remotes.some((place) => place.activeAccountId === id)) return { kind: 'blocked', reason: 'active-account' };
    const plan = planRemoveAccount(appConfig.accounts, id);
    if (plan.kind === 'blocked') return { kind: 'blocked', reason: 'active-account' };
    if (plan.kind === 'unknown-account') return { kind: 'failed', reason: 'unknown-account' };

    appConfig = { ...appConfig, accounts: plan.config };
    persistAppConfig();
    applyAccountsEngineConfig();

    if (accountsVaultPath) {
      try {
        deleteVaultEntries(accountsVaultPath, accountsVaultIo, plan.vaultKeys);
      } catch (error) {
        console.error('[donel-dev] remover conta: falha ao apagar do cofre (recolhida na próxima faxina):', error);
      }
    }

    return { kind: 'removed', config: appConfig.accounts };
  });

  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — login isolado
   * (`IsolatedLoginManager.begin`, isolated-login.ts). Valida o TIPO aqui
   * (fronteira IPC — o renderer pode mandar qualquer coisa); a validação de
   * conteúdo (rótulo vazio/longo demais) é do próprio manager.
   */
  ipcMain.handle(ACCOUNT_CHANNELS.beginLogin, (_event, label: unknown): BeginLoginOutcome => {
    if (typeof label !== 'string') return { kind: 'failed', reason: 'invalid-input' };
    if (!isolatedLoginManager) return { kind: 'failed', reason: 'io' };
    return isolatedLoginManager.begin(label);
  });

  ipcMain.handle(ACCOUNT_CHANNELS.cancelLogin, (_event, loginId: unknown): void => {
    if (typeof loginId !== 'string' || !loginId) return;
    isolatedLoginManager?.cancel(loginId);
  });

  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3, item 4 do Bloco 3) —
   * "Reconectar": login isolado apontado PARA uma conta já cadastrada. O
   * rótulo vem da PRÓPRIA conta (`planReconnect`, account-pool.ts) — nunca
   * digitado de novo pelo operador, por isso este handler recebe só o `id`.
   * Checagem de tipo na fronteira IPC, como os handlers vizinhos.
   */
  ipcMain.handle(ACCOUNT_CHANNELS.beginReconnect, (_event, id: unknown): BeginLoginOutcome => {
    if (typeof id !== 'string' || !id) return { kind: 'failed', reason: 'unknown-account' };

    const plan = planReconnect(appConfig.accounts, id);
    if (plan.kind === 'blocked') return { kind: 'failed', reason: 'active-account' };
    if (plan.kind === 'unknown-account') return { kind: 'failed', reason: 'unknown-account' };

    if (!isolatedLoginManager) return { kind: 'failed', reason: 'io' };
    return isolatedLoginManager.begin(plan.label, { targetAccountId: id });
  });
}

/**
 * Reaproveita o MESMO seam de teste que `accounts.claudeHome` já abre para o
 * switch (`applyAccountsClaudeStateSwitch`): quando o override está setado
 * (`<homeFalso>/.claude`), a migração inteira passa a operar sob
 * `dirname(override)` em vez do `homedir()` real — é o que permite ao smoke
 * `migration-nunca-deleta.spec.ts` injetar uma árvore falsa em `mkdtemp` sem
 * tocar `~/.claude-profiles`/`~/.claude` reais (regra dura desta etapa).
 */
function migrationHomedir(): string {
  const override = appConfig.accounts.claudeHome;
  return override ? dirname(override) : homedir();
}

/** Monta o `MigrationPlan` corrente lendo o inventário + diffs de MCP do disco, cruzado com `appConfig.migration` (estado persistido). Somente leitura. */
function currentMigrationPlan(): MigrationPlan {
  const inventory = readProfileInventory(createSystemProfileInventoryDeps(migrationHomedir));
  const diffs = inventory.map((profile) => computeMcpDiffFromDisk(profile.slug, profile.path, globalClaudeJsonPathFor(migrationHomedir())));
  return buildMigrationPlan(inventory, appConfig.migration, diffs);
}

/**
 * T1214 (011-contas-e-provedores, etapa 2) — handlers do assistente de
 * migração (contracts/migration-etapa-2.md). Cada canal atua sobre UM
 * perfil por chamada (D10) — nunca existe "migrar tudo". Nenhum canal
 * devolve conteúdo de arquivo de perfil; `importCredentials` devolve só
 * enum (`ImportResult`), nunca o par (fronteira de credencial preservada).
 */
function registerMigrationIpcHandlers(): void {
  ipcMain.handle(MIGRATION_CHANNELS.scan, (): MigrationPlan => currentMigrationPlan());

  ipcMain.handle(MIGRATION_CHANNELS.importCredentials, (_event, profileSlug: unknown): ImportResult => {
    if (typeof profileSlug !== 'string' || !profileSlug) return { kind: 'absent' };

    const inventory = readProfileInventory(createSystemProfileInventoryDeps(migrationHomedir));
    const profile = inventory.find((p) => p.slug === profileSlug);
    if (!profile) return { kind: 'absent' };

    const vault = createRealAccountsVaultAdapter();
    const deps = createSystemCredentialsImportDeps(vault, () => safeStorage.isEncryptionAvailable());
    const result = importProfileCredentials(
      { slug: profile.slug, displayName: profile.displayName, credentialsPath: join(profile.path, '.credentials.json') },
      deps,
    );

    const step = result.kind === 'imported' ? 'imported' : result.kind === 'absent' ? 'absent' : 'failed';
    const previous = appConfig.migration.profiles[profileSlug];
    appConfig = {
      ...appConfig,
      migration: {
        ...appConfig.migration,
        startedAt: appConfig.migration.startedAt ?? Date.now(),
        profiles: {
          ...appConfig.migration.profiles,
          [profileSlug]: { credentials: step, transcripts: previous?.transcripts ?? 'pending', mcpReviewed: previous?.mcpReviewed ?? false },
        },
      },
    };

    // Registra a conta no pool do mod local (plan.md, arquitetura em uma
    // tela) — o mod local nasce ativo se o motor ainda estava inerte,
    // exatamente o gesto que torna a credencial migrada utilizável.
    if (result.kind === 'imported') {
      const alreadyRegistered = appConfig.accounts.localAccounts.some((a) => a.id === result.accountId);
      if (!alreadyRegistered) {
        appConfig = {
          ...appConfig,
          accounts: {
            ...appConfig.accounts,
            mod: appConfig.accounts.mod ?? 'local',
            localAccounts: [...appConfig.accounts.localAccounts, { id: result.accountId, label: result.label, plan: null }],
          },
        };
        applyAccountsEngineConfig(); // F6 — a lista de contas mudou; antes, este ramo (mod já ativo) só chamava updateConfig e a conta nova não entrava no motor vivo.
      }
    }

    persistAppConfig();
    return result;
  });

  ipcMain.handle(MIGRATION_CHANNELS.consolidateTranscripts, (_event, profileSlug: unknown): ConsolidateResult => {
    if (typeof profileSlug !== 'string' || !profileSlug) return { result: 'nothing-to-copy', copied: 0 };

    const inventory = readProfileInventory(createSystemProfileInventoryDeps(migrationHomedir));
    const profile = inventory.find((p) => p.slug === profileSlug);
    if (!profile) return { result: 'nothing-to-copy', copied: 0 };

    const claudeHome = claudeHomeDirFor(migrationHomedir());
    const input = readTranscriptConsolidationInput(join(profile.path, 'projects'), join(claudeHome, 'projects'));
    const outcome = planTranscriptConsolidation(input);
    const copied = outcome.kind === 'copy' ? executeTranscriptCopyOperations(outcome.operations) : 0;

    const previous = appConfig.migration.profiles[profileSlug];
    const transcriptsStep = outcome.kind === 'nothing-to-copy' ? 'absent' : 'imported';
    appConfig = {
      ...appConfig,
      migration: {
        ...appConfig.migration,
        profiles: {
          ...appConfig.migration.profiles,
          [profileSlug]: { credentials: previous?.credentials ?? 'pending', transcripts: transcriptsStep, mcpReviewed: previous?.mcpReviewed ?? false },
        },
      },
    };
    persistAppConfig();

    return { result: outcome.kind, copied };
  });

  ipcMain.handle(MIGRATION_CHANNELS.markMcpReviewed, (_event, profileSlug: unknown): MigrationPlan => {
    if (typeof profileSlug === 'string' && profileSlug) {
      const previous = appConfig.migration.profiles[profileSlug];
      appConfig = {
        ...appConfig,
        migration: {
          ...appConfig.migration,
          profiles: {
            ...appConfig.migration.profiles,
            [profileSlug]: { credentials: previous?.credentials ?? 'pending', transcripts: previous?.transcripts ?? 'pending', mcpReviewed: true },
          },
        },
      };
      persistAppConfig();
    }
    return currentMigrationPlan();
  });

  /** `archive` recusa quando algum perfil está `pending` — a checagem é do main (contracts/migration-etapa-2.md §invariante 3), botão desabilitado na UI é só conforto. */
  ipcMain.handle(MIGRATION_CHANNELS.archive, (): ArchiveOutcome => {
    const plan = currentMigrationPlan();
    if (!plan.canArchive) return { kind: 'nothing-to-archive' };

    const inventory = readProfileInventory(createSystemProfileInventoryDeps(migrationHomedir));
    const outcome = archiveProfiles(
      { ...createSystemArchiveIoDeps(), paths: { homedir: migrationHomedir() }, profileSlugs: inventory.map((p) => p.slug) },
      new Date(),
    );

    if (outcome.kind === 'archived') {
      appConfig = { ...appConfig, migration: { ...appConfig.migration, completedAt: Date.now(), archivedTo: outcome.archivedTo } };
      persistAppConfig();
    }

    return outcome;
  });
}

void app.whenReady().then(async () => {
  // T009 — sobe o servidor local do semáforo e grava o `--settings` ANTES de
  // registrar os handlers de PTY (o primeiro `pty:create` de uma sessão
  // claude já precisa do path pronto). Falha aqui não derruba o app —
  // `hooksSettingsPath` fica `null` e as sessões nascem sem semáforo
  // (degradação, não crash — mesmo espírito do catch de `projects.list`).
  try {
    const userDataDir = app.getPath('userData');
    if (hooksTransport === 'legacy') {
      const port = await semaphoreManager.start();
      hooksSettingsPath = writeHooksSettingsFile(userDataDir, port);
    } else {
      cleanupStaleHookSettings(userDataDir);
      curlPath = detectCurlPath();
      const bridge = createHookBridge({
        diagnostics: createDiagnosticsLog(userDataDir),
        autoNeverAsks: () => appConfig.autoMode.neverAsks,
        projectYolo: isTabYolo,
        holdsPendings: () => chatHub !== null,
      });
      await bridge.start();
      semaphoreManager.attachBridge(bridge);
      bridge.onAny((event) => {
        if (event.type === 'conversation-switched') handleConversationSwitched(event);
        else if (event.type === 'statusline') statusLineStore.update(event.ptyId, event.payload);
      });
      // Só leituras que MUDARAM chegam aqui (o store compara por valor).
      statusLineStore.onChange((ptyId, snapshot) => broadcastChat(STATUS_LINE_CHANNELS.changed, { ptyId, snapshot } satisfies StatusLineChangedPayload));
      hookBridge = bridge;
    }
  } catch (error) {
    console.error('[donel-dev] semáforo de sessões não subiu (T009) — sessões claude vão nascer sem indicador de estado:', error);
  }

  // T015 — carrega o ConfigStore unificado ANTES de qualquer coisa que
  // dependa dele: scan de projetos com os roots persistidos, perfil ativo
  // persistido. Migra dos JSONs avulsos legados (T007/T014) se `config.json`
  // ainda não existir nesta máquina (ver comentário de topo de
  // config-store.ts) — nunca lança, cai nos defaults na pior hipótese.
  appConfig = readAppConfig(getAppConfigPath(), defaultAppConfig(defaultProjectRoots(homedir)), legacyConfigPaths(), configIoDeps);
  // G1 (issue 08) — este é o 1º sync com o disco: vira a baseline do
  // read-merge-write (ver comentário de topo de `lastSyncedAppConfig`).
  lastSyncedAppConfig = appConfig;

  // T1125 (011-contas-e-provedores, etapa 1) — motor de contas. `accountsVaultPath`
  // precisa de `userData` (só disponível aqui); `applyAccountsEngineConfig()`
  // monta o motor (via `accountEngineHost`) com `appConfig.accounts` (mod
  // `null` = inerte, C2 — comportamento de hoje intocado). C5: busy-tracking
  // via API pública do semáforo, sem alterar session-semaphore-manager.ts.
  accountsVaultPath = join(app.getPath('userData'), 'accounts-vault.json');

  // 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — colhedor do login
  // isolado. Mesmo cofre do motor (`createRealAccountsVaultAdapter`), mesmo
  // `safeStorage.isEncryptionAvailable()` de disponibilidade, `killPty`
  // delegado ao `ptyManager` e `emitStatus` fazendo broadcast pro mesmo
  // padrão de `broadcastAccountsChanged`.
  isolatedLoginManager = new IsolatedLoginManager({
    userDataDir: app.getPath('userData'),
    platform: process.platform,
    fs: createRealIsolatedLoginFsDeps(),
    vault: createRealAccountsVaultAdapter(),
    isVaultAvailable: () => safeStorage.isEncryptionAvailable(),
    findAccountByFingerprint: (fingerprint) => findAccountByFingerprint(appConfig.accounts, fingerprint),
    // 011-contas-e-provedores, etapa 3, Fase 2 (D3) — identifica a conta-alvo
    // de um login "Reconectar" (`accounts:beginReconnect`, Bloco 3).
    findAccountById: (id) => findAccountById(appConfig.accounts, id),
    generateLoginId: () => randomUUID(),
    generateAccountId: () => randomUUID(),
    onAccountHarvested: (event) => {
      appConfig = { ...appConfig, accounts: applyHarvestedAccount(appConfig.accounts, event) };
      persistAppConfig();
      applyAccountsEngineConfig(); // F6 — 'added' muda a lista -> rebuilt -> já relê sozinho.
      // 011-contas-e-provedores, etapa 3, Fase 2 (D3, item 5 do Bloco 3) —
      // 'replaced' e 'reconnected' renovaram o par desta conta no cofre: uma
      // marca de "precisa reconectar" pendente não faz mais sentido. 'added'
      // nunca teve marca (conta nova) — nada a limpar.
      if (event.kind !== 'added') accountsReconnectRegistry.clear(event.accountId);
      // 'replaced' NÃO muda `localAccounts` (account-pool.ts) -> `apply()`
      // fica em 'updated', que não relê sozinho — sem isto, o painel
      // continuaria mostrando a carga/estado da conta com o par ANTIGO.
      void accountEngineHost.current()?.listAccounts().catch(() => undefined);
    },
    killPty: (ptyId) => ptyManager.kill(ptyId),
    emitStatus: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(ACCOUNT_CHANNELS.loginChanged, status);
      }
    },
  });

  // Global (não por janela) — o login isolado precisa saber quando SEU PTY
  // morre mesmo que nenhuma janela em particular esteja de olho nisso (mesmo
  // padrão do `semaphoreManager.onUpdate` global logo abaixo, que também não
  // depende de nenhuma `BrowserWindow`).
  ptyManager.onExit((ptyId) => {
    isolatedLoginManager?.handlePtyExit(ptyId);
  });

  // Boot — apaga sobras de um app fechado no meio de um login isolado (elas
  // podem conter credencial em texto claro). Nunca derruba o boot: falha
  // vira log e o app segue (mesmo padrão da faxina do cofre logo abaixo).
  try {
    const removedLoginDirs = isolatedLoginManager.sweepStaleDirs();
    if (removedLoginDirs.length > 0) {
      console.info(`[donel-dev] varredura de boot removeu ${removedLoginDirs.length} diretório(s) de login isolado órfão(s):`, removedLoginDirs);
      const maintenanceLogPath = join(app.getPath('userData'), 'accounts-maintenance.log');
      appendFileSync(
        maintenanceLogPath,
        `${JSON.stringify({ at: new Date().toISOString(), event: 'login-dirs-swept', removed: removedLoginDirs })}\n`,
        'utf8',
      );
    }
  } catch (error) {
    console.error('[donel-dev] varredura de diretórios de login isolado falhou (boot segue normalmente):', error);
  }

  // 011-contas-e-provedores, etapa 3, Fase 1 — faxina do cofre (plan-etapa-3.md
  // §4.4), ANTES do 1º `applyAccountsEngineConfig()` abaixo. Nunca derruba o
  // boot: falha aqui vira log e o app segue com o cofre como estava. Só
  // entrada de conta órfã + `seazone:session` — `provider:*` nunca é tocado
  // (regra dura de `planVaultReconciliation`).
  try {
    const removed = reconcileAccountsVault(accountsVaultPath, accountsVaultIo, appConfig.accounts);
    if (removed.length > 0) {
      console.info(`[donel-dev] faxina do cofre de contas removeu ${removed.length} entrada(s) órfã(s):`, removed);
      const maintenanceLogPath = join(app.getPath('userData'), 'accounts-maintenance.log');
      appendFileSync(maintenanceLogPath, `${JSON.stringify({ at: new Date().toISOString(), event: 'vault-reconciled', removed })}\n`, 'utf8');
    }
  } catch (error) {
    console.error('[donel-dev] faxina do cofre de contas falhou (boot segue normalmente):', error);
  }

  semaphoreManager.onUpdate((update: SemaphoreUpdate) => {
    if (update.state === 'working') {
      accountsBusyPtyIds.add(update.ptyId);
    } else {
      releaseAccountsBusyPty(update.ptyId);
    }
  });
  // 015-jobu-pet (T027) — the Jobu reads the semaphore. One subscription, made at boot: `petService` is
  // nullable (it is born after the main window and dies with it), so the lambda reads it on every
  // emission. The dedupe by state and `error` -> `done` belong to the service.
  semaphoreManager.onUpdate((update: SemaphoreUpdate) => petService?.onSemaphoreUpdate(update));
  // Emenda 22/09 (item 4) — StopFailure (limite da conta ou outro erro de
  // API) reavalia o auto-switch imediatamente, sem esperar o poll.
  semaphoreManager.onStopFailure(() => triggerAccountsAutoSwitchOnStopFailure());
  // notificacoes-completas — the reason of the failure reaches the Jobu's core BEFORE the `waiting` it causes, so that
  // wait is announced as "parou com erro: <motivo>" (bubble and toast) instead of "terminou".
  semaphoreManager.onStopFailure((ptyId, error) => petService?.onStopFailure(ptyId, failureReasonText(error)));
  applyAccountsEngineConfig(); // F6 — 1ª chamada sempre 'built' (motor inerte se mod === null, C2).

  registerChatDomain();
  registerPtyIpcHandlers();
  registerProjectIpcHandlers();
  registerSessionIpcHandlers();
  registerAccountsIpcHandlers(); // T1125 (011-contas-e-provedores, etapa 1)
  registerMigrationIpcHandlers(); // T1214 (011-contas-e-provedores, etapa 2)
  registerProviderIpcHandlers(); // T1319 (011-contas-e-provedores, etapa 3)
  registerConfigIpcHandlers();
  registerClipboardIpcHandlers(); // T504 (005-terminal-copy-paste)
  registerDevModeIpcHandlers(); // T307 (003-modo-dev)
  registerTabIpcHandlers(); // CA-26/CA-27 (009-modo-dev-v3)
  registerMindscapeIpcHandlers(); // Mindscape V1
  registerRolesIpcHandlers(); // Papéis de sessão (item 12a)
  registerMindscapeTurnEnded(); // Mindscape, fatia 03
  registerSessionRenewalIpcHandlers(); // Sessão renovada em voo (B36)
  registerGestureDiary(); // Diário de gestos (B35)
  registerProjectBindingIpcHandlers(); // CA-23 (009-modo-dev-v3, lote 3)
  registerGithubIpcHandlers(); // CA-3/CA-5 (009-modo-dev-v3, lote 4)
  registerEsteiraIpcHandlers(); // Spec 010 — esteira nova (store + contrato), ao LADO do mapa atual
  registerPetIpcHandlers({
    ipcMain,
    getService: () => petService,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
  }); // 015-jobu-pet
  registerHealthIpcHandlers(); // Saúde do computador
  registerAppUpdateIpcHandlers(); // B33 — atualizar de dentro do app
  registerWorkspaceIpcHandlers(); // Sidebar — abrir no editor + branch
  // Quadro por MCP — the board and session tools of the same server go to the renderer (owner of the document).
  const boardBridge = createBoardBridge({
    ipcMain,
    getWindow: getMainWindow,
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
  });
  browserService = createBrowserService({
    ipcMain,
    getWindow: getMainWindow,
    userDataDir: app.getPath('userData'),
    isMainSender: (sender) => getMainWindow()?.webContents.id === sender.id,
    appVersion: app.getVersion(),
    executeBoard: (ptyId, call) => boardBridge.execute(ptyId, call),
  }); // Navegador integrado
  // Servidor MCP `donel` (loopback, porta efêmera) ANTES da janela: a primeira sessão já nasce com as ferramentas
  // do navegador. Se não subir, as sessões nascem sem elas (nunca sem terminal).
  await browserService.startMcp().catch((error: unknown) => console.error('[donel-dev] MCP do navegador não subiu:', error));
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  isolatedLoginManager?.dispose(); // 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 — DEPOIS do killAll (mesma ordem já vale pro PTY do login, que killAll já matou).
  semaphoreManager.dispose();
  chatHub?.dispose();
  void hookBridge?.close();
  esteiraService?.dispose();
  esteiraService = null;
  healthService?.stop();
  healthService = null;
  appUpdateService?.stop();
  // fix/renovacao-credencial (C6, research.md) — antes de descartar o motor,
  // guarda no cofre o par que o CLI deixou em `.credentials.json` para a
  // conta ativa. A gravação acontece dentro da chamada, sem esperar promessa.
  void accountEngineHost.current()?.captureLivePairNow('quit');
  accountEngineHost.dispose(); // T1125 — nenhum timer (keepAlive/poll) sobrevive ao fechamento do app.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
