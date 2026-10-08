import { describe, expect, it } from 'vitest';
import { effectiveTabView, hasChatView, nextTabView, shouldHandleViewShortcut } from '../src/renderer/src/chat/tabView';

const claude = { sessionType: 'claude' as const };

describe('hasChatView', () => {
  it('needs chat.enabled and a claude tab that is not a login tab', () => {
    expect(hasChatView(claude, true)).toBe(true);
    expect(hasChatView(claude, false)).toBe(false);
    expect(hasChatView({ sessionType: 'shell' }, true)).toBe(false);
    expect(hasChatView({ ...claude, accountLoginId: 'login-1' }, true)).toBe(false);
  });
});

describe('effectiveTabView', () => {
  it('defaults to chat when the tab has a chat view', () => {
    expect(effectiveTabView(claude, true)).toBe('chat');
  });
  it('honours the explicit choice', () => {
    expect(effectiveTabView({ ...claude, view: 'terminal' }, true)).toBe('terminal');
  });
  it('is always terminal without a chat view (chat disabled = the app as today)', () => {
    expect(effectiveTabView(claude, false)).toBe('terminal');
    expect(effectiveTabView({ sessionType: 'shell', view: 'chat' }, true)).toBe('terminal');
  });
});

describe('nextTabView', () => {
  it('toggles between the two views', () => {
    expect(nextTabView('chat')).toBe('terminal');
    expect(nextTabView('terminal')).toBe('chat');
  });
});

describe('shouldHandleViewShortcut (Ctrl+`)', () => {
  const key = (over: Partial<{ key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
    key: '`', code: 'Backquote', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, ...over,
  });
  it('matches Ctrl+` by key or by physical key', () => {
    expect(shouldHandleViewShortcut(key({}))).toBe(true);
    expect(shouldHandleViewShortcut(key({ key: 'Dead' }))).toBe(true);
  });
  it('ignores other modifiers and keys', () => {
    expect(shouldHandleViewShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(shouldHandleViewShortcut(key({ altKey: true }))).toBe(false);
    expect(shouldHandleViewShortcut(key({ key: 'a', code: 'KeyA' }))).toBe(false);
  });
});
