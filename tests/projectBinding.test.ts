import { describe, expect, it } from 'vitest';
import {
  isValidSaveProjectBindingIpcInput,
  mergeBoardIds,
  mergeRepoEntry,
  mergeRepoGithub,
  readBoardIds,
  readProjectBinding,
  readRepoBoard,
  readRepoGithub,
  readRepoGithubExtra,
} from '../src/shared/projectBinding';

// CA-23 (009-modo-dev-v3, lote 3) — TDD da lógica PURA de leitura/mesclagem
// dos dois JSONs externos que a engrenagem edita:
// `~/.claude/esteira-config/donel-board-credential.json` (workspaceId/teamId)
// e `repos.json` (repos.<repoSlug>.github). Nenhum fs aqui — só texto → objeto
// (o encanamento de disco tem seu próprio TDD em tests/esteira-config.test.ts).

describe('readBoardIds', () => {
  it('arquivo ausente (texto null) devolve os dois campos null, nunca lança', () => {
    expect(readBoardIds(null)).toEqual({ workspaceId: null, teamId: null });
  });

  it('JSON corrompido devolve os dois campos null', () => {
    expect(readBoardIds('{ isso não é json')).toEqual({ workspaceId: null, teamId: null });
  });

  it('array no lugar de objeto devolve os dois campos null', () => {
    expect(readBoardIds('[1,2,3]')).toEqual({ workspaceId: null, teamId: null });
  });

  it('lê workspaceId/teamId presentes, ignorando outros campos (token/baseUrl)', () => {
    const text = JSON.stringify({ token: 'sk_segredo', baseUrl: 'https://x', workspaceId: 'ws-1', teamId: 'team-1' });
    expect(readBoardIds(text)).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });
  });

  it('campo de tipo errado (número) vira null nesse campo', () => {
    expect(readBoardIds(JSON.stringify({ workspaceId: 123, teamId: 'team-1' }))).toEqual({ workspaceId: null, teamId: 'team-1' });
  });
});

describe('mergeBoardIds', () => {
  it('arquivo ausente + ids válidos: cria objeto novo só com os dois campos', () => {
    expect(mergeBoardIds(null, { workspaceId: 'ws-1', teamId: 'team-1' })).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });
  });

  it('PRESERVA token/baseUrl/_comentario e qualquer campo desconhecido — merge, nunca substituição', () => {
    const text = JSON.stringify({
      baseUrl: 'https://taskdex.seazone.dev/api/mcp',
      token: 'sk_37bdc63a7b22c5b2439cf1f9e4f5b502',
      workspaceId: 'ws-old',
      teamId: 'team-old',
      _comentario: 'nota do usuário',
    });
    const result = mergeBoardIds(text, { workspaceId: 'ws-new', teamId: 'team-new' });
    expect(result).toEqual({
      baseUrl: 'https://taskdex.seazone.dev/api/mcp',
      token: 'sk_37bdc63a7b22c5b2439cf1f9e4f5b502',
      workspaceId: 'ws-new',
      teamId: 'team-new',
      _comentario: 'nota do usuário',
    });
  });

  it('campo desconhecido do futuro (não previsto pelo app) também sobrevive ao merge', () => {
    const text = JSON.stringify({ workspaceId: 'ws-1', teamId: 'team-1', campoFuturoDesconhecido: { aninhado: true } });
    const result = mergeBoardIds(text, { workspaceId: 'ws-2', teamId: 'team-2' });
    expect(result.campoFuturoDesconhecido).toEqual({ aninhado: true });
  });

  it('ambos vazios: remove os dois campos (nunca board pela metade)', () => {
    const text = JSON.stringify({ token: 'sk_x', workspaceId: 'ws-1', teamId: 'team-1' });
    const result = mergeBoardIds(text, { workspaceId: '', teamId: '' });
    expect(result).toEqual({ token: 'sk_x' });
  });

  it('só um dos dois vazio: remove os DOIS (nunca um valor fabricado sozinho)', () => {
    const text = JSON.stringify({ workspaceId: 'ws-1', teamId: 'team-1' });
    expect(mergeBoardIds(text, { workspaceId: 'ws-novo', teamId: '' })).toEqual({});
    expect(mergeBoardIds(text, { workspaceId: '', teamId: 'team-novo' })).toEqual({});
  });

  it('JSON corrompido + ids válidos: cria objeto novo (não lança, não herda lixo)', () => {
    expect(mergeBoardIds('{{{lixo', { workspaceId: 'ws-1', teamId: 'team-1' })).toEqual({ workspaceId: 'ws-1', teamId: 'team-1' });
  });
});

describe('readRepoGithub', () => {
  const REPOS_TEXT = JSON.stringify({
    default_repo: 'C:/Users/x/seazone/spotsys',
    repos: {
      dalton: 'C:/Users/x/seazone/dalton', // forma legada: só path (contrato §I)
      spotsys: {
        path: 'C:/Users/x/seazone/spotsys',
        github: 'seazone-tech/spotsys',
        integration_branch: 'staging',
        help_channel: '#spotsys-hub',
      },
      'sem-github': { path: 'C:/Users/x/seazone/sem-github' },
    },
    round_limit_by_board: { SPOTSYSMAR: 3 },
  });

  it('entrada em forma objeto com github: devolve o valor', () => {
    expect(readRepoGithub(REPOS_TEXT, 'spotsys')).toBe('seazone-tech/spotsys');
  });

  it('entrada em forma legada (string, só path): null — sem github', () => {
    expect(readRepoGithub(REPOS_TEXT, 'dalton')).toBeNull();
  });

  it('entrada objeto sem campo github: null', () => {
    expect(readRepoGithub(REPOS_TEXT, 'sem-github')).toBeNull();
  });

  it('repoSlug inexistente: null, nunca lança', () => {
    expect(readRepoGithub(REPOS_TEXT, 'nao-existe')).toBeNull();
  });

  it('arquivo ausente: null', () => {
    expect(readRepoGithub(null, 'spotsys')).toBeNull();
  });
});

describe('mergeRepoGithub', () => {
  it('repoSlug ausente no arquivo: cria entrada nova com path (do projeto) + github', () => {
    const result = mergeRepoGithub(null, { repoSlug: 'novo-repo', repoPath: 'C:/Users/x/seazone/novo-repo', github: 'org/novo-repo' });
    expect(result).toEqual({ repos: { 'novo-repo': { path: 'C:/Users/x/seazone/novo-repo', github: 'org/novo-repo' } } });
  });

  it('entrada em forma legada (string): converte pra objeto preservando o path existente', () => {
    const text = JSON.stringify({ repos: { dalton: 'C:/Users/x/seazone/dalton' } });
    const result = mergeRepoGithub(text, { repoSlug: 'dalton', repoPath: 'C:/outro/path/ignorado', github: 'seazone-tech/dalton' });
    expect(result).toEqual({ repos: { dalton: { path: 'C:/Users/x/seazone/dalton', github: 'seazone-tech/dalton' } } });
  });

  it('PRESERVA integration_branch/help_channel/promotion e demais campos da entrada objeto', () => {
    const text = JSON.stringify({
      repos: {
        spotsys: {
          path: 'C:/Users/x/seazone/spotsys',
          integration_branch: 'staging',
          help_channel: '#spotsys-hub',
          promotion: { days: ['tue', 'wed'], hour: 9 },
        },
      },
    });
    const result = mergeRepoGithub(text, { repoSlug: 'spotsys', repoPath: 'ignorado', github: 'seazone-tech/spotsys' });
    expect(result).toEqual({
      repos: {
        spotsys: {
          path: 'C:/Users/x/seazone/spotsys',
          integration_branch: 'staging',
          help_channel: '#spotsys-hub',
          promotion: { days: ['tue', 'wed'], hour: 9 },
          github: 'seazone-tech/spotsys',
        },
      },
    });
  });

  it('PRESERVA default_repo, outros repos e round_limit_by_board — só a entrada do repoSlug muda', () => {
    const text = JSON.stringify({
      default_repo: 'C:/Users/x/seazone/spotsys',
      repos: {
        spotsys: { path: 'C:/Users/x/seazone/spotsys' },
        'api-spotsys': 'C:/Users/x/seazone/api-spotsys',
      },
      round_limit_by_board: { SPOTSYSMAR: 3 },
    });
    const result = mergeRepoGithub(text, { repoSlug: 'spotsys', repoPath: 'ignorado', github: 'seazone-tech/spotsys' });
    expect(result).toEqual({
      default_repo: 'C:/Users/x/seazone/spotsys',
      repos: {
        spotsys: { path: 'C:/Users/x/seazone/spotsys', github: 'seazone-tech/spotsys' },
        'api-spotsys': 'C:/Users/x/seazone/api-spotsys',
      },
      round_limit_by_board: { SPOTSYSMAR: 3 },
    });
  });

  it('github vazio remove o campo (nunca grava string vazia) — mantendo o resto da entrada', () => {
    const text = JSON.stringify({ repos: { spotsys: { path: 'C:/x/spotsys', github: 'seazone-tech/spotsys', help_channel: '#spotsys-hub' } } });
    const result = mergeRepoGithub(text, { repoSlug: 'spotsys', repoPath: 'ignorado', github: '' });
    expect(result).toEqual({ repos: { spotsys: { path: 'C:/x/spotsys', help_channel: '#spotsys-hub' } } });
  });

  it('arquivo corrompido: começa do zero (objeto novo), não lança', () => {
    const result = mergeRepoGithub('{{{lixo', { repoSlug: 'x', repoPath: 'C:/x', github: 'org/x' });
    expect(result).toEqual({ repos: { x: { path: 'C:/x', github: 'org/x' } } });
  });
});

describe('readRepoGithubExtra', () => {
  const REPOS_TEXT = JSON.stringify({
    repos: {
      spotsys: { path: 'C:/x/spotsys', github: 'seazone-tech/spotsys', github_extra: ['seazone-tech/spotsys-infra', 'seazone-tech/spotsys-docs'] },
      'sem-extra': { path: 'C:/x/sem-extra', github: 'org/sem-extra' },
      'extra-invalido': { path: 'C:/x/y', github_extra: 'nao-e-array' },
      'extra-com-lixo': { path: 'C:/x/z', github_extra: ['org/ok', 42, '', null] },
    },
  });

  it('lê a lista aditiva quando presente', () => {
    expect(readRepoGithubExtra(REPOS_TEXT, 'spotsys')).toEqual(['seazone-tech/spotsys-infra', 'seazone-tech/spotsys-docs']);
  });

  it('entrada sem github_extra: []', () => {
    expect(readRepoGithubExtra(REPOS_TEXT, 'sem-extra')).toEqual([]);
  });

  it('github_extra de tipo errado (não-array): []', () => {
    expect(readRepoGithubExtra(REPOS_TEXT, 'extra-invalido')).toEqual([]);
  });

  it('filtra entradas não-string/vazias da lista, preservando as válidas', () => {
    expect(readRepoGithubExtra(REPOS_TEXT, 'extra-com-lixo')).toEqual(['org/ok']);
  });

  it('repoSlug inexistente / arquivo ausente: []', () => {
    expect(readRepoGithubExtra(REPOS_TEXT, 'nao-existe')).toEqual([]);
    expect(readRepoGithubExtra(null, 'spotsys')).toEqual([]);
  });
});

describe('readRepoBoard', () => {
  const REPOS_TEXT = JSON.stringify({
    repos: {
      spotsys: { path: 'C:/x/spotsys', board: { workspaceId: 'ws-proj', teamId: 'team-proj' } },
      'sem-board': { path: 'C:/x/sem-board' },
      'board-parcial': { path: 'C:/x/y', board: { workspaceId: 'ws-1' } },
    },
  });

  it('lê workspaceId/teamId do board do projeto', () => {
    expect(readRepoBoard(REPOS_TEXT, 'spotsys')).toEqual({ workspaceId: 'ws-proj', teamId: 'team-proj' });
  });

  it('entrada sem board: os dois null', () => {
    expect(readRepoBoard(REPOS_TEXT, 'sem-board')).toEqual({ workspaceId: null, teamId: null });
  });

  it('board pela metade (só workspaceId): teamId null, workspaceId lido como está (a regra tudo-ou-nada é do MERGE, não da leitura)', () => {
    expect(readRepoBoard(REPOS_TEXT, 'board-parcial')).toEqual({ workspaceId: 'ws-1', teamId: null });
  });

  it('repoSlug inexistente / arquivo ausente: os dois null', () => {
    expect(readRepoBoard(REPOS_TEXT, 'nao-existe')).toEqual({ workspaceId: null, teamId: null });
    expect(readRepoBoard(null, 'spotsys')).toEqual({ workspaceId: null, teamId: null });
  });
});

describe('mergeRepoEntry', () => {
  it('repoSlug ausente: cria entrada nova com path + github + github_extra + board', () => {
    const result = mergeRepoEntry(null, {
      repoSlug: 'novo-repo',
      repoPath: 'C:/x/novo-repo',
      github: 'org/novo-repo',
      githubExtra: ['org/novo-repo-infra'],
      workspaceId: 'ws-1',
      teamId: 'team-1',
    });
    expect(result).toEqual({
      repos: {
        'novo-repo': {
          path: 'C:/x/novo-repo',
          github: 'org/novo-repo',
          github_extra: ['org/novo-repo-infra'],
          board: { workspaceId: 'ws-1', teamId: 'team-1' },
        },
      },
    });
  });

  it('PRESERVA campos desconhecidos da entrada existente — só github/github_extra/board mudam', () => {
    const text = JSON.stringify({
      default_repo: 'C:/x/spotsys',
      repos: { spotsys: { path: 'C:/x/spotsys', integration_branch: 'staging', help_channel: '#spotsys-hub' } },
      round_limit_by_board: { SPOTSYSMAR: 3 },
    });
    const result = mergeRepoEntry(text, {
      repoSlug: 'spotsys',
      repoPath: 'ignorado',
      github: 'seazone-tech/spotsys',
      githubExtra: [],
      workspaceId: '',
      teamId: '',
    });
    expect(result).toEqual({
      default_repo: 'C:/x/spotsys',
      repos: { spotsys: { path: 'C:/x/spotsys', integration_branch: 'staging', help_channel: '#spotsys-hub', github: 'seazone-tech/spotsys' } },
      round_limit_by_board: { SPOTSYSMAR: 3 },
    });
  });

  it('githubExtra vazio remove o campo (nunca grava array vazio)', () => {
    const text = JSON.stringify({ repos: { spotsys: { path: 'C:/x', github_extra: ['org/x'] } } });
    const result = mergeRepoEntry(text, { repoSlug: 'spotsys', repoPath: 'ignorado', github: '', githubExtra: [], workspaceId: '', teamId: '' });
    expect(result).toEqual({ repos: { spotsys: { path: 'C:/x' } } });
  });

  it('só um dos dois ids de board vazio: remove o board inteiro (tudo ou nada, mesma regra de mergeBoardIds)', () => {
    const text = JSON.stringify({ repos: { spotsys: { path: 'C:/x', board: { workspaceId: 'ws-old', teamId: 'team-old' } } } });
    const result = mergeRepoEntry(text, { repoSlug: 'spotsys', repoPath: 'ignorado', github: '', githubExtra: [], workspaceId: 'ws-novo', teamId: '' });
    expect(result).toEqual({ repos: { spotsys: { path: 'C:/x' } } });
  });

  it('entrada em forma legada (string): converte pra objeto preservando o path', () => {
    const text = JSON.stringify({ repos: { dalton: 'C:/x/dalton' } });
    const result = mergeRepoEntry(text, { repoSlug: 'dalton', repoPath: 'C:/ignorado', github: 'seazone-tech/dalton', githubExtra: [], workspaceId: '', teamId: '' });
    expect(result).toEqual({ repos: { dalton: { path: 'C:/x/dalton', github: 'seazone-tech/dalton' } } });
  });
});

describe('readProjectBinding', () => {
  it('combina os dois arquivos num DTO único, string vazia por campo ausente (nunca null/undefined)', () => {
    const boardText = JSON.stringify({ workspaceId: 'ws-1', teamId: 'team-1', token: 'sk_x' });
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:/x', github: 'seazone-tech/spotsys' } } });
    expect(readProjectBinding(boardText, reposText, 'spotsys')).toEqual({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      github: 'seazone-tech/spotsys',
      githubExtra: [],
      hasOwnBoard: false,
    });
  });

  it('os dois arquivos ausentes: DTO todo vazio, nunca lança', () => {
    expect(readProjectBinding(null, null, 'spotsys')).toEqual({
      workspaceId: '',
      teamId: '',
      github: '',
      githubExtra: [],
      hasOwnBoard: false,
    });
  });

  it('board DO PROJETO (repos.json) tem prioridade sobre o global (credencial)', () => {
    const boardText = JSON.stringify({ workspaceId: 'ws-global', teamId: 'team-global' });
    const reposText = JSON.stringify({
      repos: { spotsys: { path: 'C:/x', github: 'seazone-tech/spotsys', board: { workspaceId: 'ws-proj', teamId: 'team-proj' } } },
    });
    expect(readProjectBinding(boardText, reposText, 'spotsys')).toEqual({
      workspaceId: 'ws-proj',
      teamId: 'team-proj',
      github: 'seazone-tech/spotsys',
      githubExtra: [],
      hasOwnBoard: true,
    });
  });

  it('projeto sem board próprio cai pro global — mesmo com repos.json presente — mas hasOwnBoard fica falso', () => {
    const boardText = JSON.stringify({ workspaceId: 'ws-global', teamId: 'team-global' });
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:/x', github: 'seazone-tech/spotsys' } } });
    const result = readProjectBinding(boardText, reposText, 'spotsys');
    expect(result.workspaceId).toBe('ws-global');
    expect(result.teamId).toBe('team-global');
    expect(result.hasOwnBoard).toBe(false);
  });

  it('github_extra do projeto aparece no DTO', () => {
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:/x', github: 'seazone-tech/spotsys', github_extra: ['org/extra-1'] } } });
    expect(readProjectBinding(null, reposText, 'spotsys').githubExtra).toEqual(['org/extra-1']);
  });
});

describe('isValidSaveProjectBindingIpcInput', () => {
  it('aceita payload completo, mesmo com campos vazios (limpar é uma gravação válida)', () => {
    expect(isValidSaveProjectBindingIpcInput({ repoPath: 'C:/x', workspaceId: '', teamId: '', github: '', githubExtra: [] })).toBe(true);
  });

  it('rejeita repoPath vazio/ausente — é a chave, não pode faltar', () => {
    expect(isValidSaveProjectBindingIpcInput({ repoPath: '', workspaceId: 'a', teamId: 'b', github: 'c', githubExtra: [] })).toBe(false);
    expect(isValidSaveProjectBindingIpcInput({ workspaceId: 'a', teamId: 'b', github: 'c', githubExtra: [] })).toBe(false);
  });

  it('rejeita tipos errados e payload não-objeto', () => {
    expect(isValidSaveProjectBindingIpcInput(null)).toBe(false);
    expect(isValidSaveProjectBindingIpcInput('string')).toBe(false);
    expect(isValidSaveProjectBindingIpcInput({ repoPath: 'C:/x', workspaceId: 1, teamId: 'b', github: 'c', githubExtra: [] })).toBe(false);
  });

  it('rejeita githubExtra ausente ou com entrada não-string', () => {
    expect(isValidSaveProjectBindingIpcInput({ repoPath: 'C:/x', workspaceId: '', teamId: '', github: '' })).toBe(false);
    expect(isValidSaveProjectBindingIpcInput({ repoPath: 'C:/x', workspaceId: '', teamId: '', github: '', githubExtra: ['ok', 1] })).toBe(false);
  });
});
