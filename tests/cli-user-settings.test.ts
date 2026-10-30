// T017/T018 (014-chat) — reads ONLY permissions.defaultMode from ~/.claude/settings.json.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeStatusLineLayers,
  parseDefaultPermissionMode,
  parseRawStatusLine,
  readUserDefaultPermissionMode,
  readUserStatusLine,
} from '../src/main/cli-user-settings';

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

// Ponte da statusline — a statusLine que o usuário já tem, nas camadas do CLI.
describe('statusLine do usuário', () => {
  it('parseRawStatusLine pega só a chave statusLine (objeto)', () => {
    expect(parseRawStatusLine('{"statusLine":{"type":"command","command":"x"},"env":{"T":"s"}}')).toEqual({ type: 'command', command: 'x' });
    expect(parseRawStatusLine('{"statusLine":"x"}')).toBeUndefined();
    expect(parseRawStatusLine('nope')).toBeUndefined();
    expect(parseRawStatusLine('{}')).toBeUndefined();
  });

  it('mergeStatusLineLayers: a última camada vence campo a campo; só type command com comando conta', () => {
    expect(mergeStatusLineLayers([{ type: 'command', command: 'a', padding: 2 }, { command: 'b' }])).toEqual({ command: 'b', padding: 2 });
    expect(mergeStatusLineLayers([{ type: 'command', command: '   ' }])).toBeNull();
    expect(mergeStatusLineLayers([{ type: 'other', command: 'a' }])).toBeNull();
    expect(mergeStatusLineLayers([undefined, undefined])).toBeNull();
    expect(
      mergeStatusLineLayers([{ type: 'command', command: 'a', refreshInterval: 5, hideVimModeIndicator: true, padding: 'x', extra: 1 }]),
    ).toEqual({ command: 'a', refreshInterval: 5, hideVimModeIndicator: true });
    expect(mergeStatusLineLayers([{ type: 'command', command: 'a', refreshInterval: 0 }])).toEqual({ command: 'a' });
  });

  it('readUserStatusLine lê user < project < local pelo cwd da sessão', () => {
    const files: Record<string, string> = {
      [join('C:/h/.claude', 'settings.json')]: '{"statusLine":{"type":"command","command":"user.sh","padding":1}}',
      [join('C:/p', '.claude', 'settings.local.json')]: '{"statusLine":{"command":"local.sh"}}',
    };
    const read = (path: string): string => {
      if (!(path in files)) throw new Error('ENOENT');
      return files[path];
    };
    expect(readUserStatusLine('C:/h/.claude', 'C:/p', read)).toEqual({ command: 'local.sh', padding: 1 });
    expect(readUserStatusLine('C:/h/.claude', undefined, read)).toEqual({ command: 'user.sh', padding: 1 });
    expect(readUserStatusLine('C:/vazio', 'C:/nada', read)).toBeNull();
  });
});
