// 014-chat (T078/T079) — pt-BR texts of the pending panel and notifications. Pure.
// Never invents effect or safety claims (D-C12); notifications never carry content (D-C17).

import type { Pending, PermissionPayload } from './rows';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

/** `mcp__server__tool` → `{ server, tool }`; null for anything else. */
function parseMcp(toolName: string): { server: string; tool: string } | null {
  const match = /^mcp__([^_](?:.*?[^_])?)__(.+)$/.exec(toolName);
  return match ? { server: match[1]!, tool: match[2]! } : null;
}

/** D-C12: template sentence per tool. */
export function permissionSentence(p: PermissionPayload): { verb: string; object: string } {
  const input = p.toolInput;
  switch (p.toolName) {
    case 'Bash':
      return { verb: 'rodar', object: str(input.command) };
    case 'Edit':
    case 'MultiEdit':
      return { verb: 'editar', object: str(input.file_path) };
    case 'Write':
      return { verb: 'criar', object: str(input.file_path) };
    case 'WebFetch':
      return { verb: 'abrir', object: str(input.url) };
  }
  const mcp = parseMcp(p.toolName);
  if (mcp) return { verb: 'usar', object: `${mcp.server} · ${mcp.tool}` };
  return { verb: 'usar', object: p.toolName };
}

/** The Claude-written `description` of the tool input, verbatim, or null. */
export function permissionDescription(p: PermissionPayload): string | null {
  const description = p.toolInput.description;
  return typeof description === 'string' && description.trim() !== '' ? description : null;
}

/** D-C13: honest label of "allow always" — the rule really written, valid for the whole project. */
export function allowAlwaysLabel(p: PermissionPayload): string {
  const rules: string[] = [];
  for (const suggestion of p.permissionSuggestions ?? []) {
    if (suggestion.type !== 'addRules' || !Array.isArray(suggestion.rules)) continue;
    for (const rule of suggestion.rules as Record<string, unknown>[]) {
      const toolName = str(rule?.toolName);
      if (toolName === '') continue;
      const content = str(rule.ruleContent);
      rules.push(content === '' ? `\`${toolName}\`` : `\`${toolName}(${content})\``);
    }
  }
  if (rules.length > 0) return `sempre: ${rules.join(', ')}`;
  if (p.toolName === 'Edit' || p.toolName === 'MultiEdit' || p.toolName === 'Write') {
    return 'sempre: todas as edições neste projeto';
  }
  return `sempre: ${p.toolName} neste projeto`;
}

/** D-C17: never includes command, question text or content. */
export function pendingNotificationBody(p: Pending): string {
  let what: string;
  if (p.kind === 'question') what = 'pergunta';
  else if (p.kind === 'plan') what = 'plano proposto';
  else {
    const { toolName, toolInput } = p.payload;
    if (toolName === 'Bash') what = 'permissão para rodar um comando';
    else if (toolName === 'Edit' || toolName === 'MultiEdit') {
      const file = basename(str(toolInput.file_path));
      what = file === '' ? 'permissão para editar um arquivo' : `permissão para editar ${file}`;
    } else what = `permissão para usar ${toolName}`;
  }
  const origin = p.scope === 'main' ? '' : ` (pedido do subagente ${p.scope.description})`;
  return `Esperando você — ${what}${origin}`;
}
