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
import { mirrorOperationKind } from '../../../shared/esteira/mirror/mirrorPlan';
import type {
  DiscoverySnapshot,
  IngestErrorSnapshot,
  LockRecord,
  MirrorQueueEntry,
  PhaseRunSnapshot,
  SessionSnapshot,
  StoreSnapshot,
  WorkItemSnapshot,
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

/** Etapa mostrada + se ela é override manual. A derivada NUNCA some da tela (D-13). */
export interface StageView {
  readonly shown: string;
  readonly derived: string;
  readonly overridden: boolean;
  readonly overrideNote: string | null;
}

export function stageView(discovery: DiscoverySnapshot): StageView {
  const derived = MACRO_STAGE_LABEL[discovery.derivedStage];
  const override = discovery.stageOverride;
  if (override === null) return { shown: derived, derived, overridden: false, overrideNote: null };

  return {
    shown: MACRO_STAGE_LABEL[override.value],
    derived,
    overridden: true,
    overrideNote: `ajustado à mão por ${override.by}${override.reason ? ` — ${override.reason}` : ''}`,
  };
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
  /** D-12 — o que o board ainda não recebeu. Nunca bloqueia nada; só precisa ser visível. */
  readonly mirrorQueue: readonly MirrorQueueEntry[];
  readonly notes: readonly { readonly text: string; readonly at: string }[];
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
    mirrorQueue: snapshot.mirrorQueue.filter((entry) => belongs(entry.subject)),
    notes: snapshot.notes.filter((note) => belongs(note.subject)).map((note) => ({ text: note.text, at: note.at })),
  };
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
