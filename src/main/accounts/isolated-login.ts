// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 1 — colhedor do login
// isolado (plan-etapa-3.md §4.2). O app cria `<userData>/accounts-login-<uuid>/`,
// abre uma aba `claude` com `CLAUDE_CONFIG_DIR` nesse diretório (o `pty:create`
// que faz isso é o Bloco 2), o operador faz o `/login` oficial DENTRO do
// terminal, e este módulo lê o `.credentials.json`/`.claude.json` de lá — com
// `expiresAt` real — direto para o cofre, apagando o diretório em seguida.
//
// Duas regras duras aprendidas na Fase 0 (research-etapa-3-cli.md):
// - NUNCA `/logout` dentro da aba — ele revoga no servidor o refresh token
//   (A3). O fechamento da aba é por `kill` do PTY, nunca por comando no CLI —
//   este módulo não escreve NADA na aba (ver regra dura #2 do prompt da
//   etapa: nenhuma dependência daqui envia input ao PTY).
// - `/login` num `CLAUDE_CONFIG_DIR` vazio grava `.credentials.json` E
//   `.claude.json` dentro dele (A6) — os dois podem não terminar de escrever
//   no mesmo instante; o `fingerprintGraceMs` tolera essa defasagem antes de
//   concluir sem fingerprint.
//
// 011-contas-e-provedores, etapa 3, Fase 2 (R4, revisão) — `this.vault.write`
// pode LANÇAR (erro de I/O real em `writeVaultFile`, vault.ts) em vez de
// devolver `vault-unavailable`. A colheita nunca pode deixar essa exceção
// escapar: ela é chamada de dentro de `finishConclusion` (async, mas SEM
// await antes da chamada), e uma exceção aí abortaria a função ANTES da
// cauda obrigatória (matar PTY -> esperar exit -> apagar diretório -> limpar
// o pendente -> emitir status) — um login que falhou em concluir não pode
// deixar a aba viva nem o diretório (com credencial em texto claro) para
// trás. `writeVaultSafely` trata os dois casos (retorno e exceção) como o
// MESMO resultado; `harvest`/`harvestWithTarget` usam ela no lugar de
// `this.vault.write` direto.

import { dirname, basename, join, resolve } from 'node:path';
import { readCredentialsPairFromText, accountFingerprintFromClaudeJsonText } from './credentials-file';
import type { CredentialPair } from './account-mod';
import type { VaultLike, VaultWriteResult } from './vault';
import type { AccountId, BeginLoginOutcome, LoginStatusDto } from '../../shared/accounts';

export const LOGIN_DIR_PREFIX = 'accounts-login-';

const LABEL_MAX_LENGTH = 60;

/** UUID v4 canônico (o mesmo formato que `randomUUID()` produz) — minúsculo por convenção, mas o casamento aqui é case-insensitive (ver `isLoginDirPath`). */
const LOGIN_DIR_NAME_PATTERN = new RegExp(`^${LOGIN_DIR_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i');

/**
 * `true` só quando `candidate` é FILHO DIRETO de `userDataDir` (pai EXATO,
 * sem `..` nem symlink escapando) e o basename casa
 * `accounts-login-<uuid-v4-canônico>`. Todo `removeDir` deste módulo passa
 * por esta guarda — um caminho reprovado NUNCA é apagado (é a única defesa
 * contra apagar algo fora do que este módulo criou, caso `dir`/`candidate`
 * venha corrompido de algum lugar).
 */
export function isLoginDirPath(userDataDir: string, candidate: string, platform: NodeJS.Platform): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedParent = dirname(resolvedCandidate);
  const resolvedUserData = resolve(userDataDir);

  const parentMatches = platform === 'win32' ? resolvedParent.toLowerCase() === resolvedUserData.toLowerCase() : resolvedParent === resolvedUserData;
  if (!parentMatches) return false;

  return LOGIN_DIR_NAME_PATTERN.test(basename(resolvedCandidate));
}

export interface IsolatedLoginFsDeps {
  mkdir(path: string): void;
  removeDir(path: string): void;
  /** Nomes (basenames) das entradas de `userDataDir` — usado só por `sweepStaleDirs`. */
  listDir(path: string): string[];
  /** `null` = arquivo ausente. Nunca lança. */
  readText(path: string): string | null;
}

/**
 * Dados NÃO sensíveis do que o login colheu — quem recebe (index.ts, Bloco 2)
 * grava em `appConfig.accounts` via `applyHarvestedAccount`.
 * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — `reconnected` é o login COM
 * ALVO (`begin(label, { targetAccountId })`) que colheu a credencial da
 * MESMA conta: o par no cofre foi renovado, e `applyHarvestedAccount` grava o
 * fingerprint na conta-alvo se ela ainda não tinha um.
 */
export interface AccountHarvestedEvent {
  readonly kind: 'added' | 'replaced' | 'reconnected';
  readonly accountId: AccountId;
  readonly label: string;
  readonly fingerprint: string | null;
}

export interface IsolatedLoginManagerDeps {
  readonly userDataDir: string;
  readonly platform: NodeJS.Platform;
  readonly fs: IsolatedLoginFsDeps;
  readonly vault: VaultLike;
  readonly isVaultAvailable: () => boolean;
  readonly findAccountByFingerprint: (fingerprint: string) => { readonly id: AccountId; readonly label: string } | null;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — identifica a conta-alvo
   * de um login com `targetAccountId` (o fluxo "Reconectar"). Espelha
   * `findAccountById` de account-pool.ts; index.ts injeta exatamente essa
   * função fechada sobre `appConfig.accounts`.
   */
  readonly findAccountById: (id: AccountId) => { readonly id: AccountId; readonly label: string; readonly fingerprint: string | null } | null;
  readonly generateLoginId: () => string;
  readonly generateAccountId: () => AccountId;
  readonly onAccountHarvested: (event: AccountHarvestedEvent) => void;
  readonly killPty: (ptyId: string) => void;
  readonly emitStatus: (status: LoginStatusDto) => void;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  readonly now?: () => number;
  /** Default 1000 — intervalo do poll do diretório enquanto aguarda o `/login`. */
  readonly pollIntervalMs?: number;
  /** Default 5000 — quanto esperar o `.claude.json` ganhar `oauthAccount` depois do par já estar válido, antes de concluir sem fingerprint. */
  readonly fingerprintGraceMs?: number;
  /** Default 3000 — quanto esperar o PTY sair sozinho depois do `kill`, antes de apagar o diretório de qualquer jeito. */
  readonly exitWaitMs?: number;
  /** Default 60000 — sem nenhum PTY anexado neste prazo, o login isolado desiste (`cancelled/no-terminal`). */
  readonly attachTimeoutMs?: number;
}

type LoginPhase = 'awaiting' | 'finishing';

interface PendingLogin {
  readonly loginId: string;
  readonly label: string;
  readonly dir: string;
  /** 011-contas-e-provedores, etapa 3, Fase 2 (D3) — `null` = login normal (Fase 1, add/replace); presente = login "Reconectar" apontado pra esta conta. */
  readonly targetAccountId: AccountId | null;
  ptyId: string | null;
  phase: LoginPhase;
  /** Instante (via `now()`) em que um par VÁLIDO foi visto pela primeira vez, ainda sem fingerprint — base do `fingerprintGraceMs`. `null` até isso acontecer. */
  pairFirstSeenAt: number | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  attachTimer: ReturnType<typeof setTimeout> | null;
  exitTimer: ReturnType<typeof setTimeout> | null;
  /** Libera `waitForExit` — chamado por `handlePtyExit` (saída real) ou pelo próprio `exitTimer` (prazo esgotado). */
  resolveExit: (() => void) | null;
}

/**
 * Colhedor do login isolado (plan-etapa-3.md §4.2). Único ponto — fora de
 * `credentials-file.ts` — que decide o que fazer com o par lido: gravar no
 * cofre, avisar `onAccountHarvested` (que grava em `appConfig.accounts`,
 * Bloco 2) e limpar o diretório temporário. NUNCA escreve no PTY (nenhum
 * método aqui manda input) — o fechamento da aba é sempre via `killPty`.
 */
export class IsolatedLoginManager {
  private readonly userDataDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly fs: IsolatedLoginFsDeps;
  private readonly vault: VaultLike;
  private readonly isVaultAvailableFn: () => boolean;
  private readonly findAccountByFingerprintFn: (fingerprint: string) => { readonly id: AccountId; readonly label: string } | null;
  private readonly findAccountByIdFn: (id: AccountId) => { readonly id: AccountId; readonly label: string; readonly fingerprint: string | null } | null;
  private readonly generateLoginIdFn: () => string;
  private readonly generateAccountIdFn: () => AccountId;
  private readonly onAccountHarvestedFn: (event: AccountHarvestedEvent) => void;
  private readonly killPtyFn: (ptyId: string) => void;
  private readonly emitStatusFn: (status: LoginStatusDto) => void;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly nowFn: () => number;
  private readonly pollIntervalMs: number;
  private readonly fingerprintGraceMs: number;
  private readonly exitWaitMs: number;
  private readonly attachTimeoutMs: number;

  private pending: PendingLogin | null = null;

  constructor(deps: IsolatedLoginManagerDeps) {
    this.userDataDir = deps.userDataDir;
    this.platform = deps.platform;
    this.fs = deps.fs;
    this.vault = deps.vault;
    this.isVaultAvailableFn = deps.isVaultAvailable;
    this.findAccountByFingerprintFn = deps.findAccountByFingerprint;
    this.findAccountByIdFn = deps.findAccountById;
    this.generateLoginIdFn = deps.generateLoginId;
    this.generateAccountIdFn = deps.generateAccountId;
    this.onAccountHarvestedFn = deps.onAccountHarvested;
    this.killPtyFn = deps.killPty;
    this.emitStatusFn = deps.emitStatus;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    this.nowFn = deps.now ?? Date.now;
    this.pollIntervalMs = deps.pollIntervalMs ?? 1000;
    this.fingerprintGraceMs = deps.fingerprintGraceMs ?? 5000;
    this.exitWaitMs = deps.exitWaitMs ?? 3000;
    this.attachTimeoutMs = deps.attachTimeoutMs ?? 60_000;
  }

  /**
   * Rótulo pedido ANTES de abrir a aba (LGPD — o nome da conta nunca é lido
   * do `.claude.json` pra exibir). Um login pendente por vez (D10-like: um
   * gesto de cada vez); cofre indisponível recusa ANTES de tocar o disco.
   *
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — `options.targetAccountId`
   * é o fluxo "Reconectar": só guarda o alvo no pendente, SEM validá-lo aqui
   * (quem valida existência/conta-ativa é `planReconnect`, account-pool.ts,
   * chamado por index.ts ANTES de abrir este login) — as validações de hoje
   * (rótulo, cofre, um-por-vez, mkdir) são as MESMAS, com ou sem alvo.
   */
  begin(label: string, options?: { readonly targetAccountId?: AccountId }): BeginLoginOutcome {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > LABEL_MAX_LENGTH) return { kind: 'failed', reason: 'invalid-input' };
    if (!this.isVaultAvailableFn()) return { kind: 'failed', reason: 'vault-unavailable' };
    if (this.pending) return { kind: 'failed', reason: 'login-in-progress' };

    const loginId = this.generateLoginIdFn();
    const dir = join(this.userDataDir, `${LOGIN_DIR_PREFIX}${loginId}`);
    try {
      this.fs.mkdir(dir);
    } catch {
      return { kind: 'failed', reason: 'io' };
    }

    const pending: PendingLogin = {
      loginId,
      label: trimmed,
      dir,
      targetAccountId: options?.targetAccountId ?? null,
      ptyId: null,
      phase: 'awaiting',
      pairFirstSeenAt: null,
      pollTimer: null,
      attachTimer: null,
      exitTimer: null,
      resolveExit: null,
    };
    this.pending = pending;

    pending.pollTimer = this.setIntervalFn(() => this.onPollTick(pending), this.pollIntervalMs);
    pending.attachTimer = this.setTimeoutFn(() => this.onAttachTimeout(pending), this.attachTimeoutMs);

    return { kind: 'started', loginId };
  }

  /** Só o caminho, pro `pty:create` (Bloco 2) usar como `cwd`/`CLAUDE_CONFIG_DIR`. `null` se `loginId` não é o pendente atual. */
  getPendingDir(loginId: string): string | null {
    return this.pending && this.pending.loginId === loginId ? this.pending.dir : null;
  }

  attachPty(loginId: string, ptyId: string): void {
    const pending = this.pending;
    if (!pending || pending.loginId !== loginId) return;
    pending.ptyId = ptyId;
    this.clearAttachTimer(pending);
  }

  /**
   * `ptyManager.onExit` (index.ts, Bloco 2) chama isto pra TODO PTY que
   * morre — só age se for o do login pendente. Duas situações: ainda
   * aguardando (o operador fechou/matou a aba sem terminar o `/login`, ou
   * terminou e o processo caiu logo em seguida) -> uma ÚLTIMA leitura decide
   * entre concluir e cancelar; já concluindo/cancelando -> só libera a espera
   * do exit (não faz sentido ler de novo).
   */
  handlePtyExit(ptyId: string): void {
    const pending = this.pending;
    if (!pending || pending.ptyId !== ptyId) return;

    if (pending.phase === 'finishing') {
      pending.resolveExit?.();
      return;
    }

    this.leaveAwaiting(pending);
    pending.phase = 'finishing';

    const credResult = readCredentialsPairFromText(this.fs.readText(this.credentialsFilePath(pending.dir)));
    if (credResult.kind === 'ok') {
      const fingerprint = accountFingerprintFromClaudeJsonText(this.fs.readText(this.claudeJsonFilePath(pending.dir)));
      // "sem kill, já saiu" — o PTY já não existe mais.
      void this.finishConclusion(pending, credResult.pair, fingerprint, true);
    } else {
      this.finishCancelled(pending, 'exited-without-login');
    }
  }

  /** Só tem efeito enquanto ainda aguardando (concluindo/cancelando já está em andamento — não dá pra interromper no meio). Nunca toca o cofre. */
  cancel(loginId: string): void {
    const pending = this.pending;
    if (!pending || pending.loginId !== loginId || pending.phase !== 'awaiting') return;

    this.leaveAwaiting(pending);
    pending.phase = 'finishing';
    void this.finishCancel(pending);
  }

  /**
   * Boot — apaga sobras de um app fechado no meio de um login isolado (elas
   * podem conter credencial em texto claro). Só entradas que passam por
   * `isLoginDirPath`; `removeDir` lançando para uma entrada não impede as
   * demais (best-effort, cada uma isolada).
   */
  sweepStaleDirs(): string[] {
    const entries = this.fs.listDir(this.userDataDir);
    const removed: string[] = [];
    for (const name of entries) {
      if (!name.startsWith(LOGIN_DIR_PREFIX)) continue;
      const fullPath = join(this.userDataDir, name);
      if (this.pending && fullPath === this.pending.dir) continue; // defensivo — não deveria haver pendente no boot.
      if (!isLoginDirPath(this.userDataDir, fullPath, this.platform)) continue;
      try {
        this.fs.removeDir(fullPath);
        removed.push(name);
      } catch {
        // best-effort — a PRÓXIMA varredura de boot tenta de novo; uma entrada ruim não impede as outras.
      }
    }
    return removed;
  }

  /** Para timers; se há pendente, mata o PTY (se anexado) e tenta apagar o diretório, sem emitir status (o app está fechando, ninguém está ouvindo). */
  dispose(): void {
    const pending = this.pending;
    if (!pending) return;

    this.leaveAwaiting(pending);
    if (pending.exitTimer) {
      this.clearTimeoutFn(pending.exitTimer);
      pending.exitTimer = null;
    }
    if (pending.ptyId) {
      try {
        this.killPtyFn(pending.ptyId);
      } catch {
        // best-effort — o processo do app está encerrando de qualquer forma.
      }
    }
    this.safeRemoveDir(pending.dir);
    this.pending = null;
  }

  // -- internals -------------------------------------------------------

  /**
   * R4 (revisão) — `this.vault.write` pode LANÇAR (ver comentário de
   * cabeçalho do arquivo); nunca deixa a exceção escapar, trata como o MESMO
   * `vault-unavailable` que o retorno normal já cobre.
   */
  private writeVaultSafely(id: AccountId, pair: CredentialPair): VaultWriteResult {
    try {
      return this.vault.write(id, JSON.stringify(pair));
    } catch {
      return { kind: 'vault-unavailable' };
    }
  }

  private credentialsFilePath(dir: string): string {
    return join(dir, '.credentials.json');
  }

  private claudeJsonFilePath(dir: string): string {
    return join(dir, '.claude.json');
  }

  private stopPollTimer(pending: PendingLogin): void {
    if (pending.pollTimer) {
      this.clearIntervalFn(pending.pollTimer);
      pending.pollTimer = null;
    }
  }

  private clearAttachTimer(pending: PendingLogin): void {
    if (pending.attachTimer) {
      this.clearTimeoutFn(pending.attachTimer);
      pending.attachTimer = null;
    }
  }

  private leaveAwaiting(pending: PendingLogin): void {
    this.stopPollTimer(pending);
    this.clearAttachTimer(pending);
  }

  /** Só apaga se `isLoginDirPath` aprovar — caminho reprovado NUNCA é apagado (regra dura do módulo). */
  private safeRemoveDir(dir: string): void {
    if (!isLoginDirPath(this.userDataDir, dir, this.platform)) return;
    try {
      this.fs.removeDir(dir);
    } catch (error) {
      // Best-effort: a varredura do PRÓXIMO boot (`sweepStaleDirs`) recolhe. Nunca loga conteúdo, só o erro.
      console.error('[donel-dev] login isolado: falha ao apagar o diretório temporário (recolhido na próxima varredura de boot):', error);
    }
  }

  private onAttachTimeout(pending: PendingLogin): void {
    if (this.pending !== pending || pending.phase !== 'awaiting') return;
    this.leaveAwaiting(pending);
    this.finishCancelled(pending, 'no-terminal');
  }

  /**
   * Só roda na fase "aguardando". `absent`/`invalid-format` = ainda esperando
   * (pode ser escrita parcial do CLI). Par válido: com fingerprint já
   * presente, conclui na hora; sem fingerprint, arma/consulta o relógio do
   * grace e só desiste de esperar (conclui sem fingerprint) depois dele.
   */
  private onPollTick(pending: PendingLogin): void {
    if (this.pending !== pending || pending.phase !== 'awaiting') return;

    const credResult = readCredentialsPairFromText(this.fs.readText(this.credentialsFilePath(pending.dir)));
    if (credResult.kind !== 'ok') return;

    const fingerprint = accountFingerprintFromClaudeJsonText(this.fs.readText(this.claudeJsonFilePath(pending.dir)));
    if (fingerprint) {
      this.leaveAwaiting(pending);
      pending.phase = 'finishing';
      void this.finishConclusion(pending, credResult.pair, fingerprint, false);
      return;
    }

    if (pending.pairFirstSeenAt === null) {
      pending.pairFirstSeenAt = this.nowFn();
      return;
    }

    if (this.nowFn() - pending.pairFirstSeenAt >= this.fingerprintGraceMs) {
      this.leaveAwaiting(pending);
      pending.phase = 'finishing';
      void this.finishConclusion(pending, credResult.pair, null, false);
    }
  }

  /**
   * Sequência OBRIGATÓRIA (plan-etapa-3.md §4.2): cofre -> onAccountHarvested
   * -> (DEPOIS, sempre — sucesso ou falha) killPty -> espera o exit ->
   * removeDir -> limpa o pendente -> emitStatus. Falha no cofre ou no
   * `onAccountHarvested` decide qual `status` sai no fim, mas nunca pula a
   * cauda: um login que falhou em concluir não pode deixar a aba viva nem o
   * diretório (com credencial em texto claro) para trás.
   */
  private async finishConclusion(pending: PendingLogin, pair: CredentialPair, fingerprint: string | null, ptyAlreadyExited: boolean): Promise<void> {
    const status = this.harvest(pending, pair, fingerprint);

    if (!ptyAlreadyExited && pending.ptyId) this.killPtyFn(pending.ptyId);
    await this.waitForExit(pending, ptyAlreadyExited || !pending.ptyId);
    this.safeRemoveDir(pending.dir);
    if (this.pending === pending) this.pending = null;
    this.emitStatusFn(status);
  }

  /**
   * Só a parte síncrona da conclusão (cofre + aviso de config) — separada de
   * `finishConclusion` para ficar clara a fronteira "isto decide o status",
   * sem side effects. Login COM alvo (`pending.targetAccountId`) segue a
   * regra nova de "Reconectar" (D3, `harvestWithTarget`); sem alvo, o
   * add/replace da Fase 1 continua intocado.
   */
  private harvest(pending: PendingLogin, pair: CredentialPair, fingerprint: string | null): LoginStatusDto {
    if (!this.isVaultAvailableFn()) {
      return { loginId: pending.loginId, label: pending.label, state: 'failed', reason: 'vault-unavailable' };
    }

    if (pending.targetAccountId) {
      return this.harvestWithTarget(pending, pending.targetAccountId, pair, fingerprint);
    }

    const existing = fingerprint ? this.findAccountByFingerprintFn(fingerprint) : null;
    const accountId = existing?.id ?? this.generateAccountIdFn();
    const writeResult = this.writeVaultSafely(accountId, pair);
    if (writeResult.kind !== 'ok') {
      return { loginId: pending.loginId, label: pending.label, state: 'failed', reason: 'vault-unavailable' };
    }

    try {
      this.onAccountHarvestedFn({
        kind: existing ? 'replaced' : 'added',
        accountId,
        label: existing ? existing.label : pending.label,
        fingerprint,
      });
    } catch {
      return { loginId: pending.loginId, label: pending.label, state: 'failed', reason: 'io' };
    }

    return existing
      ? { loginId: pending.loginId, label: pending.label, state: 'replaced', accountId, existingLabel: existing.label }
      : { loginId: pending.loginId, label: pending.label, state: 'added', accountId };
  }

  /**
   * 011-contas-e-provedores, etapa 3, Fase 2 (D3) — "Reconectar". Casos a-d
   * do desenho (fase2-design.md §Bloco 1, item 7). `label` no `LoginStatusDto`
   * de saída é sempre o rótulo LIDO do alvo (`target.label`), nunca
   * `pending.label` — os dois coincidem na wiring real (index.ts chama
   * `begin(plan.label, { targetAccountId })` com o rótulo do próprio alvo),
   * mas ler de `target` é o que o contrato promete e o que sobrevive a uma
   * eventual conta renomeada entre o `begin` e a conclusão.
   */
  private harvestWithTarget(pending: PendingLogin, targetAccountId: AccountId, pair: CredentialPair, fingerprint: string | null): LoginStatusDto {
    // a. alvo sumiu da config entre o `begin` e agora — nada pra reconectar.
    const target = this.findAccountByIdFn(targetAccountId);
    if (!target) {
      return { loginId: pending.loginId, label: pending.label, state: 'failed', reason: 'unknown-account' };
    }

    if (fingerprint) {
      // b. o fingerprint deste login já é conhecido, e é de OUTRA conta —
      // dá pra nomear de quem é (mais específico que c, por isso checado antes).
      const owner = this.findAccountByFingerprintFn(fingerprint);
      if (owner && owner.id !== targetAccountId) {
        return { loginId: pending.loginId, label: target.label, state: 'wrong-account', otherLabel: owner.label };
      }
      // c. o alvo já tem UM fingerprint próprio, e este login trouxe outro —
      // não dá pra provar de quem é, mas dá pra provar que NÃO é do alvo.
      if (target.fingerprint && target.fingerprint !== fingerprint) {
        return { loginId: pending.loginId, label: target.label, state: 'wrong-account', otherLabel: null };
      }
    }
    // Login SEM fingerprint (fingerprint === null) é aceito mesmo com o alvo
    // tendo um — não dá pra provar que é outra conta (regra explícita do D3).

    // d. senão, grava o par no id do ALVO (nunca gera id novo — a conta já existe).
    const writeResult = this.writeVaultSafely(targetAccountId, pair);
    if (writeResult.kind !== 'ok') {
      return { loginId: pending.loginId, label: target.label, state: 'failed', reason: 'vault-unavailable' };
    }

    try {
      this.onAccountHarvestedFn({ kind: 'reconnected', accountId: targetAccountId, label: target.label, fingerprint });
    } catch {
      return { loginId: pending.loginId, label: target.label, state: 'failed', reason: 'io' };
    }

    return { loginId: pending.loginId, label: target.label, state: 'reconnected', accountId: targetAccountId };
  }

  private async finishCancel(pending: PendingLogin): Promise<void> {
    const alreadyGone = pending.ptyId === null;
    if (pending.ptyId) this.killPtyFn(pending.ptyId);
    await this.waitForExit(pending, alreadyGone);
    this.finishCancelled(pending, 'user');
  }

  private finishCancelled(pending: PendingLogin, reason: 'user' | 'exited-without-login' | 'no-terminal'): void {
    this.safeRemoveDir(pending.dir);
    if (this.pending === pending) this.pending = null;
    this.emitStatusFn({ loginId: pending.loginId, label: pending.label, state: 'cancelled', reason });
  }

  /** Resolve assim que `handlePtyExit` liberar (`pending.resolveExit`) ou quando `exitWaitMs` esgotar — o que vier primeiro. `alreadyDone` pula a espera inteira (nada a matar/esperar). */
  private waitForExit(pending: PendingLogin, alreadyDone: boolean): Promise<void> {
    if (alreadyDone) return Promise.resolve();

    return new Promise<void>((resolve) => {
      pending.resolveExit = () => {
        if (pending.exitTimer) {
          this.clearTimeoutFn(pending.exitTimer);
          pending.exitTimer = null;
        }
        pending.resolveExit = null;
        resolve();
      };
      pending.exitTimer = this.setTimeoutFn(() => pending.resolveExit?.(), this.exitWaitMs);
    });
  }
}
