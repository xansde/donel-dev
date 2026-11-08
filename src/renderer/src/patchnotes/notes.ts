// Novidades da versão — o que o dono vê na primeira abertura depois de atualizar.
//
// Cada novidade mora no próprio arquivo, em `./notes/AAAA-MM-DD-HHMM-slug.json`
// (`{ "title": "...", "text": "..." }`), para dois PRs nunca mexerem na mesma
// linha. Este módulo só monta a lista: um dia por data, o mais novo primeiro, e,
// dentro do dia, o `HHMM` maior primeiro. Como acrescentar: CLAUDE.md, seção
// "Alfa diário e novidades da versão".

export interface PatchNoteItem {
  readonly title: string;
  readonly text: string;
}

export interface PatchNoteDay {
  /** `AAAA-MM-DD`; ordena e decide o que já foi visto. */
  readonly date: string;
  readonly items: readonly PatchNoteItem[];
}

const FILE_NAME = /(?:^|\/)((\d{4}-\d{2}-\d{2})-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

function isNoteItem(value: unknown): value is PatchNoteItem {
  if (typeof value !== 'object' || value === null) return false;
  const { title, text } = value as Record<string, unknown>;
  return typeof title === 'string' && title.trim() !== '' && typeof text === 'string' && text.trim() !== '';
}

/**
 * Monta os dias a partir de `{ caminho: conteúdo }`. Nome fora do padrão ou
 * conteúdo sem `title`/`text` derruba o build com o nome do arquivo, em vez de
 * sumir com a novidade em silêncio.
 */
export function buildPatchNotes(files: Readonly<Record<string, unknown>>): readonly PatchNoteDay[] {
  const entries = Object.entries(files).map(([path, content]) => {
    const match = FILE_NAME.exec(path);
    if (!match) throw new Error(`Novidade com nome fora do padrão AAAA-MM-DD-HHMM-slug.json: ${path}`);
    if (!isNoteItem(content)) throw new Error(`Novidade sem "title" e "text": ${path}`);
    return { key: match[1], date: match[2], item: { title: content.title, text: content.text } };
  });
  // Comparação por código, não `localeCompare`: o ICU ignora o hífen e embaralharia o slug.
  entries.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  const days: { date: string; items: PatchNoteItem[] }[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last?.date === entry.date) last.items.push(entry.item);
    else days.push({ date: entry.date, items: [entry.item] });
  }
  return days;
}

export const PATCH_NOTES: readonly PatchNoteDay[] = buildPatchNotes(
  import.meta.glob('./notes/*.json', { eager: true, import: 'default' }),
);
