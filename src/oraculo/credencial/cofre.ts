// t-c441e144 (docs/adr/0010) — the vault side of the phone's credential box: one `ssh <host> python3 -I -c <script>`
// to the Homologações, where the Bitwarden session lives (`/root/.bw_session`). The script is written here and goes in
// argv (it is not a secret), with the item's name, user, url and note; the password goes ONLY by the child's stdin.
//
// Create only, never edit: an item with the exact name already there answers `ja-existe` and the vault is not touched
// (`bw list --search` is approximate, so the script filters the exact name). Nothing from `bw` comes back but a code:
// its stderr and stdout may carry the item, the password or its base64, so the script prints only
// `{"id","sha256_curto"}` or `{"erro"[,"motivo"]}`, and this side reads only an id shaped as a uuid and 10 hex.

import { spawn } from 'node:child_process';

export const DEFAULT_SSH_HOST = 'homologacoes-2222';
export const COFRE_TIMEOUT_MS = 30_000;

/** What came back from the child: its exit code and stdout (never stderr: it is not read). */
export interface SshResult {
  readonly code: number | null;
  readonly stdout: string;
  /** The child was killed at the timeout, or never started. */
  readonly falhou?: 'tempo' | 'inicio';
}

/** Runs `argv[0]` with `argv.slice(1)`, writes `stdin` and closes it; the default spawns `ssh`. */
export type SshRunner = (argv: readonly string[], stdin: Buffer, timeoutMs: number) => Promise<SshResult>;

export type CofreResult =
  | { readonly ok: true; readonly itemId: string; readonly hashCurto: string }
  | { readonly ok: false; readonly erro: 'ja-existe' }
  | { readonly ok: false; readonly erro: 'cofre-indisponivel'; readonly motivo: string };

/**
 * The script the Homologações runs (python3 -I). argv: nome, usuario, url, nota; stdin: the password. One JSON line on
 * stdout, nothing else; `os._exit` so no traceback is ever printed. `DONEL_BW_SESSION_FILE` only for the tests.
 */
export const COFRE_SCRIPT = `import base64, hashlib, json, os, subprocess, sys

def sair(**campos):
    sys.stdout.write(json.dumps(campos) + "\\n")
    sys.stdout.flush()
    os._exit(0)

def principal():
    nome, usuario, url, nota = sys.argv[1:5]
    segredo = sys.stdin.buffer.read().decode("utf-8")
    if not segredo:
        sair(erro="cofre-indisponivel", motivo="vazio")
    sessao = None
    try:
        with open(os.environ.get("DONEL_BW_SESSION_FILE") or "/root/.bw_session") as arquivo:
            for linha in arquivo:
                if linha.startswith("BW_SESSION="):
                    sessao = linha.split("=", 1)[1].strip()
    except OSError:
        sessao = None
    if not sessao:
        sair(erro="cofre-indisponivel", motivo="sessao")
    env = dict(os.environ)
    env["BW_SESSION"] = sessao

    def bw(*args, entrada=None):
        try:
            return subprocess.run(["bw", *args, "--nointeraction"], env=env, input=entrada, capture_output=True, text=True, timeout=20)
        except Exception:
            return None

    r = bw("sync")
    if r is None or r.returncode != 0:
        sair(erro="cofre-indisponivel", motivo="sync")
    r = bw("list", "items", "--search=" + nome)
    if r is None or r.returncode != 0:
        sair(erro="cofre-indisponivel", motivo="lista")
    try:
        itens = json.loads(r.stdout or "[]")
    except ValueError:
        sair(erro="cofre-indisponivel", motivo="lista")
    if not isinstance(itens, list):
        sair(erro="cofre-indisponivel", motivo="lista")
    if any(isinstance(i, dict) and i.get("name") == nome for i in itens):
        sair(erro="ja-existe")
    r = bw("get", "template", "item")
    try:
        item = json.loads(r.stdout) if r is not None and r.returncode == 0 else None
    except ValueError:
        item = None
    if not isinstance(item, dict):
        sair(erro="cofre-indisponivel", motivo="modelo")
    item.update({"type": 1, "name": nome, "notes": nota})
    item["login"] = {"username": usuario or None, "password": segredo, "uris": [{"match": None, "uri": url}] if url else [], "totp": None}
    codificado = base64.b64encode(json.dumps(item).encode("utf-8")).decode("ascii")
    item = None
    r = bw("create", "item", entrada=codificado)
    codificado = None
    if r is None or r.returncode != 0:
        sair(erro="cofre-indisponivel", motivo="criar")
    try:
        item_id = json.loads(r.stdout)["id"]
    except Exception:
        sair(erro="cofre-indisponivel", motivo="resposta")
    if not isinstance(item_id, str):
        sair(erro="cofre-indisponivel", motivo="resposta")
    sair(id=item_id, sha256_curto=hashlib.sha256(segredo.encode("utf-8")).hexdigest()[:10])

try:
    principal()
except BaseException:
    sair(erro="cofre-indisponivel", motivo="excecao")
`;

/** A POSIX shell word: ssh joins its argv into one command line for the remote shell. */
export const shellWord = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const HOST = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,252}$/;

/** `DONEL_CREDENCIAL_SSH`, else the Homologações; anything that could read as an ssh option is refused. */
export function sshHostOf(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const host = env.DONEL_CREDENCIAL_SSH?.trim();
  return host && HOST.test(host) ? host : DEFAULT_SSH_HOST;
}

/** The child's argv: nothing secret in it (the password is not an argument). */
export function cofreArgv(host: string, item: { readonly nome: string; readonly usuario: string | null; readonly url: string | null; readonly nota: string }): string[] {
  const remote = ['python3', '-I', '-c', shellWord(COFRE_SCRIPT), shellWord(item.nome), shellWord(item.usuario ?? ''), shellWord(item.url ?? ''), shellWord(item.nota)].join(' ');
  return ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', host, remote];
}

/** The default runner: `ssh`, stdout read, stderr dropped unread, killed at the timeout. */
export const spawnSsh: SshRunner = (argv, stdin, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (result: SshResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ code: null, stdout: '', falhou: 'tempo' });
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 4096) stdout += chunk.toString('utf8');
    });
    child.once('error', () => done({ code: null, stdout: '', falhou: 'inicio' }));
    child.once('close', (code) => done({ code, stdout }));
    child.stdin.once('error', () => undefined);
    child.stdin.end(stdin);
  });

const BW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_CURTO = /^[0-9a-f]{10}$/;
const MOTIVOS: ReadonlySet<string> = new Set(['vazio', 'sessao', 'sync', 'lista', 'modelo', 'criar', 'resposta', 'excecao']);

/** Only a uuid id and 10 hex pass, or a known code: nothing the child printed is ever handed on as text. */
export function readCofreAnswer(result: SshResult): CofreResult {
  if (result.falhou) return { ok: false, erro: 'cofre-indisponivel', motivo: result.falhou === 'tempo' ? 'tempo' : 'ssh' };
  const line = result.stdout.trim().split('\n').pop() ?? '';
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(line) as unknown;
    parsed = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed.id === 'string' && BW_ID.test(parsed.id) && typeof parsed.sha256_curto === 'string' && HASH_CURTO.test(parsed.sha256_curto) && result.code === 0) {
    return { ok: true, itemId: parsed.id, hashCurto: parsed.sha256_curto };
  }
  if (parsed?.erro === 'ja-existe' && result.code === 0) return { ok: false, erro: 'ja-existe' };
  const motivo = typeof parsed?.motivo === 'string' && MOTIVOS.has(parsed.motivo) ? parsed.motivo : result.code === 255 ? 'ssh' : `saida-${result.code ?? 'nula'}`;
  return { ok: false, erro: 'cofre-indisponivel', motivo };
}

/** One create in the vault: the password into the child's stdin only, its buffer zeroed once written (best effort). */
export async function criarNoCofre(
  item: { readonly nome: string; readonly usuario: string | null; readonly url: string | null; readonly nota: string },
  senha: Buffer,
  options: { readonly run?: SshRunner; readonly host?: string; readonly timeoutMs?: number } = {},
): Promise<CofreResult> {
  const run = options.run ?? spawnSsh;
  try {
    const result = await run(cofreArgv(options.host ?? sshHostOf(), item), senha, options.timeoutMs ?? COFRE_TIMEOUT_MS);
    return readCofreAnswer(result);
  } catch {
    return { ok: false, erro: 'cofre-indisponivel', motivo: 'ssh' };
  } finally {
    senha.fill(0);
  }
}
