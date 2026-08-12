/**
 * Cores por estado, resolvidas a partir dos tokens do design-system —
 * NUNCA hex direto no código (D-M2). O SVG próprio (aba A) e o React Flow
 * (aba C) leem `var(--token)` direto no CSS/inline style; o sigma (aba B)
 * roda em WebGL e não lê CSS var, então precisa da cor resolvida como
 * string `#rrggbb` — este módulo resolve UMA VEZ via `getComputedStyle` e
 * cacheia, para as 3 abas nunca duplicarem a leitura.
 */

import type { BenchState } from './benchGraph';

const TOKEN_BY_STATE: Record<BenchState, string> = {
  ok: '--zone-ok',
  run: '--accent',
  wait: '--state-waiting',
  block: '--state-permission',
  future: '--state-done', // usado como stroke; fill do future é --bg-raised
};

const FUTURE_FILL_TOKEN = '--bg-raised';

let cache: Record<BenchState, string> | null = null;
let futureFillCache: string | null = null;

function readToken(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || '#888888';
}

/** Cor (fill ou stroke, conforme o estado) resolvida do token de design. */
export function resolveStateColor(state: BenchState): string {
  if (!cache) {
    cache = {
      ok: readToken(TOKEN_BY_STATE.ok),
      run: readToken(TOKEN_BY_STATE.run),
      wait: readToken(TOKEN_BY_STATE.wait),
      block: readToken(TOKEN_BY_STATE.block),
      future: readToken(TOKEN_BY_STATE.future),
    };
  }
  return cache[state];
}

/** Fill do estado `future` (cinza vazado — D-M2): --bg-raised. */
export function resolveFutureFill(): string {
  if (!futureFillCache) {
    futureFillCache = readToken(FUTURE_FILL_TOKEN);
  }
  return futureFillCache;
}

/** Limpa o cache — só usado em teste, quando o DOM/tema muda entre casos. */
export function resetThemeColorCache(): void {
  cache = null;
  futureFillCache = null;
}
