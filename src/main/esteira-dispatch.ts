// Spec 010 (D-6, D-11, P-6) — vertical pequeno, passo 2: o DISPARO de fase.
// Junta as tres decisoes que governam "comecar a trabalhar num item":
//
// 1. **Alvo explicito (D-6)** — o `workspace` vem de quem dispara, nunca do
//    projeto em foco. Item do tipo `issue` sem repo NAO dispara: e a regra que
//    impede a repeticao da evidencia 2 (fase aberta no repo errado).
// 2. **A trava e FATO (D-11)** — `lock.acquired` no log, com dono, hora e
//    sessao. Nao existe arquivo `.lock` solto (invisivel, orfao, sem dono) nem
//    dependencia de etiqueta remota: a trava aparece no card e libera num
//    gesto, que e `releaseLock` — outro evento.
// 3. **Sessao por item+fase (P-6)** — mudar de fase abre sessao nova, sempre;
//    dentro da mesma fase, o que abre outra e o orcamento de contexto, e ai a
//    nova aponta para a anterior por `continuesSessionId`.
//
// Rodada de melhoria de 05/08 (relatorio "etapa-3-ponta-a-ponta", P32/P33)
// acrescentou mais duas guardas ao mesmo disparo:
//
// 4. **Redisparo de fase DONE exige confirmacao (A1)** — uma fase que ja
//    concluiu (done/abandoned/inconclusive) sobre o MESMO assunto so roda de
//    novo com `confirmReopen: true` explicito. Sem isso, o disparo recusa —
//    nunca gera run novo silenciosamente sobre trabalho que ja tem desfecho.
// 5. **Trava por RECURSO DE ESCRITA (A8/A20)** — alem da trava por assunto
//    (2, acima), o disparo tambem recusa quando o REPO+CAMINHO FISICO que a
//    fase vai tocar ja esta ocupado por OUTRO assunto (irmao). E o buraco que
//    a trava por assunto nao fecha: P32 e exatamente "worker rodou na arvore
//    principal enquanto outra sessao comitava nela — commits entrelacados na
//    mesma branch", entre DOIS assuntos diferentes. Ver `store/lockChain.ts`
//    (`resourceConflicts`) para a regra completa.
// 6. **Segunda sessao VIVA no mesmo item+fase e recusada (B3)** — rede de
//    seguranca para quando a trava (2) ja caiu por outro caminho (ex.:
//    `releaseLock` manual sem a sessao ter terminado) mas a sessao anterior
//    ainda esta aberta (`endedAt: null`). Duas sessoes vivas do MESMO
//    assunto+fase e exatamente o caos que a trava deveria impedir sozinha.
//
// O que este modulo NAO faz: abrir aba, montar linha de comando, falar com o
// PTY. Ele deixa em disco o `run-input.json` e devolve os caminhos; quem
// executa e a camada de UI/terminal.

import { existsSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildRunInput, type RunInputWorkspace } from '../shared/esteira/contract/runInput';
import type { ContractIssue } from '../shared/esteira/contract/parsing';
import type { EventDraft } from '../shared/esteira/ingest/resultToEvents';
import { findBlockingLock, findResourceLock, lockChainOf } from '../shared/esteira/store/lockChain';
import { orphanedSessionCandidates } from '../shared/esteira/store/reconcile';
import type { EntityId, LockRecord, LockResource, PhaseRunSnapshot, SessionSnapshot } from '../shared/esteira/store/storeFormat';
import type { EsteiraStore } from './esteira-store';

/** Irmao do outbox: `~/.claude/esteira-donel/{inbox,outbox}`. Home LOCAL — nunca OneDrive. */
export const ESTEIRA_INBOX_DIR_ENV_VAR = 'DONEL_ESTEIRA_INBOX_DIR';

export function esteiraInboxDir(env: Record<string, string | undefined>, homedirFn: () => string): string {
  const override = env[ESTEIRA_INBOX_DIR_ENV_VAR];
  return override && override.trim() ? override : join(homedirFn(), '.claude', 'esteira-donel', 'inbox');
}

export interface DispatchOptions {
  readonly phase: string;
  readonly discoveryId: string;
  readonly planId?: string | null;
  readonly workItemId?: string | null;
  /** Alvo EXPLICITO. `null`/ausente so quando a fase nao toca repo nenhum. */
  readonly workspace?: RunInputWorkspace | null;
  readonly inboxDir: string;
  readonly outboxDir: string;
  /** `[P-6]` — sessao anterior da MESMA fase, quando esta nasce de handoff por contexto. */
  readonly continuesSessionId?: string | null;
  readonly handoffReason?: string | null;
  readonly cwd?: string | null;
  readonly model?: string | null;
  readonly effort?: string | null;
  /**
   * A21 — `true` so quando model/effort foram aplicados por DEFAULT, sem
   * confirmacao explicita de quem disparou (o anuncio pre-disparo saiu, mas o
   * disparo nao esperou resposta — P33). `false` (o default) cobre os dois
   * casos sem ambiguidade: nem model/effort foram declarados, nem houve
   * decisao assumida sem confirmar. Vira `session.modelEffortAssumed` — a
   * decisao do app fica registrada de forma explicita, nunca implicita no
   * silencio do campo.
   */
  readonly modelEffortAssumed?: boolean;
  /**
   * A1 — confirma a REABERTURA explicita de uma fase que ja concluiu
   * (done/abandoned/inconclusive) sobre o MESMO assunto. Default `false`:
   * redisparo de fase done e RECUSADO sem este sinal, para nunca gerar run
   * novo por engano sobre trabalho que ja tem desfecho.
   */
  readonly confirmReopen?: boolean;
  readonly now?: () => string;
  readonly newId?: (prefix: string) => string;
}

export type DispatchResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly sessionId: string;
      /** Onde o `run-input.json` foi gravado. */
      readonly inputPath: string;
      /** Onde a skill deve devolver o `result.json` — o mesmo valor que viaja dentro do input. */
      readonly resultPath: string;
    }
  | { readonly ok: false; readonly reason: 'locked'; readonly lock: LockRecord }
  /** A8/A20 — o REPO+CAMINHO que esta fase tocaria ja esta ocupado por outro assunto (irmao). */
  | { readonly ok: false; readonly reason: 'resource-busy'; readonly lock: LockRecord }
  /** A1 — a fase ja concluiu sobre este assunto; redisparar exige `confirmReopen: true`. */
  | { readonly ok: false; readonly reason: 'phase-done'; readonly phase: PhaseRunSnapshot }
  /** B3 — ja existe uma sessao VIVA (sem `endedAt`) para este MESMO assunto+fase. */
  | { readonly ok: false; readonly reason: 'session-active'; readonly session: SessionSnapshot }
  | { readonly ok: false; readonly reason: 'invalid-target'; readonly issues: readonly ContractIssue[] }
  | { readonly ok: false; readonly reason: 'store-refused' | 'write-failed' };

/** A8/A20 — deriva o RECURSO de um workspace (`null` = fase sem repo, nada a ocupar). */
function resourceOf(workspace: RunInputWorkspace | null | undefined): LockResource | null {
  if (!workspace) return null;
  return {
    targetRepo: workspace.target_repo,
    branch: workspace.branch ?? null,
    treePath: workspace.worktree_path ?? workspace.repo_path ?? null,
  };
}

/** O assunto do disparo, do mais especifico para o mais amplo (mesma regra da ingestao). */
function subjectOf(options: DispatchOptions): EntityId {
  if (options.workItemId) return { entity: 'work_item', id: options.workItemId };
  if (options.planId) return { entity: 'plan', id: options.planId };
  return { entity: 'discovery', id: options.discoveryId };
}

/** Escrita atomica: o `run-input.json` e reescrito por inteiro (ao contrario do log). */
function writeJsonAtomic(path: string, data: unknown): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fd = openSync(tmpPath, 'w');
  try {
    writeSync(fd, JSON.stringify(data, null, 2), null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort
    }
    throw error;
  }
}

export function dispatchPhase(store: EsteiraStore, options: DispatchOptions): DispatchResult {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
  const at = now();
  const subject = subjectOf(options);

  // 1. A trava primeiro: o assunto — ou algo acima dele na cadeia — ja esta
  //    sendo trabalhado?
  const snapshot = store.snapshot();
  const held = findBlockingLock(snapshot.locks, lockChainOf(subject, { discoveryId: options.discoveryId, planId: options.planId }));
  if (held !== null) return { ok: false, reason: 'locked', lock: held };

  // 1b. A1 — a fase JA CONCLUIU sobre este MESMO assunto? Redisparo silencioso
  //     de fase done nunca gera run novo — precisa de `confirmReopen: true`.
  //     So o assunto EXATO conta aqui (nao a cadeia inteira): uma fase done do
  //     discovery nao deve impedir redisparo comum de uma fase de item, que e
  //     um assunto diferente.
  const donePhase = snapshot.phases.find(
    (entry) =>
      entry.subject.entity === subject.entity &&
      entry.subject.id === subject.id &&
      entry.phase === options.phase &&
      entry.completedAt !== null,
  );
  if (donePhase !== undefined && !options.confirmReopen) return { ok: false, reason: 'phase-done', phase: donePhase };

  // 1c. A8/A20 — trava por RECURSO: o repo+caminho fisico que esta fase vai
  //     tocar ja esta ocupado por outro assunto (irmao)? A trava de assunto
  //     (1, acima) nao ve isto — ela so olha o MESMO assunto ou ancestral.
  const resource = resourceOf(options.workspace);
  if (resource !== null) {
    const resourceLock = findResourceLock(snapshot.locks, resource);
    if (resourceLock !== null) return { ok: false, reason: 'resource-busy', lock: resourceLock };
  }

  // 1d. B3 — uma sessao VIVA (`endedAt: null`) ja existe para este MESMO
  //     assunto+fase, mesmo sem trava (ex.: `releaseLock` chamado a mao sem a
  //     sessao ter terminado). Duas sessoes vivas do mesmo par seriam duas
  //     abas concorrentes tocando o mesmo trabalho — o mesmo modo de falha
  //     que a trava existe para impedir, so que pelo lado da sessao.
  //
  //     EXCECAO deliberada: `[P-6]` handoff por orcamento de contexto e
  //     exatamente uma sessao nova CONTINUANDO a viva encontrada aqui —
  //     `options.continuesSessionId` apontando pra ela e o sinal explicito de
  //     que nao e uma segunda sessao concorrente, e sim a MESMA cadeia. Sem
  //     esta excecao, nenhum handoff jamais conseguiria redisparar (a sessao
  //     anterior so recebe `endedAt` de um evento SEPARADO, que pode chegar
  //     antes ou depois deste disparo).
  const liveSession = snapshot.sessions.find(
    (entry) =>
      entry.subject.entity === subject.entity &&
      entry.subject.id === subject.id &&
      entry.phase === options.phase &&
      entry.endedAt === null &&
      entry.id !== options.continuesSessionId,
  );
  if (liveSession !== undefined) return { ok: false, reason: 'session-active', session: liveSession };

  // 2. O documento que a skill vai receber. Recusar aqui e o certo: disparar
  //    com contexto pela metade e o app afirmando o que nao sabe, na ida.
  const runId = newId('run');
  const resultPath = join(options.outboxDir, `${runId}.json`);
  const built = buildRunInput(snapshot, {
    runId,
    phase: options.phase,
    requestedAt: at,
    discoveryId: options.discoveryId,
    planId: options.planId ?? null,
    workItemId: options.workItemId ?? null,
    workspace: options.workspace ?? null,
    resultPath,
    continuesSessionId: options.continuesSessionId ?? null,
    handoffReason: options.handoffReason ?? null,
  });
  if (!built.ok) return { ok: false, reason: 'invalid-target', issues: built.issues };

  // 3. Grava o input ANTES dos eventos: se o disco falhar, nao fica trava sem
  //    trabalho correspondente — o modo de falha que D-V3 combatia.
  const inputPath = join(options.inboxDir, `${runId}.json`);
  try {
    if (!existsSync(options.inboxDir)) mkdirSync(options.inboxDir, { recursive: true });
    if (!existsSync(options.outboxDir)) mkdirSync(options.outboxDir, { recursive: true });
    writeJsonAtomic(inputPath, built.input);
  } catch {
    return { ok: false, reason: 'write-failed' };
  }

  // 4. Os fatos: trava, fase iniciada e sessao.
  const sessionId = newId('ses');
  const drafts: EventDraft[] = [
    {
      type: 'lock.acquired',
      at,
      dedupe_key: `${runId}:lock.acquired`,
      payload: {
        subject,
        phase: options.phase,
        holderKind: 'app',
        acquiredAt: at,
        cliSessionId: null,
        mirroredLabel: null,
        // A8/A20 — o mesmo recurso computado no passo 1c, para o disparo
        // SEGUINTE (de um assunto irmao) enxergar o que este ocupou.
        resource,
      },
    },
    {
      type: 'phase.started',
      at,
      dedupe_key: `${runId}:phase.started`,
      payload: { subject, phase: options.phase, at, runId },
    },
    {
      type: 'session.started',
      at,
      dedupe_key: `${runId}:session.started`,
      payload: {
        id: sessionId,
        cliSessionId: null,
        subject,
        phase: options.phase,
        continuesSessionId: options.continuesSessionId ?? null,
        handoffReason: options.handoffReason ?? null,
        cwd: options.cwd ?? null,
        model: options.model ?? null,
        effort: options.effort ?? null,
        // A21 — a escolha de model/effort registrada como decisao ASSUMIDA
        // quando ninguem confirmou explicitamente (P33: o anuncio pre-disparo
        // saiu, mas o disparo nao esperou resposta). O resto (pausar de fato,
        // esperar override) e comportamento de skill/cockpit — aqui so o
        // registro explicito da decisao.
        modelEffortAssumed: options.modelEffortAssumed ?? false,
        startedAt: at,
        // A tela precisa destes dois para dizer o que fazer a seguir enquanto
        // o disparo nao abre a aba de terminal sozinho.
        inputPath,
        resultPath,
      },
    },
  ];

  const written = store.append(drafts);
  if (!written.ok) {
    // O input ja esta em disco, mas sem trava nem sessao ninguem vai executa-lo.
    // Limpa para nao deixar um disparo fantasma esperando no inbox.
    try {
      unlinkSync(inputPath);
    } catch {
      // best-effort
    }
    return { ok: false, reason: 'store-refused' };
  }

  return { ok: true, runId, sessionId, inputPath, resultPath };
}

/** `changed: false` = o fato ja estava no log; ninguem precisa ser avisado de novo. */
export type SessionLifecycleResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: 'store-refused' };

/**
 * Batch B1 — alguem ASSUMIU a sessao preparada. Quem chama e a camada que abriu
 * a aba, assim que o CLI devolve o id da sessao (`pty:create` o impoe no spawn,
 * entao ele existe desde o primeiro instante da aba).
 *
 * E por causa deste fato que o card pode dizer "em andamento" sem mentir: ate
 * ele chegar, o que houve foi o app separar um arquivo em disco.
 */
export function claimSession(
  store: EsteiraStore,
  sessionId: string,
  cliSessionId: string,
  now: () => string = () => new Date().toISOString(),
): SessionLifecycleResult {
  const session = store.snapshot().sessions.find((entry) => entry.id === sessionId);
  // Sessao que nao existe (ou ja assumida pelo MESMO id) nao vira fato — o log
  // registra o que aconteceu, nao toda vez que alguem perguntou.
  if (session === undefined || session.cliSessionId === cliSessionId) return { ok: true, changed: false };

  const at = now();
  const written = store.append([
    {
      type: 'session.claimed',
      at,
      dedupe_key: `${sessionId}:session.claimed:${cliSessionId}`,
      payload: { id: sessionId, cliSessionId, at },
    },
  ]);
  return written.ok ? { ok: true, changed: true } : { ok: false, reason: 'store-refused' };
}

/**
 * Batch B1 — a sessao acabou sem a fase concluir: tipicamente a aba fechada na
 * mao. Dois fatos no mesmo gesto, e o segundo e o que importa:
 *
 * - `session.ended` — a sessao acabou, com o motivo;
 * - `lock.released` — **a trava cai junto**. A trava e fato com dono, hora e
 *   SESSAO (D-11); sem a sessao ela nao tem dono, e trava sem dono e exatamente
 *   a trava orfa da evidencia 3 da spec, que prendia o card ate alguem rodar
 *   `/esteira-liberar`.
 *
 * A fase continua registrada como iniciada e nao concluida — e a tela diz isso
 * com todas as letras. Apagar o registro seria trocar uma inverdade por outra.
 */
export function endSession(
  store: EsteiraStore,
  sessionId: string,
  reason: string | null,
  now: () => string = () => new Date().toISOString(),
): SessionLifecycleResult {
  const snapshot = store.snapshot();
  const session = snapshot.sessions.find((entry) => entry.id === sessionId);
  // Fase ja concluida (ou falhada) encerra a sessao no reducer: chegar aqui
  // depois disso e o caso NORMAL de quem fecha a aba com o trabalho pronto.
  if (session === undefined || session.endedAt !== null) return { ok: true, changed: false };

  const at = now();
  const drafts: EventDraft[] = [
    { type: 'session.ended', at, dedupe_key: `${sessionId}:session.ended`, payload: { id: sessionId, at, reason } },
  ];

  const holdsLock = snapshot.locks.some(
    (lock) => lock.phase === session.phase && lock.subject.entity === session.subject.entity && lock.subject.id === session.subject.id,
  );
  if (holdsLock) {
    drafts.push({
      type: 'lock.released',
      at,
      dedupe_key: `${sessionId}:lock.released`,
      payload: { subject: session.subject, phase: session.phase, at },
    });
  }

  const written = store.append(drafts);
  return written.ok ? { ok: true, changed: true } : { ok: false, reason: 'store-refused' };
}

/** A7 — o motivo gravado no log para uma sessao que a reconciliacao encerrou. */
export const ORPHANED_SESSION_REASON = 'o app foi fechado ou reiniciado antes de o result.json aparecer no outbox';

export interface ReconcileOrphanedSessionsResult {
  /** Quantas sessoes a reconciliacao encerrou. */
  readonly reconciled: number;
}

/**
 * A7 — reconciliacao MANIFESTO-SEM-RESULT: o watcher detecta a fase que
 * morreu entre o manifesto (`run-input.json`, no inbox) e o `result.json`
 * esperado no outbox, e SINALIZA no card — hoje so um humano notava, olhando
 * o card preso em "preparada"/"sessao aberta" para sempre e rodando
 * `/esteira-liberar` a mao.
 *
 * Chamar UMA VEZ, na abertura do app (ver `orphanedSessionCandidates` para o
 * raciocinio de por que isto e seguro sem checar processo nenhum). Para cada
 * candidata: se o `resultPath` NAO existe no disco, a fase morreu sem
 * devolver nada — encerra a sessao (mesmo caminho de `endSession`: a trava
 * cai junto) com um motivo que diz o que aconteceu, e o card passa a mostrar
 * "interrompida" em vez de ficar preso calado.
 *
 * Um `resultPath` que EXISTE nao e mexido aqui, mesmo que ainda nao tenha sido
 * ingerido: a proxima varredura do outbox decide o desfecho dele, com o rigor
 * do contrato — nao esta funcao, que so pergunta "existe alguma coisa la?".
 */
export function reconcileOrphanedSessions(
  store: EsteiraStore,
  options: { readonly resultExists?: (resultPath: string) => boolean; readonly now?: () => string } = {},
): ReconcileOrphanedSessionsResult {
  const resultExists = options.resultExists ?? existsSync;
  const now = options.now ?? (() => new Date().toISOString());

  let reconciled = 0;
  for (const session of orphanedSessionCandidates(store.snapshot())) {
    if (session.resultPath === null || resultExists(session.resultPath)) continue;
    const ended = endSession(store, session.id, ORPHANED_SESSION_REASON, now);
    if (ended.ok && ended.changed) reconciled += 1;
  }
  return { reconciled };
}

export type ReleaseResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'store-refused' };

/**
 * D-11 — liberar a trava e um GESTO: um evento no log, com hora. Nao ha arquivo
 * para apagar nem etiqueta remota para conciliar; a trava que ninguem consegue
 * soltar (o modo de falha da v2) deixa de ser possivel por construcao.
 */
export function releaseLock(store: EsteiraStore, subject: EntityId, phase: string, now: () => string = () => new Date().toISOString()): ReleaseResult {
  const at = now();
  const written = store.append([
    { type: 'lock.released', at, dedupe_key: null, payload: { subject, phase, at } },
  ]);
  return written.ok ? { ok: true } : { ok: false, reason: 'store-refused' };
}
