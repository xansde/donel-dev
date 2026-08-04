// T1218/T1219 (011-contas-e-provedores, etapa 2) — troca de fonte do rótulo
// de sessão (C24): a entrada deixa de ser o perfil (`{slug, name}`,
// `shared/profiles.ts`, que morre na Fase 4) e vira a CONTA do motor
// (`{id, label}`, `shared/accounts.ts`), preenchida pelo main NO MOMENTO do
// disparo da sessão (`PtyCreateResult.account`) e imutável pela vida da aba —
// mesma regra "por valor na criação" que `claudeConfigDir` já seguia (T014).
//
// A cota também troca de fonte: antes vinha de `ProfileQuota` (% LIVRE,
// dropdown de perfis, spec 002); agora vem de `AccountLoad` (% CONSUMIDO,
// `shared/accounts.ts`) — C25 fecha o achado A3 da etapa 1 (duas unidades
// convivendo): com o dropdown de perfis morto (Fase 4), só sobra esta.
//
// Função pura (sem I/O), extraída de App.tsx pra ser testável em isolamento.

import type { AccountId, AccountLoad } from './accounts';
import { overallLoad } from './accounts';

export interface SessionAccountLabelInput {
  /** 'shell' (terminal livre) nunca aplica `CLAUDE_CONFIG_DIR` — não tem "conta de nascimento" que faça sentido mostrar. */
  sessionType: 'claude' | 'shell';
  /** Conta de nascimento da aba (`PtyCreateResult.account`); `undefined` = ainda não resolvido (janela curta entre `pty:create` disparar e a promise resolver) OU aba 'shell'. */
  account: { id: AccountId; label: string } | undefined;
}

/**
 * Rótulo da statusbar pra aba em foco:
 * - 'shell' -> rótulo neutro, sem conta nenhuma (cota não se aplica).
 * - 'claude' com conta resolvida -> "Sessão: <label> · <cota>". `<cota>` é
 *   `${overallLoad(load)}% usado` quando conhecida, `—` quando ausente —
 *   MESMO contrato "sempre mostra o slot" de sempre, aplicado à carga da
 *   conta de NASCIMENTO da aba (não da conta ativa global).
 * - 'claude' sem conta ainda resolvida -> `fallbackGlobalLabel` (o rótulo
 *   global da tela de contas, que já embute sua PRÓPRIA cota) só como
 *   placeholder da janela curta até `pty:create` responder — nunca o estado
 *   estável da aba; `load` é ignorado neste caso.
 */
export function computeSessionAccountLabel(
  input: SessionAccountLabelInput,
  fallbackGlobalLabel: string,
  load: AccountLoad | null = null,
): string {
  if (input.sessionType === 'shell') return 'Terminal (sem conta)';
  if (!input.account) return fallbackGlobalLabel;

  const percent = overallLoad(load);
  const percentText = percent === null ? '—' : `${percent}% usado`;
  return `Sessão: ${input.account.label} · ${percentText}`;
}

// ---------------------------------------------------------------------------
// CA-25 (009-modo-dev-v3, lote 8) — extensão pra ENTRADAS ARQUIVADAS: o mapa
// mostra a etapa concluída de um card de plano (`ArchivedPhaseSession`,
// devMode.ts) com a CONTA de quando ela rodou. Troca de vocabulário (C24):
// `profileSlug` → `accountId` — a leitura tolerante do campo legado
// acontece em `devMode.ts`/`config-store.ts` (T1220), nunca aqui; esta
// função só formata o que já chegou resolvido.
// ---------------------------------------------------------------------------

export interface ArchivedAccountLabel {
  readonly label: string;
  /** `true` quando a conta arquivada é diferente da conta ATIVA agora — sinal pra UI aplicar um tom de aviso (nunca de erro: rodar numa conta diferente é esperado, não uma falha). */
  readonly mismatch: boolean;
}

/** CA-25 — rótulo curto + sinal de divergência pra uma entrada arquivada. */
export function formatArchivedAccountLabel(accountId: string, activeAccountId: string): ArchivedAccountLabel {
  return { label: `conta: ${accountId}`, mismatch: accountId !== activeAccountId };
}
