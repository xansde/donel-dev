import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ProfileDoctorReportDto,
  ProfileHeadroomMap,
  ProfileSummaryDto,
  ProjectInfo,
  PtyCreateOptions,
  PtyCreateResult,
  PtyExitInfo,
  SemaphoreUpdate,
  SessionSummaryDto,
} from '../shared';
import { CLAUDE_NOT_FOUND_PREFIX, PROFILE_CHANNELS, PROJECT_CHANNELS, PTY_CHANNELS, SEMAPHORE_CHANNELS, SESSION_CHANNELS } from '../shared';
import { createSystemResolveDeps, resolveClaudeExecutable } from './claude-executable';
import { writeHooksSettingsFile } from './hooks-settings';
import {
  claudeHomeDir,
  createProfile,
  createSystemProfileCreationIoDeps,
  createSystemProfileDoctorDeps,
  createSystemProfileListDeps,
  createSystemProfileRepairIoDeps,
  listProfiles,
  PRINCIPAL_PROFILE,
  PRINCIPAL_PROFILE_SLUG,
  profileDirPath,
  readActiveProfileConfig,
  repairProfileJunctions,
  runProfileDoctor,
  titleCaseFromSlug,
  writeActiveProfileConfig,
  type ProfileInfo,
} from './profile-manager';
import { readProjectConfig, toggleFavorite, writeProjectConfig } from './project-config-store';
import { createSystemScanDeps, defaultProjectRoots, mergeFavorites, scanProjects, sortProjects } from './project-scanner';
import { PtyManager } from './pty-manager';
import { HeadroomCache, readAllProfilesHeadroom } from './quota-headroom';
import { resolveClaudeCorrelation } from './session-correlation';
import { indexProjectSessions } from './session-indexer';
import { SessionSemaphoreManager } from './session-semaphore-manager';

// Scaffold T003 — janela única com o layout do shell (ui-spec §2).
// PtyManager chega em T004 (este arquivo). ProjectScanner chega no T007
// (este arquivo). SessionIndexer (T012/T013) e ProfileManager (T014) chegam
// nas tasks seguintes (plan.md "Arquitetura de processos"). ConfigStore
// formal (T015) ainda falta — `getProjectConfigPath`/`getActiveProfileConfigPath`
// abaixo são a versão interina, mesmo espírito do resto do arquivo.

const ptyManager = new PtyManager();
// Resolvido uma vez (não muda durante a vida do processo) — plan.md ponto 2.
const claudeResolveDeps = createSystemResolveDeps();
// Idem para o scan de projetos (T007) — mesmo padrão do claude-executable.
const projectScanDeps = createSystemScanDeps();
const projectRoots = defaultProjectRoots(homedir);

// T014 — ProfileManager (FR-005, FR-012, CA-3). `profilePathDeps` é a única
// dependência de path (homedir) reaproveitada por toda função pura do
// módulo. `activeProfileSlug`/`activeProfileConfigDir` vivem em memória
// (persistidos em disco, lidos no boot) — toda sessão `claude` nova (T005/T008)
// nasce com o `CLAUDE_CONFIG_DIR` do perfil ativo NESTE INSTANTE (FR-005:
// "trocar de perfil afeta apenas sessões novas" — abas já abertas já
// receberam seu env por VALOR na criação, ver PtyManager.create).
const profilePathDeps = { homedir };
let activeProfileSlug: string = PRINCIPAL_PROFILE_SLUG;
let activeProfileConfigDir: string | undefined;
const headroomCache = new HeadroomCache();

// T009 — semáforo de sessões (FR-010). `getRecentLines` reaproveita o ring
// buffer que o PtyManager já mantém (plan.md ponto 8) como sinal B da
// heurística de fallback (spike §"Fallback heurístico").
const semaphoreManager = new SessionSemaphoreManager({ getRecentLines: (ptyId) => ptyManager.getPreview(ptyId) });
/** Path do `--settings` adicional (hooks-settings.ts) — resolvido uma vez no boot, reaproveitado por todo spawn de sessão claude. `null` até `app.whenReady()` rodar. */
let hooksSettingsPath: string | null = null;

// Achado do T009 (ao escrever o `--settings` de hooks pela primeira vez):
// sem `setName`, o Electron só resolve o nome do app ("donel-dev", de
// package.json) quando invocado como `electron .` (dev, `npm run dev`) — ao
// rodar o build direto por caminho de script (`electron out/main/index.js`,
// exatamente como o smoke roteirizado e a instalação real via atalho fazem),
// ele cai pro default "Electron", e `app.getPath('userData')` (usado aqui E
// pelo `project-config.json` do T007) vira `%APPDATA%\Electron` — uma pasta
// genérica compartilhada por QUALQUER outro app Electron mal-nomeado nesta
// máquina. `setName` força o nome certo em todo modo de execução, antes de
// qualquer `getPath('userData')`.
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
    ptyManager.killAll();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
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

      const ptyId = ptyManager.create({
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        command: resolved.path,
        args: finalArgs,
        // T014 (FR-005/CA-3) — perfil ativo NO MOMENTO da criação da aba;
        // `undefined` pro perfil Principal (sem override de env).
        claudeConfigDir: activeProfileConfigDir,
      });

      if (hooksSettingsPath) {
        semaphoreManager.registerSession(ptyId, correlationId);
      }

      return { ptyId };
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

/** `%APPDATA%\donel-dev\project-config.json` — só chamável após `app.whenReady()`. */
function getProjectConfigPath(): string {
  return join(app.getPath('userData'), 'project-config.json');
}

/** Scan + merge de favoritos + ordenação — a mesma pipeline usada por list e favorite (T007). */
function listProjectsWithFavorites(): ProjectInfo[] {
  const config = readProjectConfig(getProjectConfigPath());
  const scanned = scanProjects(projectRoots, projectScanDeps);
  return sortProjects(mergeFavorites(scanned, config.favorites));
}

function registerProjectIpcHandlers(): void {
  ipcMain.handle(PROJECT_CHANNELS.list, (): ProjectInfo[] => listProjectsWithFavorites());

  ipcMain.handle(PROJECT_CHANNELS.favorite, (_event, path: string, favorite: boolean): ProjectInfo[] => {
    const configPath = getProjectConfigPath();
    const config = readProjectConfig(configPath);
    const favorites = toggleFavorite(config.favorites, path, favorite);
    writeProjectConfig(configPath, { favorites });
    return listProjectsWithFavorites();
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
}

/** `%APPDATA%\donel-dev\active-profile.json` — só chamável após `app.whenReady()`. Mesmo padrão interino de `getProjectConfigPath` (T015 formaliza um ConfigStore único). */
function getActiveProfileConfigPath(): string {
  return join(app.getPath('userData'), 'active-profile.json');
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
    const io = createSystemProfileCreationIoDeps(resolved.found ? resolved.path : null, profilePathDeps);
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
      writeActiveProfileConfig(getActiveProfileConfigPath(), { activeSlug: target.slug });
    }
    return profiles.map(toProfileSummaryDto);
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

  ipcMain.handle(PROFILE_CHANNELS.headroom, async (): Promise<ProfileHeadroomMap> => {
    const targets = currentProfileList().map((profile) => ({ slug: profile.slug, configDir: profile.configDir }));
    return readAllProfilesHeadroom(targets, headroomCache);
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

  // T014 — carrega o perfil ativo persistido ANTES de registrar os handlers
  // de PTY (o primeiro `pty:create` de sessão claude já precisa do
  // `activeProfileConfigDir` certo). Slug persistido que não existe mais
  // (perfil removido do disco manualmente) cai pro Principal, nunca lança.
  const persistedActive = readActiveProfileConfig(getActiveProfileConfigPath());
  const bootProfile = currentProfileList().find((profile) => profile.slug === persistedActive.activeSlug) ?? PRINCIPAL_PROFILE;
  activeProfileSlug = bootProfile.slug;
  activeProfileConfigDir = bootProfile.configDir;

  registerPtyIpcHandlers();
  registerProjectIpcHandlers();
  registerSessionIpcHandlers();
  registerProfileIpcHandlers();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
