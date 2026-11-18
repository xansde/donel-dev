// Desktop roteador (plano da madrugada 18/11, item 11; owner: "Donel Dev só roteador + chat do Líder; o trabalho vai
// para o celular") — with the flag on, the desktop shows only the Chat do Líder and the Conexões (VPS, proxy, contas,
// saúde); the Oráculo, the Mindscape and the other work screens are hidden, never deleted. Off = the app as it was.
//
// A TOP-LEVEL key of config.json (`router`), like `pet`: a channel without it keeps it in `unknownFields`.

export interface RouterPrefs {
  /** The desktop as a router. `false` = the full app of before. */
  readonly enabled: boolean;
}

/** On by default: the owner asked for the desktop to be the router; Preferences turns the old app back on. */
export const DEFAULT_ROUTER_PREFS: RouterPrefs = { enabled: true };

/** Field by field: a value this build does not know keeps the fallback. */
export function sanitizeRouterPrefs(value: unknown, fallback: RouterPrefs = DEFAULT_ROUTER_PREFS): RouterPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const { enabled } = value as Record<string, unknown>;
  return { enabled: typeof enabled === 'boolean' ? enabled : fallback.enabled };
}

/** What the router shows in the center. */
export type RouterView = 'lider' | 'conexoes';
