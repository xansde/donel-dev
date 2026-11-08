// Vigia de travas — the optional `vigia` key of the app config. The vault check is an ADAPTER, off by default
// (CLAUDE.md: integrations are optional, off, with names from the config, nothing fixed in the core). Without
// `vigia.cofre` the vigia only watches what is generic: place down, asking for login, sessions in a loop.

export interface VigiaCofrePrefs {
  /** The vault's command on the remote place (a plain program name), asked only for `status`. */
  readonly command: string;
  /** A file below the remote `$HOME` that the place's shell loads (`. file`) into the command's environment. */
  readonly sessionFile: string;
}

export interface VigiaPrefs {
  readonly cofre: VigiaCofrePrefs | null;
}

export function defaultVigiaPrefs(): VigiaPrefs {
  return { cofre: null };
}

const PROGRAM = /^[A-Za-z0-9._-]{1,64}$/;
const HOME_FILE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,7}$/;

/** Anything not exactly a program name and a plain relative path (no `..`, no spaces, no quotes) turns the vault check off. */
export function sanitizeVigiaPrefs(value: unknown): VigiaPrefs {
  const cofre = (value as { cofre?: unknown } | null)?.cofre as { command?: unknown; sessionFile?: unknown } | undefined;
  const command = typeof cofre?.command === 'string' ? cofre.command.trim() : '';
  const sessionFile = typeof cofre?.sessionFile === 'string' ? cofre.sessionFile.trim() : '';
  if (!PROGRAM.test(command) || !HOME_FILE.test(sessionFile) || sessionFile.split('/').some((part) => part === '..' || part === '.')) return defaultVigiaPrefs();
  return { cofre: { command, sessionFile } };
}
