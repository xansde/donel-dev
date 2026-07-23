// FIX (feedback E2E rodada 5, item registrado em specs/001-mvp/feedback-e2e.md
// rodada 5 — NÃO é FR-009/ui-spec §2 zona 5 original, que ainda descreve o
// comportamento ANTIGO "conta ATIVA"; ver achado media da auditoria rodada 5
// sobre esse drift de spec, pendente de correção em spec.md/ui-spec.md) —
// "statusbar deve mostrar a conta com que a sessão EM FOCO foi criada".
//
// CAUSA RAIZ: StatusBar (App.tsx) recebia `accountLabel` GLOBAL (perfil
// ATIVO, reportado por ProfileSwitcher.tsx — independente da aba); nenhum
// lugar guardava o perfil de NASCIMENTO de cada sessão. Trocar de perfil
// ativo global sem mudar sessões vivas é o comportamento CORRETO (FR-005/
// CA-3) — o bug era só a barra inferior sugerir, incorretamente, que a
// sessão em foco tinha trocado de conta junto.
//
// FIX (auditoria rodada 5, achado alta "regressão de cota") — a primeira
// versão deste rótulo (`Sessão: <nome>`) removeu a cota (headroom) que a
// rodada 4 (item 8) tinha acabado de garantir SEMPRE aparecer na statusbar
// ("Principal · 62%"/"Principal · —"). `headroomPercent` abaixo restaura
// esse contrato pro rótulo por sessão: cota do perfil de NASCIMENTO da aba
// (não do perfil ativo global), consultada por quem chama via
// `ProfileHeadroomMap` (App.tsx `profileHeadroom`, alimentado por
// `ProfileSwitcher.onHeadroomChange`).
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
 * Rótulo da statusbar pra aba em foco (registrado na rodada 5 do
 * feedback-e2e.md — ver nota de topo sobre o drift pendente com FR-009/
 * ui-spec §2 zona 5 original):
 * - 'shell' -> rótulo neutro, sem conta nenhuma (cota não se aplica).
 * - 'claude' com perfil resolvido -> "Sessão: <nome> · <cota>", normalizando
 *   pro formato canônico "Tecnologia Claude {n}" quando o nome já segue essa
 *   convenção (`parseAccountNumber`, mesma normalização que
 *   ProfileSwitcher.tsx já aplica no badge do titlebar) — perfis fora da
 *   convenção (ex.: "Principal", nomes de teste) mostram o nome cru. `<cota>`
 *   é `${headroomPercent}%` quando conhecida, `—` quando `null`/ausente —
 *   MESMO contrato "sempre mostra o slot" da rodada 4 item 8, aplicado à
 *   cota do perfil de NASCIMENTO da aba (não do perfil ativo global).
 * - 'claude' sem perfil ainda resolvido -> `fallbackGlobalLabel` (o
 *   `accountLabel` global de ProfileSwitcher, que já embute sua PRÓPRIA cota)
 *   só como placeholder da janela curta até `pty:create` responder — nunca o
 *   estado estável da aba; `headroomPercent` é ignorado neste caso.
 */
export function computeSessionAccountLabel(
  input: SessionAccountLabelInput,
  fallbackGlobalLabel: string,
  headroomPercent: number | null = null,
): string {
  if (input.sessionType === 'shell') return 'Terminal (sem conta)';
  if (!input.profile) return fallbackGlobalLabel;

  const accountNumber = parseAccountNumber(input.profile.name);
  const displayName = accountNumber !== null ? `Tecnologia Claude ${accountNumber}` : input.profile.name;
  const percentText = headroomPercent === null ? '—' : `${headroomPercent}%`;
  return `Sessão: ${displayName} · ${percentText}`;
}
