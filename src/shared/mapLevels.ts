// Spec 010 / batch B6 — o que sobrou de `mapLevels.ts`.
//
// O arquivo era a decisão pura do carrossel do modelo ANTIGO: níveis por
// `plan_cards[]`, trilha por `fase_num`, etiquetas do board, relógio de
// homologação. Tudo isso saiu com a fonte que o alimentava (o inventário do B6
// registra cada linha: M-05, M-08, M-13, M-15).
//
// O que sobrevive é a aritmética do EIXO VERTICAL — a mesma nos dois modelos,
// e a única coisa que o carrossel novo ainda precisa daqui.

/**
 * FIX (E2E 30/07, achado F1) — "uma regra, dois eixos": o eixo vertical
 * (níveis) precisa navegar nos dois sentidos, igual o horizontal (cards) já
 * faz. Pura: só aritmética de índice sobre a lista JÁ FILTRADA de níveis —
 * clampa nas pontas, nunca dá a volta.
 */
export function moveLevelFocus<TKey extends string>(levelKeys: readonly TKey[], current: TKey, direction: 1 | -1): TKey {
  const index = levelKeys.indexOf(current);
  if (index === -1) return current;
  const nextIndex = Math.min(levelKeys.length - 1, Math.max(0, index + direction));
  return levelKeys[nextIndex] ?? current;
}
