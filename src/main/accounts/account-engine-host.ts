// 011-contas-e-provedores, etapa 3, Fase 1 (F6) — dono do ciclo de vida do
// AccountEngine. Substitui o padrão anterior de index.ts
// (`rebuildAccountEngine()` chamado incondicionalmente a cada mudança de
// config, e `updateConfig()` chamado direto nos outros pontos, sem critério
// único): aqui um só método (`apply`) decide, via `needsEngineRebuild`
// (account-pool.ts), entre construir, reconstruir (dispose + createEngine) ou
// só atualizar — e index.ts nunca mais escolhe isso na mão.

import type { AccountEngine } from './account-engine';
import type { AccountsConfig } from '../../shared/accounts';
import { needsEngineRebuild } from './account-pool';

export interface AccountEngineHostDeps {
  /** index.ts injeta o corpo atual de `rebuildAccountEngine` (monta `AccountEngine`, liga `onChanged`, `start()`, `startPolling(...)`). */
  readonly createEngine: (config: AccountsConfig) => AccountEngine;
}

export type AccountEngineApplyResult = 'built' | 'rebuilt' | 'updated';

export class AccountEngineHost {
  private readonly createEngineFn: (config: AccountsConfig) => AccountEngine;
  private engine: AccountEngine | null = null;
  private lastAppliedConfig: AccountsConfig | null = null;

  constructor(deps: AccountEngineHostDeps) {
    this.createEngineFn = deps.createEngine;
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
      return 'built';
    }

    if (needsEngineRebuild(this.lastAppliedConfig, config)) {
      this.engine.dispose();
      this.engine = this.createEngineFn(config);
      this.lastAppliedConfig = config;
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
}
