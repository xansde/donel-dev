import { join } from 'node:path';
import type { ArchivedPhaseSession, ArchivedPhaseSessions, EsteiraPhase } from '../shared/devMode';
import { archivedPhaseSessionKey } from '../shared/devMode';
import { derivePhaseStatus, type PhaseStatus } from '../shared/phaseState';
import {
  readDiscoveryPlanCards,
  readPhaseArtifacts,
  readPlanoFases,
  type EsteiraReaderIoDeps,
  type EsteiraStateRoot,
  type PhaseArtifacts,
  type PlanCardRef,
  type PlanoFaseGarantiaRef,
  type PlanoFaseRef,
} from './esteira-reader';

// T305 (003-modo-dev, Batch A) — árvore do discovery (CA-7/CA-9/CA-10/CA-23):
// cards de plano × fases, tudo lido do disco (`esteira-reader.ts`) + do
// estado próprio arquivado (`archivedPhaseSessions`, CA-21). `sessionAlive`
// NUNCA entra aqui: só o processo main (registro de PTYs em memória) sabe
// quem está vivo — este módulo é 100% disco puro, testável sem Electron. A
// Zona 3 (Batch B, T316/T319) sobrepõe "running" por cima usando o que já tem
// em memória, sem recalcular a árvore inteira a cada tick.
//
// CA-17 (009-modo-dev-v3) — `marco`/`MarcoNode`/`marcoId` morreram: o disco
// não grava mais `marco_id` (plan_cards[] não tem esse campo — o card_id já
// identifica o card de plano sozinho). `MarcoNode` → `PlanCardNode`;
// `DiscoveryTree.marcos` → `.planCards`; `.focusedMarcoId` →
// `.focusedPlanCardId`; `.allMarcosComplete` → `.allPlanCardsComplete` (MESMA
// lógica — checa `phases.concluir.status`, que a v3 nem grava; o CA-21 que
// conserta isso é do lote 8, não deste).
//
// CA-4/D.0-bis — implementar/validar arquivam por `fase-<n>` (fase do plano).
// `phases.implementar`/`phases.validar` (o Record de 7 fases abaixo)
// CONTINUAM lendo sempre `faseNum: 1` — decisão herdada do lote 2, mantida de
// propósito para não quebrar quem já consome esse Record (boardAnnotation.ts,
// a divergência disco×board). O lote 7 (CA-11) ACRESCENTA `PlanCardNode.fases`
// — a lista REAL de fases que o plano propôs (`outputs.fases[]`,
// `readPlanoFases`), cada uma com seu PRÓPRIO par implementar/validar lido do
// `fase_num` verdadeiro. As duas fontes de leitura convivem: nenhuma fase
// nova é fabricada por suposição fora de `outputs.fases[]`.

const ALL_PHASES: readonly EsteiraPhase[] = ['discovery', 'plano', 'implementar', 'validar', 'documentar', 'cliente', 'concluir'];

/** Só implementar/validar (D.0-bis) — as demais nunca leem por fase-num. */
const PHASE_ARCHIVES_BY_FASE_NUM: readonly EsteiraPhase[] = ['implementar', 'validar'];

/** Lote 2 (009-modo-dev-v3) — ponto de partida até o carrossel (CA-11/lote 7) saber ler `fases[]` do plano. */
const DEFAULT_FASE_NUM = 1;

export interface PhaseNode {
  readonly phase: EsteiraPhase;
  readonly status: PhaseStatus; // CA-15, sempre com sessionAlive: false (ver comentário de topo)
  readonly artifacts: PhaseArtifacts;
  readonly archivedSession: ArchivedPhaseSession | null; // CA-9/CA-21
}

/** Lote 7 (CA-11) — uma fase (`fase_num`, unidade de PR) que o plano propôs, com seu par implementar/validar do disco DAQUELE `fase_num`. */
export interface PlanCardFaseNode {
  readonly faseNum: number;
  /** `null` = plano não deu título — degradação por omissão. */
  readonly titulo: string | null;
  /** Lote 8 (CA-20) — a garantia declarada pelo plano (contrato §D.3), a MESMA pras duas sub-fases (D13). `null` = não declarada. */
  readonly garantia: PlanoFaseGarantiaRef | null;
  readonly implementar: PhaseNode;
  readonly validar: PhaseNode;
}

/** CA-17 — o que o app chamava de `MarcoNode`. `track`/`shadow` vêm de `plan_cards[]` (D8/D9 do contrato). */
export interface PlanCardNode {
  readonly cardId: string;
  readonly track: 'codigo' | 'documental';
  readonly shadow: boolean;
  readonly phases: Readonly<Record<EsteiraPhase, PhaseNode>>;
  /** CA-11/CA-14 — as fases (unidade de PR) que o PLANO declarou (`outputs.fases[]`); `[]` até ele fatiar — é essa lista vazia que faz Implementação/Validação não nascerem no mapa. */
  readonly fases: readonly PlanCardFaseNode[];
}

export interface DiscoveryTree {
  readonly discoveryCardId: string;
  readonly planCards: readonly PlanCardNode[];
  /** Layout/UI (Batch B) decide qual card de plano destacar — este módulo não sabe seleção, só disco. */
  readonly focusedPlanCardId: string | null;
  /** CA-23 — true quando TODO card de plano tem a fase concluir com status "success". Disco puro, sem board. */
  readonly allPlanCardsComplete: boolean;
  /**
   * FIX (rodada de feedback 30/07, item 4) — status da fase `discovery` do
   * CARD RAIZ (não de um card de plano — a árvore ainda não tem nenhum
   * quando isto importa). Único lugar que precisa saber se o discovery já
   * rodou/terminou SEM depender de `planCards.length > 0`: o mapa usa isto
   * pra decidir a MENSAGEM do nível-preview "Planos" (`nextLevelPreview`,
   * `shared/mapLevels.ts`) quando `planCards` ainda está vazio — "rode a
   * etapa Discovery" enquanto ela não rodou/terminou, degradado por omissão
   * (sem mensagem fabricada) quando ela JÁ terminou mas não declarou
   * `plan_cards[]` ainda (dado incompleto, não erro).
   */
  readonly discoveryStatus: PhaseStatus;
}

function buildPhaseNode(
  root: EsteiraStateRoot,
  fase: EsteiraPhase,
  cardId: string,
  archived: ArchivedPhaseSessions,
  io: EsteiraReaderIoDeps,
): PhaseNode {
  const faseNum = PHASE_ARCHIVES_BY_FASE_NUM.includes(fase) ? DEFAULT_FASE_NUM : undefined;
  const artifacts = readPhaseArtifacts({ ...root, cardId, fase, faseNum }, io);
  const status = derivePhaseStatus({
    ctxExists: artifacts.ctxExists,
    result: artifacts.result,
    resultUnreadable: artifacts.resultUnreadable,
    sessionAlive: false, // ver comentário de topo do arquivo
  });
  const archivedSession = archived[archivedPhaseSessionKey({ cardId, phase: fase })] ?? null;

  return { phase: fase, status, artifacts, archivedSession };
}

/** CA-11 — uma entrada de `PlanCardNode.fases`, com implementar/validar lidos do `fase_num` REAL (não o `DEFAULT_FASE_NUM` do Record legado). */
function buildFaseNode(root: EsteiraStateRoot, cardId: string, ref: PlanoFaseRef, archived: ArchivedPhaseSessions, io: EsteiraReaderIoDeps): PlanCardFaseNode {
  const buildAt = (fase: EsteiraPhase): PhaseNode => {
    const artifacts = readPhaseArtifacts({ ...root, cardId, fase, faseNum: ref.faseNum }, io);
    const status = derivePhaseStatus({
      ctxExists: artifacts.ctxExists,
      result: artifacts.result,
      resultUnreadable: artifacts.resultUnreadable,
      sessionAlive: false, // ver comentário de topo do arquivo
    });
    const archivedSession = archived[archivedPhaseSessionKey({ cardId, phase: fase })] ?? null;
    return { phase: fase, status, artifacts, archivedSession };
  };

  return { faseNum: ref.faseNum, titulo: ref.titulo, garantia: ref.garantia, implementar: buildAt('implementar'), validar: buildAt('validar') };
}

function buildPlanCardNode(root: EsteiraStateRoot, planCard: PlanCardRef, archived: ArchivedPhaseSessions, io: EsteiraReaderIoDeps): PlanCardNode {
  const phases = {} as Record<EsteiraPhase, PhaseNode>;
  for (const phase of ALL_PHASES) {
    phases[phase] = buildPhaseNode(root, phase, planCard.cardId, archived, io);
  }

  const faseRefs = readPlanoFases(root, planCard.cardId, io);
  const fases = faseRefs.map((ref) => buildFaseNode(root, planCard.cardId, ref, archived, io));

  return { cardId: planCard.cardId, track: planCard.track, shadow: planCard.shadow, phases, fases };
}

/**
 * CA-21 (lote 8) — a v3 não grava `concluir-result.json` (`esteira-concluir`
 * é gate mecânico, contrato §D.7: "não grava result.json; grava
 * create_comment e move a coluna"), então `phases.concluir.status === 'done'`
 * nunca fica verdadeiro (problema 3 da spec — a causa de `allPlanCardsComplete`
 * nunca ter disparado o auto-close do CA-23 na v3). O sinal de disco mais
 * próximo de "este card de plano terminou", por track:
 * - **código**: QUALQUER fase declarada (`PlanCardNode.fases`) cujo
 *   `validar-result.json` mais recente traga `outputs.plano_completo: true`
 *   (contrato §D.5 — "todas as fases DESTE PLANO estão homologadas", o mesmo
 *   fato sobre o plano inteiro; qualquer fase que já tenha rodado com essa
 *   marca basta, não precisa ser a última). Sem fase alguma declarada ainda
 *   (`fases: []`), nunca completo — nunca fabrica conclusão por ausência.
 * - **documental**: a fase `documentar` (terminal do track, §B) com status
 *   `done` no disco.
 * Isto é disco puro (mesmo espírito do resto deste módulo — ver comentário de
 * topo do arquivo): NÃO confirma a coluna real do board (Concluído). É sinal
 * aproximado, usado só para o auto-close de `discoveriesToClose`
 * (`devModeSelection.ts`, CA-23 da 003) — fechar o discovery no estado PRÓPRIO
 * do app não escreve nada no board nem no disco da Esteira.
 */
function planCardComplete(planCard: PlanCardNode): boolean {
  if (planCard.track === 'documental') return planCard.phases.documentar.status === 'done';
  if (planCard.fases.length === 0) return false;
  return planCard.fases.some((fase) => fase.validar.artifacts.result?.outputs.plano_completo === true);
}

/** CA-7/CA-9/CA-10/CA-17/CA-21/CA-23 — monta o discovery em foco por completo, a partir do disco. Nunca lança. */
export function buildDiscoveryTree(
  root: EsteiraStateRoot,
  discoveryCardId: string,
  archived: ArchivedPhaseSessions,
  io: EsteiraReaderIoDeps,
): DiscoveryTree {
  const planCardRefs = readDiscoveryPlanCards(root, discoveryCardId, io);
  const planCards = planCardRefs.map((ref) => buildPlanCardNode(root, ref, archived, io));

  const allPlanCardsComplete = planCards.length > 0 && planCards.every(planCardComplete);
  // FIX (item 4) — mesmo `buildPhaseNode` que cada card de plano usa pra sua
  // própria fase `discovery` fixa (`DISCOVERY_STEP`, DiscoveryMap.tsx), só
  // que aqui é o card RAIZ de verdade sendo lido, não um card de plano —
  // funciona ANTES de existir plano nenhum.
  const discoveryStatus = buildPhaseNode(root, 'discovery', discoveryCardId, archived, io).status;

  return { discoveryCardId, planCards, focusedPlanCardId: null, allPlanCardsComplete, discoveryStatus };
}

// ---------------------------------------------------------------------------
// Pool de artefatos consultável (CA-10) — lista FIXA de candidatos, constante
// versionada no código (nunca varredura/descoberta em runtime). Cresce por
// PR, não por I/O. Repo-local (specs/plans/tasks continuam commitados no
// repo-alvo, ao contrário do handoff v3) — recebe `repoPath`, não a raiz do
// esteira-state.
// ---------------------------------------------------------------------------

export type ArtifactCandidateKind =
  | 'spec'
  | 'plan'
  | 'tasks'
  | 'research'
  | 'data-model'
  | 'contracts'
  | 'e2e'
  | 'lessons'
  | 'docs-processos';

export interface ArtifactCandidate {
  readonly kind: ArtifactCandidateKind;
  readonly path: string;
}

function fixedCandidates(repoPath: string, specSlug: string): readonly ArtifactCandidate[] {
  const specsDir = join(repoPath, 'specs', specSlug);
  return [
    { kind: 'spec', path: join(specsDir, 'spec.md') },
    { kind: 'plan', path: join(specsDir, 'plan.md') },
    { kind: 'tasks', path: join(specsDir, 'tasks.md') },
    { kind: 'research', path: join(specsDir, 'research.md') },
    { kind: 'data-model', path: join(specsDir, 'data-model.md') },
    { kind: 'contracts', path: join(specsDir, 'contracts') },
    { kind: 'e2e', path: join(specsDir, 'e2e.md') },
    { kind: 'lessons', path: join(repoPath, 'lessons.md') },
    { kind: 'docs-processos', path: join(repoPath, 'docs', 'processos') },
  ];
}

/** CA-10 — só confere EXISTÊNCIA de uma lista fixa de candidatos; não é varredura. */
export function resolveArtifactPool(repoPath: string, specSlug: string, io: EsteiraReaderIoDeps): readonly ArtifactCandidate[] {
  return fixedCandidates(repoPath, specSlug).filter((candidate) => io.existsSync(candidate.path));
}
