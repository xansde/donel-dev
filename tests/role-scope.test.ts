import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSessionHooksSettings } from '../src/main/hooks-settings';
import { createRolesStore } from '../src/main/roles-store';
import { buildRoleScopeSettings, parseRemoteInventoryOutput, type ClaudeInventory } from '../src/shared/role-scope';
import { factoryRole, parseRoleFile, serializeRole } from '../src/shared/roles';

// Escopo do papel: what a session launched with a role loads. A wrong key here and a Dev session silently gets
// every MCP again (or a Líder loses them), so the `--settings` content is guarded.

const INVENTORY: ClaudeInventory = {
  pluginIds: ['dev@seazone-skills', 'esteira@seazone-skills', 'esteira@outro', 'geral@seazone-skills'],
  skillNames: ['ai-rats', 'wiki-query', 'anthropic-skills:docx'],
};

describe('escopo do papel', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('Dev de fábrica: só donel + github, só os plugins dele, nenhuma skill solta', () => {
    expect(buildRoleScopeSettings(factoryRole('dev')!.scope, INVENTORY, 'donel')).toEqual({
      allowedMcpServers: [{ serverName: 'donel' }, { serverName: 'github' }],
      enabledPlugins: { 'geral@seazone-skills': false },
      skillOverrides: { 'ai-rats': 'off', 'anthropic-skills:docx': 'off', 'wiki-query': 'off' },
    });
  });

  it('papel sem declaração, ou com tudo `*`, não restringe nada', () => {
    expect(buildRoleScopeSettings(factoryRole('lider')!.scope, INVENTORY, 'donel')).toBeNull();
    const all = parseRoleFile('x', '---\nnome: X\nmcps: *\nplugins: *\n---\nfaz');
    expect(buildRoleScopeSettings(all!.scope, INVENTORY, 'donel')).toBeNull();
  });

  it('o cabeçalho ida e volta guarda as listas, a lista vazia e o `*`', () => {
    const role = parseRoleFile('h', '---\nnome: Homologador\ncor: discovery\nmcps: github, taskdex,seazone-eks\nplugins: homologacao\nskills:\n---\nTexto');
    expect(role!.scope).toEqual({ mcps: ['github', 'taskdex', 'seazone-eks'], plugins: ['homologacao'], skills: [] });
    expect(parseRoleFile('h', serializeRole(role!))).toEqual(role);
    const star = parseRoleFile('s', '---\nnome: S\nmcps: *\n---\n');
    expect(parseRoleFile('s', serializeRole(star!))!.scope).toEqual({ mcps: '*' });
  });

  it('Dev editado num arquivo sem escopo continua com o escopo de fábrica; `mcps: *` libera', () => {
    const userData = mkdtempSync(join(tmpdir(), 'donel-scope-'));
    dirs.push(userData);
    mkdirSync(join(userData, 'papeis'));
    writeFileSync(join(userData, 'papeis', 'dev.md'), '---\nnome: Dev\ncor: implementar\n---\nOutro texto');
    const store = createRolesStore(userData);
    expect(store.get('dev')!.scope).toEqual(factoryRole('dev')!.scope);
    writeFileSync(join(userData, 'papeis', 'dev.md'), '---\nnome: Dev\ncor: implementar\nmcps: *\n---\nOutro texto');
    expect(store.get('dev')!.scope).toEqual({ mcps: '*' });
    // A save from the screen keeps the scope it got.
    const saved = store.save({ ...store.get('dev')!, guidance: 'Novo' });
    expect(saved.ok && saved.roles.find((role) => role.id === 'dev')!.scope).toEqual({ mcps: '*' });
  });

  it('o escopo entra no mesmo --settings dos hooks', () => {
    const settings = buildSessionHooksSettings({ port: 1, token: 't', curlPath: 'curl', roleScope: { allowedMcpServers: [{ serverName: 'donel' }] } });
    expect(settings.allowedMcpServers).toEqual([{ serverName: 'donel' }]);
    expect(Object.keys(settings.hooks)).toContain('SessionStart');
  });

  it('inventário do lugar remoto: só nomes; sem o fim, nada', () => {
    const out = [
      'DONEL_INV_PLUGIN dev@seazone-skills',
      'DONEL_INV_PLUGIN not a plugin',
      'DONEL_INV_SKILL synced',
      'DONEL_INV_SKILL ai-rats',
      'DONEL_INV_SYNCED docx',
      'DONEL_INV_COMMAND grupo/acao.md',
      'DONEL_INV_END',
    ].join('\n');
    expect(parseRemoteInventoryOutput(out)).toEqual({
      pluginIds: ['dev@seazone-skills'],
      skillNames: ['ai-rats', 'anthropic-skills:docx', 'grupo:acao'],
    });
    expect(parseRemoteInventoryOutput('DONEL_INV_PLUGIN dev@x')).toBeNull();
  });
});
