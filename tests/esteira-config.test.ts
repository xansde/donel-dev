import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ESTEIRA_CONFIG_DIR_ENV_VAR,
  boardCredentialPath,
  createSystemEsteiraConfigIoDeps,
  esteiraConfigDir,
  readProjectBindingFromDisk,
  reposConfigPath,
  saveProjectBindingToDisk,
  trySaveProjectBindingToDisk,
  type EsteiraConfigIoDeps,
} from '../src/main/esteira-config';

// CA-23 (009-modo-dev-v3, lote 3) — TDD do encanamento de disco da
// engrenagem: resolução de path (com override de ambiente pro smoke),
// leitura/gravação atômica dos dois JSONs externos, e o "só reescreve o que
// mudou" que preserva byte a byte o resto do arquivo. `tests/projectBinding
// .test.ts` já cobre a lógica de merge em si — aqui é só o I/O por cima dela.

describe('esteiraConfigDir', () => {
  it('sem override de ambiente: usa ~/.claude/esteira-config do homedir injetado', () => {
    const dir = esteiraConfigDir({}, () => 'C:\\Users\\fake');
    expect(dir).toBe(join('C:\\Users\\fake', '.claude', 'esteira-config'));
  });

  it('com DONEL_ESTEIRA_CONFIG_DIR definido: usa o override, nunca toca o homedir real (isolamento do smoke)', () => {
    const dir = esteiraConfigDir({ [ESTEIRA_CONFIG_DIR_ENV_VAR]: 'C:\\tmp\\smoke-config' }, () => 'C:\\Users\\fake');
    expect(dir).toBe('C:\\tmp\\smoke-config');
  });

  it('override só espaços: ignora e cai no default (mesmo espírito de outros overrides do repo)', () => {
    const dir = esteiraConfigDir({ [ESTEIRA_CONFIG_DIR_ENV_VAR]: '   ' }, () => 'C:\\Users\\fake');
    expect(dir).toBe(join('C:\\Users\\fake', '.claude', 'esteira-config'));
  });
});

describe('boardCredentialPath / reposConfigPath', () => {
  it('montam os nomes de arquivo fixos dentro do diretório dado', () => {
    expect(boardCredentialPath('C:\\cfg')).toBe(join('C:\\cfg', 'donel-board-credential.json'));
    expect(reposConfigPath('C:\\cfg')).toBe(join('C:\\cfg', 'repos.json'));
  });
});

// ---------------------------------------------------------------------------
// I/O mockado (fs fake) — mesmo padrão de tests/config-store.test.ts
// (`writeAppConfig` describe block): sem tocar disco real.
// ---------------------------------------------------------------------------

function makeMockIo(files: Record<string, string> = {}): { io: EsteiraConfigIoDeps; files: Record<string, string>; writes: string[] } {
  const store: Record<string, string> = { ...files };
  const writes: string[] = [];
  const io: EsteiraConfigIoDeps = {
    existsSync: vi.fn((path: string) => path in store || path === 'C:\\cfg'),
    readFileText: vi.fn((path: string) => (path in store ? store[path] : null)),
    writeFileText: vi.fn((path: string, content: string) => {
      store[path] = content;
      writes.push(path);
    }),
    renameFile: vi.fn((fromPath: string, toPath: string) => {
      store[toPath] = store[fromPath];
      delete store[fromPath];
    }),
    mkdirSync: vi.fn(),
    unlinkFile: vi.fn((path: string) => {
      delete store[path];
    }),
  };
  return { io, files: store, writes };
}

describe('readProjectBindingFromDisk (I/O mockado)', () => {
  it('os dois arquivos ausentes: DTO vazio, nunca lança', () => {
    const { io } = makeMockIo();
    expect(readProjectBindingFromDisk('C:\\cfg', 'spotsys', io)).toEqual({ workspaceId: '', teamId: '', github: '', githubExtra: [], hasOwnBoard: false });
  });

  it('lê os dois arquivos reais do diretório e combina no DTO — board do PROJETO tem prioridade sobre o global', () => {
    const { io } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({ workspaceId: 'ws-global', teamId: 'team-global', token: 'sk_segredo' }),
      [reposConfigPath('C:\\cfg')]: JSON.stringify({
        repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys', board: { workspaceId: 'ws-1', teamId: 'team-1' } } },
      }),
    });
    expect(readProjectBindingFromDisk('C:\\cfg', 'spotsys', io)).toEqual({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      github: 'seazone-tech/spotsys',
      githubExtra: [],
      hasOwnBoard: true,
    });
  });

  it('projeto sem board próprio cai pro global da credencial', () => {
    const { io } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({ workspaceId: 'ws-global', teamId: 'team-global' }),
      [reposConfigPath('C:\\cfg')]: JSON.stringify({ repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys' } } }),
    });
    const result = readProjectBindingFromDisk('C:\\cfg', 'spotsys', io);
    expect(result.workspaceId).toBe('ws-global');
    expect(result.teamId).toBe('team-global');
    expect(result.hasOwnBoard).toBe(false);
  });
});

describe('saveProjectBindingToDisk (I/O mockado)', () => {
  it('grava repo + board NUM SÓ repos.json quando nenhum existia — nunca toca donel-board-credential.json', () => {
    const { io, files, writes } = makeMockIo();
    const result = saveProjectBindingToDisk(
      'C:\\cfg',
      'spotsys',
      'C:\\Users\\x\\seazone\\spotsys',
      { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: ['seazone-tech/spotsys-infra'] },
      io,
    );
    expect(result).toEqual({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      github: 'seazone-tech/spotsys',
      githubExtra: ['seazone-tech/spotsys-infra'],
      hasOwnBoard: true,
    });

    const repos = JSON.parse(files[reposConfigPath('C:\\cfg')] as string);
    expect(repos).toEqual({
      repos: {
        spotsys: {
          path: 'C:\\Users\\x\\seazone\\spotsys',
          github: 'seazone-tech/spotsys',
          github_extra: ['seazone-tech/spotsys-infra'],
          board: { workspaceId: 'ws-1', teamId: 'team-1' },
        },
      },
    });
    expect(files[boardCredentialPath('C:\\cfg')]).toBeUndefined();
    expect(writes.some((path) => path.startsWith(boardCredentialPath('C:\\cfg')))).toBe(false);
  });

  it('PRESERVA token/baseUrl da credencial global (só lida, nunca escrita) e demais repos', () => {
    const { io, files } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({
        baseUrl: 'https://taskdex.seazone.dev/api/mcp',
        token: 'sk_37bdc63a7b22c5b2439cf1f9e4f5b502',
        workspaceId: 'ws-global',
        teamId: 'team-global',
      }),
      [reposConfigPath('C:\\cfg')]: JSON.stringify({
        default_repo: 'C:\\spotsys',
        repos: { spotsys: { path: 'C:\\spotsys', integration_branch: 'staging' }, dalton: 'C:\\dalton' },
      }),
    });

    saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: 'ws-new', teamId: 'team-new', github: 'seazone-tech/spotsys', githubExtra: [] }, io);

    // credencial global intocada — só lida como fallback (o board deste projeto já venceu por ser próprio).
    const board = JSON.parse(files[boardCredentialPath('C:\\cfg')] as string);
    expect(board).toEqual({
      baseUrl: 'https://taskdex.seazone.dev/api/mcp',
      token: 'sk_37bdc63a7b22c5b2439cf1f9e4f5b502',
      workspaceId: 'ws-global',
      teamId: 'team-global',
    });

    const repos = JSON.parse(files[reposConfigPath('C:\\cfg')] as string);
    expect(repos).toEqual({
      default_repo: 'C:\\spotsys',
      repos: {
        spotsys: { path: 'C:\\spotsys', integration_branch: 'staging', github: 'seazone-tech/spotsys', board: { workspaceId: 'ws-new', teamId: 'team-new' } },
        dalton: 'C:\\dalton',
      },
    });
  });

  it('nada muda: NÃO reescreve repos.json (preservação byte a byte real)', () => {
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys', board: { workspaceId: 'ws-1', teamId: 'team-1' } } } });
    const { io, writes } = makeMockIo({
      [reposConfigPath('C:\\cfg')]: reposText,
    });

    const result = saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [] }, io);

    expect(result).toEqual({ workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [], hasOwnBoard: true });
    expect(writes).toEqual([]);
  });

  it('campos vazios limpam board/github/github_extra, preservando path e demais campos', () => {
    const { io, files } = makeMockIo({
      [reposConfigPath('C:\\cfg')]: JSON.stringify({
        repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys', github_extra: ['org/extra'], board: { workspaceId: 'ws-1', teamId: 'team-1' }, help_channel: '#h' } },
      }),
    });

    const result = saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: '', teamId: '', github: '', githubExtra: [] }, io);

    expect(result).toEqual({ workspaceId: '', teamId: '', github: '', githubExtra: [], hasOwnBoard: false });
    expect(JSON.parse(files[reposConfigPath('C:\\cfg')] as string)).toEqual({ repos: { spotsys: { path: 'C:\\spotsys', help_channel: '#h' } } });
  });

  it('espaços em volta dos valores são trimados antes de gravar/comparar', () => {
    const { io, files } = makeMockIo();
    saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: '  ws-1  ', teamId: '  team-1 ', github: ' seazone-tech/spotsys ', githubExtra: ['  org/extra  '] }, io);
    const repos = JSON.parse(files[reposConfigPath('C:\\cfg')] as string);
    expect(repos.repos.spotsys.board).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });
    expect(repos.repos.spotsys.github_extra).toEqual(['org/extra']);
  });
});

// FIX (#33) — `projectBinding.save` era fire-and-forget no renderer e o
// handler IPC devolvia o DTO "vazio" tanto pra payload inválido quanto pra
// falha real de escrita, indistinguível de uma limpeza legítima de binding.
// `trySaveProjectBindingToDisk` é o wrapper que o handler passa a chamar —
// TDD aqui prova que uma falha de I/O (ex. permissão negada) vira
// `{ ok: false, reason: 'write-failed' }` em vez de propagar a exceção
// (que o `ipcMain.handle` até rejeitaria, mas o renderer nunca tratava — daí
// a falha silenciosa) ou devolver um DTO vazio ambíguo.
describe('trySaveProjectBindingToDisk (I/O mockado)', () => {
  it('sucesso: devolve { ok: true, binding } com o DTO persistido', () => {
    const { io } = makeMockIo();
    const result = trySaveProjectBindingToDisk(
      'C:\\cfg',
      'spotsys',
      'C:\\Users\\x\\seazone\\spotsys',
      { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [] },
      io,
    );
    expect(result).toEqual({
      ok: true,
      binding: { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [], hasOwnBoard: true },
    });
  });

  it('escrita lança (ex.: permissão negada): devolve { ok: false, reason: "write-failed" }, nunca lança', () => {
    const { io } = makeMockIo();
    io.writeFileText = vi.fn(() => {
      throw new Error('EPERM');
    });
    const result = trySaveProjectBindingToDisk(
      'C:\\cfg',
      'spotsys',
      'C:\\spotsys',
      { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [] },
      io,
    );
    expect(result).toEqual({ ok: false, reason: 'write-failed' });
  });

  it('rename lança depois do write (falha no meio da escrita atômica): também vira write-failed', () => {
    const { io } = makeMockIo();
    io.renameFile = vi.fn(() => {
      throw new Error('EBUSY');
    });
    const result = trySaveProjectBindingToDisk(
      'C:\\cfg',
      'spotsys',
      'C:\\spotsys',
      { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [] },
      io,
    );
    expect(result).toEqual({ ok: false, reason: 'write-failed' });
  });
});

// ---------------------------------------------------------------------------
// Integração real (pasta temporária) — prova que createSystemEsteiraConfigIoDeps
// escreve de fato em disco, com escrita atômica (mesmo espírito do bloco de
// integração de tests/config-store.test.ts).
// ---------------------------------------------------------------------------

describe('integração — I/O real em pasta temporária', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-esteira-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('grava e relê o repos.json do disco real', () => {
    const io = createSystemEsteiraConfigIoDeps();
    saveProjectBindingToDisk(dir, 'spotsys', join(dir, 'spotsys-checkout'), { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [] }, io);

    const reposOnDisk = JSON.parse(readFileSync(reposConfigPath(dir), 'utf8'));
    expect(reposOnDisk.repos.spotsys.github).toBe('seazone-tech/spotsys');
    expect(reposOnDisk.repos.spotsys.board).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });

    const reread = readProjectBindingFromDisk(dir, 'spotsys', io);
    expect(reread).toEqual({ workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys', githubExtra: [], hasOwnBoard: true });
  });

  it('cria o diretório de config se ele ainda não existir', () => {
    const nestedDir = join(dir, 'esteira-config-nao-existe-ainda');
    const io = createSystemEsteiraConfigIoDeps();
    saveProjectBindingToDisk(nestedDir, 'spotsys', join(dir, 'spotsys-checkout'), { workspaceId: 'ws-1', teamId: 'team-1', github: '', githubExtra: [] }, io);
    mkdirSync(nestedDir, { recursive: true }); // no-op se já existir — só documenta a expectativa
    expect(readFileSync(reposConfigPath(nestedDir), 'utf8')).toContain('ws-1');
  });

  it('PRESERVA um arquivo repos.json existente escrito fora do app (edição manual)', () => {
    writeFileSync(
      reposConfigPath(dir),
      JSON.stringify({
        default_repo: 'C:\\spotsys',
        repos: { spotsys: { path: 'C:\\spotsys', integration_branch: 'staging', help_channel: '#spotsys-hub' } },
        round_limit_by_board: { SPOTSYSMAR: 3 },
      }),
      'utf8',
    );

    const io = createSystemEsteiraConfigIoDeps();
    saveProjectBindingToDisk(dir, 'spotsys', 'C:\\spotsys', { workspaceId: '', teamId: '', github: 'seazone-tech/spotsys', githubExtra: [] }, io);

    const onDisk = JSON.parse(readFileSync(reposConfigPath(dir), 'utf8'));
    expect(onDisk).toEqual({
      default_repo: 'C:\\spotsys',
      repos: { spotsys: { path: 'C:\\spotsys', integration_branch: 'staging', help_channel: '#spotsys-hub', github: 'seazone-tech/spotsys' } },
      round_limit_by_board: { SPOTSYSMAR: 3 },
    });
  });
});
