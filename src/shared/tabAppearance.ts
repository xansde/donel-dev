// CA-26/CA-27 (009-modo-dev-v3, lote 1) — lógica pura da aba v3: reordenar
// abas por arraste (CA-26) e (de)serialização de cor+ordem por sessão
// (CA-27), persistidos no mesmo ConfigStore que já guarda `sessionNames`/
// `sessionRegistry` (config-store.ts). Mesmo padrão de sessionRegistry.ts:
// módulo puro (sem fs/Electron/React), testado em tests/tabAppearance.test.ts
// — o encanamento de disco fica em src/main/config-store.ts, os canais IPC em
// src/shared/tabChannels.ts (import type { AppConfigDto } de volta pra
// config.ts — separado deste arquivo de propósito, pra este módulo continuar
// sem NENHUM import, igual sessionRegistry.ts).
//
// `TabColorToken` é uma cópia PROPOSITAL de tipo, não um `export type` de
// `@donel-dev/design-system` — mesma razão do `SemaphoreState` duplicado em
// src/shared/index.ts (comentário de lá): este arquivo é compartilhado com o
// MAIN process, que não deve puxar um pacote de UI (CSS/React como efeito
// colateral do import). Os 4 valores têm que continuar batendo com
// `TAB_COLOR_TOKENS` de TerminalTab.tsx (design-system) — mesmo espírito.

/**
 * CA-27 — paleta fixa de 4 faixas (nenhuma cor livre: mesma disciplina de
 * token do resto do design system, `design/modo-dev-v3-verificacao.md` §3 —
 * "o mockup não introduz nenhum hex novo"). `'none'` é o default: sem cor
 * definida pelo operador ainda.
 */
export type TabColorToken = 'none' | 'accent' | 'donel-accent' | 'permission';

export const TAB_COLOR_TOKENS: readonly TabColorToken[] = ['none', 'accent', 'donel-accent', 'permission'];

/** Guarda defensiva de payload IPC (o `main` nunca confia cegamente no que o renderer manda — mesmo espírito de `isOneOf`/`isStringArray` em config-store.ts). */
export function isTabColorToken(value: unknown): value is TabColorToken {
  return typeof value === 'string' && (TAB_COLOR_TOKENS as readonly string[]).includes(value);
}

export interface TabAppearance {
  readonly color: TabColorToken;
  readonly order: number;
}

/**
 * `claudeSessionId` -> aparência da aba. Só sessões `claude` têm chave aqui —
 * abas `shell` (terminal comum) não têm identidade que sobreviva a restart,
 * mesmo motivo do nome delas ser só em memória (decisão C4,
 * 004-nomear-sessoes/sessionName.ts): cor e ordem de uma aba shell vivem só
 * no estado do App.tsx durante a sessão do app, nunca aqui.
 */
export type TabAppearanceMap = Readonly<Record<string, TabAppearance>>;

const DEFAULT_APPEARANCE: TabAppearance = { color: 'none', order: 0 };

/** Grava a cor escolhida pelo operador (CA-27), preservando a `order` já conhecida. No-op para `sessionId` vazio (devolve a MESMA referência). */
export function setTabColor(map: TabAppearanceMap, sessionId: string, color: TabColorToken): TabAppearanceMap {
  if (!sessionId) return map;
  const existing = map[sessionId] ?? DEFAULT_APPEARANCE;
  return { ...map, [sessionId]: { ...existing, color } };
}

/** Grava a posição da aba depois de um arraste (CA-26), preservando a `color` já conhecida. No-op para `sessionId` vazio ou `order` não-finita (devolve a MESMA referência). */
export function setTabOrder(map: TabAppearanceMap, sessionId: string, order: number): TabAppearanceMap {
  if (!sessionId || !Number.isFinite(order)) return map;
  const existing = map[sessionId] ?? DEFAULT_APPEARANCE;
  return { ...map, [sessionId]: { ...existing, order } };
}

/**
 * CA-26 — move o item de `fromIndex` para `toIndex` (mesma semântica de
 * `Array.splice`: o item entra na posição que hoje é `toIndex`, empurrando o
 * resto). Índices iguais ou fora do range são no-op — devolve uma CÓPIA,
 * nunca a referência original (mesmo espírito defensivo do resto do módulo;
 * `setTabs` do App.tsx sempre recebe um array novo, nunca precisa adivinhar
 * se mudou).
 */
export function reorderTabs<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved as T);
  return next;
}
