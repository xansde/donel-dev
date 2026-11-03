import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import { mcpDeliveryFor, type AgentCli } from '../../shared/commandBuilder';
import { BrowserControl, HELP_WAIT_MS, OWNER_WAIT_MS } from '../../shared/browser/control';
import {
  BROWSER_CHANNELS,
  agentAskedHelpLine,
  agentOpenedLine,
  parseBrowserRect,
  type BrowserControlState,
  type BrowserHistoryAction,
  type BrowserLogEntry,
  type BrowserNavigateResult,
  type BrowserPanelState,
} from '../../shared/browser/ipc';
import { MCP_SERVER_NAME, type BrowserToolCall, type BrowserToolOutcome } from '../../shared/browser/mcp';
import { normalizeBrowserUrl } from '../../shared/browser/url';
import { BrowserPanels } from './browser-panels';
import { browserMcpUrl, createBrowserMcpServer } from './browser-mcp-server';
import { CdpDriver } from './cdp-driver';

// Navegador integrado — the main-side service: the views (browser-panels.ts), the IPC of the panel, and the
// agent's side: one MCP token per PTY, the control (agent x owner, with generation), the CDP driver of each
// page and the footer log. docs/design/navegador-interno.md.

export interface BrowserServiceDeps {
  readonly ipcMain: IpcMain;
  getWindow(): BrowserWindow | null;
  readonly userDataDir: string;
  /** Only the main window's renderer may drive the panel. */
  isMainSender(sender: WebContents): boolean;
  /** App version, announced by the MCP server. */
  readonly appVersion: string;
}

export interface BrowserService {
  /** Starts the local MCP server. Sessions spawned before (or if it fails) simply have no browser tools. */
  startMcp(): Promise<void>;
  /**
   * Before spawning the agent CLI of `ptyId`: a fresh token, the per-session config file, and the argv that
   * hands the app's MCP server to that CLI. `[]` when the server is not up (the session starts without it).
   */
  prepareSession(ptyId: string, cli: AgentCli): string[];
  /** A session was spawned: its browser may exist from now on. */
  registerPty(ptyId: string): void;
  /** The session's process left (or its spawn failed): browser, token, config file and control are gone. */
  releasePty(ptyId: string): void;
  destroyAll(): void;
}

const MAX_PTY_ID_LENGTH = 128;
const MCP_CONFIG_DIR = 'browser-mcp';
const STALE_CONFIG_MS = 24 * 60 * 60_000;
const MAX_LOG_URL = 300;
/** Budget of one `navegador_extrair` answer (the agent continues with `a_partir`). */
const EXTRACT_MAX_CHARS = 30_000;

function isPtyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PTY_ID_LENGTH && /^[\w-]+$/.test(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Boot cleanup: per-session MCP config files left by a crash. Only old ones: another channel may share `userData`. */
function sweepStaleConfigs(dir: string, now = Date.now()): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > STALE_CONFIG_MS) rmSync(path, { force: true });
    } catch {
      // gone in between
    }
  }
}

export function createBrowserService(deps: BrowserServiceDeps): BrowserService {
  const livePtys = new Set<string>();
  const controls = new Map<string, BrowserControl>();
  const drivers = new Map<string, CdpDriver>();
  /** PTYs with an agent tool running right now (their navigations go to the footer log; their view is pinned). */
  const agentBusy = new Set<string>();
  /** One tool at a time per PTY: the agent may call tools in parallel, the page has one pair of hands. */
  const queues = new Map<string, Promise<unknown>>();
  const configDir = join(deps.userDataDir, MCP_CONFIG_DIR);
  const configPath = (ptyId: string): string => join(configDir, `${ptyId}.json`);

  const send = (channel: string, payload: unknown): void => {
    const window = deps.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const log = (ptyId: string, text: string): void => {
    const entry: BrowserLogEntry = { ptyId, at: Date.now(), text };
    send(BROWSER_CHANNELS.log, entry);
  };

  const panels = new BrowserPanels({
    getWindow: deps.getWindow,
    downloadsDir: () => join(deps.userDataDir, 'browser-downloads'),
    onState: (state) => send(BROWSER_CHANNELS.state, state),
    onNavigated: (ptyId, url) => {
      if (agentBusy.has(ptyId) && url !== 'about:blank') log(ptyId, agentOpenedLine(url.length > MAX_LOG_URL ? `${url.slice(0, MAX_LOG_URL)}…` : url));
    },
    onDownload: (ptyId, fileName) => log(ptyId, `Download salvo em browser-downloads: ${fileName}`),
    onDestroyed: (ptyId) => {
      drivers.get(ptyId)?.detach();
      drivers.delete(ptyId);
    },
    // Not destroyed while the agent works on it or the owner holds it.
    isPinned: (ptyId) => agentBusy.has(ptyId) || controls.get(ptyId)?.snapshot().owner === 'human',
  });

  const controlFor = (ptyId: string): BrowserControl => {
    let control = controls.get(ptyId);
    if (!control) {
      control = new BrowserControl();
      control.onChange((snapshot) => send(BROWSER_CHANNELS.control, { ptyId, ...snapshot } satisfies BrowserControlState));
      controls.set(ptyId, control);
    }
    return control;
  };

  const driverFor = (ptyId: string): CdpDriver => {
    const entry = panels.ensure(ptyId);
    let driver = drivers.get(ptyId);
    if (!driver || driver.contents !== entry.contents) {
      driver?.detach();
      driver = new CdpDriver(entry.contents);
      drivers.set(ptyId, driver);
    }
    return driver;
  };

  const where = (ptyId: string): string => {
    const state = panels.state(ptyId);
    if (!state) return '';
    return `Página: ${state.title || '(sem título)'} — ${state.url}`;
  };

  const text = (value: string): BrowserToolOutcome => ({ kind: 'text', text: value });
  const fail = (value: string): BrowserToolOutcome => ({ kind: 'error', text: value });

  /** One tool call, already holding the agent's turn. */
  const run = async (ptyId: string, call: BrowserToolCall): Promise<BrowserToolOutcome> => {
    switch (call.tool) {
      case 'navegador_abrir': {
        const target = normalizeBrowserUrl(call.url);
        if (!target.ok) return fail(target.reason);
        const loaded = await panels.load(ptyId, target.url);
        if (!loaded.ok) return fail(`A página não abriu: ${loaded.error}`);
        return text(`${where(ptyId)}\nUse navegador_ler para ver a página.`);
      }
      case 'navegador_ler': {
        const page = await driverFor(ptyId).read();
        return text(`Página: ${page.title || '(sem título)'}\nEndereço: ${page.url}\n\n${page.text || '(nada legível na tela)'}`);
      }
      case 'navegador_extrair': {
        const page = await driverFor(ptyId).extract(EXTRACT_MAX_CHARS, call.aPartir ?? 0);
        const head = [`Página: ${page.title || '(sem título)'}`, `Endereço: ${page.url}`];
        if (call.pergunta) head.push(`Pergunta (sua, o navegador não responde): ${call.pergunta}`);
        if ((call.aPartir ?? 0) > 0) head.push(`Continuando do caractere ${call.aPartir} de ${page.total}.`);
        const tail =
          page.nextStart !== null
            ? `\n\n… (cortado: mostrei até o caractere ${page.nextStart} de ${page.total}. Para continuar: navegador_extrair com a_partir=${page.nextStart}.)`
            : '';
        return text(`${head.join('\n')}\n\n${page.markdown || '(nenhum texto legível nesta página)'}${tail}`);
      }
      case 'navegador_clicar': {
        const ref = await driverFor(ptyId).click(call.n);
        return text(`Clicou em [${call.n}] ${ref.role} "${ref.name}".\n${where(ptyId)}\nLeia de novo (navegador_ler) para ver o resultado.`);
      }
      case 'navegador_digitar': {
        const ref = await driverFor(ptyId).type(call.n, call.texto);
        return text(`Digitou em [${call.n}] ${ref.role} "${ref.name}".`);
      }
      case 'navegador_teclar':
        await driverFor(ptyId).pressKey(call.tecla);
        return text(`Teclou ${call.tecla}.\n${where(ptyId)}`);
      case 'navegador_rolar':
        await driverFor(ptyId).scroll(call.direcao);
        return text(`Rolou para ${call.direcao}.`);
      case 'navegador_voltar': {
        const driver = driverFor(ptyId);
        if (!panels.history(ptyId, 'back')) return fail('Não há página anterior.');
        await driver.settle();
        return text(where(ptyId));
      }
      case 'navegador_print': {
        panels.ensure(ptyId);
        const jpeg = await panels.capture(ptyId, 1280, 70);
        if (!jpeg) return fail('Não consegui tirar o print (a página ainda está vazia?).');
        return { kind: 'image', base64: jpeg.toString('base64'), mimeType: 'image/jpeg', text: where(ptyId) };
      }
      case 'navegador_esperar':
        if (call.ms !== undefined) {
          await delay(call.ms);
          return text(`Esperou ${call.ms} ms.`);
        }
        return (await driverFor(ptyId).waitForText(call.texto ?? '', 30_000))
          ? text(`"${call.texto}" apareceu.`)
          : fail(`"${call.texto}" não apareceu em 30 s.`);
      case 'navegador_pedir_humano':
        return fail('navegador_pedir_humano é tratado à parte.');
    }
  };

  const execute = async (ptyId: string, call: BrowserToolCall): Promise<BrowserToolOutcome> => {
    if (!livePtys.has(ptyId)) return fail('A sessão deste navegador terminou.');
    const control = controlFor(ptyId);

    if (call.tool === 'navegador_pedir_humano') {
      try {
        panels.ensure(ptyId);
      } catch (error) {
        return fail(errorText(error));
      }
      log(ptyId, agentAskedHelpLine(call.motivo));
      send(BROWSER_CHANNELS.openRequest, { ptyId });
      const result = await control.askHuman(call.motivo, HELP_WAIT_MS);
      if (result === 'ok') return text(`O dono devolveu o navegador.\n${where(ptyId)}\nLeia a página de novo (navegador_ler) antes de agir.`);
      if (result === 'timeout') return fail('O dono não devolveu o navegador em 30 min.');
      return fail('A sessão deste navegador terminou.');
    }

    const turn = await control.waitForAgentTurn(OWNER_WAIT_MS);
    if (turn === 'timeout') return fail('O dono ainda está usando o navegador. Tente de novo mais tarde ou peça com navegador_pedir_humano.');
    if (turn === 'disposed') return fail('A sessão deste navegador terminou.');

    agentBusy.add(ptyId);
    try {
      return await run(ptyId, call);
    } catch (error) {
      return fail(errorText(error));
    } finally {
      agentBusy.delete(ptyId);
    }
  };

  /** Serializes the calls of one PTY (pedir_humano included: nothing else should run while the owner is asked). */
  const enqueue = (ptyId: string, call: BrowserToolCall): Promise<BrowserToolOutcome> => {
    const previous = queues.get(ptyId) ?? Promise.resolve();
    const next = previous.then(
      () => execute(ptyId, call),
      () => execute(ptyId, call),
    );
    queues.set(ptyId, next);
    void next.finally(() => {
      if (queues.get(ptyId) === next) queues.delete(ptyId);
    });
    return next;
  };

  const mcp = createBrowserMcpServer({ execute: enqueue, serverVersion: deps.appVersion });

  const known = (sender: WebContents, ptyId: unknown): ptyId is string => deps.isMainSender(sender) && isPtyId(ptyId) && livePtys.has(ptyId);

  deps.ipcMain.handle(BROWSER_CHANNELS.open, (event, ptyId: unknown): BrowserPanelState => {
    if (!known(event.sender, ptyId)) throw new Error('Sessão desconhecida para o navegador.');
    panels.ensure(ptyId);
    const state = panels.state(ptyId);
    if (!state) throw new Error('O navegador não abriu.');
    return state;
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.get, (event, ptyId: unknown): BrowserPanelState | null => {
    if (!known(event.sender, ptyId)) return null;
    return panels.state(ptyId);
  });

  deps.ipcMain.on(BROWSER_CHANNELS.setBounds, (event, ptyId: unknown, rect: unknown) => {
    if (!known(event.sender, ptyId)) return;
    panels.setBounds(ptyId, rect === null ? null : parseBrowserRect(rect));
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.navigate, async (event, ptyId: unknown, typed: unknown): Promise<BrowserNavigateResult> => {
    if (!known(event.sender, ptyId)) return { ok: false, reason: 'Sessão desconhecida para o navegador.' };
    const target = normalizeBrowserUrl(typeof typed === 'string' ? typed : '');
    if (!target.ok) return target;
    const loaded = await panels.load(ptyId, target.url);
    return loaded.ok ? { ok: true, url: target.url } : { ok: false, reason: `A página não abriu: ${loaded.error}` };
  });

  deps.ipcMain.on(BROWSER_CHANNELS.history, (event, ptyId: unknown, action: unknown) => {
    if (!known(event.sender, ptyId)) return;
    if (action === 'back' || action === 'forward' || action === 'reload' || action === 'stop') panels.history(ptyId, action as BrowserHistoryAction);
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.snapshot, async (event, ptyId: unknown): Promise<string | null> => {
    if (!known(event.sender, ptyId)) return null;
    const jpeg = await panels.capture(ptyId, 1600, 70);
    return jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null;
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.takeOver, (event, ptyId: unknown): number | null => {
    if (!known(event.sender, ptyId)) return null;
    return controlFor(ptyId).takeOver();
  });

  deps.ipcMain.on(BROWSER_CHANNELS.handBack, (event, ptyId: unknown, generation: unknown) => {
    if (!known(event.sender, ptyId) || typeof generation !== 'number' || !Number.isInteger(generation)) return;
    controls.get(ptyId)?.handBack(generation);
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.getControl, (event, ptyId: unknown): BrowserControlState | null => {
    if (!known(event.sender, ptyId)) return null;
    const control = controls.get(ptyId);
    return control ? { ptyId, ...control.snapshot() } : null;
  });

  const releasePty = (ptyId: string): void => {
    livePtys.delete(ptyId);
    controls.get(ptyId)?.dispose();
    controls.delete(ptyId);
    mcp.unregisterSession(ptyId);
    if (isPtyId(ptyId)) rmSync(configPath(ptyId), { force: true });
    panels.destroy(ptyId);
  };

  return {
    startMcp: async () => {
      sweepStaleConfigs(configDir);
      await mcp.start();
    },
    prepareSession: (ptyId, cli) => {
      const port = mcp.port;
      if (port === null || !isPtyId(ptyId)) return [];
      try {
        const token = mcp.registerSession(ptyId);
        const delivery = mcpDeliveryFor(cli, { name: MCP_SERVER_NAME, url: browserMcpUrl(port), bearerToken: token }, configPath(ptyId));
        if (delivery.configFileContent !== null) {
          mkdirSync(configDir, { recursive: true });
          writeFileSync(configPath(ptyId), delivery.configFileContent, { encoding: 'utf8', mode: 0o600 });
        }
        return [...delivery.args];
      } catch (error) {
        // Degrades like the hooks bridge: the session is born without browser tools, never without a terminal.
        console.error('[donel-dev] MCP do navegador não ficou pronto para a sessão:', error);
        mcp.unregisterSession(ptyId);
        return [];
      }
    },
    registerPty: (ptyId) => {
      livePtys.add(ptyId);
    },
    releasePty,
    destroyAll: () => {
      // The MCP server itself stays up (it dies with the process): a window created again keeps it.
      for (const ptyId of [...livePtys]) releasePty(ptyId);
      panels.destroyAll();
    },
  };
}
