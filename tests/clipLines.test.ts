import { describe, expect, it } from 'vitest';
import {
  clipLines,
  clipOutputText,
  DETAIL_MAX_BYTES,
  DETAIL_MAX_LINES,
  formatHiddenLines,
} from '../design-system/src/lib/clipLines';

// 014-chat, T050 / D-C7: o detalhe da conversa (diff e saída de comando) corta
// em 40 linhas; a saída corta também em 8 KB. Funções puras do design-system.

describe('clipLines', () => {
  it('mantém tudo quando cabe no teto', () => {
    const lines = Array.from({ length: DETAIL_MAX_LINES }, (_, i) => i);
    const { visible, hidden } = clipLines(lines);
    expect(visible).toHaveLength(DETAIL_MAX_LINES);
    expect(hidden).toBe(0);
  });

  it('corta em 40 linhas por padrão e conta as ocultas', () => {
    const lines = Array.from({ length: 50 }, (_, i) => i);
    const { visible, hidden } = clipLines(lines);
    expect(visible).toHaveLength(40);
    expect(visible[39]).toBe(39);
    expect(hidden).toBe(10);
  });

  it('respeita um teto menor e não muta a entrada', () => {
    const lines = [1, 2, 3, 4, 5, 6];
    const { visible, hidden } = clipLines(lines, 5);
    expect(visible).toEqual([1, 2, 3, 4, 5]);
    expect(hidden).toBe(1);
    expect(lines).toHaveLength(6);
  });
});

describe('clipOutputText', () => {
  it('texto vazio não tem linhas', () => {
    expect(clipOutputText('')).toEqual({ visible: [], hidden: 0 });
  });

  it('ignora a quebra final e normaliza CRLF', () => {
    expect(clipOutputText('a\r\nb\r\n')).toEqual({ visible: ['a', 'b'], hidden: 0 });
  });

  it('corta por linhas antes de estourar bytes', () => {
    const text = Array.from({ length: 55 }, (_, i) => `linha ${i}`).join('\n');
    const { visible, hidden } = clipOutputText(text);
    expect(visible).toHaveLength(DETAIL_MAX_LINES);
    expect(hidden).toBe(15);
  });

  it('corta por bytes quando as linhas são largas, sem meia linha', () => {
    const wide = 'x'.repeat(1000);
    const text = Array.from({ length: 20 }, () => wide).join('\n');
    const { visible, hidden } = clipOutputText(text);
    expect(visible.length).toBeLessThan(20);
    expect(visible.join('\n').length + visible.length).toBeLessThanOrEqual(DETAIL_MAX_BYTES);
    expect(visible.every((line) => line === wide)).toBe(true);
    expect(hidden).toBe(20 - visible.length);
  });
});

describe('formatHiddenLines', () => {
  it('usa o singular e o plural', () => {
    expect(formatHiddenLines(1)).toBe('… 1 linha oculta');
    expect(formatHiddenLines(14)).toBe('… 14 linhas ocultas');
  });
});
