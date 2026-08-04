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
import type {
  DiscoverySnapshot,
  IngestErrorSnapshot,
  LockRecord,
  PhaseRunSnapshot,
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
  readonly ingestErrors: readonly IngestErrorSnapshot[];
  readonly notes: readonly { readonly text: string; readonly at: string }[];
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
    ingestErrors: snapshot.ingestErrors.filter((error) => error.subject !== null && belongs(error.subject)),
    notes: snapshot.notes.filter((note) => belongs(note.subject)).map((note) => ({ text: note.text, at: note.at })),
  };
}

/**
 * A frase de UMA passagem de fase. Três estados bem diferentes, três frases
 * diferentes — nenhuma delas é "não realizada":
 *
 *  - concluiu    → "concluída", "abandonada", "sem conclusão"
 *  - falhou      → "falhou: <código>" (o desfecho ruim é legível)
 *  - só começou  → "em andamento"
 */
export function phaseLine(phase: PhaseRunSnapshot): string {
  if (phase.failure !== null) return `${phase.phase} — falhou: ${phase.failure.code}`;
  if (phase.completedAt !== null) {
    const outcome =
      phase.outcome === 'done' ? 'concluída' : phase.outcome === 'abandoned' ? 'abandonada' : 'terminou sem conclusão';
    return `${phase.phase} — ${outcome}`;
  }
  if (phase.startedAt !== null) return `${phase.phase} — em andamento`;
  return `${phase.phase} — registrada`;
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
