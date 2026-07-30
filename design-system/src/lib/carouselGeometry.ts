/**
 * LevelCarousel — geometria pura do trilho de dois eixos (009-modo-dev-v3,
 * extensão 5). Números medidos em
 * `design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html:82-149`
 * (`built`/`levels`/`carousel` de `renderVals()`) e conferidos em
 * `design/modo-dev-v3-verificacao.md` §2 — são requisito, não escolha de
 * estilo. Isolado de React: a mesma conta que o componente usa para
 * posicionar os dois eixos é testável sem montar nada.
 */

/** Largura de um card de nível (CA-7/CA-9). */
export const CAROUSEL_CARD_WIDTH = 392;
/** Gap horizontal entre cards irmãos do mesmo nível. */
export const CAROUSEL_CARD_GAP = 12;
/** Passo do eixo X: 392 + 12 — cada índice desloca o carrossel exatamente isto. */
export const CAROUSEL_CARD_STEP = CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_GAP;

/** Gap vertical entre níveis. */
export const CAROUSEL_LEVEL_GAP = 14;
/** Ponto fixo (px) para onde o TOPO do nível em foco é trazido no eixo Y. */
export const CAROUSEL_FOCUS_Y = 110;

/** Altura do nível em foco quando é "tall" (só o nível de planos, no mockup). */
export const CAROUSEL_HEIGHT_FOCUSED_TALL = 402;
/** Altura do nível em foco nos demais casos. */
export const CAROUSEL_HEIGHT_FOCUSED = 206;
/** Altura de qualquer nível fora de foco, tall ou não. */
export const CAROUSEL_HEIGHT_UNFOCUSED = 124;

/** Opacidade do card em foco. */
export const CAROUSEL_OPACITY_FOCUSED = 1;
/** Opacidade dos irmãos do nível em foco (mesmo nível, card diferente). */
export const CAROUSEL_OPACITY_LEVEL_FOCUSED = 0.34;
/** Opacidade dos cards de níveis fora de foco — segundo patamar, do design (não estava na spec). */
export const CAROUSEL_OPACITY_UNFOCUSED = 0.22;

export interface CarouselLevelInput {
  /** Altura alta (402px) quando em foco — default `false` (206px). */
  tall?: boolean;
}

/**
 * Altura (px) de UM nível, dado se ele é o nível vertical em foco e se é
 * "tall". Fora de foco a altura é sempre 124px — o `tall` só importa quando
 * em foco.
 */
export function levelHeight(isFocusedLevel: boolean, tall: boolean): number {
  if (!isFocusedLevel) return CAROUSEL_HEIGHT_UNFOCUSED;
  return tall ? CAROUSEL_HEIGHT_FOCUSED_TALL : CAROUSEL_HEIGHT_FOCUSED;
}

/**
 * Offset vertical acumulado (topo) de cada nível, na ORDEM em que aparecem
 * na lista recebida — nunca por índice de nome fixo (CA-14). Quem monta
 * `levels` já filtrou os níveis ausentes; um nível ausente não deixa buraco
 * aqui porque ele simplesmente não está na lista, e os offsets seguintes se
 * recalculam para a lista mais curta.
 */
export function computeLevelOffsets(levels: readonly CarouselLevelInput[], focusedLevelIndex: number): number[] {
  let acc = 0;
  const offsets: number[] = [];
  for (let i = 0; i < levels.length; i += 1) {
    offsets.push(acc);
    acc += levelHeight(i === focusedLevelIndex, Boolean(levels[i]?.tall)) + CAROUSEL_LEVEL_GAP;
  }
  return offsets;
}

/**
 * `translateY` (px) do trilho vertical inteiro: traz o TOPO do nível em
 * foco para `CAROUSEL_FOCUS_Y` (mockup: `110 - offsets[level]`).
 */
export function verticalTranslate(offsets: readonly number[], focusedLevelIndex: number): number {
  return CAROUSEL_FOCUS_Y - (offsets[focusedLevelIndex] ?? 0);
}

/**
 * `translateX` (px) do carrossel horizontal de UM nível, pelo índice do
 * card em foco dentro dele (mockup: `-hIdx * 404`).
 */
export function horizontalTranslate(focusedCardIndex: number): number {
  // `0 - x`, não `-x` — evita devolver `-0` quando `focusedCardIndex` é 0
  // (mockup: `(0 - b.lv.hIdx * 404) + 'px'`, `Modo Dev v3.dc.html:1144`).
  return 0 - focusedCardIndex * CAROUSEL_CARD_STEP;
}

/**
 * Opacidade de um card: 1 quando é o próprio card em foco, 0.34 quando é
 * irmão do nível em foco (mesmo nível, card diferente), 0.22 quando o
 * card pertence a um nível fora de foco.
 */
export function cardOpacity(isFocusedCard: boolean, isLevelFocused: boolean): number {
  if (isFocusedCard) return CAROUSEL_OPACITY_FOCUSED;
  if (isLevelFocused) return CAROUSEL_OPACITY_LEVEL_FOCUSED;
  return CAROUSEL_OPACITY_UNFOCUSED;
}
