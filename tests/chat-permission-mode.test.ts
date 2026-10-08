import { describe, expect, it, vi } from 'vitest';
import { BACK_TAB, forwardBackTab, permissionModeLabel } from '../src/renderer/src/chat/cycleMode';
import { readPermissionMode } from '../src/shared/chat/screen';

// 014-chat - Shift+Tab on the composer is handed to the CLI (it cycles the permission mode) and the hint under
// the box shows the mode the footer of the CLI reports. Footer strings are the real ones (CLI 2.1.293 fixtures).

const bar = '─'.repeat(40);
const screen = (footer: string, box = '❯ '): string[] => ['Claude Code', '', bar, box, bar, footer];

describe('readPermissionMode', () => {
  it('reads the default (manual) mode', () => {
    expect(readPermissionMode(screen('  ⏸ manual mode on · ? for shortcuts · ← for agents'))).toBe('default');
  });
  it('reads accept edits', () => {
    expect(readPermissionMode(screen('  ⏵⏵ accept edits on (shift+tab to cycle)'))).toBe('acceptEdits');
  });
  it('reads plan mode', () => {
    expect(readPermissionMode(screen('  ⏸ plan mode on (shift+tab to cycle)'))).toBe('plan');
  });
  it('reads bypass permissions, even while working', () => {
    expect(readPermissionMode(screen('  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for agents'))).toBe('bypass');
  });
  it('is null when the footer shows no mode', () => {
    expect(readPermissionMode(screen('  ? for shortcuts'))).toBeNull();
  });
  it('is null without an input box (a dialog is up)', () => {
    expect(readPermissionMode(['Exit plan mode?', '  ⏸ plan mode on'])).toBeNull();
  });
  it('ignores mode words typed inside the box or printed above it', () => {
    expect(readPermissionMode(['plan mode on', ...screen('  ? for shortcuts', '❯ plan mode on')])).toBeNull();
  });
});

describe('permissionModeLabel', () => {
  it('has a pt-BR label per mode', () => {
    expect(permissionModeLabel('default')).toBe('padrão');
    expect(permissionModeLabel('acceptEdits')).toBe('aceitar edições');
    expect(permissionModeLabel('plan')).toBe('plano');
    expect(permissionModeLabel('bypass')).toBe('bypass');
  });
});

describe('forwardBackTab', () => {
  const terminal = (lines: string[]) => ({ readScreen: () => ({ lines }), write: vi.fn(() => true) });

  it('writes the back-tab sequence the xterm sends', () => {
    expect(BACK_TAB).toBe('\x1b[Z');
    const t = terminal(screen('  ⏸ manual mode on · ? for shortcuts'));
    expect(forwardBackTab(t)).toBe(true);
    expect(t.write).toHaveBeenCalledWith(BACK_TAB);
  });
  it('writes with a mode-less footer too (the box may hold text)', () => {
    const t = terminal(screen('  ? for shortcuts'));
    expect(forwardBackTab(t)).toBe(true);
  });
  it('does not write while a CLI dialog holds the screen (it would navigate the dialog)', () => {
    const t = terminal(['', '  Exit plan mode?', '', ' 1. Yes', ' 2. No']);
    expect(forwardBackTab(t)).toBe(false);
    expect(t.write).not.toHaveBeenCalled();
  });
  it('is a no-op without a terminal', () => {
    expect(forwardBackTab(null)).toBe(false);
  });
});
