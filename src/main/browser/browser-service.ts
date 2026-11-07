import { mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { app, dialog, type BrowserWindow, type IpcMain, type WebContents } from 'electron';
import { buildBrowserMcpConfig, mcpDeliveryFor, type AgentCli } from '../../shared/commandBuilder';
import { BrowserControl, HELP_WAIT_MS, OWNER_WAIT_MS } from '../../shared/browser/control';
import {
  BROWSER_CHANNELS,
  agentAskedHelpLine,
  agentOpenedLine,
  parseBrowserRect,
  type BrowserControlState,
  type BrowserHistoryAction,
  type BrowserAgentRules,
  type BrowserLogEntry,
  type BrowserNavigateResult,
  type BrowserPanelState,
  type BrowserRulesResult,
} from '../../shared/browser/ipc';
import {
  OPEN_DOMAINS,
  actionLockMessage,
  agentMayNavigate,
  displayHost,
  domainBlockMessage,
  fieldLockMessage,
  isLockedLabel,
  keyEffect,
  lockedAction,
  lockedKeyAction,
  parseDomainList,
  sensitiveField,
  type DomainRules,
} from '../../shared/browser/guardrails';
import { parseKeyCombo } from '../../shared/browser/keys';
import { MCP_SERVER_NAME, type BrowserToolCall, type BrowserToolOutcome } from '../../shared/browser/mcp';
import type { BoardToolCall } from '../../shared/mindscape/agent-tools';
import type { LedgerToolCall } from '../../shared/ledger/tools';
import type { HillClimbToolCall } from '../../shared/hillClimb/tools';
import { refusedUploadFile, refusedUploadFolder, wideUploadFolder, withUploadFolder, withoutUploadFolder } from '../../shared/browser/upload';
import { normalizeBrowserUrl } from '../../shared/browser/url';
import { BrowserPanels } from './browser-panels';
import { browserMcpUrl, createBrowserMcpServer } from './browser-mcp-server';
import { CdpDriver, type ListRead } from './cdp-driver';
import { resolveUploadFile, type UploadFile } from './panel-helpers';

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
  /** Quadro por MCP — the Mindscape tools of the same server (main/board-bridge.ts). */
  executeBoard?(ptyId: string, call: BoardToolCall): Promise<BrowserToolOutcome>;
  openCap?(): number | null;
  /** The upload folders the owner authorized, kept in the app's config (`browserUploads`): they survive a restart. */
  readonly uploadFolders: { get(): readonly string[]; set(folders: readonly string[]): void };
  /** Ledger com prova (item 19) — the `tarefa_*` tools of the same server (main/ledger-store.ts). */
  executeLedger?(ptyId: string, call: LedgerToolCall): Promise<BrowserToolOutcome>;
  /** Hill climbing — the Escalador's `hillclimb_*` tools. */
  executeHillClimb?(ptyId: string, call: HillClimbToolCall): Promise<BrowserToolOutcome>;
}

export interface BrowserService {
  /** Starts the local MCP server. Sessions spawned before (or if it fails) simply have no browser tools. */
  startMcp(): Promise<void>;
  /**
   * Before spawning the agent CLI of `ptyId`: a fresh token, the per-session config file, and the argv that
   * hands the app's MCP server to that CLI. `[]` when the server is not up (the session starts without it).
   */
  prepareSession(ptyId: string, cli: AgentCli): string[];
  /**
   * Sessões remotas — the same MCP for a CLI on a remote place: it reaches the app through a reverse tunnel on`n   * `remotePort`. Returns the local port to tunnel to, the token and the config file content (written remotely),`n   * or `null` when the server is not up. `token` reuses the one a reattached session already holds.
   */
  prepareRemoteSession(ptyId: string, remotePort: number, token?: string): { localPort: number; token: string; configFileContent: string } | null;
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
/** Tools that read or act on the current page: the vigia also holds them on a page outside the rules. */
const TOOLS_ON_THE_PAGE: ReadonlySet<BrowserToolCall['tool']> = new Set([
  'navegador_ler',
  'navegador_extrair',
  'navegador_clicar',
  'navegador_digitar',
  'navegador_opcoes',
  'navegador_selecionar',
  'navegador_achar_texto',
  'navegador_enviar_arquivo',
  'navegador_teclar',
  'navegador_rolar',
  'navegador_print',
  'navegador_esperar',
]);

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
  /** One driver per tab, for as long as the tab lives: its `[N]` numbers survive a trip to another tab. */
  const drivers = new WeakMap<WebContents, CdpDriver>();
  /** `navegador_enviar_arquivo` waiting for Permitir / Negar on the folder of its file, per session. */
  const uploadRequests = new Map<string, { readonly folder: string; readonly file: string; readonly wide: string | null; readonly answer: (allow: boolean) => void }>();
  /** Where the agent may navigate, per session (no entry = anywhere). */
  const domainRules = new Map<string, DomainRules>();
  /** The address the vigia refused while the current tool ran: the tool answers with it. */
  const blockedDuringTool = new Map<string, string>();
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
    blockNavigation: (ptyId, url) => {
      if (!agentBusy.has(ptyId) || agentMayNavigate(domainRules.get(ptyId) ?? OPEN_DOMAINS, url)) return false;
      blockedDuringTool.set(ptyId, url);
      log(ptyId, `Bloqueado: o agente tentou abrir ${displayHost(url)}`);
      return true;
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
    const { contents } = panels.ensure(ptyId);
    let driver = drivers.get(contents);
    if (!driver) {
      driver = new CdpDriver(contents);
      drivers.set(contents, driver);
    }
    return driver;
  };

  const where = (ptyId: string): string => {
    const state = panels.state(ptyId);
    if (!state) return '';
    return `Página: ${state.title || '(sem título)'} — ${state.url}`;
  };

  const uploadContext = { home: homedir(), userData: deps.userDataDir };
  /** Documentos, Área de Trabalho, Downloads as the system names them (redirected to OneDrive or not). */
  const knownWide = (['desktop', 'documents', 'downloads'] as const).flatMap((name) => {
    try {
      return [app.getPath(name)];
    } catch {
      return [];
    }
  });
  const wideWarning = (folder: string): string | null => wideUploadFolder(folder, { ...uploadContext, known: knownWide });
  /** The saved folders that still pass the rules of a fresh gesture (a hand-edited config gains nothing). */
  const uploadFolders = (): readonly string[] => deps.uploadFolders.get().filter((folder) => refusedUploadFolder(folder, uploadContext) === null);

  const rulesOf = (ptyId: string): BrowserAgentRules => {
    const domains = domainRules.get(ptyId) ?? OPEN_DOMAINS;
    return {
      ptyId,
      uploadDirs: uploadFolders(),
      uploadRequest: (() => {
        const request = uploadRequests.get(ptyId);
        return request ? { folder: request.folder, file: request.file, wide: request.wide } : null;
      })(),
      domainMode: domains.mode,
      domains: domains.domains,
    };
  };
  const emitRules = (ptyId: string): void => send(BROWSER_CHANNELS.rules, rulesOf(ptyId));
  /** The folder list is the app's: every open session sees the change. */
  const emitAllRules = (): void => {
    for (const ptyId of livePtys) emitRules(ptyId);
  };

  /** A folder to authorize passes the same checks whether it came from the picker or from the agent's request. */
  const checkedUploadDir = (picked: string): { ok: true; folder: string } | { ok: false; reason: string } => {
    let folder: string;
    try {
      folder = realpathSync.native(picked);
    } catch {
      return { ok: false, reason: 'Não consegui abrir essa pasta.' };
    }
    const refused = refusedUploadFolder(folder, uploadContext);
    return refused ? { ok: false, reason: refused } : { ok: true, folder };
  };

  const addUploadFolder = (folder: string): void => {
    deps.uploadFolders.set(withUploadFolder(deps.uploadFolders.get(), folder));
    emitAllRules();
  };

  const removeUploadFolder = (folder: string): void => {
    deps.uploadFolders.set(withoutUploadFolder(deps.uploadFolders.get(), folder));
    emitAllRules();
  };

  /** How the agent gets a folder: said in every refusal and in the tool's description (shared/browser/mcp.ts). */
  const HOW_TO_ASK =
    'Chame navegador_enviar_arquivo de novo com o caminho COMPLETO do arquivo: a própria ferramenta mostra ao dono a pasta dele, com Permitir / Negar, e espera a resposta (até 30 min). Não use navegador_pedir_humano para isso.';

  type UploadLookup = UploadFile | { readonly ok: false; readonly reason: string; readonly askFolder?: string };

  /**
   * The file the agent asked for, inside one of the authorized folders. A file that exists outside all of them
   * comes back with `askFolder`: its own folder, which the tool asks the owner for.
   */
  const lookupUploadFile = (requested: string): UploadLookup => {
    const folders = uploadFolders();
    if (!isAbsolute(requested)) {
      if (folders.length === 0) return { ok: false, reason: `Nenhuma pasta de envio autorizada ainda. ${HOW_TO_ASK}` };
      const tries = folders.map((folder) => resolveUploadFile(folder, requested));
      const found = tries.find((file) => file.ok);
      if (found) return found;
      if (tries.length === 1) return tries[0];
      return { ok: false, reason: `Não achei "${requested}" nas pastas autorizadas (${folders.join('; ')}). ${HOW_TO_ASK}` };
    }
    let real: string;
    try {
      real = realpathSync.native(requested);
    } catch {
      return { ok: false, reason: `Não achei esse arquivo: ${requested}.` };
    }
    for (const folder of folders) {
      let realFolder: string;
      try {
        realFolder = realpathSync.native(folder);
      } catch {
        continue; // the folder is gone: it simply covers nothing
      }
      const inside = relative(realFolder, real);
      if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) return resolveUploadFile(realFolder, real);
    }
    return { ok: false, reason: `O arquivo está fora das pastas de envio autorizadas. ${HOW_TO_ASK}`, askFolder: dirname(real) };
  };

  /**
   * The agent asked for a file outside the authorized folders: the panel opens with its folder and Permitir / Negar.
   * `null` = allowed (the folder is saved for every session); otherwise the refusal the tool answers with.
   */
  const askUploadFolder = async (ptyId: string, file: string, wanted: string): Promise<BrowserToolOutcome | null> => {
    const secret = refusedUploadFile(basename(file));
    if (secret) return fail(secret);
    // One request at a time per session: a second one would take the place of the first on the bar.
    if (uploadRequests.has(ptyId)) {
      return fail(`Já há um pedido de pasta (${uploadRequests.get(ptyId)!.folder}) esperando o dono nesta sessão. Espere a resposta dele antes de pedir outro arquivo.`);
    }
    const checked = checkedUploadDir(wanted);
    if (!checked.ok) {
      return fail(
        `${checked.reason} (o arquivo está em ${wanted}). Copie o arquivo para uma pasta só de envios e chame navegador_enviar_arquivo com o caminho novo; o dono vai ver o pedido dessa pasta.`,
      );
    }
    const { folder } = checked;
    try {
      panels.ensure(ptyId);
    } catch (error) {
      return fail(errorText(error));
    }
    log(ptyId, `O agente pediu para enviar arquivos da pasta ${folder}`);
    send(BROWSER_CHANNELS.openRequest, { ptyId });
    const answer = await new Promise<'allow' | 'deny' | 'timeout'>((resolve) => {
      const request = {
        folder,
        file: basename(file),
        wide: wideWarning(folder),
        answer: (allow: boolean) => {
          clearTimeout(timer);
          if (uploadRequests.get(ptyId) === request) uploadRequests.delete(ptyId);
          resolve(allow ? 'allow' : 'deny');
        },
      };
      const timer = setTimeout(() => {
        if (uploadRequests.get(ptyId) === request) uploadRequests.delete(ptyId);
        emitRules(ptyId);
        resolve('timeout');
      }, HELP_WAIT_MS);
      uploadRequests.set(ptyId, request);
      emitRules(ptyId);
    });
    if (!livePtys.has(ptyId)) return fail('A sessão deste navegador terminou.');
    if (answer === 'timeout') return fail(`O dono não respondeu em 30 min ao pedido da pasta ${folder}.`);
    if (answer === 'deny') {
      emitRules(ptyId);
      log(ptyId, `Você negou a pasta ${folder}`);
      return fail(`O dono negou o envio de arquivos da pasta ${folder}. Não tente enviar esse arquivo por outro caminho; se for preciso, explique a ele por quê.`);
    }
    addUploadFolder(folder);
    log(ptyId, `Você permitiu a pasta ${folder}`);
    return null;
  };

  const tabLine = (i: number, tab: { title: string; url: string; active: boolean }): string => `${i}. ${tab.title || '(sem título)'} — ${tab.url}${tab.active ? ' (ativa)' : ''}`;

  const listText = (n: number, name: string, list: ListRead): string => {
    const lines = list.options.map((option, i) => {
      const marks = [option.selected ? 'selecionada' : '', option.disabled ? 'desativada' : ''].filter((mark) => mark !== '');
      return `${i + 1}. "${option.text}"${option.value && option.value !== option.text ? ` (valor: ${option.value})` : ''}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`;
    });
    const cut = list.total > list.options.length ? `\n… (mostrando ${list.options.length} de ${list.total})` : '';
    return `Opções de [${n}]${name ? ` "${name}"` : ''}:\n${lines.join('\n')}${cut}`;
  };

  const text = (value: string): BrowserToolOutcome => ({ kind: 'text', text: value });
  const fail = (value: string): BrowserToolOutcome => ({ kind: 'error', text: value });
  /** The trava said no: the owner sees it in the footer, the agent gets the way out. */
  const locked = (ptyId: string, message: string, what: string): BrowserToolOutcome => {
    log(ptyId, `Trava: o agente parou em ${what}`);
    return fail(message);
  };

  /** One tool call, already holding the agent's turn. */
  const run = async (ptyId: string, call: BrowserToolCall): Promise<BrowserToolOutcome> => {
    switch (call.tool) {
      case 'navegador_abrir': {
        const target = normalizeBrowserUrl(call.url);
        if (!target.ok) return fail(target.reason);
        if (!agentMayNavigate(domainRules.get(ptyId) ?? OPEN_DOMAINS, target.url)) {
          log(ptyId, `Bloqueado: o agente tentou abrir ${displayHost(target.url)}`);
          return fail(domainBlockMessage(target.url));
        }
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
        const label = lockedAction(await driverFor(ptyId).facts(call.n));
        if (label) return locked(ptyId, actionLockMessage(label), `"${label.slice(0, 80)}"`);
        const ref = await driverFor(ptyId).click(call.n);
        return text(`Clicou em [${call.n}] ${ref.role} "${ref.name}".\n${where(ptyId)}\nLeia de novo (navegador_ler) para ver o resultado.`);
      }
      case 'navegador_digitar': {
        const field = sensitiveField(await driverFor(ptyId).facts(call.n));
        if (field) return locked(ptyId, fieldLockMessage(field), `um campo de ${field}`);
        const ref = await driverFor(ptyId).type(call.n, call.texto);
        return text(`Digitou em [${call.n}] ${ref.role} "${ref.name}".`);
      }
      case 'navegador_opcoes': {
        const { ref, list } = await driverFor(ptyId).options(call.n);
        if (list.kind === 'none') return fail(`[${call.n}] não é uma lista. Para um botão ou menu, use navegador_clicar e navegador_ler.`);
        if (list.options.length === 0) return fail(`A lista [${call.n}] não mostrou opções. Clique nela e leia a página de novo.`);
        return text(listText(call.n, ref.name, list));
      }
      case 'navegador_selecionar': {
        const field = sensitiveField(await driverFor(ptyId).facts(call.n));
        if (field) return locked(ptyId, fieldLockMessage(field), `um campo de ${field}`);
        if (isLockedLabel(call.opcao)) return locked(ptyId, actionLockMessage(call.opcao), `"${call.opcao.slice(0, 80)}"`);
        const { chosen } = await driverFor(ptyId).select(call.n, call.opcao);
        return text(`Selecionou "${chosen}" em [${call.n}].\nLeia de novo (navegador_ler) para ver o resultado.`);
      }
      case 'navegador_achar_texto':
        return (await driverFor(ptyId).findText(call.texto))
          ? text(`Rolou até "${call.texto}".\nUse navegador_ler para ver o que há ali.`)
          : fail(`Não achei "${call.texto}" visível nesta página.`);
      case 'navegador_abas': {
        panels.ensure(ptyId);
        return text(panels.tabs(ptyId).map((tab, i) => tabLine(i + 1, tab)).join('\n'));
      }
      case 'navegador_trocar_aba': {
        panels.ensure(ptyId);
        const tab = panels.tabs(ptyId)[call.i - 1];
        if (!tab) return fail(`Não há aba ${call.i}. Veja a lista com navegador_abas.`);
        panels.switchTab(ptyId, tab.id);
        return text(`${where(ptyId)}\nUse navegador_ler para ver a página.`);
      }
      case 'navegador_fechar_aba': {
        panels.ensure(ptyId);
        const tab = panels.tabs(ptyId)[call.i - 1];
        if (!tab) return fail(`Não há aba ${call.i}. Veja a lista com navegador_abas.`);
        if (panels.closeTab(ptyId, tab.id) === 'last') return fail('Esta é a última aba: ela não fecha.');
        return text(`Fechou a aba ${call.i}.\n${where(ptyId)}`);
      }
      case 'navegador_enviar_arquivo': {
        const file = lookupUploadFile(call.caminho);
        if (!file.ok) return fail(file.reason);
        await driverFor(ptyId).upload(call.n, file.path);
        log(ptyId, `Agente enviou o arquivo: ${file.name}`);
        return text(`Colocou "${file.name}" no campo de envio de [${call.n}]. O arquivo só sai da máquina quando a página enviar o formulário.`);
      }
      case 'navegador_teclar': {
        const parsed = parseKeyCombo(call.tecla);
        const effect = parsed.ok ? keyEffect(parsed.events) : { types: false, activates: false };
        if (effect.types || effect.activates) {
          const focused = await driverFor(ptyId).focusedFacts();
          const field = focused && effect.types ? sensitiveField(focused) : null;
          if (field) return locked(ptyId, fieldLockMessage(field), `um campo de ${field}`);
          const label = focused && effect.activates ? lockedKeyAction(focused) : null;
          if (label) return locked(ptyId, actionLockMessage(label), `"${label.slice(0, 80)}"`);
        }
        await driverFor(ptyId).pressKey(call.tecla);
        return text(`Teclou ${call.tecla}.\n${where(ptyId)}`);
      }
      case 'navegador_rolar':
        await driverFor(ptyId).scroll(call.direcao);
        return text(`Rolou para ${call.direcao}.`);
      case 'navegador_voltar': {
        const driver = driverFor(ptyId);
        const back = panels.backUrl(ptyId);
        if (back !== null && !agentMayNavigate(domainRules.get(ptyId) ?? OPEN_DOMAINS, back)) return fail(domainBlockMessage(back));
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

    // A file outside the authorized folders: the owner answers Permitir / Negar first, outside the agent's turn on
    // the page (he may use the browser meanwhile).
    if (call.tool === 'navegador_enviar_arquivo') {
      const lookup = lookupUploadFile(call.caminho);
      if (!lookup.ok && 'askFolder' in lookup && lookup.askFolder !== undefined) {
        const refused = await askUploadFolder(ptyId, call.caminho, lookup.askFolder);
        if (refused) return refused;
      }
    }

    const turn = await control.waitForAgentTurn(OWNER_WAIT_MS);
    if (turn === 'timeout') return fail('O dono ainda está usando o navegador. Tente de novo mais tarde ou peça com navegador_pedir_humano.');
    if (turn === 'disposed') return fail('A sessão deste navegador terminou.');

    agentBusy.add(ptyId);
    blockedDuringTool.delete(ptyId);
    try {
      // A page the agent may not be on (the owner went there, or a script did after the last tool): hands off.
      if (TOOLS_ON_THE_PAGE.has(call.tool)) {
        const here = panels.currentUrl(ptyId);
        if (!agentMayNavigate(domainRules.get(ptyId) ?? OPEN_DOMAINS, here)) return fail(`A página atual está fora do que o dono liberou. ${domainBlockMessage(here)}`);
      }
      const outcome = await run(ptyId, call);
      const blocked = blockedDuringTool.get(ptyId);
      return blocked ? fail(`${domainBlockMessage(blocked)}\n${where(ptyId)}`) : outcome;
    } catch (error) {
      return fail(errorText(error));
    } finally {
      agentBusy.delete(ptyId);
      blockedDuringTool.delete(ptyId);
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

  const mcp = createBrowserMcpServer({
    execute: enqueue,
    ...(deps.executeBoard ? { executeBoard: deps.executeBoard } : {}),
    ...(deps.openCap ? { openCap: deps.openCap } : {}),
    ...(deps.executeLedger ? { executeLedger: deps.executeLedger } : {}),
    ...(deps.executeHillClimb ? { executeHillClimb: deps.executeHillClimb } : {}),
    serverVersion: deps.appVersion,
  });

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

  deps.ipcMain.on(BROWSER_CHANNELS.tab, (event, ptyId: unknown, action: unknown, tabId: unknown) => {
    if (!known(event.sender, ptyId) || typeof tabId !== 'number' || !Number.isInteger(tabId)) return;
    if (action === 'switch') panels.switchTab(ptyId, tabId);
    else if (action === 'close') panels.closeTab(ptyId, tabId);
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.getRules, (event, ptyId: unknown): BrowserAgentRules | null => (known(event.sender, ptyId) ? rulesOf(ptyId) : null));

  // An upload folder comes from a gesture of the owner: the native picker here, or Permitir on the agent's request
  // (whose folder the main holds). No path to authorize travels from the renderer, and no tool of the agent reaches this.
  deps.ipcMain.handle(BROWSER_CHANNELS.chooseUploadDir, async (event, ptyId: unknown): Promise<BrowserRulesResult> => {
    if (!known(event.sender, ptyId)) return { ok: false, reason: 'Sessão desconhecida para o navegador.' };
    const window = deps.getWindow();
    if (!window) return { ok: false, reason: null };
    const picked = await dialog.showOpenDialog(window, { title: 'Pasta de onde o agente pode enviar arquivos', properties: ['openDirectory'] });
    const chosen = picked.filePaths[0];
    if (picked.canceled || !chosen) return { ok: false, reason: null };
    const checked = checkedUploadDir(chosen);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const wide = wideWarning(checked.folder);
    if (wide) {
      const confirm = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Pasta larga',
        message: `Liberar ${checked.folder} para envio de arquivos?`,
        detail: wide,
        buttons: ['Liberar a pasta inteira', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirm.response !== 0) return { ok: false, reason: null };
    }
    addUploadFolder(checked.folder);
    return { ok: true, rules: rulesOf(ptyId) };
  });

  // Taking a folder back only narrows what the agent may send, so the path may come from the renderer.
  deps.ipcMain.on(BROWSER_CHANNELS.removeUploadDir, (event, ptyId: unknown, folder: unknown) => {
    if (!known(event.sender, ptyId) || typeof folder !== 'string') return;
    removeUploadFolder(folder);
  });

  deps.ipcMain.on(BROWSER_CHANNELS.answerUploadRequest, (event, ptyId: unknown, allow: unknown, wideConfirmed: unknown) => {
    if (!known(event.sender, ptyId)) return;
    const request = uploadRequests.get(ptyId);
    // A wide folder is allowed only with the warning confirmed; a bare Permitir is ignored (the bar stays).
    if (request && allow === true && request.wide && wideConfirmed !== true) return;
    request?.answer(allow === true);
  });

  deps.ipcMain.handle(BROWSER_CHANNELS.setDomains, (event, ptyId: unknown, mode: unknown, typed: unknown): BrowserRulesResult => {
    if (!known(event.sender, ptyId)) return { ok: false, reason: 'Sessão desconhecida para o navegador.' };
    if (mode !== 'all' && mode !== 'only' && mode !== 'except') return { ok: false, reason: 'Opção desconhecida.' };
    const { domains, invalid } = parseDomainList(typeof typed === 'string' ? typed : '');
    if (invalid.length > 0) return { ok: false, reason: `Domínio inválido: ${invalid.slice(0, 3).join(', ')}.` };
    if (mode === 'only' && domains.length === 0) return { ok: false, reason: 'Diga ao menos um domínio.' };
    if (mode === 'all') domainRules.delete(ptyId);
    else domainRules.set(ptyId, { mode, domains });
    emitRules(ptyId);
    return { ok: true, rules: rulesOf(ptyId) };
  });

  const releasePty = (ptyId: string): void => {
    livePtys.delete(ptyId);
    uploadRequests.get(ptyId)?.answer(false);
    domainRules.delete(ptyId);
    blockedDuringTool.delete(ptyId);
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
    prepareRemoteSession: (ptyId, remotePort, knownToken) => {
      const port = mcp.port;
      if (port === null || !isPtyId(ptyId)) return null;
      const token = mcp.registerSession(ptyId, knownToken, remotePort);
      const endpoint = { name: MCP_SERVER_NAME, url: browserMcpUrl(remotePort), bearerToken: token };
      return { localPort: port, token, configFileContent: `${JSON.stringify(buildBrowserMcpConfig(endpoint), null, 2)}\n` };
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
