// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — dono do ciclo de vida do
// AccountEngine. Substitui o padrão anterior de index.ts
// (`rebuildAccountEngine()` chamado incondicionalmente a cada mudança de
// config, e `updateConfig()` chamado direto nos outros pontos, sem critério
// único): aqui um só método (`apply`) decide, via `needsEngineRebuild`
// (account-pool.ts), entre construir, reconstruir (dispose + createEngine) ou
// só atualizar — e index.ts nunca mais escolhe isso na mão.

import type { AccountEngine } from './account-engine';
import type { AccountId, AccountsConfig } from '../../shared/accounts';
import { needsEngineRebuild } from './account-pool';

export interface AccountEngineHostDeps {
  /** index.ts injeta o corpo atual de `rebuildAccountEngine` (monta `AccountEngine`, liga `onChanged`, `start()`, `startPolling(...)`). */
  readonly createEngine: (config: AccountsConfig) => AccountEngine;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1 (Bloco 0) — uma troca decidida
   * pelo PRÓPRIO motor (`evaluateAutoSwitch` -> `switchTo`) muda só a config
   * em memória do `AccountEngine`; sem este retorno, `appConfig.accounts`
   * (index.ts) fica com a conta ativa VELHA, e uma reconstrução subsequente
   * (add/remove conta) renasceria o motor a partir dela — a próxima troca
   * capturaria o par rotacionado na conta ERRADA (mata uma conta). Chamado
   * com o id novo (`null` incluso) toda vez que o motor muda de conta ativa
   * por um caminho que não passou por `apply()`.
   */
  readonly onActiveAccountChanged?: (id: AccountId | null) => void;
}

export type AccountEngineApplyResult = 'built' | 'rebuilt' | 'updated';

export class AccountEngineHost {
  private readonly createEngineFn: (config: AccountsConfig) => AccountEngine;
  private readonly onActiveAccountChangedFn: ((id: AccountId | null) => void) | undefined;
  private engine: AccountEngine | null = null;
  private lastAppliedConfig: AccountsConfig | null = null;

  constructor(deps: AccountEngineHostDeps) {
    this.createEngineFn = deps.createEngine;
    this.onActiveAccountChangedFn = deps.onActiveAccountChanged;
  }

  current(): AccountEngine | null {
    return this.engine;
  }

  /**
   * 1ª chamada sempre constrói (`built`). Nas seguintes: reconstrói
   * (`rebuilt`) quando `needsEngineRebuild` acusa mudança de mod/baseUrl/
   * lista de contas — senão só `updateConfig` (`updated`), preservando a
   * instância (e os timers/listeners já armados nela).
   */
  apply(config: AccountsConfig): AccountEngineApplyResult {
    if (!this.engine || !this.lastAppliedConfig) {
      this.engine = this.createEngineFn(config);
      this.lastAppliedConfig = config;
      this.trackActiveAccount(this.engine);
      return 'built';
    }

    if (needsEngineRebuild(this.lastAppliedConfig, config)) {
      this.engine.dispose();
      this.engine = this.createEngineFn(config);
      this.lastAppliedConfig = config;
      this.trackActiveAccount(this.engine);
      return 'rebuilt';
    }

    this.engine.updateConfig(config);
    this.lastAppliedConfig = config;
    return 'updated';
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
    this.lastAppliedConfig = null;
  }

  /**
   * Assina `engine.onChanged` (aditivo — `onChanged` aceita vários ouvintes;
   * `createEngine` já liga o seu próprio, ex.: `broadcastAccountsChanged`).
   * Compara `view.activeAccountId` contra a ÚLTIMA config aplicada: se
   * diferente, atualiza essa referência (pra não disparar de novo à toa) e
   * chama a dep. `listAccounts()` também emite via `onChanged`, mas só muda
   * `accounts`/`lastReadAt` — nunca `activeAccountId` — então não dispara.
   */
  private trackActiveAccount(engine: AccountEngine): void {
    const onActiveAccountChanged = this.onActiveAccountChangedFn;
    if (!onActiveAccountChanged) return;

    engine.onChanged((view) => {
      if (!this.lastAppliedConfig || view.activeAccountId === this.lastAppliedConfig.activeAccountId) return;
      this.lastAppliedConfig = { ...this.lastAppliedConfig, activeAccountId: view.activeAccountId };
      onActiveAccountChanged(view.activeAccountId);
    });
  }
}
