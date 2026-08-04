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
import { esteiraPhaseCommand } from './esteiraSession';
import type {
  DiscoverySnapshot,
  IngestErrorSnapshot,
  LockRecord,
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
  readonly notes: readonly { readonly text: string; readonly at: string }[];
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
  const cliSessionId = card.openSession?.cliSessionId ?? lock.cliSessionId;

  if (claimed || lock.holderKind === 'skill') {
    // Dono, hora e sessão (D-11): a trava nomeia quem a segura. Sem o id do
    // CLI (trava posta pela skill), diz quem a pôs — nunca fica anônima.
    const dono = cliSessionId === null ? `por ${holder}` : `na sessão ${cliSessionId}`;
    return {
      title: 'Em andamento',
      line: `Fase ${lock.phase}, ${dono}, desde ${formatTimestamp(lock.acquiredAt)}.`,
      nextStep: null,
    };
  }

  return {
    title: 'Preparada — ninguém assumiu ainda',
    line: `O app separou o contexto da fase ${lock.phase} às ${formatTimestamp(lock.acquiredAt)} e travou o card. Nada está rodando: nenhuma sessão assumiu esta fase ainda.`,
    nextStep:
      inputPath === null
        ? null
        : {
            explanation: 'Rode a fase apontando para o contexto que o app deixou:',
            command: esteiraPhaseCommand(lock.phase, inputPath),
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
    notes: snapshot.notes.filter((note) => belongs(note.subject)).map((note) => ({ text: note.text, at: note.at })),
  };
}

/**
 * Em que pé está a SESSÃO daquela fase — o que decide entre três frases que
 * descrevem estados diferentes e já foram confundidas duas vezes neste repo.
 */
export type PhasePresence =
  /** Alguém assumiu: existe sessão viva com id do CLI. */
  | 'claimed'
  /** O app separou o contexto e travou o card; ninguém pegou ainda. */
  | 'prepared'
  /** Batch B1 — havia sessão, ela acabou, e a fase não concluiu nem falhou. */
  | 'interrupted';

/**
 * A frase de UMA passagem de fase. Cada estado tem palavra própria — e nenhuma
 * delas é "não realizada":
 *
 *  - concluiu      → "concluída", "abandonada", "terminou sem conclusão"
 *  - falhou        → "falhou: <código>" (o desfecho ruim é legível)
 *  - assumida      → "em andamento"
 *  - só preparada  → "preparada, ninguém assumiu"
 *  - interrompida  → "interrompida: a sessão terminou sem concluir"
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
export function phaseLine(phase: PhaseRunSnapshot, presence: PhasePresence = 'claimed'): string {
  if (phase.failure !== null) return `${phase.phase} — falhou: ${phase.failure.code}`;
  if (phase.completedAt !== null) {
    const outcome =
      phase.outcome === 'done' ? 'concluída' : phase.outcome === 'abandoned' ? 'abandonada' : 'terminou sem conclusão';
    return `${phase.phase} — ${outcome}`;
  }
  if (phase.startedAt !== null) {
    const word =
      presence === 'claimed'
        ? 'em andamento'
        : presence === 'prepared'
          ? 'preparada, ninguém assumiu'
          : 'interrompida: a sessão terminou sem concluir';
    return `${phase.phase} — ${word}`;
  }
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
    const doAssunto = card.sessions.filter(
      (entry) =>
        entry.phase === phase.phase && entry.subject.entity === phase.subject.entity && entry.subject.id === phase.subject.id,
    );
    const aberta = doAssunto.find((entry) => entry.endedAt === null);
    // Sessão aberta manda: assumida ou só preparada. Sem sessão aberta, mas com
    // sessão que já existiu, a fase ficou pelo meio — e é isso que a tela diz.
    // Sem sessão nenhuma (fase vinda só da ingestão), a frase não depende disso.
    const presence: PhasePresence =
      aberta !== undefined ? (aberta.claimed ? 'claimed' : 'prepared') : doAssunto.length > 0 ? 'interrupted' : 'claimed';
    return {
      key: `${phase.subject.entity}:${phase.subject.id}:${phase.phase}`,
      text: phaseLine(phase, presence),
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
