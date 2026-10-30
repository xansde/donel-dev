import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BRANCH_CACHE_TTL_MS,
  createWorkspaceTools,
  isOpenableDirectory,
  parseBranchOutput,
  resolveEditor,
  type ResolveEditorDeps,
  type WorkspaceToolsDeps,
} from '../src/main/workspace-tools';

const VSCODE_DIR = 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code';
const VSCODE_SHIM = `${VSCODE_DIR}\\bin\\code.cmd`;
const VSCODE_EXE = join(VSCODE_DIR, 'Code.exe');
const CURSOR_DIR = 'C:\\Users\\u\\AppData\\Local\\Programs\\cursor';
const CURSOR_SHIM = `${CURSOR_DIR}\\resources\\app\\bin\\cursor.cmd`;
const CURSOR_EXE = join(CURSOR_DIR, 'Cursor.exe');

function resolveDeps(path: Record<string, readonly string[]>, files: readonly string[], platform: NodeJS.Platform = 'win32'): ResolveEditorDeps {
  return {
    which: async (command) => path[command] ?? [],
    existsSync: (file) => files.includes(file),
    platform,
  };
}

describe('resolveEditor', () => {
  it('VS Code no PATH: o shim code.cmd vira o Code.exe da instalação (spawn sem shell)', async () => {
    expect(await resolveEditor(resolveDeps({ code: [VSCODE_SHIM] }, [VSCODE_EXE]))).toEqual({ name: 'VS Code', executable: VSCODE_EXE });
  });

  it('prefere VS Code a Cursor quando os dois existem', async () => {
    const found = await resolveEditor(resolveDeps({ code: [VSCODE_SHIM], cursor: [CURSOR_SHIM] }, [VSCODE_EXE, CURSOR_EXE]));
    expect(found?.name).toBe('VS Code');
  });

  it('sem VS Code, cai no Cursor (shim em resources\\app\\bin → Cursor.exe)', async () => {
    expect(await resolveEditor(resolveDeps({ cursor: [CURSOR_SHIM] }, [CURSOR_EXE]))).toEqual({ name: 'Cursor', executable: CURSOR_EXE });
  });

  it('um .exe direto no PATH é usado como está', async () => {
    expect(await resolveEditor(resolveDeps({ code: ['C:\\tools\\code.exe'] }, []))).toEqual({ name: 'VS Code', executable: 'C:\\tools\\code.exe' });
  });

  it('shim sem o executável ao lado não conta (não embrulha em cmd.exe)', async () => {
    expect(await resolveEditor(resolveDeps({ code: [VSCODE_SHIM] }, []))).toBeNull();
  });

  it('nenhum editor no PATH → null', async () => {
    expect(await resolveEditor(resolveDeps({}, []))).toBeNull();
  });

  it('fora do Windows, o primeiro match do PATH roda direto', async () => {
    expect(await resolveEditor(resolveDeps({ code: ['/usr/bin/code'] }, [], 'linux'))).toEqual({ name: 'VS Code', executable: '/usr/bin/code' });
  });
});

describe('isOpenableDirectory', () => {
  const isDir = (path: string): boolean => path === 'C:\\repo';
  it('aceita só pasta absoluta existente', () => {
    expect(isOpenableDirectory('C:\\repo', isDir)).toBe(true);
    expect(isOpenableDirectory('C:\\nao-existe', isDir)).toBe(false);
    expect(isOpenableDirectory('repo', () => true)).toBe(false);
    expect(isOpenableDirectory('--install-extension=x', () => true)).toBe(false);
    expect(isOpenableDirectory('', () => true)).toBe(false);
    expect(isOpenableDirectory(42, () => true)).toBe(false);
  });
});

describe('parseBranchOutput', () => {
  it('devolve o nome da branch sem quebra de linha', () => {
    expect(parseBranchOutput('feature/navegador-e-editor\n')).toBe('feature/navegador-e-editor');
  });
  it('HEAD destacado e saída vazia viram null', () => {
    expect(parseBranchOutput('HEAD\n')).toBeNull();
    expect(parseBranchOutput('')).toBeNull();
  });
});

function toolsDeps(overrides: Partial<WorkspaceToolsDeps> = {}): WorkspaceToolsDeps {
  return {
    ...resolveDeps({ code: [VSCODE_SHIM] }, [VSCODE_EXE]),
    statDir: (path) => path === 'C:\\repo' || path === 'C:\\repo\\.claude\\worktrees\\x',
    gitHead: async () => 'staging',
    spawnDetached: async () => undefined,
    now: () => 0,
    ...overrides,
  };
}

describe('createWorkspaceTools', () => {
  it('openInEditor spawna o executável com a pasta como argumento único (array, sem shell)', async () => {
    const spawnDetached = vi.fn(async () => undefined);
    const tools = createWorkspaceTools(toolsDeps({ spawnDetached }));
    expect(await tools.openInEditor('C:\\repo\\.claude\\worktrees\\x')).toEqual({ ok: true, editor: 'VS Code' });
    expect(spawnDetached).toHaveBeenCalledWith(VSCODE_EXE, ['C:\\repo\\.claude\\worktrees\\x']);
  });

  it('openInEditor recusa caminho inválido sem spawnar nada', async () => {
    const spawnDetached = vi.fn(async () => undefined);
    const tools = createWorkspaceTools(toolsDeps({ spawnDetached }));
    expect(await tools.openInEditor('-r')).toEqual({ ok: false, reason: 'invalid-path' });
    expect(await tools.openInEditor('C:\\outro')).toEqual({ ok: false, reason: 'invalid-path' });
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('sem editor: editorStatus indisponível e openInEditor devolve no-editor', async () => {
    const tools = createWorkspaceTools(toolsDeps({ which: async () => [] }));
    expect(await tools.editorStatus()).toEqual({ available: false });
    expect(await tools.openInEditor('C:\\repo')).toEqual({ ok: false, reason: 'no-editor' });
  });

  it('"nenhum editor" é reavaliado no pedido seguinte (instalou com o app aberto)', async () => {
    let installed = false;
    const tools = createWorkspaceTools(toolsDeps({ which: async (command) => (installed && command === 'code' ? [VSCODE_SHIM] : []) }));
    expect(await tools.editorStatus()).toEqual({ available: false });
    installed = true;
    expect(await tools.editorStatus()).toEqual({ available: true, name: 'VS Code' });
  });

  it('falha no spawn devolve spawn-failed e esquece o editor achado', async () => {
    const which = vi.fn(async (command: string) => (command === 'code' ? [VSCODE_SHIM] : []));
    const tools = createWorkspaceTools(toolsDeps({ which, spawnDetached: async () => Promise.reject(new Error('ENOENT')) }));
    expect(await tools.openInEditor('C:\\repo')).toEqual({ ok: false, reason: 'spawn-failed' });
    const callsBefore = which.mock.calls.length;
    await tools.editorStatus();
    expect(which.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('gitBranch usa cache curto por pasta e relê depois do TTL', async () => {
    let now = 0;
    const gitHead = vi.fn(async () => 'staging');
    const tools = createWorkspaceTools(toolsDeps({ gitHead, now: () => now }));
    expect(await tools.gitBranch('C:\\repo')).toEqual({ branch: 'staging' });
    now = BRANCH_CACHE_TTL_MS - 1;
    await tools.gitBranch('C:\\repo');
    expect(gitHead).toHaveBeenCalledTimes(1);
    now = BRANCH_CACHE_TTL_MS;
    await tools.gitBranch('C:\\repo');
    expect(gitHead).toHaveBeenCalledTimes(2);
  });

  it('gitBranch de caminho inválido devolve null sem chamar o git', async () => {
    const gitHead = vi.fn(async () => 'x');
    const tools = createWorkspaceTools(toolsDeps({ gitHead }));
    expect(await tools.gitBranch('relativo')).toEqual({ branch: null });
    expect(gitHead).not.toHaveBeenCalled();
  });
});
