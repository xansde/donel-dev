// Spec 010 — a lógica PURA da tela da esteira nova: o que aparece em cada card
// e com que palavra. Fica fora do componente para ser testada sem React — e,
// principalmente, porque é aqui que mora a regra que a spec inteira existe para
// impor:
//
//   **O app nunca afirma o que não leu.**
//
// Um card sem plano diz "sem plano registrado", não "não realizada". Um
// `result.json` que não passou no contrato vira "não consegui ler", com o
// caminho do arquivo e o motivo — nunca ausência silenciosa. As duas frases
// são diferentes porque os dois estados são diferentes; confundi-los foi o bug
// de 03/08.

import type { ContractIssue, ContractIssueCode } from '../../../shared/esteira/contract/parsing';
import { MACRO_STAGE_LABEL } from '../../../shared/esteira/ipc';
import { mirrorOperationKind } from '../../../shared/esteira/mirror/mirrorPlan';
import { findBlockingLock, lockChainOf } from '../../../shared/esteira/store/lockChain';
import { LIFECYCLE_BY_ITEM_TYPE, MACRO_STAGES } from '../../../shared/esteira/store/storeFormat';
import { esteiraPhaseCommand, LOCK_WORD, lockStateOf, noLockDispatchHint, type LockState } from './esteiraSession';
import type {
  ArtifactPointer,
  DiscoverySnapshot,
  EntityId,
  IngestErrorSnapshot,
  LifecycleKind,
  LockRecord,
  MacroStage,
  MirrorQueueEntry,
  PhaseRunSnapshot,
  PlanSnapshot,
  SessionSnapshot,
  StoreSnapshot,
  VerificationKind,
  VerificationSnapshot,
  VerificationState,
  WorkItemSnapshot,
  WorkItemState,
} from '../../../shared/esteira/store/storeFormat';

export type SignalTone = 'neutral' | 'attention' | 'error';

export interface SignalView {
  readonly label: string;
  readonly tone: SignalTone;
  readonly title: string;
}

const SIGNAL_VIEW: Readonly<Record<DiscoverySnapshot['stageSignals'][number], SignalView>> = {
  // O card F3 da evidência 1: estado LEGÍTIMO, com nome próprio.
  'completed-without-plan': {
    label: 'sem plano registrado',
    tone: 'neutral',
    title: 'O discovery terminou e nenhum plano foi declarado. É um desfecho possível — não é fase pendente.',
  },
  'orphan-item': {
    label: 'item sem plano',
    tone: 'attention',
    title: 'Há item de trabalho que não pertence a nenhum plano deste card.',
  },
  'ingest-error': {
    label: 'não consegui ler',
    tone: 'error',
    title: 'Um result.json deste card ficou fora do contrato. O que a skill fez não foi perdido — só não foi lido.',
  },
  'mirror-pending': {
    label: 'espelho pendente',
    tone: 'attention',
    // "Está na fila" cobre os dois estados; dizer "falhou" seria afirmar uma
    // tentativa que pode nem ter acontecido ainda.
    title: 'Há espelho esperando na fila do board. O trabalho local já aconteceu e segue normalmente.',
  },
};

export function signalViews(discovery: DiscoverySnapshot): readonly SignalView[] {
  return discovery.stageSignals.map((signal) => SIGNAL_VIEW[signal]);
}

// ---------------------------------------------------------------------------
// D-2 — proveniência: o que foi SEMEADO x o que veio declarado por skill
// ---------------------------------------------------------------------------

/**
 * A marca de proveniência. Existe porque as duas coisas chegam ao mesmo log e
 * derivam a mesma etapa, mas dizem coisas diferentes sobre o mundo:
 *
 *   semeado   → uma pessoa AFIRMOU que isto já existia e está neste ponto
 *   declarado → uma skill OBSERVOU o fato e o gravou num `result.json`
 *
 * Mostrar os dois iguais seria a inverdade da spec 010 por uma porta nova: o
 * app apresentando como visto o que ninguém viu. A marca é sempre a mesma
 * palavra — chip, não frase — para que corrigir o vocabulário seja um lugar só.
 */
export interface ProvenanceMark {
  readonly label: string;
  readonly title: string;
}

export const SEEDED_MARK: ProvenanceMark = {
  label: 'semeado',
  title: 'Plantado à mão: alguém afirmou que isto já existia. Nenhuma skill declarou este fato — o app não o observou.',
};

/** `null` (e não uma marca "declarado") porque o default é o fato observado: só a afirmação precisa se anunciar. */
export function provenanceMark(seeded: boolean): ProvenanceMark | null {
  return seeded ? SEEDED_MARK : null;
}

export const SEEDED_CARD_NOTE =
  'Este card foi semeado: o ponto em que ele está foi afirmado por uma pessoa, não observado de uma execução. O que chegar por skill daqui para frente aparece sem a marca.';

/**
 * Contagem em português, num lugar só. Existia solta dentro de `seededSummary`
 * enquanto o título do bloco de planos escrevia "1 plano(s), 2 item(ns)" no
 * JSX — a mesma grandeza dita de duas formas, e a de fora da camada pura era a
 * feia. Contar é vocabulário: nasce aqui.
 */
function contagem(count: number, singular: string, plural: string, nenhum: string): string {
  if (count === 0) return nenhum;
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

/** O que dizer depois de plantar. Conta o que entrou — e lembra do que aquilo é. */
export function seededSummary(counts: { readonly plans: number; readonly items: number }): string {
  const plans = contagem(counts.plans, 'plano', 'planos', 'nenhum plano');
  const items = contagem(counts.items, 'item', 'itens', 'nenhum item');
  return `Semeado: 1 card, ${plans} e ${items}. Isso é afirmação sua, não fato observado — a tela marca cada um como semeado.`;
}

/**
 * O documento de seed recusado, em português. O parser devolve código + caminho
 * (texto técnico é insumo de log, não de tela); a redação para quem está
 * escrevendo o documento nasce aqui — é o que faz "sem edição manual às cegas"
 * ser verdade, em vez de um `unknown_field` cru.
 */
const SEED_ISSUE_TEXT: Readonly<Partial<Record<ContractIssueCode, string>>> = {
  invalid_json: 'o documento não é JSON válido',
  not_an_object: 'o documento precisa ser um objeto JSON',
  missing_field: 'campo obrigatório ausente',
  unknown_field: 'campo que o seed não conhece',
  wrong_type: 'campo com tipo errado',
  bad_format: 'campo fora do formato',
  not_in_enum: 'valor fora dos aceitos',
  missing_required_fact: 'referência para algo que o documento não declara',
  issue_without_target_repo: 'item do tipo issue precisa de um repo alvo — sem repo, ele nunca poderia ser disparado',
};

export function seedIssueLine(issue: ContractIssue): string {
  const text = SEED_ISSUE_TEXT[issue.code] ?? issue.code;
  return issue.path.length === 0 ? text : `${text} — ${issue.path}`;
}

/**
 * A recusa é veredito sobre UM texto — e por isso anda com ele.
 *
 * O print do passo 9 pegou a tela afirmando "campo obrigatório ausente —
 * discovery.title" logo abaixo de uma textarea onde `title` já estava escrito:
 * a lista sobrevivia à correção e passava a acusar defeito que o documento na
 * frente da pessoa não tinha mais. Uma lista de erros que não se refere ao que
 * está na tela é a mesma inverdade das outras, com outro assunto.
 */
export interface SeedRefusal {
  /** O documento que foi recusado, como foi enviado. */
  readonly document: string;
  readonly issues: readonly ContractIssue[];
}

/** As recusas que AINDA valem para o texto atual — as outras não existem mais. */
export function seedIssuesShown(refusal: SeedRefusal | null, currentDocument: string): readonly ContractIssue[] {
  if (refusal === null) return [];
  return refusal.document.trim() === currentDocument.trim() ? refusal.issues : [];
}

/** Etapa mostrada + se ela é override manual. A derivada NUNCA some da tela (D-13). */
export interface StageView {
  readonly shown: string;
  readonly derived: string;
  readonly overridden: boolean;
  readonly overrideNote: string | null;
  /**
   * A frase INTEIRA do ajuste, com a etapa calculada dentro dela. Existe porque
   * `overrideNote` sozinha dizia quem ajustou e não dizia o que o cálculo diz —
   * e um ajuste sem o cálculo ao lado é exatamente o override que engana quem
   * lê, que D-13 proíbe. `null` quando não há ajuste.
   */
  readonly overrideLine: string | null;
}

export function stageView(discovery: DiscoverySnapshot): StageView {
  const derived = MACRO_STAGE_LABEL[discovery.derivedStage];
  const override = discovery.stageOverride;
  if (override === null) return { shown: derived, derived, overridden: false, overrideNote: null, overrideLine: null };

  const forced = MACRO_STAGE_LABEL[override.value];
  const because = override.reason ? ` — ${override.reason}` : '';
  return {
    shown: forced,
    derived,
    overridden: true,
    overrideNote: `ajustado à mão por ${override.by}${because}`,
    overrideLine: `Etapa forçada para "${forced}" por ${override.by}${because}. O cálculo continua dizendo "${derived}".`,
  };
}

/** As macro etapas que o gesto de ajuste oferece. Ordem do modelo, rótulo em pt-BR. */
export const MACRO_STAGE_OPTIONS: readonly { readonly value: MacroStage; readonly label: string }[] = MACRO_STAGES.map((stage) => ({
  value: stage,
  label: MACRO_STAGE_LABEL[stage],
}));

/** O estado do item em português. O dado é inglês; a tela, não. */
export const WORK_ITEM_STATE_LABEL: Readonly<Record<WorkItemState, string>> = {
  open: 'aberto',
  'in-progress': 'em curso',
  done: 'concluído',
  abandoned: 'abandonado',
};

/**
 * A linha de UM item na lista do card — tudo que ela diz nasce aqui.
 *
 * Os dois batches que reescreveram esta lista pediam coisas diferentes e as duas
 * são verdadeiras ao mesmo tempo:
 *
 *  - **B3**: estado em pt-BR e a origem (`criado pela skill`, D-16);
 *  - **B2**: o repo que o item DE FATO usaria — o dele ou o herdado do card
 *    (D-6) — e a trava, quando ela é dele.
 *
 * `discovery` e `lock` são opcionais porque a linha também é usada fora do card
 * inteiro; sem o card, ela fala só do que o item declara.
 */
export function itemLine(
  item: WorkItemSnapshot,
  discovery: DiscoverySnapshot | null = null,
  lock: LockRecord | null = null,
): string {
  return `${item.title} · ${itemMeta(item, discovery, lock)}`;
}

/**
 * Tudo que a linha do item diz DEPOIS do título. Separado porque o mapa mostra
 * o título como título do card e a meta embaixo — e montar a meta lá seria a
 * segunda redação da mesma frase, que é como "sem repo alvo" e "herdado do
 * card" apareceram na mesma tela sobre o mesmo item.
 */
export function itemMeta(
  item: WorkItemSnapshot,
  discovery: DiscoverySnapshot | null = null,
  lock: LockRecord | null = null,
): string {
  const { repo, inherited } =
    discovery === null ? { repo: item.targetRepo, inherited: false } : itemRepoOf(item, discovery);
  const repoText = repo === null ? 'sem repo alvo' : inherited ? `${repo} (herdado do card)` : repo;
  const origem = item.createdBySkill ? ' · criado pela skill' : '';
  const travado = lock === null ? '' : ` · travado pela fase "${lock.phase}" desde ${formatTimestamp(lock.acquiredAt)}`;
  return `${item.itemType} · ${WORK_ITEM_STATE_LABEL[item.state]} · ${repoText}${origem}${travado}`;
}

/**
 * D-4 — o item FECHOU. Vale para os três ciclos: entrega de código, artefato
 * revisado e pergunta respondida. `abandoned` conta: desistir é desfecho, não
 * pendência — e foi o mapa antigo pintar desfecho como trilha pela metade que
 * fez um spike respondido parecer um PR inacabado.
 */
export function isItemClosed(item: WorkItemSnapshot): boolean {
  return item.state === 'done' || item.state === 'abandoned';
}

/** O que "terminar" significa em cada ciclo (D-4) — tabela, não regra espalhada. */
const LIFECYCLE_CLOSURE: Readonly<Record<LifecycleKind, string>> = {
  'code-delivery': 'entrega de código: fecha com o PR mergeado e verificado',
  'reviewed-artifact': 'artefato revisado: fecha com o documento publicado e aceito',
  'answered-question': 'pergunta respondida: fecha com a conclusão registrada — "não deu" é desfecho válido',
};

/**
 * A frase de fecho de um item, quando ele fechou. Junta o CICLO (o que terminar
 * significa) com a RESPOSTA registrada, quando existe — é o que faz um `spike`
 * que respondeu "não dá" parecer concluído em vez de interrompido.
 */
export function itemClosureLine(item: WorkItemSnapshot, verifications: readonly VerificationSnapshot[]): string | null {
  if (!isItemClosed(item)) return null;
  const lifecycle = LIFECYCLE_BY_ITEM_TYPE[item.itemType];
  const conclusion = verifications.find(
    (entry) =>
      entry.subject.entity === 'work_item' &&
      entry.subject.id === item.id &&
      entry.verificationKind === 'conclusion' &&
      entry.ref !== null,
  );
  const resposta = conclusion === undefined ? '' : ` — ${conclusion.ref}`;
  return `${WORK_ITEM_STATE_LABEL[item.state]} · ${LIFECYCLE_CLOSURE[lifecycle]}${resposta}`;
}

// A versão compacta de `verificationLines` que o B6 tinha aqui ("PR — passou ·
// ref") saiu de propósito: o handoff do B7 pediu que o mapa REAPROVEITASSE a
// função dele em vez de reescrever a frase, e duas redações da mesma evidência
// divergem no primeiro conserto. A única origem é `verificationLines` (abaixo,
// com o mapa explícito `VERIFICATION_TEXT`), agora com o filtro por assunto que
// o painel do mapa precisa.

export interface ItemStateAction {
  readonly state: WorkItemState;
  readonly label: string;
  /** O que o gesto faz — e o que ele faz com a etapa do card. */
  readonly hint: string;
}

/**
 * Os gestos de estado oferecidos para um item: abrir, começar, concluir,
 * abandonar, menos aquele em que ele já está.
 *
 * As frases falam da REGRA ("a etapa é recalculada e pode retroceder"), nunca do
 * resultado ("a etapa vai virar Execução"): prever a etapa aqui seria a tela
 * calculando o que só o main deriva — e errando sempre que o discovery ainda não
 * tivesse concluído.
 */
export function itemStateActions(item: WorkItemSnapshot): readonly ItemStateAction[] {
  const concluded = item.state === 'done' || item.state === 'abandoned';

  const all: readonly ItemStateAction[] = [
    {
      state: 'in-progress',
      label: concluded ? 'Retomar' : 'Começar',
      hint: 'O item passa a estar em curso. A etapa do card é recalculada — ela nunca é digitada.',
    },
    {
      state: 'done',
      label: 'Concluir',
      hint: 'O item fecha. Quando todos os itens estiverem fechados, o cálculo leva o card a Concluído.',
    },
    {
      state: 'abandoned',
      label: 'Abandonar',
      hint: 'Desistir é desfecho válido, não pendência: o item fecha como abandonado.',
    },
    {
      state: 'open',
      label: concluded ? 'Reabrir' : 'Voltar para aberto',
      hint: concluded
        ? 'O item volta a aberto. A etapa do card é recalculada e pode retroceder — item reaberto puxa o card de volta.'
        : 'O item deixa de estar em curso. A etapa do card é recalculada e pode retroceder.',
    },
  ];

  return all.filter((action) => action.state !== item.state);
}

/** A regra que governa o bloco de itens, dita uma vez, onde ela se aplica. */
export const ITEM_STATE_RULE =
  'O estado do item é o que move a etapa do card — e a etapa retrocede: item reaberto depois de fechado puxa o card de volta.';

/** O que dizer quando um gesto é recusado. Recusa calada é o vício que a spec 010 combate. */
export const GESTURE_REFUSAL_MESSAGE: Readonly<Record<string, string>> = {
  'store-refused': 'O histórico não aceita escrita agora. Nada foi gravado.',
  'invalid-input': 'O gesto chegou incompleto ao app e foi recusado. Nada foi gravado.',
  'unknown-subject': 'Este assunto não está mais no histórico. Nada foi gravado — a tela pode estar defasada; varra o outbox.',
  locked:
    'Há uma fase travada neste item. Libere a trava antes de descartá-lo: descartar agora tiraria a trava da tela sem tirá-la do estado.',
};

export function gestureRefusalMessage(reason: string): string {
  return GESTURE_REFUSAL_MESSAGE[reason] ?? 'O gesto foi recusado e nada foi gravado.';
}

/** O que a tela diz DEPOIS de o item sair — o descarte não apaga o passado. */
export function discardedMessage(item: WorkItemSnapshot): string {
  return `Item «${item.title}» descartado. Ele sai do card; o histórico guarda que ele existiu.`;
}

/** A trava prende ESTE item? A comparação mora aqui, não em quem desenha. */
export function isLocked(item: WorkItemSnapshot, lock: LockRecord | null): boolean {
  return lock !== null && lock.subject.entity === 'work_item' && lock.subject.id === item.id;
}

/**
 * D-16 — por que o descarte não tem bloqueio, e o que ele não apaga.
 *
 * Recebe a trava porque, sem ela, a frase mentia: o print 26 mostrava "descartar
 * é um gesto só, sem bloqueio" embaixo do item travado, e o print 27 mostrava o
 * app recusando o descarte DESSE item na mesma tela. A promessa e a recusa
 * precisam sair da mesma função, ou uma desmente a outra.
 */
export function discardHint(item: WorkItemSnapshot, lock: LockRecord | null = null): string {
  // A MESMA frase da recusa, não uma cópia dela: duas redações da mesma regra
  // divergem no primeiro conserto (`erros-conhecidos.md` #1).
  if (isLocked(item, lock)) return GESTURE_REFUSAL_MESSAGE['locked']!;
  const origem = item.createdBySkill
    ? 'Este item nasceu pela skill: descartar é um gesto só, sem bloqueio.'
    : 'Descartar é um gesto só, sem bloqueio.';
  return `${origem} O item sai do card; o fato de ele ter existido fica no histórico.`;
}

/** Uma nota do card, já sabendo dizer sobre o que ela é. */
export interface NoteView {
  readonly text: string;
  readonly at: string;
  readonly subject: EntityId;
  /** "o card", "o item «X»", "um plano" — quem lê precisa saber a que a nota se prende. */
  readonly about: string;
}

export interface CardView {
  readonly discovery: DiscoverySnapshot;
  readonly stage: StageView;
  readonly signals: readonly SignalView[];
  /**
   * Os planos INTEIROS, não a contagem deles. Era `planCount: number`, e o
   * bloco dizia "1 plano(s)" sem nunca nomear o plano: a tela contava uma
   * entidade que escondia — e escondia junto a marca de proveniência dela.
   * Quem precisa da contagem lê `plans.length` — um número a menos para mentir.
   */
  readonly plans: readonly PlanSnapshot[];
  readonly items: readonly WorkItemSnapshot[];
  readonly phases: readonly PhaseRunSnapshot[];
  /** A primeira trava do card — a que o bloco da trava desenha. */
  readonly lock: LockRecord | null;
  /** TODAS as travas do card: um item travado nao trava o irmao, e a tela precisa saber disso. */
  readonly locks: readonly LockRecord[];
  /** A sessão aberta pelo disparo, quando existe — é dela que saem os caminhos do inbox/outbox. */
  readonly openSession: SessionSnapshot | null;
  /** Todas as sessões do card: é delas que sai o "alguém assumiu?" de cada fase. */
  readonly sessions: readonly SessionSnapshot[];
  readonly ingestErrors: readonly IngestErrorSnapshot[];
  /** D-12 — o que o board ainda não recebeu. Nunca bloqueia nada; só precisa ser visível. */
  readonly mirrorQueue: readonly MirrorQueueEntry[];
  readonly notes: readonly NoteView[];
  /**
   * D-4 — o que dá para conferir em cada assunto do card: como o ciclo de cada
   * item termina (PR, check, revisão, conclusão). Estava no snapshot desde a
   * fase 1 e nenhuma tela mostrava: a fase declarava o PR e o card não contava
   * (item M-10 do inventário do B6).
   */
  readonly verifications: readonly VerificationSnapshot[];
  /** D-8 — "cadê o artefato?" tem resposta única, e ela mora no store. */
  readonly artifacts: readonly ArtifactPointer[];
}

/**
 * O que dizer sobre a fase travada. A distinção existe porque **preparar não é
 * começar**: o app separa o contexto e trava o card antes de qualquer sessão
 * existir. Chamar isso de "em andamento" seria a tela prometendo o que não
 * cumpre — o mesmo vício que a spec 010 combate, só que na direção contrária
 * ("não realizada" para o que foi feito).
 *
 * Batch B1 — o "Preparar" passou a abrir a aba, então a passagem de
 * preparada → em andamento tem fato próprio: o `cliSessionId` que o CLI
 * devolve. `nextStep` sobrou para o caso em que a sessão **não pôde** abrir
 * (card sem repo alvo, repo desconhecido): aí a tela diz o que fazer à mão,
 * com o MESMO comando que a aba teria recebido.
 */
export interface LockView {
  /** O fato por trás da frase — a tela nunca deriva a palavra por conta própria. */
  readonly state: LockState;
  readonly title: string;
  readonly line: string;
  /** Preenchido enquanto ninguém assumiu: o que fazer para a fase de fato rodar. */
  readonly nextStep: { readonly explanation: string; readonly command: string } | null;
}

/**
 * De QUE é a trava, em português. O bloco fica no topo do card, e no print 25
 * ele dizia "Fase implementar, por uma skill, desde ..." com dois itens na tela:
 * o app sabia o assunto (`lock.subject`) e não dizia. Com disparo por item (B2)
 * a ambiguidade vira regra, não exceção.
 */
export function lockSubjectLabel(card: CardView, lock: LockRecord): string {
  if (lock.subject.entity === 'discovery') return 'o card';
  if (lock.subject.entity === 'plan') return 'um plano';
  const item = card.items.find((entry) => entry.id === lock.subject.id);
  return item === undefined ? 'um item que não está mais no card' : `o item «${item.title}»`;
}

export function lockView(card: CardView): LockView | null {
  const lock = card.lock;
  if (lock === null) return null;

  const holder = lock.holderKind === 'skill' ? 'uma skill' : 'o app';
  const claimed = card.openSession?.claimed ?? false;
  const inputPath = card.openSession?.inputPath ?? null;
  const cliSessionId = card.openSession?.cliSessionId ?? lock.cliSessionId;
  const state = lockStateOf(lock.holderKind, claimed);
  // De QUE é a trava (B3): com disparo por item (B2), "a fase X está travada"
  // sem dizer sobre o quê deixou de ser exceção e virou regra.
  const about = lockSubjectLabel(card, lock);
  // Dono, hora e sessão (D-11): a trava nomeia quem a segura. Sem o id do
  // CLI (trava posta pela skill), diz quem a pôs — nunca fica anônima.
  const dono = cliSessionId === null ? `por ${holder}` : `na sessão ${cliSessionId}`;
  const desde = `Fase ${lock.phase} sobre ${about}, ${dono}, desde ${formatTimestamp(lock.acquiredAt)}.`;

  if (state === 'running') {
    return { state, title: 'Em andamento', line: desde, nextStep: null };
  }

  if (state === 'session-open') {
    // Abrir a aba NÃO é começar a fase. O app escreveu o comando e parou ali —
    // enviar é gesto humano (invariante 2), e o app não tem como saber se você
    // já o fez. Chamar isto de "em andamento" era o defeito de 03/08 pela
    // quarta porta: os prints 07 e 10 do roteiro se desmentiam na mesma rodada.
    return {
      state,
      title: 'Sessão aberta',
      line: `${desde} A aba está aberta com o comando da fase escrito; o app não sabe se você já o enviou.`,
      nextStep: null,
    };
  }

  return {
    state,
    title: 'Preparada — ninguém assumiu ainda',
    line: `O app separou o contexto da fase ${lock.phase} sobre ${about} às ${formatTimestamp(lock.acquiredAt)} e travou. Nada está rodando: nenhuma sessão assumiu esta fase ainda.`,
    nextStep:
      inputPath === null
        ? null
        : {
            explanation: 'Rode a fase apontando para o contexto que o app deixou:',
            command: esteiraPhaseCommand(lock.phase, inputPath),
          },
  };
}

/**
 * Por que o "Preparar" está desabilitado — ou o que ele fará.
 *
 * Nasceu do print 29 (B3): a frase estava escrita à mão no componente e dizia
 * "Há uma fase preparada neste card" para uma fase que a skill JÁ tinha
 * assumido, sobre um ITEM. Duas palavras erradas de uma vez, pelo mesmo motivo
 * de sempre — a frase morava longe do estado.
 *
 * Aqui ela junta as DUAS correções que os batches fizeram separado:
 *
 *  - **de que** é a trava (B3): `lockSubjectLabel`, porque com disparo por item
 *    (B2) o card, o plano e o item disputam a mesma frase;
 *  - **em que pé** ela está (B1): `LOCK_WORD` do `lockStateOf`, o mesmo mapa que
 *    o bloco da trava usa. Deduzir o estado do TÍTULO — o que o B3 fazia — dobra
 *    "sessão aberta" em "preparada" assim que o B1 entra, e a tela volta a ter
 *    duas palavras para um estado só.
 */
export function dispatchHint(card: CardView): string {
  const lock = card.lock;
  if (lock === null) return noLockDispatchHint();

  const state = lockStateOf(lock.holderKind, card.openSession?.claimed ?? false);
  return `Há uma fase ${LOCK_WORD[state]} sobre ${lockSubjectLabel(card, lock)}. Libere a trava acima antes de preparar outra.`;
}

/** Projeção do snapshot para UM card. A tela não deriva nada além disto. */
export function cardView(snapshot: StoreSnapshot, discoveryId: string): CardView | null {
  const discovery = snapshot.discoveries.find((entry) => entry.id === discoveryId);
  if (discovery === undefined) return null;

  const plans = snapshot.plans.filter((plan) => plan.discoveryId === discovery.id);
  const items = snapshot.workItems.filter((item) => item.discoveryId === discovery.id);
  const owned = new Set<string>([
    `discovery:${discovery.id}`,
    ...plans.map((plan) => `plan:${plan.id}`),
    ...items.map((item) => `work_item:${item.id}`),
  ]);
  const belongs = (subject: { entity: string; id: string }): boolean => owned.has(`${subject.entity}:${subject.id}`);
  const locks = snapshot.locks.filter((lock) => belongs(lock.subject));

  return {
    discovery,
    stage: stageView(discovery),
    signals: signalViews(discovery),
    plans,
    items,
    phases: snapshot.phases.filter((phase) => belongs(phase.subject)),
    lock: locks[0] ?? null,
    locks,
    // A última sessão aberta do assunto: é ela que carrega os caminhos do
    // `run-input.json` e do `result.json` desta rodada.
    openSession: [...snapshot.sessions].reverse().find((session) => belongs(session.subject) && session.endedAt === null) ?? null,
    sessions: snapshot.sessions.filter((session) => belongs(session.subject)),
    ingestErrors: snapshot.ingestErrors.filter((error) => error.subject !== null && belongs(error.subject)),
    mirrorQueue: snapshot.mirrorQueue.filter((entry) => belongs(entry.subject)),
    verifications: snapshot.verifications.filter((entry) => belongs(entry.subject)),
    artifacts: snapshot.artifacts.filter((entry) => belongs(entry.owner)),
    notes: snapshot.notes
      .filter((note) => belongs(note.subject))
      .map((note) => ({
        text: note.text,
        at: note.at,
        subject: note.subject,
        about: aboutSubject(note.subject, plans, items),
      })),
  };
}

// ---------------------------------------------------------------------------
// Planos e itens — o conteúdo do card, escrito uma vez só
// ---------------------------------------------------------------------------
//
// Achado da captura e2e do B2 (print 16): a MESMA tela dizia duas coisas
// incompatíveis sobre o MESMO item, com quatro linhas de distância —
//
//   Planos e itens …  "Medir onde o lote para · spike · open · sem repo alvo"
//   Repo alvo:        "donel-dev — repo herdado do card"
//
// A herança de repo existia, mas só dentro do disparo; a lista de itens era
// montada à mão no JSX. É o erro conhecido nº 1 pela terceira vez: a correção
// parou na frase onde o defeito apareceu, em vez de descer até a função que
// produz o texto. Agora as duas frases nascem de `itemRepoOf` — divergir exige
// mudar a função, e a função tem teste.

/** O repo que este item de fato usaria, e de onde ele veio. */
export interface ItemRepoView {
  readonly repo: string | null;
  readonly inherited: boolean;
}

/**
 * D-6 — o alvo de um item: o dele, ou o do card. Nunca o "projeto em foco" da
 * janela, que foi o palpite que abriu uma fase no repositório errado.
 */
export function itemRepoOf(item: WorkItemSnapshot, discovery: DiscoverySnapshot): ItemRepoView {
  if (item.targetRepo !== null) return { repo: item.targetRepo, inherited: false };
  if (discovery.targetRepo !== null) return { repo: discovery.targetRepo, inherited: true };
  return { repo: null, inherited: false };
}

export interface ContentLineView {
  readonly key: string;
  readonly kind: 'plan' | 'item';
  readonly text: string;
  /**
   * D-2 — a entidade foi afirmada num seed, não observada de uma execução.
   * A marca vai AO LADO da frase, não dentro dela: a frase descreve o que a
   * entidade é, a marca diz quem a afirmou.
   */
  readonly mark: ProvenanceMark | null;
}

export interface CardContentView {
  /** O título do bloco, com o que ele conta — e a lista abaixo mostra tudo o que ele contou. */
  readonly title: string;
  readonly lines: readonly ContentLineView[];
  /** O que dizer quando falta algo. `null` quando a lista já diz tudo. */
  readonly note: string | null;
}

/**
 * "1 plano" / "2 itens" / "nenhum item" — plural de gente, não "item(ns)".
 * Delegar para `contagem` (a mesma do `seededSummary`) mantém UMA aritmética
 * de plural no arquivo: duas cópias divergem no primeiro conserto.
 */
function counted(total: number, singular: string, plural: string): string {
  return contagem(total, singular, plural, `nenhum ${singular}`);
}

/**
 * Planos e itens do card, cada linha com a palavra certa. O componente imprime
 * o que sai daqui — ele não monta frase nenhuma, porque foi montando frase no
 * JSX que a tela passou a se contradizer.
 */
export function cardContent(card: CardView): CardContentView {
  const title = `Planos e itens (${counted(card.plans.length, 'plano', 'planos')}, ${counted(card.items.length, 'item', 'itens')})`;

  const lines: ContentLineView[] = card.plans.map((plan) => ({
    key: `plan:${plan.id}`,
    kind: 'plan' as const,
    // O resumo vem junto quando o plano declarou um (B4): nomear o plano e
    // esconder o que ele diz seria contar uma entidade pela metade.
    text: plan.summary ? `Plano — ${plan.title} · ${plan.summary}` : `Plano — ${plan.title}`,
    // Costura B2×B4: a linha é do `cardContent` (fonte única do bloco), a
    // marca de semeado é do seed — sem ela o plano afirmado apareceria aqui
    // como fato observado.
    mark: provenanceMark(plan.seeded),
  }));

  for (const item of card.items) {
    // A trava DO item, não a que o bloqueia: um discovery travado impede o
    // disparo do item sem que o item esteja travado, e dizer "travado" ali
    // seria a tela mentindo de novo, agora por excesso.
    const lock = card.locks.find((entry) => entry.subject.entity === 'work_item' && entry.subject.id === item.id) ?? null;
    lines.push({
      key: `work_item:${item.id}`,
      kind: 'item',
      // A frase inteira vem de `itemLine`: a lista do B2 imprimia o estado CRU
      // do dado (`in-progress`) e o bloco de gestos do B3 imprimia "em curso",
      // sobre o mesmo item, na mesma tela.
      text: itemLine(item, card.discovery, lock),
      mark: provenanceMark(item.seeded),
    });
  }

  const note =
    card.plans.length === 0 && card.items.length === 0
      ? 'Nenhum plano registrado. Se o discovery terminou assim, é um desfecho — não uma pendência.'
      : card.items.length === 0
        ? 'Os planos ainda não declararam nenhum item.'
        : null;

  return { title, lines, note };
}

/**
 * Em que pé está a SESSÃO daquela fase — o que decide entre três frases que
 * descrevem estados diferentes e já foram confundidas duas vezes neste repo.
 */
export type PhasePresence =
  /** Existe sessão viva com id do CLI: a aba abriu. Não diz que o comando foi enviado. */
  | 'claimed'
  /** O app separou o contexto e travou o card; ninguém pegou ainda. */
  | 'prepared'
  /** Batch B1 — havia sessão, ela acabou, e a fase não concluiu nem falhou. */
  | 'interrupted'
  /** Fase iniciada sem sessão do app: quem afirmou o início foi a skill, pelo outbox. */
  | 'declared';

/** Como se chama, em português, o assunto de uma nota deste card. */
function aboutSubject(subject: EntityId, plans: readonly PlanLike[], items: readonly WorkItemSnapshot[]): string {
  if (subject.entity === 'discovery') return 'o card';
  if (subject.entity === 'plan') {
    const plan = plans.find((entry) => entry.id === subject.id);
    return plan === undefined ? 'um plano' : `o plano «${plan.title}»`;
  }
  const item = items.find((entry) => entry.id === subject.id);
  return item === undefined ? 'um item' : `o item «${item.title}»`;
}

interface PlanLike {
  readonly id: string;
  readonly title: string;
}

/**
 * Os alvos possíveis de uma nota neste card: o card e cada item. O valor é
 * `<entidade>:<id>` porque o `Select` do design-system trafega string — e o
 * caminho de volta é `parseNoteTarget`, para o renderer não montar `EntityId`
 * à mão em lugar nenhum.
 */
export function noteTargetOptions(card: CardView): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: `discovery:${card.discovery.id}`, label: `Sobre o card — ${card.discovery.title}` },
    ...card.items.map((item) => ({ value: `work_item:${item.id}`, label: `Sobre o item — ${item.title}` })),
  ];
}

export function parseNoteTarget(value: string): EntityId | null {
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const entity = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (id.length === 0) return null;
  if (entity !== 'discovery' && entity !== 'plan' && entity !== 'work_item') return null;
  return { entity, id };
}

/**
 * O espelho no tracker é **cortesia** (D-12): ele reflete fatos que já
 * aconteceram aqui. Por isso a frase do bloco não é um alerta — é um aviso de
 * que o board está atrasado, não de que algo aqui está travado. Confundir os
 * dois faria o operador esperar por uma integração opcional.
 */
export const MIRROR_PENDING_TITLE = 'Espelho pendente';

export const MIRROR_PENDING_HINT =
  'O board ainda não recebeu isto. O trabalho local já aconteceu e não depende do espelho — nada aqui está esperando.';

export interface MirrorLineView {
  readonly key: string;
  readonly text: string;
  /** Quantas vezes já tentou e por que não foi. `null` nunca: silêncio aqui seria a falha invisível de novo. */
  readonly detail: string;
}

/** O que falta mandar ao board, em português — uma linha por operação da fila. */
export function mirrorLines(card: CardView): readonly MirrorLineView[] {
  return card.mirrorQueue.map((entry) => ({
    key: `${entry.subject.entity}:${entry.subject.id}:${entry.operation}`,
    text: mirrorOperationText(entry),
    detail:
      entry.attempts === 0
        ? 'ainda não tentou'
        : `${entry.attempts} ${entry.attempts === 1 ? 'tentativa' : 'tentativas'} — ${entry.lastError ?? 'motivo não registrado'}`,
  }));
}

function mirrorOperationText(entry: MirrorQueueEntry): string {
  const kind = mirrorOperationKind(entry.operation);

  if (kind === 'label') {
    const labels = Array.isArray(entry.payload.labels)
      ? entry.payload.labels.filter((label): label is string => typeof label === 'string')
      : [];
    if (labels.length === 0) return 'remover as etiquetas de fase';
    return `aplicar a etiqueta ${labels.map((label) => `"${label}"`).join(', ')}`;
  }

  if (kind === 'column') {
    const column = typeof entry.payload.column === 'string' ? entry.payload.column : '—';
    return `mover o card para "${column}"`;
  }

  if (kind === 'comment') {
    const phase = typeof entry.payload.phase === 'string' ? entry.payload.phase : 'anterior';
    return `comentar a conclusão da fase ${phase}`;
  }

  // Operação que este canal não conhece (gravada por um mais novo): dizer que
  // não sei é a única resposta honesta — fingir que mandei seria a inverdade
  // que a spec inteira existe para extinguir.
  return `não sei espelhar a operação "${entry.operation}"`;
}

/**
 * A frase de UMA verificação. Mapa EXPLÍCITO de `kind` × `state`: montar a
 * frase por template produziria "conclusão — passou", que não quer dizer nada.
 * Cada uma das doze é escolhida, e é aqui que ela se conserta — nunca no JSX.
 *
 * O que este bloco impede: a fase declarar D-4 (o PR, o check, a resposta do
 * spike) e o card não contar. Ler um fato e engoli-lo não é mentir, mas custa
 * a mesma coisa a quem lê a tela para decidir o que fazer agora.
 */
const VERIFICATION_TEXT: Readonly<Record<VerificationKind, Readonly<Record<VerificationState, string>>>> = {
  'pull-request': {
    pending: 'PR aberto, ainda não verificado',
    passed: 'PR mergeado e verificado',
    failed: 'PR reprovado',
  },
  check: {
    pending: 'verificação ainda não rodou',
    passed: 'verificação passou',
    failed: 'verificação falhou',
  },
  review: {
    pending: 'revisão pendente',
    passed: 'revisão aceita',
    failed: 'revisão pediu mudança',
  },
  conclusion: {
    // "Não deu certo" é desfecho, não pendência: um spike que respondeu
    // negativo está CONCLUÍDO, e a frase precisa dizer isso.
    pending: 'conclusão ainda não registrada',
    passed: 'conclusão registrada',
    failed: 'conclusão registrada: não deu certo',
  },
};

export interface VerificationLineView {
  readonly key: string;
  readonly text: string;
  /** A URL do PR, o nome do check, o texto da conclusão — o que dá para ir conferir. */
  readonly detail: string | null;
  readonly failed: boolean;
}

/**
 * `subject` filtra por assunto — é o que o painel de detalhe do mapa (B6)
 * precisa, um nó de cada vez, sem que exista uma segunda redação da evidência.
 */
export function verificationLines(card: CardView, subject: EntityId | null = null): readonly VerificationLineView[] {
  const escopo =
    subject === null
      ? card.verifications
      : card.verifications.filter((entry) => entry.subject.entity === subject.entity && entry.subject.id === subject.id);

  return escopo.map((verification) => ({
    key: `${verification.subject.entity}:${verification.subject.id}:${verification.verificationKind}:${verification.ref ?? ''}`,
    text: VERIFICATION_TEXT[verification.verificationKind][verification.state],
    detail: verification.ref,
    failed: verification.state === 'failed',
  }));
}

/**
 * A frase de UMA passagem de fase. Cada estado tem palavra própria — e nenhuma
 * delas é "não realizada":
 *
 *  - concluiu      → "concluída", "abandonada", "terminou sem conclusão"
 *  - falhou        → "falhou: <código>" (o desfecho ruim é legível)
 *  - sessão aberta → "sessão aberta" (a aba existe; o Enter é seu)
 *  - só preparada  → "preparada, ninguém assumiu"
 *  - interrompida  → "interrompida: a sessão terminou sem concluir"
 *  - declarada     → "em andamento" (a skill afirmou o início; ela é quem sabe)
 *
 * `presence` existe porque o app registra `phase.started` no DISPARO, e disparar
 * não é começar: o card fica travado esperando alguém rodar a fase. Chamar isso
 * de "em andamento" foi o mesmo erro que o bloco da trava já tinha cometido —
 * ele reapareceu aqui porque a correção de lá não subiu até a raiz.
 *
 * A terceira frase entrou no batch B1, pela MESMA porta: fechada a aba, não
 * sobra sessão aberta para desmentir a frase otimista, e a lista voltaria a
 * dizer "em andamento" para uma fase que ninguém está tocando.
 */
export type PhaseTrailState =
  | 'concluida'
  | 'abandonada'
  | 'inconclusiva'
  | 'falhou'
  | 'sessao-aberta'
  | 'preparada'
  | 'interrompida'
  | 'em-andamento'
  | 'registrada';

/**
 * O ESTADO por trás da frase. Existe porque o mapa precisa do mesmo fato em
 * outra forma (glifo, tom, "tem próxima fase?") e derivar isso do TEXTO seria
 * a mesma cópia de regra que fez a palavra errada reaparecer noutro bloco.
 */
export function phaseTrailState(phase: PhaseRunSnapshot, presence: PhasePresence = 'declared'): PhaseTrailState {
  if (phase.failure !== null) return 'falhou';
  if (phase.completedAt !== null) {
    return phase.outcome === 'done' ? 'concluida' : phase.outcome === 'abandoned' ? 'abandonada' : 'inconclusiva';
  }
  if (phase.startedAt !== null) {
    if (presence === 'claimed') return 'sessao-aberta';
    if (presence === 'prepared') return 'preparada';
    if (presence === 'interrupted') return 'interrompida';
    return 'em-andamento';
  }
  return 'registrada';
}

/** Uma palavra por estado, num lugar só. Nenhuma delas é "não realizada". */
export const PHASE_STATE_WORD: Readonly<Record<PhaseTrailState, string>> = {
  concluida: 'concluída',
  abandonada: 'abandonada',
  inconclusiva: 'terminou sem conclusão',
  falhou: 'falhou',
  'sessao-aberta': 'sessão aberta',
  preparada: 'preparada, ninguém assumiu',
  interrompida: 'interrompida: a sessão terminou sem concluir',
  'em-andamento': 'em andamento',
  registrada: 'registrada',
};

export function phaseLine(phase: PhaseRunSnapshot, presence: PhasePresence = 'declared'): string {
  const state = phaseTrailState(phase, presence);
  if (state === 'falhou') return `${phase.phase} — falhou: ${phase.failure?.code ?? 'motivo não registrado'}`;
  return `${phase.phase} — ${PHASE_STATE_WORD[state]}`;
}

/** As fases do card, cada uma com a frase certa — a tela só imprime o que sai daqui. */
export interface PhaseLineView {
  readonly key: string;
  readonly text: string;
  readonly failed: boolean;
  readonly detail: string | null;
  /** O fato por trás da frase — quem desenha glifo/tom lê isto, nunca o texto. */
  readonly state: PhaseTrailState;
  readonly phase: PhaseRunSnapshot;
  /** D-2 — a fase foi afirmada num seed, não observada de uma execução. */
  readonly mark: ProvenanceMark | null;
}

/**
 * As fases do card, cada uma com a frase certa. `subject` filtra por assunto —
 * é o que a trilha do mapa precisa (um nó de cada vez) sem que exista uma
 * segunda implementação da regra de presença.
 */
export function phaseLines(card: CardView, subject: EntityId | null = null): readonly PhaseLineView[] {
  const doCard =
    subject === null
      ? card.phases
      : card.phases.filter((phase) => phase.subject.entity === subject.entity && phase.subject.id === subject.id);

  return doCard.map((phase) => {
    const doAssunto = card.sessions.filter(
      (entry) =>
        entry.phase === phase.phase && entry.subject.entity === phase.subject.entity && entry.subject.id === phase.subject.id,
    );
    const aberta = doAssunto.find((entry) => entry.endedAt === null);
    // Sessão aberta manda: assumida ou só preparada. Sem sessão aberta, mas com
    // sessão que já existiu, a fase ficou pelo meio — e é isso que a tela diz.
    // Sem sessão nenhuma (fase vinda só da ingestão), a frase não depende disso.
    const presence: PhasePresence =
      aberta !== undefined ? (aberta.claimed ? 'claimed' : 'prepared') : doAssunto.length > 0 ? 'interrupted' : 'declared';
    return {
      key: `${phase.subject.entity}:${phase.subject.id}:${phase.phase}`,
      text: phaseLine(phase, presence),
      failed: phase.failure !== null,
      detail: phase.failure?.message ?? null,
      state: phaseTrailState(phase, presence),
      phase,
      // A marca vai AO LADO da frase, não dentro dela: a frase descreve o
      // desfecho, a marca diz quem o afirmou. Misturar as duas faria o
      // vocabulário do desfecho depender da proveniência — e ele já tem dono.
      mark: provenanceMark(phase.seeded),
    };
  });
}

// ---------------------------------------------------------------------------
// Disparo — só oferecer o que o modelo comporta
// ---------------------------------------------------------------------------
//
// Achado do primeiro uso real: dava para disparar a fase "Plano" num card que
// não tinha plano nenhum, e o `run-input.json` saía com `plan_id: null`. A fase
// Plano existe para detalhar um plano; a tela oferecia um caminho que o modelo
// não comporta, e o clique só falhava depois.
//
// A correção tem duas metades, e as duas moram aqui, na camada pura:
//
//  1. a fase que o card não comporta fica DESABILITADA, com a razão ESCRITA —
//     o mesmo padrão que a trava já usa;
//  2. quem dispara escolhe o ASSUNTO (o discovery, um plano ou um item), que é
//     o que destrava as fases de item.
//
// E o D-6 é cobrado ANTES do clique: item `issue` sem repo alvo não dispara, e
// a tela diz por quê em vez de deixar clicar no escuro.

export type DispatchEntity = 'discovery' | 'plan' | 'work_item';

interface PhaseSpec {
  readonly phase: string;
  readonly label: string;
  readonly runsOn: DispatchEntity;
  /** A frase de quando o card ainda não tem o que a fase exige. */
  readonly missing: string;
}

/**
 * O catálogo do que a TELA oferece hoje — **não** o enum do contrato.
 * `run.phase` é string livre de propósito (`[P-4]`: os nomes de fase de cada
 * ciclo só se fecham com uso real na mão), e fechá-lo num enum agora decidiria
 * essa pendência por acidente. Esta tabela diz o que o app propõe e o que cada
 * proposta exige do card; o contrato continua aberto por baixo.
 */
const PHASE_CATALOG: readonly PhaseSpec[] = [
  { phase: 'discovery', label: 'Discovery', runsOn: 'discovery', missing: '' },
  {
    phase: 'plano',
    label: 'Plano',
    runsOn: 'plan',
    missing:
      'Nenhum plano declarado ainda. A fase Plano detalha um plano que já existe — quem declara o primeiro é o Discovery.',
  },
  {
    phase: 'implementar',
    label: 'Implementar',
    runsOn: 'work_item',
    missing:
      'Nenhum item de trabalho ainda. Implementar roda sobre um item, e item nasce pela skill (D-16) — o app não tem formulário de criação.',
  },
  {
    phase: 'validar',
    label: 'Validar',
    runsOn: 'work_item',
    missing:
      'Nenhum item de trabalho ainda. Validar roda sobre um item, e item nasce pela skill (D-16) — o app não tem formulário de criação.',
  },
  // As duas fases que fecham o ciclo entraram com o B7 (skill 3.0). O handoff
  // do B2 pediu exatamente isto: uma linha por fase, com a frase de "por que
  // não dá agora" junto — o catálogo continua oferta da tela, não enum do
  // contrato ([P-4]).
  {
    phase: 'documentar',
    label: 'Documentar',
    runsOn: 'work_item',
    missing:
      'Nenhum item de trabalho ainda. Documentar registra o artefato de um item (D-8) — sem item, não há o que apontar; item nasce pela skill (D-16).',
  },
  {
    phase: 'concluir',
    label: 'Concluir',
    runsOn: 'work_item',
    missing:
      'Nenhum item de trabalho ainda. Concluir fecha o ciclo de um item com a verificação que passou (D-4) — sem item, não há ciclo a fechar; item nasce pela skill (D-16).',
  },
];

/**
 * As fases que o catálogo oferece para um tipo de assunto, na ordem. É o que a
 * trilha do mapa usa para saber qual é a PRÓXIMA — reimplementar a pergunta lá
 * faria o carrossel oferecer o que este arquivo recusa, que é o defeito do B2
 * pelo avesso.
 */
export function catalogPhasesFor(runsOn: DispatchEntity): readonly { readonly phase: string; readonly label: string }[] {
  return PHASE_CATALOG.filter((spec) => spec.runsOn === runsOn).map((spec) => ({ phase: spec.phase, label: spec.label }));
}

export interface PhaseChoiceView {
  readonly phase: string;
  readonly label: string;
  readonly runsOn: DispatchEntity;
  readonly enabled: boolean;
  /** Por que esta fase não pode rodar neste card agora. `null` quando pode. */
  readonly reason: string | null;
}

export interface DispatchTargetView {
  readonly key: string;
  readonly label: string;
  readonly entity: DispatchEntity;
  readonly discoveryId: string;
  readonly planId: string | null;
  readonly workItemId: string | null;
  /** D-6 — o repo que a sessão usaria. Item sem repo próprio herda o do card, e só o do card. */
  readonly targetRepo: string | null;
  /** De onde o repo veio, quando não é o do próprio assunto. */
  readonly repoNote: string | null;
  /** Por que ESTE assunto não dispara. `null` quando dispara. */
  readonly blocked: string | null;
}

export interface DispatchView {
  readonly phases: readonly PhaseChoiceView[];
  /** A fase escolhida, já resolvida contra o catálogo. */
  readonly phase: PhaseChoiceView;
  /** Os assuntos possíveis para a fase escolhida. */
  readonly targets: readonly DispatchTargetView[];
  readonly target: DispatchTargetView | null;
  readonly canDispatch: boolean;
  /** A razão de não dar para disparar. Sempre preenchida quando `canDispatch` é falso. */
  readonly blocked: string | null;
  /** O que o clique faz — a frase que fica quando não há impedimento. */
  readonly hint: string;
}

export interface DispatchSelection {
  readonly phase: string;
  readonly targetKey: string | null;
}

// A frase de "o que o clique faz" NÃO mora mais aqui. O batch B1 fez o disparo
// abrir a aba, e o texto antigo ("hoje, apontando para o arquivo à mão")
// passou a ser mentira no instante em que os dois batches se encontraram. Ela
// nasce de `dispatchHint`, junto do vocabulário da trava — assim ela usa a
// MESMA palavra do bloco "Preparada / Sessão aberta / Em andamento", que é o
// erro nº 1 de `erros-conhecidos.md` na sua terceira volta.

const LOCK_SCOPE: Readonly<Record<DispatchEntity, string>> = {
  discovery: 'no card',
  plan: 'no plano',
  work_item: 'no item',
};

/** A chave estável de um assunto — é o que a tela guarda entre renderizações. */
function targetKeyOf(subject: EntityId): string {
  return `${subject.entity}:${subject.id}`;
}

function candidatesFor(card: CardView, runsOn: DispatchEntity): readonly DispatchTargetView[] {
  const discoveryId = card.discovery.id;

  if (runsOn === 'discovery') {
    return [
      buildTarget(card, {
        subject: { entity: 'discovery', id: discoveryId },
        label: `O discovery — ${card.discovery.title}`,
        planId: null,
        workItemId: null,
        targetRepo: card.discovery.targetRepo,
        repoNote: null,
        needsRepo: false,
      }),
    ];
  }

  if (runsOn === 'plan') {
    return card.plans.map((plan) =>
      buildTarget(card, {
        subject: { entity: 'plan', id: plan.id },
        label: `Plano — ${plan.title}`,
        planId: plan.id,
        workItemId: null,
        targetRepo: card.discovery.targetRepo,
        repoNote: null,
        needsRepo: false,
      }),
    );
  }

  return card.items.map((item) => {
    // O item HERDA o repo do card quando não declarou o seu (D-6). A resolução
    // é a MESMA que a lista de itens usa (`itemRepoOf`) — quando eram duas, a
    // lista dizia "sem repo alvo" enquanto esta linha dizia "herdado do card",
    // sobre o mesmo item e na mesma tela.
    const { repo, inherited } = itemRepoOf(item, card.discovery);
    return buildTarget(card, {
      subject: { entity: 'work_item', id: item.id },
      label: `${item.itemType} — ${item.title}`,
      planId: item.planId,
      workItemId: item.id,
      targetRepo: repo,
      repoNote: inherited ? 'repo herdado do card' : null,
      needsRepo: item.itemType === 'issue',
      closed: isItemClosed(item),
    });
  });
}

function buildTarget(
  card: CardView,
  spec: {
    readonly subject: EntityId;
    readonly label: string;
    readonly planId: string | null;
    readonly workItemId: string | null;
    readonly targetRepo: string | null;
    readonly repoNote: string | null;
    readonly needsRepo: boolean;
    readonly closed?: boolean;
  },
): DispatchTargetView {
  const chain = lockChainOf(spec.subject, { discoveryId: card.discovery.id, planId: spec.planId });
  const lock = findBlockingLock(card.locks, chain);

  let blocked: string | null = null;
  if (spec.closed === true) {
    // D-4 — o ciclo do item terminou. Oferecer outra fase aqui seria a tela
    // propondo o que o modelo não comporta (a doença do B2), e é o que fazia um
    // `spike` respondido aparecer como trilha pela metade em vez de desfecho.
    blocked =
      'Este item já fechou — o ciclo dele terminou, e desfecho não é pendência. Reabra o item se ele precisa voltar a andar.';
  } else if (spec.needsRepo && spec.targetRepo === null) {
    blocked =
      'Este item é do tipo issue e não tem repo alvo — nem ele, nem o card. Sem repo a fase não dispara: o app não escolhe um repositório por você.';
  } else if (lock !== null) {
    blocked = `A fase "${lock.phase}" já está travada ${LOCK_SCOPE[lock.subject.entity]}, desde ${formatTimestamp(lock.acquiredAt)}. Libere a trava antes de preparar outra.`;
  }

  return {
    key: targetKeyOf(spec.subject),
    label: spec.label,
    entity: spec.subject.entity,
    discoveryId: card.discovery.id,
    planId: spec.planId,
    workItemId: spec.workItemId,
    targetRepo: spec.targetRepo,
    repoNote: spec.repoNote,
    blocked,
  };
}

/**
 * O que a tela pode oferecer neste card, para esta escolha. Uma função só,
 * porque a decisão é uma só: **o app não oferece o que o modelo não comporta,
 * e não recusa em silêncio.** O componente lê o resultado e desenha; ele não
 * decide quem está habilitado nem escreve razão nenhuma.
 */
export function dispatchView(card: CardView, selection: DispatchSelection): DispatchView {
  const phases: readonly PhaseChoiceView[] = PHASE_CATALOG.map((spec) => {
    const enabled =
      spec.runsOn === 'discovery' ? true : spec.runsOn === 'plan' ? card.plans.length > 0 : card.items.length > 0;
    return { phase: spec.phase, label: spec.label, runsOn: spec.runsOn, enabled, reason: enabled ? null : spec.missing };
  });

  // Fase desconhecida cai na primeira: a tela nunca fica sem estado válido —
  // e a primeira é sempre a que qualquer card comporta.
  const phase = phases.find((entry) => entry.phase === selection.phase) ?? phases[0];
  const targets = candidatesFor(card, phase.runsOn);
  const target = targets.find((entry) => entry.key === selection.targetKey) ?? targets[0] ?? null;

  const blocked = !phase.enabled
    ? phase.reason
    : target === null
      ? 'Não há assunto para esta fase neste card.'
      : target.blocked;

  // O `hint` sai do MESMO vocabulário da trava (B1) e nomeia o assunto dela
  // (B3). Escrito à parte, ele dizia "preparada" para um card cujo bloco dizia
  // "Em andamento", e "neste card" para uma trava que era de um item.
  return {
    phases,
    phase,
    targets,
    target,
    canDispatch: blocked === null,
    blocked,
    hint: dispatchHint(card),
  };
}

/**
 * A única frase de "não houve nada". Ela é literal em dois lugares — as duas
 * varreduras deste arquivo — e por isso vive numa constante: quem decide entre
 * as duas compara com ELA, não com uma cópia da string.
 */
export const NOTHING_NEW = 'Nada novo no outbox.';

/**
 * O que dizer depois de varrer o outbox, olhando o `through_seq`.
 *
 * A versão anterior olhava só os arquivos RECUSADOS: varredura que ingeriu um
 * fato novo e não recusou nada dizia "Nada novo no outbox" — a tela negando o
 * que acabara de ler. `through_seq` é até onde o log foi reduzido; se ele
 * avançou, entrou fato. Comparar os dois snapshots é o que o renderer já tem em
 * mãos, sem inventar campo novo no DTO.
 *
 * Convive com `scanMessage`, que responde à MESMA pergunta pelos contadores da
 * varredura. Os contadores dizem mais, então falam primeiro; este aqui é a rede
 * embaixo — quando eles vêm todos zerados e mesmo assim o log andou.
 */
export function scanOutcomeMessage(throughSeqBefore: number | null, rejected: number, throughSeqAfter: number): string {
  const entrou = throughSeqBefore !== null && throughSeqAfter > throughSeqBefore;
  if (rejected > 0) {
    return `${rejected} arquivo(s) fora do contrato — os cards mostram o motivo.${entrou ? ' O que estava dentro do contrato entrou.' : ''}`;
  }
  return entrou ? 'Entrou fato novo do outbox. Os cards já mostram o que a skill declarou.' : NOTHING_NEW;
}

/** Um erro de ingestão, em português, sem esconder o caminho do arquivo. */
export function ingestErrorLine(error: IngestErrorSnapshot): string {
  const first = error.issues[0];
  const detail = first === undefined ? 'motivo não registrado' : `${first.code}${first.path ? ` em ${first.path}` : ''}`;
  const more = error.issues.length > 1 ? ` (+${error.issues.length - 1})` : '';
  return `${detail}${more}`;
}

/** O que a última varredura do outbox encontrou — os três desfechos possíveis. */
export interface ScanCounts {
  readonly ingestedOnLastScan: number;
  readonly rejectedOnLastScan: number;
  readonly unreadableOnLastScan: number;
}

/**
 * A frase da varredura. Cada desfecho tem palavra própria, e "nada novo" só é
 * dito quando os três são zero.
 *
 * Nasceu de um print: a barra dizia "Nada novo no outbox." no mesmo instante em
 * que a fase virava "concluída", a etapa ia para Planejado e um plano aparecia
 * no card — a tela negando a mudança que ela própria acabara de mostrar. A
 * causa era a frase olhar SÓ para o que foi recusado; ingerir e não conseguir
 * ler não tinham palavra. É a mesma raiz do bug de 03/08: o texto decidido a
 * partir de meia informação, e não do estado inteiro.
 */
export function scanMessage(scan: ScanCounts): string {
  const parts: string[] = [];
  if (scan.ingestedOnLastScan > 0) {
    parts.push(`${scan.ingestedOnLastScan} resultado(s) novo(s) — os cards já mudaram`);
  }
  if (scan.rejectedOnLastScan > 0) {
    parts.push(`${scan.rejectedOnLastScan} arquivo(s) fora do contrato — os cards mostram o motivo`);
  }
  if (scan.unreadableOnLastScan > 0) {
    // "Não consegui ler" nunca vira "não aconteceu": o que a skill fez segue
    // valendo, só não foi lido.
    parts.push(`${scan.unreadableOnLastScan} arquivo(s) que não consegui ler — nada foi afirmado sobre eles`);
  }
  if (parts.length === 0) return NOTHING_NEW;
  return `${parts.join('. ')}.`;
}

export const STORE_COMPATIBILITY_WARNING: Readonly<Record<string, string | null>> = {
  'read-write': null,
  'read-only': 'Este histórico foi escrito por uma versão mais nova do Donel Dev. Dá para ler, mas nada será gravado aqui.',
  'needs-migration': 'Este histórico é de um formato anterior. A escrita só volta depois de uma migração explícita.',
  unreadable: 'Não consegui ler o cabeçalho do histórico. Nada será gravado até isso se resolver.',
};

export function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
