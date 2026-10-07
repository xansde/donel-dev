// Spec 010 (D-9) — FORMATO do store local da Esteira. Este modulo define o que
// esta gravado em disco e como se le o cabecalho; ele NAO reduz eventos, nao
// deriva snapshot e nao toca fs. Reducer, derivacao e watcher sao do vertical
// pequeno (cadencia D-15, passo 2) — aqui e passo zero.
//
// Layout, dentro do `userData` do app (compartilhado entre os tres canais, como
// ja e hoje por decisao de 28/07):
//
//   <userData>/esteira/
//     events.jsonl      append-only; linha 1 e o cabecalho, demais linhas sao eventos
//     snapshot.json     derivado, descartavel; reconstruivel apagando o arquivo
//
// Arquivo PROPRIO, fora do `config.json` e portanto fora do sanitizador de
// config — canal antigo nao reescreve por cima do que nao entende (o risco
// aceito em 28/07 que este formato fecha).
//
// Regra de compatibilidade, o coracao do formato: o canal compara o MAJOR do
// `schema_version` do cabecalho com o seu. Igual: le e escreve. Maior:
// **le o que consegue e nao escreve** — nunca reescreve, nunca trunca, nunca
// "conserta". Menor (arquivo antigo): le, e a escrita so e liberada apos
// migracao explicita, que e append de um novo cabecalho, nunca reescrita.
//
// Sem SQLite de proposito: dependencia nativa esbarraria na ABI do Electron a
// cada atualizacao, o mesmo custo que o node-pty ja impoe.

/** Versao do esquema do store que este app escreve. */
export const STORE_SCHEMA_VERSION = '1.0.0';

export const STORE_DIR_NAME = 'esteira';
export const STORE_EVENTS_FILE = 'events.jsonl';
export const STORE_SNAPSHOT_FILE = 'snapshot.json';

// ---------------------------------------------------------------------------
// Cabecalho
// ---------------------------------------------------------------------------

export interface StoreHeader {
  readonly kind: 'esteira.store.header';
  readonly schema_version: string;
  readonly created_at: string;
  /** Canal que criou o arquivo (`alfa` | `beta` | `stable`), so para diagnostico. */
  readonly created_by_channel: string | null;
}

export type StoreCompatibility =
  /** Mesmo major: leitura e escrita liberadas. */
  | 'read-write'
  /** Major a frente do que este canal conhece: le o que conseguir, NUNCA escreve. */
  | 'read-only'
  /** Major atras: leitura ok, escrita so depois de migracao explicita. */
  | 'needs-migration'
  /** Cabecalho ausente ou ilegivel: nao da para afirmar nada; nao escreve. */
  | 'unreadable';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function majorOf(version: string): number | null {
  if (!SEMVER_PATTERN.test(version)) return null;
  return Number.parseInt(version.split('.')[0], 10);
}

/** Le a linha 1 do `events.jsonl`. Nunca lanca; `null` = cabecalho ausente/ilegivel. */
export function parseStoreHeader(line: string | null | undefined): StoreHeader | null {
  if (typeof line !== 'string' || line.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const node = parsed as Record<string, unknown>;
  if (node.kind !== 'esteira.store.header') return null;
  if (typeof node.schema_version !== 'string' || !SEMVER_PATTERN.test(node.schema_version)) return null;
  if (typeof node.created_at !== 'string' || node.created_at.length === 0) return null;

  return {
    kind: 'esteira.store.header',
    schema_version: node.schema_version,
    created_at: node.created_at,
    created_by_channel: typeof node.created_by_channel === 'string' ? node.created_by_channel : null,
  };
}

/** A decisao de "posso escrever aqui?" — a unica pergunta que o cabecalho existe para responder. */
export function storeCompatibility(header: StoreHeader | null, appSchemaVersion: string = STORE_SCHEMA_VERSION): StoreCompatibility {
  if (header === null) return 'unreadable';
  const fileMajor = majorOf(header.schema_version);
  const appMajor = majorOf(appSchemaVersion);
  if (fileMajor === null || appMajor === null) return 'unreadable';
  if (fileMajor === appMajor) return 'read-write';
  return fileMajor > appMajor ? 'read-only' : 'needs-migration';
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/**
 * De onde o evento veio. `ingest` carrega o `run_id` do `result.json`: e o que
 * torna a ingestao idempotente — reprocessar o mesmo arquivo nao duplica fato.
 * `seed` e o caminho explicito de D-2 para plantar discoveries em andamento sem
 * edicao manual as cegas.
 */
export type EventSource =
  | { readonly kind: 'app' }
  | { readonly kind: 'ingest'; readonly run_id: string; readonly result_path: string }
  | { readonly kind: 'seed' };

export const STORE_EVENT_TYPES = [
  'discovery.created',
  'discovery.updated',
  'plan.created',
  'work_item.created',
  'work_item.updated',
  /**
   * D-16 — item nascido pela skill, descartado num gesto. O evento fica no log
   * e a entidade sai do snapshot. A LAPIDE (`DiscardedItemTombstone`) esta
   * DECLARADA e ainda nao derivada: hoje o item some sem nada dizendo que
   * existiu, e "por que este item sumiu?" nao tem resposta na tela.
   */
  'work_item.discarded',
  'relation.added',
  'relation.removed',
  'artifact.pinned',
  'verification.updated',
  'phase.started',
  'phase.completed',
  /**
   * Run que terminou mal (`status` != `success` no `result.json`). Existe porque
   * o contrato so exige `phase.completed` de run bem-sucedido: sem este evento,
   * uma fase que falhou ficaria indistinguivel de uma que nunca rodou — a
   * inverdade que a spec 010 extingue. Carrega `failure.code`/`message`.
   */
  'phase.failed',
  'session.started',
  /**
   * Alguem ASSUMIU a sessao preparada: o CLI devolveu o id dela. Existe como
   * fato proprio porque "o app separou o contexto" e "a fase esta rodando" sao
   * estados diferentes, e chama-los pelo mesmo nome e o vicio que a spec 010
   * combate — so que na direcao contraria. Da dono a trava tambem (D-11).
   */
  'session.claimed',
  'session.ended',
  /** `[P-6]` — a sessao atingiu o teto de contexto e a MESMA fase seguiu noutra sessao. */
  'session.handed-off',
  'lock.acquired',
  'lock.released',
  /**
   * A9 — alguem confirmou uma condicao de gate. Fato de primeira classe porque
   * a confirmacao vivia como blockquote no `tasks.md`, onde gate composto nao
   * expressa meia-confirmacao: uma condicao confirmada e outra em aberto viravam
   * a mesma frase. Skills e specs consultam o STORE.
   */
  'gate.confirmed',
  /** A18 — uma decisao tomada na fase, com quem a confirmou. Irma de `gate.confirmed`: gate confirma condicao, decisao escolhe caminho. */
  'decision.recorded',
  /** A10/A19 — a lista do que sobrou para uma PESSOA conferir ou fazer, no lugar de uma frase enterrada no `summary`. */
  'human_review.recorded',
  'stage.overridden',
  'stage.override.cleared',
  'note.added',
  /**
   * A4 — o LIVRO DOS RUNS: um run entrou, com a impressao digital do que ele
   * declarava. E o que permite distinguir "o mesmo arquivo, relido" (dedupe
   * normal) de "o mesmo run, reescrito com outro desfecho" — que a `dedupe_key`
   * sozinha nao distingue, e por isso engoliu em silencio a revisao da Concluir.
   */
  'run.ingested',
  'ingest.failed',
  /**
   * DECLARADO, NAO IMPLEMENTADO (contrato para o batch da ingestao sanavel).
   *
   * Um `result.json` que tinha sido RECUSADO passou a ser legivel — porque a
   * skill reemitiu uma versao corrigida, ou porque uma passada de saneamento o
   * recuperou. O evento existe para que a recuperacao seja um FATO, e nao o
   * apagamento do erro anterior: o `ingest.failed` continua no log, e este diz
   * que ele foi superado. Apagar o erro seria o app reescrevendo a propria
   * historia — o mesmo silencio que a spec 010 extingue, com sinal trocado.
   *
   * O reducer NAO trata este tipo ainda: ele cai no `default` e e preservado
   * sem derivacao, exatamente como o formato promete para evento de canal mais
   * novo. Quem o reduz e quem for implementar `IngestRecovery`.
   */
  'ingest.recovered',
  /**
   * F26 — a anistia do outbox historico. Um `ingest.failed` que o parser NOVO
   * emitiria para um `run_id` JA CONSTANTE no livro (`run.ingested`) vira isto
   * em vez daquilo: revalidacao/re-scan so LIMPA a tela, nunca SUJA um run que
   * ja foi ingerido legitimamente por um contrato mais antigo. Diferente de
   * `ingest.recovered` (que supera um `ingest.failed` ja gravado), este evento
   * substitui o `ingest.failed` que SERIA emitido agora — o log nunca chega a
   * ganhar a linha de erro.
   */
  'ingest.amnestied',
  'mirror.queued',
  'mirror.synced',
  'mirror.failed',
] as const;

export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

/**
 * Envelope de UM evento — uma linha do `events.jsonl`. O `payload` e tipado por
 * `type` no reducer (vertical pequeno); aqui e opaco de proposito: o envelope
 * precisa ser legivel por um canal que nao conhece o payload, para cumprir
 * "ignora o que nao entende, nunca apaga historico".
 */
export interface StoreEvent {
  /** Monotonico, comeca em 1. Ordem de gravacao — nao confundir com `at`. */
  readonly seq: number;
  readonly event_id: string;
  readonly at: string;
  readonly type: string;
  readonly source: EventSource;
  /**
   * Chave natural do fato. Dois eventos com a mesma `dedupe_key` sao o MESMO
   * fato: o segundo e descartado na leitura. E o que permite reingerir um
   * `result.json` sem medo.
   */
  readonly dedupe_key: string | null;
  readonly payload: Record<string, unknown>;
}

export type ParseEventLine =
  | { readonly ok: true; readonly event: StoreEvent }
  | { readonly ok: false; readonly reason: 'blank' | 'invalid_json' | 'not_an_event' };

/**
 * Le UMA linha de evento. Nunca lanca. Linha ilegivel devolve `ok: false` e o
 * chamador segue para a proxima — "le o que consegue" e comportamento do
 * formato, nao tratamento de erro do leitor.
 */
export function parseEventLine(line: string): ParseEventLine {
  if (line.trim().length === 0) return { ok: false, reason: 'blank' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not_an_event' };
  }

  const node = parsed as Record<string, unknown>;
  if (typeof node.seq !== 'number' || !Number.isInteger(node.seq) || node.seq < 1) return { ok: false, reason: 'not_an_event' };
  if (typeof node.event_id !== 'string' || node.event_id.length === 0) return { ok: false, reason: 'not_an_event' };
  if (typeof node.at !== 'string' || node.at.length === 0) return { ok: false, reason: 'not_an_event' };
  if (typeof node.type !== 'string' || node.type.length === 0) return { ok: false, reason: 'not_an_event' };

  const source = parseSource(node.source);
  if (source === null) return { ok: false, reason: 'not_an_event' };

  const payload = typeof node.payload === 'object' && node.payload !== null && !Array.isArray(node.payload)
    ? (node.payload as Record<string, unknown>)
    : {};

  return {
    ok: true,
    event: {
      seq: node.seq,
      event_id: node.event_id,
      at: node.at,
      type: node.type,
      source,
      dedupe_key: typeof node.dedupe_key === 'string' ? node.dedupe_key : null,
      payload,
    },
  };
}

function parseSource(raw: unknown): EventSource | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const node = raw as Record<string, unknown>;
  if (node.kind === 'app') return { kind: 'app' };
  if (node.kind === 'seed') return { kind: 'seed' };
  if (node.kind === 'ingest') {
    if (typeof node.run_id !== 'string' || node.run_id.length === 0) return null;
    if (typeof node.result_path !== 'string' || node.result_path.length === 0) return null;
    return { kind: 'ingest', run_id: node.run_id, result_path: node.result_path };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot derivado
// ---------------------------------------------------------------------------

export type EntityKind = 'discovery' | 'plan' | 'work_item';
export type RelationKind = 'originated' | 'flows_into' | 'ships_with';
export type WorkItemType = 'issue' | 'spec' | 'process-map' | 'adr' | 'prototype' | 'spike' | 'eval';

/** D-4 — o que varia de verdade e o que significa terminar. Tipo e metadado; ciclo e regra. */
export type LifecycleKind = 'code-delivery' | 'reviewed-artifact' | 'answered-question';

export type WorkItemState = 'open' | 'in-progress' | 'done' | 'abandoned';

/** D-13 — macro etapas do card de origem, sempre CALCULADAS do grafo. */
export type MacroStage = 'discovery' | 'planned' | 'execution' | 'done';

/**
 * As duas listas moram AQUI, com o formato, porque tres camadas precisam da
 * mesma: o reducer (para ler o payload do disco), a fronteira IPC (para validar
 * o gesto antes de mutar) e a tela (para oferecer as opcoes). Duas copias da
 * mesma lista sao exatamente o desencontro entre camadas que originou a spec.
 */
export const WORK_ITEM_STATES: readonly WorkItemState[] = ['open', 'in-progress', 'done', 'abandoned'];
export const MACRO_STAGES: readonly MacroStage[] = ['discovery', 'planned', 'execution', 'done'];

export interface EntityId {
  readonly entity: EntityKind;
  readonly id: string;
}

export interface TrackerRef {
  readonly provider: string;
  readonly cardId: string;
}

/** D-8 — o ponteiro do artefato; a resposta unica de "cade o artefato?". */
export interface ArtifactPointer {
  readonly owner: EntityId;
  readonly artifactKind: string;
  readonly location: 'repo' | 'disk';
  readonly repo: string | null;
  readonly path: string;
  readonly recordedAt: string;
}

/**
 * A8/A20 — o RECURSO DE ESCRITA que um disparo ocupa: o repo e o caminho
 * FISICO que a fase vai tocar (a worktree dedicada, ou a arvore principal na
 * ausencia dela). E um alcance DIFERENTE de `LockRecord.subject`: o subject e
 * "quem" (o card/plano/item); o recurso e "onde no disco" — e dois assuntos
 * IRMAOS (D-5/D-7, paralelismo desejado) podem ocupar o MESMO recurso sem que
 * a trava de assunto veja problema nenhum, porque ela nunca olha os dois ao
 * mesmo tempo.
 *
 * `branch` viaja para EXIBICAO (o card consegue dizer "branch X ocupada"),
 * mas NAO decide conflito sozinho — ver `resourceConflicts` em
 * `store/lockChain.ts` para o porque (nem sempre é conhecida hoje, e tratá-la
 * como curinga quebraria o paralelismo de irmãos que a spec pede).
 */
export interface LockResource {
  readonly targetRepo: string;
  readonly branch: string | null;
  /**
   * `worktree_path`, ou `repo_path` na ausencia dele — o caminho que este run
   * de fato toca. `null` quando nem isso e conhecido: tratado, na checagem de
   * conflito, como a arvore principal/compartilhada — o caso mais arriscado
   * (P32/A20), e o default hoje (`worktree_path` ainda vem `null` na pratica).
   */
  readonly treePath: string | null;
}

/** D-11 — a trava e local e e FATO: dono, hora e sessao, visivel no card, liberavel num gesto. Nunca arquivo `.lock` solto, nunca so etiqueta remota. */
export interface LockRecord {
  readonly subject: EntityId;
  readonly phase: string;
  readonly holderKind: 'skill' | 'app';
  readonly acquiredAt: string;
  readonly cliSessionId: string | null;
  /** Espelho no board, quando o adapter esta ligado (D-12). Nunca condiciona a trava local. */
  readonly mirroredLabel: string | null;
  /** A8/A20 — `null` quando a fase nao declarou workspace (no repo nenhum a ocupar). */
  readonly resource: LockResource | null;
}

export interface StageOverride {
  readonly value: MacroStage;
  readonly by: string;
  readonly at: string;
  readonly reason: string | null;
}

/**
 * D-2 — de onde veio o que este registro afirma:
 *
 *   SEMEADO   (`true`)  = afirmacao de uma pessoa, plantada pelo gesto de seed
 *   DECLARADO (`false`) = fato observado, que uma skill gravou num `result.json`
 *
 * Os dois viram evento no mesmo log e a etapa se deriva igual de ambos — mas
 * NAO sao a mesma coisa, e a tela precisa poder mostrar cada um pelo que e.
 * Tratar afirmacao como observacao seria a inverdade da spec 010 por uma porta
 * nova: o app afirmando como visto o que ninguem viu.
 *
 * Duas regras diferentes, por natureza diferente:
 *
 * - **Entidade** (discovery, plano, item): a marca e da ORIGEM e nao se apaga.
 *   Um card plantado a mao continua tendo nascido de uma afirmacao, ainda que
 *   uma skill declare fatos sobre ele depois.
 * - **Fase**: a marca segue o ULTIMO fato, porque a fase e um estado de agora.
 *   Fase semeada e depois de fato executada passa a ser observada.
 */
export type SeededFlag = boolean;

export interface DiscoverySnapshot {
  readonly id: string;
  readonly title: string;
  readonly problem: string | null;
  /** D-1 — referencia guardada, jamais consultada para saber estado. */
  readonly tracker: TrackerRef | null;
  /** D-6 — alvo default herdado pelos itens; pode ser null (discovery investiga problema, nao repo). */
  readonly targetRepo: string | null;
  readonly scopeRepos: readonly string[];
  readonly createdAt: string;
  /** D-13 — SEMPRE presente, sempre calculada. */
  readonly derivedStage: MacroStage;
  /** Sinais visiveis no card; `completed-without-plan` e o estado do card F3 da evidencia 1. */
  readonly stageSignals: readonly ('completed-without-plan' | 'orphan-item' | 'ingest-error' | 'mirror-pending')[];
  /** Override manual, sempre marcado como tal — `derivedStage` continua visivel ao lado. */
  readonly stageOverride: StageOverride | null;
  /** D-2 — o card foi PLANTADO a mao (afirmacao), nao declarado por skill (observacao). */
  readonly seeded: SeededFlag;
}

export interface PlanSnapshot {
  readonly id: string;
  readonly discoveryId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly createdAt: string;
  /** D-2 — o plano foi semeado junto com o card, em vez de declarado por uma skill. */
  readonly seeded: SeededFlag;
}

export interface WorkItemSnapshot {
  readonly id: string;
  /**
   * Ancoragem OBRIGATORIA: todo item nasce dentro de um discovery (o
   * `subject.discovery_id` do run que o declarou). Sem isso, um item sem plano
   * — que e legitimo — nao teria onde aparecer, e some da tela: exatamente o
   * modo de falha que a spec extingue.
   */
  readonly discoveryId: string;
  readonly planId: string | null;
  readonly itemType: WorkItemType;
  readonly lifecycle: LifecycleKind;
  readonly title: string;
  /** D-6 — `issue` tem exatamente um; sem ele, nao dispara. */
  readonly targetRepo: string | null;
  readonly scopeRepos: readonly string[];
  readonly state: WorkItemState;
  /** True quando nasceu pela skill (D-16) — descartavel num gesto, sem bloqueio. */
  readonly createdBySkill: boolean;
  readonly createdAt: string;
  /**
   * D-2 — o item foi semeado. Note que `seeded` e `createdBySkill` respondem
   * perguntas diferentes: um item semeado nunca nasceu pela skill, mas um item
   * que nao nasceu pela skill tambem pode ter vindo de um run declarado.
   */
  readonly seeded: SeededFlag;
}

/**
 * Cada sessao de terminal, amarrada a um ALVO e a UMA fase. `[P-6]`, em duas
 * regras que nao se misturam:
 *
 * 1. **Mudou de fase, mudou de sessao** — sempre. A fase e a fronteira dura, e
 *    e o que mantem a historia do card reconstruivel.
 * 2. **Dentro da MESMA fase**, o que decide abrir outra sessao e o ORCAMENTO DE
 *    CONTEXTO (alvo: nunca passar de ~400k tokens). Trabalho extra que cabe
 *    (um prototipo barato, ou algo delegavel a subagente sem sujar o contexto)
 *    fica onde esta; rodada que estouraria o contexto vira handoff.
 *
 * Daí `continuesSessionId`: uma fase pode ter N sessoes encadeadas, e a
 * historia dela e a cadeia, nunca um registro perdido.
 */
export interface SessionSnapshot {
  readonly id: string;
  readonly cliSessionId: string | null;
  readonly subject: EntityId;
  /** A fase desta sessao. Uma so — trocar de fase abre sessao nova. */
  readonly phase: string;
  /** Sessao anterior da MESMA fase, quando esta nasceu de handoff por contexto. `null` = comeco da cadeia. */
  readonly continuesSessionId: string | null;
  /** Por que houve handoff — texto curto, so quando `continuesSessionId` existe. */
  readonly handoffReason: string | null;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  /**
   * A21 — `true` quando `model`/`effort` foram aplicados por DEFAULT, sem
   * confirmacao explicita de quem disparou (P33: o anuncio pre-disparo saiu,
   * mas o disparo seguiu no mesmo turno, sem esperar override). `false` cobre
   * tanto "sem model/effort nenhum" quanto "escolha confirmada" — os dois sao
   * decisao explicita, so o terceiro caso e assumido. E o app registrando a
   * proveniencia da PRÓPRIA decisao, o mesmo espirito de `SeededFlag` para
   * entidades vindas de seed.
   */
  readonly modelEffortAssumed: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /**
   * A7 — por que ESTA sessao terminou, quando `session.ended` (nao handoff) o
   * disse. Existe porque `endSession` sempre recebeu um `reason`, mas ate aqui
   * so `session.handed-off` o guardava (em `handoffReason`) — uma sessao
   * encerrada pela reconciliacao de boot ("o app reiniciou sem o result
   * aparecer") ficava com o motivo escrito no log e invisivel no snapshot.
   * `null` = ninguem declarou motivo (ex.: aba fechada antes desta causa existir).
   */
  readonly endReason: string | null;
  /**
   * O `run-input.json` que o app deixou para esta sessao, e o `result.json` que
   * ela deve devolver. Ficam no snapshot porque a TELA precisa deles: enquanto
   * o disparo nao abre a aba de terminal sozinho, e por estes caminhos que o
   * operador roda a fase — e uma tela que trava o card sem dizer o que fazer a
   * seguir e uma tela que promete o que nao cumpre.
   */
  readonly inputPath: string | null;
  readonly resultPath: string | null;
  /**
   * `true` quando alguem de fato assumiu a sessao (a skill declarou o
   * `cli_session_id`). Enquanto for `false`, a fase esta PREPARADA, nao "em
   * andamento" — sao coisas diferentes, e chamar as duas pelo mesmo nome e o
   * mesmo vicio que a spec 010 combate, so que na direcao contraria.
   */
  readonly claimed: boolean;
}

export interface RelationSnapshot {
  readonly relation: RelationKind;
  readonly from: EntityId;
  readonly to: EntityId;
  readonly recordedAt: string;
}

export type PhaseOutcome = 'done' | 'abandoned' | 'inconclusive';

/**
 * Uma passagem de uma fase por um assunto. E daqui que a macro etapa se deriva
 * (D-13) — e e por existir como REGISTRO que "a fase discovery terminou sem
 * plano" e distinguivel de "a fase nunca rodou". Sem este registro, ausencia
 * volta a ser lida como "nao aconteceu", que e o bug de 03/08.
 */
export interface PhaseRunSnapshot {
  readonly subject: EntityId;
  readonly phase: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: PhaseOutcome | null;
  readonly summary: string | null;
  /** Preenchido por `phase.failed`: o desfecho ruim precisa ser LEGIVEL, com codigo e motivo. */
  readonly failure: { readonly code: string; readonly message: string } | null;
  /** Ultimo run que tocou esta fase — a trilha de volta ao `result.json` que a produziu. */
  readonly lastRunId: string | null;
  /** A16 — o risco que esta fase classificou. `null` = ela nao classificou. */
  readonly risk: PhaseRisk | null;
  /** A15 — o canal em que esta fase entregou (`alfa`, `beta`, `stable`). `null` = a fase nao declarou. */
  readonly channel: string | null;
  /**
   * D-2 — o ULTIMO fato desta fase foi semeado (afirmado), nao observado. A
   * fase e estado de agora: um run de verdade em cima de uma fase semeada tira
   * a marca, porque ai passou a haver observacao.
   */
  readonly seeded: SeededFlag;
}

/** A16 — `e2e-manual` e o roteiro rodado A MAO por gente; `check` e o que a maquina roda. */
export type VerificationKind = 'pull-request' | 'check' | 'review' | 'conclusion' | 'e2e-manual';

/** A16 — a regua de aprovacao classificada pela fase. */
export type PhaseRisk = 'trivial' | 'sensivel';
export type VerificationState = 'pending' | 'passed' | 'failed';

/** D-4 — como o ciclo termina. PR e so UMA das formas; ADR e spike terminam de outro jeito. */
export interface VerificationSnapshot {
  readonly subject: EntityId;
  readonly verificationKind: VerificationKind;
  readonly state: VerificationState;
  readonly ref: string | null;
  /** A15 — a base do PR. Num repo com escada de canais, o destino E parte do desfecho. */
  readonly base: string | null;
  readonly recordedAt: string;
}

/**
 * A9 — UMA condicao de gate confirmada por UMA pessoa. Chave natural
 * `subject|condition`: reconfirmar a mesma condicao atualiza quem confirmou e
 * quando, e um gate de duas condicoes ocupa duas linhas — que e exatamente o
 * que o blockquote do `tasks.md` nao sabia fazer.
 */
export interface GateConfirmationSnapshot {
  readonly subject: EntityId;
  readonly condition: string;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

export type HumanReviewKind = 'review' | 'action';
export type HumanReviewState = 'pending' | 'done' | 'waived';

/** A10/A19 — uma linha da lista do humano: confira (`review`) ou faca (`action`). */
export interface HumanReviewItem {
  readonly item: string;
  readonly kind: HumanReviewKind;
  readonly state: HumanReviewState;
  readonly detail: string | null;
}

/**
 * A10 — a lista de UMA fase sobre UM assunto. Chave natural `subject|phase`:
 * redeclarar substitui, porque a lista e o estado de AGORA — uma revisao
 * respondida pela metade nao deve conviver com a versao anterior inteira.
 */
export interface HumanReviewSnapshot {
  readonly subject: EntityId;
  readonly phase: string;
  readonly checklist: readonly HumanReviewItem[];
  readonly at: string;
}

/**
 * A18 — UMA decisao tomada, com quem a confirmou. Chave natural
 * `subject|decision`: redecidir a mesma coisa atualiza quem confirmou; decidir
 * outra coisa e outra linha, porque uma fase toma varias decisoes.
 */
export interface DecisionSnapshot {
  readonly subject: EntityId;
  readonly decision: string;
  readonly confirmedBy: string;
  readonly rationale: string | null;
  readonly at: string;
}

/** Texto humano amarrado a uma entidade. Nunca deduplica por conteudo — duas notas iguais sao dois gestos. */
export interface NoteSnapshot {
  readonly subject: EntityId;
  readonly text: string;
  readonly at: string;
}

/**
 * A4/A13 — um run ja ingerido. O `contentHash` responde "o mesmo run voltou
 * com o mesmo conteudo?"; `complementsRunId`/`revisesRunId` respondem "de quem
 * ele descende?". A segunda pergunta e o que torna desfecho revisto um dado
 * CONSULTAVEL em vez de uma sobrescrita silenciosa.
 */
export interface IngestedRunSnapshot {
  readonly runId: string;
  readonly phase: string;
  readonly kind: string;
  readonly contentHash: string;
  readonly complementsRunId: string | null;
  readonly revisesRunId: string | null;
  readonly subject: EntityId | null;
  readonly resultPath: string | null;
  readonly at: string;
}

/**
 * A6 — a estrutura minima da ingestao sanavel.
 *
 * - `resultPath` e a MESMA chave do `IngestErrorSnapshot` que ela supera — e
 *   por ela que o card sabe qual erro deixou de valer.
 * - `recoveredCodes` diz o que foi sanado, nao "estava tudo bem": a recuperacao
 *   e um fato sobre o documento, nao um perdao retroativo.
 * - `runId` so aparece quando o documento sanado tinha um run legivel; `null` e
 *   um estado honesto, nao um buraco a preencher com palpite.
 * - O `ingest.failed` anterior PERMANECE no log. O snapshot e que para de
 *   mostra-lo como pendente (`reduceEvents` — o path recuperado sai de
 *   `ingestErrors` e entra aqui).
 */
export interface IngestRecovery {
  readonly resultPath: string;
  readonly at: string;
  readonly runId: string | null;
  readonly subject: EntityId | null;
  /** Os codigos de `ContractIssue` que o documento trazia e deixaram de valer. */
  readonly recoveredCodes: readonly string[];
  /** Como foi sanado, em uma frase — "a skill reemitiu", "campo desconhecido descartado". */
  readonly how: string;
}

/**
 * E2 — a LAPIDE de um item descartado.
 *
 * `work_item.discarded` remove a entidade do snapshot e o evento fica so no
 * log: sem a lapide, quem olha o card veria o item sumir, sem nada dizendo que
 * ele existiu. Para um item nascido pela skill (D-16) isso e barato de
 * descartar e caro de explicar depois — "por que este item sumiu?" precisa de
 * resposta na tela.
 *
 * A lapide guarda o MINIMO para responder essa pergunta (o que era, de quem
 * era, quando e por que saiu) e nada alem — ela e um registro de que algo foi
 * descartado, nao uma copia do item para ressuscitar. O item descartado
 * continua FORA de `workItems`; notas, fases e sessoes que apontavam para ele
 * continuam pertencendo ao card (`cardView` inclui a lapide em `owned`).
 */
export interface DiscardedItemTombstone {
  readonly id: string;
  readonly discoveryId: string;
  readonly title: string;
  readonly itemType: WorkItemType;
  readonly discardedAt: string;
  /** Por que saiu, quando quem descartou disse. `null` = ninguem disse, e o card nao inventa. */
  readonly reason: string | null;
}

/**
 * A5 — o CUSTO de um documento recusado: o que ELE declararia, se entrasse.
 * Best-effort e nunca inventado — quando o campo de identidade do fato nao
 * esta la, `id`/`title` ficam `null` em vez de um palpite. Existe porque
 * apontar so o campo que quebrou ("unknown_field em facts[3].fanout") nao diz
 * o que se perde: o dono viveu isso como "nao consigo abrir as tasks", porque
 * os `work_item.recorded` que este arquivo carregava nunca chegaram a existir.
 */
export interface DeclaredFactSummary {
  readonly factType: string;
  /** A entidade que este fato criaria. `null` para fatos que nao criam entidade propria (relacao, verificacao, gate...). */
  readonly entity: EntityKind | null;
  readonly id: string | null;
  readonly title: string | null;
}

/** D-10 — documento fora do contrato vira ERRO visivel no card, nunca silencio. */
export interface IngestErrorSnapshot {
  readonly resultPath: string;
  readonly at: string;
  readonly subject: EntityId | null;
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
  /** A5 — o custo: os fatos que este arquivo declarava, tipo + id, sem entrar no store. */
  readonly declaredFacts: readonly DeclaredFactSummary[];
}

/**
 * F26 — um `resultPath` que o parser novo RECUSARIA, mas que e um run
 * HISTORICO: a anistia e um FATO de migracao (o log registra que o arquivo
 * foi perdoado), nunca silencio. `issues` guarda o que o parser novo
 * apontaria — a auditoria de por que este arquivo teria falhado hoje, se
 * fosse um run novo.
 *
 * `runId` e `null` quando o proprio documento nao tinha um `run.run_id`
 * legivel (a anistia por CORTE DE DATA so precisa do timestamp) — honesto em
 * vez de um palpite, igual `IngestRecovery.runId`.
 */
export interface IngestAmnesty {
  readonly resultPath: string;
  readonly at: string;
  readonly runId: string | null;
  readonly subject: EntityId | null;
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

/** D-12 — o espelho nunca bloqueia: falha vai para fila e o card mostra "espelho pendente". */
export interface MirrorQueueEntry {
  readonly subject: EntityId;
  /** `label` | `column` | `comment:<run_id>` — a chave natural da operacao no card. */
  readonly operation: string;
  /**
   * O QUE mandar ao board. Fica na fila (e portanto no `events.jsonl`) para o
   * reenvio ser auto-contido e auditavel a olho nu: reenviar sem saber o
   * conteudo obrigaria a re-derivar a intencao de um estado que ja mudou.
   */
  readonly payload: Record<string, unknown>;
  readonly queuedAt: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

/**
 * D-12 — o que o board JA reflete. Sem esta memoria, a mesma etiqueta e a mesma
 * coluna voltariam para a fila a cada gesto local, e o card mostraria "espelho
 * pendente" para trabalho que ja foi espelhado — outra forma da tela mentir.
 */
export interface MirrorSyncedEntry {
  readonly subject: EntityId;
  readonly operation: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

export interface StoreSnapshot {
  readonly kind: 'esteira.store.snapshot';
  readonly schema_version: string;
  /** Ate qual `seq` do `events.jsonl` este snapshot foi derivado. Descartavel: apagar o arquivo forca reconstrucao. */
  readonly through_seq: number;
  readonly built_at: string;
  readonly discoveries: readonly DiscoverySnapshot[];
  readonly plans: readonly PlanSnapshot[];
  readonly workItems: readonly WorkItemSnapshot[];
  readonly sessions: readonly SessionSnapshot[];
  readonly relations: readonly RelationSnapshot[];
  readonly artifacts: readonly ArtifactPointer[];
  readonly locks: readonly LockRecord[];
  readonly phases: readonly PhaseRunSnapshot[];
  readonly verifications: readonly VerificationSnapshot[];
  /** A9 — as confirmacoes de gate deste store, uma condicao por registro. */
  readonly gates: readonly GateConfirmationSnapshot[];
  /** A18 — as decisoes tomadas, uma por registro, cada uma com quem a confirmou. */
  readonly decisions: readonly DecisionSnapshot[];
  /** A10/A19 — o que sobrou para uma pessoa conferir ou fazer, por fase. */
  readonly humanReviews: readonly HumanReviewSnapshot[];
  readonly notes: readonly NoteSnapshot[];
  /** A4 — o livro dos runs ingeridos, na ordem em que entraram. */
  readonly runs: readonly IngestedRunSnapshot[];
  /**
   * F26 — todo `run_id` que JA PASSOU pela ingestao, mesmo antes do livro
   * (`runs`/`run.ingested`) existir: qualquer evento cuja origem e
   * `{ kind: 'ingest' }` carrega o `run_id` do documento que o gerou
   * (`EventSource`), e essa e a unica fonte que alcanca os 10 runs
   * pre-ledger do incidente de 05/08 — eles tem fatos no store, mas nunca
   * ganharam um `run.ingested` porque o evento nao existia quando entraram.
   * `runs` (o livro) e um SUBCONJUNTO deste set; a anistia consulta os dois
   * pela mesma razao que consultaria so este.
   */
  readonly knownIngestRunIds: ReadonlySet<string>;
  /** D-10 — erros AINDA pendentes: um path recuperado (A6) sai daqui, nao fica acumulando. */
  readonly ingestErrors: readonly IngestErrorSnapshot[];
  /** A6 — as recuperacoes conhecidas, uma por `resultPath` (a mais recente). */
  readonly ingestRecoveries: readonly IngestRecovery[];
  /**
   * F26 — as anistias conhecidas, uma por `resultPath`. Auditoria, nao sinal
   * de UI: o objetivo e limpar a tela ("nao consegui ler"), nao adicionar um
   * chip novo — o fato fica registrado aqui e no log, nao na tela do card.
   */
  readonly ingestAmnesties: readonly IngestAmnesty[];
  readonly mirrorQueue: readonly MirrorQueueEntry[];
  readonly mirrorSynced: readonly MirrorSyncedEntry[];
  /** E2 — as lapides dos itens descartados, uma por item. */
  readonly tombstones: readonly DiscardedItemTombstone[];
}

/** D-4 — o ciclo de vida de cada tipo. Tabela, nao regra espalhada. */
export const LIFECYCLE_BY_ITEM_TYPE: Readonly<Record<WorkItemType, LifecycleKind>> = {
  issue: 'code-delivery',
  spec: 'code-delivery',
  'process-map': 'reviewed-artifact',
  adr: 'reviewed-artifact',
  prototype: 'answered-question',
  spike: 'answered-question',
  eval: 'answered-question',
};
