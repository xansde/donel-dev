// T1120/T1121 (011-contas-e-provedores, etapa 1) — o motor: compõe mod +
// claude-state + auto-switch + vault (via `applySwitch` injetado). Máquina de
// estados `inert`/`ready`/`unavailable` (data-model.md §3). Sequência do
// switch na ordem invariante (delegada a `applySwitch`, claude-state.ts:
// captura → escreve `.credentials.json` → apaga `oauthAccount`).
// `keepAlive` chamado a cada 15 min só se o mod implementar (C3); releitura
// de carga sob demanda + poll adaptativo com sessão viva (C4, `startPolling`
// — intervalo normal/agressivo decidido por `computePollIntervalMs`,
// auto-switch.ts, emenda 22/09 do item 3).
//
// 011-contas-e-provedores, etapa 3, Fase 2 — duas adições ortogonais:
// D3 (`reconnectRegistry`) marca uma conta quando a troca PARA ELA falha com
// `expired-credentials`, e decora `needsReconnect` nas contas expostas —
// `performSwitch` (privado) concentra a lógica de sucesso/falha que
// `switchTo` (manual) e `evaluateAutoSwitch` (auto) compartilham. D5
// (`lastAutoSwitch`/`autoSwitchState`) dá visibilidade à última decisão do
// auto-switch pro painel, sem esperar o próximo poll.
//
// 011-contas-e-provedores, etapa 3, Fase 2 (revisão) — R3: um motor
// DESCARTADO (`dispose()`, tipicamente por reconstrução do host — F6) pode
// estar no meio de uma leitura ou troca. Sem guarda, ele ainda troca de
// conta, grava em `~/.claude` e deixa o motor NOVO com a conta ativa velha —
// a próxima troca do motor novo capturaria o par vivo na conta ERRADA (mata
// a conta). `disposed` fecha isso: `performSwitch` falha (`io`) sem tocar o
// mod nem a config em memória, `evaluateAutoSwitch` devolve `null`, e
// `emit()` nunca mais notifica ouvinte nenhum.
//
// 011-contas-e-provedores, etapa 3, Fase 2, emenda 22/09 — decisão do dono:
// o adiamento por sessão ocupada (C5) foi REMOVIDO. Com sessões longas
// sempre há alguém "trabalhando", então a troca só acontecia depois do
// limite estourar de verdade — inútil (a Fase 0, e2e.md §3, já provou que
// uma sessão viva adota a conta nova na mensagem seguinte, então adiar não
// protegia nada). `evaluateAutoSwitch` troca na hora; `isSessionBusy`
// continua injetado, mas só para ANOTAR no log de manutenção se havia
// sessão ocupada no momento da troca — nunca mais para decidir SE troca.
// O risco de corrida (o CLI renovando `~/.claude/.credentials.json` no
// mesmo instante em que o motor grava a conta nova) foi aceito pelo dono
// COM acompanhamento: `scheduleRaceCheck` confere, ~30-60s depois de um
// switch bem-sucedido, se o par ainda é o que o motor escreveu.
//
// 011-contas-e-provedores, etapa 3, Fase 2, emenda 22/09 (REVISÃO) — a
// primeira versão desta checagem comparava só `refreshToken` e, ao divergir,
// reaplicava a troca. Falso positivo PERIGOSO: o CLI rotaciona o refresh
// token LEGITIMAMENTE ao renovar a conta ativa (ex.: access token vencido →
// renova na primeira mensagem, dentro da janela de 45s) — a checagem via
// isso como "sobrescrito" e reaplicava com o par do COFRE, cujo refresh
// token o CLI acabara de consumir, derrubando a conta pra "Reconectar" à
// toa (o gotcha do `CLAUDE.md`: "nunca renovar a ativa pelo cofre"). Corrigido:
// (1) a reaplicação foi REMOVIDA — a checagem só registra e avisa, nunca
// escreve; (2) divergência de TOKEN sozinha não basta — só é corrida de
// verdade se o par em disco for de OUTRA conta, decidido por IDENTIDADE
// (`readCurrentAccountFingerprint`, sha256 do `accountUuid` de
// `oauthAccount` em `~/.claude.json` — o MESMO mecanismo que
// `isolated-login.ts` já usa pra provar "é a mesma conta", não um endpoint
// de rede novo: mais barato, e a fonte que o próprio CLI mantém). Mesma
// identidade da conta-alvo = rotação legítima (`switch-pair-rotated`, sem
// aviso); identidade de outra conta = `switch-overwritten` (aviso); sem
// base de comparação confiável (fingerprint da conta-alvo desconhecido, ou
// `oauthAccount` ainda ausente — ele SOME do arquivo logo no passo 3 do
// switch, até o CLI re-fetch) = `switch-check-inconclusive`, nunca avisa.

import { classifyAutoSwitch, computePollIntervalMs, selectSwitchTarget } from './auto-switch';
import { createReconnectRegistry, type ReconnectRegistry } from './reconnect-registry';
import type { AccountMod, CredentialPair } from './account-mod';
import {
  overallLoad,
  type AccountId,
  type AccountsConfig,
  type AccountsViewDto,
  type AccountSummary,
  type AutoSwitchEvent,
  type ModId,
  type SwitchOutcome,
  type SwitchOverwrittenWarning,
} from '../../shared/accounts';

const KEEP_ALIVE_INTERVAL_MS = 15 * 60 * 1000;
/** Emenda 22/09 (item 5) — janela da checagem de corrida pós-switch; "~30-60s" do pedido do dono. */
const RACE_CHECK_DELAY_MS = 45 * 1000;

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
  /**
   * Leitura apenas do `session-semaphore-manager`; nunca escreve nele.
   * Emenda 22/09 (item 2) — não decide mais SE o auto-switch troca (esse
   * ramo foi removido); só alimenta o campo `sessionBusy` do evento gravado
   * em `accounts-maintenance.log` por `onAutoSwitchLogged`.
   */
  readonly isSessionBusy: () => boolean;
  readonly now?: () => number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  /** Emenda 22/09 (item 3/5) — timers do poll adaptativo e da checagem de corrida; default `setTimeout`/`clearTimeout` globais. */
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — registro em memória de
   * contas que precisam reconectar. Opcional (default: registro novo e
   * vazio) pra não quebrar quem já instancia o motor sem se importar com
   * isso; index.ts injeta UM registro compartilhado entre reconstruções do
   * motor (F6), senão um rebuild perderia toda marca pendente.
   */
  readonly reconnectRegistry?: ReconnectRegistry;
  /**
   * Emenda 22/09 (item 2) — chamado depois de CADA decisão de auto-switch
   * que troca ou tenta trocar (nunca quando não há alvo elegível — aí não
   * houve decisão nenhuma pra registrar). `sessionBusy` é só observabilidade
   * — não influencia mais a decisão. index.ts grava isto em
   * `accounts-maintenance.log` (evento `auto-switch`).
   */
  readonly onAutoSwitchLogged?: (entry: {
    readonly outcome: 'switched' | 'failed';
    readonly from: AccountId | null;
    readonly to: AccountId;
    readonly activeLoad: number | null;
    readonly targetLoad: number | null;
    readonly sessionBusy: boolean;
  }) => void;
  /**
   * Emenda 22/09 (item 5) — lê `~/.claude/.credentials.json` (só leitura,
   * nunca escreve) pra checagem de corrida pós-switch. Ausente = checagem
   * desligada (nenhum `scheduleRaceCheck` é armado).
   */
  readonly readCurrentPair?: () => CredentialPair | null;
  /**
   * Emenda 22/09 (revisão, item 5) — lê o fingerprint (sha256 do
   * `accountUuid`, `accountFingerprintFromClaudeJsonText`) do `oauthAccount`
   * ATUAL de `~/.claude.json`, só leitura. É o desempate entre "o CLI
   * renovou o token da própria conta nova" (legítimo) e "outro processo
   * sobrescreveu com outra conta" (corrida de verdade) — ver o parágrafo
   * "Revisão 22/09" no topo do arquivo. `null`/dep ausente = identidade
   * ilegível (o `oauthAccount` some do arquivo logo após o switch, passo 3
   * de `claude-state.ts`, até o CLI re-fetch); a checagem nunca avisa sem
   * essa leitura.
   */
  readonly readCurrentAccountFingerprint?: () => string | null;
  /** Emenda 22/09 (item 5) — chamado quando a checagem de corrida CONFIRMA (por identidade) que outra conta sobrescreveu; index.ts grava em `accounts-maintenance.log` (evento `switch-overwritten`) e a view expõe o aviso. */
  readonly onSwitchOverwritten?: (info: { readonly to: AccountId }) => void;
  /** Emenda 22/09 (revisão, item 5) — token divergiu mas a identidade bate com a PRÓPRIA conta-alvo (rotação legítima do CLI); opcional, log-only, nunca vira aviso na view. */
  readonly onSwitchPairRotated?: (info: { readonly to: AccountId }) => void;
  /** Emenda 22/09 (revisão, item 5) — token divergiu e não há base de comparação confiável (fingerprint da conta-alvo desconhecido, ou `.claude.json` ilegível/sem `oauthAccount` ainda); nunca vira aviso — evita falso positivo. */
  readonly onSwitchCheckInconclusive?: (info: { readonly to: AccountId }) => void;
  /** Emenda 22/09 (item 5) — injetável para teste; default `RACE_CHECK_DELAY_MS` (~45s, dentro da janela "~30-60s" pedida). */
  readonly raceCheckDelayMs?: number;
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
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly reconnectRegistry: ReconnectRegistry;
  private readonly onAutoSwitchLogged: AccountEngineDeps['onAutoSwitchLogged'];
  private readonly readCurrentPair: AccountEngineDeps['readCurrentPair'];
  private readonly readCurrentAccountFingerprint: AccountEngineDeps['readCurrentAccountFingerprint'];
  private readonly onSwitchOverwritten: AccountEngineDeps['onSwitchOverwritten'];
  private readonly onSwitchPairRotated: AccountEngineDeps['onSwitchPairRotated'];
  private readonly onSwitchCheckInconclusive: AccountEngineDeps['onSwitchCheckInconclusive'];
  private readonly raceCheckDelayMs: number;

  private readonly mod: AccountMod | null;
  private state: AccountEngineState;
  private unavailableReason: 'offline' | 'unauthorized' | 'io' | null = null;
  private accounts: readonly AccountSummary[] = [];
  private lastReadAt: string | null = null;
  private readonly listeners = new Set<(view: AccountsViewDto) => void>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Emenda 22/09 (item 5) — timer da checagem de corrida pós-switch; cancelado por `dispose()` e reagendado a cada switch bem-sucedido novo. */
  private raceCheckTimer: ReturnType<typeof setTimeout> | null = null;
  /** D5 — última decisão do auto-switch NESTE motor; em memória de propósito (some ao reconstruir o motor ou reiniciar o app). */
  private lastAutoSwitch: AutoSwitchEvent | null = null;
  /** Emenda 22/09 (item 5) — última corrida detectada; `null` = nenhuma. Mesma régua de `lastAutoSwitch`. */
  private lastSwitchOverwritten: SwitchOverwrittenWarning | null = null;
  /** R3 (revisão) — `true` depois de `dispose()`. Ver o parágrafo no topo do arquivo. */
  private disposed = false;

  constructor(deps: AccountEngineDeps) {
    this.config = deps.config;
    this.resolveModFn = deps.resolveMod;
    this.applySwitchFn = deps.applySwitch;
    this.isSessionBusy = deps.isSessionBusy;
    this.now = deps.now ?? Date.now;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    this.reconnectRegistry = deps.reconnectRegistry ?? createReconnectRegistry();
    this.onAutoSwitchLogged = deps.onAutoSwitchLogged;
    this.readCurrentPair = deps.readCurrentPair;
    this.readCurrentAccountFingerprint = deps.readCurrentAccountFingerprint;
    this.onSwitchOverwritten = deps.onSwitchOverwritten;
    this.onSwitchPairRotated = deps.onSwitchPairRotated;
    this.onSwitchCheckInconclusive = deps.onSwitchCheckInconclusive;
    this.raceCheckDelayMs = deps.raceCheckDelayMs ?? RACE_CHECK_DELAY_MS;

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

  /**
   * C4 — poll SÓ enquanto `hasLiveSession()` disser que há sessão `claude`
   * viva; releitura sob demanda continua disponível via `listAccounts()` a
   * qualquer momento. Emenda 22/09 (item 3) — adaptativo via `setTimeout`
   * recursivo (não `setInterval` fixo): cada tick reagenda o PRÓXIMO com
   * `computePollIntervalMs` (auto-switch.ts), lido da carga da conta ATIVA
   * conhecida agora — 1 min perto do limite (>= `HIGH_LOAD_POLL_THRESHOLD`),
   * 5 min caso contrário (ou carga desconhecida).
   */
  startPolling(hasLiveSession: () => boolean): void {
    // O callback é `async` DIRETO (sem IIFE por dentro) de propósito: testes
    // capturam a função passada a `setTimeoutFn` e a `await`am pra esperar o
    // tick inteiro (listAccounts + evaluateAutoSwitch + reagendamento) antes
    // de fazer asserções — um wrapper `void (async () => ...)()` devolveria
    // uma função síncrona e quebraria esse await.
    const scheduleNext = (): void => {
      if (this.disposed) return;
      const activeLoad = overallLoad(this.accounts.find((a) => a.id === this.config.activeAccountId)?.load ?? null);
      this.pollTimer = this.setTimeoutFn(async () => {
        if (hasLiveSession()) {
          await this.listAccounts();
          await this.evaluateAutoSwitch();
        }
        scheduleNext();
      }, computePollIntervalMs(activeLoad));
    };
    scheduleNext();
  }

  dispose(): void {
    // R3 (revisão) — marca ANTES de mexer nos timers: qualquer leitura/troca
    // já em voo neste motor vê `disposed` assim que checar, mesmo que este
    // método não espere ela terminar.
    this.disposed = true;
    if (this.keepAliveTimer) {
      this.clearIntervalFn(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.pollTimer) {
      this.clearTimeoutFn(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.raceCheckTimer) {
      this.clearTimeoutFn(this.raceCheckTimer);
      this.raceCheckTimer = null;
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
   * Switch MANUAL (gesto do operador). Delega a `performSwitch` (D3/D5) com
   * `origin: 'manual'` — o gesto em si não muda. Emenda 22/09: desde a
   * remoção do adiamento por sessão ocupada (item 2), manual e auto se
   * comportam igual nesse quesito — nenhum dos dois espera sessão nenhuma.
   */
  async switchTo(id: AccountId): Promise<SwitchOutcome> {
    return this.performSwitch(id, 'manual');
  }

  /**
   * Avaliado nos momentos de leitura de carga (sob demanda + poll
   * adaptativo) e no gatilho imediato de `StopFailure` (item 4, index.ts).
   * `null` = nada a fazer agora (desligado, motor não `ready`, ou nenhuma
   * candidata elegível).
   *
   * Emenda 22/09 (item 2) — o antigo adiamento por sessão ocupada (C5) foi
   * REMOVIDO: troca na hora, mesmo com sessão `working`. `isSessionBusy()`
   * ainda é lido aqui, mas só para anotar `sessionBusy` no evento gravado em
   * `accounts-maintenance.log` via `onAutoSwitchLogged` — nunca mais decide
   * SE troca.
   */
  async evaluateAutoSwitch(): Promise<SwitchOutcome | null> {
    // R3 (revisão) — motor descartado nunca avalia nem toca o mod.
    if (this.disposed) return null;
    if (!this.mod || this.state !== 'ready' || !this.config.autoSwitch.enabled) return null;

    const accounts = this.decoratedAccounts();
    const target = selectSwitchTarget(accounts, this.config.activeAccountId, this.config.autoSwitch);
    if (!target) return null;

    const sessionBusy = this.isSessionBusy();
    const fromId = this.config.activeAccountId;
    const activeLoad = overallLoad(accounts.find((a) => a.id === fromId)?.load ?? null);
    const targetLoad = overallLoad(accounts.find((a) => a.id === target)?.load ?? null);

    const outcome = await this.performSwitch(target, 'auto');

    if (outcome.kind === 'switched' || outcome.kind === 'failed') {
      this.onAutoSwitchLogged?.({ outcome: outcome.kind, from: fromId, to: target, activeLoad, targetLoad, sessionBusy });
    }

    return outcome;
  }

  /**
   * D3/D5 — gesto de troca de fato, compartilhado por `switchTo` (manual) e
   * `evaluateAutoSwitch` (auto). `origin` só decide se marca `lastAutoSwitch`
   * (só o auto registra `switched`/`failed`) — o resultado devolvido ao
   * chamador é o mesmo `SwitchOutcome` de sempre. Emenda 22/09 (item 5) — um
   * switch bem-sucedido, de QUALQUER origem, arma a checagem de corrida
   * (`scheduleRaceCheck`).
   */
  private async performSwitch(id: AccountId, origin: 'manual' | 'auto'): Promise<SwitchOutcome> {
    // R3 (revisão) — descartado na entrada: falha sem tocar o mod nem a
    // config em memória (cobre um `switchTo` manual chamado depois do
    // `dispose()`; o caminho auto já é barrado antes, em `evaluateAutoSwitch`).
    if (this.disposed) return { kind: 'failed', reason: 'io' };
    if (!this.mod) return { kind: 'failed', reason: 'io' };
    if (id === this.config.activeAccountId) return { kind: 'already-active', account: id };

    const switchResult = await this.mod.switchTo(id);

    // R3 (revisão) — descartado ENQUANTO `mod.switchTo` estava em voo (a
    // reconstrução do host não espera troca nenhuma terminar). O mod já
    // persistiu no cofre, por conta própria, qualquer par renovado — nada se
    // perde; só não deixamos ESTE motor aplicar nada em `~/.claude` nem mudar
    // a conta ativa dele em memória (quem faz isso agora é o motor novo).
    if (this.disposed) return { kind: 'failed', reason: 'io' };

    if (switchResult.kind !== 'ok') {
      // `unknown-account` não existe no vocabulário de `SwitchOutcome`
      // (contracts/ipc-accounts.md) — mapeado para `io` (falha de leitura),
      // a categoria mais próxima entre as quatro expostas ao IPC.
      const reason = switchResult.reason === 'unknown-account' ? 'io' : switchResult.reason;
      let changed = false;
      if (reason === 'expired-credentials' && !this.reconnectRegistry.has(id)) {
        this.reconnectRegistry.mark(id); // D3 — a UI oferece "Reconectar" pra esta conta a partir de agora.
        changed = true;
      }
      if (origin === 'auto') {
        this.lastAutoSwitch = { kind: 'failed', to: id, reason, at: this.nowIso() };
        changed = true;
      }
      if (changed) this.emit();
      return { kind: 'failed', reason };
    }

    const fromId = this.config.activeAccountId;
    const mod = this.mod;
    try {
      await this.applySwitchFn(switchResult.pair, async (rotatedPair) => {
        if (rotatedPair && fromId) await mod.captureRotatedPair(fromId, rotatedPair);
        // R3 (revisão) — descartado ENQUANTO a captura estava em voo: lança
        // pra abortar a sequência invariante (claude-state.ts) ANTES do
        // passo 2 (escrita de `.credentials.json`) — nada é escrito. O catch
        // logo abaixo devolve failed/io, igual a qualquer outra falha nesta
        // sequência.
        if (this.disposed) throw new Error('account engine disposed during rotated pair capture');
      });
    } catch {
      // Falha em qualquer passo da sequência invariante degrada sem
      // corromper o estado anterior (data-model.md §3: "falha em qualquer
      // passo -> indisponível" na leitura; no switch, especificamente, o
      // motor mantém a conta ativa ANTERIOR — nunca finge que trocou).
      if (origin === 'auto') {
        this.lastAutoSwitch = { kind: 'failed', to: id, reason: 'io', at: this.nowIso() };
        this.emit();
      }
      return { kind: 'failed', reason: 'io' };
    }

    this.config = { ...this.config, activeAccountId: id };
    this.reconnectRegistry.clear(id); // D3 — trocar pra ela com sucesso prova que a credencial está boa de novo.
    if (origin === 'auto') {
      this.lastAutoSwitch = { kind: 'switched', from: fromId, to: id, at: this.nowIso() };
    }
    // Emenda 22/09 (item 5) — um switch novo (bem-sucedido) sempre limpa um
    // aviso de corrida anterior: ele descrevia a troca ANTERIOR, não esta.
    this.lastSwitchOverwritten = null;
    this.scheduleRaceCheck(id, switchResult.pair.refreshToken);
    this.emit();
    return { kind: 'switched', from: fromId, to: id };
  }

  /**
   * Emenda 22/09 (item 5) — agenda, ~30-60s depois de um switch
   * bem-sucedido, uma checagem ÚNICA (nunca repetida — ver a revisão no topo
   * do arquivo: esta checagem NUNCA escreve, só observa). Sem `readCurrentPair`
   * (dep ausente), a checagem fica desligada.
   */
  private scheduleRaceCheck(id: AccountId, writtenRefreshToken: string): void {
    if (this.raceCheckTimer) {
      this.clearTimeoutFn(this.raceCheckTimer);
      this.raceCheckTimer = null;
    }
    if (!this.readCurrentPair) return;

    this.raceCheckTimer = this.setTimeoutFn(async () => {
      this.raceCheckTimer = null;
      await this.performRaceCheck(id, writtenRefreshToken);
    }, this.raceCheckDelayMs);
  }

  /**
   * Emenda 22/09 (revisão, item 5) — SÓ observa, nunca escreve. Token igual
   * ao escrito: sem corrida, sem leitura extra. Token diferente: o
   * DESEMPATE é por identidade (`readCurrentAccountFingerprint`), nunca por
   * token sozinho — o CLI rotaciona o token da PRÓPRIA conta legitimamente
   * (ver o parágrafo "revisão" no topo do arquivo), e tratar isso como
   * corrida foi o bug que esta revisão corrige.
   */
  private async performRaceCheck(id: AccountId, writtenRefreshToken: string): Promise<void> {
    if (this.disposed || !this.readCurrentPair) return;

    const current = this.readCurrentPair();
    if (current?.refreshToken === writtenRefreshToken) return; // token bate — sem corrida, sem leitura extra.

    const expectedFingerprint = this.config.localAccounts.find((a) => a.id === id)?.fingerprint;
    const currentFingerprint = this.readCurrentAccountFingerprint?.() ?? null;

    if (!expectedFingerprint || currentFingerprint === null) {
      // Sem base de comparação confiável (conta-alvo sem fingerprint
      // conhecido, ou `oauthAccount` ainda ausente/ilegível em
      // `~/.claude.json`) — nunca avisa. Falso negativo é aceitável aqui;
      // falso positivo (que a reaplicação da versão anterior causava) não é.
      this.onSwitchCheckInconclusive?.({ to: id });
      return;
    }

    if (currentFingerprint === expectedFingerprint) {
      this.onSwitchPairRotated?.({ to: id }); // mesma conta — o CLI renovou o token dela; legítimo, sem aviso.
      return;
    }

    // Identidade de OUTRA conta confirmada — corrida de verdade.
    this.lastSwitchOverwritten = { to: id, at: this.nowIso() };
    this.onSwitchOverwritten?.({ to: id });
    this.emit();
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  /**
   * D3 — as mesmas contas decoradas que `buildView()` expõe (com `active` e
   * `needsReconnect`), reaproveitadas na avaliação do auto-switch pra uma
   * conta marcada nunca ser alvo. `needsReconnect` só aparece quando `true`
   * (chave ausente caso contrário) — os testes que comparam `AccountSummary`
   * com `toEqual` já existiam antes desta fase.
   */
  private decoratedAccounts(): readonly AccountSummary[] {
    return this.accounts.map((account) => ({
      ...account,
      active: account.id === this.config.activeAccountId,
      ...(this.reconnectRegistry.has(account.id) ? { needsReconnect: true as const } : {}),
    }));
  }

  private buildView(): AccountsViewDto {
    const decorated = this.decoratedAccounts();
    const autoSwitchState = !this.mod || this.state !== 'ready' ? 'idle' : classifyAutoSwitch(decorated, this.config.activeAccountId, this.config.autoSwitch);
    return {
      mod: this.config.mod,
      state: this.state,
      unavailableReason: this.unavailableReason,
      accounts: decorated,
      activeAccountId: this.config.activeAccountId,
      autoSwitch: this.config.autoSwitch,
      lastReadAt: this.lastReadAt,
      autoSwitchState,
      lastAutoSwitch: this.lastAutoSwitch,
      lastSwitchOverwritten: this.lastSwitchOverwritten,
    };
  }

  private emit(): void {
    // R3 (revisão) — motor descartado nunca notifica ouvinte nenhum (nem
    // view velha pro renderer, nem pro host) — uma leitura/troca dele pode
    // terminar tarde, depois que o host já trocou pra um motor novo.
    if (this.disposed) return;
    const view = this.buildView();
    for (const listener of this.listeners) listener(view);
  }
}
