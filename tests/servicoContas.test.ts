import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialPair } from '../src/main/accounts/account-mod';
import type { RemoteClaudeState, RemoteReadResult, RemoteWriteResult } from '../src/main/accounts/remote-claude-state';
import { createServicoContas, servicoPathsFor } from '../src/main/accounts/servico/servico-contas';
import { createKeyCipher } from '../src/main/accounts/servico/vault-key-cipher';
import { decryptVaultEntry, createSystemVaultIoDeps } from '../src/main/accounts/vault';

// Serviço da VPS (ADR 0008): o que quebraria sem o dono perceber — token em
// texto plano no disco, token numa resposta de comando, ou cofre legível com
// outra chave.

function pair(tag: string): CredentialPair {
  return { accessToken: `at-${tag}-secret`, refreshToken: `rt-${tag}-secret`, expiresAt: 4_102_444_800_000, scopes: ['user:inference'] };
}

const fingerprintOf = (uuid: string): string => createHash('sha256').update(uuid, 'utf8').digest('hex');

class FakeRemote implements RemoteClaudeState {
  constructor(public current: CredentialPair | null, public fingerprint: string | null) {}
  async read(): Promise<RemoteReadResult> {
    return { kind: 'ok', pair: this.current, fingerprint: this.fingerprint };
  }
  async write(_target: string, _expected: string | null, next: CredentialPair | null): Promise<RemoteWriteResult> {
    this.current = next;
    return { kind: 'written' };
  }
}

const usageFetch = async () => ({ status: 200, json: async () => ({ five_hour: { utilization: 10 }, seven_day: { utilization: 20 } }) });

describe('serviço de contas da VPS', () => {
  let home: string | null = null;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
  });

  it('colhe e adota para o cofre cifrado, apaga o par da pasta de login e nunca devolve token', async () => {
    home = mkdtempSync(join(tmpdir(), 'donel-servico-'));
    const paths = servicoPathsFor(home);
    const key = randomBytes(32);
    const remote = new FakeRemote(pair('homolog'), fingerprintOf('uuid-homolog'));
    const contas = createServicoContas({ paths, cipher: createKeyCipher(key), remoteState: remote, fetchImpl: usageFetch, polling: false });
    await contas.start();

    const loginDir = join(home, 'login-conta-9');
    mkdirSync(loginDir);
    writeFileSync(join(loginDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: pair('nova') }));
    writeFileSync(join(loginDir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'uuid-nova', emailAddress: 'x@y' } }));

    const responses: unknown[] = [];
    responses.push(await contas.definirLugar('homologacoes', 'Homologações', 'dev@vps-atlas'));
    const colhida = await contas.colher(loginDir, 'Conta 9');
    responses.push(colhida);
    const adotada = await contas.adotar('homologacoes', 'Conta 8');
    responses.push(adotada);
    responses.push(await contas.estado());
    contas.dispose();

    expect(colhida.ok).toBe(true);
    expect(adotada.ok).toBe(true);
    // A pasta do login não guarda mais o par: ele mora só no cofre.
    expect(existsSync(join(loginDir, '.credentials.json'))).toBe(false);

    // Nenhum token em resposta, no cofre em claro, na config ou no log.
    const onDisk = [paths.vaultPath, paths.configPath, paths.logPath].map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const text of [JSON.stringify(responses), onDisk]) {
      expect(text).not.toContain('secret');
      expect(text).not.toContain('x@y');
    }

    // O cofre abre com a chave do serviço, e só com ela.
    const io = createSystemVaultIoDeps();
    const id = (colhida as unknown as { conta: string }).conta;
    expect(JSON.parse(decryptVaultEntry(paths.vaultPath, createKeyCipher(key), io, id) ?? 'null')).toEqual(pair('nova'));
    expect(decryptVaultEntry(paths.vaultPath, createKeyCipher(randomBytes(32)), io, id)).toBeNull();

    // Homologações ficou com a conta adotada, e o serviço sabe disso depois de reiniciar.
    const saved = JSON.parse(readFileSync(paths.configPath, 'utf8')) as { accounts: { remotes: { id: string; activeAccountId: string }[] } };
    expect(saved.accounts.remotes[0].activeAccountId).toBe((adotada as unknown as { conta: string }).conta);
  });

  it('sem chave, o cofre recusa gravar e a conta não entra', async () => {
    home = mkdtempSync(join(tmpdir(), 'donel-servico-'));
    const paths = servicoPathsFor(home);
    const contas = createServicoContas({ paths, cipher: createKeyCipher(null), remoteState: new FakeRemote(null, null), fetchImpl: usageFetch, polling: false });
    await contas.start();
    const loginDir = join(home, 'login');
    mkdirSync(loginDir);
    writeFileSync(join(loginDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: pair('nova') }));
    writeFileSync(join(loginDir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'uuid-nova' } }));

    expect(await contas.colher(loginDir, 'Conta 9')).toEqual({ ok: false, reason: 'cofre-sem-chave' });
    // O par continua na pasta: nada se perdeu.
    expect(existsSync(join(loginDir, '.credentials.json'))).toBe(true);
    contas.dispose();
  });
});
