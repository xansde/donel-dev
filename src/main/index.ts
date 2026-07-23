import { app, BrowserWindow, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PtyCreateOptions, PtyCreateResult, PtyExitInfo, ProjectInfo } from '../shared';
import { CLAUDE_NOT_FOUND_PREFIX, PROJECT_CHANNELS, PTY_CHANNELS } from '../shared';
import { createSystemResolveDeps, resolveClaudeExecutable } from './claude-executable';
import { readProjectConfig, toggleFavorite, writeProjectConfig } from './project-config-store';
import { createSystemScanDeps, defaultProjectRoots, mergeFavorites, scanProjects, sortProjects } from './project-scanner';
import { PtyManager } from './pty-manager';

// Scaffold T003 — janela única com o layout do shell (ui-spec §2).
// PtyManager chega em T004 (este arquivo). ProjectScanner chega no T007
// (este arquivo). SessionIndexer, ProfileManager e ConfigStore formal chegam
// nas tasks seguintes (plan.md "Arquitetura de processos").

const ptyManager = new PtyManager();
// Resolvido uma vez (não muda durante a vida do processo) — plan.md ponto 2.
const claudeResolveDeps = createSystemResolveDeps();
// Idem para o scan de projetos (T007) — mesmo padrão do claude-executable.
const projectScanDeps = createSystemScanDeps();
const projectRoots = defaultProjectRoots(homedir);

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
  });

  // Fechar a janela mata todos os PTYs dela — evita processos powershell.exe
  // órfãos (plan.md risco de vazamento, DoD do ciclo de vida chega em T010).
  mainWindow.on('closed', () => {
    unsubscribeData();
    unsubscribeExit();
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
      const ptyId = ptyManager.create({
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        command: resolved.path,
        args: [],
      });
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

void app.whenReady().then(() => {
  registerPtyIpcHandlers();
  registerProjectIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
