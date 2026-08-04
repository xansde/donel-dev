// Spec 010 (D-11, D-12) — O QUE espelhar no tracker, e quando. Modulo PURO:
// recebe o snapshot e a configuracao, devolve intencoes. Nao fala com board,
// nao le disco, nao lanca.
//
// Tres regras que este modulo existe para cumprir:
//
// 1. **Espelho so no card de origem** (D-12). Discovery sem `tracker` nao tem
//    espelho — o tracker e plugue opcional, e um card que ninguem plugou nao e
//    um card com pendencia.
// 2. **O espelho e PROJECAO de fato local.** A intencao sai do que o store ja
//    sabe (trava, etapa derivada, fase concluida); nunca do que o board diz. O
//    board e destino, jamais fonte (D-1).
// 3. **So o que MUDOU entra na fila.** `mirrorSynced` e a memoria do que o
//    board ja reflete; sem ela, a mesma etiqueta voltaria para a fila a cada
//    gesto e o card mostraria "espelho pendente" para trabalho ja espelhado.
//
// Publicar item como card no tracker NAO mora aqui: e gesto explicito, de outra
// fase (D-12 — "itens nao viram cards automaticamente").

import type { EventDraft } from '../ingest/resultToEvents';
import type { EntityId, LockRecord, MirrorQueueEntry, PhaseRunSnapshot, StoreSnapshot } from '../store/storeFormat';
import type { MirrorConfig } from './mirrorConfig';

export type MirrorOperationKind = 'label' | 'column' | 'comment';

export interface MirrorIntent {
  /** Sempre o discovery de origem: e nele que o card do tracker existe. */
  readonly subject: EntityId;
  readonly provider: string;
  readonly cardId: string;
  /** Chave natural: `label`, `column` ou `comment:<run_id>`. */
  readonly operation: string;
  readonly kind: MirrorOperationKind;
  readonly payload: Record<string, unknown>;
}

const COMMENT_PREFIX = 'comment:';

/** Qual das tres operacoes do adapter esta operacao pede. `null` = nao sei espelhar isto. */
export function mirrorOperationKind(operation: string): MirrorOperationKind | null {
  if (operation === 'label') return 'label';
  if (operation === 'column') return 'column';
  if (operation.startsWith(COMMENT_PREFIX) && operation.length > COMMENT_PREFIX.length) return 'comment';
  return null;
}

function sameSubject(a: EntityId, b: { readonly entity: string; readonly id: string }): boolean {
  return a.entity === b.entity && a.id === b.id;
}

/** Comparacao de conteudo por serializacao estavel — os payloads sao rasos e pequenos. */
function samePayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * O comentario de conclusao, "resumindo o que nasceu" (D-12). O texto nasce
 * AQUI, na camada pura, pelo mesmo motivo que o texto da tela nasce em
 * `esteiraView.ts`: corrigir a palavra na frase onde ela apareceu garante a
 * proxima aparicao noutro lugar.
 */
function commentText(phase: PhaseRunSnapshot, planCount: number, itemCount: number): string {
  if (phase.failure !== null) {
    return `Fase ${phase.phase} falhou: ${phase.failure.code}${phase.failure.message ? ` — ${phase.failure.message}` : ''}. Registrado pelo Donel Dev.`;
  }

  const outcome =
    phase.outcome === 'abandoned' ? 'abandonada' : phase.outcome === 'inconclusive' ? 'terminou sem conclusão' : 'concluída';
  const nascidos = [
    `${planCount} ${planCount === 1 ? 'plano' : 'planos'}`,
    `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`,
  ].join(', ');
  const resumo = phase.summary === null ? '' : ` ${phase.summary}`;

  return `Fase ${phase.phase} ${outcome}: ${nascidos}.${resumo} Registrado pelo Donel Dev.`;
}

/**
 * A chave do comentario: a CONCLUSAO que ele descreve, nao o ultimo run que
 * tocou a fase. Disparar de novo uma fase ja concluida atualiza o `lastRunId`
 * sem mudar a conclusao — chavear por ele mandaria o MESMO comentario duas
 * vezes ao board. Concluir de novo (outra conclusao, outro `completedAt`) e que
 * merece comentario novo.
 */
function commentOperation(phase: PhaseRunSnapshot): string {
  const conclusion = phase.completedAt ?? phase.lastRunId ?? 'sem-marca';
  return `${COMMENT_PREFIX}${phase.subject.entity}:${phase.subject.id}:${phase.phase}:${conclusion}`;
}

/** As intencoes de espelho do snapshot inteiro — ja descontado o que o board reflete. */
export function mirrorIntents(snapshot: StoreSnapshot, config: MirrorConfig): readonly MirrorIntent[] {
  if (!config.enabled) return [];

  const intents: MirrorIntent[] = [];

  for (const discovery of snapshot.discoveries) {
    const tracker = discovery.tracker;
    // Sem card no tracker, nao ha o que espelhar. E sem o provider do adapter,
    // espelhar seria mandar um fato para o board errado.
    if (tracker === null || tracker.provider !== config.provider) continue;

    const subject: EntityId = { entity: 'discovery', id: discovery.id };
    const plans = snapshot.plans.filter((plan) => plan.discoveryId === discovery.id);
    const items = snapshot.workItems.filter((item) => item.discoveryId === discovery.id);
    const owned = new Set<string>([
      `discovery:${discovery.id}`,
      ...plans.map((plan) => `plan:${plan.id}`),
      ...items.map((item) => `work_item:${item.id}`),
    ]);
    const belongs = (entry: { readonly entity: string; readonly id: string }): boolean => owned.has(`${entry.entity}:${entry.id}`);

    const push = (operation: string, kind: MirrorOperationKind, payload: Record<string, unknown>): void => {
      const synced = snapshot.mirrorSynced.find((entry) => sameSubject(subject, entry.subject) && entry.operation === operation);
      // O que o board ja reflete nao volta para a fila.
      if (synced !== undefined && samePayload(synced.payload, payload)) return;
      intents.push({ subject, provider: tracker.provider, cardId: tracker.cardId, operation, kind, payload });
    };

    // 1. Etiqueta — o espelho da trava local (D-11). A trava continua sendo o
    //    fato no log; a etiqueta e cortesia para quem olha o board.
    if (config.phaseLabelPrefix.length > 0) {
      const lock: LockRecord | undefined = snapshot.locks.find((entry) => belongs(entry.subject));
      const labels = lock === undefined ? [] : [`${config.phaseLabelPrefix}${lock.phase}`];
      const syncedLabel = snapshot.mirrorSynced.find(
        (entry) => sameSubject(subject, entry.subject) && entry.operation === 'label',
      );
      // Limpar etiqueta que nunca foi posta seria uma chamada de rede para
      // dizer nada — so vale quando o board de fato tem o que limpar.
      if (labels.length > 0 || syncedLabel !== undefined) push('label', 'label', { labels });
    }

    // 2. Coluna — movimentacao pelas MACRO ETAPAS (D-12). O override manual
    //    manda: se o humano ajustou a etapa, e essa que o board deve mostrar.
    const effectiveStage = discovery.stageOverride?.value ?? discovery.derivedStage;
    const column = config.columnByStage[effectiveStage];
    if (column !== undefined) push('column', 'column', { column });

    // 3. Comentario de conclusao — um por run que terminou (bem ou mal). Fase
    //    que falhou tambem comenta: o board nao pode achar que nada aconteceu.
    for (const phase of snapshot.phases) {
      if (!belongs(phase.subject)) continue;
      if (phase.completedAt === null && phase.failure === null) continue;
      push(commentOperation(phase), 'comment', {
        text: commentText(phase, plans.length, items.length),
        phase: phase.phase,
      });
    }
  }

  return intents;
}

/**
 * As linhas de `mirror.queued` que faltam gravar. Intencao ja enfileirada com o
 * MESMO conteudo nao vira linha nova (o log nao incha a cada gesto); intencao
 * que mudou vira, e o reducer atualiza o conteudo preservando as tentativas.
 */
export function pendingMirrorDrafts(snapshot: StoreSnapshot, config: MirrorConfig, at: string): readonly EventDraft[] {
  const drafts: EventDraft[] = [];

  for (const intent of mirrorIntents(snapshot, config)) {
    const queued = snapshot.mirrorQueue.find(
      (entry) => sameSubject(intent.subject, entry.subject) && entry.operation === intent.operation,
    );
    if (queued !== undefined && samePayload(queued.payload, intent.payload)) continue;

    drafts.push({
      type: 'mirror.queued',
      at,
      // Sem `dedupe_key`: a mesma operacao PODE voltar com conteudo novo, e o
      // filtro de conteudo acima e quem impede a repeticao inutil.
      dedupe_key: null,
      payload: {
        subject: intent.subject,
        operation: intent.operation,
        payload: intent.payload,
        provider: intent.provider,
        cardId: intent.cardId,
        queuedAt: at,
      },
    });
  }

  return drafts;
}

export function mirrorSyncedDraft(entry: MirrorQueueEntry, at: string): EventDraft {
  return {
    type: 'mirror.synced',
    at,
    dedupe_key: null,
    payload: { subject: entry.subject, operation: entry.operation, payload: entry.payload, at },
  };
}

export function mirrorFailedDraft(entry: MirrorQueueEntry, error: string, at: string): EventDraft {
  return {
    type: 'mirror.failed',
    at,
    dedupe_key: null,
    payload: { subject: entry.subject, operation: entry.operation, payload: entry.payload, error, at },
  };
}
