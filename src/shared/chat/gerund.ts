// T068 (014-chat) - the live footer says "Lendo x.ts", not "Leu x.ts". The action summaries
// (`toolSummary.ts`) are in the past tense ("Leu", "Rodou em segundo plano"); only the FIRST word is
// the verb, the rest of the phrase stays as is.

const IRREGULAR: Readonly<Record<string, string>> = {
  Leu: 'Lendo',
  Viu: 'Vendo',
  Escreveu: 'Escrevendo',
  Reescreveu: 'Reescrevendo',
};

/** Past-tense summary verb (3rd person) -> gerund; an unrecognised shape comes back untouched. */
export function toGerund(phrase: string): string {
  const match = /^(\S+)([\s\S]*)$/.exec(phrase);
  if (!match) return phrase;
  const word = match[1] ?? '';
  const rest = match[2] ?? '';
  const irregular = IRREGULAR[word];
  if (irregular !== undefined) return irregular + rest;
  if (/ou$/.test(word)) return word.replace(/ou$/, 'ando') + rest;
  if (/eu$/.test(word)) return word.replace(/eu$/, 'endo') + rest;
  if (/iu$/.test(word)) return word.replace(/iu$/, 'indo') + rest;
  return phrase;
}
