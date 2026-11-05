// Navegador integrado — what `navegador_enviar_arquivo` may send (V2, docs/design/navegador-interno.md). Pure: the
// paths come already resolved; the caller does the `realpath` and the `stat`.
//
// Only files inside a folder the owner authorized go up. The list is the app's (config `browserUploads`, every
// session, survives a restart) and grows only by a gesture of the owner: Permitir on the request the tool shows him
// (the folder of the file the agent asked for), or the picker in Regras. The credentials rule of the app holds here too: a folder that is (or holds) the
// agent's own config, the app's data or the usual key folders cannot be authorized, and a file that looks like a
// secret is refused even inside an authorized folder.
//
// Lesson from browser-use (MIT, `tools/service.py`, GHSA-j9hj-92j8-jv9h): an agent-controlled path must be resolved
// and checked against the folder after the resolution, never matched by name.

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Folders of the home that hold credentials or keys, whatever the file name. */
export const SENSITIVE_HOME_DIRS = ['.claude', '.claude-profiles', '.claude-profiles.old', '.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.config', 'AppData'] as const;

const SECRET_FILE = /^(\.credentials\.json|credentials(\.json)?|\.env(\..*)?|\.netrc|\.npmrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|kdbx|keystore|jks|ppk))$/i;

/** Backslashes to slashes, no trailing slash, lower case (Windows paths compare without case). */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isInsideOrEqual(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/** `list` with `folder` once (an equal path in another case or with a trailing slash counts as the same). */
export function withUploadFolder(list: readonly string[], folder: string): string[] {
  const key = normalize(folder);
  return list.some((item) => normalize(item) === key) ? [...list] : [...list, folder];
}

/** `list` without `folder` (compared like `withUploadFolder`). */
export function withoutUploadFolder(list: readonly string[], folder: string): string[] {
  const key = normalize(folder);
  return list.filter((item) => normalize(item) !== key);
}

export interface UploadFolderContext {
  readonly home: string;
  readonly userData: string;
}

/** Why the owner cannot authorize `folder`; `null` when he can. */
export function refusedUploadFolder(folder: string, context: UploadFolderContext): string | null {
  const target = normalize(folder);
  if (target === '' || /^[a-z]:$/.test(target)) return 'A raiz do disco não pode ser autorizada: escolha uma pasta só com o que o agente pode enviar.';
  const home = normalize(context.home);
  if (isInsideOrEqual(home, target)) return 'Sua pasta de usuário inteira não pode ser autorizada: escolha uma pasta só com o que o agente pode enviar.';
  const sensitive = [...SENSITIVE_HOME_DIRS.map((name) => `${home}/${name.toLowerCase()}`), normalize(context.userData)];
  if (sensitive.some((dir) => isInsideOrEqual(target, dir) || isInsideOrEqual(dir, target))) {
    return 'Essa pasta guarda configurações ou credenciais e não pode ser autorizada.';
  }
  return null;
}

/**
 * Why the file at `relativePath` (relative to the authorized folder, after `realpath` of both) cannot be sent;
 * `null` when it can. Anything that escapes the folder, a hidden file or folder and a secret-looking name are refused.
 */
export function refusedUploadFile(relativePath: string): string | null {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter((part) => part !== '');
  if (parts.length === 0 || parts[0] === '..' || /^[a-z]:/i.test(parts[0]) || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    return 'Esse arquivo está fora da pasta que o dono autorizou.';
  }
  if (parts.some((part) => part === '..')) return 'Esse arquivo está fora da pasta que o dono autorizou.';
  if (parts.some((part) => part.startsWith('.') && !SECRET_FILE.test(part))) return 'Arquivo ou pasta oculta não é enviado.';
  if (parts.some((part) => SECRET_FILE.test(part))) return 'Esse arquivo parece guardar uma credencial e não é enviado.';
  return null;
}
