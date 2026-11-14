import { describe, expect, it } from 'vitest';
import { renewalLaunchArgs } from '../src/shared/sessionRenewal';

// t-1293c818 — a session renewed in flight (B36) came back with `--permission-mode default` when it had been launched in
// bypass: the chat reads "default" whenever the transcript has no mode change, and the new process lost the bypass. It
// then stopped on every permission prompt, and only the owner, inside that tab, could answer (the place:ff3851cd, 09/11).

describe('renovação em voo mantém o modo de permissão do lançamento', () => {
  it('a session launched in bypass comes back in bypass when the chat says "default"', () => {
    const launched = ['--model', 'opus', '--permission-mode', 'bypassPermissions', '--session-id', 'old'];
    expect(renewalLaunchArgs(launched, 'default')).toEqual(['--model', 'opus', '--permission-mode', 'bypassPermissions']);
    expect(renewalLaunchArgs(['--dangerously-skip-permissions'], 'default')).toEqual(['--dangerously-skip-permissions']);
    expect(renewalLaunchArgs(['--permission-mode=auto', '-r', 'old'], 'default')).toEqual(['--permission-mode=auto']);
  });

  it('"default" read from a launch with no explicit mode is not written into the argv (t-2a9060dd)', () => {
    // A tab reattached after an update has no launch args; the renewal came back `--permission-mode default` and the
    // explicit flag beat the user default (bypass on the PC and on the VPS): every command stopped on a prompt.
    expect(renewalLaunchArgs(undefined, 'default')).toEqual([]);
    expect(renewalLaunchArgs(['--model', 'opus', '--session-id', 'old'], 'default')).toEqual(['--model', 'opus']);
  });

  it('a mode switched with Shift+Tab is still carried', () => {
    expect(renewalLaunchArgs(['--permission-mode', 'bypassPermissions'], 'plan')).toEqual(['--permission-mode', 'plan']);
    expect(renewalLaunchArgs(['--permission-mode', 'acceptEdits'], 'default')).toEqual(['--permission-mode', 'default']);
    expect(renewalLaunchArgs(['--model', 'opus'], 'acceptEdits')).toEqual(['--model', 'opus', '--permission-mode', 'acceptEdits']);
  });
});
