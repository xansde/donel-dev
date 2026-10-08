// T018 (014-chat, FR-030/R17) — leitura mínima do `settings.json` do CLI do
// usuário. Lê SÓ `permissions.defaultMode`: o resto do arquivo (env, helpers de
// credencial, hooks) nunca é retido, devolvido nem logado — o app não lê
// credencial (CLAUDE.md, "Credenciais"). Tolera arquivo ausente e JSON inválido.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Puro — extrai `permissions.defaultMode` do texto do arquivo; qualquer outra coisa vira `undefined`. */
export function parseDefaultPermissionMode(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const permissions = (parsed as Record<string, unknown>).permissions;
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) return undefined;
  const mode = (permissions as Record<string, unknown>).defaultMode;
  return typeof mode === 'string' && mode.length > 0 ? mode : undefined;
}

/** `configDir` = pasta de config do CLI (`~/.claude` por padrão). `readText` injetável para teste. */
export function readUserDefaultPermissionMode(
  configDir: string = join(homedir(), '.claude'),
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string | undefined {
  try {
    return parseDefaultPermissionMode(readText(join(configDir, 'settings.json')));
  } catch {
    return undefined;
  }
}
