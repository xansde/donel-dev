// Kit de abertura (t-1a3f7150, fatia 2; docs/adr/0009): o que só o PC sabe e que o daemon do Oráculo precisa para abrir
// uma sessão com o PC desligado (papéis, pastas dos quadros, limite de abertas) vai à VPS a cada aperto de mão, em
// `~/.donel/oraculo/abrir.json`. Regra dura: nenhum segredo no kit, e o arquivo nasce 600.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultAppConfig, type AppConfig } from '../src/main/config-store';
import { handshakeScript, parseHandshakeUrl } from '../src/main/ledger-remote-host';
import { buildOpenKit, OPEN_KIT_FILE, type OpenKitInput } from '../src/main/open-kit';
import { FACTORY_ROLES, type SessionRole } from '../src/shared/roles';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Fake values, built at run time so no literal in this file looks like a real key.
const fake = (...parts: string[]): string => parts.join('');
const PLANTED = {
  githubToken: fake('ghp', '_', 'PLANTADOgithub', '0123456789abcdef'),
  anthropicKey: fake('sk', '-ant-', 'PLANTADOanthropic', '0123456789'),
  proxyKey: fake('sk', '-proxy', 'PLANTADO', '0123456789'),
  oauthRefresh: fake('sk', '-ort-', 'PLANTADOrefresh', '0123456789'),
  password: fake('senha', 'PLANTADA', '-9f8e7d'),
  bearer: fake('Bearer ', 'PLANTADO', '0123456789'),
};

/** A config with accounts, providers, proxies and unknown keys full of secrets (every one must stay home). */
function loadedConfig(): AppConfig {
  const base = defaultAppConfig(['C:\\Users\\alexa\\seazone']);
  return {
    ...base,
    team: { ...base.team, openCap: 4 },
    accounts: {
      ...base.accounts,
      seazone: { url: `https://pool:${PLANTED.password}@pool.example.com`, apiKey: PLANTED.anthropicKey } as never,
      localAccounts: [{ id: 'conta-1', label: 'Conta 1', refreshToken: PLANTED.oauthRefresh } as never],
      remotes: [{ id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'alexandre@vps' } as never],
    },
    providers: { version: 1, entries: [{ id: 'proxy-x', label: 'Proxy', class: 'A', command: null, env: { ANTHROPIC_AUTH_TOKEN: PLANTED.anthropicKey }, secretEnvKeys: ['ANTHROPIC_API_KEY'] } as never] },
    proxies: { version: 1, seeded: true, entries: [{ id: 'p1', label: 'P1', kind: 'cliproxy', baseUrl: `https://u:${PLANTED.proxyKey}@proxy.example.com`, machines: [] } as never] },
    unknownFields: { githubToken: PLANTED.githubToken, authorization: PLANTED.bearer },
  };
}

const dev = FACTORY_ROLES.find((role) => role.id === 'dev')!;
const roles: SessionRole[] = [
  ...FACTORY_ROLES,
  { ...dev, id: 'dev-proxy', name: 'Dev no proxy', engine: 'proxy-x' },
  { ...dev, id: 'revisor-x', name: 'Revisor X', anyPlace: true, scope: { mcps: ['github'] } },
];

function input(): OpenKitInput {
  return {
    config: loadedConfig(),
    roles,
    boards: [
      // A token in the remote URL (a common way to clone private repos) never travels.
      { localCwd: 'C:\\Users\\alexa\\seazone\\Donel Dev', git: { repoUrl: `https://x-access-token:${PLANTED.githubToken}@github.com/xansde/donel-dev.git`, branch: 'staging' } },
      { localCwd: 'C:\\Users\\alexa\\seazone\\_work\\Bizops', git: { repoUrl: `https://${PLANTED.githubToken}@github.com/xansde/bizops.git`, branch: null } },
      { localCwd: 'D:\\outros\\avulso', git: { repoUrl: 'git@github.com:xansde/avulso.git', branch: 'main' } },
    ],
    place: { id: 'vps-pessoal', label: 'VPS pessoal' },
    now: new Date('2026-11-18T12:00:00.000Z'),
  };
}

describe('kit de abertura (abrir.json)', () => {
  it('montado de uma config cheia de contas, proxies e tokens, não leva nenhum deles', () => {
    const text = JSON.stringify(buildOpenKit(input()));
    for (const value of Object.values(PLANTED)) expect(text).not.toContain(value);
    expect(text).not.toMatch(/ghp_[A-Za-z0-9]{8,}|github_pat_|sk-[A-Za-z0-9_-]{8,}|xox[abp]-|Bearer\s/i);
    expect(text).not.toMatch(/"[^"]*(token|secret|senha|password|apiKey|credential|cookie)[^"]*"\s*:/i);
    // Only roles and folders: nothing of accounts, providers, proxies or the unknown keys.
    expect(text).not.toMatch(/pool\.example|proxy\.example|alexandre@vps|conta-1/);
  });

  it('traz papéis (menos o Líder e os de provedor), pastas do Windows na VPS e o limite de abertas', () => {
    const kit = buildOpenKit(input());
    expect(kit).toMatchObject({ version: 1, at: '2026-11-18T12:00:00.000Z', place: { id: 'vps-pessoal', label: 'VPS pessoal' }, openCap: 4 });
    const ids = kit.roles.map((role) => role.id);
    expect(ids).toContain('dev');
    expect(ids).toContain('revisor-x');
    // The Líder is never opened without the PC; a provider's role does not run on a remote place.
    expect(ids).not.toContain('lider');
    expect(ids).not.toContain('dev-proxy');
    const devRole = kit.roles.find((role) => role.id === 'dev')!;
    expect(devRole.name).toBe(dev.name);
    expect(devRole.promptText).toContain(dev.guidance.trim().split('\n')[0]!);
    expect(devRole.launcherArgs).toEqual(expect.arrayContaining(['--model', '--effort', '--permission-mode']));
    const revisor = kit.roles.find((role) => role.id === 'revisor-x')!;
    expect(revisor).toMatchObject({ anyPlace: true, scope: { mcps: ['github'] }, scopeNeedsInventory: false });
    expect(revisor.scopeSettings).toMatchObject({ allowedMcpServers: expect.arrayContaining([{ serverName: 'github' }]) });
    expect(kit.boards).toEqual([
      { localCwd: 'C:\\Users\\alexa\\seazone\\Donel Dev', name: 'Donel Dev', homeRelativeDir: 'seazone/Donel Dev', repoUrl: 'https://github.com/xansde/donel-dev.git', branch: 'staging' },
      { localCwd: 'C:\\Users\\alexa\\seazone\\_work\\Bizops', name: 'Bizops', homeRelativeDir: 'seazone/_work/Bizops', repoUrl: 'https://github.com/xansde/bizops.git', branch: null },
      { localCwd: 'D:\\outros\\avulso', name: 'avulso', homeRelativeDir: 'avulso', repoUrl: 'git@github.com:xansde/avulso.git', branch: 'main' },
    ]);
  });

  it('o aperto de mão grava o kit com permissão 600, mesmo sobre um temporário antigo aberto a todos', () => {
    const kit = buildOpenKit(input());
    const script = handshakeScript('a'.repeat(64), undefined, kit);
    // The write runs under `umask 077` and the file is chmod 600 before it takes the final name.
    const write = script.indexOf(OPEN_KIT_FILE);
    expect(write).toBeGreaterThan(script.indexOf('umask 077'));
    expect(script).toMatch(new RegExp(`chmod 600 "\\$d/${OPEN_KIT_FILE.replace('.', '\\.')}\\.tmp"`));
    expect(script).not.toContain(PLANTED.githubToken);
    if (process.platform === 'win32') return;
    const home = mkdtempSync(join(tmpdir(), 'kit-abrir-'));
    dirs.push(home);
    const d = join(home, '.donel', 'oraculo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'url'), 'http://100.64.0.9:47816\n');
    writeFileSync(join(d, `${OPEN_KIT_FILE}.tmp`), 'antigo', { mode: 0o644 });
    const out = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, HOME: home } });
    expect(out.status).toBe(0);
    expect(parseHandshakeUrl(out.stdout)).toBe('http://100.64.0.9:47816');
    expect(statSync(join(d, OPEN_KIT_FILE)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(d, OPEN_KIT_FILE), 'utf8'))).toEqual(kit);
  });

  it('uma falha ao gravar o kit na VPS não derruba a ligação: o endereço do Oráculo sai mesmo assim', () => {
    if (process.platform === 'win32') return;
    const script = handshakeScript('a'.repeat(64), undefined, buildOpenKit(input()));
    const home = mkdtempSync(join(tmpdir(), 'kit-abrir-'));
    dirs.push(home);
    const d = join(home, '.donel', 'oraculo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'url'), 'http://100.64.0.9:47816\n');
    mkdirSync(join(d, `${OPEN_KIT_FILE}.tmp`)); // the temp name is taken by a folder: the write fails
    const out = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, HOME: home } });
    expect(out.status).toBe(0);
    expect(parseHandshakeUrl(out.stdout)).toBe('http://100.64.0.9:47816');
  });
});
