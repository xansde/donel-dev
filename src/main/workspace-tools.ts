import { execFile, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { EditorStatus, GitBranchResult, OpenInEditorResult } from '../shared/workspace';

// "Abrir no editor" + branch atual por projeto/sessão (sidebar).
//
// Tudo aqui spawna SEM shell e com argumentos em array — o caminho da pasta
// nunca é concatenado numa string de comando. Por isso o shim `code.cmd` /
// `cursor.cmd` que o instalador põe no PATH não é executado direto (o Node
// recusa `.cmd` sem shell, e embrulhar em `cmd.exe /c` reabriria a
// interpretação de `%`/`&` no caminho): o shim é traduzido para o executável
// GUI que mora ao lado dele na instalação padrão, que aceita a pasta como
// argumento e abre a janela.

interface EditorCandidate {
  readonly command: string;
  readonly name: string;
  /** Do shim no PATH (`.../bin/code.cmd`) para o executável GUI da instalação. */
  readonly exeFromShim: (shimPath: string) => string;
}

/** Ordem de preferência: VS Code, depois Cursor. */
const EDITOR_CANDIDATES: readonly EditorCandidate[] = [
  // VS Code: <instalação>\bin\code.cmd → <instalação>\Code.exe
  { command: 'code', name: 'VS Code', exeFromShim: (shim) => join(dirname(shim), '..', 'Code.exe') },
  // Cursor: <instalação>\resources\app\bin\cursor.cmd → <instalação>\Cursor.exe
  { command: 'cursor', name: 'Cursor', exeFromShim: (shim) => join(dirname(shim), '..', '..', '..', 'Cursor.exe') },
];

export interface ResolveEditorDeps {
  /** Todos os matches do PATH para o comando, na ordem do `where.exe`/`which`; [] se não achou. */
  readonly which: (command: string) => Promise<readonly string[]>;
  readonly existsSync: (path: string) => boolean;
  readonly platform: NodeJS.Platform;
}

export interface ResolvedEditor {
  readonly name: string;
  /** Executável spawnado direto (sem shell). */
  readonly executable: string;
}

function isScriptShim(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}

function executableFor(candidate: EditorCandidate, matches: readonly string[], deps: ResolveEditorDeps): string | null {
  if (matches.length === 0) return null;
  if (deps.platform !== 'win32') return matches[0];
  const exe = matches.find((match) => match.toLowerCase().endsWith('.exe'));
  if (exe) return exe;
  for (const match of matches) {
    if (!isScriptShim(match)) continue;
    const gui = candidate.exeFromShim(match);
    if (deps.existsSync(gui)) return gui;
  }
  return null;
}

/** `code` → `cursor` → nenhum. Nunca lança. */
export async function resolveEditor(deps: ResolveEditorDeps): Promise<ResolvedEditor | null> {
  for (const candidate of EDITOR_CANDIDATES) {
    const executable = executableFor(candidate, await deps.which(candidate.command), deps);
    if (executable) return { name: candidate.name, executable };
  }
  return null;
}

/** Só pasta absoluta existente: também impede um caminho começando por `-` de virar flag do editor. */
export function isOpenableDirectory(path: unknown, statDir: (path: string) => boolean): path is string {
  return typeof path === 'string' && path.length > 0 && isAbsolute(path) && statDir(path);
}

/** Saída de `git rev-parse --abbrev-ref HEAD` → nome exibível; HEAD destacado e saída vazia viram `null`. */
export function parseBranchOutput(stdout: string): string | null {
  const branch = stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (branch === '' || branch === 'HEAD') return null;
  return branch;
}

export interface WorkspaceToolsDeps extends ResolveEditorDeps {
  readonly statDir: (path: string) => boolean;
  /** `git rev-parse --abbrev-ref HEAD` em `cwd`; `null` quando não é repositório ou o git falhou. */
  readonly gitHead: (cwd: string) => Promise<string | null>;
  readonly spawnDetached: (executable: string, args: readonly string[]) => Promise<void>;
  readonly now: () => number;
}

/** Cache curto: a sidebar pede a branch de cada linha, e a resposta muda raramente. */
export const BRANCH_CACHE_TTL_MS = 15_000;

export interface WorkspaceTools {
  editorStatus(): Promise<EditorStatus>;
  openInEditor(path: unknown): Promise<OpenInEditorResult>;
  gitBranch(path: unknown): Promise<GitBranchResult>;
}

export function createWorkspaceTools(deps: WorkspaceToolsDeps): WorkspaceTools {
  // Achado positivo fica para a vida do app; "nenhum editor" é reavaliado a
  // cada pedido, para quem instala o VS Code com o app aberto.
  let editor: ResolvedEditor | null = null;
  const branchCache = new Map<string, { readonly at: number; readonly branch: string | null }>();

  const currentEditor = async (): Promise<ResolvedEditor | null> => {
    if (editor === null) editor = await resolveEditor(deps);
    return editor;
  };

  return {
    async editorStatus() {
      const found = await currentEditor();
      return found ? { available: true, name: found.name } : { available: false };
    },

    async openInEditor(path) {
      if (!isOpenableDirectory(path, deps.statDir)) return { ok: false, reason: 'invalid-path' };
      const found = await currentEditor();
      if (!found) return { ok: false, reason: 'no-editor' };
      try {
        await deps.spawnDetached(found.executable, [path]);
        return { ok: true, editor: found.name };
      } catch {
        // O executável sumiu (desinstalado/atualizado): esquece e tenta achar de novo no próximo pedido.
        editor = null;
        return { ok: false, reason: 'spawn-failed' };
      }
    },

    async gitBranch(path) {
      if (!isOpenableDirectory(path, deps.statDir)) return { branch: null };
      const cached = branchCache.get(path);
      if (cached && deps.now() - cached.at < BRANCH_CACHE_TTL_MS) return { branch: cached.branch };
      const branch = await deps.gitHead(path);
      branchCache.set(path, { at: deps.now(), branch });
      return { branch };
    },
  };
}

// ------------------------------------------------------------ dependências reais

function whichAsync(command: string, platform: NodeJS.Platform): Promise<readonly string[]> {
  const finder = platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [command], { windowsHide: true, timeout: 5_000, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(
        String(stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    });
  });
}

function gitHeadReal(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, windowsHide: true, timeout: 5_000, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => resolve(error ? null : parseBranchOutput(String(stdout))),
    );
  });
}

function spawnDetachedReal(executable: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function createSystemWorkspaceToolsDeps(): WorkspaceToolsDeps {
  const platform = process.platform;
  return {
    which: (command) => whichAsync(command, platform),
    existsSync,
    platform,
    statDir: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    gitHead: gitHeadReal,
    spawnDetached: spawnDetachedReal,
    now: () => Date.now(),
  };
}
