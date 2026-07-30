import { describe, expect, it } from 'vitest';
import {
  isValidSaveProjectBindingIpcInput,
  mergeBoardIds,
  mergeRepoGithub,
  readBoardIds,
  readProjectBinding,
  readRepoGithub,
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

describe('readProjectBinding', () => {
  it('combina os dois arquivos num DTO único, string vazia por campo ausente (nunca null/undefined)', () => {
    const boardText = JSON.stringify({ workspaceId: 'ws-1', teamId: 'team-1', token: 'sk_x' });
    const reposText = JSON.stringify({ repos: { spotsys: { path: 'C:/x', github: 'seazone-tech/spotsys' } } });
    expect(readProjectBinding(boardText, reposText, 'spotsys')).toEqual({ workspaceId: 'ws-1', teamId: 'team-1', github: 'seazone-tech/spotsys' });
  });

  it('os dois arquivos ausentes: DTO todo vazio, nunca lança', () => {
    expect(readProjectBinding(null, null, 'spotsys')).toEqual({ workspaceId: '', teamId: '', github: '' });
  });
});

describe('isValidSaveProjectBindingIpcInput', () => {
  it('aceita payload completo, mesmo com campos vazios (limpar é uma gravação válida)', () => {
    expect(isValidSaveProjectBindingIpcInput({ repoPath: 'C:/x', workspaceId: '', teamId: '', github: '' })).toBe(true);
  });

  it('rejeita repoPath vazio/ausente — é a chave, não pode faltar', () => {
    expect(isValidSaveProjectBindingIpcInput({ repoPath: '', workspaceId: 'a', teamId: 'b', github: 'c' })).toBe(false);
    expect(isValidSaveProjectBindingIpcInput({ workspaceId: 'a', teamId: 'b', github: 'c' })).toBe(false);
  });

  it('rejeita tipos errados e payload não-objeto', () => {
    expect(isValidSaveProjectBindingIpcInput(null)).toBe(false);
    expect(isValidSaveProjectBindingIpcInput('string')).toBe(false);
    expect(isValidSaveProjectBindingIpcInput({ repoPath: 'C:/x', workspaceId: 1, teamId: 'b', github: 'c' })).toBe(false);
  });
});
