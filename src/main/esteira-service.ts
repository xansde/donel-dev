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
import { userInfo } from 'node:os';
import { claimSession, dispatchPhase, endSession, reconcileOrphanedSessions, releaseLock } from './esteira-dispatch';
import { ingestOutbox, revalidateIngestErrors } from './esteira-ingest';
import { drainMirrorQueue, type BoardMirrorAdapter, type MirrorDrainSummary } from './esteira-mirror';
import { openEsteiraStore, type EsteiraStore } from './esteira-store';
import { MIRROR_DISABLED, type MirrorConfig } from '../shared/esteira/mirror/mirrorConfig';
import { pendingMirrorDrafts } from '../shared/esteira/mirror/mirrorPlan';
import { parseSeedDocument, seedToEvents } from '../shared/esteira/store/seed';
import type {
  AddNoteIpcInput,
  ClaimSessionIpcInput,
  CreateDiscoveryIpcInput,
  DiscardWorkItemIpcInput,
  DispatchIpcInput,
  EndSessionIpcInput,
  EsteiraCreateDiscoveryDto,
  EsteiraDispatchDto,
  EsteiraGestureDto,
  EsteiraSeedDto,
  EsteiraSnapshotDto,
  ReleaseLockIpcInput,
  SeedIpcInput,
  SetDiscoveryReposIpcInput,
  SetStageOverrideIpcInput,
  SetWorkItemStateIpcInput,
} from '../shared/esteira/ipc';
import type { EntityId, StoreSnapshot } from '../shared/esteira/store/storeFormat';

export interface EsteiraServiceOptions {
  readonly storeDir: string;
  readonly inboxDir: string;
  readonly outboxDir: string;
  readonly channel?: string | null;
  readonly now?: () => string;
  readonly newId?: (prefix: string) => string;
  /**
   * Em nome de quem o app registra um ajuste manual (D-13: override e sempre
   * MARCADO, e "marcado" sem dono nao serve para nada). Vem do main, nunca do
   * renderer.
   */
  readonly actor?: string;
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
  /** D-2 — planta um discovery que ja existe, marcado como SEMEADO (afirmacao, nao observacao). */
  seed(input: SeedIpcInput): EsteiraSeedDto;
  dispatch(input: DispatchIpcInput): EsteiraDispatchDto;
  /** Batch B1 — a aba abriu e o CLI devolveu o id: a fase preparada vira fase assumida. */
  claimSession(input: ClaimSessionIpcInput): EsteiraSnapshotDto;
  /** Batch B1 — a sessao acabou sem concluir (aba fechada): encerra e solta a trava. */
  endSession(input: EndSessionIpcInput): EsteiraSnapshotDto;
  releaseLock(input: ReleaseLockIpcInput): EsteiraSnapshotDto;
  /** D-13 — forca a macro etapa, ou volta ao calculo com `value: null`. */
  setStageOverride(input: SetStageOverrideIpcInput): EsteiraGestureDto;
  setDiscoveryRepos(input: SetDiscoveryReposIpcInput): EsteiraGestureDto;
  setWorkItemState(input: SetWorkItemStateIpcInput): EsteiraGestureDto;
  discardWorkItem(input: DiscardWorkItemIpcInput): EsteiraGestureDto;
  addNote(input: AddNoteIpcInput): EsteiraGestureDto;
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

/** Quem esta na maquina. Sem nome, `app` — jamais um ajuste sem dono declarado. */
function defaultActor(): string {
  try {
    const name = userInfo().username;
    return name && name.trim() ? name.trim() : 'app';
  } catch {
    return 'app';
  }
}

export function createEsteiraService(options: EsteiraServiceOptions): EsteiraService {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? defaultNewId;
  const actor = options.actor ?? defaultActor();
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

  // A6 — revalida os erros AINDA pendentes depois da varredura acima (ela ja
  // recupera sozinha todo path cujo arquivo continua no outbox e agora passa;
  // isto cobre o outro desfecho — o arquivo nao existe mais).
  const revalidated = revalidateIngestErrors(store);

  // A7 — reconciliacao manifesto-sem-result: sessao que sobrou aberta de uma
  // execucao ANTERIOR do app, sem o `result.json` ter aparecido no outbox.
  // Depois da varredura acima, o que ficou e so o que de fato morreu.
  const reconciledSessions = reconcileOrphanedSessions(store);

  if (revalidated.recovered > 0 || reconciledSessions.reconciled > 0) {
    store.persistSnapshot();
    notify();
    mirrorAfterChange();
  }

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
    // Costura B4×B5: o documento de seed pode declarar `tracker`, e um card
    // com tracker espelha como qualquer outro — semeado nao e isento de board.
    mirrorAfterChange();
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
      // Batch B1 — a sessao guarda ONDE ela abriu. E o mesmo caminho que a aba
      // de terminal recebe: um so alvo, declarado uma vez (D-6).
      cwd: input.workspace?.repo_path ?? null,
      inboxDir: options.inboxDir,
      outboxDir: options.outboxDir,
      continuesSessionId: input.continuesSessionId,
      handoffReason: input.handoffReason,
      model: input.model ?? null,
      effort: input.effort ?? null,
      modelEffortAssumed: input.modelEffortAssumed ?? false,
      confirmReopen: input.confirmReopen ?? false,
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

  function claimSessionFact(input: ClaimSessionIpcInput): EsteiraSnapshotDto {
    const claimed = claimSession(store, input.sessionId, input.cliSessionId, now);
    // Nada mudou (sessao inexistente, ou ja assumida pelo mesmo id): nao avisa
    // ninguem — repintar a tela por um nao-fato e ruido.
    if (claimed.ok && claimed.changed) {
      store.persistSnapshot();
      notify();
    }
    return snapshotDto();
  }

  function endSessionFact(input: EndSessionIpcInput): EsteiraSnapshotDto {
    const ended = endSession(store, input.sessionId, input.reason ?? null, now);
    if (ended.ok && ended.changed) {
      store.persistSnapshot();
      notify();
    }
    return snapshotDto();
  }

  // -------------------------------------------------------------------------
  // Os gestos que so mudam o estado local (B3)
  //
  // Os tres deles seguem a MESMA ordem de guarda, e a ordem importa:
  //
  //   1. o historico aceita escrita?   → nao: `store-refused`
  //   2. a entidade existe?            → nao: `unknown-subject`
  //   3. ha impedimento de modelo?     → sim: a razao propria (`locked`)
  //
  // Checar a compatibilidade ANTES da existencia e deliberado: num store que o
  // app nao consegue ler, tudo "nao existe" — responder `unknown-subject` ali
  // seria o app afirmando que o card sumiu quando o que houve foi nao conseguir
  // ler o historico. E a mesma inverdade da spec, na escrita.
  // -------------------------------------------------------------------------

  function refuse(reason: 'store-refused' | 'unknown-subject' | 'locked'): EsteiraGestureDto {
    return { ok: false, reason, state: snapshotDto() };
  }

  /**
   * Todo gesto commitado passa por aqui: persiste o derivado, avisa a tela e
   * manda o espelho atras (D-12).
   *
   * A ultima linha e a costura entre os dois batches que se encontraram neste
   * merge: os gestos daqui (B3) sao justamente os que MOVEM a macro etapa, e a
   * macro etapa e o que o espelho reflete em coluna (B5). Sem ela, mudar o
   * estado de um item mudava a etapa aqui e o board nunca ficava sabendo — e,
   * pior, sem nada na tela denunciando, que e exatamente o que a spec 010
   * existe para nao deixar acontecer.
   *
   * `void`, como em todo caminho do espelho: board caido nunca segura o gesto.
   */
  function commit(): EsteiraGestureDto {
    store.persistSnapshot();
    notify();
    mirrorAfterChange();
    return { ok: true, state: snapshotDto() };
  }

  function writable(): boolean {
    return store.compatibility === 'read-write';
  }

  function findSubject(snapshot: StoreSnapshot, subject: EntityId): boolean {
    if (subject.entity === 'discovery') return snapshot.discoveries.some((entry) => entry.id === subject.id);
    if (subject.entity === 'plan') return snapshot.plans.some((entry) => entry.id === subject.id);
    return snapshot.workItems.some((entry) => entry.id === subject.id);
  }

  function setStageOverride(input: SetStageOverrideIpcInput): EsteiraGestureDto {
    if (!writable()) return refuse('store-refused');
    const snapshot = store.snapshot();
    if (!findSubject(snapshot, { entity: 'discovery', id: input.discoveryId })) return refuse('unknown-subject');

    const at = now();
    const reason = input.reason === null || input.reason === undefined ? null : input.reason.trim() || null;
    // `value: null` = voltar ao calculado. Dois eventos, um gesto — o ajuste
    // desfeito precisa ser tao barato quanto o ajuste feito.
    const written =
      input.value === null
        ? store.append([{ type: 'stage.override.cleared', at, dedupe_key: null, payload: { discoveryId: input.discoveryId, at } }])
        : store.append([
            {
              type: 'stage.overridden',
              at,
              dedupe_key: null,
              payload: { discoveryId: input.discoveryId, value: input.value, by: actor, at, reason },
            },
          ]);

    return written.ok ? commit() : refuse('store-refused');
  }

  /**
   * D-6 — a ancora e o escopo de um card que ja existe, corrigidos num gesto.
   *
   * Ate 06/08 o repo so podia ser declarado no nascimento do card, num campo de
   * texto livre. Foi assim que nasceu um card com alvo `"spotsys e
   * api-spotsys"` — uma frase nomeando dois servicos, que nao bate com pasta
   * nenhuma —, e nao havia gesto que o consertasse: o card so podia ser
   * abandonado.
   *
   * A normalizacao (apara, deduplica, poe a ancora dentro do escopo) mora na
   * camada pura do renderer (`repoScope.ts`), que e quem a tela usa para avisar
   * ANTES do gesto. Aqui o servico so apara o obvio e grava o fato: duas
   * normalizacoes divergiriam, e divergir significaria a tela aprovar um card
   * que o store guarda diferente.
   */
  function setDiscoveryRepos(input: SetDiscoveryReposIpcInput): EsteiraGestureDto {
    if (!writable()) return refuse('store-refused');
    const snapshot = store.snapshot();
    if (!findSubject(snapshot, { entity: 'discovery', id: input.discoveryId })) return refuse('unknown-subject');

    const at = now();
    const targetRepo = input.targetRepo === null || input.targetRepo === undefined ? null : input.targetRepo.trim() || null;
    const scopeRepos = (input.scopeRepos ?? []).map((repo) => repo.trim()).filter((repo) => repo.length > 0);
    const written = store.append([
      { type: 'discovery.updated', at, dedupe_key: null, payload: { id: input.discoveryId, targetRepo, scopeRepos, at } },
    ]);

    return written.ok ? commit() : refuse('store-refused');
  }

  function setWorkItemState(input: SetWorkItemStateIpcInput): EsteiraGestureDto {
    if (!writable()) return refuse('store-refused');
    const snapshot = store.snapshot();
    const item = snapshot.workItems.find((entry) => entry.id === input.workItemId);
    if (item === undefined) return refuse('unknown-subject');

    const at = now();
    const written = store.append([
      { type: 'work_item.updated', at, dedupe_key: null, payload: { id: item.id, state: input.state, at } },
    ]);

    return written.ok ? commit() : refuse('store-refused');
  }

  function discardWorkItem(input: DiscardWorkItemIpcInput): EsteiraGestureDto {
    if (!writable()) return refuse('store-refused');
    const snapshot = store.snapshot();
    const item = snapshot.workItems.find((entry) => entry.id === input.workItemId);
    if (item === undefined) return refuse('unknown-subject');

    // A unica recusa do descarte, e ela nao e burocracia: a trava e amarrada ao
    // ASSUNTO, e o card so a mostra pelos itens que existem. Descartar um item
    // travado tiraria a trava da tela sem tira-la do estado — a trava orfa e
    // invisivel que `erros-conhecidos.md` #2 ja pagou uma vez.
    if (snapshot.locks.some((lock) => lock.subject.entity === 'work_item' && lock.subject.id === item.id)) return refuse('locked');

    const at = now();
    const reason = input.reason === null || input.reason === undefined ? null : input.reason.trim() || null;
    const written = store.append([
      { type: 'work_item.discarded', at, dedupe_key: null, payload: { id: item.id, at, reason, discardedBy: actor } },
    ]);

    return written.ok ? commit() : refuse('store-refused');
  }

  function addNote(input: AddNoteIpcInput): EsteiraGestureDto {
    if (!writable()) return refuse('store-refused');
    const text = input.text.trim();
    if (text.length === 0) return refuse('unknown-subject');
    if (!findSubject(store.snapshot(), input.subject)) return refuse('unknown-subject');

    const at = now();
    const written = store.append([
      { type: 'note.added', at, dedupe_key: null, payload: { subject: input.subject, text, at, by: actor } },
    ]);

    return written.ok ? commit() : refuse('store-refused');
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
    seed,
    dispatch,
    claimSession: claimSessionFact,
    endSession: endSessionFact,
    releaseLock: releaseLockGesture,
    setStageOverride,
    setDiscoveryRepos,
    setWorkItemState,
    discardWorkItem,
    addNote,
    retryMirror,
    drainMirror: () => drain(false),
    startWatching,
    dispose,
  };
}
