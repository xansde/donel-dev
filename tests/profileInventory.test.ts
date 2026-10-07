import { describe, expect, it } from 'vitest';
import { readProfileInventory, type ProfileInventoryDeps } from '../src/main/accounts/migration/profile-inventory';

// T1202 (011-contas-e-provedores, etapa 2) — profile-inventory.ts é PURO com
// IO injetável (contracts/migration-etapa-2.md §3): nunca lê
// `.credentials.json` (só checa existência), nunca lança.

function makeDeps(overrides: Partial<ProfileInventoryDeps> = {}): ProfileInventoryDeps {
  return {
    homedir: () => 'C:\\fake-home',
    readDir: () => [],
    isDirectory: () => true,
    exists: () => false,
    readJson: () => null,
    readTextOrNull: () => null,
    realpathOrNull: (path) => path,
    ...overrides,
  };
}

describe('readProfileInventory (puro)', () => {
  it('raiz ausente ⇒ lista vazia sem lançar', () => {
    const deps = makeDeps({ readDir: () => [] });
    expect(readProfileInventory(deps)).toEqual([]);
  });

  it('perfil sem .credentials.json ⇒ hasCredentials: false', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      exists: (path) => !path.endsWith('.credentials.json'),
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.hasCredentials).toBe(false);
  });

  it('perfil com .credentials.json ⇒ hasCredentials: true (só existência, nunca lê o conteúdo)', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      exists: () => true,
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.hasCredentials).toBe(true);
  });

  it('perfil sem .donel-profile.json ⇒ nome derivado do slug (title case)', () => {
    const deps = makeDeps({
      readDir: () => ['tecnologia-claude-4'],
      readJson: () => null,
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.displayName).toBe('Tecnologia Claude 4');
  });

  it('perfil com .donel-profile.json ⇒ nome do metadado', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      readJson: (path) => (path.endsWith('.donel-profile.json') ? { name: 'Conta X' } : null),
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.displayName).toBe('Conta X');
  });

  it('projects é junction quando realpath do perfil == realpath do global', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      realpathOrNull: (path) => (path.includes('.claude-profiles') ? 'C:\\fake-home\\.claude\\projects' : 'C:\\fake-home\\.claude\\projects'),
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.projectsDir).toBe('junction');
  });

  it('projects é diretório real quando realpath diverge do global', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      realpathOrNull: (path) => (path.includes('.claude-profiles') ? 'C:\\fake-home\\.claude-profiles\\acc-1\\projects' : 'C:\\fake-home\\.claude\\projects'),
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.projectsDir).toBe('real-directory');
  });

  it('projects ausente (realpath nulo) ⇒ missing', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      realpathOrNull: (path) => (path.includes('.claude-profiles') ? null : 'C:\\fake-home\\.claude\\projects'),
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.projectsDir).toBe('missing');
  });

  it('entrada que não é diretório é ignorada', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1', 'nao-e-dir.txt'],
      isDirectory: (path) => !path.endsWith('.txt'),
    });
    const entries = readProfileInventory(deps);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.slug).toBe('acc-1');
  });

  it('.claude.json corrompido ⇒ mcpServerNames: []', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      readJson: () => null,
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.mcpServerNames).toEqual([]);
  });

  it('.claude.json com mcpServers ⇒ lista de nomes', () => {
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      readJson: (path) =>
        path.endsWith('.claude.json') ? { mcpServers: { 'servidor-a': {}, 'servidor-b': {} } } : null,
    });
    const [entry] = readProfileInventory(deps);
    expect(entry.mcpServerNames.slice().sort()).toEqual(['servidor-a', 'servidor-b']);
  });

  it('nunca lê .credentials.json — só verifica existência', () => {
    let readAttempted = false;
    const deps = makeDeps({
      readDir: () => ['acc-1'],
      exists: () => true,
      readTextOrNull: (path) => {
        if (path.endsWith('.credentials.json')) readAttempted = true;
        return null;
      },
    });
    readProfileInventory(deps);
    expect(readAttempted).toBe(false);
  });
});
