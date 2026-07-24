import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfigDto,
  DonelApi,
  LauncherDefaultsDto,
  NotificationPreference,
  ProfileDoctorReportDto,
  ProfileHeadroomMap,
  ProfileSummaryDto,
  ProjectInfo,
  PtyCreateOptions,
  PtyCreateResult,
  PtyExitInfo,
  SemaphoreStateInfo,
  SemaphoreUpdate,
  SessionSummaryDto,
} from '../shared';
import { CONFIG_CHANNELS, PROFILE_CHANNELS, PROJECT_CHANNELS, PTY_CHANNELS, SEMAPHORE_CHANNELS, SESSION_CHANNELS } from '../shared';

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

  profiles: {
    list: () => ipcRenderer.invoke(PROFILE_CHANNELS.list) as Promise<ProfileSummaryDto[]>,

    create: (name: string) => ipcRenderer.invoke(PROFILE_CHANNELS.create, name) as Promise<ProfileSummaryDto[]>,

    activate: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.activate, slug) as Promise<ProfileSummaryDto[]>,

    doctor: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.doctor, slug) as Promise<ProfileDoctorReportDto>,

    repair: (slug: string) => ipcRenderer.invoke(PROFILE_CHANNELS.repair, slug) as Promise<ProfileDoctorReportDto>,

    // T205 — repassa `{ force }` cru pro main; o main é quem valida/normaliza
    // o payload (é IPC, não confia cegamente no que o renderer manda).
    headroom: (options?: { force?: boolean }) => ipcRenderer.invoke(PROFILE_CHANNELS.headroom, options) as Promise<ProfileHeadroomMap>,
  },

  config: {
    get: () => ipcRenderer.invoke(CONFIG_CHANNELS.get) as Promise<AppConfigDto>,

    setProjectRoots: (roots: string[]) => ipcRenderer.invoke(CONFIG_CHANNELS.setProjectRoots, roots) as Promise<AppConfigDto>,

    setNotificationPreference: (preference: NotificationPreference) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setNotificationPreference, preference) as Promise<AppConfigDto>,

    setLauncherDefaults: (defaults: LauncherDefaultsDto) =>
      ipcRenderer.invoke(CONFIG_CHANNELS.setLauncherDefaults, defaults) as Promise<AppConfigDto>,
  },
};

contextBridge.exposeInMainWorld('donel', donelApi);
