/**
 * Corte de detalhe longo na conversa (014-chat, D-C7 e `conversation-rows.md`
 * §4). Funções puras — o `DiffBlock` e o `CommandOutput` só apresentam o que
 * elas devolvem.
 */

/** Teto de linhas visíveis de um diff ou de uma saída de comando. */
export const DETAIL_MAX_LINES = 40;

/** Teto de bytes visíveis da saída de comando. */
export const DETAIL_MAX_BYTES = 8 * 1024;

export interface ClippedLines<T> {
  visible: T[];
  /** Quantas linhas ficaram de fora ("… N linhas ocultas · ver tudo"). */
  hidden: number;
}

/** Mantém as primeiras `maxLines` linhas; o resto vira só uma contagem. */
export function clipLines<T>(lines: readonly T[], maxLines: number = DETAIL_MAX_LINES): ClippedLines<T> {
  const limit = Math.max(0, Math.floor(maxLines));
  if (lines.length <= limit) return { visible: [...lines], hidden: 0 };
  return { visible: lines.slice(0, limit), hidden: lines.length - limit };
}

/**
 * Corte da saída de comando: o que estourar primeiro entre `maxLines` e
 * `maxBytes` (UTF-8) decide. Nunca devolve meia linha — a linha que passaria do
 * teto de bytes sai inteira. `\r\n` é tratado como quebra única.
 */
export function clipOutputText(
  text: string,
  maxLines: number = DETAIL_MAX_LINES,
  maxBytes: number = DETAIL_MAX_BYTES,
): ClippedLines<string> {
  if (text === '') return { visible: [], hidden: 0 };
  const all = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const encoder = new TextEncoder();
  const visible: string[] = [];
  let bytes = 0;
  for (const line of all) {
    if (visible.length >= maxLines) break;
    const lineBytes = encoder.encode(line).length + 1; // + quebra de linha
    if (visible.length > 0 && bytes + lineBytes > maxBytes) break;
    if (visible.length === 0 && lineBytes > maxBytes) break;
    visible.push(line);
    bytes += lineBytes;
  }
  return { visible, hidden: all.length - visible.length };
}

/** "… 14 linhas ocultas" / "… 1 linha oculta" — rodapé do detalhe cortado. */
export function formatHiddenLines(hidden: number): string {
  return hidden === 1 ? '… 1 linha oculta' : `… ${hidden} linhas ocultas`;
}
