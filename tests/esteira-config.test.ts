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
    expect(readProjectBindingFromDisk('C:\\cfg', 'spotsys', io)).toEqual({ workspaceId: '', teamId: '', github: '' });
  });

  it('lê os dois arquivos reais do diretório e combina no DTO', () => {
    const { io } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({ workspaceId: 'ws-1', teamId: 'team-1', token: 'sk_segredo' }),
      [reposConfigPath('C:\\cfg')]: JSON.stringify({ repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys' } } }),
    });
    expect(readProjectBindingFromDisk('C:\\cfg', 'spotsys', io)).toEqual({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      github: 'seazone-tech/spotsys',
    });
  });
});

describe('saveProjectBindingToDisk (I/O mockado)', () => {
  it('grava os dois arquivos do zero quando nenhum existia', () => {
    const { io, files } = makeMockIo();
    const result = saveProjectBindingToDisk(
      'C:\\cfg',
      'spotsys',
      'C:\\Users\\x\\seazone\\spotsys',
      { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' },
      io,
    );
    expect(result).toEqual({ workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' });

    const board = JSON.parse(files[boardCredentialPath('C:\\cfg')] as string);
    expect(board).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });

    const repos = JSON.parse(files[reposConfigPath('C:\\cfg')] as string);
    expect(repos).toEqual({ repos: { spotsys: { path: 'C:\\Users\\x\\seazone\\spotsys', github: 'seazone-tech/spotsys' } } });
  });

  it('PRESERVA token/baseUrl e demais repos ao gravar por cima de arquivos existentes', () => {
    const { io, files } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({
        baseUrl: 'https://taskdex.seazone.dev/api/mcp',
        token: 'sk_37bdc63a7b22c5b2439cf1f9e4f5b502',
        workspaceId: 'ws-old',
        teamId: 'team-old',
      }),
      [reposConfigPath('C:\\cfg')]: JSON.stringify({
        default_repo: 'C:\\spotsys',
        repos: { spotsys: { path: 'C:\\spotsys', integration_branch: 'staging' }, dalton: 'C:\\dalton' },
      }),
    });

    saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: 'ws-new', teamId: 'team-new', github: 'seazone-tech/spotsys' }, io);

    const board = JSON.parse(files[boardCredentialPath('C:\\cfg')] as string);
    expect(board).toEqual({
      baseUrl: 'https://taskdex.seazone.dev/api/mcp',
      token: 'sk_37bdc63a7b22c5b2439cf1f9e4f5b502',
      workspaceId: 'ws-new',
      teamId: 'team-new',
    });

    const repos = JSON.parse(files[reposConfigPath('C:\\cfg')] as string);
    expect(repos).toEqual({
      default_repo: 'C:\\spotsys',
      repos: {
        spotsys: { path: 'C:\\spotsys', integration_branch: 'staging', github: 'seazone-tech/spotsys' },
        dalton: 'C:\\dalton',
      },
    });
  });

  it('nada muda: NÃO reescreve nenhum dos dois arquivos (preservação byte a byte real)', () => {
    const boardText = JSON.stringify({ workspaceId: 'ws-1', teamId: 'team-1' });
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys' } } });
    const { io, writes } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: boardText,
      [reposConfigPath('C:\\cfg')]: reposText,
    });

    const result = saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' }, io);

    expect(result).toEqual({ workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' });
    expect(writes).toEqual([]);
  });

  it('só o board mudou: reescreve só donel-board-credential.json, repos.json fica intocado', () => {
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys' } } });
    const { io, writes } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({ workspaceId: 'ws-old', teamId: 'team-old' }),
      [reposConfigPath('C:\\cfg')]: reposText,
    });

    saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: 'ws-new', teamId: 'team-new', github: 'seazone-tech/spotsys' }, io);

    // `writes` registra o arquivo TEMP (writeFileText roda antes do rename) —
    // o que importa aqui é que só o board foi tocado, nunca repos.json.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.startsWith(boardCredentialPath('C:\\cfg'))).toBe(true);
  });

  it('campos vazios limpam board e github, preservando token/path', () => {
    const { io, files } = makeMockIo({
      [boardCredentialPath('C:\\cfg')]: JSON.stringify({ token: 'sk_x', workspaceId: 'ws-1', teamId: 'team-1' }),
      [reposConfigPath('C:\\cfg')]: JSON.stringify({ repos: { spotsys: { path: 'C:\\spotsys', github: 'seazone-tech/spotsys', help_channel: '#h' } } }),
    });

    const result = saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: '', teamId: '', github: '' }, io);

    expect(result).toEqual({ workspaceId: '', teamId: '', github: '' });
    expect(JSON.parse(files[boardCredentialPath('C:\\cfg')] as string)).toEqual({ token: 'sk_x' });
    expect(JSON.parse(files[reposConfigPath('C:\\cfg')] as string)).toEqual({ repos: { spotsys: { path: 'C:\\spotsys', help_channel: '#h' } } });
  });

  it('espaços em volta dos valores são trimados antes de gravar/comparar', () => {
    const { io, files } = makeMockIo();
    saveProjectBindingToDisk('C:\\cfg', 'spotsys', 'C:\\spotsys', { workspaceId: '  ws-1  ', teamId: '  team-1 ', github: ' seazone-tech/spotsys ' }, io);
    const board = JSON.parse(files[boardCredentialPath('C:\\cfg')] as string);
    expect(board).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });
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

  it('grava e relê os dois arquivos do disco real', () => {
    const io = createSystemEsteiraConfigIoDeps();
    saveProjectBindingToDisk(dir, 'spotsys', join(dir, 'spotsys-checkout'), { workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' }, io);

    const boardOnDisk = JSON.parse(readFileSync(boardCredentialPath(dir), 'utf8'));
    expect(boardOnDisk).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });

    const reposOnDisk = JSON.parse(readFileSync(reposConfigPath(dir), 'utf8'));
    expect(reposOnDisk.repos.spotsys.github).toBe('seazone-tech/spotsys');

    const reread = readProjectBindingFromDisk(dir, 'spotsys', io);
    expect(reread).toEqual({ workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' });
  });

  it('cria o diretório de config se ele ainda não existir', () => {
    const nestedDir = join(dir, 'esteira-config-nao-existe-ainda');
    const io = createSystemEsteiraConfigIoDeps();
    saveProjectBindingToDisk(nestedDir, 'spotsys', join(dir, 'spotsys-checkout'), { workspaceId: 'ws-1', teamId: 'team-1', github: '' }, io);
    mkdirSync(nestedDir, { recursive: true }); // no-op se já existir — só documenta a expectativa
    expect(readFileSync(boardCredentialPath(nestedDir), 'utf8')).toContain('ws-1');
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
    saveProjectBindingToDisk(dir, 'spotsys', 'C:\\spotsys', { workspaceId: '', teamId: '', github: 'seazone-tech/spotsys' }, io);

    const onDisk = JSON.parse(readFileSync(reposConfigPath(dir), 'utf8'));
    expect(onDisk).toEqual({
      default_repo: 'C:\\spotsys',
      repos: { spotsys: { path: 'C:\\spotsys', integration_branch: 'staging', help_channel: '#spotsys-hub', github: 'seazone-tech/spotsys' } },
      round_limit_by_board: { SPOTSYSMAR: 3 },
    });
  });
});
