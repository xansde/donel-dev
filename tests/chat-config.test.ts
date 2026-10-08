// T007 (014-chat) — `chat.enabled` / `chat.focusMode` in the config store.
import { describe, expect, it } from 'vitest';
import {
  defaultAppConfig,
  mergeConfigForWrite,
  sanitizeAppConfig,
  toAppConfigDto,
  type AppConfig,
} from '../src/main/config-store';

const ROOTS = ['C:\Users\fake\seazone'];
const defaults = (): AppConfig => defaultAppConfig(ROOTS);

describe('chat config (puro)', () => {
  it('defaults: enabled=false (R22 incremental switch), focusMode=true (FR-009)', () => {
    expect(defaults().chat).toEqual({ enabled: false, focusMode: true });
    expect(toAppConfigDto(defaults()).chat).toEqual({ enabled: false, focusMode: true });
  });

  it('sanitize keeps valid booleans', () => {
    const sanitized = sanitizeAppConfig({ chat: { enabled: true, focusMode: false } }, defaults());
    expect(sanitized.chat).toEqual({ enabled: true, focusMode: false });
  });

  it('sanitize falls back per field on invalid values', () => {
    expect(sanitizeAppConfig({ chat: { enabled: 'yes', focusMode: 0 } }, defaults()).chat).toEqual({ enabled: false, focusMode: true });
    expect(sanitizeAppConfig({ chat: { enabled: true, focusMode: null } }, defaults()).chat).toEqual({ enabled: true, focusMode: true });
  });

  it('sanitize falls back to defaults when chat is missing or not an object', () => {
    for (const bad of [undefined, null, 'x', 42, [], true]) {
      expect(sanitizeAppConfig({ chat: bad }, defaults()).chat).toEqual({ enabled: false, focusMode: true });
    }
    expect(sanitizeAppConfig({}, defaults()).chat).toEqual({ enabled: false, focusMode: true });
  });

  it('an older build (schema without `chat`) keeps the key in unknownFields and writes it back', () => {
    const { chat: _chat, ...oldDefaults } = defaults();
    const oldSchema = oldDefaults as unknown as AppConfig;
    const stored = { chat: { enabled: true, focusMode: false } };
    const sanitized = sanitizeAppConfig(stored, oldSchema);
    expect(sanitized.unknownFields).toEqual({ chat: { enabled: true, focusMode: false } });
    // The older build rewrites the file without having touched `chat`: the key survives.
    const written = mergeConfigForWrite({}, sanitized, sanitized);
    expect(written.chat).toEqual({ enabled: true, focusMode: false });
    expect('unknownFields' in written).toBe(false);
  });
});
