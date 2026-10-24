// "Copiar resposta inteira" (T051, FR-005, D-C9). Pure.
//
// One answer is split into several `assistant` rows (one per text block). The
// copy is the markdown SOURCE the model wrote — exact, no re-serialisation —
// joined with a blank line. (Selecting text inside the rendered markdown goes
// through the T3 `markdownClipboard` instead; see Markdown.tsx.)

export function joinAnswerMarkdown(blocks: readonly string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .join('\n\n');
}
