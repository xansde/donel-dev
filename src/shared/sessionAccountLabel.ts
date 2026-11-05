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
// 011-contas-e-provedores, etapa 3, Fase 2 (D1/D2, ajuste ao desenho) — a
// aba passa a mostrar a conta VIGENTE, não mais a de nascimento: sessão
// `claude` de conta (sem provider, sem login isolado) segue a troca GLOBAL —
// rótulo e cota são de `current.active`/`current.load` (o motor, lido a cada
// render), não da conta que a aba tinha ao nascer. `account` (nascimento,
// `PtyCreateResult.account`) sobrevive só pro sufixo "trocou em voo" quando
// diverge da ativa. `credentialSource` decide o RAMO antes de qualquer conta
// entrar em jogo: aba de provider mostra o provider (sem cota — cota é
// conceito de conta), aba de login isolado mostra um rótulo neutro (é o
// próprio login, não uma sessão de trabalho); só o ramo 'account' (default)
// usa `current`/`account`. `current.autoSwitchState` (era o booleano
// `saturated` no desenho original; virou o enum inteiro pra cobrir `blind`
// também, adendo D8) acrescenta o aviso de "sem folga"/"sem leitura" quando
// a troca automática está travada (D6/D8).
//
// Função pura (sem I/O), extraída de App.tsx pra ser testável em isolamento.

import type { AccountId, AccountLoad, AutoSwitchState } from './accounts';
import { overallLoad } from './accounts';

export interface SessionAccountLabelInput {
  /** 'shell' (terminal livre) nunca aplica `CLAUDE_CONFIG_DIR` — não tem "conta de nascimento" que faça sentido mostrar. */
  sessionType: 'claude' | 'shell';
  /** Conta de NASCIMENTO da aba (`PtyCreateResult.account`); `undefined` = ainda não resolvido (janela curta entre `pty:create` disparar e a promise resolver) OU aba 'shell'. Fase 2 (D1): só alimenta o sufixo "trocou em voo" — o rótulo/cota principal vêm de `current`. */
  account: { id: AccountId; label: string } | undefined;
  /** Fase 2 (D1/C13) — de onde vem a credencial desta aba. `undefined` = 'account' (comportamento de hoje: conta do motor). */
  credentialSource?: 'account' | 'provider' | 'login';
  /** Rótulo do provider desta aba (só relevante com `credentialSource: 'provider'`); sem rótulo cai no genérico "provedor". */
  providerLabel?: string;
}

/** Fase 2 (D1) — o que o motor sabe AGORA, independente de qual aba está em foco. */
export interface CurrentAccountContext {
  /** Conta ATIVA agora (troca global); `null` = motor inerte ou sem conta ativa. */
  active: { id: AccountId; label: string } | null;
  /** Carga da conta ATIVA (não da conta de nascimento da aba — essa foi a virada do D1). */
  load: AccountLoad | null;
  /** Estado do auto-switch neste instante — acrescenta o sufixo de aviso quando travado (`saturated` D6, `blind` D8). */
  autoSwitchState: AutoSwitchState;
  /**
   * Ponte da statusline — % das janelas de 5h/7d que o PRÓPRIO CLI da aba em
   * foco leu na última resposta da API (`rate_limits`). Quem chama só passa
   * leitura posterior à última troca de conta (senão seria a cota da conta de
   * antes). Janela a janela, vale na frente da `load` do motor (que é lida a
   * cada 5 min); a janela `sonnet`, que a statusline não traz, segue do motor.
   */
  liveLoad?: { fiveHour: number | null; sevenDay: number | null } | null;
}

/** `overallLoad` da conta ativa com a leitura viva da sessão na frente, janela a janela. */
function currentPercent(current: CurrentAccountContext): number | null {
  const live = current.liveLoad;
  if (!live) return overallLoad(current.load);
  return overallLoad({
    fiveHour: live.fiveHour ?? current.load?.fiveHour ?? null,
    sevenDay: live.sevenDay ?? current.load?.sevenDay ?? null,
    sonnet: current.load?.sonnet ?? null,
    readAt: current.load?.readAt ?? '',
  });
}

/**
 * Rótulo da statusbar pra aba em foco. Fase 2 (D1/D2) reescreve o contrato:
 * - 'shell' -> rótulo neutro, sem conta nenhuma (cota não se aplica).
 * - `credentialSource: 'login'` -> rótulo neutro do próprio login isolado
 *   (é a aba do login, não uma sessão de trabalho).
 * - `credentialSource: 'provider'` -> "Sessão: <providerLabel> · provedor"
 *   (sem cota; sem `providerLabel` usa o genérico "provedor").
 * - `credentialSource: 'account'` (default) com `current.active` -> "Sessão:
 *   <active.label> · <cota>" (cota = `${overallLoad(current.load)}% usado`
 *   quando conhecida, `—` quando não — MESMO contrato "sempre mostra o
 *   slot" de sempre, agora aplicado à conta ATIVA, não à de nascimento);
 *   ganha " · trocou em voo (era <rótulo de nascimento>)" quando `account`
 *   existe e diverge da ativa, e depois " · sem conta com folga" (D6,
 *   `autoSwitchState === 'saturated'`) ou " · sem leitura das outras
 *   contas" (D8, `autoSwitchState === 'blind'`).
 * - 'account' sem `current.active` mas com `account` (nascimento) resolvido
 *   -> "Sessão: <account.label> · —" (motor ficou inerte ou sem leitura
 *   depois da aba nascer).
 * - 'account' sem `current.active` e sem `account` -> `fallbackGlobalLabel`
 *   (o rótulo global da tela de contas, que já embute sua PRÓPRIA cota) só
 *   como placeholder da janela curta até `pty:create` responder.
 */
export function computeSessionAccountLabel(
  input: SessionAccountLabelInput,
  fallbackGlobalLabel: string,
  current: CurrentAccountContext,
): string {
  if (input.sessionType === 'shell') return 'Terminal (sem conta)';

  const credentialSource = input.credentialSource ?? 'account';
  if (credentialSource === 'login') return 'Login de conta (sem sessão)';
  if (credentialSource === 'provider') return `Sessão: ${input.providerLabel ?? 'provedor'} · provedor`;

  if (current.active) {
    const percent = currentPercent(current);
    const percentText = percent === null ? '—' : `${percent}% usado`;
    let label = `Sessão: ${current.active.label} · ${percentText}`;
    if (input.account && input.account.id !== current.active.id) {
      label += ` · trocou em voo (era ${input.account.label})`;
    }
    if (current.autoSwitchState === 'saturated') {
      label += ' · sem conta com folga';
    } else if (current.autoSwitchState === 'blind') {
      label += ' · sem leitura das outras contas';
    }
    return label;
  }

  // Sem conta ativa no motor, a única cota conhecida é a que o CLI da aba leu.
  const livePercent = current.liveLoad ? currentPercent({ ...current, load: null }) : null;
  if (input.account) return `Sessão: ${input.account.label} · ${livePercent === null ? '—' : `${livePercent}% usado`}`;
  if (livePercent !== null) return `Sessão: conta do CLI · ${livePercent}% usado`;

  return fallbackGlobalLabel;
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
