// Serviço da VPS (ADR 0008, emendado pelo ADR 0009) — o motor de contas sem
// tela, rodando em CADA VPS, para nenhuma depender do PC ligado nem da outra
// VPS. Mora em src/main/accounts/ de propósito: é o mesmo perímetro de
// credencial (CLAUDE.md, "Credenciais"), agora num segundo processo. Nada aqui
// é novo em regra:
//
// - o motor é o mesmo `AccountEngine`, com o mesmo mod local, a mesma política
//   (90/20) e a mesma ordem invariante de troca (`claude-state.ts`);
// - o único lugar é "esta máquina" (o `~/.claude` do usuário do serviço). Sem
//   lugar remoto, sem ssh: cada VPS troca só a própria conta (ADR 0009);
// - o cofre é só desta VPS: conjunto de contas separado do PC e da outra VPS
//   (uma conta pertence a um só conjunto). A cifra é AES-GCM com chave fora do
//   repo (vault-key-cipher.ts) em vez de `safeStorage`;
// - nada que sai daqui (resposta de comando, log) carrega par de credencial.

import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultAccountsConfig, type AccountId, type AccountsConfig, type AccountsViewDto, type LocalAccountMeta } from '../../../shared/accounts';
import { AccountEngine } from '../account-engine';
import { AccountEngineHost } from '../account-engine-host';
import type { CredentialPair } from '../account-mod';
import { sanitizeAccountsConfig } from '../accounts-config';
import { applyAccountSwitch, createSystemClaudeStateIoDeps, readCurrentCredentialPair, type ClaudeStateIoDeps } from '../claude-state';
import { accountFingerprintFromClaudeJsonText, readCredentialsPairFromText } from '../credentials-file';
import { createLocalMod } from '../mods/local-mod';
import { createReconnectRegistry } from '../reconnect-registry';
import { createRefreshCoordinator } from '../refresh-coordinator';
import type { HttpFetchLike } from '../usage-client';
import { createSystemVaultIoDeps, decryptVaultEntry, deleteVaultEntry, writeVaultEntry, type SafeStorageLike, type VaultLike } from '../vault';

/** Lugar "esta máquina" no estado e no log: a VPS onde o serviço roda. */
export const HERE_PLACE_ID = 'aqui';

export interface ServicoPaths {
  readonly dir: string;
  readonly configPath: string;
  readonly vaultPath: string;
  readonly logPath: string;
  readonly claudeHome: string;
  readonly claudeJsonPath: string;
}

export function servicoPathsFor(home: string, dir: string = join(home, '.donel')): ServicoPaths {
  return {
    dir,
    configPath: join(dir, 'servico.json'),
    vaultPath: join(dir, 'accounts-vault.json'),
    logPath: join(dir, 'accounts-maintenance.log'),
    claudeHome: join(home, '.claude'),
    claudeJsonPath: join(home, '.claude.json'),
  };
}

/** Resposta dos comandos. Só ids, rótulos, lugares e motivos — nunca par. */
export type ServicoResult =
  | { readonly ok: true; readonly [key: string]: unknown }
  | { readonly ok: false; readonly reason: string };

export interface ServicoContasDeps {
  readonly paths: ServicoPaths;
  readonly cipher: SafeStorageLike;
  readonly fetchImpl?: HttpFetchLike;
  readonly claudeIo?: ClaudeStateIoDeps;
  readonly now?: () => number;
  /** Teste: sem poll. Produção: poll adaptativo do motor (1 a 5 min), sempre ligado — a VPS trabalha sem ninguém olhando. */
  readonly polling?: boolean;
}

export interface ServicoContas {
  start(): Promise<void>;
  dispose(): void;
  estado(): Promise<ServicoResult>;
  colher(pasta: string, rotulo: string): Promise<ServicoResult>;
  adotar(rotulo: string): Promise<ServicoResult>;
  trocar(conta: AccountId): Promise<ServicoResult>;
  remover(conta: AccountId): Promise<ServicoResult>;
}

interface ServicoFile {
  readonly version: 1;
  readonly accounts: AccountsConfig;
}

function readServicoConfig(path: string): AccountsConfig {
  const base: AccountsConfig = { ...defaultAccountsConfig(), mod: 'local' };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return base;
  }
  const accounts = typeof parsed === 'object' && parsed !== null ? (parsed as { accounts?: unknown }).accounts : undefined;
  // Só o pool próprio na VPS: o pool Seazone tem posse e heartbeat por máquina (ADR 0005, item 6).
  // Sem lugares remotos: cada VPS tem o seu motor e não dirige outra (ADR 0009).
  return { ...sanitizeAccountsConfig(accounts, base), mod: 'local', seazone: null, claudeHome: null, remotes: [] };
}

function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, content, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort
    }
    throw error;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function createServicoContas(deps: ServicoContasDeps): ServicoContas {
  const { paths } = deps;
  const now = deps.now ?? Date.now;
  const claudeIo = deps.claudeIo ?? createSystemClaudeStateIoDeps();
  const vaultIo = createSystemVaultIoDeps();
  const reconnectRegistry = createReconnectRegistry();
  const refreshCoordinator = createRefreshCoordinator();
  let config = readServicoConfig(paths.configPath);

  const vault: VaultLike = {
    read: (id) => decryptVaultEntry(paths.vaultPath, deps.cipher, vaultIo, id),
    write: (id, plainText) => writeVaultEntry(paths.vaultPath, deps.cipher, vaultIo, id, plainText),
  };

  function log(entry: Record<string, unknown>): void {
    try {
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      appendFileSync(paths.logPath, `${JSON.stringify({ at: new Date(now()).toISOString(), ...entry })}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // segue sem registro
    }
  }

  function persist(): void {
    const file: ServicoFile = { version: 1, accounts: config };
    writeFileAtomic(paths.configPath, `${JSON.stringify(file, null, 2)}\n`);
  }

  function readLivePair(): CredentialPair | null {
    return readCurrentCredentialPair({ io: claudeIo, claudeHome: paths.claudeHome });
  }

  const host: AccountEngineHost = new AccountEngineHost({
    createEngine: (engineConfig): AccountEngine => {
      const engine = new AccountEngine({
        config: engineConfig,
        resolveMod: () =>
          createLocalMod({
            accounts: engineConfig.localAccounts,
            vault,
            fetchImpl: deps.fetchImpl,
            refreshCoordinator,
            getActiveAccountId: (): AccountId | null => host.current()?.getActiveAccountId() ?? config.activeAccountId,
            readLiveCredentialPair: readLivePair,
            reconnectRegistry,
            now,
            onPairRefreshed: (id, trigger) => log({ event: 'account-pair-refreshed', account: id, trigger }),
            onPairRefreshFailed: (id, trigger, reason) => log({ event: 'account-pair-refresh-failed', account: id, trigger, reason }),
            isHeldRemotely: () => false,
          }),
        applySwitch: (pair, onRotatedPairCaptured) =>
          applyAccountSwitch({ io: claudeIo, claudeHome: paths.claudeHome, claudeJsonPath: paths.claudeJsonPath, onRotatedPairCaptured }, pair),
        isSessionBusy: () => false,
        reconnectRegistry,
        now,
        onAutoSwitchLogged: (entry) => log({ event: 'auto-switch', place: HERE_PLACE_ID, ...entry }),
        readCurrentPair: readLivePair,
        readCurrentAccountFingerprint: () => accountFingerprintFromClaudeJsonText(claudeIo.readFileText(paths.claudeJsonPath)),
        onSwitchOverwritten: (info) => log({ event: 'switch-overwritten', account: info.to }),
        onLivePairCaptured: (info) => log({ event: 'live-pair-captured', account: info.account, trigger: info.trigger, believedActive: info.believedActive }),
      });
      engine.start();
      if (deps.polling !== false) engine.startPolling(() => true);
      return engine;
    },
    onActiveAccountChanged: (id) => {
      if (id === config.activeAccountId) return;
      config = { ...config, activeAccountId: id };
      persist();
    },
  });

  /** Aplica a config nova no motor (reconstrói quando a lista de contas muda) e a grava. */
  async function applyConfig(next: AccountsConfig): Promise<void> {
    config = next;
    persist();
    host.apply(config);
    await host.current()?.listAccounts();
  }

  function holderOf(id: AccountId): string | null {
    return config.activeAccountId === id ? HERE_PLACE_ID : null;
  }

  /** Grava o par no cofre e devolve a config com a conta (nova ou a mesma, pelo fingerprint). */
  function storeAccount(pair: CredentialPair, fingerprint: string, rotulo: string): { readonly config: AccountsConfig; readonly id: AccountId; readonly nova: boolean } | { readonly error: string } {
    const existing = config.localAccounts.find((account) => account.fingerprint === fingerprint) ?? null;
    if (existing && holderOf(existing.id) !== null) return { error: 'conta-em-uso' };
    const id = existing?.id ?? randomUUID();
    let written;
    try {
      written = vault.write(id, JSON.stringify(pair));
    } catch {
      return { error: 'cofre-falhou' };
    }
    if (written.kind !== 'ok') return { error: 'cofre-sem-chave' };
    reconnectRegistry.clear(id);
    const meta: LocalAccountMeta = { id, label: rotulo, plan: null, fingerprint };
    const localAccounts = existing ? config.localAccounts.map((account) => (account.id === id ? meta : account)) : [...config.localAccounts, meta];
    return { config: { ...config, localAccounts }, id, nova: existing === null };
  }

  function validLabel(rotulo: string): boolean {
    return typeof rotulo === 'string' && rotulo.trim().length > 0 && rotulo.trim().length <= 60;
  }

  return {
    async start() {
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      host.apply(config);
      log({ event: 'servico-started', accounts: config.localAccounts.length, encryption: deps.cipher.isEncryptionAvailable() });
      await host.current()?.listAccounts();
      await host.current()?.evaluateAutoSwitch();
    },

    dispose() {
      host.dispose();
    },

    async estado() {
      const engine = host.current();
      const view: AccountsViewDto | null = engine ? await engine.listAccounts() : null;
      return {
        ok: true,
        aqui: config.activeAccountId,
        politica: config.autoSwitch,
        contas: (view?.accounts ?? []).map((account) => ({
          id: account.id,
          rotulo: account.label,
          lugar: holderOf(account.id),
          carga: account.load,
          reconectar: account.needsReconnect === true,
          disponivel: account.available,
        })),
        motor: view ? { estado: view.state, trocaAutomatica: view.autoSwitchState, lidoEm: view.lastReadAt } : null,
      };
    },

    /**
     * Login isolado feito na VPS: `CLAUDE_CONFIG_DIR=<pasta> claude` e `/login`.
     * Colhe o par para o cofre e APAGA o `.credentials.json` da pasta (o par
     * passa a existir só no cofre). Nunca `/logout`: ele revoga o token no servidor.
     */
    async colher(pasta, rotulo) {
      if (!validLabel(rotulo)) return { ok: false, reason: 'rotulo-invalido' };
      const credentialsPath = join(pasta, '.credentials.json');
      const read = readCredentialsPairFromText(readText(credentialsPath));
      if (read.kind !== 'ok') return { ok: false, reason: 'sem-login-na-pasta' };
      const fingerprint = accountFingerprintFromClaudeJsonText(readText(join(pasta, '.claude.json')));
      if (!fingerprint) return { ok: false, reason: 'sem-identidade-na-pasta' };
      const stored = storeAccount(read.pair, fingerprint, rotulo.trim());
      if ('error' in stored) return { ok: false, reason: stored.error };
      try {
        unlinkSync(credentialsPath);
      } catch {
        // o par já está no cofre; a pasta fica para o dono apagar
      }
      log({ event: 'account-harvested', account: stored.id, nova: stored.nova });
      await applyConfig(stored.config);
      return { ok: true, conta: stored.id, rotulo: rotulo.trim(), nova: stored.nova };
    },

    /**
     * A conta que já está logada nesta VPS passa a ser do conjunto dela, sem
     * login novo: o par vivo do `~/.claude` vai para o cofre e a VPS fica com
     * ela. A VPS não pode ter conta do conjunto ativa ainda.
     */
    async adotar(rotulo) {
      if (!validLabel(rotulo)) return { ok: false, reason: 'rotulo-invalido' };
      if (config.activeAccountId) return { ok: false, reason: 'ja-tem-conta' };
      const pair = readLivePair();
      if (!pair) return { ok: false, reason: 'sem-login-aqui' };
      const fingerprint = accountFingerprintFromClaudeJsonText(claudeIo.readFileText(paths.claudeJsonPath));
      if (!fingerprint) return { ok: false, reason: 'sem-identidade-aqui' };
      const stored = storeAccount(pair, fingerprint, rotulo.trim());
      if ('error' in stored) return { ok: false, reason: stored.error };
      log({ event: 'account-adopted', account: stored.id, place: HERE_PLACE_ID });
      await applyConfig({ ...stored.config, activeAccountId: stored.id });
      return { ok: true, conta: stored.id, rotulo: rotulo.trim() };
    },

    async trocar(conta) {
      const engine = host.current();
      if (!engine) return { ok: false, reason: 'motor-parado' };
      if (!conta) return { ok: false, reason: 'conta-obrigatoria' };
      const outcome = await engine.switchTo(conta);
      log({ event: 'switch', place: HERE_PLACE_ID, origin: 'manual', outcome: outcome.kind, to: conta });
      return outcome.kind === 'switched' || outcome.kind === 'already-active' ? { ok: true, resultado: outcome.kind } : { ok: false, reason: outcome.reason };
    },

    async remover(conta) {
      if (!config.localAccounts.some((account) => account.id === conta)) return { ok: false, reason: 'conta-desconhecida' };
      if (holderOf(conta) !== null) return { ok: false, reason: 'conta-em-uso' };
      deleteVaultEntry(paths.vaultPath, vaultIo, conta);
      log({ event: 'account-removed', account: conta });
      await applyConfig({ ...config, localAccounts: config.localAccounts.filter((account) => account.id !== conta) });
      return { ok: true, conta };
    },
  };
}

