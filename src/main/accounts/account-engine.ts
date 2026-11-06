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

import { classifyAutoSwitch, computePollIntervalMs, restrictPoolToPreferred, selectAutoSwitchTarget } from './auto-switch';
import { createReconnectRegistry, type ReconnectRegistry } from './reconnect-registry';
import type { AccountMod, CredentialPair } from './account-mod';
import type { AdoptRefreshedPairResult } from './claude-state';
import { isPoolAccountId } from './pool-account-id';
import type { RemoteClaudeState } from './remote-claude-state';
import {
  overallLoad,
  type AccountId,
  type AccountsConfig,
  type AccountsViewDto,
  type AccountSummary,
  type AutoSwitchEvent,
  type ModId,
  type RemotePlace,
  type RemotePlaceView,
  type RemoteSwitchOutcome,
  type SwitchOutcome,
  type SwitchOverwrittenWarning,
} from '../../shared/accounts';

/**
 * Lugares remotos — o que o motor registra em `accounts-maintenance.log` sobre
 * eles. Só ids e motivos, nunca o par.
 */
export type RemotePlaceLogEvent =
  | { readonly event: 'remote-switch'; readonly place: string; readonly origin: 'manual' | 'auto'; readonly outcome: RemoteSwitchOutcome['kind']; readonly from: AccountId | null; readonly to: AccountId | null; readonly reason?: string }
  | { readonly event: 'remote-pair-captured'; readonly place: string; readonly account: AccountId; readonly trigger: 'switch' | 'sync' }
  | { readonly event: 'remote-write-uncertain'; readonly place: string; readonly account: AccountId | null }
  | { readonly event: 'remote-blind-as-full'; readonly place: string; readonly account: AccountId; readonly blindForMs: number };

/**
 * Carga desconhecida da conta de um lugar por este tempo (o par copiado de lá
 * venceu e ninguém o renova) passa a contar como cheia para a troca automática
 * daquele lugar. Só troca se houver candidata com carga conhecida.
 */
export const REMOTE_BLIND_AS_FULL_AFTER_MS = 10 * 60 * 1000;

const KEEP_ALIVE_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Pool Seazone (patch local v3) — a posse de uma conta no switcher dura 20 min
 * (`HINT_GRACE_SECONDS`) e só o switch e o heartbeat a renovam. 5 min deixa
 * folga para perder ciclos inteiros (rede, app suspenso) sem a conta voltar
 * ao pool com a sessão ainda nela. O primeiro ciclo sai logo depois do
 * `start()`: um app reaberto com conta do pool ativa renova a posse já.
 */
const POOL_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const POOL_HEARTBEAT_FIRST_DELAY_MS = 10 * 1000;

/** Pool Seazone (patch local v3) — o que o heartbeat registra em `accounts-maintenance.log`. Só ids e motivos, nunca o par. */
export type PoolHeartbeatLogEvent =
  | { readonly event: 'pool-pair-adopted'; readonly account: AccountId }
  | { readonly event: 'pool-heartbeat-failed'; readonly account: AccountId; readonly reason: 'offline' | 'unauthorized' | 'conflict' | 'io' }
  | { readonly event: 'pool-account-lost'; readonly account: AccountId; readonly outcome: 'switched'; readonly to: AccountId }
  | { readonly event: 'pool-account-lost'; readonly account: AccountId; readonly outcome: 'failed' };
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
  /**
   * fix/renovacao-credencial — chamado depois que o par em disco foi guardado
   * no cofre de uma conta: no switch (`switch`), na leitura de carga (`sync`)
   * ou no encerramento do app (`quit`). `believedActive` é a conta que o motor
   * achava ativa; diferente de `account` = a crença estava velha e a
   * identidade em disco decidiu. Nunca recebe o par. index.ts grava em
   * `accounts-maintenance.log`.
   */
  readonly onLivePairCaptured?: (info: { readonly account: AccountId; readonly trigger: 'switch' | 'sync' | 'quit'; readonly believedActive: AccountId | null }) => void;
  /**
   * Pool Seazone (patch local v3) — adota em `.credentials.json` o par mais
   * novo que o switcher devolveu no heartbeat (claude-state.ts
   * `adoptRefreshedActivePair`: só escreve se o disco ainda tiver `expected`).
   * Ausente = o par devolvido nunca é adotado (o heartbeat ainda renova a posse).
   */
  readonly writeRefreshedActivePair?: (expected: CredentialPair, next: CredentialPair) => AdoptRefreshedPairResult;
  /** Pool Seazone (patch local v3) — index.ts grava em `accounts-maintenance.log`. Nunca recebe o par. */
  readonly onPoolHeartbeatEvent?: (event: PoolHeartbeatLogEvent) => void;
  /**
   * Lugares remotos — leitura e escrita do `~/.claude` de cada lugar por ssh
   * (remote-claude-state.ts). Ausente = lugares remotos desligados: o motor
   * ignora `config.remotes` para ler e trocar (mas uma conta marcada como
   * ativa num lugar continua fora do alcance desta máquina).
   */
  readonly remoteState?: RemoteClaudeState;
  /** Chamado com a lista nova sempre que a conta de um lugar muda — index.ts persiste em `config.json`. */
  readonly onRemotesChanged?: (remotes: readonly RemotePlace[]) => void;
  /** index.ts grava em `accounts-maintenance.log`. Nunca recebe o par. */
  readonly onRemoteEvent?: (event: RemotePlaceLogEvent) => void;
  /** Injetável para teste — default `REMOTE_BLIND_AS_FULL_AFTER_MS`. */
  readonly remoteBlindAsFullAfterMs?: number;
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
  private readonly onLivePairCaptured: AccountEngineDeps['onLivePairCaptured'];
  private readonly writeRefreshedActivePair: AccountEngineDeps['writeRefreshedActivePair'];
  private readonly onPoolHeartbeatEvent: AccountEngineDeps['onPoolHeartbeatEvent'];
  private readonly remoteState: RemoteClaudeState | null;
  private readonly onRemotesChanged: AccountEngineDeps['onRemotesChanged'];
  private readonly onRemoteEvent: AccountEngineDeps['onRemoteEvent'];
  private readonly remoteBlindAsFullAfterMs: number;
  /** Desde quando a carga da conta de cada lugar está desconhecida, por lugar. Em memória. */
  private readonly remoteBlindSince = new Map<string, { readonly account: AccountId; readonly since: number; logged: boolean }>();
  /** Último resultado de ssh por lugar, para o painel. Em memória. */
  private readonly remoteReach = new Map<string, 'ok' | 'unreachable'>();
  /** Último refresh token guardado no cofre a partir de cada lugar, por conta (mesma régua de `lastCapturedRefreshToken`). */
  private readonly lastRemoteCapturedRefreshToken = new Map<AccountId, string>();
  /**
   * Escrita remota cujo desfecho não se sabe (o ssh caiu depois de mandar o
   * par). Enquanto existir, um par sem prova de identidade igual a este
   * refresh token é da conta que ia entrar, não da que estava.
   */
  private readonly uncertainRemoteWrites = new Map<string, { readonly account: AccountId | null; readonly refreshToken: string | null }>();
  /** Uma troca de cada vez, desta máquina ou de lugar remoto: as duas olham "quem está onde" antes de agir. */
  private switchQueue: Promise<unknown> = Promise.resolve();
  private poolHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  /** Último motivo de falha do heartbeat já registrado; a mesma falha repetida não enche o log. `null` depois de um ciclo bom. */
  private lastPoolHeartbeatFailure: string | null = null;
  /**
   * fix/renovacao-credencial — último refresh token guardado no cofre, por
   * conta, por ESTE motor. Só evita regravar o mesmo par a cada leitura; em
   * memória de propósito (um motor novo regrava uma vez, inofensivo). Guarda
   * só o refresh token, nunca sai daqui.
   */
  private readonly lastCapturedRefreshToken = new Map<AccountId, string>();

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
    this.onLivePairCaptured = deps.onLivePairCaptured;
    this.writeRefreshedActivePair = deps.writeRefreshedActivePair;
    this.onPoolHeartbeatEvent = deps.onPoolHeartbeatEvent;
    this.remoteState = deps.remoteState ?? null;
    this.onRemotesChanged = deps.onRemotesChanged;
    this.onRemoteEvent = deps.onRemoteEvent;
    this.remoteBlindAsFullAfterMs = deps.remoteBlindAsFullAfterMs ?? REMOTE_BLIND_AS_FULL_AFTER_MS;

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
    if (this.mod?.syncActivePair) this.schedulePoolHeartbeat(POOL_HEARTBEAT_FIRST_DELAY_MS);
  }

  /**
   * Pool Seazone (patch local v3) — `setTimeout` recursivo, como o poll: o
   * callback é `async` direto (os testes o `await`am) e reagenda o próximo
   * ciclo só depois de terminar, então dois heartbeats nunca se sobrepõem.
   * Fica armado com conta local ativa: a ativa pode virar do pool depois.
   */
  private schedulePoolHeartbeat(delayMs: number): void {
    if (this.disposed) return;
    this.poolHeartbeatTimer = this.setTimeoutFn(async () => {
      this.poolHeartbeatTimer = null;
      try {
        await this.runPoolHeartbeat();
      } catch {
        // Nunca derruba o timer; o próximo ciclo tenta de novo.
      }
      this.schedulePoolHeartbeat(POOL_HEARTBEAT_INTERVAL_MS);
    }, delayMs);
  }

  /**
   * Pool Seazone (patch local v3) — um ciclo do heartbeat, igual ao do
   * cliente oficial: manda ao switcher o par VIVO de `.credentials.json` (o
   * que o CLI renova) com o label real da conta ativa. Isso renova a posse
   * (20 min) e põe no pool o par que o CLI rotacionou. A resposta é o par que
   * o servidor tem: mais novo (o monitor dele renovou) é adotado em disco; 403
   * = a conta não é mais nossa e a sessão sai dela na hora
   * (`leaveLostPoolAccount`); o resto é transitório e só fica no log.
   *
   * Não manda nada se a ativa for local, ou se a identidade em disco provar
   * que o par é de uma conta local (o token pessoal nunca vai ao switcher).
   * Não precisa rodar logo depois de um switch para o pool: o próprio switch
   * renova a posse.
   */
  async runPoolHeartbeat(): Promise<void> {
    if (this.disposed || !this.mod?.syncActivePair || !this.readCurrentPair) return;
    const active = this.config.activeAccountId;
    if (!active || !isPoolAccountId(active)) return;
    if (this.resolveLivePairOwner(active, false) !== active) return;
    const live = this.readCurrentPair();
    if (!live) return;

    const result = await this.mod.syncActivePair(active, live);
    // Descartado, ou a ativa mudou enquanto o heartbeat estava em voo: a resposta descreve uma conta que já saiu.
    if (this.disposed || this.config.activeAccountId !== active) return;

    switch (result.kind) {
      case 'skipped':
        return;
      case 'failed':
        if (this.lastPoolHeartbeatFailure !== result.reason) {
          this.lastPoolHeartbeatFailure = result.reason;
          this.onPoolHeartbeatEvent?.({ event: 'pool-heartbeat-failed', account: active, reason: result.reason });
        }
        return;
      case 'lost':
        this.lastPoolHeartbeatFailure = null;
        await this.leaveLostPoolAccount(active);
        return;
      case 'ok': {
        this.lastPoolHeartbeatFailure = null;
        const next = result.pair;
        if (next.accessToken === live.accessToken && next.refreshToken === live.refreshToken) return;
        if (this.writeRefreshedActivePair?.(live, next) === 'written') {
          this.onPoolHeartbeatEvent?.({ event: 'pool-pair-adopted', account: active });
        }
        return;
      }
    }
  }

  /**
   * Pool Seazone (patch local v3) — a API disse que a conta ativa não é mais
   * nossa: seguir nela é usar o token de outra pessoa. Vale com a troca
   * automática desligada (não é troca por carga). Ordem: uma local com folga
   * (abaixo de `switchAtLoad`); senão uma conta livre do pool (`auto`,
   * informando a perdida); senão a local de menor carga, mesmo cheia. O par
   * em disco NÃO é capturado na conta perdida — ela já é de outra pessoa.
   */
  private async leaveLostPoolAccount(lost: AccountId): Promise<void> {
    await this.listAccounts();
    if (this.disposed || this.config.activeAccountId !== lost) return;

    const accounts = this.decoratedAccounts();
    const locals = accounts
      .filter((account) => !isPoolAccountId(account.id) && account.available && !account.needsReconnect && account.heldBy === undefined)
      .map((account) => ({ id: account.id, load: overallLoad(account.load) }))
      .sort((a, b) => (a.load ?? Number.POSITIVE_INFINITY) - (b.load ?? Number.POSITIVE_INFINITY));
    const roomyLocal = locals.find((account) => account.load !== null && account.load < this.config.autoSwitch.switchAtLoad);
    const poolCandidate = accounts.find((account) => isPoolAccountId(account.id) && account.id !== lost && account.available && !account.needsReconnect);

    const attempts: AccountId[] = [];
    if (roomyLocal) attempts.push(roomyLocal.id);
    if (poolCandidate) attempts.push(poolCandidate.id);
    if (!roomyLocal && locals.length > 0) attempts.push(locals[0].id);

    for (const target of attempts) {
      // Para o pool, `origin: 'auto'` faz o switcher escolher uma conta livre; o id pedido só diz que o destino é o pool.
      const outcome = await this.performSwitch(target, 'auto', lost);
      if (outcome.kind === 'switched') {
        this.onPoolHeartbeatEvent?.({ event: 'pool-account-lost', account: lost, outcome: 'switched', to: outcome.to });
        return;
      }
      if (this.disposed || this.config.activeAccountId !== lost) return;
    }
    this.onPoolHeartbeatEvent?.({ event: 'pool-account-lost', account: lost, outcome: 'failed' });
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
        // Um lugar remoto com conta trabalha sem sessão nesta máquina: a carga dele também precisa ser lida.
        if (hasLiveSession() || this.hasRemoteWithAccount()) {
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
    if (this.poolHeartbeatTimer) {
      this.clearTimeoutFn(this.poolHeartbeatTimer);
      this.poolHeartbeatTimer = null;
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

    // fix/renovacao-credencial — ANTES da leitura do mod: guarda no cofre o
    // par que o CLI rotacionou desde a última vez, e a leitura (R5 do mod
    // local) já enxerga cofre e disco iguais.
    await this.captureLivePairNow('sync');
    // Lugares remotos — mesma captura, do `~/.claude` de cada lugar: o cofre
    // da conta que está lá acompanha o que o CLI remoto renova, e a carga dela
    // é lida com esse par (o mod local nunca renova conta que está num lugar).
    await this.syncRemotePlaces();

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
   * fix/renovacao-credencial — guarda no cofre o par que está AGORA em
   * `.credentials.json`, na conta a quem ele pertence. É a captura do
   * encerramento que C6 (research.md) previa e nunca existiu, mais a mesma
   * captura a cada leitura de carga: o par da ativa deixa de depender de um
   * switch feito por este motor para chegar ao cofre. Só COPIA disco -> cofre;
   * nunca renova (gotcha "nunca renovar a ativa pelo cofre") e nunca escreve
   * em `~/.claude` (claude-state.ts segue a única escrita lá).
   *
   * Exige PROVA de identidade (fingerprint de `oauthAccount` em `.claude.json`
   * batendo com uma conta do pool): sem ela (logo depois de um switch, até o
   * CLI refazer o fetch do perfil) não grava nada — nesse intervalo a captura
   * do próprio switch já cobriu.
   *
   * A gravação acontece de forma SÍNCRONA dentro desta chamada (nenhum
   * `await` antes de `mod.captureRotatedPair`, que no mod local também grava
   * antes do primeiro `await`): o encerramento do app chama sem esperar.
   * Nunca lança; falha de gravação fica para a próxima vez.
   */
  captureLivePairNow(trigger: 'sync' | 'quit'): Promise<void> {
    if (this.disposed || !this.mod || !this.readCurrentPair) return Promise.resolve();
    const live = this.readCurrentPair();
    if (!live) return Promise.resolve();
    const believedActive = this.config.activeAccountId;
    const owner = this.resolveLivePairOwner(believedActive, true);
    if (!owner || this.lastCapturedRefreshToken.get(owner) === live.refreshToken) return Promise.resolve();

    let pending: Promise<void>;
    try {
      pending = this.mod.captureRotatedPair(owner, live);
    } catch {
      return Promise.resolve();
    }
    return pending.then(
      () => {
        this.lastCapturedRefreshToken.set(owner, live.refreshToken);
        this.onLivePairCaptured?.({ account: owner, trigger, believedActive });
      },
      () => undefined,
    );
  }

  /**
   * fix/renovacao-credencial — de quem é o par que está em
   * `.credentials.json`. A identidade em disco (fingerprint) vence a crença do
   * motor (`believed`): com a crença velha (outra instância do app, `/login`
   * no terminal, app fechado no meio), capturar em `believed` gravaria o par
   * de uma conta na vaga de outra. `null` = não capturar.
   * - fingerprint de uma conta do pool -> essa conta;
   * - fingerprint legível de fora do pool, e `believed` tem fingerprint
   *   conhecido (logo, provadamente não é ela) -> `null`;
   * - sem prova -> `requireProof ? null : believed` (o switch mantém o
   *   comportamento de antes; a sincronização periódica não arrisca).
   */
  private resolveLivePairOwner(believed: AccountId | null, requireProof: boolean): AccountId | null {
    const fingerprint = this.readCurrentAccountFingerprint?.() ?? null;
    if (fingerprint) {
      const owner = this.config.localAccounts.find((account) => account.fingerprint === fingerprint)?.id;
      if (owner) return owner;
      const believedFingerprint = believed ? this.config.localAccounts.find((account) => account.id === believed)?.fingerprint : undefined;
      if (believedFingerprint) return null;
    }
    return requireProof ? null : believed;
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

  /** Roda `task` depois de toda troca já enfileirada (desta máquina ou de lugar remoto). */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.switchQueue.then(task, task);
    this.switchQueue = run.catch(() => undefined);
    return run;
  }

  private remotes(): readonly RemotePlace[] {
    return this.config.remotes ?? [];
  }

  private hasRemoteWithAccount(): boolean {
    return this.remoteState !== null && this.remotes().some((place) => place.activeAccountId !== null);
  }

  /** Lugar remoto onde `id` está ativa agora, ou `null`. */
  private remoteHolding(id: AccountId): RemotePlace | null {
    return this.remotes().find((place) => place.activeAccountId === id) ?? null;
  }

  /**
   * De quem é o par que está no `~/.claude` de um lugar. Mesma régua de
   * `resolveLivePairOwner`: a identidade em disco vence a crença; sem prova,
   * `requireProof` decide entre não capturar e confiar na crença. Uma escrita
   * de desfecho incerto conta como prova quando o refresh token bate.
   */
  private resolveRemotePairOwner(place: RemotePlace, pair: CredentialPair, fingerprint: string | null, requireProof: boolean): AccountId | null {
    const believed = place.activeAccountId;
    if (fingerprint) {
      const owner = this.config.localAccounts.find((account) => account.fingerprint === fingerprint)?.id;
      if (owner) return owner;
      const believedFingerprint = believed ? this.config.localAccounts.find((account) => account.id === believed)?.fingerprint : undefined;
      if (believedFingerprint) return null;
    }
    const uncertain = this.uncertainRemoteWrites.get(place.id);
    if (uncertain && uncertain.refreshToken !== null && uncertain.refreshToken === pair.refreshToken) return uncertain.account;
    if (uncertain) return null;
    return requireProof ? null : believed;
  }

  /**
   * Guarda no cofre o par que está agora em cada lugar remoto com conta. Só
   * com prova de identidade (fingerprint do `oauthAccount` de lá batendo com a
   * conta que o motor pôs no lugar): sem ela não grava nada — logo depois de
   * uma troca, a captura da própria troca já cobriu. Nunca lança.
   */
  private async syncRemotePlaces(): Promise<void> {
    const remoteState = this.remoteState;
    if (!remoteState || !this.mod) return;
    const mod = this.mod;
    let reachChanged = false;
    await Promise.all(
      this.remotes()
        .filter((place) => place.activeAccountId !== null)
        .map(async (place) => {
          const read = await remoteState.read(place.sshTarget);
          if (this.disposed) return;
          const reach = read.kind === 'unreachable' ? 'unreachable' : 'ok';
          if (this.remoteReach.get(place.id) !== reach) reachChanged = true;
          this.remoteReach.set(place.id, reach);
          if (read.kind !== 'ok' || !read.pair) return;
          // A conta do lugar pode ter mudado enquanto o ssh estava em voo.
          const current = this.remotes().find((candidate) => candidate.id === place.id);
          if (!current || current.activeAccountId !== place.activeAccountId) return;
          const owner = this.resolveRemotePairOwner(current, read.pair, read.fingerprint, true);
          if (!owner || owner !== current.activeAccountId) return;
          if (this.lastRemoteCapturedRefreshToken.get(owner) === read.pair.refreshToken) return;
          try {
            await mod.captureRotatedPair(owner, read.pair);
          } catch {
            return;
          }
          this.lastRemoteCapturedRefreshToken.set(owner, read.pair.refreshToken);
          this.onRemoteEvent?.({ event: 'remote-pair-captured', place: place.id, account: owner, trigger: 'sync' });
        }),
    );
    if (reachChanged) this.emit();
  }

  /**
   * Troca a conta de um lugar remoto. `target: null` libera o lugar (tira a
   * credencial de lá). Mesma ordem invariante de `claude-state.ts`, do outro
   * lado do ssh: lê o par que está lá → guarda no cofre da conta dona dele →
   * grava o par novo (só se o de lá não mudou desde a leitura) → apaga
   * `oauthAccount`. Uma conta nunca entra num lugar se estiver ativa nesta
   * máquina ou em outro lugar.
   */
  switchRemote(placeId: string, target: AccountId | null, origin: 'manual' | 'auto' = 'manual'): Promise<RemoteSwitchOutcome> {
    return this.exclusive(async () => {
      const place = this.remotes().find((candidate) => candidate.id === placeId);
      const from = place?.activeAccountId ?? null;
      const outcome = await this.performRemoteSwitch(placeId, target);
      if (outcome.kind !== 'already-active') {
        this.onRemoteEvent?.({
          event: 'remote-switch',
          place: placeId,
          origin,
          outcome: outcome.kind,
          from,
          to: outcome.kind === 'switched' ? outcome.to : target,
          ...(outcome.kind === 'failed' ? { reason: outcome.reason } : {}),
        });
      }
      return outcome;
    });
  }

  private async performRemoteSwitch(placeId: string, target: AccountId | null): Promise<RemoteSwitchOutcome> {
    if (this.disposed || !this.mod || !this.remoteState) return { kind: 'failed', reason: 'io' };
    const place = this.remotes().find((candidate) => candidate.id === placeId);
    if (!place) return { kind: 'failed', reason: 'unknown-place' };
    if (target === place.activeAccountId) return { kind: 'already-active' };
    if (target !== null) {
      // Só conta do pool próprio: a do pool Seazone tem posse e heartbeat por máquina.
      if (isPoolAccountId(target) || !this.config.localAccounts.some((account) => account.id === target)) return { kind: 'failed', reason: 'unknown-account' };
      if (target === this.config.activeAccountId) return { kind: 'failed', reason: 'in-use' };
      const holder = this.remoteHolding(target);
      if (holder && holder.id !== place.id) return { kind: 'failed', reason: 'in-use' };
    }

    const mod = this.mod;
    const remoteState = this.remoteState;
    let nextPair: CredentialPair | null = null;
    if (target !== null) {
      const switchResult = await mod.switchTo(target, { origin: 'manual', from: null });
      if (this.disposed) return { kind: 'failed', reason: 'io' };
      if (switchResult.kind !== 'ok') {
        if (switchResult.reason === 'expired-credentials' && !this.reconnectRegistry.has(target)) {
          this.reconnectRegistry.mark(target);
          this.emit();
        }
        if (switchResult.reason === 'expired-credentials' || switchResult.reason === 'offline') return { kind: 'failed', reason: switchResult.reason };
        if (switchResult.reason === 'unknown-account') return { kind: 'failed', reason: 'unknown-account' };
        return { kind: 'failed', reason: 'io' };
      }
      nextPair = switchResult.pair;
    }

    // Duas voltas: se o CLI de lá renovou entre a leitura e a escrita, a
    // escrita recusa (`changed`), e a segunda volta captura o par novo dele.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const read = await remoteState.read(place.sshTarget);
      if (this.disposed) return { kind: 'failed', reason: 'io' };
      this.remoteReach.set(place.id, read.kind === 'unreachable' ? 'unreachable' : 'ok');
      if (read.kind === 'unreachable') {
        this.emit();
        return { kind: 'failed', reason: 'unreachable' };
      }
      if (read.kind !== 'ok') return { kind: 'failed', reason: 'io' };

      if (read.pair) {
        const owner = this.resolveRemotePairOwner(place, read.pair, read.fingerprint, false);
        // Nunca grava no cofre de uma conta que está viva em outro lugar: o par dela lá é o que vale.
        const ownerLiveElsewhere = owner !== null && (owner === this.config.activeAccountId || (this.remoteHolding(owner)?.id ?? place.id) !== place.id);
        if (owner && !ownerLiveElsewhere) {
          try {
            await mod.captureRotatedPair(owner, read.pair);
          } catch {
            return { kind: 'failed', reason: 'io' }; // nada foi escrito lá: o par segue vivo no lugar.
          }
          this.lastRemoteCapturedRefreshToken.set(owner, read.pair.refreshToken);
          this.onRemoteEvent?.({ event: 'remote-pair-captured', place: place.id, account: owner, trigger: 'switch' });
          // A conta que entra já está lá (escrita anterior de desfecho incerto que chegou): o par de lá é o mais novo, fica ele.
          if (owner === target) nextPair = read.pair;
        }
      }
      if (this.disposed) return { kind: 'failed', reason: 'io' };

      const write = await remoteState.write(place.sshTarget, read.pair?.refreshToken ?? null, nextPair);
      if (write.kind === 'changed') continue;
      if (write.kind === 'unreachable' || write.kind === 'io') {
        // O par pode ter chegado lá ou não. Confere uma vez; sem resposta, fica a marca de incerteza.
        const check = await remoteState.read(place.sshTarget);
        const landed = check.kind === 'ok' && (check.pair?.refreshToken ?? null) === (nextPair?.refreshToken ?? null);
        const kept = check.kind === 'ok' && (check.pair?.refreshToken ?? null) === (read.pair?.refreshToken ?? null);
        if (!landed) {
          if (!kept) {
            this.uncertainRemoteWrites.set(place.id, { account: target, refreshToken: nextPair?.refreshToken ?? null });
            this.onRemoteEvent?.({ event: 'remote-write-uncertain', place: place.id, account: target });
          }
          return { kind: 'failed', reason: write.kind === 'unreachable' ? 'unreachable' : 'io' };
        }
      }

      this.uncertainRemoteWrites.delete(place.id);
      if (target !== null && nextPair) {
        this.lastRemoteCapturedRefreshToken.set(target, nextPair.refreshToken);
        this.reconnectRegistry.clear(target);
      }
      this.config = {
        ...this.config,
        remotes: this.remotes().map((candidate) => (candidate.id === place.id ? { ...candidate, activeAccountId: target } : candidate)),
      };
      this.onRemotesChanged?.(this.remotes());
      this.emit();
      return { kind: 'switched', from: place.activeAccountId, to: target };
    }
    return { kind: 'failed', reason: 'io' };
  }

  /**
   * Troca automática de cada lugar remoto, com a mesma política desta
   * máquina. Candidatas: contas do pool próprio que não estão ativas aqui nem
   * em outro lugar.
   */
  private async evaluateRemoteAutoSwitch(): Promise<void> {
    if (!this.remoteState || this.disposed || !this.config.autoSwitch.enabled) return;
    for (const place of this.remotes()) {
      if (!place.activeAccountId || this.disposed) continue;
      const accounts = this.withBlindAsFull(
        place,
        this.decoratedAccounts()
          .filter((account) => !isPoolAccountId(account.id))
          .map((account) => (account.id !== place.activeAccountId && this.isHeld(account) ? { ...account, available: false } : account)),
      );
      const target = selectAutoSwitchTarget(accounts, place.activeAccountId, this.config.autoSwitch);
      if (!target) continue;
      await this.switchRemote(place.id, target, 'auto');
    }
  }

  /**
   * Causa 2 do handoff de 05/11: a carga da conta de um lugar só é lida enquanto
   * o par copiado de lá vale. Se o CLI de lá parou (a conta encheu) e o par
   * venceu, a carga fica desconhecida e a troca nunca aconteceria. Depois de
   * `remoteBlindAsFullAfterMs` assim, a conta conta como cheia (100) só para a
   * decisão deste lugar. Lugar sem ssh não entra: a troca falharia de todo jeito.
   */
  private withBlindAsFull(place: RemotePlace, accounts: readonly AccountSummary[]): readonly AccountSummary[] {
    const activeId = place.activeAccountId;
    const active = accounts.find((account) => account.id === activeId);
    if (!activeId || !active || overallLoad(active.load) !== null || this.remoteReach.get(place.id) === 'unreachable') {
      this.remoteBlindSince.delete(place.id);
      return accounts;
    }
    const now = this.now();
    const blind = this.remoteBlindSince.get(place.id);
    if (!blind || blind.account !== activeId) {
      this.remoteBlindSince.set(place.id, { account: activeId, since: now, logged: false });
      return accounts;
    }
    const blindForMs = now - blind.since;
    if (blindForMs < this.remoteBlindAsFullAfterMs) return accounts;
    if (!blind.logged) {
      blind.logged = true;
      this.onRemoteEvent?.({ event: 'remote-blind-as-full', place: place.id, account: activeId, blindForMs });
    }
    const full = { fiveHour: null, sevenDay: 100, sonnet: null, readAt: new Date(now).toISOString() };
    return accounts.map((account) => (account.id === activeId ? { ...account, load: full } : account));
  }

  /** A conta está ativa nesta máquina ou em algum lugar remoto. */
  private isHeld(account: AccountSummary): boolean {
    return account.id === this.config.activeAccountId || account.heldBy !== undefined;
  }

  /** Para a escolha automática DESTA máquina: conta que está num lugar remoto não é destino. */
  private withRemoteHeldUnavailable(accounts: readonly AccountSummary[]): readonly AccountSummary[] {
    return accounts.map((account) => (account.heldBy !== undefined ? { ...account, available: false } : account));
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

    // Esta máquina primeiro (o dono quer a preferência no PC, 05/11).
    const outcome = await this.evaluateLocalAutoSwitch();
    // Lugares remotos — depois desta máquina, cada lugar com conta.
    await this.evaluateRemoteAutoSwitch();
    return outcome;
  }

  private async evaluateLocalAutoSwitch(): Promise<SwitchOutcome | null> {
    const accounts = restrictPoolToPreferred(this.withRemoteHeldUnavailable(this.decoratedAccounts()), this.config.activeAccountId, this.config.seazone?.preferredLabels);
    // Pool Seazone ao lado das locais — `selectAutoSwitchTarget` deixa o pool
    // como última opção e traz de volta para uma local livre; sem conta
    // `seazone:*` na lista decide igual ao `selectSwitchTarget` de antes.
    const target = selectAutoSwitchTarget(accounts, this.config.activeAccountId, this.config.autoSwitch);
    if (!target) return null;

    const sessionBusy = this.isSessionBusy();
    const fromId = this.config.activeAccountId;
    const activeLoad = overallLoad(accounts.find((a) => a.id === fromId)?.load ?? null);
    const targetLoad = overallLoad(accounts.find((a) => a.id === target)?.load ?? null);

    const outcome = await this.performSwitch(target, 'auto');

    if (outcome.kind === 'switched' || outcome.kind === 'failed') {
      // Pool Seazone (patch local v2) — a troca automática para o pool pede
      // `auto` e o switcher pode entregar outra conta: o log registra a
      // entregue, com a carga dela.
      const to = outcome.kind === 'switched' ? outcome.to : target;
      const toLoad = to === target ? targetLoad : overallLoad(accounts.find((a) => a.id === to)?.load ?? null);
      this.onAutoSwitchLogged?.({ outcome: outcome.kind, from: fromId, to, activeLoad, targetLoad: toLoad, sessionBusy });
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
  private performSwitch(id: AccountId, origin: 'manual' | 'auto', lostAccount: AccountId | null = null): Promise<SwitchOutcome> {
    return this.exclusive(() => this.performSwitchNow(id, origin, lostAccount));
  }

  private async performSwitchNow(id: AccountId, origin: 'manual' | 'auto', lostAccount: AccountId | null): Promise<SwitchOutcome> {
    // R3 (revisão) — descartado na entrada: falha sem tocar o mod nem a
    // config em memória (cobre um `switchTo` manual chamado depois do
    // `dispose()`; o caminho auto já é barrado antes, em `evaluateAutoSwitch`).
    if (this.disposed) return { kind: 'failed', reason: 'io' };
    if (!this.mod) return { kind: 'failed', reason: 'io' };
    if (id === this.config.activeAccountId) return { kind: 'already-active', account: id };
    // Lugares remotos — a conta está ativa num lugar remoto: o CLI de lá renova
    // o par dela. Usar aqui também faria os dois renovarem o mesmo refresh token.
    if (this.remoteHolding(id)) return { kind: 'failed', reason: 'account-unavailable' };

    const fromId = this.config.activeAccountId;
    const switchResult = await this.mod.switchTo(id, { origin, from: fromId });

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

    // Pool Seazone (patch local v2) — a conta que o backend ENTREGOU
    // (`accountId`), que no `auto` do switcher pode não ser a pedida. Daqui
    // em diante tudo usa ela: a captura do par que sai, a conta ativa, o
    // registro de reconexão, a checagem de corrida e o desfecho.
    const entered = switchResult.accountId ?? id;
    if (entered === fromId) {
      // O switcher só devolve a conta atual quando ela é a única elegível.
      // Gravar o par dele por cima do que o CLI pode ter rotacionado em
      // disco arriscaria matar a sessão; não há troca a fazer.
      if (origin === 'auto') {
        this.lastAutoSwitch = { kind: 'failed', to: id, reason: 'account-unavailable', at: this.nowIso() };
        this.emit();
      }
      return { kind: 'failed', reason: 'account-unavailable' };
    }

    const mod = this.mod;
    try {
      await this.applySwitchFn(switchResult.pair, async (rotatedPair) => {
        // fix/renovacao-credencial — o par vai para a conta DONA dele
        // (`resolveLivePairOwner`), não necessariamente `fromId`. Dono = a
        // conta que entra: o cofre dela já tem o que vai para o disco, não
        // sobrescreve.
        // Patch local v3 — conta do pool perdida (403 no heartbeat) não recebe o par: já é de outra pessoa.
        const owner = rotatedPair ? this.resolveLivePairOwner(fromId, false) : null;
        if (rotatedPair && owner && owner !== entered && owner !== lostAccount) {
          await mod.captureRotatedPair(owner, rotatedPair);
          this.lastCapturedRefreshToken.set(owner, rotatedPair.refreshToken);
          this.onLivePairCaptured?.({ account: owner, trigger: 'switch', believedActive: fromId });
        }
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

    this.config = { ...this.config, activeAccountId: entered };
    // fix/renovacao-credencial — o par que acabou de ir para o disco saiu do
    // cofre desta conta; a próxima sincronização só grava se o CLI rotacionar.
    this.lastCapturedRefreshToken.set(entered, switchResult.pair.refreshToken);
    this.reconnectRegistry.clear(entered); // D3 — trocar pra ela com sucesso prova que a credencial está boa de novo.
    if (origin === 'auto') {
      this.lastAutoSwitch = { kind: 'switched', from: fromId, to: entered, at: this.nowIso() };
    }
    // Emenda 22/09 (item 5) — um switch novo (bem-sucedido) sempre limpa um
    // aviso de corrida anterior: ele descrevia a troca ANTERIOR, não esta.
    this.lastSwitchOverwritten = null;
    this.scheduleRaceCheck(entered, switchResult.pair.refreshToken);
    this.emit();
    return { kind: 'switched', from: fromId, to: entered };
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
    return this.accounts.map((account) => {
      const holder = this.remoteHolding(account.id);
      return {
        ...account,
        active: account.id === this.config.activeAccountId,
        ...(this.reconnectRegistry.has(account.id) ? { needsReconnect: true as const } : {}),
        ...(holder ? { heldBy: holder.id } : {}),
      };
    });
  }

  private buildView(): AccountsViewDto {
    const decorated = this.decoratedAccounts();
    const autoSwitchState = !this.mod || this.state !== 'ready' ? 'idle' : classifyAutoSwitch(restrictPoolToPreferred(this.withRemoteHeldUnavailable(decorated), this.config.activeAccountId, this.config.seazone?.preferredLabels), this.config.activeAccountId, this.config.autoSwitch);
    const remotes: RemotePlaceView[] = this.remotes().map((place) => ({ ...place, reach: this.remoteReach.get(place.id) ?? 'unknown' }));
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
      remotes,
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
