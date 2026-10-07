import { describe, expect, it } from 'vitest';
import {
  accountFingerprintFromClaudeJsonText,
  extractPairFromCredentialsJson,
  readCredentialsPairFromText,
} from '../src/main/accounts/credentials-file';

// 011-contas-e-provedores, etapa 3, Fase 1, Bloco 1 — leitura PURA dos dois
// arquivos que `/login` grava num CLAUDE_CONFIG_DIR isolado
// (research-etapa-3-cli.md A6): `.credentials.json` (par OAuth, com
// `expiresAt`/`scopes` REAIS — nunca um prazo chutado) e `.claude.json`
// (fingerprint OPACO da conta — sha256 do `accountUuid`, nunca e-mail/nome).

const VALID_CREDENTIALS_JSON = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'sk-ant-access-real',
    refreshToken: 'sk-ant-refresh-real',
    expiresAt: 1_800_000_000_000,
    scopes: ['user:inference', 'user:profile'],
  },
});

describe('readCredentialsPairFromText', () => {
  it('null (arquivo ainda não existe) -> absent', () => {
    expect(readCredentialsPairFromText(null)).toEqual({ kind: 'absent' });
  });

  it('JSON malformado -> invalid-format (pode ser escrita parcial do CLI)', () => {
    expect(readCredentialsPairFromText('{ "claudeAiOauth": ')).toEqual({ kind: 'invalid-format' });
  });

  it('JSON válido mas sem claudeAiOauth -> invalid-format', () => {
    expect(readCredentialsPairFromText(JSON.stringify({ somethingElse: true }))).toEqual({ kind: 'invalid-format' });
  });

  it('claudeAiOauth sem os campos obrigatórios -> invalid-format', () => {
    const text = JSON.stringify({ claudeAiOauth: { accessToken: 'x' } });
    expect(readCredentialsPairFromText(text)).toEqual({ kind: 'invalid-format' });
  });

  it('par válido preserva expiresAt e scopes REAIS do arquivo (nunca um prazo chutado)', () => {
    const result = readCredentialsPairFromText(VALID_CREDENTIALS_JSON);
    expect(result).toEqual({
      kind: 'ok',
      pair: {
        accessToken: 'sk-ant-access-real',
        refreshToken: 'sk-ant-refresh-real',
        expiresAt: 1_800_000_000_000,
        scopes: ['user:inference', 'user:profile'],
      },
    });
  });

  it('scopes ausente vira array vazio; scopes com entradas não-string são filtradas', () => {
    const withoutScopes = JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'b', expiresAt: 1 } });
    expect(readCredentialsPairFromText(withoutScopes)).toEqual({
      kind: 'ok',
      pair: { accessToken: 'a', refreshToken: 'b', expiresAt: 1, scopes: [] },
    });

    const withMixedScopes = JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'b', expiresAt: 1, scopes: ['ok', 42, null] } });
    expect(readCredentialsPairFromText(withMixedScopes)).toEqual({
      kind: 'ok',
      pair: { accessToken: 'a', refreshToken: 'b', expiresAt: 1, scopes: ['ok'] },
    });
  });
});

describe('extractPairFromCredentialsJson (exportado — usado também pela migração de perfis)', () => {
  it('extrai o par de um objeto já parseado', () => {
    expect(extractPairFromCredentialsJson(JSON.parse(VALID_CREDENTIALS_JSON))).toEqual({
      accessToken: 'sk-ant-access-real',
      refreshToken: 'sk-ant-refresh-real',
      expiresAt: 1_800_000_000_000,
      scopes: ['user:inference', 'user:profile'],
    });
  });

  it('valor não-objeto -> null', () => {
    expect(extractPairFromCredentialsJson('not-an-object')).toBeNull();
    expect(extractPairFromCredentialsJson(null)).toBeNull();
    expect(extractPairFromCredentialsJson(42)).toBeNull();
  });
});

describe('accountFingerprintFromClaudeJsonText', () => {
  it('null (arquivo ainda não existe) -> null', () => {
    expect(accountFingerprintFromClaudeJsonText(null)).toBeNull();
  });

  it('JSON malformado -> null', () => {
    expect(accountFingerprintFromClaudeJsonText('{ not json')).toBeNull();
  });

  it('sem oauthAccount -> null', () => {
    expect(accountFingerprintFromClaudeJsonText(JSON.stringify({ somethingElse: true }))).toBeNull();
  });

  it('accountUuid ausente, vazio ou não-string -> null', () => {
    expect(accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: {} }))).toBeNull();
    expect(accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: { accountUuid: '' } }))).toBeNull();
    expect(accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: { accountUuid: 42 } }))).toBeNull();
  });

  it('accountUuid válido -> sha256 hex determinístico (vetor de teste conhecido)', () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const result = accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: { accountUuid: 'abc' } }));
    expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('mesmo accountUuid -> mesmo fingerprint; accountUuid diferente -> fingerprint diferente', () => {
    const a1 = accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: { accountUuid: 'uuid-a' } }));
    const a2 = accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: { accountUuid: 'uuid-a' } }));
    const b = accountFingerprintFromClaudeJsonText(JSON.stringify({ oauthAccount: { accountUuid: 'uuid-b' } }));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('nunca devolve outro campo do .claude.json (LGPD) — só o hash sai', () => {
    const text = JSON.stringify({ oauthAccount: { accountUuid: 'uuid-a', emailAddress: 'pessoa@example.com', organizationName: 'Empresa X' } });
    const result = accountFingerprintFromClaudeJsonText(text);
    expect(result).not.toContain('@');
    expect(result).not.toContain('Empresa');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
