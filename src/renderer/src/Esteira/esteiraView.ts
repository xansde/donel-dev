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

/** O que dizer depois de plantar. Conta o que entrou — e lembra do que aquilo é. */
export function seededSummary(counts: { readonly plans: number; readonly items: number }): string {
  const plans = counts.plans === 0 ? 'nenhum plano' : counts.plans === 1 ? '1 plano' : `${counts.plans} planos`;
  const items = counts.items === 0 ? 'nenhum item' : counts.items === 1 ? '1 item' : `${counts.items} itens`;
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
    notes: snapshot.notes.filter((note) => belongs(note.subject)).map((note) => ({ text: note.text, at: note.at })),
  };
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
  /** D-2 — a fase foi afirmada num seed, não observada de uma execução. */
  readonly mark: ProvenanceMark | null;
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
      // A marca vai AO LADO da frase, não dentro dela: a frase descreve o
      // desfecho, a marca diz quem o afirmou. Misturar as duas faria o
      // vocabulário do desfecho depender da proveniência — e ele já tem dono.
      mark: provenanceMark(phase.seeded),
    };
  });
}

/** Uma linha da lista de itens. Mesmo motivo das fases: o texto nasce aqui, nunca no JSX. */
export interface ItemLineView {
  readonly key: string;
  readonly text: string;
  readonly mark: ProvenanceMark | null;
}

export function itemLines(card: CardView): readonly ItemLineView[] {
  return card.items.map((item) => ({
    key: item.id,
    // "sem repo alvo" é dito com todas as letras: item sem alvo não dispara
    // (D-6), e esconder isso deixaria o card prometendo o que não cumpre.
    text: `${item.title} · ${item.itemType} · ${item.state}${item.targetRepo ? ` · ${item.targetRepo}` : ' · sem repo alvo'}`,
    mark: provenanceMark(item.seeded),
  }));
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
