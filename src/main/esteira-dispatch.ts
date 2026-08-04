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
// O que este modulo NAO faz: abrir aba, montar linha de comando, falar com o
// PTY. Ele deixa em disco o `run-input.json` e devolve os caminhos; quem
// executa e a camada de UI/terminal.

import { existsSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildRunInput, type RunInputWorkspace } from '../shared/esteira/contract/runInput';
import type { ContractIssue } from '../shared/esteira/contract/parsing';
import type { EventDraft } from '../shared/esteira/ingest/resultToEvents';
import type { EntityId, LockRecord } from '../shared/esteira/store/storeFormat';
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
  | { readonly ok: false; readonly reason: 'invalid-target'; readonly issues: readonly ContractIssue[] }
  | { readonly ok: false; readonly reason: 'store-refused' | 'write-failed' };

/** O assunto do disparo, do mais especifico para o mais amplo (mesma regra da ingestao). */
function subjectOf(options: DispatchOptions): EntityId {
  if (options.workItemId) return { entity: 'work_item', id: options.workItemId };
  if (options.planId) return { entity: 'plan', id: options.planId };
  return { entity: 'discovery', id: options.discoveryId };
}

/**
 * O assunto e seus ancestrais na cadeia (item → plano → discovery). A trava
 * vale para toda a cadeia PARA CIMA, e para nenhum irmao:
 *
 * - discovery em andamento trava o plano e os itens que descendem dele — o card
 *   inteiro esta sendo trabalhado, e disparar a fase seguinte no meio disso e o
 *   atropelo que a trava existe para impedir;
 * - dois ITENS do mesmo plano rodam em paralelo sem problema — sao assuntos
 *   irmaos, e o modelo novo quer justamente esse paralelismo (D-5/D-7).
 */
function lockChainOf(subject: EntityId, options: DispatchOptions): readonly EntityId[] {
  const chain: EntityId[] = [subject];
  if (subject.entity === 'work_item' && options.planId) chain.push({ entity: 'plan', id: options.planId });
  if (subject.entity !== 'discovery') chain.push({ entity: 'discovery', id: options.discoveryId });
  return chain;
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
  const chain = lockChainOf(subject, options);
  const held = snapshot.locks.find((lock) => chain.some((entry) => entry.entity === lock.subject.entity && entry.id === lock.subject.id));
  if (held !== undefined) return { ok: false, reason: 'locked', lock: held };

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
        startedAt: at,
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
