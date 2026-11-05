// Limite de sessões abertas por um Líder (pedido do dono, 05/11: "Onde eu escolho o limite de sessões abertas pelos
// líderes de cada mindscape? Quero tirar o limite"). `team` in `config.json` (top-level key, like `pet`).
//
// `openCap`: how many live sessions one session may have opened with `sessao_abrir` before the owner is asked
// ("Precisa de você"); the Líder único counts per board. `null` = no limit (the default). The PC's RAM ceiling is
// another matter (not here).

export interface TeamPrefs {
  readonly openCap: number | null;
}

export const DEFAULT_TEAM_PREFS: TeamPrefs = { openCap: null };
export const OPEN_CAP_MIN = 1;
export const OPEN_CAP_MAX = 99;

/** An invalid value falls back; a number is kept whole and inside 1–99. */
export function sanitizeTeamPrefs(value: unknown, fallback: TeamPrefs = DEFAULT_TEAM_PREFS): TeamPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const cap = (value as Record<string, unknown>).openCap;
  if (cap === null) return { openCap: null };
  if (typeof cap === 'number' && Number.isFinite(cap)) return { openCap: Math.min(OPEN_CAP_MAX, Math.max(OPEN_CAP_MIN, Math.round(cap))) };
  return fallback;
}

/** The cap as `sessao_abrir` tells the agent. */
export function openCapSentence(openCap: number | null): string {
  if (openCap === null) return 'Sem limite de sessões abertas por você (o dono pode pôr um em Preferências).';
  return `Até ${openCap} aberta${openCap === 1 ? '' : 's'} por você ao mesmo tempo; a partir da ${openCap + 1}ª o dono precisa permitir, e esta ferramenta espera a resposta dele.`;
}
