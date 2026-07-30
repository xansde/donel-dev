import type { PhaseNode } from '../main/discovery-tree';
import type { PlanoFaseGarantiaRef } from '../main/esteira-reader';
import type { EsteiraPhase } from './devMode';
import type { PhasePullRequestFacts } from './githubFacts';
import type { PhaseStatus } from './phaseState';
import { formatArchivedAccountLabel, type ArchivedAccountLabel } from './sessionAccountLabel';

// Lote 8 (009-modo-dev-v3) — CA-18/CA-20: monta o CONTEÚDO rico do painel de
// 316px (`PhaseDetailsPanel.tsx`) a partir do que o disco/gh já entregam —
// mesma disciplina do resto do repo (C4/CA-6): cada seção degrada por
// OMISSÃO (`null`/`[]`), nunca erro na tela nem valor fabricado. Puro: sem
// I/O, sem React — só monta o view-model; quem resolve os dados brutos
// (qual `PhaseNode`, qual `PhasePullRequestFacts`) é o chamador (App.tsx).
//
// `PhaseNode`/`PlanoFaseGarantiaRef` são importados só como TIPO (mesmo
// padrão de `boardAnnotation.ts`) — este módulo shared nunca passa a
// depender de `node:fs` em runtime.

export interface PhaseDetailsBreadcrumb {
  readonly discoveryCardId: string;
  readonly planCardId: string;
  readonly planCardTitle: string;
  readonly phase: EsteiraPhase;
  /** `null` fora de implementar/validar (CA-11: só essas duas são indexadas por fase). */
  readonly faseNum: number | null;
}

export interface PhaseDetailsGarantiaView {
  /** '—' quando o plano ainda não declarou o tipo — nunca string vazia (C4). */
  readonly tipo: string;
  readonly descricao: string | null;
  /** Path do roteiro e2e (só quando `tipo === 'roteiro_e2e'`, contrato §D.3) — `null` nos demais tipos. */
  readonly roteiroPath: string | null;
  /** Rótulo curto do progresso desta garantia, derivado do status da fase (`done` → provada; senão pendente). */
  readonly statusLabel: string;
}

export interface PhaseDetailsPrRow {
  readonly label: string;
  readonly value: string;
}

export type PhaseDetailsArtifactIcon = '{}' | '◧' | '▤';

export interface PhaseDetailsArtifact {
  readonly path: string;
  readonly icon: PhaseDetailsArtifactIcon;
}

export interface PhaseDetailsReceipt {
  /** Fonte consultada, tal como o `result.json` gravou — string livre, nunca reinterpretada/adivinhada (C4: sem base pra separar "título" de "onde", mostra o dado cru). */
  readonly source: string;
}

export interface PhaseDetailsViewModel {
  readonly cardId: string;
  readonly phase: EsteiraPhase;
  readonly faseNum: number | null;
  readonly status: PhaseStatus;
  readonly breadcrumb: PhaseDetailsBreadcrumb;
  readonly summary: string;
  /** CA-25 — a conta em que a sessão ARQUIVADA desta etapa rodou; `null` sem sessão arquivada (etapa nunca rodou, ou rodou mas não foi arquivada — mesma degradação por omissão de sempre). */
  readonly archivedAccount: ArchivedAccountLabel | null;
  /** `null` = sem garantia declarada pelo plano pra esta fase (fora de implementar/validar, ou plano ainda não fatiou). */
  readonly garantia: PhaseDetailsGarantiaView | null;
  /** `null` = sem seção (fora de implementar/validar — CA-20 é 1 PR por FASE, não por card inteiro). */
  readonly pr: readonly PhaseDetailsPrRow[] | null;
  readonly artifacts: readonly PhaseDetailsArtifact[];
  /**
   * `false` só para a etapa "é a próxima" (`not-started`, nunca rodou) — sem
   * sessão nenhuma, exibir "sem registro" seria sugerir que ela rodou e não
   * achou nada, o que não é o fato. Para qualquer etapa que já rodou (mesmo
   * travada/falhou), a seção aparece — com a lista ou com "sem registro".
   */
  readonly showReceipts: boolean;
  readonly receipts: readonly PhaseDetailsReceipt[];
}

export interface BuildPhaseDetailsViewInput {
  readonly discoveryCardId: string;
  readonly planCardId: string;
  /** Já resolvido pelo chamador (`boardFacts?.title || cardId`, mesma regra do mapa). */
  readonly planCardTitle: string;
  readonly phase: EsteiraPhase;
  /** Só implementar/validar (CA-11) — `null` para as demais fases. */
  readonly faseNum: number | null;
  /** O nó da etapa selecionada — `marco.phases[phase]` OU `faseEntry[phase]`, já resolvido pelo chamador. */
  readonly node: PhaseNode;
  /** `PlanCardFaseNode.garantia` da fase selecionada — só presente quando `faseNum` também está (mesma fonte, CA-20). */
  readonly faseGarantia: PlanoFaseGarantiaRef | null;
  /** `phasePullRequestFacts[cardId:faseNum]` — `null` sem PR resolvido ainda. */
  readonly pr: PhasePullRequestFacts | null;
  /** Branch da fase (`node.artifacts.branch`, frontmatter do `ctx.md`, D3) — linha "branch" do PR. */
  readonly branch: string | null;
  /** CA-25 — perfil ATIVO agora (ProfileSwitcher), pra decidir se a conta arquivada diverge. */
  readonly activeProfileSlug: string;
}

function summaryFor(status: PhaseStatus): string {
  switch (status) {
    case 'not-started':
      return 'Esta é a próxima etapa da esteira. Preparar escreve o comando no prompt — o Enter é seu.';
    case 'running':
      return 'A sessão desta etapa está viva agora.';
    case 'done':
      return 'Etapa concluída — a sessão arquivada abre só para consulta.';
    case 'failed':
      return 'A etapa terminou mal. Corrigir e preparar de novo.';
    case 'stuck':
      return 'A sessão parou sem concluir e deixou uma trava. Liberar antes de seguir.';
  }
}

/** CA-20 — o campo `fases[].garantia` só existe pra implementar/validar (`faseNum` presente); as demais fases não têm seção de garantia (nunca fabricada). */
function buildGarantia(faseGarantia: PlanoFaseGarantiaRef | null, status: PhaseStatus): PhaseDetailsGarantiaView | null {
  if (!faseGarantia) return null;
  return {
    tipo: faseGarantia.tipo ?? '—',
    descricao: faseGarantia.descricao,
    roteiroPath: faseGarantia.roteiroPath,
    statusLabel: status === 'done' ? 'provada' : 'pendente',
  };
}

/** CA-20 — estado do PR sem o número embutido (o número é outra linha). */
function prStateWord(pr: PhasePullRequestFacts): string {
  if (pr.revertidoCiclo) return 'revertido';
  if (pr.homologado) return 'homologado';
  if (pr.merged) return 'mergeado';
  return pr.state === 'open' ? 'aberto' : pr.state;
}

function formatMergedAt(mergedAt: string | null): string {
  if (!mergedAt) return 'ainda não';
  const ms = Date.parse(mergedAt);
  if (Number.isNaN(ms)) return mergedAt;
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** CA-20 — só nasce com `faseNum` conhecido (1 PR : 1 fase, nunca por card inteiro). Sem PR resolvido ainda, mostra a seção com "sem PR ainda" (degradação por omissão do FATO, não da SEÇÃO — a fase já tem endereço de PR, só falta a leitura). */
function buildPr(faseNum: number | null, pr: PhasePullRequestFacts | null, branch: string | null): readonly PhaseDetailsPrRow[] | null {
  if (faseNum === null) return null;
  return [
    { label: 'PR', value: pr ? `#${pr.number} · ${prStateWord(pr)}` : 'sem PR ainda' },
    { label: 'merge', value: pr ? formatMergedAt(pr.mergedAt) : 'ainda não' },
    { label: 'branch', value: branch ?? '—' },
  ];
}

function artifactIcon(path: string): PhaseDetailsArtifactIcon {
  if (path.endsWith('.json')) return '{}';
  if (path.endsWith('.html')) return '◧';
  return '▤';
}

function buildArtifacts(node: PhaseNode): readonly PhaseDetailsArtifact[] {
  const paths = node.artifacts.result?.outputs.artifact_paths ?? [];
  return paths.map((path) => ({ path, icon: artifactIcon(path) }));
}

/** D-V7 — sem sources, a seção mostra "sem registro" (o componente decide isso); aqui só entrega o que o disco tem, nunca fabrica um recibo. */
function buildReceipts(node: PhaseNode): readonly PhaseDetailsReceipt[] {
  const consulted = node.artifacts.result?.outputs.knowledge?.consulted;
  if (!consulted || typeof consulted !== 'object') return [];
  const sources = (consulted as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  return sources.filter((s): s is string => typeof s === 'string').map((source) => ({ source }));
}

/** CA-18/CA-20 — monta o view-model completo do painel a partir de dados JÁ RESOLVIDOS pelo chamador. Nunca lança; qualquer campo ausente vira seção ausente/vazia (C4). */
export function buildPhaseDetailsView(input: BuildPhaseDetailsViewInput): PhaseDetailsViewModel {
  return {
    cardId: input.planCardId,
    phase: input.phase,
    faseNum: input.faseNum,
    status: input.node.status,
    breadcrumb: {
      discoveryCardId: input.discoveryCardId,
      planCardId: input.planCardId,
      planCardTitle: input.planCardTitle,
      phase: input.phase,
      faseNum: input.faseNum,
    },
    summary: summaryFor(input.node.status),
    archivedAccount: input.node.archivedSession
      ? formatArchivedAccountLabel(input.node.archivedSession.profileSlug, input.activeProfileSlug)
      : null,
    garantia: buildGarantia(input.faseGarantia, input.node.status),
    pr: buildPr(input.faseNum, input.pr, input.branch),
    artifacts: buildArtifacts(input.node),
    showReceipts: input.node.status !== 'not-started',
    receipts: buildReceipts(input.node),
  };
}
