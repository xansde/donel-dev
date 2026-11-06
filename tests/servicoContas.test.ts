import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialPair } from '../src/main/accounts/account-mod';
import { createServicoContas, servicoPathsFor, type ServicoPaths } from '../src/main/accounts/servico/servico-contas';
import { createKeyCipher } from '../src/main/accounts/servico/vault-key-cipher';
import { decryptVaultEntry, createSystemVaultIoDeps } from '../src/main/accounts/vault';

// Serviço da VPS (ADR 0008 e 0009): o que quebraria sem o dono perceber —
// token em texto plano no disco, token numa resposta de comando, cofre legível
// com outra chave, ou a VPS parada numa conta cheia com o PC desligado.

function pair(tag: string): CredentialPair {
  return { accessToken: `at-${tag}-secret`, refreshToken: `rt-${tag}-secret`, expiresAt: 4_102_444_800_000, scopes: ['user:inference'] };
}

/** Carga de cada conta pelo token que chega no Authorization (nenhuma conta real, nenhuma rede). */
function usageFetchFor(loads: Record<string, number>) {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    if (!url.endsWith('/api/oauth/usage')) return { status: 404, json: async () => ({}) };
    const token = (init?.headers?.Authorization ?? '').replace('Bearer ', '');
    const load = loads[token];
    if (load === undefined) return { status: 401, json: async () => ({}) };
    return { status: 200, json: async () => ({ five_hour: { utilization: load }, seven_day: { utilization: 20 } }) };
  };
}

const usageFetch = usageFetchFor({ 'at-aqui-secret': 10, 'at-nova-secret': 10 });

/** O `~/.claude` desta VPS logado na conta `tag`, como o CLI deixa depois do /login. */
function loginHere(paths: ServicoPaths, tag: string): void {
  mkdirSync(paths.claudeHome, { recursive: true });
  writeFileSync(join(paths.claudeHome, '.credentials.json'), JSON.stringify({ claudeAiOauth: pair(tag) }));
  writeFileSync(paths.claudeJsonPath, JSON.stringify({ oauthAccount: { accountUuid: `uuid-${tag}`, emailAddress: 'x@y' } }));
}

/** Pasta de login isolado (`CLAUDE_CONFIG_DIR=<pasta> claude`, /login) com a conta `tag`. */
function loginDirWith(home: string, tag: string): string {
  const dir = join(home, `login-${tag}`);
  mkdirSync(dir);
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: pair(tag) }));
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: `uuid-${tag}`, emailAddress: 'x@y' } }));
  return dir;
}

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
    loginHere(paths, 'aqui');
    const contas = createServicoContas({ paths, cipher: createKeyCipher(key), fetchImpl: usageFetch, polling: false });
    await contas.start();

    const loginDir = loginDirWith(home, 'nova');
    const responses: unknown[] = [];
    const colhida = await contas.colher(loginDir, 'Conta 9');
    responses.push(colhida);
    const adotada = await contas.adotar('Conta 8');
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

    // A VPS ficou com a conta adotada, e o serviço sabe disso depois de reiniciar. Nenhum outro lugar.
    const saved = JSON.parse(readFileSync(paths.configPath, 'utf8')) as { accounts: { activeAccountId: string; remotes: unknown[] } };
    expect(saved.accounts.activeAccountId).toBe((adotada as unknown as { conta: string }).conta);
    expect(saved.accounts.remotes).toEqual([]);
  });

  it('sem o PC, troca sozinho a conta desta VPS quando ela passa de 90%', async () => {
    home = mkdtempSync(join(tmpdir(), 'donel-servico-'));
    const paths = servicoPathsFor(home);
    const key = randomBytes(32);
    // Monta o conjunto desta VPS: a conta logada aqui (adotada) e uma reserva (colhida).
    loginHere(paths, 'cheia');
    const setup = createServicoContas({ paths, cipher: createKeyCipher(key), fetchImpl: usageFetchFor({ 'at-cheia-secret': 50, 'at-folga-secret': 10 }), polling: false });
    await setup.start();
    expect((await setup.adotar('Conta cheia')).ok).toBe(true);
    const reserva = await setup.colher(loginDirWith(home, 'folga'), 'Conta folga');
    expect(reserva.ok).toBe(true);
    setup.dispose();

    // O systemd sobe o serviço de novo; a conta ativa passou de 90%. Nada aqui fala com o PC ou com outra VPS.
    const servico = createServicoContas({ paths, cipher: createKeyCipher(key), fetchImpl: usageFetchFor({ 'at-cheia-secret': 95, 'at-folga-secret': 10 }), polling: false });
    await servico.start();
    servico.dispose();

    const live = JSON.parse(readFileSync(join(paths.claudeHome, '.credentials.json'), 'utf8')) as { claudeAiOauth: CredentialPair };
    expect(live.claudeAiOauth.accessToken).toBe('at-folga-secret');
    const saved = JSON.parse(readFileSync(paths.configPath, 'utf8')) as { accounts: { activeAccountId: string } };
    expect(saved.accounts.activeAccountId).toBe((reserva as unknown as { conta: string }).conta);
    const log = readFileSync(paths.logPath, 'utf8');
    expect(log).toContain('"event":"auto-switch"');
    expect(log).not.toContain('secret');
  });

  it('sem chave, o cofre recusa gravar e a conta não entra', async () => {
    home = mkdtempSync(join(tmpdir(), 'donel-servico-'));
    const paths = servicoPathsFor(home);
    const contas = createServicoContas({ paths, cipher: createKeyCipher(null), fetchImpl: usageFetch, polling: false });
    await contas.start();
    const loginDir = loginDirWith(home, 'nova');

    expect(await contas.colher(loginDir, 'Conta 9')).toEqual({ ok: false, reason: 'cofre-sem-chave' });
    // O par continua na pasta: nada se perdeu.
    expect(existsSync(join(loginDir, '.credentials.json'))).toBe(true);
    contas.dispose();
  });
});
