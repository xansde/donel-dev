// T1118 (011-contas-e-provedores, etapa 1) — mod local (pool próprio),
// contracts/backends-http.md §B + D4 do plan.md: switch-time-only, SEM
// `keepAlive` (decisão fechada — sem heartbeat, sem agendador). No switch: se
// o par da conta que entra estiver vencido, tenta UM refresh HTTP de
// fallback e grava o resultado no cofre ANTES de usá-lo (refresh token de
// uso único: perder o par novo inutiliza a conta). Recusa do refresh ->
// `expired-credentials` (a UI pede re-login uma vez).
//
// 011-contas-e-provedores, etapa 3, Fase 2 (D4) — `token-refresh.ts` agora
// distingue `rejected` (recusa de verdade) de `unavailable` (rede/timeout —
// nunca dá pra saber se o servidor teria aceitado): só `rejected` vira
// `expired-credentials` aqui; `unavailable` vira `offline`, o mesmo `reason`
// que qualquer outra falha de rede do mod já usa.
//
// 011-contas-e-provedores, etapa 3, Fase 2 (D7/D9, adendo ao desenho) — o
// access token do CLI vence ~8h depois de emitido, e `listAccounts` lia a
// carga de TODA conta com o par do cofre. Dois furos: (1) o par da conta
// ATIVA no cofre fica velho assim que o CLI renova o de `~/.claude` por fora
// (o refresh token que o cofre guarda pra ela já foi consumido) — corrigido
// lendo a carga da ativa com o par VIVO (`getActiveAccountId`/
// `readLiveCredentialPair`, D7), NUNCA renovando-a pelo cofre; (2) o par de
// uma conta PARADA vence sem ninguém renovar, e carga desconhecida nunca é
// destino de auto-switch (C9) — corrigido em `ensureFreshPair` (D9): a
// leitura de carga renova o par vencido de uma conta parada com o MESMO
// protocolo do switch (refresh -> grava no cofre ANTES de usar ->
// `onPairRefreshed`), com no máximo UMA renovação em voo por conta (o
// refresh token é de uso único — leitura e troca simultâneas da mesma conta
// esperam a MESMA promessa, nunca disparam dois refresh).
//
// 011-contas-e-provedores, etapa 3, Fase 2 (revisão) — quatro furos achados
// numa revisão crítica: (R1) o mapa de renovação em voo vivia DENTRO de cada
// mod — o motor reconstrói o mod (F6) e o mod novo não enxergava a renovação
// que o antigo já tinha em andamento, abrindo espaço pra dois refresh com o
// MESMO token; `ensureFreshPair` agora roda inteiro dentro de um
// `RefreshCoordinator` (refresh-coordinator.ts) que pode ser COMPARTILHADO
// entre instâncias (index.ts injeta uma única). (R2) uma recusa (`rejected`)
// do refresh não é necessariamente recusa de verdade — se outro processo
// (outra instância do mod, o login "Reconectar", a captura do par rotacionado)
// renovou ou reconectou a conta ENQUANTO este refresh estava em voo, o cofre
// já tem um par novo; `ensureFreshPair` relê o cofre antes de concluir que é
// recusa de verdade. (R4) a gravação no cofre pode LANÇAR (erro de I/O real,
// vault.ts) em vez de devolver `vault-unavailable` — entra em try/catch,
// nunca propaga (o contrato do AccountMod exige nunca lançar). (R5) uma
// conta parada cujo par no cofre ainda É o par vivo do CLI (mesmo refresh
// token — ex.: credencial colada igual à ativa) NUNCA passa por
// `ensureFreshPair`: renovar consumiria um refresh token de uso único que o
// CLI pode gastar por fora a qualquer momento, matando o login dele.
// `listAccounts` lê o par vivo UMA vez por chamada e usa o access token dele
// pra essa conta, sem renovar e sem marcar.

import type { AccountId, AccountLoad, AccountSummary, LocalAccountMeta } from '../../../shared/accounts';
import type { AccountMod, CredentialPair, ListAccountsResult, SwitchToResult } from '../account-mod';
import { createRefreshCoordinator, type RefreshCoordinator } from '../refresh-coordinator';
import type { ReconnectRegistry } from '../reconnect-registry';
import { refreshCredentialPair, type RefreshResult } from '../token-refresh';
import { readAccountUsage, type HttpFetchLike, type UsageWindows } from '../usage-client';
import type { VaultLike, VaultWriteResult } from '../vault';

export interface LocalModDeps {
  /** Metadado NÃO sensível do pool local (config-store, chave `accounts.localAccounts`). */
  readonly accounts: readonly LocalAccountMeta[];
  readonly vault: VaultLike;
  /** HTTP do endpoint de usage (mod local só, `api.anthropic.com`). */
  readonly fetchImpl?: HttpFetchLike;
  /** Injetável para teste — default `refreshCredentialPair` (token-refresh.ts). */
  readonly refreshImpl?: (refreshToken: string, options?: { fetchImpl?: HttpFetchLike }) => Promise<RefreshResult>;
  /**
   * R1 (revisão) — coordenador de renovação COMPARTILHÁVEL entre instâncias
   * do mod (refresh-coordinator.ts). Ausente = um coordenador NOVO por mod
   * (comportamento de antes: só protege DENTRO da mesma instância — os
   * testes que criam `createLocalMod` sem esta dep continuam válidos).
   * index.ts injeta UMA instância de nível de módulo, compartilhada entre
   * toda reconstrução do mod (F6), pra nunca disparar dois refresh com o
   * MESMO refresh token quando o motor troca de mod no meio de uma renovação.
   */
  readonly refreshCoordinator?: RefreshCoordinator;
  /**
   * D7 (adendo) — id da conta ativa AGORA, segundo o motor. Sem esta dep (ou
   * devolvendo `null`), nenhuma conta é tratada como ativa aqui — todas
   * seguem o caminho de conta parada (D9). Nenhuma conta que não seja esta
   * usa o par vivo.
   */
  readonly getActiveAccountId?: () => AccountId | null;
  /**
   * D7 (adendo) — lê `<claudeHome>/.credentials.json` (só leitura, nunca
   * renova, nunca grava). Sem par vivo legível (dep ausente ou `null`), cai
   * no par do cofre — comportamento de hoje.
   */
  readonly readLiveCredentialPair?: () => CredentialPair | null;
  /**
   * D9 (adendo) — o MESMO registro do motor (account-engine.ts,
   * reconnect-registry.ts). Ausente = nenhuma conta é tratada como já
   * marcada (sempre tenta `ensureFreshPair`) e nenhuma marca é gravada.
   */
  readonly reconnectRegistry?: ReconnectRegistry;
  /** Injetável para teste — default `Date.now`. */
  readonly now?: () => number;
  /**
   * D9 (adendo) — chamado depois que o par renovado por `ensureFreshPair` foi
   * gravado no cofre com sucesso. NUNCA recebe o par — só o id e a origem
   * (`read` = veio de `listAccounts`, `switch` = veio de `switchTo`).
   */
  readonly onPairRefreshed?: (id: AccountId, trigger: 'read' | 'switch') => void;
  /**
   * fix/renovacao-credencial — chamado quando uma renovação feita por
   * `ensureFreshPair` NÃO deu certo, com o motivo. Antes só o sucesso ia pro
   * log de manutenção, e uma conta caindo em "Reconectar" não deixava rastro
   * nenhum de quando nem por quê. Nunca recebe o par — só id, origem e motivo.
   */
  readonly onPairRefreshFailed?: (id: AccountId, trigger: 'read' | 'switch', reason: 'rejected' | 'unavailable' | 'vault-write-failed') => void;
}

function parsePairFromVault(raw: string | null): CredentialPair | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CredentialPair>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((s): s is string => typeof s === 'string') : [],
    };
  } catch {
    return null;
  }
}

function loadFromUsage(usage: UsageWindows, atMs: number): AccountLoad {
  return { fiveHour: usage.fiveHour, sevenDay: usage.sevenDay, sonnet: null, readAt: new Date(atMs).toISOString() };
}

/** D9 (adendo) — resultado interno de `ensureFreshPair`. Nunca lança. */
type EnsureFreshPairResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair }
  | { readonly kind: 'missing' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'vault-write-failed' };

export function createLocalMod(deps: LocalModDeps): AccountMod {
  const refresh = deps.refreshImpl ?? refreshCredentialPair;
  const now = deps.now ?? Date.now;
  /**
   * R1 (revisão) — sem a dep, um coordenador NOVO por mod: continua só
   * protegendo dentro da mesma instância (o que o mapa `pendingRefreshes`
   * local fazia antes). Com a dep compartilhada por index.ts, protege
   * TAMBÉM entre reconstruções do motor (F6).
   */
  const coordinator = deps.refreshCoordinator ?? createRefreshCoordinator();

  function readPair(id: string): CredentialPair | null {
    return parsePairFromVault(deps.vault.read(id));
  }

  /**
   * D9 (adendo) — garante um par utilizável para `id`: lê o cofre; ausente ->
   * `missing`; ainda válido -> devolve como está; vencido -> UM refresh
   * (grava no cofre ANTES de devolver — uso único; falha de gravação ->
   * `vault-write-failed`; recusa/indisponibilidade do refresh passam
   * adiante). `trigger` só identifica quem pediu, para `onPairRefreshed` —
   * não muda o comportamento. Nunca lança.
   *
   * R1 (revisão) — roda INTEIRO dentro de `coordinator.run(id, ...)`: ler o
   * cofre, decidir, renovar e gravar são todos parte da MESMA tarefa
   * coordenada, então uma segunda chamada (mesmo de OUTRA instância do mod,
   * quando `refreshCoordinator` é compartilhado) que chega enquanto a
   * primeira ainda está em voo encontra a renovação já registrada e espera a
   * MESMA promessa — nunca dispara um segundo refresh com o mesmo token.
   */
  async function ensureFreshPair(id: AccountId, trigger: 'read' | 'switch'): Promise<EnsureFreshPairResult> {
    const result = await renewIfExpired(id, trigger);
    if (result.kind === 'rejected' || result.kind === 'unavailable' || result.kind === 'vault-write-failed') {
      deps.onPairRefreshFailed?.(id, trigger, result.kind);
    }
    return result;
  }

  function renewIfExpired(id: AccountId, trigger: 'read' | 'switch'): Promise<EnsureFreshPairResult> {
    return coordinator.run(id, async (): Promise<EnsureFreshPairResult> => {
      const pair = readPair(id);
      if (!pair) return { kind: 'missing' };
      if (pair.expiresAt > now()) return { kind: 'ok', pair };

      const result = await refresh(pair.refreshToken, { fetchImpl: deps.fetchImpl });
      if (result.kind !== 'ok') {
        if (result.reason !== 'rejected') return { kind: 'unavailable' };

        // R2 (revisão) — a recusa pode ser de um refresh token que já não é
        // mais o vigente: outro processo (outra instância do mod, o login
        // "Reconectar", a captura do par rotacionado pelo motor) pode ter
        // renovado ou reconectado esta conta ENQUANTO este refresh estava em
        // voo. Releia o cofre antes de concluir que é recusa de verdade — só
        // é `rejected` se o cofre ainda guarda o MESMO refresh token usado.
        const current = readPair(id);
        if (current && current.refreshToken === pair.refreshToken) return { kind: 'rejected' };
        if (current && current.expiresAt > now()) return { kind: 'ok', pair: current };
        return { kind: 'unavailable' };
      }

      // Uso único: grava no cofre ANTES de qualquer coisa usar o par novo.
      // R4 (revisão) — `deps.vault.write` pode LANÇAR (erro de I/O real em
      // `writeVaultFile`, vault.ts) em vez de devolver `vault-unavailable`;
      // `ensureFreshPair` nunca lança (contrato do AccountMod), então a
      // gravação entra em try/catch.
      let writeResult: VaultWriteResult;
      try {
        writeResult = deps.vault.write(id, JSON.stringify(result.pair));
      } catch {
        return { kind: 'vault-write-failed' };
      }
      if (writeResult.kind !== 'ok') return { kind: 'vault-write-failed' };

      deps.onPairRefreshed?.(id, trigger);
      return { kind: 'ok', pair: result.pair };
    });
  }

  return {
    id: 'local',

    /**
     * `active` sempre `false` — sobrescrito pelo motor. `available` = existe
     * par gravado no cofre para esta conta (mesmo vencido). Carga lida sob
     * demanda (C4), nunca lança (usage-client já absorve falha em `null`).
     *
     * D7/D9 (adendo): a conta ATIVA lê a carga com o par VIVO quando legível
     * — nunca renova pelo cofre (o refresh token dela lá já pode ter sido
     * consumido pelo CLI, e renovar daria recusa falsa). As demais contas
     * garantem um par fresco via `ensureFreshPair`, exceto as já marcadas no
     * registro de reconectar — essas leem com o par que houver, sem tentar
     * de novo a cada leitura.
     *
     * R5 (revisão): uma conta PARADA cujo par no cofre ainda É o par vivo do
     * CLI (mesmo `refreshToken` — ex.: credencial colada igual à ativa)
     * também nunca passa por `ensureFreshPair`, mesmo que não seja a ativa e
     * mesmo que já esteja marcada no registro de reconectar — renovar essa
     * conta consumiria um refresh token de uso único que o CLI pode gastar
     * por fora a qualquer momento, matando o login dele. O par vivo é lido
     * UMA vez por chamada (fora do loop) e reaproveitado pra essa comparação
     * em toda conta não ativa.
     */
    async listAccounts(): Promise<ListAccountsResult> {
      const activeId = deps.getActiveAccountId?.() ?? null;
      const livePair = deps.readLiveCredentialPair?.() ?? null;
      const accounts: AccountSummary[] = [];

      for (const meta of deps.accounts) {
        const vaultPair = readPair(meta.id);
        const available = vaultPair !== null;
        let load: AccountLoad | null = null;

        if (meta.id === activeId) {
          // D7 — nunca passa por ensureFreshPair: renovar a ativa pelo cofre
          // usaria um refresh token que o CLI já pode ter gasto por fora.
          const tokenPair = livePair ?? vaultPair;
          if (tokenPair) {
            const usage = await readAccountUsage(tokenPair.accessToken, { fetchImpl: deps.fetchImpl });
            if (usage) load = loadFromUsage(usage, now());
          }
        } else if (livePair && vaultPair && vaultPair.refreshToken === livePair.refreshToken) {
          // R5 — mesma família de refresh token do CLI vivo: nunca renova
          // (renovar mataria o login dele). Lê com o access token VIVO.
          const usage = await readAccountUsage(livePair.accessToken, { fetchImpl: deps.fetchImpl });
          if (usage) load = loadFromUsage(usage, now());
        } else if (deps.reconnectRegistry?.has(meta.id)) {
          // D9 — já marcada: não renova, lê com o par que houver (mesmo vencido).
          if (vaultPair) {
            const usage = await readAccountUsage(vaultPair.accessToken, { fetchImpl: deps.fetchImpl });
            if (usage) load = loadFromUsage(usage, now());
          }
        } else {
          const fresh = await ensureFreshPair(meta.id, 'read');
          if (fresh.kind === 'ok') {
            const usage = await readAccountUsage(fresh.pair.accessToken, { fetchImpl: deps.fetchImpl });
            if (usage) load = loadFromUsage(usage, now());
          } else if (fresh.kind === 'rejected') {
            deps.reconnectRegistry?.mark(meta.id);
          }
          // 'unavailable' / 'vault-write-failed' / 'missing': carga null, sem marca.
        }

        accounts.push({ id: meta.id, label: meta.label, plan: meta.plan, active: false, available, load });
      }
      return { kind: 'ok', accounts };
    },

    /**
     * D9 (adendo) — sempre garante um par fresco via `ensureFreshPair`,
     * inclusive para conta já marcada no registro: a troca MANUAL é o gesto
     * de tentar de novo.
     */
    async switchTo(id): Promise<SwitchToResult> {
      const meta = deps.accounts.find((a) => a.id === id);
      if (!meta) return { kind: 'failed', reason: 'unknown-account' };

      const fresh = await ensureFreshPair(id, 'switch');
      if (fresh.kind === 'ok') return { kind: 'ok', pair: fresh.pair };
      if (fresh.kind === 'missing') return { kind: 'failed', reason: 'unknown-account' };
      if (fresh.kind === 'rejected') return { kind: 'failed', reason: 'expired-credentials' };
      // 'unavailable' | 'vault-write-failed'
      return { kind: 'failed', reason: 'offline' };
    },

    /**
     * Grava o par rotacionado no cofre — a mesma escrita write-only de sempre,
     * nada sai daqui.
     *
     * fix/renovacao-credencial — antes o resultado da escrita era ignorado: com
     * o cofre recusando (`vault-unavailable`), a captura "dava certo" em
     * silêncio, o switch seguia, sobrescrevia `.credentials.json` e o único
     * lugar com o par vigente da conta que saía sumia — o cofre ficava com um
     * refresh token já gasto pelo CLI. Agora rejeita: no switch, a exceção
     * aborta a sequência invariante ANTES do passo 2 (claude-state.ts), e o
     * par segue vivo em disco. A gravação é SÍNCRONA dentro desta chamada
     * (nenhum `await` antes dela) — o encerramento do app depende disso.
     */
    async captureRotatedPair(id, pair): Promise<void> {
      const result = deps.vault.write(id, JSON.stringify(pair));
      if (result.kind !== 'ok') throw new Error('vault refused to store the rotated pair');
    },

    // SEM `keepAlive` — switch-time-only é decisão fechada (D4). O motor
    // testa a presença deste método antes de chamar (contracts/account-mod.md).
  };
}
