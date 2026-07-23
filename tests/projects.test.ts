import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../src/shared';
import { sortProjects } from '../src/shared/projects';

// `sortProjects` (movida de src/main/project-scanner.ts pro shared/ na
// correção do feedback E2E rodada 3 — "favoritar projeto só reflete após
// reiniciar o app") é pura (sem node:fs/node:path), reusada tanto pelo main
// (listProjectsWithFavorites) quanto pelo renderer (App.tsx,
// handleToggleFavorite — reordenação otimista no próprio clique da
// estrela, sem esperar o round-trip do IPC).

describe('sortProjects', () => {
  it('agrupa por root (alfabético); dentro do grupo, favoritos no topo e resto alfabético', () => {
    const input: ProjectInfo[] = [
      { path: 'C:\\seazone\\spotsys', name: 'spotsys', root: 'C:\\seazone', favorite: false },
      { path: 'C:\\seazone\\bizops', name: 'bizops', root: 'C:\\seazone', favorite: true },
      { path: 'C:\\seazone\\dalton', name: 'dalton', root: 'C:\\seazone', favorite: false },
      { path: 'C:\\pessoal\\blog', name: 'blog', root: 'C:\\pessoal', favorite: false },
    ];

    const result = sortProjects(input).map((p) => `${p.root}\\${p.name}`);

    expect(result).toEqual(['C:\\pessoal\\blog', 'C:\\seazone\\bizops', 'C:\\seazone\\dalton', 'C:\\seazone\\spotsys']);
  });

  it('reordenação otimista: marcar um projeto como favorito e resortear (mesmo padrão de App.tsx.handleToggleFavorite) já move ele pro topo do root, sem round-trip nenhum', () => {
    const before: ProjectInfo[] = [
      { path: 'C:\\seazone\\bizops', name: 'bizops', root: 'C:\\seazone', favorite: false },
      { path: 'C:\\seazone\\dalton', name: 'dalton', root: 'C:\\seazone', favorite: false },
      { path: 'C:\\seazone\\donel-dev', name: 'donel-dev', root: 'C:\\seazone', favorite: false },
    ];
    // Estado inicial: alfabético puro (nenhum favorito) — bizops < dalton < donel-dev.
    expect(sortProjects(before).map((p) => p.name)).toEqual(['bizops', 'dalton', 'donel-dev']);

    // Simula EXATAMENTE a transformação otimista do handler do clique:
    // `.map` marcando o path clicado + `sortProjects` de novo — síncrono,
    // sem esperar `window.donel.projects.setFavorite(...)`.
    const afterToggle = sortProjects(
      before.map((project) => (project.name === 'donel-dev' ? { ...project, favorite: true } : project)),
    );

    expect(afterToggle.map((p) => p.name)).toEqual(['donel-dev', 'bizops', 'dalton']);
    expect(afterToggle.find((p) => p.name === 'donel-dev')?.favorite).toBe(true);
  });

  it('desfavoritar move o projeto de volta pra posição alfabética dentro do root', () => {
    const before: ProjectInfo[] = [
      { path: 'C:\\seazone\\donel-dev', name: 'donel-dev', root: 'C:\\seazone', favorite: true },
      { path: 'C:\\seazone\\bizops', name: 'bizops', root: 'C:\\seazone', favorite: false },
      { path: 'C:\\seazone\\dalton', name: 'dalton', root: 'C:\\seazone', favorite: false },
    ];

    const afterToggle = sortProjects(
      before.map((project) => (project.name === 'donel-dev' ? { ...project, favorite: false } : project)),
    );

    expect(afterToggle.map((p) => p.name)).toEqual(['bizops', 'dalton', 'donel-dev']);
  });
});
