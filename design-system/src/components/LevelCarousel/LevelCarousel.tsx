import type { ReactNode } from 'react';
import {
  cardOpacity,
  computeLevelOffsets,
  horizontalTranslate,
  levelHeight,
  verticalTranslate,
} from '../../lib/carouselGeometry';
import styles from './LevelCarousel.module.css';

export interface LevelCarouselCard<TContent> {
  /** Chave estável — nunca o índice: cards somem quando o nível encurta (CA-14). */
  id: string;
  /**
   * Cor do tone deste card, aplicada ao `border-top` de 2px SÓ quando ele
   * está em foco (ex.: `var(--zone-ok)`). Sem isso, usa `var(--border)`,
   * igual aos cards fora de foco.
   */
  accent?: string;
  content: TContent;
}

export interface LevelCarouselLevel<TContent> {
  /** Chave estável do nível (ex.: `'discovery'`, `'planos'`). */
  key: string;
  /** Rótulo do nível (ex.: "Discovery", "Planos", "Documentação"). */
  label: string;
  /**
   * Altura alta (402px) quando este nível está em foco — só o nível de
   * planos no mockup. Default `false` (206px em foco, 124px fora).
   */
  tall?: boolean;
  cards: ReadonlyArray<LevelCarouselCard<TContent>>;
  /** Índice do card em foco no eixo X deste nível (CA-9/CA-11). */
  focusedCardIndex: number;
  /** Clicar no RÓTULO do nível traz este eixo Y ao foco. Omitido = rótulo não clicável. */
  onFocusLevel?: () => void;
  /** Clicar num card fora de foco traz ele ao foco (eixo X). Omitido = cards não clicáveis. */
  onFocusCard?: (index: number) => void;
  /** Seta `‹` — só renderizada quando há irmão (CA-11/CA-13). */
  onPrevCard?: () => void;
  /** Seta `›` — só renderizada quando há irmão (CA-11/CA-13). */
  onNextCard?: () => void;
}

export interface LevelCarouselCardContext {
  /** O card É o card em foco (nível E índice batem). */
  focused: boolean;
  /** O NÍVEL deste card está em foco (independente do índice). */
  levelFocused: boolean;
  levelIndex: number;
  cardIndex: number;
}

export interface LevelCarouselProps<TContent> {
  /**
   * Níveis, na ORDEM canônica, JÁ FILTRADOS pelo que existe (CA-14) — um
   * nível ausente simplesmente não entra na lista; o componente nunca
   * preenche buraco nem espera um template de tamanho fixo.
   */
  levels: ReadonlyArray<LevelCarouselLevel<TContent>>;
  /** Índice do nível em foco no eixo Y (CA-9). */
  focusedLevelIndex: number;
  /**
   * O trilho cuida da geometria (altura, opacidade, translateX/Y, setas,
   * contador) — o CONTEÚDO de cada card é de quem chama.
   */
  renderCard: (content: TContent, context: LevelCarouselCardContext) => ReactNode;
  className?: string;
}

/**
 * O trilho de dois eixos do mapa (009-modo-dev-v3, extensão 5): um
 * carrossel vertical de níveis, cada nível um carrossel horizontal de
 * cards. Mesmas regras nos dois eixos — um item em foco, vizinhos
 * recuados/recortados, ornamento (setas + contador) só quando há irmão
 * (CA-9, CA-11, CA-13). Geometria pura em `../../lib/carouselGeometry.ts`
 * (testada sem montar este componente).
 */
export function LevelCarousel<TContent>({ levels, focusedLevelIndex, renderCard, className }: LevelCarouselProps<TContent>) {
  const offsets = computeLevelOffsets(levels, focusedLevelIndex);
  const trackY = verticalTranslate(offsets, focusedLevelIndex);

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div className={styles.track} style={{ transform: `translateY(${trackY}px)` }}>
        {levels.map((level, levelIndex) => {
          const isFocusedLevel = levelIndex === focusedLevelIndex;
          const height = levelHeight(isFocusedLevel, Boolean(level.tall));
          // CA-11/CA-13 — ornamento (setas + contador) só nasce quando há irmão; um card só não ganha enfeite.
          const hasSiblings = level.cards.length > 1;
          const trackX = horizontalTranslate(level.focusedCardIndex);

          return (
            <div key={level.key} className={styles.level} style={{ height: `${height}px` }}>
              <div className={styles.rail} aria-hidden="true">
                <span className={[styles.node, isFocusedLevel ? styles.nodeFocused : ''].filter(Boolean).join(' ')} />
                <span className={styles.line} />
              </div>
              <div className={styles.levelBody}>
                <div className={styles.levelHeader}>
                  <span
                    className={[styles.levelLabel, isFocusedLevel ? styles.levelLabelFocused : ''].filter(Boolean).join(' ')}
                    onClick={level.onFocusLevel}
                    role={level.onFocusLevel ? 'button' : undefined}
                    tabIndex={level.onFocusLevel ? 0 : undefined}
                  >
                    {level.label}
                  </span>
                  {hasSiblings ? (
                    <div className={styles.ornament}>
                      <span className={styles.counter}>
                        {level.focusedCardIndex + 1} de {level.cards.length}
                      </span>
                      <button
                        type="button"
                        className={styles.arrow}
                        onClick={level.onPrevCard}
                        aria-label={`${level.label} — item anterior`}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className={styles.arrow}
                        onClick={level.onNextCard}
                        aria-label={`${level.label} — próximo item`}
                      >
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className={styles.cardTrack} style={{ transform: `translateX(${trackX}px)` }}>
                  {level.cards.map((card, cardIndex) => {
                    const focused = isFocusedLevel && cardIndex === level.focusedCardIndex;
                    const opacity = cardOpacity(focused, isFocusedLevel);
                    const clickable = !focused && Boolean(level.onFocusCard);

                    return (
                      <div
                        key={card.id}
                        className={styles.card}
                        style={{
                          opacity,
                          borderTopColor: focused ? (card.accent ?? 'var(--border)') : 'var(--border)',
                          boxShadow: focused ? 'var(--shadow-modal)' : 'none',
                          cursor: clickable ? 'pointer' : 'default',
                        }}
                        onClick={clickable ? () => level.onFocusCard?.(cardIndex) : undefined}
                      >
                        {renderCard(card.content, { focused, levelFocused: isFocusedLevel, levelIndex, cardIndex })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
