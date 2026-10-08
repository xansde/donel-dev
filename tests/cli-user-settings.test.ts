// T017/T018 (014-chat) — reads ONLY permissions.defaultMode from ~/.claude/settings.json.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDefaultPermissionMode, readUserDefaultPermissionMode } from '../src/main/cli-user-settings';

describe('parseDefaultPermissionMode (puro)', () => {
  it('extrai permissions.defaultMode', () => {
    expect(parseDefaultPermissionMode('{"permissions":{"defaultMode":"acceptEdits"}}')).toBe('acceptEdits');
  });
  it('ignora o resto do arquivo e tolera JSON inválido, ausência e tipos errados', () => {
    expect(parseDefaultPermissionMode('{"env":{"TOKEN":"x"}}')).toBeUndefined();
    expect(parseDefaultPermissionMode('not json')).toBeUndefined();
    expect(parseDefaultPermissionMode('')).toBeUndefined();
    expect(parseDefaultPermissionMode('[]')).toBeUndefined();
    expect(parseDefaultPermissionMode('{"permissions":{"defaultMode":3}}')).toBeUndefined();
    expect(parseDefaultPermissionMode('{"permissions":"x"}')).toBeUndefined();
  });
});

describe('readUserDefaultPermissionMode', () => {
  it('lê pelo caminho injetado e devolve só o modo', () => {
    const seen: string[] = [];
    const read = (path: string): string => {
      seen.push(path);
      return '{"permissions":{"defaultMode":"plan"},"apiKeyHelper":"secret"}';
    };
    expect(readUserDefaultPermissionMode('C:\h\.claude', read)).toBe('plan');
    expect(seen).toEqual([join('C:\h\.claude', 'settings.json')]);
  });
  it('arquivo ausente (read lança) → undefined', () => {
    expect(readUserDefaultPermissionMode('C:\h\.claude', () => { throw new Error('ENOENT'); })).toBeUndefined();
  });
});
