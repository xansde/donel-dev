import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DevModeBoardConfig } from '../shared/devMode';
// Spec 010 — esteira nova: serviço (store + ingestão + disparo) e a fronteira IPC.
import { createEsteiraService, type EsteiraService } from './esteira-service';
import { esteiraStoreDir } from './esteira-store';
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
  isValidReleaseLockIpcInput,
  isValidSeedIpcInput,
  isValidSetStageOverrideIpcInput,
  isValidSetWorkItemStateIpcInput,
  type EsteiraCreateDiscoveryDto,
  type EsteiraDispatchDto,
  type EsteiraGestureDto,
  type EsteiraSeedDto,
  type EsteiraSnapshotDto,
} from '../shared/esteira/ipc';
import type {
  AccountId,
  AccountsConfigDto,
  AccountsViewDto,
  AppConfigDto,
  ArchiveOutcome,
  ArchivePhaseSessionIpcInput,
  ConnectModInput,
  ConnectModOutcome,
  ConsolidateResult,
  ImportResult,
  MigrationPlan,
  CopyTranscriptForResumeIpcInput,
  CopyTranscriptForResumeResult,
  CreateProjectResponse,
  DeleteProfileOutcome,
  GhAvailabilityDto,
  GithubReadRequest,
  GithubReadResponse,
  LauncherDefaultsDto,
  NotificationPreference,
  OpenDiscoveryIpcInput,
  PhaseDefaultsTable,
  ProfileDoctorReportDto,
  ProfileHeadroomMap,
  ProfileSummaryDto,
  ProjectBindingDto,
  ProjectInfo,
  ProjectScanMode,
  PtyCreateOptions,
  PtyCreateResult,
  PhaseArchivedPayload,
  PtyExitInfo,
  ResolveCardRepoIpcInput,
  ResolveCardReposIpcInput,
  SaveProjectBindingIpcInput,
  SaveProjectBindingResult,
  ModId,
  SemaphoreUpdate,
  SessionSummaryDto,
  SwitchOutcome,
  TranscriptChangedPayload,
  WatchPhaseIpcInput,
} from '../shared';
import {
  ACCOUNT_CHANNELS,
  archivePhaseSession,
  CLAUDE_NOT_FOUND_PREFIX,
  closeDiscovery,
  CONFIG_CHANNELS,
  defaultAccountsConfig,
  DEVMODE_CHANNELS,
  focusDiscovery,
  GITHUB_CHANNELS,
  MIGRATION_CHANNELS,
  isValidArchivePhaseSessionIpcInput,
  isValidCardId,
  isValidCardIdList,
  isValidCopyTranscriptForResumeIpcInput,
  isValidCreateProjectIpcInput,
  isValidGithubReadRequest,
  isValidOpenDiscoveryIpcInput,
  isValidResolveCardRepoIpcInput,
  isValidResolveCardReposIpcInput,
  isValidSaveProjectBindingIpcInput,
  isValidWatchPhaseIpcInput,
  normalizeSessionName,
  openDiscovery,
  PROFILE_CHANNELS,
  PROJECT_BINDING_CHANNELS,
  PROJECT_CHANNELS,
  PTY_CHANNELS,
  readAllRepoEntries,
  readRepoBoard,
  SEMAPHORE_CHANNELS,
  SESSION_CHANNELS,
  TAB_CHANNELS,
  TRANSCRIPT_CHANNELS,
  TRANSCRIPT_COPY_CHANNELS,
} from '../shared';
import { copyTranscriptForResume, createSystemTranscriptCopyIoDeps } from './transcript-copy';
import { createSystemResolveDeps, resolveClaudeExecutable } from './claude-executable';
import {
  clearSessionName,
  CONFIG_FILE_NAME,
  createSystemConfigIoDeps,
  defaultAppConfig,
  LEGACY_ACTIVE_PROFILE_FILE_NAME,
  LEGACY_PROJECT_CONFIG_FILE_NAME,
  readAppConfig,
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
import { writeHooksSettingsFile } from './hooks-settings';
import {
  claudeHomeDir,
  createProfile,
  createSystemProfileCreationIoDeps,
  createSystemProfileDeletionIoDeps,
  createSystemProfileDoctorDeps,
  createSystemProfileListDeps,
  createSystemProfileRepairIoDeps,
  deleteProfile,
  globalClaudeJsonPath,
  listProfiles,
  PRINCIPAL_PROFILE,
  PRINCIPAL_PROFILE_SLUG,
  profileDirPath,
  repairProfileJunctions,
  runProfileDoctor,
  titleCaseFromSlug,
  type ProfileInfo,
} from './profile-manager';
// 011-contas-e-provedores (etapa 1) — motor de contas + mods. Nasce inerte
// (accounts.mod = null); toda a mecânica mora em src/main/accounts/, este
// arquivo só instancia/liga (T1125 — única task que toca o hub).
import { AccountEngine } from './accounts/account-engine';
import type { AccountMod } from './accounts/account-mod';
import { sanitizeAccountsConfig } from './accounts/accounts-config';
import { applyAccountSwitch, createSystemClaudeStateIoDeps } from './accounts/claude-state';
import { createLocalMod } from './accounts/mods/local-mod';
import { createSeazoneMod } from './accounts/mods/seazone-mod';
import { createSystemVaultIoDeps, decryptVaultEntry, writeVaultEntry, type VaultLike } from './accounts/vault';
// 011-contas-e-provedores (etapa 2) — assistente de migração de perfis →
// cofre (T1214). Temporário: existe enquanto houver `~/.claude-profiles`.
import { archiveProfiles, createSystemArchiveIoDeps } from './accounts/migration/archive-profiles';
import { createSystemCredentialsImportDeps, importProfileCredentials } from './accounts/migration/credentials-import';
import { buildMigrationPlan } from './accounts/migration/migration-plan';
import { computeMcpDiffFromDisk } from './accounts/migration/mcp-diff';
import { createSystemProfileInventoryDeps, readProfileInventory } from './accounts/migration/profile-inventory';
import { executeTranscriptCopyOperations, planTranscriptConsolidation, readTranscriptConsolidationInput } from './accounts/migration/transcript-consolidation';
import { createSystemScanDeps, defaultProjectRoots, mergeFavorites, scanProjects, sortProjects } from './project-scanner';
// CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero" (US-15).
import { createNewProject, createSystemCreateProjectDeps } from './project-creator';
import { PtyManager } from './pty-manager';
// T504 (005-terminal-copy-paste) — clipboard-bridge (T503), aditivo aos
// imports acima (não reordena o bloco existente).
import { hasImage, readText, writeText } from './clipboard-bridge';
import { CLIPBOARD_CHANNELS } from '../shared';
import { HeadroomCache, readAllProfilesHeadroom } from './quota-headroom';
import { resolveClaudeCorrelation } from './session-correlation';
import { defaultClaudeHome, indexProjectSessions, resolveProjectSessionsDir } from './session-indexer';
import { seedProject } from './session-seed';
import { SessionSemaphoreManager } from './session-semaphore-manager';
import { TranscriptWatcherRegistry } from './transcript-watcher';
import { forgetIfOrphan } from '../shared/resumeFailure';
import { removeSession, setPinned, upsertVisit } from '../shared/sessionRegistry';
// CA-26/CA-27 (009-modo-dev-v3, lote 1) — cor + ordem da aba v3, por sessão claude.
import { isTabColorToken, setTabColor, setTabOrder } from '../shared/tabAppearance';

// Scaffold T003 — janela única com o layout do shell (ui-spec §2).
// PtyManager chega em T004 (este arquivo). ProjectScanner chega no T007
// (este arquivo). SessionIndexer (T012/T013) e ProfileManager (T014) chegam
// nas tasks seguintes (plan.md "Arquitetura de processos"). ConfigStore
// formal chega no T015 (config-store.ts) — `appConfig` abaixo é a fonte de
// verdade única pra favoritos/roots/perfil ativo/defaults do launcher/
// notificação, substituindo os JSONs avulsos que T007/T014 usavam.

const ptyManager = new PtyManager();
// Resolvido uma vez (não muda durante a vida do processo) — plan.md ponto 2.
const claudeResolveDeps = createSystemResolveDeps();
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

// T014 — ProfileManager (FR-005, FR-012, CA-3). `profilePathDeps` é a única
// dependência de path (homedir) reaproveitada por toda função pura do
// módulo. `activeProfileSlug`/`activeProfileConfigDir` vivem em memória
// (persistidos no ConfigStore, T015) — toda sessão `claude` nova (T005/T008)
// nasce com o `CLAUDE_CONFIG_DIR` do perfil ativo NESTE INSTANTE (FR-005:
// "trocar de perfil afeta apenas sessões novas" — abas já abertas já
// receberam seu env por VALOR na criação, ver PtyManager.create).
const profilePathDeps = { homedir };
let activeProfileSlug: string = PRINCIPAL_PROFILE_SLUG;
let activeProfileConfigDir: string | undefined;
// FIX (feedback E2E rodada 5) — nome de exibição do perfil ativo, mantido ao
// lado de `activeProfileSlug`/`activeProfileConfigDir` (mesmos pontos de
// atualização: boot e `profiles:activate` abaixo) só pra devolver no
// `pty:create` de sessão claude (ver `PtyCreateResult.profile`) — a
// statusbar (App.tsx) usa isso pra saber com que perfil CADA ABA nasceu,
// distinto do perfil ATIVO global (que pode já ter mudado quando o foco
// volta pra essa aba).
let activeProfileName: string = PRINCIPAL_PROFILE.name;
const headroomCache = new HeadroomCache();

// T009 — semáforo de sessões (FR-010). `getRecentLines` reaproveita o ring
// buffer que o PtyManager já mantém (plan.md ponto 8) como sinal B da
// heurística de fallback (spike §"Fallback heurístico").
const semaphoreManager = new SessionSemaphoreManager({ getRecentLines: (ptyId) => ptyManager.getPreview(ptyId) });
/** Path do `--settings` adicional (hooks-settings.ts) — resolvido uma vez no boot, reaproveitado por todo spawn de sessão claude. `null` até `app.whenReady()` rodar. */
let hooksSettingsPath: string | null = null;

// ---------------------------------------------------------------------------
// 011-contas-e-provedores (etapa 1) — motor de contas + mods (T1125, única
// task que toca este arquivo). Nasce inerte (accounts.mod = null, C2): sem
// mod configurado, `accountEngine` existe mas `getState() === 'inert'` e o
// spawn de PTY segue exatamente como hoje (perfil ativo, ver mais abaixo).
// ---------------------------------------------------------------------------
const accountsVaultIo = createSystemVaultIoDeps();
const accountsClaudeStateIo = createSystemClaudeStateIoDeps();
/** `<userData>/accounts-vault.json` — só resolvido depois de `app.whenReady()` (precisa de `app.getPath`). */
let accountsVaultPath: string | null = null;
let accountEngine: AccountEngine | null = null;
/** C5 — leitura apenas do `session-semaphore-manager` via `onUpdate` (API já pública; este arquivo NUNCA altera session-semaphore-manager.ts). ptyId em `working` entra, qualquer outro estado sai. */
const accountsBusyPtyIds = new Set<string>();
/** Sessões `claude` vivas nesta execução (C4 — poll de 5 min só enquanto houver ao menos uma). Adicionado no registro da sessão (registerPtyIpcHandlers), removido no `onExit` (createMainWindow). */
const accountsLiveSessionPtyIds = new Set<string>();

/** Adaptador `VaultLike` sobre o cofre real — write-only pra fora de `accounts/` (nenhum getter daqui atravessa IPC; só os mods e este arquivo o enxergam). */
function createRealAccountsVaultAdapter(): VaultLike {
  return {
    read: (id: string) => (accountsVaultPath ? decryptVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, id) : null),
    write: (id: string, plainText: string) =>
      accountsVaultPath ? writeVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, id, plainText) : { kind: 'vault-unavailable' as const },
  };
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
  };
  return {
    id: 'local',
    async listAccounts() {
      return { kind: 'ok', accounts: raw.accounts.map((account) => ({ ...account, active: false })) };
    },
    async switchTo(id) {
      const pair = raw.pairs[id];
      if (!pair) return { kind: 'failed', reason: 'unknown-account' };
      return { kind: 'ok', pair };
    },
    async captureRotatedPair() {
      // Fixture não persiste nada — smoke só confere o efeito em claude-state.ts.
    },
  };
}

function resolveAccountMod(modId: ModId): AccountMod {
  const fixturePath = process.env.DONEL_ACCOUNTS_FAKE_MOD_FIXTURE;
  if (fixturePath) return createFixtureAccountMod(fixturePath);

  const vault = createRealAccountsVaultAdapter();
  if (modId === 'seazone') {
    return createSeazoneMod({ baseUrl: appConfig.accounts.seazone?.baseUrl ?? '', vault });
  }
  return createLocalMod({ accounts: appConfig.accounts.localAccounts, vault });
}

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
function applyAccountsClaudeStateSwitch(pair: import('./accounts/account-mod').CredentialPair, onRotatedPairCaptured: (pair: import('./accounts/account-mod').CredentialPair | null) => void | Promise<void>): Promise<void> {
  const overrideHome = appConfig.accounts.claudeHome;
  const claudeHome = overrideHome ?? claudeHomeDir(profilePathDeps);
  const realClaudeJsonPath = globalClaudeJsonPath(profilePathDeps);
  const claudeJsonPath = overrideHome === null ? realClaudeJsonPath : join(dirname(overrideHome), basename(realClaudeJsonPath));
  return applyAccountSwitch({ io: accountsClaudeStateIo, claudeHome, claudeJsonPath, onRotatedPairCaptured }, pair);
}

function broadcastAccountsChanged(view: AccountsViewDto): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(ACCOUNT_CHANNELS.changed, view);
  }
}

/** Reconstrói o motor do zero — necessário sempre que `accounts.mod` muda (só o construtor resolve o mod concreto, T1120). Chamado no boot e em `connectMod`/`disconnectMod`. */
function rebuildAccountEngine(): void {
  accountEngine?.dispose();
  accountEngine = new AccountEngine({
    config: appConfig.accounts,
    resolveMod: resolveAccountMod,
    applySwitch: applyAccountsClaudeStateSwitch,
    isSessionBusy: () => accountsBusyPtyIds.size > 0,
  });
  accountEngine.onChanged(broadcastAccountsChanged);
  accountEngine.start();
  accountEngine.startPolling(() => accountsLiveSessionPtyIds.size > 0);
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  const unsubscribeData = ptyManager.onData((ptyId, data) => {
    mainWindow.webContents.send(PTY_CHANNELS.data, ptyId, data);
  });
  const unsubscribeExit = ptyManager.onExit((ptyId, exitCode, signal) => {
    const info: PtyExitInfo = { exitCode, signal };
    mainWindow.webContents.send(PTY_CHANNELS.exit, ptyId, info);

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
    // T1125 (011-contas-e-provedores, etapa 1, C4) — mesma baixa, pro poll de
    // 5 min do motor de contas parar de contar esta sessão como viva.
    accountsBusyPtyIds.delete(ptyId);
    accountsLiveSessionPtyIds.delete(ptyId);
  });
  const unsubscribeSemaphore = semaphoreManager.onUpdate((update: SemaphoreUpdate) => {
    mainWindow.webContents.send(SEMAPHORE_CHANNELS.update, update);
  });

  // Fechar a janela mata todos os PTYs dela — evita processos powershell.exe
  // órfãos (plan.md risco de vazamento, DoD do ciclo de vida chega em T010).
  mainWindow.on('closed', () => {
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
 * do diretório de config ATIVO — com um perfil ativo, `CLAUDE_CONFIG_DIR`
 * aponta para o diretório do perfil, e o transcript vive lá dentro, não em
 * `~/.claude`. Usa o mesmo `activeProfileConfigDir` passado ao spawn, para o
 * watcher não vigiar um arquivo que nunca vai aparecer.
 */
function resolveTranscriptPath(sessionId: string, cwd: string | undefined, claudeConfigDir: string | undefined): string {
  const claudeHome = claudeConfigDir ?? defaultClaudeHome();
  return join(resolveProjectSessionsDir(cwd ?? homedir(), claudeHome), `${sessionId}.jsonl`);
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

function registerPtyIpcHandlers(): void {
  ipcMain.handle(PTY_CHANNELS.create, (_event, options: PtyCreateOptions): PtyCreateResult => {
    if (options.sessionType === 'claude') {
      // T005 — spawna o `claude` CLI direto no PTY (plan.md ponto 1), não
      // dentro de um shell. Sem resolução → CA-5: o renderer reconhece o
      // prefixo e mostra o banner com o caminho esperado (nunca uma aba
      // quebrada sem explicação).
      const resolved = resolveClaudeExecutable(claudeResolveDeps);
      if (!resolved.found) {
        throw new Error(`${CLAUDE_NOT_FOUND_PREFIX}${resolved.expectedPath}`);
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
      const semaphoreArgs = hooksSettingsPath ? ['--settings', hooksSettingsPath] : [];
      const finalArgs = [...launcherArgs, ...extraArgs, ...semaphoreArgs];

      // T1125 (011-contas-e-provedores, etapa 1, C1/C10) — com o motor de
      // contas ATIVO (`mod !== null`), sessões novas nascem SEM override de
      // `CLAUDE_CONFIG_DIR` (o motor escreve credencial só no `~/.claude`
      // real — motor e perfis nunca escrevem no mesmo lugar ao mesmo tempo,
      // D6/C1) e `PtyCreateResult.profile` reflete a conta ativa do motor,
      // não o perfil. Motor INERTE (default, C2): byte a byte o
      // comportamento de hoje (`activeProfileConfigDir`/perfil).
      const accountsSnapshot = accountEngine?.getSnapshot();
      const motorActive = accountsSnapshot !== undefined && accountsSnapshot.mod !== null;
      const spawnConfigDir = motorActive ? undefined : activeProfileConfigDir;

      const ptyId = ptyManager.create({
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        // FIX ambiente genérico (28/07) — `launch` embrulha shim `.cmd`/`.ps1`
        // (npm -g) no interpretador; ConPTY não executa script direto.
        command: resolved.launch.command,
        args: [...resolved.launch.argsPrefix, ...finalArgs],
        // T014 (FR-005/CA-3) — perfil ativo NO MOMENTO da criação da aba;
        // `undefined` pro perfil Principal (sem override de env). T1125:
        // `undefined` também quando o motor de contas está ativo (acima).
        claudeConfigDir: spawnConfigDir,
      });

      if (hooksSettingsPath) {
        semaphoreManager.registerSession(ptyId, correlationId);
      }
      // C4 — poll de 5 min do motor de contas só enquanto houver sessão viva.
      accountsLiveSessionPtyIds.add(ptyId);

      // T412 (004) — reflexo AO VIVO do `/rename` (CA-4). O path do `.jsonl` já
      // é conhecido aqui: o id da sessão foi IMPOSTO no spawn logo acima.
      const transcriptPath = resolveTranscriptPath(correlationId, options.cwd, spawnConfigDir);
      // T710 — guardado ANTES de qualquer coisa poder falhar: é o caminho que o
      // `forgetIfOrphan` vai conferir se esta retomada morrer (ver comentário de
      // `spawnedTranscriptPaths`).
      spawnedTranscriptPaths.set(correlationId, transcriptPath);
      startTranscriptWatcher(ptyId, transcriptPath, correlationId);

      // FIX (feedback E2E rodada 5) — perfil de NASCIMENTO desta sessão
      // (mesmo `activeProfileSlug`/Name usados em `claudeConfigDir` acima,
      // por VALOR — trocar de perfil depois não reescreve isto). Só pra
      // 'claude' (branch abaixo, shell, nunca aplica `CLAUDE_CONFIG_DIR` —
      // não tem "perfil" que fizesse sentido devolver aqui).
      // T404 (004) — `correlationId` é o id da sessão do Claude (imposto no
      // spawn acima, ou herdado do `-r` numa retomada); devolvê-lo aqui é o
      // que dá ao renderer a chave para nomear/persistir esta sessão.
      // T1125/C10 — com o motor ativo, o "perfil" devolvido é a CONTA ativa
      // dele (mesmo formato `{slug, name}`, sessionAccountLabel.ts não muda
      // de contrato nesta etapa).
      const spawnProfile = motorActive && accountsSnapshot?.activeAccountId
        ? {
            slug: accountsSnapshot.activeAccountId,
            name: accountsSnapshot.accounts.find((account) => account.id === accountsSnapshot.activeAccountId)?.label ?? accountsSnapshot.activeAccountId,
          }
        : { slug: activeProfileSlug, name: activeProfileName };

      return { ptyId, claudeSessionId: correlationId, profile: spawnProfile };
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

/** Escrita atômica (FR-007) do `appConfig` em memória — chamada depois de TODA mutação (favoritos, roots, perfil ativo, defaults do launcher, notificação). */
function persistAppConfig(): void {
  writeAppConfig(getAppConfigPath(), appConfig, configIoDeps);
}

/** Scan + merge de favoritos + ordenação — a mesma pipeline usada por list e favorite (T007), agora sobre `appConfig.projectRoots`/`appConfig.favorites` (T015). */
function listProjectsWithFavorites(): ProjectInfo[] {
  const scanned = scanProjects(appConfig.projectRoots, projectScanDeps, appConfig.projectScanMode);
  return sortProjects(mergeFavorites(scanned, appConfig.favorites));
}

function registerProjectIpcHandlers(): void {
  ipcMain.handle(PROJECT_CHANNELS.list, (): ProjectInfo[] => listProjectsWithFavorites());

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
        { sessionId: input.sessionId, profileSlug: input.profileSlug, archivedAt: Date.now() },
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

    const transcriptPath = spawnedTranscriptPaths.get(sessionId) ?? resolveTranscriptPath(sessionId, entry.projectPath, activeProfileConfigDir);
    appConfig = {
      ...appConfig,
      sessionRegistry: forgetIfOrphan(appConfig.sessionRegistry, sessionId, existsSync(transcriptPath)),
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
      { indexProjectSessions },
      activeProfileConfigDir,
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
 * Lote 8 (009-modo-dev-v3), CA-24 — "Reiniciar sessão em foco" na conta
 * SELECIONADA: copia o `.jsonl` do perfil de origem pro perfil ativo quando
 * são diferentes (achado 14). Payload inválido é no-op (`same-profile`,
 * nunca lança) — mesmo espírito defensivo do resto dos handlers deste
 * arquivo. Nenhuma escrita fora do `.jsonl` da própria sessão sendo
 * reiniciada; nenhuma leitura/escrita de credencial (`.credentials.json`/
 * `oauthAccount`) — regra dura do projeto, preservada aqui como em
 * profile-manager.ts.
 */
function registerTranscriptCopyIpcHandlers(): void {
  const transcriptCopyIoDeps = createSystemTranscriptCopyIoDeps();

  ipcMain.handle(TRANSCRIPT_COPY_CHANNELS.copyForResume, (_event, input: unknown): CopyTranscriptForResumeResult => {
    if (!isValidCopyTranscriptForResumeIpcInput(input)) return { copied: false, reason: 'invalid-payload' };
    const typed = input as CopyTranscriptForResumeIpcInput;
    return copyTranscriptForResume(typed, { homedir }, transcriptCopyIoDeps);
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

/** Sempre inclui o Principal + varre `~/.claude-profiles/*` de novo a cada chamada (mesmo espírito de `listProjectsWithFavorites` — lista pequena, I/O local, sem necessidade de cache próprio aqui). */
function currentProfileList(): ProfileInfo[] {
  return listProfiles(createSystemProfileListDeps(homedir));
}

function toProfileSummaryDto(profile: ProfileInfo): ProfileSummaryDto {
  return { name: profile.name, slug: profile.slug, isPrimary: profile.isPrimary, active: profile.slug === activeProfileSlug };
}

/** Doctor/repair podem ser chamados por slug que não está (mais) na listagem atual — sintetiza um `ProfileInfo` a partir do slug em vez de silenciosamente cair pro Principal (que mentiria "saudável" pra um perfil que não existe). */
function resolveProfileOrSynthesize(slug: string): ProfileInfo {
  const existing = currentProfileList().find((profile) => profile.slug === slug);
  if (existing) return existing;
  if (slug === PRINCIPAL_PROFILE_SLUG) return PRINCIPAL_PROFILE;
  return { name: titleCaseFromSlug(slug), slug, configDir: profileDirPath(slug, profilePathDeps), isPrimary: false };
}

/**
 * T014 — ProfileManager (FR-005, FR-012, CA-3). GATE HUMANO: a mecânica de
 * isolamento por `CLAUDE_CONFIG_DIR` foi validada ponta-a-ponta pelo
 * Alexandre em 2026-07-23 (login real concorrente, ver addendum de
 * `specs/001-mvp/spike-t001-resultado.md`) — mas o app em si NUNCA lê/grava/
 * exibe credenciais; qualquer conta nova cadastrada aqui só fica "pronta de
 * verdade" depois de um `/login` real dentro do terminal daquele perfil.
 */
function registerProfileIpcHandlers(): void {
  ipcMain.handle(PROFILE_CHANNELS.list, (): ProfileSummaryDto[] => currentProfileList().map(toProfileSummaryDto));

  ipcMain.handle(PROFILE_CHANNELS.create, async (_event, name: string): Promise<ProfileSummaryDto[]> => {
    // Mesma resolução do `claude` usada pro spawn de sessão (T005) — o
    // bootstrap do `.claude.json` do perfil (spike seção 4/5) precisa do
    // mesmo executável; CA-5 (claude ausente) degrada com graça aqui também
    // (createSystemProfileCreationIoDeps trata `claudeExecutablePath: null`
    // como no-op no passo de bootstrap, não como erro fatal). Handler async
    // — `createProfile` aguarda o bootstrap sem travar o event loop do main
    // (ver comentário de topo de `ProfileCreationIoDeps.runBootstrapPrompt`).
    const resolved = resolveClaudeExecutable(claudeResolveDeps);
    const io = createSystemProfileCreationIoDeps(resolved.found ? resolved.launch : null, profilePathDeps);
    await createProfile(name, profilePathDeps, io);
    return currentProfileList().map(toProfileSummaryDto);
  });

  ipcMain.handle(PROFILE_CHANNELS.activate, (_event, slug: string): ProfileSummaryDto[] => {
    const profiles = currentProfileList();
    const target = profiles.find((profile) => profile.slug === slug);
    // Slug desconhecido = no-op silencioso (lista devolvida sem o campo
    // `active` mudar) — não há perfil válido pra ativar.
    if (target) {
      activeProfileSlug = target.slug;
      activeProfileConfigDir = target.configDir;
      activeProfileName = target.name; // FIX (feedback E2E rodada 5) — mesmo ponto de atualização de activeProfileSlug/activeProfileConfigDir acima.
      // T015 — perfil ativo agora persiste dentro do ConfigStore unificado
      // (antes: active-profile.json próprio, T014).
      appConfig = { ...appConfig, activeProfileSlug: target.slug };
      persistAppConfig();
    }
    return profiles.map(toProfileSummaryDto);
  });

  /**
   * Item 3 (rodada de feedback 30/07) — "excluir um perfil, não só
   * adicionar". `deleteProfile` (profile-manager.ts) checa as duas regras
   * duras (nunca Principal, nunca o perfil ATIVO agora) ANTES de tocar disco
   * — a lista devolvida é sempre re-escaneada, mesmo em recusa, pro
   * chamador nunca precisar de round-trip extra (mesmo idioma de `create`/
   * `activate`).
   */
  ipcMain.handle(PROFILE_CHANNELS.delete, (_event, slug: string): DeleteProfileOutcome => {
    const profiles = currentProfileList();
    const io = createSystemProfileDeletionIoDeps();
    const result = deleteProfile(slug, activeProfileSlug, profiles, io);
    const refreshed = result.ok ? currentProfileList() : profiles;
    return result.ok
      ? { ok: true, profiles: refreshed.map(toProfileSummaryDto) }
      : { ok: false, reason: result.reason, profiles: refreshed.map(toProfileSummaryDto) };
  });

  ipcMain.handle(PROFILE_CHANNELS.doctor, (_event, slug: string): ProfileDoctorReportDto => {
    const profile = resolveProfileOrSynthesize(slug);
    return runProfileDoctor(profile, claudeHomeDir(profilePathDeps), createSystemProfileDoctorDeps(profilePathDeps));
  });

  ipcMain.handle(PROFILE_CHANNELS.repair, (_event, slug: string): ProfileDoctorReportDto => {
    const profile = resolveProfileOrSynthesize(slug);
    const claudeHome = claudeHomeDir(profilePathDeps);
    const doctorDeps = createSystemProfileDoctorDeps(profilePathDeps);
    const report = runProfileDoctor(profile, claudeHome, doctorDeps);
    repairProfileJunctions(profile, report, claudeHome, createSystemProfileRepairIoDeps());
    // Re-roda o doctor pós-reparo — devolve o estado REAL, não um "healthy" otimista.
    return runProfileDoctor(profile, claudeHome, doctorDeps);
  });

  ipcMain.handle(PROFILE_CHANNELS.headroom, async (_event, rawOptions?: unknown): Promise<ProfileHeadroomMap> => {
    // T205 — payload vem do renderer via IPC; nunca confiar cegamente
    // (poderia ser qualquer coisa vinda de um preload comprometido/versão
    // desalinhada) — só aceita `{ force: true }`, qualquer outra forma vira
    // `force: false` (comportamento anterior, respeita cache).
    const force =
      typeof rawOptions === 'object' && rawOptions !== null && (rawOptions as { force?: unknown }).force === true;
    const targets = currentProfileList().map((profile) => ({ slug: profile.slug, configDir: profile.configDir }));
    return readAllProfilesHeadroom(targets, headroomCache, undefined, { force });
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
  ipcMain.handle(ACCOUNT_CHANNELS.list, async (): Promise<AccountsViewDto> => {
    if (!accountEngine) return { mod: null, state: 'inert', unavailableReason: null, accounts: [], activeAccountId: null, autoSwitch: appConfig.accounts.autoSwitch, lastReadAt: null };
    return accountEngine.listAccounts();
  });

  ipcMain.handle(ACCOUNT_CHANNELS.switch, async (_event, id: AccountId): Promise<SwitchOutcome> => {
    if (!accountEngine) return { kind: 'failed', reason: 'io' };
    const result = await accountEngine.switchTo(id);
    if (result.kind === 'switched') {
      appConfig = { ...appConfig, accounts: { ...appConfig.accounts, activeAccountId: result.to } };
      persistAppConfig();
    }
    return result;
  });

  ipcMain.handle(ACCOUNT_CHANNELS.getConfig, (): AccountsConfigDto => appConfig.accounts);

  ipcMain.handle(ACCOUNT_CHANNELS.setConfig, (_event, patch: unknown): AccountsConfigDto => {
    const previousMod = appConfig.accounts.mod;
    const merged = typeof patch === 'object' && patch !== null ? { ...appConfig.accounts, ...(patch as Partial<AccountsConfigDto>) } : appConfig.accounts;
    appConfig = { ...appConfig, accounts: sanitizeAccountsConfig(merged, appConfig.accounts) };
    persistAppConfig();
    if (appConfig.accounts.mod !== previousMod) {
      rebuildAccountEngine();
    } else {
      accountEngine?.updateConfig(appConfig.accounts);
    }
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
      appConfig = { ...appConfig, accounts: { ...appConfig.accounts, mod: 'seazone', seazone: { baseUrl: input.baseUrl.trim() } } };
    } else {
      if (!input.label?.trim() || !input.accessToken?.trim() || !input.refreshToken?.trim()) return { kind: 'failed', reason: 'invalid-input' };
      const id = randomUUID();
      const pair = { accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt, scopes: [] as readonly string[] };
      const writeResult = writeVaultEntry(accountsVaultPath, safeStorage, accountsVaultIo, id, JSON.stringify(pair));
      if (writeResult.kind !== 'ok') return { kind: 'failed', reason: 'vault-unavailable' };
      appConfig = {
        ...appConfig,
        accounts: { ...appConfig.accounts, mod: 'local', localAccounts: [...appConfig.accounts.localAccounts, { id, label: input.label.trim(), plan: null }] },
      };
    }

    persistAppConfig();
    rebuildAccountEngine();
    return { kind: 'connected', config: appConfig.accounts };
  });

  ipcMain.handle(ACCOUNT_CHANNELS.disconnectMod, (): AccountsConfigDto => {
    // Volta pro default (motor inerte, C2) — preserva só `claudeHome` (não é
    // segredo, é preferência de onde o motor escreveria se reconectado).
    appConfig = { ...appConfig, accounts: { ...defaultAccountsConfig(), claudeHome: appConfig.accounts.claudeHome } };
    persistAppConfig();
    rebuildAccountEngine();
    return appConfig.accounts;
  });
}

/** Monta o `MigrationPlan` corrente lendo o inventário + diffs de MCP do disco, cruzado com `appConfig.migration` (estado persistido). Somente leitura. */
function currentMigrationPlan(): MigrationPlan {
  const inventory = readProfileInventory(createSystemProfileInventoryDeps(homedir));
  const diffs = inventory.map((profile) => computeMcpDiffFromDisk(profile.slug, profile.path, globalClaudeJsonPath(profilePathDeps)));
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

    const inventory = readProfileInventory(createSystemProfileInventoryDeps(homedir));
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
        const wasInert = appConfig.accounts.mod === null;
        appConfig = {
          ...appConfig,
          accounts: {
            ...appConfig.accounts,
            mod: appConfig.accounts.mod ?? 'local',
            localAccounts: [...appConfig.accounts.localAccounts, { id: result.accountId, label: result.label, plan: null }],
          },
        };
        if (wasInert) rebuildAccountEngine();
        else accountEngine?.updateConfig(appConfig.accounts);
      }
    }

    persistAppConfig();
    return result;
  });

  ipcMain.handle(MIGRATION_CHANNELS.consolidateTranscripts, (_event, profileSlug: unknown): ConsolidateResult => {
    if (typeof profileSlug !== 'string' || !profileSlug) return { result: 'nothing-to-copy', copied: 0 };

    const inventory = readProfileInventory(createSystemProfileInventoryDeps(homedir));
    const profile = inventory.find((p) => p.slug === profileSlug);
    if (!profile) return { result: 'nothing-to-copy', copied: 0 };

    const claudeHome = claudeHomeDir(profilePathDeps);
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

    const inventory = readProfileInventory(createSystemProfileInventoryDeps(homedir));
    const outcome = archiveProfiles(
      { ...createSystemArchiveIoDeps(), paths: { homedir: homedir() }, profileSlugs: inventory.map((p) => p.slug) },
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
    const port = await semaphoreManager.start();
    hooksSettingsPath = writeHooksSettingsFile(app.getPath('userData'), port);
  } catch (error) {
    console.error('[donel-dev] semáforo de sessões não subiu (T009) — sessões claude vão nascer sem indicador de estado:', error);
  }

  // T015 — carrega o ConfigStore unificado ANTES de qualquer coisa que
  // dependa dele: scan de projetos com os roots persistidos, perfil ativo
  // persistido. Migra dos JSONs avulsos legados (T007/T014) se `config.json`
  // ainda não existir nesta máquina (ver comentário de topo de
  // config-store.ts) — nunca lança, cai nos defaults na pior hipótese.
  appConfig = readAppConfig(getAppConfigPath(), defaultAppConfig(defaultProjectRoots(homedir)), legacyConfigPaths(), configIoDeps);

  // T014 — perfil ativo persistido ANTES de registrar os handlers de PTY (o
  // primeiro `pty:create` de sessão claude já precisa do
  // `activeProfileConfigDir` certo). Slug persistido que não existe mais
  // (perfil removido do disco manualmente) cai pro Principal, nunca lança.
  const bootProfile = currentProfileList().find((profile) => profile.slug === appConfig.activeProfileSlug) ?? PRINCIPAL_PROFILE;
  activeProfileSlug = bootProfile.slug;
  activeProfileConfigDir = bootProfile.configDir;
  activeProfileName = bootProfile.name; // FIX (feedback E2E rodada 5) — mesmo ponto de atualização de activeProfileSlug/activeProfileConfigDir acima.
  // Slug persistido pode ter sido normalizado pro Principal acima (perfil
  // morto) — reflete de volta no config em memória pra próxima escrita não
  // reintroduzir um slug inexistente.
  if (appConfig.activeProfileSlug !== bootProfile.slug) {
    appConfig = { ...appConfig, activeProfileSlug: bootProfile.slug };
  }

  // T1125 (011-contas-e-provedores, etapa 1) — motor de contas. `accountsVaultPath`
  // precisa de `userData` (só disponível aqui); `rebuildAccountEngine` monta o
  // motor com `appConfig.accounts` (mod `null` = inerte, C2 — comportamento de
  // hoje intocado). C5: busy-tracking via API pública do semáforo, sem alterar
  // session-semaphore-manager.ts.
  accountsVaultPath = join(app.getPath('userData'), 'accounts-vault.json');
  semaphoreManager.onUpdate((update: SemaphoreUpdate) => {
    if (update.state === 'working') {
      accountsBusyPtyIds.add(update.ptyId);
    } else {
      accountsBusyPtyIds.delete(update.ptyId);
    }
  });
  rebuildAccountEngine();

  registerPtyIpcHandlers();
  registerProjectIpcHandlers();
  registerSessionIpcHandlers();
  registerProfileIpcHandlers();
  registerAccountsIpcHandlers(); // T1125 (011-contas-e-provedores, etapa 1)
  registerMigrationIpcHandlers(); // T1214 (011-contas-e-provedores, etapa 2)
  registerConfigIpcHandlers();
  registerClipboardIpcHandlers(); // T504 (005-terminal-copy-paste)
  registerDevModeIpcHandlers(); // T307 (003-modo-dev)
  registerTabIpcHandlers(); // CA-26/CA-27 (009-modo-dev-v3)
  registerProjectBindingIpcHandlers(); // CA-23 (009-modo-dev-v3, lote 3)
  registerGithubIpcHandlers(); // CA-3/CA-5 (009-modo-dev-v3, lote 4)
  registerTranscriptCopyIpcHandlers(); // CA-24 (009-modo-dev-v3, lote 8)
  registerEsteiraIpcHandlers(); // Spec 010 — esteira nova (store + contrato), ao LADO do mapa atual
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  semaphoreManager.dispose();
  esteiraService?.dispose();
  esteiraService = null;
  accountEngine?.dispose(); // T1125 — nenhum timer (keepAlive/poll) sobrevive ao fechamento do app.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
