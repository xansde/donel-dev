// Navegador integrado — what `navegador_enviar_arquivo` may send (V2, docs/design/navegador-interno.md). Pure: the
// paths come already resolved; the caller does the `realpath` and the `stat`.
//
// Only files inside an authorized folder go up. Three sources (owner, 07/11: "receba o poder de liberar as pastas
// através do orquestrador de cada quadro/projeto"):
// - the owner's folders (config `browserUploads`, every session), from the picker in Regras;
// - the folders the orchestrator of a board liberated for that board (config `browserUploadGrants`, with who and
//   when): the Líder único on any board, the Líder of a board on its own (`navegador_liberar_pasta`);
// - the chat attachments (`<userData>/chat-attachments`), which are the owner's own: always, for every session.
// The disk root and the whole home are never authorized. A folder of config or keys MAY be; inside any folder, the
// FILES that hold a secret are refused (`secretUploadFile`): that is the line, not the folder.
//
// Lesson from browser-use (MIT, `tools/service.py`, GHSA-j9hj-92j8-jv9h): an agent-controlled path must be resolved
// and checked against the folder after the resolution, never matched by name.

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Key folders of the home: every file in them is a key, a token or the config of one (cloud CLIs, the system's
 * keychains and credential stores, `pass`).
 */
export const KEY_HOME_DIRS = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  '.config/gcloud',
  'AppData/Roaming/gcloud',
  '.password-store',
  '.local/share/keyrings',
  '.local/share/kwalletd',
  'Library/Keychains',
  'AppData/Roaming/Microsoft/Credentials',
  'AppData/Local/Microsoft/Credentials',
  'AppData/Roaming/Microsoft/Protect',
  'AppData/Local/Microsoft/Vault',
] as const;

/** The owner's own content inside the app's folder; everything else there is the app's (config, vault, tokens, cookies). */
export const USER_DATA_CONTENT_DIRS = ['chat-attachments', 'browser-downloads', 'pedidos-audio'] as const;

/**
 * Credential and key files by name: the agent's and the clouds' (gcloud, Terraform, Vault, s3cmd, boto, kubeconfig),
 * git, npm/yarn/pip/PyPI, databases (`.pgpass`, `.my.cnf`), `.netrc`, rclone, Docker, `.htpasswd`, keys and keychains.
 */
const SECRET_FILE =
  /^(\.credentials\.json|credentials(\.json|\.db|\.tfrc\.json)?|application_default_credentials\.json|access_tokens\.db|\.env(\..*)?|[._]netrc|\.npmrc|\.yarnrc\.yml|\.pypirc|pip\.(conf|ini)|\.?git-credentials|\.pgpass|pgpass\.conf|\.my\.cnf|rclone\.conf|\.boto|\.s3cfg|\.vault-token|\.terraformrc|kubeconfig|\.htpasswd|\.dockercfg|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|kdbx|keystore|jks|ppk|keychain|keychain-db|keyring|kwl))$/i;
/**
 * A browser profile's stores: cookies, saved logins and the key that opens them. Chromium, Chrome, Edge and the app's
 * own partition (`Cookies`, `Login Data`, `Local State`…); Firefox (`cookies.sqlite`, `logins.json`, `key4.db`, and
 * the open session, which carries session cookies).
 */
const BROWSER_SECRET_FILE =
  /^(cookies|cookies-journal|extension cookies|safe browsing cookies|login data|login data-journal|login data for account|web data|web data-journal|account web data|local state|cookies\.sqlite(-wal|-shm)?|logins\.json|logins-backup\.json|key[34]\.db|signons\.sqlite|sessionstore\.jsonlz4|recovery\.(jsonlz4|baklz4)|previous\.jsonlz4)$/i;
/** Folders of a browser profile where sites keep their login tokens (Slack, Google…): every file in them. */
const BROWSER_STORAGE_DIRS = ['local storage', 'session storage', 'indexeddb'];
/** A text-like file whose name says secret, token or password (`api-token.txt`, `client_secret.json`); an image named "token" is not. */
const NAMED_SECRET_FILE = /^(.*[-_. ])?(token|tokens|secret|secrets|password|passwords|senha|senhas|apikey|api-key|api_key)([-_. ].*)?\.(json|ya?ml|toml|ini|txt|cfg|conf|env|xml)$|^(token|secret|password|senha|apikey)s?$/i;

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

/** The chat attachments of the app: the owner's own files, sendable by every session without asking. */
export function chatAttachmentsDir(userData: string): string {
  const sep = userData.includes('\\') && !userData.includes('/') ? '\\' : '/';
  return `${userData.replace(/[\\/]+$/, '')}${sep}chat-attachments`;
}

/** Why `folder` cannot be authorized (by the owner or an orchestrator); `null` when it can. */
export function refusedUploadFolder(folder: string, context: UploadFolderContext): string | null {
  const target = normalize(folder);
  if (target === '' || /^[a-z]:$/.test(target)) return 'A raiz do disco não pode ser autorizada: escolha uma pasta só com o que o agente pode enviar.';
  const home = normalize(context.home);
  if (isInsideOrEqual(home, target)) return 'A pasta de usuário inteira não pode ser autorizada: escolha uma pasta só com o que o agente pode enviar.';
  return null;
}

/**
 * Why the file at `realPath` (absolute, after `realpath`) holds a secret and is never sent, whatever folder was
 * authorized; `null` when it may go. The list (owner, 07/11: "só os arquivos de segredo, não a pasta inteira"):
 * - key and credential names anywhere (`SECRET_FILE`: `.credentials.json`, `.env*`, `id_rsa`, `*.pem`/`.pfx`/`.kdbx`,
 *   `.netrc`, `.pgpass`, `git-credentials`, `rclone.conf`, gcloud's, npm/pip's, keychains…), a browser profile's
 *   cookies, saved logins and keys (Chromium and Firefox) and its site storage, and a text file named token/secret/senha;
 * - every file of the key folders (`KEY_HOME_DIRS`: `~/.ssh`, `~/.aws`, gcloud, keyrings, the Windows credential stores…);
 * - `~/.claude.json` and the `settings*.json` of `~/.claude*` (they carry env tokens), `~/.docker/config.json`,
 *   `~/.config/gh/hosts.yml`;
 * - inside the app's folder (`userData`), everything but the owner's content (`USER_DATA_CONTENT_DIRS`): there live
 *   the config with keys, the accounts vault, the per-session MCP tokens, the hooks and the browser's cookies.
 */
export function secretUploadFile(realPath: string, context: UploadFolderContext): string | null {
  const target = normalize(realPath);
  const name = target.slice(target.lastIndexOf('/') + 1);
  const said = 'Esse arquivo guarda uma credencial ou chave e não é enviado.';
  if (SECRET_FILE.test(name) || BROWSER_SECRET_FILE.test(name) || NAMED_SECRET_FILE.test(name)) return said;
  if (target.split('/').slice(0, -1).some((part) => BROWSER_STORAGE_DIRS.includes(part))) return said;
  const home = normalize(context.home);
  if (KEY_HOME_DIRS.some((dir) => isInsideOrEqual(target, `${home}/${dir.toLowerCase()}`))) return said;
  if (target === `${home}/.claude.json` || target === `${home}/.docker/config.json` || target === `${home}/.config/gh/hosts.yml`) return said;
  const first = target.startsWith(`${home}/`) ? target.slice(home.length + 1).split('/')[0]! : '';
  if (first.startsWith('.claude') && /^settings.*\.json$/.test(name)) return said;
  const userData = normalize(context.userData);
  if (isInsideOrEqual(target, userData)) {
    const inside = target.slice(userData.length + 1).split('/');
    if (inside.length < 2 || !(USER_DATA_CONTENT_DIRS as readonly string[]).includes(inside[0]!)) {
      return 'Esse arquivo é da configuração do Donel Dev (config, cofre, tokens das sessões ou cookies) e não é enviado. Anexos do chat, downloads e áudios saem.';
    }
  }
  return null;
}

/** A folder an orchestrator liberated for the sessions of one board: who, and when. */
export interface UploadGrant {
  /** The board (project folder) whose sessions may send from `folder`. */
  readonly board: string;
  readonly folder: string;
  /** Who liberated it, as the owner reads it: "Líder único", or "Líder Dalton (place:…)". */
  readonly by: string;
  /** ISO date. */
  readonly at: string;
}

/** `grants` with `grant`: the same board and folder (compared like `withUploadFolder`) is updated, never duplicated. */
export function withUploadGrant(grants: readonly UploadGrant[], grant: UploadGrant): UploadGrant[] {
  const same = (item: UploadGrant): boolean => normalize(item.board) === normalize(grant.board) && normalize(item.folder) === normalize(grant.folder);
  return grants.some(same) ? grants.map((item) => (same(item) ? { ...item, by: grant.by, at: grant.at } : item)) : [...grants, grant];
}

/** `grants` without `folder`, on every board (the owner's "Remover" in Regras). */
export function withoutUploadGrantFolder(grants: readonly UploadGrant[], folder: string): UploadGrant[] {
  const key = normalize(folder);
  return grants.filter((grant) => normalize(grant.folder) !== key);
}

/**
 * The folders a session may send from: the owner's, the chat attachments, and the ones liberated for its board
 * (`'all'` = the Líder único, which stands over every board). Once each, in that order.
 */
export function uploadFoldersFor(input: {
  readonly owner: readonly string[];
  readonly grants: readonly UploadGrant[];
  readonly board: string | 'all' | null;
  readonly userData: string;
}): string[] {
  const board = input.board === null || input.board === 'all' ? input.board : normalize(input.board);
  const granted = input.grants.filter((grant) => board === 'all' || (board !== null && normalize(grant.board) === board)).map((grant) => grant.folder);
  return [...input.owner, chatAttachmentsDir(input.userData), ...granted].reduce<string[]>((list, folder) => withUploadFolder(list, folder), []);
}

/** What `sessao_quem_sou` says of the caller (the fields this rule reads). */
export interface UploadCaller {
  readonly liderUnico?: boolean;
  /** The Líder the owner put on the board (`isBoardOrchestrator`): the board says it, never the role alone. */
  readonly orquestrador?: boolean;
  readonly lugar?: string | null;
  readonly papel?: string;
  readonly papelNome?: string;
  readonly nome?: string;
  readonly pasta?: string;
}

export type UploadGrantAuthority =
  | { readonly ok: true; readonly leaderOfAll: true }
  | { readonly ok: true; readonly board: string; readonly by: string }
  | { readonly ok: false; readonly reason: string };

/**
 * May the caller liberate a folder (`navegador_liberar_pasta`): the Líder único on the board it names in `quadro`, the
 * orchestrator of a board (the Líder the owner put there) on its own board. Nobody else, whatever role a session got:
 * the agent that wants a folder asks the orchestrator of its board.
 */
export function uploadGrantAuthority(caller: UploadCaller, quadro: string | undefined): UploadGrantAuthority {
  if (caller.liderUnico === true) {
    return quadro ? { ok: true, leaderOfAll: true } : { ok: false, reason: 'Você é o Líder único e não tem quadro: diga em "quadro" para qual quadro a pasta fica liberada.' };
  }
  if (caller.orquestrador !== true) {
    return { ok: false, reason: 'Só o orquestrador do quadro (o Líder que o dono pôs nele) ou o Líder único libera pasta. Peça a ele, com o caminho da pasta, por sessao_enviar.' };
  }
  if (typeof caller.lugar !== 'string' || typeof caller.pasta !== 'string') return { ok: false, reason: 'Seu lugar ainda não está no quadro; espere o primeiro turno terminar.' };
  if (quadro) return { ok: false, reason: 'O orquestrador de um quadro libera só no próprio quadro (chame sem "quadro"). Para outro quadro, peça ao Líder único.' };
  const role = caller.papelNome ?? 'Líder';
  const name = caller.nome && caller.nome.trim().toLowerCase() !== role.toLowerCase() ? ` ${caller.nome}` : '';
  return { ok: true, board: caller.pasta, by: `${role}${name} (${caller.lugar})` };
}

/** The usual wide folders of a user, by name: under the home and under a OneDrive folder of the home. */
const WIDE_NAMES = ['desktop', 'área de trabalho', 'documents', 'documentos', 'downloads'];

/**
 * A folder the owner may authorize, but only after an explicit confirmation: Documentos, Área de Trabalho,
 * Downloads (the system's own `known` paths and the usual names, also inside OneDrive), a OneDrive root, or a
 * folder that holds one of them. Returns the warning to show; `null` = a narrow folder, one click is enough.
 * (The disk root and the whole home are refused outright by `refusedUploadFolder`.)
 */
export function wideUploadFolder(folder: string, context: UploadFolderContext & { readonly known?: readonly string[] }): string | null {
  const target = normalize(folder);
  const home = normalize(context.home);
  const first = target.startsWith(`${home}/`) ? target.slice(home.length + 1).split('/')[0]! : '';
  const oneDrive = first.startsWith('onedrive') ? `${home}/${first}` : null;
  const roots = oneDrive ? [home, oneDrive] : [home];
  const wide = [...(context.known ?? []).map(normalize), ...roots.flatMap((root) => WIDE_NAMES.map((name) => `${root}/${name}`))];
  if (target === oneDrive || wide.some((dir) => dir !== '' && isInsideOrEqual(dir, target))) {
    return 'Essa é uma pasta larga do seu usuário: liberando, o agente poderá enviar por páginas QUALQUER arquivo dela e das subpastas, em todas as sessões, até você remover em Regras. Prefira uma pasta só de envios.';
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
    return 'Esse arquivo está fora da pasta autorizada.';
  }
  if (parts.some((part) => part === '..')) return 'Esse arquivo está fora da pasta autorizada.';
  if (parts.some((part) => part.startsWith('.') && !SECRET_FILE.test(part))) return 'Arquivo ou pasta oculta não é enviado.';
  if (parts.some((part) => SECRET_FILE.test(part))) return 'Esse arquivo parece guardar uma credencial e não é enviado.';
  return null;
}
