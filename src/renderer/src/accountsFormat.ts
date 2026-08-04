// T1123 (011-contas-e-provedores, etapa 1) — formatação PURA da carga de
// conta na UI. "Cuidado de unidade" (achado A3 do `analyze`, plan.md):
// `AccountLoad` (accounts.ts) é **% CONSUMIDO**; `ProfileQuota` (spec 002,
// dropdown de perfis) é **% LIVRE** (`percentRemaining`). Os dois convivem na
// tela enquanto perfis existirem — NUNCA comparar, somar ou reaproveitar um
// formatador entre eles sem converter explicitamente por aqui.
import type { AccountLoad } from '../../shared';
import { overallLoad } from '../../shared';

/** `% consumido` -> `% livre` (o inverso). `null` (carga desconhecida) permanece `null` — nunca vira `100` por acidente. */
export function consumedToRemainingPercent(consumedPercent: number | null): number | null {
  if (consumedPercent === null) return null;
  return Math.max(0, Math.min(100, 100 - consumedPercent));
}

/** Texto de uma janela em "% consumido" — "5h 42% usado", ou "5h sem dado" quando `null` (nunca "5h —" — mesma régua de clareza do ProfileSwitcher, windowText). */
export function formatLoadWindow(label: string, consumedPercent: number | null): string {
  return consumedPercent === null ? `${label} sem dado` : `${label} ${consumedPercent}% usado`;
}

/** As duas janelas explícitas que a spec pede (T1123 DoD): "5h 42% usado · semana 18% usado". */
export function formatAccountLoad(load: AccountLoad | null): string {
  if (!load) return '5h sem dado · semana sem dado';
  return `${formatLoadWindow('5h', load.fiveHour)} · ${formatLoadWindow('semana', load.sevenDay)}`;
}

/** Carga geral (`max(5h, 7d, sonnet)`, mesma regra do auto-switch) formatada pro badge compacto. */
export function formatOverallLoad(load: AccountLoad | null): string {
  const overall = overallLoad(load);
  return overall === null ? 'sem dado' : `${overall}% usado`;
}
