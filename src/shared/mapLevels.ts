import type { ClockTier } from '@donel-dev/design-system';
import type { PhaseStatus } from './phaseState';

// Lote 7 (009-modo-dev-v3) — lógica pura do carrossel de dois eixos
// (CA-9/CA-11/CA-13/CA-14) e da promoção do relógio de homologação (Decisão
// A do handoff v3, verificação §1). Isolado de React/Electron/disco de
// propósito — mesma disciplina de `carouselGeometry.ts`/`homologationClock.ts`
// (design-system): a montagem VISUAL (LevelCarousel, HomologationClock) fica
// em `DiscoveryMap.tsx`; aqui só a DECISÃO.

/** Os 4 níveis do eixo vertical (CA-10) — Backlog não é nível (porta de entrada), Validação com Cliente/Conclusão também não. */
export type MapLevelKey = 'discovery' | 'planos' | 'implementacao' | 'validacao';

export interface CanonicalLevelKeysInput {
  /** Há pelo menos 1 card de plano na árvore (`tree.planCards.length > 0`). */
  readonly hasPlanCards: boolean;
  /** Nº de fases (`fase_num`, unidade de PR) que o PLANO EM FOCO propôs — 0 até o plano fatiar. */
  readonly faseCount: number;
}

/**
 * CA-14 — nenhum template de tamanho fixo: a lista é filtrada pelo que
 * existe, na ordem canônica. Discovery está sempre presente (é o card raiz
 * já carregado); Planos só entra com pelo menos 1 card de plano; Implementação
 * e Validação (CA-12: níveis DISTINTOS, nunca irmãos) só entram juntas, e só
 * quando o plano em foco já tem fase alguma proposta — sem card de plano em
 * foco elas nunca aparecem sozinhas (nunca um nível órfão).
 */
export function canonicalLevelKeys(input: CanonicalLevelKeysInput): readonly MapLevelKey[] {
  const keys: MapLevelKey[] = ['discovery'];
  if (!input.hasPlanCards) return keys;
  keys.push('planos');
  if (input.faseCount > 0) keys.push('implementacao', 'validacao');
  return keys;
}

/** CA-11/CA-13 — o ornamento de carrossel (setas + contador) só nasce quando há irmão. Nenhum ornamento para item único. */
export function needsCarousel(cardCount: number): boolean {
  return cardCount > 1;
}

export interface TrilhaStepInput<TId> {
  readonly id: TId;
  readonly status: PhaseStatus;
}

export interface TrilhaStep<TId> extends TrilhaStepInput<TId> {
  /** A etapa É a próxima (primeira `not-started` da lista) — só ela ganha o botão "⌁ Preparar". */
  readonly isNext: boolean;
}

/**
 * CA-13 — a trilha mostra as etapas que já tiveram sessão + a próxima, nada
 * além. "Já teve sessão" é qualquer status distinto de `not-started`
 * (running/done/failed/stuck: todas produziram algum registro em disco).
 * Para no PRIMEIRO `not-started` — o resto da lista (fases futuras ainda nem
 * propostas) nunca aparece.
 */
export function buildTrilha<TId>(steps: readonly TrilhaStepInput<TId>[]): readonly TrilhaStep<TId>[] {
  const result: TrilhaStep<TId>[] = [];
  for (const step of steps) {
    if (step.status === 'not-started') {
      result.push({ ...step, isNext: true });
      break;
    }
    result.push({ ...step, isNext: false });
  }
  return result;
}

/**
 * Decisão A do handoff v3 (verificação §1) — no degrau **urgente**, quando o
 * card de Validação NÃO está em foco, o relógio se promove à barra de status
 * (variante compacta): "promoção, nunca duplicação" — por isso a regra exige
 * `!cardFocused`. Os outros três degraus nunca promovem: `tranquilo`/`atencao`
 * não são urgentes o bastante para sair do card, e `estourado` já é reversão
 * automática em curso — a ação humana que a promoção existe para provocar já
 * não muda o desfecho.
 */
export function shouldPromoteClockToStatusBar(tier: ClockTier, cardFocused: boolean): boolean {
  return tier === 'urgente' && !cardFocused;
}

/** D-V4 (verificação de design) — `--fase=n` com `=`, nunca espaço (`--fase n`, do mockup, não é o contrato). */
export function formatFaseCommand(command: string, faseNum: number | null | undefined): string {
  if (faseNum === null || faseNum === undefined) return command;
  return `${command} --fase=${faseNum}`;
}

/**
 * Formato curto do prazo de homologação, para o card de plano (Decisão B,
 * etiqueta 4) e o `absoluteLabel` do `HomologationClock`. "hoje"/"amanhã" —
 * mesma forma do mockup ("amanhã (30/07) · 09:00"); a partir do 2º dia
 * seguinte, cai para `DD/MM` (sem rótulo relativo — a distância já deixou de
 * ser acionável no mesmo sentido de "hoje"/"amanhã").
 */
export function formatDeadlineAbsolute(deadline: number | Date, now: number | Date): string {
  const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
  const nowDate = now instanceof Date ? now : new Date(now);

  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(deadlineDate) - startOfDay(nowDate)) / (24 * 60 * 60 * 1000));

  const pad = (n: number): string => String(n).padStart(2, '0');
  const time = `${pad(deadlineDate.getHours())}:${pad(deadlineDate.getMinutes())}`;
  const dayMonth = `${pad(deadlineDate.getDate())}/${pad(deadlineDate.getMonth() + 1)}`;

  if (dayDiff === 0) return `hoje · ${time}`;
  if (dayDiff === 1) return `amanhã (${dayMonth}) · ${time}`;
  return `${dayMonth} · ${time}`;
}

const HOMOLOGATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PhasePullRequestFactsForDeadline {
  readonly mergedAt: string | null;
  readonly homologado: boolean;
  readonly revertidoCiclo: boolean;
}

/**
 * A spec nomeia `prazo_homologacao.deadline` como o fato mais acionável da
 * v3 (Discovery A1), mas nenhum manifesto grava esse campo — a janela de 24h
 * É o contrato (`mergedAt + 24h`, texto do próprio mockup: "a janela de
 * homologação começou a contar aqui" no instante do merge). Este é o único
 * cálculo: sem PR mergeado (`mergedAt` nulo/ilegível), ou já resolvido
 * (`homologado`/`revertidoCiclo`), não há relógio correndo — `null`, nunca
 * um prazo fabricado.
 */
export function computeHomologationDeadline(pr: PhasePullRequestFactsForDeadline | null): number | null {
  if (!pr || !pr.mergedAt || pr.homologado || pr.revertidoCiclo) return null;
  const mergedMs = Date.parse(pr.mergedAt);
  if (Number.isNaN(mergedMs)) return null;
  return mergedMs + HOMOLOGATION_WINDOW_MS;
}

export type PlanCardTagTone = 'muted' | 'error' | 'lock' | 'warn' | 'accent';

export interface PlanCardTag {
  readonly text: string;
  readonly tone: PlanCardTagTone;
}

export interface PlanCardTagsInput {
  /** `boardFacts.column`, ou `null` sem fonte de board (achado 12 — degrada por omissão, nenhuma etiqueta aparece). */
  readonly boardColumn: string | null;
  /** Divergência de QUALQUER fase deste card de plano (`AnnotatedPhaseNode.divergence`) — o primeiro fato encontrado decide o tom. */
  readonly columnDivergence: { readonly diskStatus: string; readonly boardColumn: string } | null;
  /** `boardFacts.lockedPhase` (já sem o prefixo `esteira:em-andamento:`) — `null` sem trava. */
  readonly lockedPhase: string | null;
  /** `boardFacts.attentionLabels` — hoje sempre `[]` na prática (achado 12: nenhuma tool expõe labels), mas o formato aceita N. */
  readonly attentionLabels: readonly string[];
  /** Já formatado por `formatDeadlineAbsolute` — `null` sem janela de homologação aberta. */
  readonly homologationDeadlineLabel: string | null;
}

/** O prefixo LITERAL da etiqueta de trava no board (D1/D-V3 — nunca "arquivo de trava"). */
const LOCK_LABEL_PREFIX = 'esteira:em-andamento:';

/**
 * Decisão B do handoff v3 (verificação §1) — as 4 etiquetas do card de
 * plano, e SÓ elas: coluna real do board, trava de fase com ação de liberar,
 * etiqueta de atenção do board, prazo de homologação em formato curto. A URL
 * do PR, "PR sem aprovação" e o texto genérico de conferência morreram —
 * não têm representação aqui. Sem `boardColumn` (achado 12/C4), a lista
 * inteira fica vazia: nenhuma etiqueta fabricada sem fonte.
 */
export function buildPlanCardTags(input: PlanCardTagsInput): readonly PlanCardTag[] {
  const tags: PlanCardTag[] = [];

  if (input.boardColumn !== null) {
    tags.push(
      input.columnDivergence
        ? { text: `⇄ disco: ${input.columnDivergence.diskStatus} · board: ${input.columnDivergence.boardColumn}`, tone: 'error' }
        : { text: `board: ${input.boardColumn}`, tone: 'muted' },
    );
  }

  if (input.lockedPhase) {
    tags.push({ text: `trava: ${LOCK_LABEL_PREFIX}${input.lockedPhase}`, tone: 'lock' });
  }

  for (const label of input.attentionLabels) {
    tags.push({ text: label, tone: 'warn' });
  }

  if (input.homologationDeadlineLabel) {
    tags.push({ text: `◷ homologar até ${input.homologationDeadlineLabel}`, tone: 'accent' });
  }

  return tags;
}
