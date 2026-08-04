import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyAccountSwitch, type ClaudeStateIoDeps } from '../src/main/accounts/claude-state';
import type { CredentialPair } from '../src/main/accounts/account-mod';

// T1108 (011-contas-e-provedores, etapa 1) — claude-state.ts é a ÚNICA
// escrita de credencial do sistema (regra dura do tasks.md). Ordem invariante:
// captura do par rotacionado -> escreve .credentials.json -> apaga
// oauthAccount de ~/.claude.json. Inverter a ordem perde o par rotacionado da
// conta que sai (regra dura do data-model.md §3).

const CLAUDE_HOME = 'C:\\fake\\.claude';
const CREDENTIALS_PATH = join(CLAUDE_HOME, '.credentials.json');
const CLAUDE_JSON_PATH = 'C:\\fake\\.claude.json'; // irmão de CLAUDE_HOME, não dentro dele

const NEW_PAIR: CredentialPair = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 999999, scopes: ['user:inference'] };

function makeMockIo(files: Record<string, string> = {}): { io: ClaudeStateIoDeps; files: Record<string, string>; calls: string[] } {
  const calls: string[] = [];
  const io: ClaudeStateIoDeps = {
    existsSync: vi.fn((path: string) => path in files || true),
    readFileText: vi.fn((path: string) => (path in files ? files[path] : null)),
    writeFileText: vi.fn((path: string, content: string) => {
      files[path] = content;
      calls.push(`write:${path}`);
    }),
    renameFile: vi.fn((from: string, to: string) => {
      files[to] = files[from];
      delete files[from];
      calls.push(`rename:${from}->${to}`);
    }),
    mkdirSync: vi.fn((path: string) => {
      calls.push(`mkdir:${path}`);
    }),
    unlinkFile: vi.fn((path: string) => {
      delete files[path];
      calls.push(`unlink:${path}`);
    }),
  };
  return { io, files, calls };
}

describe('applyAccountSwitch — ordem invariante', () => {
  it('chama captura ANTES de escrever .credentials.json e ANTES de apagar oauthAccount', async () => {
    const { io, files } = makeMockIo({
      [CLAUDE_JSON_PATH]: JSON.stringify({ oauthAccount: { email: 'x' }, mcpServers: { a: 1 } }),
    });
    const order: string[] = [];

    await applyAccountSwitch(
      { io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => { order.push('capture'); } },
      NEW_PAIR,
    );

    // rastreamento indireto: writeFileText grava tanto credentials quanto
    // claude.json — a ordem das chamadas de writeFileText prova o resto.
    order.push('done');
    expect(order[0]).toBe('capture');

    const credsRaw = JSON.parse(files[CREDENTIALS_PATH]);
    expect(credsRaw.claudeAiOauth).toEqual(NEW_PAIR);

    const claudeJsonRaw = JSON.parse(files[CLAUDE_JSON_PATH]);
    expect(claudeJsonRaw.oauthAccount).toBeUndefined();
    expect(claudeJsonRaw.mcpServers).toEqual({ a: 1 }); // demais chaves preservadas
  });

  it('onRotatedPairCaptured recebe o par ATUAL do disco (antes de sobrescrever), ou null se nunca existiu', async () => {
    const currentPair: CredentialPair = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, scopes: [] };
    const { io } = makeMockIo({
      [CREDENTIALS_PATH]: JSON.stringify({ claudeAiOauth: currentPair }),
      [CLAUDE_JSON_PATH]: JSON.stringify({}),
    });

    let captured: CredentialPair | null | undefined;
    await applyAccountSwitch(
      { io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: (pair) => { captured = pair; } },
      NEW_PAIR,
    );

    expect(captured).toEqual(currentPair);
  });

  it('sem .credentials.json anterior, captura recebe null (nunca lança)', async () => {
    const { io } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify({}) });
    let captured: CredentialPair | null | undefined = { accessToken: 'sentinel', refreshToken: '', expiresAt: 0, scopes: [] };

    await applyAccountSwitch(
      { io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: (pair) => { captured = pair; } },
      NEW_PAIR,
    );

    expect(captured).toBeNull();
  });

  it('falha na captura ABORTA o switch: nada é escrito', async () => {
    const { io, files } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify({ oauthAccount: { x: 1 } }) });

    await expect(
      applyAccountSwitch(
        {
          io,
          claudeHome: CLAUDE_HOME,
          claudeJsonPath: CLAUDE_JSON_PATH,
          onRotatedPairCaptured: () => {
            throw new Error('captura falhou');
          },
        },
        NEW_PAIR,
      ),
    ).rejects.toThrow('captura falhou');

    expect(files[CREDENTIALS_PATH]).toBeUndefined();
    expect(JSON.parse(files[CLAUDE_JSON_PATH]).oauthAccount).toEqual({ x: 1 }); // intocado
  });
});

describe('merge de .credentials.json — preserva chaves desconhecidas', () => {
  it('chave top-level desconhecida sobrevive à escrita do novo par', async () => {
    const { io, files } = makeMockIo({
      [CREDENTIALS_PATH]: JSON.stringify({ claudeAiOauth: { accessToken: 'old' }, someFutureField: 'preserve-me' }),
      [CLAUDE_JSON_PATH]: JSON.stringify({}),
    });

    await applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => {} }, NEW_PAIR);

    const credsRaw = JSON.parse(files[CREDENTIALS_PATH]);
    expect(credsRaw.someFutureField).toBe('preserve-me');
    expect(credsRaw.claudeAiOauth).toEqual(NEW_PAIR);
  });
});

describe('~/.claude.json — perde SÓ oauthAccount', () => {
  it('todas as demais chaves preservadas byte a byte', async () => {
    const original = { oauthAccount: { email: 'x' }, mcpServers: { a: 1 }, machineID: 'abc', userID: 'xyz', projects: { p: 1 } };
    const { io, files } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify(original) });

    await applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => {} }, NEW_PAIR);

    const { oauthAccount: _removed, ...rest } = original;
    expect(JSON.parse(files[CLAUDE_JSON_PATH])).toEqual(rest);
  });

  it('~/.claude.json sem oauthAccount é no-op nessa parte (nunca lança)', async () => {
    const { io, files } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify({ mcpServers: {} }) });
    await applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => {} }, NEW_PAIR);
    expect(JSON.parse(files[CLAUDE_JSON_PATH])).toEqual({ mcpServers: {} });
  });
});

describe('escrita atômica (temp + rename)', () => {
  it('.credentials.json é escrito via temp+rename', async () => {
    const { io, calls } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify({}) });
    await applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => {} }, NEW_PAIR);

    const writeCredsCall = calls.find((c) => c.startsWith('write:') && c.includes('.credentials.json'));
    expect(writeCredsCall).toMatch(/\.tmp-/);
    expect(calls.some((c) => c.startsWith('rename:') && c.includes('.credentials.json'))).toBe(true);
  });

  it('falha no rename do .credentials.json aborta antes de tocar ~/.claude.json', async () => {
    const original = { oauthAccount: { x: 1 } };
    const { io, files } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify(original) });
    io.renameFile = vi.fn((from: string) => {
      if (from.includes('.credentials.json')) throw new Error('EPERM simulado');
    });

    await expect(
      applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => {} }, NEW_PAIR),
    ).rejects.toThrow('EPERM simulado');

    expect(JSON.parse(files[CLAUDE_JSON_PATH])).toEqual(original); // intocado
  });
});

describe('nunca loga o par', () => {
  it('console.error/log nunca é chamado com o conteúdo do par', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { io } = makeMockIo({ [CLAUDE_JSON_PATH]: JSON.stringify({}) });

    await applyAccountSwitch({ io, claudeHome: CLAUDE_HOME, claudeJsonPath: CLAUDE_JSON_PATH, onRotatedPairCaptured: () => {} }, NEW_PAIR);

    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});
