import { describe, expect, it } from 'vitest';
import { autoApprovalVerdict, nextClassifierBlocks, NO_CLASSIFIER_BLOCKS } from '../src/shared/chat/pendingQueue';

// Segurança: um erro aqui aprova sozinho o que não devia, ou esconde uma pergunta, sem o dono perceber.
const request = (tool_name: string, permission_mode = 'auto'): Record<string, unknown> => ({ tool_name, permission_mode });
const verdict = (payload: Record<string, unknown>, enabled = true, blocks = NO_CLASSIFIER_BLOCKS) =>
  autoApprovalVerdict({ enabled, payload, blocks });

describe('modo auto sem pedir permissão', () => {
  it('auto aprova; pergunta e plano ainda chegam ao dono; outro modo ou interruptor desligado não aprova', () => {
    expect(verdict(request('Bash'))).toBe('approve');
    expect(verdict(request('mcp__github__create_branch'))).toBe('approve');

    expect(verdict(request('AskUserQuestion'))).toBe('owner');
    expect(verdict(request('ExitPlanMode'))).toBe('owner');

    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions']) expect(verdict(request('Bash', mode))).toBe('owner');
    expect(verdict({ tool_name: 'Bash' })).toBe('owner');
    expect(verdict(request('Bash'), false)).toBe('owner');
  });

  it('não desfaz bloqueio do modo auto: para antes do limite em que o CLI troca a recusa por um pedido', () => {
    const denied = { tool_name: 'Bash' };
    const once = nextClassifierBlocks(NO_CLASSIFIER_BLOCKS, 'PermissionDenied', denied);
    const twice = nextClassifierBlocks(once, 'PermissionDenied', denied);
    expect(verdict(request('Bash'), true, once)).toBe('approve');
    expect(verdict(request('Bash'), true, twice)).toBe('after-blocks');

    // Leitura pode nem passar pelo classificador, então não prova que o CLI zerou a sequência; Bash prova.
    expect(nextClassifierBlocks(twice, 'PostToolUse', { tool_name: 'Read' })).toEqual(twice);
    expect(verdict(request('Bash'), true, nextClassifierBlocks(twice, 'PostToolUse', { tool_name: 'Bash' }))).toBe('approve');

    expect(verdict(request('Bash'), true, { consecutive: 0, total: 19 })).toBe('after-blocks');
  });
});
