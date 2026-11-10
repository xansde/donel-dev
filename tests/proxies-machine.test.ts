import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMachineProgram, parseExportOutput, parseReadOutput, parseSwitchOutput } from '../src/main/proxies/machine-program';

// Proxy da vez — o programa que roda na máquina e mexe no `settings.json` dela. O que quebraria sem o dono perceber:
// o settings perdendo outras chaves, a chave do proxy indo parar em texto no settings ou na saída, e uma troca para um
// proxy que não responde ficando gravada (as sessões novas daquela máquina morreriam).

const GOOD_KEY = 'sk-test-good-key-123456';
const OTHER_KEY = 'sk-test-old-key-654321';

let home: string;
let server: Server;
let baseUrl: string;
let answer: (key: string | undefined) => number;

function run(program: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-'], { env: { ...process.env, HOME: home, USERPROFILE: home, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' } });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', () => resolve(stdout));
    child.stdin.end(program);
  });
}

const settingsPath = (): string => join(home, '.claude', 'settings.json');
const readSettings = (): Record<string, unknown> & { env: Record<string, string> } => JSON.parse(readFileSync(settingsPath(), 'utf8'));

function switchTo(proxyId: string, url: string, key: string): Promise<string> {
  return run(buildMachineProgram({ op: 'switch', claudeDir: null, proxyId, baseUrl: url, key, userAgent: 'claude-cli/test', timeoutSec: 5 }));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'donel-proxy-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, 'old.key'), OTHER_KEY);
  writeFileSync(
    settingsPath(),
    JSON.stringify({
      apiKeyHelper: `cat '${join(home, 'old.key')}'`,
      env: { ANTHROPIC_BASE_URL: 'http://gateway.example:8317', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'localhost,127.0.0.1', ANTHROPIC_AUTH_TOKEN: 'stale' },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo oi' }] }] },
      model: 'claude-fable-5-2',
    }),
    { mode: 0o640 },
  );
  answer = (key) => (key === GOOD_KEY ? 200 : 401);
  server = createServer((req, res) => {
    const key = req.headers['x-api-key'];
    res.statusCode = req.url === '/v1/models' ? answer(typeof key === 'string' ? key : undefined) : 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

describe('programa da máquina (proxy da vez)', () => {
  it('troca só o caminho, guarda a chave num arquivo 600 e nunca a devolve na saída', async () => {
    const stdout = await switchTo('portal', baseUrl, GOOD_KEY);
    expect(parseSwitchOutput(stdout)).toEqual({ kind: 'switched', from: 'http://gateway.example:8317' });
    expect(stdout).not.toContain(GOOD_KEY);

    const settings = readSettings();
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(baseUrl);
    expect(settings.env.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(settings.env.HTTPS_PROXY).toBe('http://127.0.0.1:9');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(settings.model).toBe('claude-fable-5-2');
    expect(settings.hooks).toEqual({ SessionStart: [{ hooks: [{ type: 'command', command: 'echo oi' }] }] });
    expect(JSON.stringify(settings)).not.toContain(GOOD_KEY);
    expect(statSync(settingsPath()).mode & 0o777).toBe(0o640);

    const keyFile = join(home, '.donel', 'proxy', 'portal.key');
    expect(readFileSync(keyFile, 'utf8')).toBe(GOOD_KEY);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(settings.apiKeyHelper).toContain(keyFile);

    expect(parseReadOutput(await run(buildMachineProgram({ op: 'read', claudeDir: null })))).toEqual({ kind: 'ok', baseUrl, donelProxyId: 'portal' });
  });

  it('não grava nada quando o novo proxy recusa a chave antes da troca', async () => {
    const before = readFileSync(settingsPath(), 'utf8');
    const stdout = await switchTo('portal', baseUrl, 'sk-test-wrong-key-000');
    expect(parseSwitchOutput(stdout)).toEqual({ kind: 'precheck-failed', httpStatus: 401 });
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
    expect(existsSync(join(home, '.donel', 'proxy', 'portal.key'))).toBe(false);
  });

  it('volta o settings anterior quando o proxy para de responder logo depois de gravar', async () => {
    const before = readFileSync(settingsPath(), 'utf8');
    let calls = 0;
    answer = () => (++calls === 1 ? 200 : 502);
    expect(parseSwitchOutput(await switchTo('portal', baseUrl, GOOD_KEY))).toEqual({ kind: 'rolled-back', httpStatus: 502 });
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
    expect(calls).toBe(2);
  });

  it('importa a chave que a máquina usa só quando ela está nesse proxy', async () => {
    const exported = await run(buildMachineProgram({ op: 'export-key', claudeDir: null, expectBaseUrl: 'http://gateway.example:8317' }));
    expect(parseExportOutput(exported)).toEqual({ kind: 'ok', key: OTHER_KEY });
    const other = await run(buildMachineProgram({ op: 'export-key', claudeDir: null, expectBaseUrl: baseUrl }));
    expect(parseExportOutput(other)).toEqual({ kind: 'not-found' });
  });

  it('com o settings.json como link simbólico, grava no arquivo de destino e o link continua link', async () => {
    const real = join(home, 'dotfiles-settings.json');
    renameSync(settingsPath(), real);
    symlinkSync(real, settingsPath());
    expect(parseSwitchOutput(await switchTo('portal', baseUrl, GOOD_KEY)).kind).toBe('switched');
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8')).env.ANTHROPIC_BASE_URL).toBe(baseUrl);
  });
});
