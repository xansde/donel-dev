import { describe, expect, it } from 'vitest';
import { filterProjectsByName, groupProjectsByRoot, normalizeForSearch, projectRootLabel } from '../src/shared/projectCatalog';
import type { ProjectInfo } from '../src/shared/projects';

// Itens 2/3 (rodada de feedback do teste de 30/07) — filtro textual e
// agrupamento por diretório do seletor de projetos (ProjectSwitcher).

function project(name: string, root: string, favorite = false): ProjectInfo {
  return { path: `${root}\\${name}`, name, root, favorite };
}

describe('normalizeForSearch', () => {
  it('remove acentos e normaliza caixa', () => {
    expect(normalizeForSearch('Cotás')).toBe('cotas');
    expect(normalizeForSearch('DONEL-DEV')).toBe('donel-dev');
  });
});

describe('filterProjectsByName', () => {
  const projects = [project('donel-dev', 'C:\\seazone'), project('cotas', 'C:\\seazone'), project('vault-scripts', 'C:\\pessoal')];

  it('query vazia devolve a lista inteira, na mesma ordem', () => {
    expect(filterProjectsByName(projects, '')).toEqual(projects);
    expect(filterProjectsByName(projects, '   ')).toEqual(projects);
  });

  it('filtra por substring do nome, case-insensível', () => {
    expect(filterProjectsByName(projects, 'DONEL').map((p) => p.name)).toEqual(['donel-dev']);
  });

  it('acento-insensível — "cotas" acha "Cotás"', () => {
    const withAccent = [project('Cotás', 'C:\\seazone')];
    expect(filterProjectsByName(withAccent, 'cotas')).toHaveLength(1);
    expect(filterProjectsByName(withAccent, 'COTÁS')).toHaveLength(1);
  });

  it('sem match nenhum devolve lista vazia', () => {
    expect(filterProjectsByName(projects, 'zzz-nao-existe')).toEqual([]);
  });
});

describe('groupProjectsByRoot', () => {
  it('agrupa por root preservando ordem de primeira aparição', () => {
    const projects = [
      project('donel-dev', 'C:\\seazone'),
      project('vault-scripts', 'C:\\pessoal'),
      project('cotas', 'C:\\seazone'),
    ];
    const groups = groupProjectsByRoot(projects);
    expect(groups.map((g) => g.root)).toEqual(['C:\\seazone', 'C:\\pessoal']);
    expect(groups[0].items.map((p) => p.name)).toEqual(['donel-dev', 'cotas']);
    expect(groups[1].items.map((p) => p.name)).toEqual(['vault-scripts']);
  });

  it('lista vazia devolve nenhum grupo', () => {
    expect(groupProjectsByRoot([])).toEqual([]);
  });
});

describe('projectRootLabel', () => {
  it('devolve o último segmento do path (Windows)', () => {
    expect(projectRootLabel('C:\\Users\\xansd\\seazone')).toBe('seazone');
  });

  it('tolera separador à direita', () => {
    expect(projectRootLabel('C:\\Users\\xansd\\seazone\\')).toBe('seazone');
  });

  it('funciona com separador POSIX também', () => {
    expect(projectRootLabel('/home/x/pessoal')).toBe('pessoal');
  });
});
