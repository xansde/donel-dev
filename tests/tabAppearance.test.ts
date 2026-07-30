import { describe, expect, it } from 'vitest';
import {
  isTabColorToken,
  reorderTabs,
  setTabColor,
  setTabOrder,
  TAB_COLOR_TOKENS,
  type TabAppearanceMap,
} from '../src/shared/tabAppearance';

// CA-26/CA-27 (009-modo-dev-v3, lote 1) — lógica pura da aba v3: reordenar
// (CA-26) e (de)serializar cor+ordem por sessão (CA-27), sobrevivendo a
// restart no mesmo ConfigStore que já guarda `sessionNames`/`sessionRegistry`
// (config-store.ts). TDD: nenhuma implementação existia antes deste arquivo —
// mesmo espírito de tests/sessionRegistry.test.ts.

describe('reorderTabs (CA-26)', () => {
  it('move o item de fromIndex para toIndex (arrasta pra frente)', () => {
    expect(reorderTabs(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('move o item de fromIndex para toIndex (arrasta pra trás)', () => {
    expect(reorderTabs(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('índices iguais é no-op — devolve uma CÓPIA, não a mesma referência', () => {
    const original = ['a', 'b', 'c'];
    const next = reorderTabs(original, 1, 1);
    expect(next).toEqual(original);
    expect(next).not.toBe(original);
  });

  it('fromIndex fora do range é no-op', () => {
    expect(reorderTabs(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(reorderTabs(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('toIndex fora do range é no-op', () => {
    expect(reorderTabs(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(reorderTabs(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('nunca muta o array original', () => {
    const original = ['a', 'b', 'c'];
    reorderTabs(original, 0, 2);
    expect(original).toEqual(['a', 'b', 'c']);
  });
});

describe('isTabColorToken (CA-27)', () => {
  it('aceita os 4 tokens conhecidos', () => {
    for (const token of TAB_COLOR_TOKENS) expect(isTabColorToken(token)).toBe(true);
  });

  it('rejeita hex cru, string desconhecida e valores não-string', () => {
    expect(isTabColorToken('#ff0000')).toBe(false);
    expect(isTabColorToken('roxo')).toBe(false);
    expect(isTabColorToken(null)).toBe(false);
    expect(isTabColorToken(undefined)).toBe(false);
    expect(isTabColorToken(42)).toBe(false);
  });
});

describe('setTabColor (CA-27)', () => {
  it('cria uma entrada nova com order 0 quando a sessão não tinha aparência', () => {
    const next = setTabColor({}, 's1', 'accent');
    expect(next).toEqual({ s1: { color: 'accent', order: 0 } });
  });

  it('preserva a order já conhecida ao trocar só a cor', () => {
    const map: TabAppearanceMap = { s1: { color: 'none', order: 3 } };
    const next = setTabColor(map, 's1', 'permission');
    expect(next).toEqual({ s1: { color: 'permission', order: 3 } });
  });

  it('sessionId vazio é no-op (devolve o mesmo mapa)', () => {
    const map: TabAppearanceMap = { s1: { color: 'none', order: 0 } };
    expect(setTabColor(map, '', 'accent')).toBe(map);
  });

  it('não mexe na entrada de outra sessão', () => {
    const map: TabAppearanceMap = { s1: { color: 'accent', order: 1 } };
    const next = setTabColor(map, 's2', 'donel-accent');
    expect(next.s1).toEqual({ color: 'accent', order: 1 });
    expect(next.s2).toEqual({ color: 'donel-accent', order: 0 });
  });
});

describe('setTabOrder (CA-26, persistência)', () => {
  it('cria uma entrada nova com color "none" quando a sessão não tinha aparência', () => {
    const next = setTabOrder({}, 's1', 2);
    expect(next).toEqual({ s1: { color: 'none', order: 2 } });
  });

  it('preserva a cor já conhecida ao trocar só a order', () => {
    const map: TabAppearanceMap = { s1: { color: 'accent', order: 0 } };
    const next = setTabOrder(map, 's1', 5);
    expect(next).toEqual({ s1: { color: 'accent', order: 5 } });
  });

  it('sessionId vazio é no-op', () => {
    const map: TabAppearanceMap = {};
    expect(setTabOrder(map, '', 1)).toBe(map);
  });

  it('order não-finita (NaN/Infinity) é no-op', () => {
    const map: TabAppearanceMap = {};
    expect(setTabOrder(map, 's1', Number.NaN)).toBe(map);
    expect(setTabOrder(map, 's1', Number.POSITIVE_INFINITY)).toBe(map);
  });
});
