// Spec 010 — vertical pequeno, passo 2: o SERVICO da esteira no main. E a
// unica peca que sabe, ao mesmo tempo, do store, do outbox e da tela:
//
//   boot          → abre o store e varre o outbox (trabalho feito com o app
//                   fechado nao se perde)
//   watcher       → `fs.watch` no outbox; arquivo novo entra sozinho
//   gestos da UI  → criar discovery, disparar fase, liberar trava
//
// Tudo o que ele devolve para a tela e o SNAPSHOT derivado — a tela e projecao
// (D-13): nao calcula etapa, nao le disco, nao inventa card. E o que a skill
// devolveu quebrado chega como `ingestErrors`, nunca como ausencia.
//
// Nunca lanca: falha de I/O vira estado recusado, com a razao, do mesmo jeito
// que o store faz.

import { watch, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dispatchPhase, releaseLock } from './esteira-dispatch';
import { ingestOutbox } from './esteira-ingest';
import { openEsteiraStore, type EsteiraStore } from './esteira-store';
import { parseSeedDocument, seedToEvents } from '../shared/esteira/store/seed';
import type {
  CreateDiscoveryIpcInput,
  DispatchIpcInput,
  EsteiraCreateDiscoveryDto,
  EsteiraDispatchDto,
  EsteiraSeedDto,
  EsteiraSnapshotDto,
  ReleaseLockIpcInput,
  SeedIpcInput,
} from '../shared/esteira/ipc';

export interface EsteiraServiceOptions {
  readonly storeDir: string;
  readonly inboxDir: string;
  readonly outboxDir: string;
  readonly channel?: string | null;
  readonly now?: () => string;
  readonly newId?: (prefix: string) => string;
  /** Espera antes de reler o outbox depois de um evento do watcher (arquivo ainda sendo escrito). */
  readonly debounceMs?: number;
}

export interface EsteiraService {
  snapshotDto(): EsteiraSnapshotDto;
  scanOutbox(): EsteiraSnapshotDto;
  createDiscovery(input: CreateDiscoveryIpcInput): EsteiraCreateDiscoveryDto;
  /** D-2 — planta um discovery que ja existe, marcado como SEMEADO (afirmacao, nao observacao). */
  seed(input: SeedIpcInput): EsteiraSeedDto;
  dispatch(input: DispatchIpcInput): EsteiraDispatchDto;
  releaseLock(input: ReleaseLockIpcInput): EsteiraSnapshotDto;
  /** Registra quem quer saber que o store mudou. Devolve a desinscricao. */
  startWatching(listener: (state: EsteiraSnapshotDto) => void): () => void;
  dispose(): void;
}

/** `dsc-2026-08-04-a1b2` — o padrao do contrato nao aceita underscore. */
function defaultNewId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

export function createEsteiraService(options: EsteiraServiceOptions): EsteiraService {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? defaultNewId;
  const debounceMs = options.debounceMs ?? 250;

  const store: EsteiraStore = openEsteiraStore({ dir: options.storeDir, channel: options.channel ?? null, now });

  const listeners = new Set<(state: EsteiraSnapshotDto) => void>();
  let watcher: FSWatcher | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;
  let disposed = false;
  let rejectedOnLastScan = 0;

  function snapshotDto(): EsteiraSnapshotDto {
    return {
      snapshot: store.snapshot(),
      compatibility: store.compatibility,
      storeDir: options.storeDir,
      inboxDir: options.inboxDir,
      outboxDir: options.outboxDir,
      rejectedOnLastScan,
    };
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const state = snapshotDto();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // Um ouvinte que quebra nao pode derrubar o servico — a janela pode ter
        // sumido no meio do caminho.
      }
    }
  }

  function scanOutbox(): EsteiraSnapshotDto {
    const before = store.events.length;
    const summary = ingestOutbox(store, options.outboxDir);
    rejectedOnLastScan = summary.rejected;
    if (store.events.length !== before) {
      store.persistSnapshot();
      notify();
    }
    return snapshotDto();
  }

  // Boot: o que a skill deixou com o app fechado entra agora.
  scanOutbox();

  function openWatch(): void {
    if (disposed || watcher) return;
    try {
      watcher = watch(options.outboxDir, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        // O arquivo pode estar no meio da escrita: reler cedo demais so produz
        // um `invalid_json` que se resolveria sozinho.
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          if (!disposed) scanOutbox();
        }, debounceMs);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = undefined;
      });
    } catch {
      // Sem watcher, o app degrada para varredura manual/boot — nunca falha.
      watcher = undefined;
    }
  }

  function startWatching(listener: (state: EsteiraSnapshotDto) => void): () => void {
    listeners.add(listener);
    openWatch();
    return () => {
      listeners.delete(listener);
    };
  }

  function createDiscovery(input: CreateDiscoveryIpcInput): EsteiraCreateDiscoveryDto {
    const at = now();
    // O APP gera `discovery_id` e `plan_id`; a skill gera `work_item_id` dos
    // itens que cria. Assim a raiz existe ANTES do primeiro disparo — e o
    // `run-input.json` tem o que carregar.
    const discoveryId = newId('dsc');

    const written = store.append([
      {
        type: 'discovery.created',
        at,
        dedupe_key: null,
        payload: {
          id: discoveryId,
          title: input.title.trim(),
          problem: input.problem === null || input.problem === undefined ? null : input.problem.trim() || null,
          tracker: input.tracker === null || input.tracker === undefined ? null : { provider: input.tracker.provider, cardId: input.tracker.cardId },
          targetRepo: input.targetRepo === null || input.targetRepo === undefined ? null : input.targetRepo.trim() || null,
          scopeRepos: input.scopeRepos ?? [],
          createdAt: at,
        },
      },
    ]);

    if (!written.ok) return { ok: false, reason: 'store-refused', state: snapshotDto() };

    store.persistSnapshot();
    notify();
    return { ok: true, discoveryId, state: snapshotDto() };
  }

  /**
   * D-2 — o seed. O store nasce limpo e continua nascendo: isto NAO le o modelo
   * antigo nem importa legado. E o operador descrevendo, num documento so, o
   * trabalho que ja existe e o ponto em que ele esta.
   *
   * Duas disciplinas:
   *
   * 1. **Documento fora do formato nao escreve NADA.** A recusa vem com o
   *    caminho do campo — "sem edicao manual as cegas" e isto, e nao um erro
   *    generico depois de meia gravacao.
   * 2. **A proveniencia vai para o DISCO**, no `source` do evento. Se ela so
   *    existisse na tela, o proximo leitor do log leria afirmacao como
   *    observacao — que e o erro que a spec 010 inteira existe para extinguir.
   */
  function seed(input: SeedIpcInput): EsteiraSeedDto {
    const parsed = parseSeedDocument(input.document);
    if (!parsed.ok) return { ok: false, reason: 'invalid-seed', issues: parsed.issues, state: snapshotDto() };

    const planted = seedToEvents(parsed.seed, { at: now(), newId });
    const written = store.append(planted.events, { kind: 'seed' });
    if (!written.ok) return { ok: false, reason: 'store-refused', state: snapshotDto() };

    store.persistSnapshot();
    notify();
    return {
      ok: true,
      discoveryId: planted.discoveryId,
      planIds: planted.planIds,
      workItemIds: planted.workItemIds,
      state: snapshotDto(),
    };
  }

  function dispatch(input: DispatchIpcInput): EsteiraDispatchDto {
    const result = dispatchPhase(store, {
      phase: input.phase,
      discoveryId: input.discoveryId,
      planId: input.planId,
      workItemId: input.workItemId,
      workspace: input.workspace,
      inboxDir: options.inboxDir,
      outboxDir: options.outboxDir,
      continuesSessionId: input.continuesSessionId,
      handoffReason: input.handoffReason,
      now,
      newId,
    });

    if (!result.ok) {
      // Recusa nao muda o store — devolve o estado de agora, com a razao.
      return { ...result, state: snapshotDto() } as EsteiraDispatchDto;
    }

    store.persistSnapshot();
    notify();
    return { ...result, state: snapshotDto() };
  }

  function releaseLockGesture(input: ReleaseLockIpcInput): EsteiraSnapshotDto {
    const released = releaseLock(store, input.subject, input.phase, now);
    if (released.ok) {
      store.persistSnapshot();
      notify();
    }
    return snapshotDto();
  }

  function dispose(): void {
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = undefined;
    watcher?.close();
    watcher = undefined;
    listeners.clear();
  }

  return { snapshotDto, scanOutbox, createDiscovery, seed, dispatch, releaseLock: releaseLockGesture, startWatching, dispose };
}
