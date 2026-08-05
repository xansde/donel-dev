// T1311 (011-contas-e-provedores, etapa 3, C21/D3) — precedência única e
// pura de `CLAUDE_CONFIG_DIR`: provider > motor > perfil. Função pura, sem
// I/O — o único ponto do app que responde "qual config dir esta sessão
// usa" (consumida em src/main/index.ts, T1319). Quando a etapa 2 (demolição
// de perfis) já rodou, `activeProfileConfigDir` simplesmente nunca é
// passado (ou vem `undefined`) — o terceiro ramo some sem tocar nos dois
// primeiros (data-model.md §6).

export interface ResolveSessionConfigDirInput {
  /** Provider classe A selecionado NESTA sessão, já resolvido (`<userData>/providers/<id>/`). */
  readonly providerConfigDir?: string;
  /** Motor de contas (etapa 1) ativo (`mod !== null`) — quando ativo e sem provider, o motor escreve direto em `~/.claude`, então NÃO há override. */
  readonly accountsEngineActive: boolean;
  /** Mecanismo de hoje (perfis) — morre na etapa 2; ausente/`undefined` no mundo pós-etapa 2. */
  readonly activeProfileConfigDir?: string;
}

/** `undefined` = sem override (o `~/.claude` real). Ordem: provider > motor > perfil. */
export function resolveSessionConfigDir(input: ResolveSessionConfigDirInput): string | undefined {
  if (input.providerConfigDir) return input.providerConfigDir;
  if (input.accountsEngineActive) return undefined;
  return input.activeProfileConfigDir;
}
