import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnnotationTag,
  Button,
  computeClockTier,
  HomologationClock,
  LevelCarousel,
  PhaseChip,
  type EsteiraPhase as ChipPhase,
  type LevelCarouselCard,
  type LevelCarouselLevel,
} from '@donel-dev/design-system';
import type { PhaseNode } from '../../../main/discovery-tree';
import type { BoardFacts } from '../../../shared';
import type { AnnotatedDiscoveryTree, AnnotatedPlanCardNode } from '../../../shared/boardAnnotation';
import type { EsteiraPhase, PhaseDefaultsTable } from '../../../shared/devMode';
import type { PhasePullRequestFacts } from '../../../shared/githubFacts';
import {
  buildPlanCardTags,
  buildTrilha,
  canonicalLevelKeys,
  computeHomologationDeadline,
  formatDeadlineAbsolute,
  moveLevelFocus,
  nextLevelPreview,
  planCardToneColor,
  resolvePlanCardTone,
  shouldPromoteClockToStatusBar,
  type MapLevelKey,
  type PlanCardTag,
} from '../../../shared/mapLevels';
import type { PhaseStatus } from '../../../shared/phaseState';
import { formatRelativeTime } from '../../../shared/sessions';
import styles from './DiscoveryMap.module.css';

// Lote 7 (009-modo-dev-v3) — CA-7..CA-16: o mapa vira o carrossel de dois
// eixos do design v3, sobre o `LevelCarousel` do lote 6 (`design-system`).
//
// Geometria (CA-7/verificação §2): painel esquerdo de 480px, cards de 392px
// (garantidos pelo próprio `LevelCarousel.module.css`), detalhe do nó em
// painel PRÓPRIO de 316px à direita — este componente NÃO renderiza esse
// painel (fica em `App.tsx`/`PhaseDetailsPanel.tsx`, lote 8 preenche o
// conteúdo rico).
//
// Uma regra, dois eixos (CA-9): a lista de níveis vem de `canonicalLevelKeys`
// (`shared/mapLevels.ts`, CA-14) — nunca um template de tamanho fixo. Nível
// ausente não deixa buraco: deixa uma lista mais curta.
//
// A trilha (CA-13) mora DENTRO do card de plano em foco (mesma composição do
// mockup) — etapas que já tiveram sessão + a próxima, nada além
// (`buildTrilha`). Clicar numa etapa passada retoma a sessão arquivada;
// clicar/"⌁ Preparar" na próxima segue.

/** `EsteiraPhase` do domínio tem 7 valores (com `cliente`); o `PhaseChip` do design-system só desenha 6 (sem `cliente` ainda). */
const CHIP_PHASES: ReadonlySet<string> = new Set<ChipPhase>(['discovery', 'plano', 'implementar', 'validar', 'concluir', 'documentar']);

function isChipPhase(phase: EsteiraPhase): phase is ChipPhase {
  return CHIP_PHASES.has(phase);
}

export interface SelectedPhaseNode {
  readonly cardId: string;
  readonly phase: EsteiraPhase;
  /** Só implementar/validar — identifica QUAL fase (PR) do card, quando há mais de uma (CA-11). */
  readonly faseNum?: number | null;
}

/** Decisão A do handoff v3 — o relógio urgente fora de foco, pronto para a `StatusBar` (variante compacta). `null` = nada a promover agora. */
export interface PromotedHomologationClock {
  readonly absoluteLabel: string;
  readonly deadline: number;
}

export interface DiscoveryMapProps {
  /** T327 — a árvore JÁ ANOTADA pelo espelho (`annotateTree`). Sem fonte de board, os campos de anotação chegam vazios e o mapa degrada por omissão. */
  tree: AnnotatedDiscoveryTree;
  /**
   * Item 5 da rodada de forma (fix/009-board-real-e-modal) — os 4 fatos do
   * CA-12 para o card RAIZ (discovery), buscados pela mesma via dos cards de
   * plano (`get_task_details`, App.tsx). `null` sem fonte de board — o card
   * mostra só o id (nunca fabrica título).
   */
  discoveryBoardFacts: BoardFacts | null;
  phaseDefaults: PhaseDefaultsTable;
  focusedPlanCardId: string | null;
  selectedNode: SelectedPhaseNode | null;
  /** Perfil de conta ATIVO agora — usado para o aviso do CA-22 na etapa arquivada (repassado por quem monta o painel de detalhe, lote 8). */
  activeProfileSlug: string;
  /** Instante "agora" — nunca lido de `Date.now()` aqui dentro (mesmo contrato do `HomologationClock`). */
  now: number;
  /** Lote 4 (CA-3) — fatos do PR por fase, chave `${cardId}:${faseNum}`. Entrada ausente = PR ainda não resolvido para aquela fase (degradação por omissão). */
  phasePullRequestFacts: Readonly<Record<string, PhasePullRequestFacts | null>>;
  onFocusPlanCard: (cardId: string) => void;
  /** Clique numa etapa da trilha (passada → retoma para consulta; próxima → segue/prepara) — mesmo `handlePhaseAction` de antes, agora com `faseNum` opcional. */
  onSelectPhase: (cardId: string, phase: EsteiraPhase, faseNum?: number) => void;
  /** CA-7 — o cabeçalho "Esteira · id · Trocar…" mora DENTRO do painel de 480px agora (mockup linhas 71-79). */
  onOpenTrocar: () => void;
  /** T328/CA-13 — abre a sessão de conciliação do card divergente (prompt pré-digitado; o app nunca corrige o board). */
  onConciliate?: (cardId: string, phase: EsteiraPhase) => void;
  /** CA-16/D1 — confirma "Liberar trava…" (a trava é etiqueta do board, nunca arquivo). */
  onReleaseLock?: (cardId: string, phase: EsteiraPhase) => void;
  /** Decisão A — chamado sempre que o candidato a promoção muda (tier `urgente` fora de foco); `null` limpa a promoção. */
  onHomologationPromote?: (promoted: PromotedHomologationClock | null) => void;
}

interface DiscoveryCardContent {
  readonly kind: 'discovery';
  readonly discoveryCardId: string;
  /** Título real do board (`discoveryBoardFacts.title`) — `null` sem fonte (item 5: "sem título, mostre só o id", nunca fabricado). */
  readonly title: string | null;
  /** "N plano(s) rodando" — `null` sem nenhum card de plano em execução (item 5: derivado do status real, omitido sem dado). */
  readonly runningBadge: string | null;
  /** "N planos" — `null` sem card de plano nenhum ainda. */
  readonly footer: string | null;
}

interface TrilhaRenderItem {
  readonly key: string;
  readonly phase: EsteiraPhase;
  readonly faseNum?: number;
  readonly status: PhaseStatus;
  readonly isNext: boolean;
  readonly isLast: boolean;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

interface PlanoCardContent {
  readonly kind: 'plano';
  readonly planCard: AnnotatedPlanCardNode;
  /** 'worktree' (track código) ou `null` (track documental, ou worktree ainda não existe — item 6: nunca fabricado). */
  readonly metaLabel: string | null;
  readonly metaValue: string | null;
  readonly tags: readonly PlanCardTag[];
  /** Só quando o card está em foco (CA-13 — a trilha vive no card em foco). */
  readonly trilha: readonly TrilhaRenderItem[] | null;
  readonly action: { label: string; variant: 'danger' | 'secondary'; onClick: () => void } | null;
  readonly statusLabel: string;
}

interface FaseCardContent {
  readonly kind: 'fase';
  readonly role: 'implementar' | 'validar';
  readonly cardId: string;
  readonly faseNum: number;
  readonly titulo: string;
  readonly node: PhaseNode;
  /** Etiqueta à direita do título (item 8) — estado do PR desta fase; `null` sem PR resolvido ainda. */
  readonly prLabel: string | null;
  /** Rodapé "garantia <tipo> · merge <relativo>" (item 8) — `null` sem os dois fatos. */
  readonly footerMeta: string | null;
  readonly clock: { absoluteLabel: string; deadline: number } | null;
}

/**
 * FIX (rodada de feedback 30/07, item 4) — card-fantasma do nível-preview
 * ("PLANOS"), quando `tree.planCards` ainda está vazio. Nunca clicável, nunca
 * em foco (`DiscoveryMap` só empurra este nível DEPOIS do índice em foco —
 * ver comentário de `levels` abaixo): a geometria de "fora de foco" do
 * `LevelCarousel` (124px, opacidade 0.22) já desenha o esmaecido sozinha,
 * sem CSS/token novo.
 */
interface PreviewCardContent {
  readonly kind: 'preview';
  readonly label: string;
  /** `null` = degradação por omissão (`nextLevelPreview`, shared/mapLevels.ts) — discovery já concluída, sem `plan_cards[]` ainda. */
  readonly hint: string | null;
}

type MapCardContent = DiscoveryCardContent | PlanoCardContent | FaseCardContent | PreviewCardContent;

function planCardStatusLabel(planCard: AnnotatedPlanCardNode): string {
  const phases = planCard.phases;
  if (phases.implementar.status === 'running' || phases.validar.status === 'running' || phases.plano.status === 'running') {
    return 'em execução';
  }
  if (phases.implementar.status === 'stuck' || phases.validar.status === 'stuck') return 'travada';
  if (phases.implementar.status === 'failed' || phases.validar.status === 'failed') return 'falhou';
  if (phases.concluir.status === 'done') return 'concluído';
  if (phases.validar.status === 'done') return 'homologado';
  if (phases.implementar.status === 'done') return 'aguardando homologação';
  return 'em plano';
}

/** CA-3 — o estado do PR desce para o card da fase (mergeado · homologado · revertido); sem PR ainda, `null` (omissão). */
function prStatusLabel(pr: PhasePullRequestFacts | null | undefined): string | null {
  if (!pr) return null;
  if (pr.revertidoCiclo) return 'revertido';
  if (pr.homologado) return 'homologado';
  if (pr.merged) return `mergeado · PR #${pr.number}`;
  return pr.state === 'open' ? `PR #${pr.number} aberto` : pr.state;
}

function prKey(cardId: string, faseNum: number): string {
  return `${cardId}:${faseNum}`;
}

/** Item 8 — "garantia <tipo> · merge <relativo>" no rodapé do card de fase; cada metade some sem o fato correspondente (nunca fabricado). */
function faseFooterMeta(garantiaTipo: string | null, mergedAt: string | null, now: number): string | null {
  const mergedMs = mergedAt ? Date.parse(mergedAt) : NaN;
  const mergeRelative = Number.isNaN(mergedMs) ? null : `merge ${formatRelativeTime(mergedMs, now)}`;
  const parts = [garantiaTipo ? `garantia ${garantiaTipo}` : null, mergeRelative].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// A fase `discovery` é do CARD RAIZ, nunca do card de plano em si — nada
// escreve `<planCardId>/discovery/…` em disco, então
// `planCard.phases.discovery.status` seria SEMPRE `not-started` (não existe
// fonte pra ela) e a trilha pararia ali no 1º passo pra todo card de plano.
// Um card de plano só existe porque a discovery da árvore já rodou e
// declarou `plan_cards[]` — a etapa "discovery" da trilha é, por construção,
// sempre `done` (mesmo dado do mockup: `{id:'discovery', st:'concluida'}`
// em toda fixture de trilha, sem exceção).
const DISCOVERY_STEP = { phase: 'discovery' as const, status: 'done' as const, key: 'discovery' };

/** CA-13 — as etapas do CAMINHO DE CÓDIGO: discovery, plano, e cada fase declarada (implementar-N, validar-N), na ordem. */
function codigoTrilhaSteps(planCard: AnnotatedPlanCardNode): readonly { phase: EsteiraPhase; faseNum?: number; status: PhaseStatus; key: string }[] {
  const steps: { phase: EsteiraPhase; faseNum?: number; status: PhaseStatus; key: string }[] = [
    DISCOVERY_STEP,
    { phase: 'plano', status: planCard.phases.plano.status, key: 'plano' },
  ];
  for (const fase of planCard.fases) {
    steps.push({ phase: 'implementar', faseNum: fase.faseNum, status: fase.implementar.status, key: `implementar-${fase.faseNum}` });
    steps.push({ phase: 'validar', faseNum: fase.faseNum, status: fase.validar.status, key: `validar-${fase.faseNum}` });
  }
  return steps;
}

/** CA-18 — o caminho DOCUMENTAL é só Discovery → Documentar (D-V5: o valor é `documentar`; "Documentação" é rótulo do chip). */
function documentalTrilhaSteps(planCard: AnnotatedPlanCardNode): readonly { phase: EsteiraPhase; faseNum?: number; status: PhaseStatus; key: string }[] {
  return [DISCOVERY_STEP, { phase: 'documentar', status: planCard.phases.documentar.status, key: 'documentar' }];
}

export function DiscoveryMap({
  tree,
  discoveryBoardFacts,
  phaseDefaults: _phaseDefaults,
  focusedPlanCardId,
  selectedNode,
  activeProfileSlug: _activeProfileSlug,
  now,
  phasePullRequestFacts,
  onFocusPlanCard,
  onSelectPhase,
  onOpenTrocar,
  onConciliate,
  onReleaseLock,
  onHomologationPromote,
}: DiscoveryMapProps): React.JSX.Element {
  // CA-9 — navegação PRÓPRIA do mapa (os dois eixos): qual nível está em
  // foco no eixo Y, e qual card em foco no eixo X de implementação/validação
  // (o eixo X do nível "planos" já é `focusedPlanCardId`, controlado por
  // fora — mesmo padrão do resto do app). Estado de tela, não de domínio.
  const [focusedLevelKey, setFocusedLevelKey] = useState<MapLevelKey>('planos');
  const [implFaseIndex, setImplFaseIndex] = useState(0);
  const [valFaseIndex, setValFaseIndex] = useState(0);

  const focusedPlanCard = tree.planCards.find((pc) => pc.cardId === focusedPlanCardId) ?? tree.planCards[0];

  const hasPlanCards = tree.planCards.length > 0;
  const faseCount = focusedPlanCard?.fases.length ?? 0;
  const levelKeys = useMemo(() => canonicalLevelKeys({ hasPlanCards, faseCount }), [hasPlanCards, faseCount]);

  // Nível ausente não deixa buraco (CA-14): se o nível em foco saiu da lista
  // (ex.: card de plano sem fase nenhuma ainda), cai para o último existente.
  const effectiveLevelKey = levelKeys.includes(focusedLevelKey) ? focusedLevelKey : (levelKeys.at(-1) ?? 'discovery');
  const focusedLevelIndex = Math.max(0, levelKeys.indexOf(effectiveLevelKey));

  const clampedImplIndex = Math.min(implFaseIndex, Math.max(0, faseCount - 1));
  const clampedValIndex = Math.min(valFaseIndex, Math.max(0, faseCount - 1));

  // FIX (E2E 30/07, F1) — eixo vertical navega nos dois sentidos, como o
  // horizontal já faz (`onPrevCard`/`onNextCard`). `moveLevelFocus` é a MESMA
  // aritmética pura de `mapLevels.ts`; aqui só os dois gestos que faltavam
  // (roda do mouse + setas ↑/↓). Debounce no wheel: cada "degrau" de scroll
  // do trackpad dispara várias dezenas de eventos — sem represar, o mapa
  // saltaria vários níveis por um gesto só.
  const lastWheelAtRef = useRef(0);
  const moveLevel = useCallback(
    (direction: 1 | -1) => setFocusedLevelKey((current) => moveLevelFocus(levelKeys, current, direction)),
    [levelKeys],
  );
  const handleMapWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (Math.abs(event.deltaY) < 4) return;
      const now = Date.now();
      if (now - lastWheelAtRef.current < 260) return;
      lastWheelAtRef.current = now;
      moveLevel(event.deltaY > 0 ? 1 : -1);
    },
    [moveLevel],
  );
  const handleMapKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveLevel(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveLevel(-1);
      }
    },
    [moveLevel],
  );

  // Decisão A — a fase "aberta" (com janela de homologação correndo): a
  // primeira cujo PR mergeado ainda não foi homologado/revertido.
  const openFase = useMemo(() => {
    if (!focusedPlanCard) return null;
    return (
      focusedPlanCard.fases.find((fase) => {
        const pr = phasePullRequestFacts[prKey(focusedPlanCard.cardId, fase.faseNum)];
        return computeHomologationDeadline(pr ?? null) !== null;
      }) ?? null
    );
  }, [focusedPlanCard, phasePullRequestFacts]);

  const openFaseIndex = openFase ? (focusedPlanCard?.fases.findIndex((f) => f.faseNum === openFase.faseNum) ?? -1) : -1;
  const openFaseInView = effectiveLevelKey === 'validacao' && openFaseIndex >= 0 && clampedValIndex === openFaseIndex;

  const promoted = useMemo((): PromotedHomologationClock | null => {
    if (!focusedPlanCard || !openFase) return null;
    const pr = phasePullRequestFacts[prKey(focusedPlanCard.cardId, openFase.faseNum)];
    const deadline = computeHomologationDeadline(pr ?? null);
    if (deadline === null) return null;
    const tier = computeClockTier(deadline, now).tier;
    if (!shouldPromoteClockToStatusBar(tier, openFaseInView)) return null;
    return { absoluteLabel: formatDeadlineAbsolute(deadline, now), deadline };
  }, [focusedPlanCard, openFase, phasePullRequestFacts, now, openFaseInView]);

  useEffect(() => {
    onHomologationPromote?.(promoted);
  }, [promoted?.deadline, promoted === null, onHomologationPromote]);

  const planLevelLabel = focusedPlanCard?.track === 'documental' ? 'Documentação' : 'Planos';

  const levels = useMemo((): LevelCarouselLevel<MapCardContent>[] => {
    const result: LevelCarouselLevel<MapCardContent>[] = [];

    if (levelKeys.includes('discovery')) {
      // Item 5 — "N plano(s) rodando" derivado do status REAL (mesma tabela
      // que já decide o rótulo do card de plano, `planCardStatusLabel`);
      // omitido sem nenhum plano em execução (nunca "0 planos rodando").
      const runningCount = tree.planCards.filter((planCard) => planCardStatusLabel(planCard) === 'em execução').length;
      const discoveryCard: LevelCarouselCard<MapCardContent> = {
        id: tree.discoveryCardId,
        accent: tree.allPlanCardsComplete ? 'var(--zone-ok)' : 'var(--accent)',
        content: {
          kind: 'discovery',
          discoveryCardId: tree.discoveryCardId,
          title: discoveryBoardFacts?.title || null,
          runningBadge: runningCount > 0 ? `${runningCount} ${runningCount === 1 ? 'plano rodando' : 'planos rodando'}` : null,
          footer: tree.planCards.length > 0 ? `${tree.planCards.length} ${tree.planCards.length === 1 ? 'plano' : 'planos'}` : null,
        },
      };
      result.push({
        key: 'discovery',
        label: 'Discovery',
        focusedCardIndex: 0,
        cards: [discoveryCard],
        onFocusLevel: () => setFocusedLevelKey('discovery'),
      });
    }

    // FIX (rodada de feedback 30/07, item 4) — "abri um discovery e não
    // tinha como avançar para a próxima etapa": sem `plan_cards` ainda,
    // `levelKeys` para em `['discovery']` — o mapa mostrava só o card do
    // discovery, nenhum indício do caminho adiante. O preview nasce como um
    // 2º NÍVEL de verdade (nunca focável — sem `onFocusLevel`/`onFocusCard`,
    // e o índice em foco nunca aponta pra ele, ver `focusedLevelIndex`
    // acima), então a geometria "fora de foco" do `LevelCarousel` (124px,
    // opacidade 0.22 — `carouselGeometry.ts`) já o desenha esmaecido sozinha.
    const preview = nextLevelPreview({ hasPlanCards, discoveryStatus: tree.discoveryStatus });
    if (preview) {
      result.push({
        key: preview.key,
        label: preview.label,
        focusedCardIndex: 0,
        cards: [{ id: 'preview-planos', content: { kind: 'preview', label: preview.label, hint: preview.hint } }],
      });
    }

    if (levelKeys.includes('planos')) {
      const planIndex = Math.max(0, tree.planCards.findIndex((pc) => pc.cardId === focusedPlanCard?.cardId));
      result.push({
        key: 'planos',
        label: planLevelLabel,
        tall: true,
        focusedCardIndex: planIndex,
        cards: tree.planCards.map((planCard) => {
          const divergence = (['discovery', 'plano', 'implementar', 'validar', 'documentar', 'cliente', 'concluir'] as const)
            .map((phase) => planCard.phases[phase].divergence)
            .find((d) => d !== null);
          const focused = planCard.cardId === focusedPlanCard?.cardId && effectiveLevelKey === 'planos';
          const tags = buildPlanCardTags({
            boardColumn: planCard.boardFacts?.column ?? null,
            columnDivergence: divergence ? { diskStatus: divergence.diskStatus, boardColumn: divergence.boardColumn } : null,
            lockedPhase: planCard.boardFacts?.lockedPhase ?? null,
            attentionLabels: planCard.boardFacts?.attentionLabels ?? [],
            homologationDeadlineLabel:
              openFase && planCard.cardId === focusedPlanCard?.cardId
                ? formatDeadlineAbsolute(
                    computeHomologationDeadline(phasePullRequestFacts[prKey(planCard.cardId, openFase.faseNum)] ?? null) ?? now,
                    now,
                  )
                : null,
          });
          const steps = planCard.track === 'documental' ? documentalTrilhaSteps(planCard) : codigoTrilhaSteps(planCard);
          const trilhaSteps = buildTrilha(steps.map((s) => ({ id: s.key, status: s.status })));
          const trilha: TrilhaRenderItem[] | null = focused
            ? trilhaSteps.map((step, index) => {
                const source = steps[index];
                return {
                  key: source.key,
                  phase: source.phase,
                  faseNum: source.faseNum,
                  status: step.status,
                  isNext: step.isNext,
                  isLast: index === trilhaSteps.length - 1,
                  label: source.faseNum ? `fase ${source.faseNum}` : '',
                  selected:
                    selectedNode?.cardId === planCard.cardId &&
                    selectedNode.phase === source.phase &&
                    (selectedNode.faseNum ?? undefined) === source.faseNum,
                  onSelect: () => onSelectPhase(planCard.cardId, source.phase, source.faseNum),
                };
              })
            : null;

          const lockedHere = planCard.boardFacts?.lockedPhase;
          const action: PlanoCardContent['action'] = focused
            ? lockedHere
              ? { label: '⊘ Liberar trava…', variant: 'danger', onClick: () => onReleaseLock?.(planCard.cardId, lockedHere as EsteiraPhase) }
              : divergence
                ? {
                    label: '⇄ Preparar conciliação',
                    variant: 'secondary',
                    onClick: () => onConciliate?.(planCard.cardId, (Object.keys(planCard.phases) as EsteiraPhase[]).find((p) => planCard.phases[p].divergence === divergence) ?? 'plano'),
                  }
                : null
            : null;

          const statusLabel = planCardStatusLabel(planCard);
          // Item 7 — o tone segue o ESTADO real do card (mesma prioridade das
          // etiquetas do CA-16), nunca fixo em verde.
          const accent = planCardToneColor(
            resolvePlanCardTone({ hasDivergence: divergence !== null, isLocked: Boolean(lockedHere), statusLabel }),
          );
          // Item 6 — a faixa "worktree <path>" (track código; track
          // documental não tem fonte equivalente hoje — omitida, nunca
          // fabricada). Primeira fase com o dado vence: implementar é onde a
          // worktree nasce, validar/plano ficam de reforço.
          const worktreePath =
            planCard.track === 'codigo'
              ? (planCard.phases.implementar.artifacts.worktreePath ??
                planCard.phases.validar.artifacts.worktreePath ??
                planCard.phases.plano.artifacts.worktreePath ??
                null)
              : null;

          return {
            id: planCard.cardId,
            accent,
            content: {
              kind: 'plano',
              planCard,
              metaLabel: worktreePath ? 'worktree' : null,
              metaValue: worktreePath,
              tags,
              trilha,
              action,
              statusLabel,
            },
          } satisfies LevelCarouselCard<MapCardContent>;
        }),
        onFocusLevel: () => setFocusedLevelKey('planos'),
        onFocusCard: (index) => {
          const target = tree.planCards[index];
          if (target) onFocusPlanCard(target.cardId);
          setFocusedLevelKey('planos');
        },
        onPrevCard: () => {
          const target = tree.planCards[Math.max(0, planIndex - 1)];
          if (target) onFocusPlanCard(target.cardId);
        },
        onNextCard: () => {
          const target = tree.planCards[Math.min(tree.planCards.length - 1, planIndex + 1)];
          if (target) onFocusPlanCard(target.cardId);
        },
      });
    }

    if (levelKeys.includes('implementacao') && focusedPlanCard) {
      result.push({
        key: 'implementacao',
        label: 'Implementação',
        focusedCardIndex: clampedImplIndex,
        cards: focusedPlanCard.fases.map((fase) => {
          const pr = phasePullRequestFacts[prKey(focusedPlanCard.cardId, fase.faseNum)] ?? null;
          return {
            id: `${focusedPlanCard.cardId}:impl:${fase.faseNum}`,
            accent: fase.implementar.status === 'done' ? 'var(--zone-ok)' : 'var(--accent)',
            content: {
              kind: 'fase',
              role: 'implementar',
              cardId: focusedPlanCard.cardId,
              faseNum: fase.faseNum,
              titulo: fase.titulo ?? `Fase ${fase.faseNum}`,
              node: fase.implementar,
              prLabel: prStatusLabel(pr),
              // Item 8 — a garantia é da FASE (declarada pelo plano, `PlanCardFaseNode.garantia`),
              // a mesma fonte que o painel de detalhe já usa (`phaseDetailsView.ts`) — não o
              // `outputs.garantia` do manifesto de validar (fonte antiga, só existia pro card de validar).
              footerMeta: faseFooterMeta(fase.garantia?.tipo ?? null, pr?.mergedAt ?? null, now),
              clock: null,
            },
          } satisfies LevelCarouselCard<MapCardContent>;
        }),
        onFocusLevel: () => setFocusedLevelKey('implementacao'),
        onFocusCard: (index) => {
          setImplFaseIndex(index);
          setFocusedLevelKey('implementacao');
        },
        onPrevCard: () => setImplFaseIndex((i) => Math.max(0, i - 1)),
        onNextCard: () => setImplFaseIndex((i) => Math.min(focusedPlanCard.fases.length - 1, i + 1)),
      });
    }

    if (levelKeys.includes('validacao') && focusedPlanCard) {
      result.push({
        key: 'validacao',
        label: 'Validação',
        focusedCardIndex: clampedValIndex,
        cards: focusedPlanCard.fases.map((fase) => {
          const pr = phasePullRequestFacts[prKey(focusedPlanCard.cardId, fase.faseNum)] ?? null;
          const deadline = computeHomologationDeadline(pr ?? null);
          return {
            id: `${focusedPlanCard.cardId}:val:${fase.faseNum}`,
            accent: fase.validar.status === 'done' ? 'var(--zone-ok)' : 'var(--state-waiting)',
            content: {
              kind: 'fase',
              role: 'validar',
              cardId: focusedPlanCard.cardId,
              faseNum: fase.faseNum,
              titulo: fase.titulo ?? `Fase ${fase.faseNum}`,
              node: fase.validar,
              prLabel: prStatusLabel(pr),
              footerMeta: faseFooterMeta(fase.garantia?.tipo ?? null, pr?.mergedAt ?? null, now),
              clock: deadline !== null ? { absoluteLabel: formatDeadlineAbsolute(deadline, now), deadline } : null,
            },
          } satisfies LevelCarouselCard<MapCardContent>;
        }),
        onFocusLevel: () => setFocusedLevelKey('validacao'),
        onFocusCard: (index) => {
          setValFaseIndex(index);
          setFocusedLevelKey('validacao');
        },
        onPrevCard: () => setValFaseIndex((i) => Math.max(0, i - 1)),
        onNextCard: () => setValFaseIndex((i) => Math.min(focusedPlanCard.fases.length - 1, i + 1)),
      });
    }

    return result;
  }, [
    levelKeys,
    tree,
    discoveryBoardFacts,
    focusedPlanCard,
    effectiveLevelKey,
    planLevelLabel,
    clampedImplIndex,
    clampedValIndex,
    phasePullRequestFacts,
    openFase,
    now,
    selectedNode,
    onFocusPlanCard,
    onSelectPhase,
    onConciliate,
    onReleaseLock,
  ]);

  return (
    <aside
      className={styles.map}
      aria-label="Mapa do discovery"
      data-testid="devmode-map"
      tabIndex={0}
      onWheel={handleMapWheel}
      onKeyDown={handleMapKeyDown}
    >
      {/* CA-7 (mockup linhas 71-79) — o cabeçalho "Esteira · id · Trocar…"
          mora DENTRO do painel de 480px, não numa faixa à parte. */}
      <header className={styles.header}>
        <span className={styles.headerLabel}>Esteira</span>
        <span className={styles.headerId} data-testid="devmode-map-discovery-id">
          {tree.discoveryCardId}
        </span>
        <div className={styles.headerSpacer} />
        <Button variant="ghost" onClick={onOpenTrocar} data-testid="devmode-entry-trigger">
          Trocar…
        </Button>
      </header>

      <LevelCarousel<MapCardContent>
        levels={levels}
        focusedLevelIndex={focusedLevelIndex}
        renderCard={(content, context) => renderMapCard(content, context.focused)}
      />

      {tree.planCards.length === 0 ? (
        <p className={styles.empty} data-testid="devmode-map-empty">
          Nenhum card de plano ainda — nasce em `outputs.plan_cards` do `discovery-result.json`.
        </p>
      ) : null}
    </aside>
  );
}

function renderMapCard(content: MapCardContent, focused: boolean): React.JSX.Element {
  if (content.kind === 'discovery') {
    // Item 5 — linha 1: id + título real do board (`null` = mostra só o id,
    // nunca fabricado) + etiqueta de planos rodando; rodapé: "N planos".
    return (
      <div className={styles.cardBody} data-testid={`devmode-map-discovery-${content.discoveryCardId}`}>
        <div className={styles.cardTop}>
          <span className={styles.cardIcon}>◈</span>
          <span className={styles.cardId}>{content.discoveryCardId}</span>
          <span className={styles.cardTitle}>{content.title ?? ''}</span>
          {content.runningBadge ? <span className={styles.cardStatus}>{content.runningBadge}</span> : null}
        </div>
        {content.footer ? <div className={styles.cardFooterMeta}>{content.footer}</div> : null}
      </div>
    );
  }

  if (content.kind === 'plano') {
    const { planCard, metaLabel, metaValue, tags, trilha, action, statusLabel } = content;
    return (
      <div className={styles.cardBody} data-testid={`devmode-map-plano-${planCard.cardId}`} data-focused={focused ? 'true' : 'false'}>
        <div className={styles.cardTop}>
          <span className={styles.cardIcon}>{planCard.track === 'documental' ? '▤' : '▷'}</span>
          <span className={styles.cardId}>{planCard.cardId}</span>
          <span className={styles.cardTitle}>{planCard.boardFacts?.title || planCard.cardId}</span>
          <span className={styles.cardStatus}>{statusLabel}</span>
        </div>
        {/* Item 6 — a faixa "worktree <path>" (metaLabel/metaValue) e as 4
            etiquetas da Decisão B (board/trava/atenção/prazo) vivem na MESMA
            linha, como no mockup — nunca duas faixas separadas. */}
        {metaLabel || tags.length > 0 ? (
          <div className={styles.cardTags} data-testid={`devmode-map-plano-tags-${planCard.cardId}`}>
            {metaLabel ? (
              <>
                <span className={styles.cardMetaLabel}>{metaLabel}</span>
                <span className={styles.cardMetaValue}>{metaValue}</span>
              </>
            ) : null}
            {tags.map((tag) => (
              <AnnotationTag key={tag.text} tone={tag.tone}>
                {tag.text}
              </AnnotationTag>
            ))}
          </div>
        ) : null}
        {action ? (
          <div className={styles.cardAction}>
            <Button variant={action.variant} onClick={action.onClick} data-testid={`devmode-map-plano-action-${planCard.cardId}`}>
              {action.label}
            </Button>
          </div>
        ) : null}
        {trilha ? (
          <div className={styles.trilha} data-testid={`devmode-map-trilha-${planCard.cardId}`}>
            {trilha.map((step) => (
              <div
                key={step.key}
                className={[styles.trilhaRow, step.isNext ? styles.trilhaRowNext : '', step.selected ? styles.trilhaRowSelected : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={step.onSelect}
                data-testid={`devmode-trilha-step-${planCard.cardId}-${step.key}`}
              >
                <span className={styles.trilhaRail} aria-hidden="true">
                  {step.isLast ? '└' : '├'}
                </span>
                <span className={[styles.trilhaGlyph, styles[`state-${step.status}`]].join(' ')} aria-hidden="true">
                  {trilhaGlyphChar(step.status)}
                </span>
                {isChipPhase(step.phase) ? <PhaseChip phase={step.phase} /> : null}
                {step.label ? <span className={styles.trilhaFase}>{step.label}</span> : null}
                <div className={styles.trilhaSpacer} />
                <span className={styles.trilhaState}>{trilhaStateLabel(step.status)}</span>
                {step.isNext ? (
                  <Button
                    variant="secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      step.onSelect();
                    }}
                    data-testid={`devmode-trilha-prepare-${planCard.cardId}-${step.key}`}
                  >
                    ⌁ Preparar
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (content.kind === 'preview') {
    // FIX (item 4, rodada de feedback 30/07) — card-fantasma do nível
    // "Planos": só o rótulo do nível + o hint (quando existir — degradação
    // por omissão, `nextLevelPreview`). A geometria de fora de foco
    // (124px/opacidade 0.22) já esmaece o card sozinha; nada de estilo novo
    // aqui, só menos conteúdo que um card real.
    return (
      <div className={styles.cardBody} data-testid="devmode-map-preview-planos">
        <div className={styles.cardTop}>
          <span className={styles.cardIcon}>▷</span>
          <span className={styles.cardTitle}>{content.label}</span>
        </div>
        {content.hint ? <div className={styles.cardFooterMeta}>{content.hint}</div> : null}
      </div>
    );
  }

  // content.kind === 'fase' (Implementação/Validação, CA-11/CA-12)
  // Item 8 — linha "fase N <título>" + etiqueta de PR à direita (quando
  // resolvido); rodapé "garantia <tipo> · merge <relativo>" (cada metade some
  // sem o fato correspondente — nunca fabricada).
  return (
    <div className={styles.cardBody} data-testid={`devmode-map-fase-${content.role}-${content.cardId}-${content.faseNum}`}>
      <div className={styles.cardTop}>
        <span className={styles.cardIcon}>{content.role === 'implementar' ? '⑂' : '◷'}</span>
        <span className={styles.cardId}>fase {content.faseNum}</span>
        <span className={styles.cardTitle}>{content.titulo}</span>
        {content.prLabel ? <span className={styles.cardStatus}>{content.prLabel}</span> : null}
      </div>
      {content.footerMeta ? <div className={styles.cardFooterMeta}>{content.footerMeta}</div> : null}
      {content.role === 'validar' && content.clock ? (
        <div className={styles.cardClock}>
          <HomologationClock absoluteLabel={content.clock.absoluteLabel} deadline={content.clock.deadline} now={Date.now()} />
        </div>
      ) : null}
    </div>
  );
}

function trilhaGlyphChar(status: PhaseStatus): string {
  switch (status) {
    case 'not-started':
      return '○';
    case 'running':
      return '▶';
    case 'done':
      return '✓';
    case 'failed':
      return '✕';
    case 'stuck':
      return '⊘';
  }
}

function trilhaStateLabel(status: PhaseStatus): string {
  switch (status) {
    case 'not-started':
      return 'é a próxima';
    case 'running':
      return 'em execução';
    case 'done':
      return 'concluída';
    case 'failed':
      return 'falhou';
    case 'stuck':
      return 'travada';
  }
}

