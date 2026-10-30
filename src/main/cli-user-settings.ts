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

// --- Ponte da statusline: a `statusLine` que o usuário já tem ---------------
// O `--settings` da sessão entra na camada "flag", ACIMA de user/project/local
// (ordem do CLI 2.1.314: user < project < local < flag < managed). Uma
// `statusLine` injetada ali esconderia a do usuário, então o app lê a dele
// para ENCADEAR (hooks-settings.ts). Só a chave `statusLine` é lida; o comando
// vai para o `--settings` da sessão (em userData, apagado no fim da aba) e
// nunca para log. Managed fica de fora: lá o CLI ignora a nossa de qualquer
// jeito (e a do usuário continua valendo).

export interface UserStatusLine {
  readonly command: string;
  readonly padding?: number;
  readonly refreshInterval?: number;
  readonly hideVimModeIndicator?: boolean;
}

/** Puro — `statusLine` crua de um arquivo de settings (objeto), ou `undefined` se não há. */
export function parseRawStatusLine(text: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const statusLine = (parsed as Record<string, unknown>).statusLine;
  if (typeof statusLine !== 'object' || statusLine === null || Array.isArray(statusLine)) return undefined;
  return statusLine as Record<string, unknown>;
}

/** Puro — junta as camadas na ordem do CLI (a última vence, campo a campo) e valida. `null` = sem statusline de comando. */
export function mergeStatusLineLayers(layers: ReadonlyArray<Record<string, unknown> | undefined>): UserStatusLine | null {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) if (layer) Object.assign(merged, layer);
  if (merged.type !== 'command' || typeof merged.command !== 'string' || merged.command.trim() === '') return null;
  const result: { command: string; padding?: number; refreshInterval?: number; hideVimModeIndicator?: boolean } = { command: merged.command };
  if (typeof merged.padding === 'number' && Number.isFinite(merged.padding)) result.padding = merged.padding;
  if (typeof merged.refreshInterval === 'number' && Number.isFinite(merged.refreshInterval) && merged.refreshInterval >= 1) {
    result.refreshInterval = merged.refreshInterval;
  }
  if (typeof merged.hideVimModeIndicator === 'boolean') result.hideVimModeIndicator = merged.hideVimModeIndicator;
  return result;
}

/**
 * A `statusLine` efetiva do usuário para uma sessão: `<configDir>/settings.json`
 * < `<cwd>/.claude/settings.json` < `<cwd>/.claude/settings.local.json`.
 * Arquivo ausente ou inválido conta como "sem statusLine" naquela camada.
 */
export function readUserStatusLine(
  configDir: string = join(homedir(), '.claude'),
  cwd: string | undefined,
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): UserStatusLine | null {
  const files = [join(configDir, 'settings.json')];
  if (cwd) files.push(join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json'));
  const layers = files.map((file) => {
    try {
      return parseRawStatusLine(readText(file));
    } catch {
      return undefined;
    }
  });
  return mergeStatusLineLayers(layers);
}
