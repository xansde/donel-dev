import { describe, expect, it } from 'vitest';
import { planRoleLaunch } from '../src/shared/roleLaunch';

// Papel não entregue (ideia do OpenRig 0.7.9): a session launched with a role that could not be delivered must say
// so, never open silently without the role or with more MCPs than the role allows.

describe('planRoleLaunch', () => {
  it('papel entregue e escopo gravado: args do papel, nada faltando', () => {
    expect(planRoleLaunch('claude-code', { roleId: 'dev', promptPath: '/u/papeis-prompt/dev.md', scopeDeclared: true, scopeDelivered: true })).toEqual({
      args: ['--append-system-prompt-file', '/u/papeis-prompt/dev.md'],
      missing: [],
    });
  });

  it('papel pedido sem arquivo: sem --append-system-prompt-file e falta "papel"', () => {
    const plan = planRoleLaunch('claude-code', { roleId: 'dev', promptPath: null, scopeDeclared: false, scopeDelivered: false });
    expect(plan.args).not.toContain('--append-system-prompt-file');
    expect(plan.missing).toEqual(['papel']);
  });

  it('escopo declarado que não gravou: falta "escopo"', () => {
    const plan = planRoleLaunch('claude-code', { roleId: 'dev', promptPath: '/u/papeis-prompt/dev.md', scopeDeclared: true, scopeDelivered: false });
    expect(plan.args).toEqual(['--append-system-prompt-file', '/u/papeis-prompt/dev.md']);
    expect(plan.missing).toEqual(['escopo']);
  });

  it('nem papel nem escopo: as duas faltas', () => {
    expect(planRoleLaunch('claude-code', { roleId: 'dev', promptPath: null, scopeDeclared: true, scopeDelivered: false }).missing).toEqual(['papel', 'escopo']);
  });

  it('sem papel pedido: nada a entregar, nada faltando', () => {
    expect(planRoleLaunch('claude-code', { roleId: undefined, promptPath: null, scopeDeclared: false, scopeDelivered: false })).toEqual({ args: [], missing: [] });
  });
});
