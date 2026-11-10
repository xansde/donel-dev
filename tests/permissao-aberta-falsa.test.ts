import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeListener, HookBridge } from '../src/main/hook-bridge';
import { SessionSemaphoreManager } from '../src/main/session-semaphore-manager';
import { planLaunchPermission } from '../src/shared/launchPermission';
import { renewalLaunchArgs } from '../src/shared/sessionRenewal';

// 10/11 — sessões em bypass paravam como "precisa do dono: há uma permissão aberta na tela dela" (Theo, Dev Fable,
// Revisor, este Dev), e o Líder era avisado de novo a cada poucos minutos. Duas causas:
// 1. a renovação em voo de uma sessão em bypass subia a nova em `--permission-mode default` (o Theo parou num Read da
//    própria passagem de bastão, fora da pasta do projeto);
// 2. a heurística do semáforo achava "Do you want to proceed?" / "1. Yes" no texto recente da aba (uma saída de
//    comando, uma mensagem citando um diálogo) durante qualquer ferramenta de mais de 2,5 s, e marcava "permissão"
//    numa sessão em que o CLI não abre diálogo de ferramenta.

describe('renovação em voo herda o bypass da sessão anterior', () => {
  it('a sessão anterior em bypass (lido do transcript) renasce em bypass, mesmo sem o modo nos argumentos da aba', () => {
    const args = renewalLaunchArgs(['--model', 'opus', '--session-id', 'old'], 'bypassPermissions');
    expect(args).toEqual(['--model', 'opus', '--permission-mode', 'bypassPermissions']);
    // e o main dá a variável junto, para qualquer papel
    expect(planLaunchPermission(args, { roleId: 'theo-west' }, 'default').env).toEqual({ CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1' });
  });

  it('troca um modo menor que a aba carregava pelo bypass em que a sessão estava', () => {
    expect(renewalLaunchArgs(['--permission-mode', 'default', '--model', 'opus'], 'bypassPermissions')).toEqual(['--model', 'opus', '--permission-mode', 'bypassPermissions']);
  });

  it('modo desconhecido ("default" é também o que o chat lê sem registro) não rebaixa um lançamento em bypass', () => {
    expect(renewalLaunchArgs(['--permission-mode', 'bypassPermissions'], 'default')).toEqual(['--permission-mode', 'bypassPermissions']);
  });
});

describe('semáforo: texto de diálogo na saída não é permissão aberta numa sessão em bypass', () => {
  afterEach(() => vi.useRealTimers());

  function setup(bypass: boolean) {
    vi.useFakeTimers();
    let clock = 1_000_000;
    const listeners: BridgeListener[] = [];
    const bridge = { onAny: (listener: BridgeListener) => (listeners.push(listener), () => undefined) } as unknown as HookBridge;
    const screen = ['  ⎿  $ ./mostra.sh', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', ' Esc to cancel · Tab to amend'];
    const manager = new SessionSemaphoreManager({
      now: () => clock,
      tickIntervalMs: 500,
      permissionHeuristicTimeoutMs: 2500,
      getRecentLines: () => screen,
      permissionPromptsPossible: () => !bypass,
    });
    manager.attachBridge(bridge);
    manager.registerSession('pty-1', 'sid-1');
    const hook = (event: string, payload: Record<string, unknown> = {}) => {
      for (const listener of listeners) listener({ type: 'hook', ptyId: 'pty-1', event, payload: { hook_event_name: event, ...payload } });
    };
    const wait = (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    };
    return { manager, hook, wait };
  }

  it('em bypass, uma ferramenta longa com o texto do diálogo na tela segue "trabalhando"', () => {
    const { manager, hook, wait } = setup(true);
    hook('UserPromptSubmit');
    hook('PreToolUse', { tool_name: 'Bash' });
    wait(10_000);
    expect(manager.getSnapshot('pty-1')?.state).toBe('working');
  });

  it('fora do bypass a heurística continua valendo (o diálogo pode ser de verdade)', () => {
    const { manager, hook, wait } = setup(false);
    hook('UserPromptSubmit');
    hook('PreToolUse', { tool_name: 'Bash' });
    wait(10_000);
    expect(manager.getSnapshot('pty-1')?.state).toBe('permission');
  });

  it('em bypass, o aviso do próprio CLI (Notification de permissão) ainda marca "permissão"', () => {
    const { manager, hook } = setup(true);
    hook('UserPromptSubmit');
    hook('Notification', { notification_type: 'permission_prompt' });
    expect(manager.getSnapshot('pty-1')?.state).toBe('permission');
  });
});
