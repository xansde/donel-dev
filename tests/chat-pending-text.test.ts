import { describe, expect, it } from 'vitest';
import { pendingFromRequest } from '../src/shared/chat/pendingQueue';
import {
  allowAlwaysLabel,
  pendingNotificationBody,
  permissionDescription,
  permissionSentence,
} from '../src/shared/chat/pendingText';
import type { PendingScope, PermissionPayload } from '../src/shared/chat/rows';

const pp = (toolName: string, toolInput: Record<string, unknown>, suggestions?: PermissionPayload['permissionSuggestions']): PermissionPayload => ({
  toolName,
  toolInput,
  ...(suggestions ? { permissionSuggestions: suggestions } : {}),
});

describe('permissionSentence', () => {
  it('Bash', () => expect(permissionSentence(pp('Bash', { command: 'npm test' }))).toEqual({ verb: 'rodar', object: 'npm test' }));
  it('Edit and MultiEdit', () => {
    expect(permissionSentence(pp('Edit', { file_path: 'src/a.ts' }))).toEqual({ verb: 'editar', object: 'src/a.ts' });
    expect(permissionSentence(pp('MultiEdit', { file_path: 'src/a.ts' }))).toEqual({ verb: 'editar', object: 'src/a.ts' });
  });
  it('Write', () => expect(permissionSentence(pp('Write', { file_path: 'n.md' }))).toEqual({ verb: 'criar', object: 'n.md' }));
  it('MCP tool', () =>
    expect(permissionSentence(pp('mcp__slack__send_message', {}))).toEqual({ verb: 'usar', object: 'slack · send_message' }));
  it('WebFetch', () => expect(permissionSentence(pp('WebFetch', { url: 'https://x.dev' }))).toEqual({ verb: 'abrir', object: 'https://x.dev' }));
  it('others', () => expect(permissionSentence(pp('Grep', {}))).toEqual({ verb: 'usar', object: 'Grep' }));
});

describe('permissionDescription', () => {
  it('returns the description verbatim or null', () => {
    expect(permissionDescription(pp('Bash', { command: 'ls', description: 'Lista arquivos' }))).toBe('Lista arquivos');
    expect(permissionDescription(pp('Bash', { command: 'ls' }))).toBeNull();
    expect(permissionDescription(pp('Bash', { command: 'ls', description: '  ' }))).toBeNull();
  });
});

describe('allowAlwaysLabel', () => {
  it('edit tools without suggestion', () => {
    for (const t of ['Edit', 'MultiEdit', 'Write'])
      expect(allowAlwaysLabel(pp(t, {}))).toBe('sempre: todas as edições neste projeto');
  });
  it('other tools without suggestion', () => expect(allowAlwaysLabel(pp('Bash', {}))).toBe('sempre: Bash neste projeto'));
  it('with addRules suggestions', () => {
    expect(
      allowAlwaysLabel(
        pp('Bash', {}, [
          { type: 'setMode', mode: 'x' },
          { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm install:*' }, { toolName: 'Read' }] },
        ]),
      ),
    ).toBe('sempre: `Bash(npm install:*)`, `Read`');
  });
});

describe('pendingNotificationBody', () => {
  const mk = (toolName: string, toolInput: Record<string, unknown>, scope: PendingScope = 'main') =>
    pendingFromRequest({ id: 'i', payload: { tool_name: toolName, tool_input: toolInput }, toolUseId: null, arrivedAt: '2026-10-08T10:00:00Z', scope });

  it('question', () => expect(pendingNotificationBody(mk('AskUserQuestion', { questions: [{ question: 'segredo?', options: [] }] }))).toBe('Esperando você — pergunta'));
  it('bash never leaks the command', () => {
    const b = pendingNotificationBody(mk('Bash', { command: 'rm secret' }));
    expect(b).toBe('Esperando você — permissão para rodar um comando');
    expect(b).not.toContain('secret');
  });
  it('edit uses only the basename', () =>
    expect(pendingNotificationBody(mk('Edit', { file_path: 'C:\\x\\y\\app.ts' }))).toBe('Esperando você — permissão para editar app.ts'));
  it('plan', () => expect(pendingNotificationBody(mk('ExitPlanMode', { plan: 'x' }))).toBe('Esperando você — plano proposto'));
  it('other tools', () => expect(pendingNotificationBody(mk('Grep', {}))).toBe('Esperando você — permissão para usar Grep'));
  it('subagent scope', () =>
    expect(pendingNotificationBody(mk('Bash', { command: 'x' }, { agentId: 'a', description: 'revisor' }))).toBe(
      'Esperando você — permissão para rodar um comando (pedido do subagente revisor)',
    ));
});
