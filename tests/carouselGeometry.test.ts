import { describe, expect, it } from 'vitest';
import {
  CAROUSEL_CARD_STEP,
  CAROUSEL_HEIGHT_FOCUSED,
  CAROUSEL_HEIGHT_FOCUSED_TALL,
  CAROUSEL_HEIGHT_UNFOCUSED,
  CAROUSEL_LEVEL_GAP,
  cardOpacity,
  computeLevelOffsets,
  horizontalTranslate,
  levelHeight,
  verticalTranslate,
} from '../design-system/src/lib/carouselGeometry';

// 009-modo-dev-v3, extensão 5 (`LevelCarousel`) — a aritmética do trilho de
// dois eixos, medida em `design/modo-dev-v3-handoff/project/Modo Dev
// v3.dc.html:1046-1147` e conferida em `design/modo-dev-v3-verificacao.md`
// §2. Isolada de React: nenhum destes números pode depender de montar um
// componente para ser provado.

describe('levelHeight', () => {
  it('nível fora de foco é sempre 124px, tall ou não', () => {
    expect(levelHeight(false, false)).toBe(CAROUSEL_HEIGHT_UNFOCUSED);
    expect(levelHeight(false, true)).toBe(CAROUSEL_HEIGHT_UNFOCUSED);
  });

  it('nível em foco: 206px normal, 402px quando "tall" (o nível de planos no mockup)', () => {
    expect(levelHeight(true, false)).toBe(CAROUSEL_HEIGHT_FOCUSED);
    expect(levelHeight(true, true)).toBe(CAROUSEL_HEIGHT_FOCUSED_TALL);
  });
});

describe('computeLevelOffsets', () => {
  it('acumula altura + gap de 14px, na ORDEM da lista — não por índice de nome fixo (CA-14)', () => {
    // 4 níveis, o segundo (índice 1, "tall") em foco — igual ao card de
    // planos do mockup quando `level === 1`.
    const levels = [{ tall: false }, { tall: true }, { tall: false }, { tall: false }];
    const offsets = computeLevelOffsets(levels, 1);
    // nível 0: 124px fora de foco → próximo offset em 124+14=138
    // nível 1: 402px em foco (tall) → próximo offset em 138+402+14=554
    // nível 2: 124px fora de foco → próximo offset em 554+124+14=692
    expect(offsets).toEqual([0, 138, 554, 692]);
  });

  it('nível ausente não deixa buraco — a lista mais curta muda os offsets, nunca um índice pulado', () => {
    // Caminho documental: só 2 níveis (Discovery + Documentação), o segundo
    // em foco e NÃO tall (206px) — nada de Implementação/Validação no meio.
    const levels = [{ tall: false }, { tall: false }];
    const offsets = computeLevelOffsets(levels, 1);
    expect(offsets).toEqual([0, 138]);
  });

  it('gap entre níveis é exatamente 14px (CAROUSEL_LEVEL_GAP)', () => {
    expect(CAROUSEL_LEVEL_GAP).toBe(14);
  });
});

describe('verticalTranslate', () => {
  it('traz o TOPO do nível em foco para y=110 (mockup: `110 - offsets[level]`)', () => {
    const levels = [{ tall: false }, { tall: true }, { tall: false }, { tall: false }];
    const offsets = computeLevelOffsets(levels, 1);
    expect(verticalTranslate(offsets, 1)).toBe(110 - 138);
  });

  it('nível 0 em foco: offset 0, translateY fica no próprio 110', () => {
    const levels = [{ tall: false }, { tall: false }];
    const offsets = computeLevelOffsets(levels, 0);
    expect(verticalTranslate(offsets, 0)).toBe(110);
  });
});

describe('horizontalTranslate', () => {
  it('translateX = -índice × 404px (392 de card + 12 de gap)', () => {
    expect(CAROUSEL_CARD_STEP).toBe(404);
    expect(horizontalTranslate(0)).toBe(0);
    expect(horizontalTranslate(1)).toBe(-404);
    expect(horizontalTranslate(2)).toBe(-808);
  });
});

describe('cardOpacity', () => {
  it('1 no card em foco, independente do nível', () => {
    expect(cardOpacity(true, true)).toBe(1);
    expect(cardOpacity(true, false)).toBe(1);
  });

  it('0.34 nos irmãos do nível em foco (mesmo nível, card diferente)', () => {
    expect(cardOpacity(false, true)).toBe(0.34);
  });

  it('0.22 nos cards de níveis fora de foco — o segundo patamar, novo no design (§2 da verificação)', () => {
    expect(cardOpacity(false, false)).toBe(0.22);
  });
});
