import { describe, expect, it } from 'vitest';
import { buildPastedPair } from '../src/main/accounts/pasted-pair';

// 011-contas-e-provedores, etapa 3, Fase 1 (F2) — hoje o renderer mandava
// `expiresAt = Date.now() + 1h` (AccountsPanel.tsx:146) e o main aceitava
// qualquer número; se o token colado vencesse antes, o mod achava que
// estava válido, não disparava o refresh de fallback, e o switch gravava um
// par morto.

describe('buildPastedPair', () => {
  it('tokens válidos + expiresAt numérico -> ok, com os tokens trimados', () => {
    const result = buildPastedPair({ accessToken: '  access-1  ', refreshToken: ' refresh-1 ', expiresAt: 12345 });
    expect(result).toEqual({ kind: 'ok', pair: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 12345, scopes: [] } });
  });

  it('expiresAt undefined -> 0 (validade desconhecida tratada como vencida)', () => {
    const result = buildPastedPair({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: undefined });
    expect(result).toEqual({ kind: 'ok', pair: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 0, scopes: [] } });
  });

  it('expiresAt ausente do objeto (campo nunca passado) -> 0', () => {
    const result = buildPastedPair({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(result).toEqual({ kind: 'ok', pair: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 0, scopes: [] } });
  });

  it('expiresAt null -> 0', () => {
    const result = buildPastedPair({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null });
    expect(result).toEqual({ kind: 'ok', pair: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 0, scopes: [] } });
  });

  it('expiresAt zero é um valor válido (não confundir com ausente)', () => {
    const result = buildPastedPair({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 0 });
    expect(result).toEqual({ kind: 'ok', pair: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 0, scopes: [] } });
  });

  it('expiresAt negativo -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: 'a', refreshToken: 'r', expiresAt: -1 })).toEqual({ kind: 'invalid-input' });
  });

  it('expiresAt não-inteiro -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: 'a', refreshToken: 'r', expiresAt: 12.5 })).toEqual({ kind: 'invalid-input' });
  });

  it('expiresAt não finito (Infinity) -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: 'a', refreshToken: 'r', expiresAt: Infinity })).toEqual({ kind: 'invalid-input' });
  });

  it('expiresAt string -> invalid-input (nunca vira 0 por silêncio; só a ausência explícita tem esse tratamento)', () => {
    expect(buildPastedPair({ accessToken: 'a', refreshToken: 'r', expiresAt: '12345' })).toEqual({ kind: 'invalid-input' });
  });

  it('accessToken ausente -> invalid-input', () => {
    expect(buildPastedPair({ refreshToken: 'r', expiresAt: 1 })).toEqual({ kind: 'invalid-input' });
  });

  it('accessToken vazio após trim -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: '   ', refreshToken: 'r', expiresAt: 1 })).toEqual({ kind: 'invalid-input' });
  });

  it('refreshToken ausente -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: 'a', expiresAt: 1 })).toEqual({ kind: 'invalid-input' });
  });

  it('refreshToken não-string -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: 'a', refreshToken: 42, expiresAt: 1 })).toEqual({ kind: 'invalid-input' });
  });

  it('accessToken não-string -> invalid-input', () => {
    expect(buildPastedPair({ accessToken: 42, refreshToken: 'r', expiresAt: 1 })).toEqual({ kind: 'invalid-input' });
  });
});
