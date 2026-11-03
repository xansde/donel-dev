import { describe, expect, it } from 'vitest';
import { autoApprovalVerdict, nextClassifierBlocks, NO_CLASSIFIER_BLOCKS } from '../src/shared/chat/pendingQueue';
import { projectOfFolders, tabFolders, withProjectYolo } from '../src/shared/projectYolo';

// Segurança: um erro aqui aprova sozinho o que não devia, ou esconde uma pergunta, sem o dono perceber.
const request = (tool_name: string, permission_mode = 'auto'): Record<string, unknown> => ({ tool_name, permission_mode });
const verdict = (payload: Record<string, unknown>, enabled = true, blocks = NO_CLASSIFIER_BLOCKS) =>
  autoApprovalVerdict({ enabled, yolo: false, payload, blocks });

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

describe('Modo YOLO por projeto', () => {
  const yolo = (payload: Record<string, unknown>, blocks = NO_CLASSIFIER_BLOCKS) =>
    autoApprovalVerdict({ enabled: false, yolo: true, payload, blocks });

  it('aprova em qualquer modo e depois de bloqueios; pergunta ainda chega ao dono; sem YOLO nada muda', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto']) expect(yolo(request('Bash', mode))).toBe('yolo');
    expect(yolo({ tool_name: 'Bash' })).toBe('yolo');
    expect(yolo(request('Bash'), { consecutive: 2, total: 19 })).toBe('yolo');

    for (const card of ['AskUserQuestion', 'ExitPlanMode', 'OfferChromeSetup', 'PublishPlugin', 'ShowOnboardingRolePicker']) {
      expect(yolo(request(card))).toBe('owner');
    }

    expect(verdict(request('Bash', 'default'))).toBe('owner');
    expect(verdict(request('Bash'), true, { consecutive: 2, total: 2 })).toBe('after-blocks');
  });

  it('a aba vale pelo projeto: subpasta e worktree contam, projeto vizinho de nome parecido não', () => {
    const app = 'C:\\repos\\App';
    const inYolo = (folders: readonly string[]) => projectOfFolders(folders, [app]) !== null;

    expect(inYolo(['c:/repos/app/'])).toBe(true);
    expect(inYolo(['C:\\repos\\App\\packages\\web'])).toBe(true);
    expect(inYolo(tabFolders('C:\\repos\\App\\.claude\\worktrees\\x', app))).toBe(true);
    expect(inYolo(tabFolders('C:\\repos\\App-wt', app))).toBe(true);

    expect(inYolo(['C:\\repos\\App-publico'])).toBe(false);
    expect(inYolo(tabFolders('C:\\repos\\App-publico', 'C:\\repos\\App-publico'))).toBe(false);
    expect(inYolo([])).toBe(false);
  });

  it('desligar tira o projeto mesmo quando a marca vem de uma pasta acima dele', () => {
    const projects = withProjectYolo([], 'C:\\repos', true);
    expect(withProjectYolo(projects, 'C:\\repos\\App', true)).toEqual(['C:\\repos']);
    expect(withProjectYolo(projects, 'c:/repos/app', false)).toEqual([]);
  });
});
