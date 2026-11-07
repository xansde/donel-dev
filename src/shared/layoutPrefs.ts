// Oráculo no centro (owner, 06/11: "Estou com telas redundantes") — the owner talks to the Líder único through the
// Jobu, so the main window no longer shows that same conversation by default: the center of "Uso geral" shows the
// Oráculo Harrow (the cards waiting for him) and the terminals are one click away. `oracleCenter: false` is the old
// layout (Preferences). `centerView` is what the center shows now, remembered across restarts.
//
// A TOP-LEVEL key of config.json (`layout`), like `pet`: a channel without it keeps it in `unknownFields`.

export type CenterView = 'oracle' | 'terminals';

export interface LayoutPrefs {
  /** The new layout: the Oráculo takes the center of "Uso geral". `false` = the old layout, terminals only. */
  readonly oracleCenter: boolean;
  /** What the center shows in the new layout. */
  readonly centerView: CenterView;
}

export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = { oracleCenter: true, centerView: 'oracle' };

/** Field by field: a value this build does not know keeps the fallback for that field. */
export function sanitizeLayoutPrefs(value: unknown, fallback: LayoutPrefs = DEFAULT_LAYOUT_PREFS): LayoutPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const { oracleCenter, centerView } = value as Record<string, unknown>;
  return {
    oracleCenter: typeof oracleCenter === 'boolean' ? oracleCenter : fallback.oracleCenter,
    centerView: centerView === 'oracle' || centerView === 'terminals' ? centerView : fallback.centerView,
  };
}

/** The center shows the Oráculo: new layout, the Oráculo chosen. The old layout never does. */
export function showsOracle(prefs: LayoutPrefs): boolean {
  return prefs.oracleCenter && prefs.centerView === 'oracle';
}

/** The button / Ctrl+Shift+O: Oráculo ⇄ Terminais. */
export function toggleCenterView(prefs: LayoutPrefs): LayoutPrefs {
  return { ...prefs, centerView: prefs.centerView === 'oracle' ? 'terminals' : 'oracle' };
}
