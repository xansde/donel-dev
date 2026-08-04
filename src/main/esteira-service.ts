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
import { drainMirrorQueue, type BoardMirrorAdapter, type MirrorDrainSummary } from './esteira-mirror';
import { openEsteiraStore, type EsteiraStore } from './esteira-store';
import { MIRROR_DISABLED, type MirrorConfig } from '../shared/esteira/mirror/mirrorConfig';
import { pendingMirrorDrafts } from '../shared/esteira/mirror/mirrorPlan';
import type {
  CreateDiscoveryIpcInput,
  DispatchIpcInput,
  EsteiraCreateDiscoveryDto,
  EsteiraDispatchDto,
  EsteiraSnapshotDto,
  ReleaseLockIpcInput,
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
  /**
   * D-12 — o espelho no tracker. Ausente, ou com `adapter: null`, o app trabalha
   * exatamente como antes: nenhum fato e enfileirado, nenhum card mostra
   * "espelho pendente". O tracker e plugue, nao requisito.
   */
  readonly mirror?: {
    readonly config: MirrorConfig;
    readonly adapter: BoardMirrorAdapter | null;
  };
}

export interface EsteiraService {
  snapshotDto(): EsteiraSnapshotDto;
  scanOutbox(): EsteiraSnapshotDto;
  createDiscovery(input: CreateDiscoveryIpcInput): EsteiraCreateDiscoveryDto;
  dispatch(input: DispatchIpcInput): EsteiraDispatchDto;
  releaseLock(input: ReleaseLockIpcInput): EsteiraSnapshotDto;
  /**
   * Gesto humano de reenvio do espelho: ignora o teto de tentativas e devolve o
   * estado depois de tentar. E o unico caminho do espelho que ESPERA — porque
   * quem clicou quer o resultado.
   */
  retryMirror(): Promise<EsteiraSnapshotDto>;
  /** A drenagem normal (respeita o teto). Exposta para o teste poder esperar por ela. */
  drainMirror(): Promise<MirrorDrainSummary>;
  /** Registra quem quer saber que o store mudou. Devolve a desinscricao. */
  startWatching(listener: (state: EsteiraSnapshotDto) => void): () => void;
  dispose(): void;
}

const NO_DRAIN: MirrorDrainSummary = { attempted: 0, synced: 0, failed: 0, skipped: 0 };

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
  let ingestedOnLastScan = 0;
  let unreadableOnLastScan = 0;

  function snapshotDto(): EsteiraSnapshotDto {
    return {
      snapshot: store.snapshot(),
      compatibility: store.compatibility,
      storeDir: options.storeDir,
      inboxDir: options.inboxDir,
      outboxDir: options.outboxDir,
      rejectedOnLastScan,
      ingestedOnLastScan,
      unreadableOnLastScan,
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

  // -------------------------------------------------------------------------
  // D-12 — o espelho. Duas metades que NUNCA se misturam com o gesto local:
  // enfileirar (sincrono, so escreve no store) e mandar (assincrono, pode
  // falhar). Nada aqui e esperado por quem fez o gesto.
  // -------------------------------------------------------------------------

  const mirrorConfig: MirrorConfig = options.mirror?.config ?? MIRROR_DISABLED;
  const mirrorAdapter: BoardMirrorAdapter | null = options.mirror?.adapter ?? null;

  /** Grava as intencoes de espelho que faltam. Devolve `true` quando algo mudou. */
  function enqueueMirror(): boolean {
    if (!mirrorConfig.enabled || mirrorAdapter === null) return false;
    const drafts = pendingMirrorDrafts(store.snapshot(), mirrorConfig, now());
    if (drafts.length === 0) return false;
    const written = store.append(drafts);
    return written.ok && written.events.length > 0;
  }

  /**
   * Uma drenagem por vez. Duas rodando juntas (o gesto de reenvio caindo em
   * cima da drenagem automatica de um disparo) contariam a MESMA falha duas
   * vezes e queimariam o teto de tentativas por acidente.
   */
  let draining: Promise<MirrorDrainSummary> = Promise.resolve(NO_DRAIN);

  async function runDrain(force: boolean): Promise<MirrorDrainSummary> {
    if (disposed || !mirrorConfig.enabled || mirrorAdapter === null) return NO_DRAIN;
    const summary = await drainMirrorQueue(store, mirrorAdapter, { now, maxAttempts: mirrorConfig.maxAttempts, force });
    if (summary.synced > 0 || summary.failed > 0) {
      store.persistSnapshot();
      notify();
    }
    return summary;
  }

  function drain(force: boolean): Promise<MirrorDrainSummary> {
    draining = draining.catch(() => NO_DRAIN).then(() => runDrain(force));
    return draining;
  }

  /**
   * Chamado DEPOIS de todo gesto local que ja terminou. O `void` e o ponto: o
   * espelho acontece atras, e board caido nunca segura quem fez o gesto.
   */
  function mirrorAfterChange(): void {
    if (!enqueueMirror()) {
      void drain(false);
      return;
    }
    store.persistSnapshot();
    notify();
    void drain(false);
  }

  function scanOutbox(): EsteiraSnapshotDto {
    const before = store.events.length;
    const summary = ingestOutbox(store, options.outboxDir);
    rejectedOnLastScan = summary.rejected;
    // `alreadyIngested` NAO entra: reler o mesmo arquivo nao e novidade
    // nenhuma, e contar isso faria a tela anunciar mudanca que nao houve.
    ingestedOnLastScan = summary.ingested;
    unreadableOnLastScan = summary.unreadable;
    if (store.events.length !== before) {
      store.persistSnapshot();
      notify();
      mirrorAfterChange();
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
    mirrorAfterChange();
    return { ok: true, discoveryId, state: snapshotDto() };
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
    // A trava acabou de nascer: a etiqueta no board e o reflexo dela (D-11).
    mirrorAfterChange();
    return { ...result, state: snapshotDto() };
  }

  function releaseLockGesture(input: ReleaseLockIpcInput): EsteiraSnapshotDto {
    const released = releaseLock(store, input.subject, input.phase, now);
    if (released.ok) {
      store.persistSnapshot();
      notify();
      mirrorAfterChange();
    }
    return snapshotDto();
  }

  async function retryMirror(): Promise<EsteiraSnapshotDto> {
    if (enqueueMirror()) {
      store.persistSnapshot();
      notify();
    }
    await drain(true);
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

  return {
    snapshotDto,
    scanOutbox,
    createDiscovery,
    dispatch,
    releaseLock: releaseLockGesture,
    retryMirror,
    drainMirror: () => drain(false),
    startWatching,
    dispose,
  };
}
