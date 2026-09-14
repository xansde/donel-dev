// T1123 (011-contas-e-provedores, etapa 1) — formatação PURA da carga de
// conta na UI. "Cuidado de unidade" (achado A3 do `analyze`, plan.md):
// `AccountLoad` (accounts.ts) é **% CONSUMIDO**; `ProfileQuota` (spec 002,
// dropdown de perfis) é **% LIVRE** (`percentRemaining`). Os dois convivem na
// tela enquanto perfis existirem — NUNCA comparar, somar ou reaproveitar um
// formatador entre eles sem converter explicitamente por aqui.
import type { AccountLoad, AutoSwitchPolicy } from '../../shared';
import { overallLoad } from '../../shared';
// 011-contas-e-provedores, etapa 3, Fase 2 — `AutoSwitchEvent`/`AccountId`
// ainda não foram propagados ao barrel `shared/index.ts` (fora do escopo
// deste bloco — só toca os arquivos listados no desenho); import direto do
// módulo, mesmo padrão que `App.tsx` já usa pra `sessionAccountLabel`/`cliColor`.
import type { AccountId, AutoSwitchEvent } from '../../shared/accounts';

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

// ---------------------------------------------------------------------------
// 011-contas-e-provedores, etapa 3, Fase 2 (D5/D6; `blind` no adendo D8) —
// formatação PURA das duas peças novas do auto-switch no painel: a narração
// de UMA decisão (`AccountsViewDto.lastAutoSwitch`) e os avisos de "travado"
// (saturated: ninguém tem a folga mínima; blind: falta LEITURA de carga de
// outra conta — D8 "sem leitura não é sem folga"). Mesma régua de pureza do
// resto do arquivo: nada aqui lê relógio/IO — `formatTime` tem um default,
// mas é injetável pra teste determinístico (`tests/accountsFormat.test.ts`).
// ---------------------------------------------------------------------------

const AUTO_SWITCH_FAILURE_REASON_LABEL: Record<'unauthorized' | 'offline' | 'expired-credentials' | 'io', string> = {
  offline: 'sem conexão',
  unauthorized: 'o servidor recusou',
  'expired-credentials': 'a credencial venceu',
  io: 'erro ao gravar a troca',
};

/** Default de `formatTime` em `formatAutoSwitchEvent`: "HH:MM" em pt-BR. */
function defaultAutoSwitchTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Narra UMA decisão do auto-switch (`AutoSwitchEvent`,
 * `AccountsViewDto.lastAutoSwitch`) pro painel. `labelOf` resolve id ->
 * rótulo — o fallback pra id desconhecido é responsabilidade de quem
 * injeta (mesma régua de `AccountsPanel.accountLabel`), não desta função.
 */
export function formatAutoSwitchEvent(
  event: AutoSwitchEvent,
  labelOf: (id: AccountId) => string,
  formatTime: (iso: string) => string = defaultAutoSwitchTime,
): string {
  const time = formatTime(event.at);
  if (event.kind === 'switched') {
    const to = labelOf(event.to);
    return event.from === null
      ? `Troca automática às ${time}: para «${to}».`
      : `Troca automática às ${time}: de «${labelOf(event.from)}» para «${to}».`;
  }
  if (event.kind === 'deferred') {
    return `Troca automática adiada às ${time}: há sessão trabalhando. Ela sai quando a sessão terminar.`;
  }
  return `Troca automática para «${labelOf(event.to)}» falhou às ${time} — ${AUTO_SWITCH_FAILURE_REASON_LABEL[event.reason]}.`;
}

/** D6 — "todas acima do limiar: avisa, não troca" (`autoSwitchState === 'saturated'`): nenhuma outra conta tem a folga mínima. */
export function formatSaturatedWarning(policy: AutoSwitchPolicy): string {
  const points = policy.minAdvantage === 1 ? '1 ponto de folga' : `${policy.minAdvantage} pontos de folga`;
  return `A conta ativa passou de ${policy.switchAtLoad}% e nenhuma outra tem ${points} — a troca automática não tem para onde ir.`;
}

/**
 * D8 — "sem leitura não é sem folga" (`autoSwitchState === 'blind'`): pelo
 * menos uma outra conta disponível está com carga DESCONHECIDA (token
 * vencido de conta parada) — falta DADO, não falta folga. Não cita pontos
 * de folga de propósito: citar um número aqui sugeriria que o problema é
 * limiar, quando é leitura.
 */
export function formatBlindWarning(policy: AutoSwitchPolicy): string {
  return `A conta ativa passou de ${policy.switchAtLoad}% e falta a leitura de carga de outras contas — a troca automática só escolhe conta com carga conhecida.`;
}
