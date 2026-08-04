// Spec 010 (D-11, D-12) — o ESPELHO no tracker: a interface do adapter, o
// adapter fake e a fila com reenvio.
//
// O tracker e plugue OPCIONAL (D-1). Isto aqui e cortesia para quem olha o
// board — nunca sistema de registro, nunca fonte de estado, e principalmente
// **nunca bloqueio**: adapter que recusa, que lanca ou que nem existe deixa o
// trabalho local exatamente onde ele estava. A unica consequencia visivel e o
// card dizer "espelho pendente", com o motivo.
//
// A interface e pequena de proposito — as tres operacoes que a spec nomeia:
//
//   aplicarEtiqueta → applyLabel   (espelho da trava local, D-11)
//   comentar        → comment      (conclusao de fase, "o que nasceu")
//   moverColuna     → moveColumn   (macro etapa → coluna, mapeamento em CONFIG)
//
// (identificadores em ingles, como o resto do repo; os nomes em portugues sao
// os da spec e ficam aqui para o leitor cruzar os dois documentos.)
//
// O adapter REAL do TaskDex nao existe ainda, e e deliberado: a fase 2 tirou o
// board do caminho para que falha de contrato nunca fosse confundida com falha
// de rede. Quem plugar o real implementa esta interface e entra em
// `resolveBoardMirrorAdapter` — nada mais no app precisa mudar.

import { appendFileSync, readFileSync } from 'node:fs';
import { mirrorFailedDraft, mirrorOperationKind, mirrorSyncedDraft } from '../shared/esteira/mirror/mirrorPlan';
import type { MirrorConfig } from '../shared/esteira/mirror/mirrorConfig';
import type { MirrorQueueEntry, StoreSnapshot } from '../shared/esteira/store/storeFormat';
import type { EsteiraStore } from './esteira-store';

/** Resultado de UMA chamada ao board. Nunca excecao: recusa e um valor. */
export type MirrorCallResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface ApplyLabelInput {
  readonly cardId: string;
  /** O conjunto DESEJADO de etiquetas de fase. Vazio = limpar. */
  readonly labels: readonly string[];
}

export interface CommentInput {
  readonly cardId: string;
  readonly text: string;
}

export interface MoveColumnInput {
  readonly cardId: string;
  readonly column: string;
}

export interface BoardMirrorAdapter {
  /** Qual tracker este adapter fala. Precisa casar com o `provider` da configuracao. */
  readonly provider: string;
  applyLabel(input: ApplyLabelInput): Promise<MirrorCallResult>;
  comment(input: CommentInput): Promise<MirrorCallResult>;
  moveColumn(input: MoveColumnInput): Promise<MirrorCallResult>;
}

// ---------------------------------------------------------------------------
// Adapter FAKE — sem rede, sem token
// ---------------------------------------------------------------------------

/** Aponta o adapter fake (mesmo espirito de `DONEL_DEVMODE_BOARD_FIXTURE`). */
export const MIRROR_FAKE_ENV_VAR = 'DONEL_ESTEIRA_MIRROR_FAKE';

export interface FakeBoardOptions {
  readonly provider: string;
  /** JSON de controle: `{ "mode": "ok" | "fail", "error": "..." }`. Ausente = `ok`. */
  readonly controlPath: string;
}

function callsPath(controlPath: string): string {
  return `${controlPath}.calls.jsonl`;
}

/** As chamadas que o fake registrou. E o que prova, num e2e, que nada saiu para a rede. */
export function fakeBoardCalls(controlPath: string): readonly Record<string, unknown>[] {
  let text: string;
  try {
    text = readFileSync(callsPath(controlPath), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

/**
 * Adapter de mentira: le um arquivo de controle antes de cada chamada e
 * registra a chamada num `.calls.jsonl` ao lado. E ele que permite fotografar o
 * board caido e o board de volta no MESMO roteiro, sem depender de rede.
 */
export function createFakeBoardAdapter(options: FakeBoardOptions): BoardMirrorAdapter {
  function decide(operation: string, detail: Record<string, unknown>): MirrorCallResult {
    let mode = 'ok';
    let error = 'o board recusou';
    try {
      const parsed = JSON.parse(readFileSync(options.controlPath, 'utf8')) as Record<string, unknown>;
      if (typeof parsed.mode === 'string') mode = parsed.mode;
      if (typeof parsed.error === 'string' && parsed.error.length > 0) error = parsed.error;
    } catch {
      // Sem arquivo de controle o fake aceita tudo — o caminho feliz e o default.
    }

    if (mode === 'fail') return { ok: false, error };

    try {
      appendFileSync(callsPath(options.controlPath), `${JSON.stringify({ operation, at: new Date().toISOString(), ...detail })}\n`, 'utf8');
    } catch {
      // Registrar a chamada e diagnostico; falhar aqui nao pode virar falha de espelho.
    }
    return { ok: true };
  }

  return {
    provider: options.provider,
    applyLabel: (input) => Promise.resolve(decide('applyLabel', { cardId: input.cardId, labels: [...input.labels] })),
    comment: (input) => Promise.resolve(decide('comment', { cardId: input.cardId, text: input.text })),
    moveColumn: (input) => Promise.resolve(decide('moveColumn', { cardId: input.cardId, column: input.column })),
  };
}

/**
 * Qual adapter esta plugado. Sem configuracao, ou sem fake apontado, o espelho
 * fica DESLIGADO — e nada e enfileirado. Fila que ninguem drena mostraria
 * "espelho pendente" para sempre, que e a tela mentindo por outra porta.
 */
export function resolveBoardMirrorAdapter(
  env: Record<string, string | undefined>,
  config: MirrorConfig,
): BoardMirrorAdapter | null {
  if (!config.enabled) return null;

  const fake = env[MIRROR_FAKE_ENV_VAR];
  if (fake && fake.trim().length > 0) return createFakeBoardAdapter({ provider: config.provider, controlPath: fake });

  // Aqui entra o adapter real quando ele existir (ver cabecalho).
  return null;
}

// ---------------------------------------------------------------------------
// A fila
// ---------------------------------------------------------------------------

export interface MirrorDrainOptions {
  readonly now: () => string;
  /** `0` = sem teto. */
  readonly maxAttempts: number;
  /** Gesto humano de reenvio: ignora o teto de tentativas. */
  readonly force: boolean;
}

export interface MirrorDrainSummary {
  readonly attempted: number;
  readonly synced: number;
  readonly failed: number;
  /** Entradas que o teto de tentativas deixou para o gesto humano. */
  readonly skipped: number;
}

/**
 * Para QUAL card do tracker esta operacao vai. Sai do `tracker` do discovery no
 * snapshot, nunca de uma copia guardada na fila: destino congelado envelhece, e
 * um card que perdeu o tracker precisa parar de ser espelhado, nao continuar
 * indo para o endereco antigo.
 */
function cardIdOf(snapshot: StoreSnapshot, entry: MirrorQueueEntry): string | null {
  if (entry.subject.entity !== 'discovery') return null;
  const discovery = snapshot.discoveries.find((candidate) => candidate.id === entry.subject.id);
  return discovery?.tracker?.cardId ?? null;
}

async function sendOne(adapter: BoardMirrorAdapter, entry: MirrorQueueEntry, cardId: string): Promise<MirrorCallResult> {
  const kind = mirrorOperationKind(entry.operation);
  const payload = entry.payload;

  try {
    if (kind === 'label') {
      const labels = Array.isArray(payload.labels) ? payload.labels.filter((label): label is string => typeof label === 'string') : [];
      return await adapter.applyLabel({ cardId, labels });
    }
    if (kind === 'column') {
      const column = typeof payload.column === 'string' ? payload.column : '';
      if (column.length === 0) return { ok: false, error: 'a operação de coluna chegou sem coluna' };
      return await adapter.moveColumn({ cardId, column });
    }
    if (kind === 'comment') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (text.length === 0) return { ok: false, error: 'a operação de comentário chegou sem texto' };
      return await adapter.comment({ cardId, text });
    }
    // Nunca fingir que mandou o que nao se sabe mandar.
    return { ok: false, error: `não sei espelhar a operação "${entry.operation}"` };
  } catch (error) {
    // Adapter que lanca e adapter que recusa sao a mesma coisa para a fila.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Tenta mandar o que esta na fila. Cada entrada e independente: uma que falha
 * nao impede as outras, e NADA aqui propaga excecao — quem chamou ja fez o
 * trabalho local, e o espelho e o que vem depois.
 */
export async function drainMirrorQueue(
  store: EsteiraStore,
  adapter: BoardMirrorAdapter,
  options: MirrorDrainOptions,
): Promise<MirrorDrainSummary> {
  const snapshot = store.snapshot();
  const entries = snapshot.mirrorQueue;
  let attempted = 0;
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!options.force && options.maxAttempts > 0 && entry.attempts >= options.maxAttempts) {
      skipped += 1;
      continue;
    }

    const cardId = cardIdOf(snapshot, entry);
    const at = options.now();

    if (cardId === null) {
      // Operacao sem card e operacao sem destino: registra o porque em vez de
      // adivinhar um card.
      store.append([mirrorFailedDraft(entry, 'este card não tem referência no tracker', at)]);
      failed += 1;
      continue;
    }

    attempted += 1;
    const result = await sendOne(adapter, entry, cardId);

    if (result.ok) {
      store.append([mirrorSyncedDraft(entry, options.now())]);
      synced += 1;
    } else {
      store.append([mirrorFailedDraft(entry, result.error, options.now())]);
      failed += 1;
    }
  }

  return { attempted, synced, failed, skipped };
}
