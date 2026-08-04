// T1120/T1121 (011-contas-e-provedores, etapa 1) — o motor: compõe mod +
// claude-state + auto-switch + vault (via `applySwitch` injetado). Máquina de
// estados `inert`/`ready`/`unavailable` (data-model.md §3). Sequência do
// switch na ordem invariante (delegada a `applySwitch`, claude-state.ts:
// captura → escreve `.credentials.json` → apaga `oauthAccount`).
// `keepAlive` chamado a cada 15 min só se o mod implementar (C3); releitura
// de carga sob demanda + poll de 5 min com sessão viva (C4, `startPolling`).
// Adiamento por sessão ocupada (C5): `evaluateAutoSwitch` consulta
// `isSessionBusy` (leitura apenas, nunca escreve no semáforo) e devolve
// `deferred` enquanto houver sessão trabalhando — switch MANUAL nunca é
// adiado.

import { selectSwitchTarget } from './auto-switch';
import type { AccountMod, CredentialPair } from './account-mod';
import type { AccountId, AccountsConfig, AccountsViewDto, ModId, SwitchOutcome } from '../../shared/accounts';

const KEEP_ALIVE_INTERVAL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export type AccountEngineState = 'inert' | 'ready' | 'unavailable';

export interface AccountEngineDeps {
  readonly config: AccountsConfig;
  /** Instancia o mod concreto pelo id (main/index.ts monta seazone-mod/local-mod com suas deps reais). Nunca chamado se `config.mod` for `null`. */
  readonly resolveMod: (modId: ModId) => AccountMod;
  /**
   * A sequência invariante inteira (claude-state.ts `applyAccountSwitch`),
   * já fechada sobre `claudeHome`/`claudeJsonPath`/IO reais. `onRotatedPairCaptured`
   * é chamado pelo `applySwitch` com o par ATUAL do disco — o motor usa isso
   * para persistir via `mod.captureRotatedPair`.
   */
  readonly applySwitch: (pair: CredentialPair, onRotatedPairCaptured: (pair: CredentialPair | null) => void | Promise<void>) => Promise<void>;
  /** C5 — leitura apenas do `session-semaphore-manager`; nunca escreve nele. */
  readonly isSessionBusy: () => boolean;
  readonly now?: () => number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

/**
 * Orquestrador central do domínio de contas. Estado em memória (a
 * persistência de `config` — mod ativo, política, conta ativa — é
 * responsabilidade de quem chama, via `accounts-config.ts`/ConfigStore).
 */
export class AccountEngine {
  private config: AccountsConfig;
  private readonly resolveModFn: (modId: ModId) => AccountMod;
  private readonly applySwitchFn: AccountEngineDeps['applySwitch'];
  private readonly isSessionBusy: () => boolean;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  private readonly mod: AccountMod | null;
  private state: AccountEngineState;
  private unavailableReason: 'offline' | 'unauthorized' | 'io' | null = null;
  private accounts: readonly import('../../shared/accounts').AccountSummary[] = [];
  private lastReadAt: string | null = null;
  private readonly listeners = new Set<(view: AccountsViewDto) => void>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: AccountEngineDeps) {
    this.config = deps.config;
    this.resolveModFn = deps.resolveMod;
    this.applySwitchFn = deps.applySwitch;
    this.isSessionBusy = deps.isSessionBusy;
    this.now = deps.now ?? Date.now;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

    // Estado inicial segue o diagrama do data-model.md §3: `mod === null` é
    // SEMPRE `inert`; qualquer mod configurado nasce `ready` até prova em
    // contrário (a primeira `listAccounts()` pode rebaixar para `unavailable`).
    this.mod = this.config.mod ? this.resolveModFn(this.config.mod) : null;
    this.state = this.mod ? 'ready' : 'inert';
  }

  getState(): AccountEngineState {
    return this.state;
  }

  getActiveAccountId(): AccountId | null {
    return this.config.activeAccountId;
  }

  getConfig(): AccountsConfig {
    return this.config;
  }

  /** Snapshot síncrono (sem I/O) — usado no caminho quente do spawn de PTY (main/index.ts), que não pode esperar um `listAccounts()` de rede. */
  getSnapshot(): AccountsViewDto {
    return this.buildView();
  }

  /**
   * Atualiza campos de config que NÃO mudam o mod (política de auto-switch,
   * `claudeHome`) sem reconstruir o motor inteiro — quem muda `mod` deve
   * instanciar um `AccountEngine` novo (main/index.ts `rebuildAccountEngine`),
   * porque só o construtor resolve o mod concreto.
   */
  updateConfig(config: AccountsConfig): void {
    this.config = config;
  }

  /** C3 — timer do processo vivo, NUNCA agendador de SO; morre com `dispose()`. Só arma se o mod implementar `keepAlive`. */
  start(): void {
    if (this.mod?.keepAlive) {
      this.keepAliveTimer = this.setIntervalFn(() => {
        void this.mod?.keepAlive?.();
      }, KEEP_ALIVE_INTERVAL_MS);
    }
  }

  /** C4 — poll de 5 min SÓ enquanto `hasLiveSession()` disser que há sessão `claude` viva; releitura sob demanda continua disponível via `listAccounts()` a qualquer momento. */
  startPolling(hasLiveSession: () => boolean): void {
    this.pollTimer = this.setIntervalFn(() => {
      if (!hasLiveSession()) return;
      void this.listAccounts().then(() => this.evaluateAutoSwitch());
    }, POLL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.keepAliveTimer) {
      this.clearIntervalFn(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.pollTimer) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }
  }

  onChanged(listener: (view: AccountsViewDto) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listAccounts(): Promise<AccountsViewDto> {
    if (!this.mod) {
      this.state = 'inert';
      return this.buildView();
    }

    const result = await this.mod.listAccounts();
    if (result.kind === 'unavailable') {
      this.state = 'unavailable';
      this.unavailableReason = result.reason;
    } else {
      this.state = 'ready';
      this.unavailableReason = null;
      this.accounts = result.accounts;
      this.lastReadAt = new Date(this.now()).toISOString();
    }
    this.emit();
    return this.buildView();
  }

  /**
   * Switch MANUAL (gesto do operador) — nunca adiado por sessão ocupada
   * (só o auto-switch adia, ver `evaluateAutoSwitch`). Motor `inert` falha
   * com `io` (regra do contracts/ipc-accounts.md — sem caminho implícito de
   * ativação).
   */
  async switchTo(id: AccountId): Promise<SwitchOutcome> {
    if (!this.mod) return { kind: 'failed', reason: 'io' };
    if (id === this.config.activeAccountId) return { kind: 'already-active', account: id };

    const switchResult = await this.mod.switchTo(id);
    if (switchResult.kind !== 'ok') {
      // `unknown-account` não existe no vocabulário de `SwitchOutcome`
      // (contracts/ipc-accounts.md) — mapeado para `io` (falha de leitura),
      // a categoria mais próxima entre as quatro expostas ao IPC.
      const reason = switchResult.reason === 'unknown-account' ? 'io' : switchResult.reason;
      return { kind: 'failed', reason };
    }

    const fromId = this.config.activeAccountId;
    const mod = this.mod;
    try {
      await this.applySwitchFn(switchResult.pair, async (rotatedPair) => {
        if (rotatedPair && fromId) await mod.captureRotatedPair(fromId, rotatedPair);
      });
    } catch {
      // Falha em qualquer passo da sequência invariante degrada sem
      // corromper o estado anterior (data-model.md §3: "falha em qualquer
      // passo -> indisponível" na leitura; no switch, especificamente, o
      // motor mantém a conta ativa ANTERIOR — nunca finge que trocou).
      return { kind: 'failed', reason: 'io' };
    }

    this.config = { ...this.config, activeAccountId: id };
    this.emit();
    return { kind: 'switched', from: fromId, to: id };
  }

  /**
   * C5 — avaliado nos momentos de leitura de carga (sob demanda + poll de 5
   * min). `null` = nada a fazer agora (desligado, motor não `ready`, ou
   * nenhuma candidata elegível). Sessão ocupada -> `deferred` SEM tentar o
   * switch (reavaliado no próximo ciclo, nunca um retry imediato).
   */
  async evaluateAutoSwitch(): Promise<SwitchOutcome | null> {
    if (!this.mod) return null;
    if (this.state !== 'ready') return null; // unavailable pausa o auto-switch (C9).
    if (!this.config.autoSwitch.enabled) return null;

    const target = selectSwitchTarget(this.accounts, this.config.activeAccountId, this.config.autoSwitch);
    if (!target) return null;

    if (this.isSessionBusy()) return { kind: 'deferred', reason: 'session-busy' };

    return this.switchTo(target);
  }

  private buildView(): AccountsViewDto {
    return {
      mod: this.config.mod,
      state: this.state,
      unavailableReason: this.unavailableReason,
      accounts: this.accounts.map((account) => ({ ...account, active: account.id === this.config.activeAccountId })),
      activeAccountId: this.config.activeAccountId,
      autoSwitch: this.config.autoSwitch,
      lastReadAt: this.lastReadAt,
    };
  }

  private emit(): void {
    const view = this.buildView();
    for (const listener of this.listeners) listener(view);
  }
}
