import { describe, expect, it } from 'vitest';
import { planRoleLaunch } from '../src/shared/roleLaunch';
import type { RoleScope } from '../src/shared/roles';

const DEV_SCOPE: RoleScope = { mcps: ['github'] };

// Papel não entregue (ideia do OpenRig 0.7.9): a session launched with a role that could not be delivered must say
// so, never open silently without the role or with more MCPs than the role allows.

describe('planRoleLaunch', () => {
  it('papel entregue e escopo gravado: args do papel, nada faltando', () => {
    expect(planRoleLaunch('claude-code', { roleId: 'dev', promptPath: '/u/papeis-prompt/dev.md', scope: DEV_SCOPE, scopeDelivered: true })).toEqual({
      args: ['--append-system-prompt-file', '/u/papeis-prompt/dev.md'],
      missing: [],
    });
  });

  it('papel pedido sem arquivo: sem --append-system-prompt-file e falta "papel"', () => {
    const plan = planRoleLaunch('claude-code', { roleId: 'dev', promptPath: null, scope: undefined, scopeDelivered: false });
    expect(plan.args).not.toContain('--append-system-prompt-file');
    expect(plan.missing).toEqual(['papel']);
  });

  it('escopo declarado que não gravou: falta "escopo"', () => {
    const plan = planRoleLaunch('claude-code', { roleId: 'dev', promptPath: '/u/papeis-prompt/dev.md', scope: DEV_SCOPE, scopeDelivered: false });
    expect(plan.args).toEqual(['--append-system-prompt-file', '/u/papeis-prompt/dev.md']);
    expect(plan.missing).toEqual(['escopo']);
  });

  it('nem papel nem escopo: as duas faltas', () => {
    expect(planRoleLaunch('claude-code', { roleId: 'dev', promptPath: null, scope: DEV_SCOPE, scopeDelivered: false }).missing).toEqual(['papel', 'escopo']);
  });

  it('sem papel pedido: nada a entregar, nada faltando', () => {
    expect(planRoleLaunch('claude-code', { roleId: undefined, promptPath: null, scope: undefined, scopeDelivered: false })).toEqual({ args: [], missing: [] });
  });

  it('escopo que declara tudo como "*": nada a gravar, então nada falta', () => {
    const plan = planRoleLaunch('claude-code', {
      roleId: 'livre',
      promptPath: '/u/papeis-prompt/livre.md',
      scope: { mcps: '*', plugins: '*', skills: '*' },
      scopeDelivered: false,
    });
    expect(plan.missing).toEqual([]);
  });
});
