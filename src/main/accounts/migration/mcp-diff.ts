// T1205 (011-contas-e-provedores, etapa 2) — diff de MCP (`data-model-etapa-2.md`
// §2, D14/C29). PURO: sem I/O, sem caminho de escrita. Saída é só NOMES de
// servidor — nenhum valor de configuração (args/env/headers) pode atravessar,
// argumento de MCP carrega token com frequência.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpDiff } from '../../../shared/migration';

export type { McpDiff } from '../../../shared/migration';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readClaudeJsonOrNull(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Lê `.claude.json` de disco (perfil + global) e devolve o diff — só o main process usa (IO real). */
export function computeMcpDiffFromDisk(profileSlug: string, profileConfigDir: string, globalClaudeJsonPath: string): McpDiff {
  const profileClaudeJson = readClaudeJsonOrNull(join(profileConfigDir, '.claude.json'));
  const globalClaudeJson = readClaudeJsonOrNull(globalClaudeJsonPath);
  return computeMcpDiff(profileSlug, profileClaudeJson, globalClaudeJson);
}
