// Supported code languages (T051). Pure — no Shiki import, so the list and the
// aliases are testable and the grammars stay lazy (see ./shiki.ts for loaders).
//
// A deliberately curated list: `shiki/langs` would emit one chunk per each of
// its ~700 grammars. Anything outside it renders as plain text, labelled as
// written in the fence (or "texto" when the fence has none — D-C6).

export interface ResolvedLanguage {
  /** Shiki grammar module name (`shiki/langs/<id>.mjs`). */
  readonly id: string;
  /** Label shown in the block header. */
  readonly label: string;
}

const LANGUAGES: ReadonlyArray<{ id: string; label: string; aliases: readonly string[] }> = [
  { id: 'typescript', label: 'typescript', aliases: ['ts', 'mts', 'cts'] },
  { id: 'tsx', label: 'tsx', aliases: [] },
  { id: 'javascript', label: 'javascript', aliases: ['js', 'mjs', 'cjs'] },
  { id: 'jsx', label: 'jsx', aliases: [] },
  { id: 'json', label: 'json', aliases: [] },
  { id: 'jsonc', label: 'jsonc', aliases: [] },
  { id: 'shellscript', label: 'bash', aliases: ['bash', 'sh', 'shell', 'shellscript', 'zsh'] },
  { id: 'powershell', label: 'powershell', aliases: ['ps', 'ps1', 'pwsh'] },
  { id: 'python', label: 'python', aliases: ['py'] },
  { id: 'html', label: 'html', aliases: ['htm'] },
  { id: 'css', label: 'css', aliases: [] },
  { id: 'scss', label: 'scss', aliases: [] },
  { id: 'markdown', label: 'markdown', aliases: ['md'] },
  { id: 'yaml', label: 'yaml', aliases: ['yml'] },
  { id: 'toml', label: 'toml', aliases: [] },
  { id: 'ini', label: 'ini', aliases: ['dotenv', 'env'] },
  { id: 'sql', label: 'sql', aliases: [] },
  { id: 'diff', label: 'diff', aliases: ['patch'] },
  { id: 'go', label: 'go', aliases: ['golang'] },
  { id: 'rust', label: 'rust', aliases: ['rs'] },
  { id: 'java', label: 'java', aliases: [] },
  { id: 'kotlin', label: 'kotlin', aliases: ['kt'] },
  { id: 'swift', label: 'swift', aliases: [] },
  { id: 'c', label: 'c', aliases: [] },
  { id: 'cpp', label: 'c++', aliases: ['c++', 'cc', 'cxx'] },
  { id: 'csharp', label: 'c#', aliases: ['cs', 'c#'] },
  { id: 'php', label: 'php', aliases: [] },
  { id: 'ruby', label: 'ruby', aliases: ['rb'] },
  { id: 'lua', label: 'lua', aliases: [] },
  { id: 'xml', label: 'xml', aliases: ['svg'] },
  { id: 'graphql', label: 'graphql', aliases: ['gql'] },
  { id: 'dockerfile', label: 'dockerfile', aliases: ['docker'] },
];

const BY_NAME: ReadonlyMap<string, ResolvedLanguage> = (() => {
  const map = new Map<string, ResolvedLanguage>();
  for (const { id, label, aliases } of LANGUAGES) {
    const resolved: ResolvedLanguage = { id, label };
    map.set(id, resolved);
    map.set(label, resolved);
    for (const alias of aliases) map.set(alias, resolved);
  }
  return map;
})();

/** `null` = not supported (render as plain text). */
export function resolveLanguage(raw: string | null | undefined): ResolvedLanguage | null {
  if (!raw) return null;
  return BY_NAME.get(raw.trim().toLowerCase()) ?? null;
}

export const SUPPORTED_LANGUAGE_IDS: readonly string[] = LANGUAGES.map((language) => language.id);
