// Serviço da VPS (ADR 0008) — o motor de contas sem tela, rodando na própria
// VPS pessoal, para as VPS não dependerem do PC ligado. Mora em
// src/main/accounts/ de propósito: é o mesmo perímetro de credencial (CLAUDE.md,
// "Credenciais"), agora num segundo processo. Nada aqui é novo em regra:
//
// - o motor é o mesmo `AccountEngine`, com o mesmo mod local, a mesma política
//   (90/20) e a mesma ordem invariante de troca (`claude-state.ts`);
// - "esta máquina" é a VPS pessoal (o `~/.claude` do usuário do serviço) e os
//   lugares remotos (Homologações) são alcançados por ssh, como no PC;
// - o cofre é só das VPS: conjunto de contas separado do PC (uma conta pertence
//   a um só conjunto). A cifra é AES-GCM com chave fora do repo
//   (vault-key-cipher.ts) em vez de `safeStorage`;
// - nada que sai daqui (resposta de comando, log) carrega par de credencial.
//
// Diferença deliberada do PC: os lugares remotos são avaliados ANTES desta
// máquina (`remotePlacesFirst`) — Homologações é a que menos pode parar.

import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultAccountsConfig, type AccountId, type AccountsConfig, type AccountsViewDto, type LocalAccountMeta, type RemotePlace } from '../../../shared/accounts';
import { AccountEngine } from '../account-engine';
import { AccountEngineHost } from '../account-engine-host';
import type { CredentialPair } from '../account-mod';
import { sanitizeAccountsConfig, isValidSshTarget } from '../accounts-config';
import { applyAccountSwitch, createSystemClaudeStateIoDeps, readCurrentCredentialPair, type ClaudeStateIoDeps } from '../claude-state';
import { accountFingerprintFromClaudeJsonText, readCredentialsPairFromText } from '../credentials-file';
import { createLocalMod } from '../mods/local-mod';
import { createReconnectRegistry } from '../reconnect-registry';
import { createRefreshCoordinator } from '../refresh-coordinator';
import { createRemoteClaudeState, type RemoteClaudeState } from '../remote-claude-state';
import type { HttpFetchLike } from '../usage-client';
import { createSystemVaultIoDeps, decryptVaultEntry, deleteVaultEntry, writeVaultEntry, type SafeStorageLike, type VaultLike } from '../vault';

/** Lugar "esta máquina" nos comandos: a VPS pessoal, onde o serviço roda. */
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
  readonly remoteState?: RemoteClaudeState;
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
  adotar(lugar: string, rotulo: string): Promise<ServicoResult>;
  trocar(lugar: string, conta: AccountId | null): Promise<ServicoResult>;
  remover(conta: AccountId): Promise<ServicoResult>;
  definirLugar(id: string, rotulo: string, sshTarget: string): Promise<ServicoResult>;
  removerLugar(id: string): Promise<ServicoResult>;
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
  return { ...sanitizeAccountsConfig(accounts, base), mod: 'local', seazone: null, claudeHome: null };
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
  const remoteState = deps.remoteState ?? createRemoteClaudeState();
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
            isHeldRemotely: (id) => (host.current()?.getConfig() ?? config).remotes.some((place) => place.activeAccountId === id),
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
        remoteState,
        onRemotesChanged: (remotes) => {
          config = { ...config, remotes };
          persist();
        },
        onRemoteEvent: (event) => log({ ...event }),
        remotePlacesFirst: true,
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
    if (config.activeAccountId === id) return HERE_PLACE_ID;
    return config.remotes.find((place) => place.activeAccountId === id)?.id ?? null;
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
      log({ event: 'servico-started', accounts: config.localAccounts.length, places: config.remotes.map((place) => place.id), encryption: deps.cipher.isEncryptionAvailable() });
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
        lugares: config.remotes,
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
     * A conta que já está logada num lugar passa a ser do conjunto da VPS, sem
     * login novo: o par vivo de lá vai para o cofre e o lugar fica com ela. O
     * lugar não pode ter conta do conjunto ainda.
     */
    async adotar(lugar, rotulo) {
      if (!validLabel(rotulo)) return { ok: false, reason: 'rotulo-invalido' };
      let pair: CredentialPair | null;
      let fingerprint: string | null;
      if (lugar === HERE_PLACE_ID) {
        if (config.activeAccountId) return { ok: false, reason: 'lugar-ja-tem-conta' };
        pair = readLivePair();
        fingerprint = accountFingerprintFromClaudeJsonText(claudeIo.readFileText(paths.claudeJsonPath));
      } else {
        const place = config.remotes.find((candidate) => candidate.id === lugar);
        if (!place) return { ok: false, reason: 'lugar-desconhecido' };
        if (place.activeAccountId) return { ok: false, reason: 'lugar-ja-tem-conta' };
        const read = await remoteState.read(place.sshTarget);
        if (read.kind === 'unreachable') return { ok: false, reason: 'ssh-falhou' };
        if (read.kind !== 'ok') return { ok: false, reason: 'leitura-falhou' };
        pair = read.pair;
        fingerprint = read.fingerprint;
      }
      if (!pair) return { ok: false, reason: 'lugar-sem-login' };
      if (!fingerprint) return { ok: false, reason: 'sem-identidade-no-lugar' };
      const stored = storeAccount(pair, fingerprint, rotulo.trim());
      if ('error' in stored) return { ok: false, reason: stored.error };
      const next: AccountsConfig =
        lugar === HERE_PLACE_ID
          ? { ...stored.config, activeAccountId: stored.id }
          : { ...stored.config, remotes: stored.config.remotes.map((place) => (place.id === lugar ? { ...place, activeAccountId: stored.id } : place)) };
      log({ event: 'account-adopted', account: stored.id, place: lugar });
      await applyConfig(next);
      return { ok: true, conta: stored.id, rotulo: rotulo.trim(), lugar };
    },

    async trocar(lugar, conta) {
      const engine = host.current();
      if (!engine) return { ok: false, reason: 'motor-parado' };
      if (lugar === HERE_PLACE_ID) {
        if (!conta) return { ok: false, reason: 'conta-obrigatoria' };
        const outcome = await engine.switchTo(conta);
        log({ event: 'switch', place: lugar, origin: 'manual', outcome: outcome.kind, to: conta });
        return outcome.kind === 'switched' || outcome.kind === 'already-active' ? { ok: true, resultado: outcome.kind } : { ok: false, reason: outcome.reason };
      }
      const outcome = await engine.switchRemote(lugar, conta, 'manual');
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

    async definirLugar(id, rotulo, sshTarget) {
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === HERE_PLACE_ID) return { ok: false, reason: 'id-invalido' };
      if (!validLabel(rotulo)) return { ok: false, reason: 'rotulo-invalido' };
      if (!isValidSshTarget(sshTarget)) return { ok: false, reason: 'ssh-invalido' };
      const existing = config.remotes.find((place) => place.id === id);
      const place: RemotePlace = { id, label: rotulo.trim(), sshTarget, activeAccountId: existing?.activeAccountId ?? null };
      const remotes = existing ? config.remotes.map((candidate) => (candidate.id === id ? place : candidate)) : [...config.remotes, place];
      log({ event: 'place-set', place: id });
      await applyConfig({ ...config, remotes });
      return { ok: true, lugar: id };
    },

    async removerLugar(id) {
      const place = config.remotes.find((candidate) => candidate.id === id);
      if (!place) return { ok: false, reason: 'lugar-desconhecido' };
      // Conta ainda logada lá: tirar o lugar do motor deixaria o CLI de lá com um par que o cofre também renova.
      if (place.activeAccountId) return { ok: false, reason: 'lugar-com-conta' };
      log({ event: 'place-removed', place: id });
      await applyConfig({ ...config, remotes: config.remotes.filter((candidate) => candidate.id !== id) });
      return { ok: true, lugar: id };
    },
  };
}

