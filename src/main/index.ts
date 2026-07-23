import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import type { PtyCreateOptions, PtyCreateResult, PtyExitInfo } from '../shared';
import { PTY_CHANNELS } from '../shared';
import { PtyManager } from './pty-manager';

// Scaffold T003 — janela única com o layout do shell (ui-spec §2).
// PtyManager chega em T004 (este arquivo). ProjectScanner, SessionIndexer,
// ProfileManager e ConfigStore chegam nas tasks seguintes (plan.md
// "Arquitetura de processos").

const ptyManager = new PtyManager();

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

void app.whenReady().then(() => {
  registerPtyIpcHandlers();
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
