// G4 (batch n3) — estatística pura usada pela cerca de regressão de
// performance (`ca7-measurement.spec.ts`). Extraída como função pura/testável
// por vitest: a decisão "que número representa N medições" não pode nascer
// inline dentro do spec Playwright (mesma disciplina de nunca deixar lógica
// sem teste morar só na camada que não roda em `npm test`).

/**
 * Mediana de `values` — não muta o array recebido. Lança para entrada vazia
 * (mediana de zero amostras não tem significado; quem chama nunca deveria
 * medir zero vezes). Contagem par tira a média dos dois valores centrais.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median: não há amostra nenhuma para calcular a mediana');

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
