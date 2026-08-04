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

import { MACRO_STAGE_LABEL } from '../../../shared/esteira/ipc';
import { MACRO_STAGES } from '../../../shared/esteira/store/storeFormat';
import type {
  DiscoverySnapshot,
  EntityId,
  IngestErrorSnapshot,
  LockRecord,
  MacroStage,
  PhaseRunSnapshot,
  SessionSnapshot,
  StoreSnapshot,
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
    title: 'O espelho no board falhou e está na fila. O trabalho local segue normalmente.',
  },
};

export function signalViews(discovery: DiscoverySnapshot): readonly SignalView[] {
  return discovery.stageSignals.map((signal) => SIGNAL_VIEW[signal]);
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

/** A linha de UM item na lista do card — tudo que ela diz nasce aqui. */
export function itemLine(item: WorkItemSnapshot): string {
  const repo = item.targetRepo ?? 'sem repo alvo';
  const origem = item.createdBySkill ? ' · criado pela skill' : '';
  return `${item.title} · ${item.itemType} · ${WORK_ITEM_STATE_LABEL[item.state]} · ${repo}${origem}`;
}

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

/** D-16 — por que o descarte não tem bloqueio, e o que ele não apaga. */
export function discardHint(item: WorkItemSnapshot): string {
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
  readonly planCount: number;
  readonly items: readonly WorkItemSnapshot[];
  readonly phases: readonly PhaseRunSnapshot[];
  readonly lock: LockRecord | null;
  /** A sessão aberta pelo disparo, quando existe — é dela que saem os caminhos do inbox/outbox. */
  readonly openSession: SessionSnapshot | null;
  /** Todas as sessões do card: é delas que sai o "alguém assumiu?" de cada fase. */
  readonly sessions: readonly SessionSnapshot[];
  readonly ingestErrors: readonly IngestErrorSnapshot[];
  readonly notes: readonly NoteView[];
}

/**
 * O que dizer sobre a fase travada. A distinção existe porque o app **prepara**
 * a fase mas ainda não abre a sessão sozinho: chamar isso de "em andamento"
 * seria a tela prometendo o que não cumpre — o mesmo vício que a spec 010
 * combate, só que na direção contrária ("não realizada" para o que foi feito).
 */
export interface LockView {
  readonly title: string;
  readonly line: string;
  /** Preenchido enquanto ninguém assumiu: o que fazer para a fase de fato rodar. */
  readonly nextStep: { readonly explanation: string; readonly command: string } | null;
}

export function lockView(card: CardView): LockView | null {
  const lock = card.lock;
  if (lock === null) return null;

  const holder = lock.holderKind === 'skill' ? 'uma skill' : 'o app';
  const claimed = card.openSession?.claimed ?? false;
  const inputPath = card.openSession?.inputPath ?? null;

  if (claimed || lock.holderKind === 'skill') {
    return {
      title: 'Em andamento',
      line: `Fase ${lock.phase}, por ${holder}, desde ${formatTimestamp(lock.acquiredAt)}.`,
      nextStep: null,
    };
  }

  return {
    title: 'Preparada — ninguém assumiu ainda',
    line: `O app separou o contexto da fase ${lock.phase} às ${formatTimestamp(lock.acquiredAt)} e travou o card. Nada está rodando: abrir a sessão ainda é um passo manual.`,
    nextStep:
      inputPath === null
        ? null
        : {
            explanation: 'Rode a fase apontando para o contexto que o app deixou:',
            command: `python skills/esteira-donel-3.0.0/tools/read_input.py --input "${inputPath}"`,
          },
  };
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

  return {
    discovery,
    stage: stageView(discovery),
    signals: signalViews(discovery),
    planCount: plans.length,
    items,
    phases: snapshot.phases.filter((phase) => belongs(phase.subject)),
    lock: snapshot.locks.find((lock) => belongs(lock.subject)) ?? null,
    // A última sessão aberta do assunto: é ela que carrega os caminhos do
    // `run-input.json` e do `result.json` desta rodada.
    openSession: [...snapshot.sessions].reverse().find((session) => belongs(session.subject) && session.endedAt === null) ?? null,
    sessions: snapshot.sessions.filter((session) => belongs(session.subject)),
    ingestErrors: snapshot.ingestErrors.filter((error) => error.subject !== null && belongs(error.subject)),
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
 * A frase de UMA passagem de fase. Cada estado tem palavra própria — e nenhuma
 * delas é "não realizada":
 *
 *  - concluiu     → "concluída", "abandonada", "terminou sem conclusão"
 *  - falhou       → "falhou: <código>" (o desfecho ruim é legível)
 *  - assumida     → "em andamento"
 *  - só preparada → "preparada, ninguém assumiu"
 *
 * `claimed` existe porque o app registra `phase.started` no DISPARO, e disparar
 * não é começar: o card fica travado esperando alguém rodar a fase. Chamar isso
 * de "em andamento" foi o mesmo erro que o bloco da trava já tinha cometido —
 * ele reapareceu aqui porque a correção de lá não subiu até a raiz.
 */
export function phaseLine(phase: PhaseRunSnapshot, claimed = true): string {
  if (phase.failure !== null) return `${phase.phase} — falhou: ${phase.failure.code}`;
  if (phase.completedAt !== null) {
    const outcome =
      phase.outcome === 'done' ? 'concluída' : phase.outcome === 'abandoned' ? 'abandonada' : 'terminou sem conclusão';
    return `${phase.phase} — ${outcome}`;
  }
  if (phase.startedAt !== null) return `${phase.phase} — ${claimed ? 'em andamento' : 'preparada, ninguém assumiu'}`;
  return `${phase.phase} — registrada`;
}

/** As fases do card, cada uma com a frase certa — a tela só imprime o que sai daqui. */
export interface PhaseLineView {
  readonly key: string;
  readonly text: string;
  readonly failed: boolean;
  readonly detail: string | null;
}

export function phaseLines(card: CardView): readonly PhaseLineView[] {
  return card.phases.map((phase) => {
    // Assumida = existe sessão aberta desta fase E alguém a declarou. Sem
    // sessão aberta (fase já encerrada), a frase não depende disso.
    const session = card.sessions.find(
      (entry) =>
        entry.phase === phase.phase &&
        entry.subject.entity === phase.subject.entity &&
        entry.subject.id === phase.subject.id &&
        entry.endedAt === null,
    );
    const claimed = session === undefined ? true : session.claimed;
    return {
      key: `${phase.subject.entity}:${phase.subject.id}:${phase.phase}`,
      text: phaseLine(phase, claimed),
      failed: phase.failure !== null,
      detail: phase.failure?.message ?? null,
    };
  });
}

/** Um erro de ingestão, em português, sem esconder o caminho do arquivo. */
export function ingestErrorLine(error: IngestErrorSnapshot): string {
  const first = error.issues[0];
  const detail = first === undefined ? 'motivo não registrado' : `${first.code}${first.path ? ` em ${first.path}` : ''}`;
  const more = error.issues.length > 1 ? ` (+${error.issues.length - 1})` : '';
  return `${detail}${more}`;
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
