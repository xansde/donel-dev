import { contextBridge, ipcRenderer } from 'electron';
import type {
  DonelApi,
  ProjectInfo,
  PtyCreateOptions,
  PtyCreateResult,
  PtyExitInfo,
  SemaphoreStateInfo,
  SemaphoreUpdate,
  SessionSummaryDto,
} from '../shared';
import { PROJECT_CHANNELS, PTY_CHANNELS, SEMAPHORE_CHANNELS, SESSION_CHANNELS } from '../shared';

// contextIsolation: true + sem nodeIntegration (src/main/index.ts) — este
// arquivo é o único ponto por onde o renderer alcança o main process, via
// `window.donel.*` tipado de ponta a ponta (plan.md "Arquitetura de
// processos"). Canais `pty:*` chegam em T004; `projects:*` chega no T007; os
// demais (sessions:*, profiles:*, config:*) chegam junto das tasks que os implementam.

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
  },
};

contextBridge.exposeInMainWorld('donel', donelApi);
