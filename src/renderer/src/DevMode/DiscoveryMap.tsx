import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AnnotationTag,
  Button,
  LevelCarousel,
  PhaseChip,
  isEsteiraPhase,
  type AnnotationTone,
  type LevelCarouselCard,
  type LevelCarouselLevel,
} from '@donel-dev/design-system';
import { moveLevelFocus } from '../../../shared/mapLevels';
import type { EsteiraMapView, MapCard, MapGlyph, MapLevelKey, MapSelection, MapTrailStep } from './esteiraMapView';
import styles from './DiscoveryMap.module.css';

// Spec 010 / batch B6 — o mapa continua sendo a tela do Modo Dev; o que mudou é
// de onde ele come. Antes ele lia `~/.claude/esteira-state/` fase a fase; agora
// recebe a projeção do STORE, já pronta, de `esteiraMapView.ts`.
//
// A forma é a do design v3 (lote 7 da 009), intocada: painel esquerdo, carrossel
// de dois eixos, trilha dentro do card em foco, detalhe em painel próprio à
// direita (`PhaseDetailsPanel`, montado por `App.tsx`).
//
// Este arquivo NÃO decide nada sobre o domínio: nenhuma frase de estado nasce
// aqui, nenhuma regra de "esta fase pode?" é recalculada. Foi montar frase no
// JSX que fez a mesma palavra errada reaparecer em três blocos diferentes.
//
// `isEsteiraPhase` vem do design-system (achado da captura do batch n8: este
// arquivo e `PhaseDetailsPanel.tsx` tinham cada um seu próprio Set local de
// "quais fases têm chip", e os dois esqueceram `design` quando a fase entrou
// no catálogo — `run.phase` continua string livre para fases fora da lista).

const GLYPH_CHAR: Readonly<Record<MapGlyph, string>> = {
  'not-started': '○',
  running: '▶',
  done: '✓',
  failed: '✕',
  stuck: '⊘',
};

const TONE_COLOR: Readonly<Record<string, string>> = {
  ok: 'var(--zone-ok)',
  warn: 'var(--state-waiting)',
  error: 'var(--state-permission)',
  lock: 'var(--state-error)',
  accent: 'var(--accent)',
  muted: 'var(--text-muted)',
};

export interface DiscoveryMapProps {
  /** A projeção inteira do store — o componente não a recalcula nem a completa. */
  view: EsteiraMapView;
  selection: MapSelection;
  /** Aviso de compatibilidade do histórico (só leitura, migração, ilegível). `null` quando dá para escrever. */
  warning: string | null;
  onFocusDiscovery: (discoveryId: string) => void;
  onFocusPlan: (planId: string) => void;
  onFocusItem: (itemId: string) => void;
  /** Clique num nó ou numa etapa da trilha — o painel de detalhe segue esta escolha. */
  onSelectNode: (nodeKey: string, phase: string | null) => void;
  /** "⌁ Preparar" — o mesmo gesto do painel do store (`preparePhase`), nunca uma segunda orquestração. */
  onPrepare: (step: MapTrailStep) => void;
  /**
   * B1 — "↺ Retomar", num passo FECHADO com `resume` preenchido: reabre a
   * última sessão da cadeia (`claude -r <cliSessionId>` no `cwd` dela). Sem
   * dispatch novo, sem mudar estado do card — é por isso que este gesto é
   * diferente de `onPrepare`.
   */
  onResume: (step: MapTrailStep) => void;
  /** D-16 — o app não ganha formulário: o gesto leva ao painel do store, onde a criação já mora. */
  onNewDiscovery: () => void;
  /**
   * C4 — só encolhe visualmente (largura 0, sem desmontar): o botão "Recolher
   * painéis" do titlebar zera a coluna do mapa, mas o componente PRECISA
   * continuar montado, ou o foco do carrossel (`focusedLevelKey`, estado
   * local abaixo) se perde a cada toggle. Quem desmonta de propósito é só
   * `sidebarCollapsed`, na condição de `App.tsx` que envolve este componente
   * (FIX #15, preservado).
   */
  collapsed?: boolean;
}

export function DiscoveryMap({
  view,
  selection,
  warning,
  onFocusDiscovery,
  onFocusPlan,
  onFocusItem,
  onSelectNode,
  onPrepare,
  onResume,
  onNewDiscovery,
  collapsed = false,
}: DiscoveryMapProps): React.JSX.Element {
  // Estado de TELA (qual nível está em foco no eixo Y), não de domínio — mesmo
  // papel que tinha no mapa antigo.
  const [focusedLevelKey, setFocusedLevelKey] = useState<MapLevelKey>('discovery');

  const levelKeys = useMemo(() => view.levels.filter((level) => level.focusable).map((level) => level.key), [view.levels]);
  const effectiveLevelKey = levelKeys.includes(focusedLevelKey) ? focusedLevelKey : (levelKeys[0] ?? 'discovery');
  const focusedLevelIndex = Math.max(
    0,
    view.levels.findIndex((level) => level.key === effectiveLevelKey),
  );

  // FIX herdado do e2e de 30/07 (achado F1): o eixo vertical navega nos dois
  // sentidos, com roda e setas. O debounce existe porque um "degrau" de
  // trackpad dispara dezenas de eventos — sem represar, o mapa salta níveis.
  const lastWheelAtRef = useRef(0);
  const moveLevel = useCallback(
    (direction: 1 | -1) => setFocusedLevelKey((current) => moveLevelFocus(levelKeys, levelKeys.includes(current) ? current : (levelKeys[0] ?? current), direction)),
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

  const focusCardOfLevel = useCallback(
    (level: MapLevelKey, index: number, cards: readonly MapCard[]): void => {
      const target = cards[index];
      if (target?.subject === undefined || target.subject === null) return;
      if (level === 'discovery') onFocusDiscovery(target.subject.id);
      if (level === 'planos') onFocusPlan(target.subject.id);
      if (level === 'itens') onFocusItem(target.subject.id);
      setFocusedLevelKey(level);
    },
    [onFocusDiscovery, onFocusPlan, onFocusItem],
  );

  const levels = useMemo((): LevelCarouselLevel<MapCard>[] => {
    return view.levels.map((level) => {
      const cards: LevelCarouselCard<MapCard>[] = level.cards.map((card) => ({
        id: card.key,
        accent: TONE_COLOR[card.accent] ?? 'var(--border)',
        content: card,
      }));

      if (!level.focusable) {
        // Nível fantasma: mostra o caminho adiante e nunca recebe foco — a
        // geometria de "fora de foco" do carrossel já o desenha esmaecido.
        return { key: level.key, label: level.label, focusedCardIndex: 0, cards };
      }

      return {
        key: level.key,
        label: level.label,
        tall: level.tall,
        focusedCardIndex: level.focusedCardIndex,
        cards,
        onFocusLevel: () => setFocusedLevelKey(level.key),
        onFocusCard: (index) => focusCardOfLevel(level.key, index, level.cards),
        onPrevCard: () => focusCardOfLevel(level.key, Math.max(0, level.focusedCardIndex - 1), level.cards),
        onNextCard: () => focusCardOfLevel(level.key, Math.min(level.cards.length - 1, level.focusedCardIndex + 1), level.cards),
      };
    });
  }, [view.levels, focusCardOfLevel]);

  return (
    <aside
      className={[styles.map, collapsed ? styles.mapCollapsed : ''].filter(Boolean).join(' ')}
      aria-label="Mapa do discovery"
      data-testid="devmode-map"
      data-collapsed={collapsed ? 'true' : 'false'}
      tabIndex={0}
      onWheel={handleMapWheel}
      onKeyDown={handleMapKeyDown}
    >
      <header className={styles.header}>
        <span className={styles.headerLabel}>Esteira</span>
        {/* C2 — vocabulário humano: o TÍTULO do discovery em foco é o que a
            tela mostra; o id técnico (`dsc-...`) vira metadado de tooltip —
            ele não sumiu, só desceu de camada. */}
        <span className={styles.headerId} data-testid="devmode-map-discovery-id" title={view.focused.discoveryId ?? undefined}>
          {view.breadcrumb[0] ?? '—'}
        </span>
        <div className={styles.headerSpacer} />
        <Button variant="ghost" onClick={onNewDiscovery} data-testid="devmode-entry-trigger">
          ＋ Novo discovery
        </Button>
      </header>

      {/* Uma tela que aceita gesto sem poder gravar é uma tela que mente. */}
      {warning ? (
        <p className={styles.empty} data-testid="devmode-map-warning">
          {warning}
        </p>
      ) : null}

      {view.empty ? (
        <p className={styles.empty} data-testid="devmode-map-empty">
          {view.empty}
        </p>
      ) : (
        <LevelCarousel<MapCard>
          levels={levels}
          focusedLevelIndex={focusedLevelIndex}
          renderCard={(card, context) => (
            <MapCardBody
              card={card}
              focused={context.focused}
              selection={selection}
              onSelectNode={onSelectNode}
              onPrepare={onPrepare}
              onResume={onResume}
            />
          )}
        />
      )}
    </aside>
  );
}

interface MapCardBodyProps {
  readonly card: MapCard;
  readonly focused: boolean;
  readonly selection: MapSelection;
  readonly onSelectNode: (nodeKey: string, phase: string | null) => void;
  readonly onPrepare: (step: MapTrailStep) => void;
  readonly onResume: (step: MapTrailStep) => void;
}

function MapCardBody({ card, focused, selection, onSelectNode, onPrepare, onResume }: MapCardBodyProps): React.JSX.Element {
  return (
    <div
      className={styles.cardBody}
      data-testid="devmode-map-card"
      data-kind={card.kind}
      data-key={card.key}
      data-focused={focused ? 'true' : 'false'}
    >
      <div className={styles.cardTop} onClick={card.subject ? () => onSelectNode(card.key, null) : undefined}>
        <span className={styles.cardIcon}>{card.icon}</span>
        <span className={styles.cardTitle}>{card.title}</span>
        {card.statusLabel ? <span className={styles.cardStatus}>{card.statusLabel}</span> : null}
      </div>

      {/* C1 — densidade: `metaLabel` (uma palavra) é o que o card desenha
          quando existe; a frase inteira (`metaLine`) nunca morre — vira o
          tooltip. Discovery/plano não têm `metaLabel` (a meta deles já é
          curta) e continuam mostrando `metaLine` direto, sem tooltip redundante. */}
      {card.metaLine ? (
        <div className={styles.cardFooterMeta} title={card.metaLabel ? card.metaLine : undefined}>
          {card.metaLabel ?? card.metaLine}
        </div>
      ) : null}

      {card.tags.length > 0 ? (
        <div className={styles.cardTags} data-testid="devmode-map-tags">
          {card.tags.map((tag) => (
            <AnnotationTag key={tag.text} tone={tag.tone as AnnotationTone}>
              <span title={tag.title ?? undefined}>{tag.text}</span>
            </AnnotationTag>
          ))}
        </div>
      ) : null}

      {/* D-4 — o fecho do ciclo. Um `spike` que respondeu "não dá" está
          CONCLUÍDO: a resposta negativa é desfecho, não pendência, e é isso que
          o mapa antigo desenhava como trilha pela metade. C1 — o card desenha
          só `closureLabel` ("ver desfecho"); a frase inteira, com a
          explicação do ciclo e a referência (PR, resposta do spike), vive no
          tooltip e no painel de detalhe — nenhuma informação morreu. */}
      {card.closureLine ? (
        <div className={styles.cardFooterMeta} data-testid="devmode-map-closure" title={card.closureLine}>
          {card.closureLabel ?? card.closureLine}
        </div>
      ) : null}

      {focused && card.trail.length > 0 ? (
        <div className={styles.trilha} data-testid="devmode-map-trilha">
          {card.trail.map((step) => {
            const selected = selection.nodeKey === card.key && selection.phase === step.phase;
            return (
              <div
                key={step.key}
                className={[styles.trilhaRow, step.isNext ? styles.trilhaRowNext : '', selected ? styles.trilhaRowSelected : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectNode(card.key, step.phase)}
                data-testid="devmode-trilha-step"
                data-phase={step.phase}
                // C1 — a razão de bloqueio continua vencendo (é a informação
                // acionável); sem ela, o tooltip mostra a frase honesta
                // inteira que `label`, abaixo, resume a uma palavra.
                title={step.reason ?? step.text}
              >
                <span className={styles.trilhaRail} aria-hidden="true">
                  {step.isLast ? '└' : '├'}
                </span>
                <span className={[styles.trilhaGlyph, styles[`state-${step.glyph}`]].filter(Boolean).join(' ')} aria-hidden="true">
                  {GLYPH_CHAR[step.glyph]}
                </span>
                {isEsteiraPhase(step.phase) ? <PhaseChip phase={step.phase} /> : <span className={styles.trilhaFase}>{step.phase}</span>}
                <div className={styles.trilhaSpacer} />
                {/* C1 — o passo desenha `label` (uma palavra); `text`, a frase
                    honesta inteira, vira o `title` da linha, acima. */}
                <span className={styles.trilhaState}>{step.label}</span>
                {step.isNext ? (
                  <Button
                    variant="secondary"
                    disabled={!step.enabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPrepare(step);
                    }}
                    data-testid="devmode-trilha-prepare"
                    data-phase={step.phase}
                  >
                    ⌁ Preparar
                  </Button>
                ) : null}
                {/* B1 — "Retomar" continua a ÚLTIMA sessão da cadeia deste
                    passo fechado. Nunca aparece junto de "Preparar": um passo
                    fechado não é "a próxima" de ninguém. */}
                {step.resume !== null ? (
                  <Button
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onResume(step);
                    }}
                    data-testid="devmode-trilha-resume"
                    data-phase={step.phase}
                  >
                    ↺ Retomar
                  </Button>
                ) : null}
              </div>
            );
          })}
          {/* A razão de não dar para preparar vem ESCRITA — recusa calada é o
              vício que a spec 010 combate. */}
          {card.trail.some((step) => step.isNext && !step.enabled) ? (
            <p className={styles.cardFooterMeta} data-testid="devmode-map-blocked">
              {card.trail.find((step) => step.isNext && !step.enabled)?.reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
