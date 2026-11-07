// Mindscape de homologação V1 — the optional `homologacao` key of the app config (docs/planos/mindscape-homologacao-v1.md,
// "Contrato de leitura"). Off by default: absent = no panel and no ssh. Nothing about the factory is fixed in code;
// the place, the paths and the board come from here.

export interface HomologacaoPrefs {
  /** The remote place (by its label or id in the accounts' `remotes`) where the factory's files live. */
  readonly lugar: string;
  /** Path of `metricas.json` (`metricas-factory@1`) on that place; `null` = no numbers panel. */
  readonly metricas: string | null;
  /** Path of `rigs.json` (`rigs-factory@1`) on that place; `null` = the board shows today's chairs lens. */
  readonly rigs: string | null;
  /** The Mindscape board (project name or folder) where the factory shows up. */
  readonly quadro: string;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** `null` (off) unless `lugar` and `quadro` are there; a path that is not a non-empty text is `null`. */
export function sanitizeHomologacaoPrefs(value: unknown): HomologacaoPrefs | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const lugar = text(candidate.lugar);
  const quadro = text(candidate.quadro);
  if (!lugar || !quadro) return null;
  return { lugar, metricas: text(candidate.metricas), rigs: text(candidate.rigs), quadro };
}

/** Board names compare without case or accents: "Homologação" matches a folder called `homologacao`. */
export function sameBoardName(a: string, b: string): boolean {
  const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return fold(a) === fold(b);
}
