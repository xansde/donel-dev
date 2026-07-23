// FIX (feedback E2E rodada 5) — "statusbar deve mostrar a conta com que a
// sessão EM FOCO foi criada" (specs/001-mvp/feedback-e2e.md).
//
// CAUSA RAIZ: StatusBar (App.tsx) recebia `accountLabel` GLOBAL (perfil
// ATIVO, reportado por ProfileSwitcher.tsx — independente da aba); nenhum
// lugar guardava o perfil de NASCIMENTO de cada sessão. Trocar de perfil
// ativo global sem mudar sessões vivas é o comportamento CORRETO (FR-005/
// CA-3) — o bug era só a barra inferior sugerir, incorretamente, que a
// sessão em foco tinha trocado de conta junto.
//
// Função pura (sem I/O), extraída de App.tsx pra ser testável em isolamento
// (TDD com escopo — bugfix de produção). `profile` vem de
// `PtyCreateResult.profile` (shared/index.ts), resolvido pelo main process
// no momento da criação da aba (main/index.ts `activeProfileSlug`/
// `activeProfileName`) e propagado por TerminalPane -> App.tsx
// (`sessionProfiles`, chave = tab.id) — nunca reconsultado depois: o valor é
// fixo pra vida da aba, exatamente como `claudeConfigDir` já é (T014,
// PtyManager.create, "por VALOR na criação").

import { parseAccountNumber } from './profiles';

export interface SessionAccountLabelInput {
  /** 'shell' (terminal livre) nunca aplica `CLAUDE_CONFIG_DIR` — não tem "perfil de nascimento" que faça sentido mostrar. */
  sessionType: 'claude' | 'shell';
  /** Perfil de nascimento da aba (`PtyCreateResult.profile`); `undefined` = ainda não resolvido (janela curta entre `pty:create` disparar e a promise resolver) OU aba 'shell'. */
  profile: { slug: string; name: string } | undefined;
}

/**
 * Rótulo da statusbar pra aba em foco (ui-spec §2 zona 5, FR-009/FR-005):
 * - 'shell' -> rótulo neutro, sem conta nenhuma.
 * - 'claude' com perfil resolvido -> "Sessão: <nome>", normalizando pro
 *   formato canônico "Tecnologia Claude {n}" quando o nome já segue essa
 *   convenção (`parseAccountNumber`, mesma normalização que
 *   ProfileSwitcher.tsx já aplica no badge do titlebar) — perfis fora da
 *   convenção (ex.: "Principal", nomes de teste) mostram o nome cru.
 * - 'claude' sem perfil ainda resolvido -> `fallbackGlobalLabel` (o
 *   `accountLabel` global de ProfileSwitcher) só como placeholder da janela
 *   curta até `pty:create` responder — nunca o estado estável da aba.
 */
export function computeSessionAccountLabel(input: SessionAccountLabelInput, fallbackGlobalLabel: string): string {
  if (input.sessionType === 'shell') return 'Terminal (sem conta)';
  if (!input.profile) return fallbackGlobalLabel;

  const accountNumber = parseAccountNumber(input.profile.name);
  const displayName = accountNumber !== null ? `Tecnologia Claude ${accountNumber}` : input.profile.name;
  return `Sessão: ${displayName}`;
}
