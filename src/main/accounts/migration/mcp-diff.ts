// T1205 (011-contas-e-provedores, etapa 2) — diff de MCP (`data-model-etapa-2.md`
// §2, D14/C29). PURO: sem I/O, sem caminho de escrita. Saída é só NOMES de
// servidor — nenhum valor de configuração (args/env/headers) pode atravessar,
// argumento de MCP carrega token com frequência.

export interface McpDiff {
  readonly profileSlug: string;
  /** Servidores que só o perfil tem — candidatos a decisão manual. */
  readonly onlyInProfile: readonly string[];
  /** Servidores que só o global tem — informativo. */
  readonly onlyInGlobal: readonly string[];
}

function serverNames(claudeJson: Record<string, unknown> | null): readonly string[] {
  const mcpServers = claudeJson?.mcpServers;
  if (typeof mcpServers !== 'object' || mcpServers === null || Array.isArray(mcpServers)) return [];
  return Object.keys(mcpServers);
}

/** Nunca lança: `.claude.json` ausente/corrompido (`null`) ⇒ diff vazio. */
export function computeMcpDiff(
  profileSlug: string,
  profileClaudeJson: Record<string, unknown> | null,
  globalClaudeJson: Record<string, unknown> | null,
): McpDiff {
  const profileNames = new Set(serverNames(profileClaudeJson));
  const globalNames = new Set(serverNames(globalClaudeJson));

  return {
    profileSlug,
    onlyInProfile: [...profileNames].filter((name) => !globalNames.has(name)),
    onlyInGlobal: [...globalNames].filter((name) => !profileNames.has(name)),
  };
}
