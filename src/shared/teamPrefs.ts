// Limite de sessões abertas por um Líder (pedido do dono, 05/11: "Onde eu escolho o limite de sessões abertas pelos
// líderes de cada mindscape? Quero tirar o limite"). `team` in `config.json` (top-level key, like `pet`).
//
// `openCap`: how many live sessions one session may have opened with `sessao_abrir` before the owner is asked
// ("Precisa de você"); the Líder único counts per board. `null` = no limit (the default). The PC's RAM ceiling is
// another matter (not here).
//
// `turnNotices` (dono, 08/11: "Eles devem atualizar diretamente o ledger, né. Em vez de te notificar a cada instante"):
// `ledger` (the default) — a session's end of turn goes to the ledger (`andamento`), never to a Líder's chat; only
// "precisa do dono", "travada" and "entregue para aceite" reach the Líder of its board at once. `chat` — the old mode:
// a "◆ … terminou" to whoever has an arrow to the session, and no immediate notices.
//
// `routing` (t-89f14324): the fixed rule that picks the machine of a `sessao_abrir` without `onde` (`placeRouter.ts`).
// Absent = off, and there is no default: place names live only in the owner's config, never in the code. Edited by
// hand in `config.json`; keys this version does not know are kept (passthrough), so saving the prefs never drops them.

import { sanitizeRoutingRules, type RoutingRules } from './placeRouter';

export type TurnNotices = 'ledger' | 'chat';

export interface TeamPrefs {
  readonly openCap: number | null;
  readonly turnNotices: TurnNotices;
  readonly routing?: RoutingRules;
}

export const DEFAULT_TEAM_PREFS: TeamPrefs = { openCap: null, turnNotices: 'ledger' };
export const OPEN_CAP_MIN = 1;
export const OPEN_CAP_MAX = 99;

const KNOWN_KEYS = new Set(['openCap', 'turnNotices', 'routing']);

/** An invalid value falls back; a number is kept whole and inside 1–99. */
export function sanitizeTeamPrefs(value: unknown, fallback: TeamPrefs = DEFAULT_TEAM_PREFS): TeamPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const cap = raw.openCap;
  const openCap = cap === null ? null : typeof cap === 'number' && Number.isFinite(cap) ? Math.min(OPEN_CAP_MAX, Math.max(OPEN_CAP_MIN, Math.round(cap))) : fallback.openCap;
  const turnNotices = raw.turnNotices === 'ledger' || raw.turnNotices === 'chat' ? raw.turnNotices : (fallback.turnNotices ?? DEFAULT_TEAM_PREFS.turnNotices);
  const routing = 'routing' in raw ? sanitizeRoutingRules(raw.routing) : fallback.routing;
  const unknownKeys = Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_KEYS.has(key)));
  return { ...unknownKeys, openCap, turnNotices, ...(routing ? { routing } : {}) };
}

/** The cap as `sessao_abrir` tells the agent. */
export function openCapSentence(openCap: number | null): string {
  if (openCap === null) return 'Sem limite de sessões abertas por você (o dono pode pôr um em Preferências).';
  return `Até ${openCap} aberta${openCap === 1 ? '' : 's'} por você ao mesmo tempo; a partir da ${openCap + 1}ª o dono precisa permitir, e esta ferramenta espera a resposta dele.`;
}
