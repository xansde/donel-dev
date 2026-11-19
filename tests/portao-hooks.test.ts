// t-d461e003 — os hooks do app pelo portão. Com o app do PC fechado, nada escuta no túnel dos hooks
// (`127.0.0.1:<hookPort>/h/<Evento>`) e toda sessão da VPS mostrava "Stop hook error: connect ECONNREFUSED" a cada
// turno. O portão atende `/s/<sid>/h/<Evento>`: repassa ao túnel quando o PC responde e devolve 200 `{}` quando está
// fora. O que quebraria sem o dono perceber: o token de outra sessão passando, o hook do PC sumindo com ele ligado, e o
// sed do setup mexendo no hook de recados.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateHandler, startGateServer, type GateForward, type GateRequest } from '../src/oraculo/portao';
import { buildRemoteSetupScript, HOOKS_TO_GATE_SED, parseRemoteSetupOutput } from '../src/main/remote-session';

const SID = '11111111-2222-4333-8444-555555555555';
const HOOK_TOKEN = 'h'.repeat(32);
const MCP_TOKEN = 'm'.repeat(43);
const dirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const MCP_NEVER: GateForward = async () => {
  throw new Error('o hook não vai pelo túnel do MCP');
};

/** A port where nothing listens (the PC's app closed: the tunnel is down). */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** The PC's hook bridge on the other end of the tunnel. */
async function pcBridge(answer: (req: IncomingMessage, body: string) => { status: number; body: string } | 'cair') {
  const seen: { path: string; token: string | undefined; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ path: req.url ?? '', token: req.headers['x-donel-token'] as string | undefined, body });
      const out = answer(req, body);
      if (out === 'cair') {
        req.socket.destroy();
        return;
      }
      res.writeHead(out.status, { 'Content-Type': 'application/json' }).end(out.body);
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { port: (server.address() as { port: number }).port, seen };
}

/** A sessions dir with `SID`'s meta (its hook token and the tunnel port of its hooks). */
function sessions(hookPort: number): string {
  const dir = tmp('portao-hooks-');
  mkdirSync(join(dir, SID), { recursive: true });
  writeFileSync(join(dir, SID, 'meta.json'), JSON.stringify({ sid: SID, hookToken: HOOK_TOKEN, hookPort, mcpToken: MCP_TOKEN, mcpPort: 25710 }));
  return dir;
}

/** The gate as the daemon runs it (a real loopback server), so the headers go the way the CLI sends them. */
async function gate(hookPort: number, options: { pcAway?: boolean } = {}) {
  const handler = createGateHandler({
    sessionsDir: sessions(hookPort),
    ledger: () => {
      throw new Error('sem registro');
    },
    picture: () => null,
    forward: MCP_NEVER,
    serverVersion: 'teste',
    ...(options.pcAway ? { pcAway: () => true } : {}),
  });
  const server = await startGateServer({ port: 0, handler });
  const post = (path: string, body: string, headers: Record<string, string> = { 'X-Donel-Token': HOOK_TOKEN }) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const out = httpRequest({ host: '127.0.0.1', port: server.port, method: 'POST', path, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      out.once('error', reject);
      out.end(body);
    });
  return { post, close: server.close, handler };
}

const STOP = '{"session_id":"abc","hook_event_name":"Stop"}';

describe('portão: os hooks do app da sessão', () => {
  it('com o túnel do PC respondendo, /s/<sid>/h/Stop repassa igual e devolve a resposta dele', async () => {
    const pc = await pcBridge(() => ({ status: 200, body: '{"do":"PC"}' }));
    const g = await gate(pc.port);
    try {
      expect(await g.post(`/s/${SID}/h/Stop`, STOP)).toEqual({ status: 200, body: '{"do":"PC"}' });
      expect(pc.seen).toEqual([{ path: '/h/Stop', token: HOOK_TOKEN, body: STOP }]);
    } finally {
      await g.close();
    }
  });

  it('com o PC fora, devolve 200 {} (e a statusline vazia, que o curl imprimiria)', async () => {
    const g = await gate(await closedPort());
    try {
      expect(await g.post(`/s/${SID}/h/Stop`, STOP)).toEqual({ status: 200, body: '{}' });
      expect(await g.post(`/s/${SID}/h/PermissionRequest`, '{}')).toEqual({ status: 200, body: '{}' });
      expect(await g.post(`/s/${SID}/h/StatusLine`, '{}')).toEqual({ status: 200, body: '' });
    } finally {
      await g.close();
    }
  });

  it('com o PC sumido há tempo (pcAway), responde {} sem esperar o túnel', async () => {
    const pc = await pcBridge(() => ({ status: 200, body: '{"do":"PC"}' }));
    const g = await gate(pc.port, { pcAway: true });
    try {
      expect(await g.post(`/s/${SID}/h/Stop`, STOP)).toEqual({ status: 200, body: '{}' });
      expect(pc.seen).toEqual([]);
    } finally {
      await g.close();
    }
  });

  it('o túnel que conectou e caiu depois de receber dá 502, nunca o {} de PC fora', async () => {
    const pc = await pcBridge(() => 'cair');
    const g = await gate(pc.port);
    try {
      expect((await g.post(`/s/${SID}/h/Stop`, STOP)).status).toBe(502);
      expect(pc.seen).toHaveLength(1);
    } finally {
      await g.close();
    }
  });

  it('recusa sid inválido, evento inválido, cabeçalho errado, o token do MCP e outro método', async () => {
    const pc = await pcBridge(() => ({ status: 200, body: '{"do":"PC"}' }));
    const g = await gate(pc.port);
    try {
      expect((await g.post(`/s/../h/Stop`, STOP)).status).toBe(404);
      expect((await g.post(`/s/${SID}/h/Stop;rm`, STOP)).status).toBe(404);
      expect((await g.post(`/s/${SID}/h/`, STOP)).status).toBe(404);
      expect((await g.post(`/s/99999999-2222-4333-8444-555555555555/h/Stop`, STOP)).status).toBe(401);
      expect((await g.post(`/s/${SID}/h/Stop`, STOP, { 'X-Donel-Token': 'e'.repeat(32) })).status).toBe(401);
      expect((await g.post(`/s/${SID}/h/Stop`, STOP, {})).status).toBe(401);
      expect((await g.post(`/s/${SID}/h/Stop`, STOP, { 'X-Donel-Token': MCP_TOKEN })).status).toBe(401);
      expect((await g.post(`/s/${SID}/h/Stop`, STOP, { Authorization: `Bearer ${HOOK_TOKEN}` })).status).toBe(401);
      const get: GateRequest = { method: 'GET', path: `/s/${SID}/h/Stop`, headers: { 'x-donel-token': HOOK_TOKEN }, body: '' };
      expect((await g.handler(get)).status).toBe(405);
      expect(pc.seen).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

describe.skipIf(process.platform === 'win32')('setup: os hooks do settings.json apontam ao portão', () => {
  const settings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:38470/h/Stop', headers: { 'X-Donel-Token': 't' }, timeout: 2 }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'curl -s --data-binary @- -H "@$HOME/.donel/s/x/hook-header" http://127.0.0.1:38470/h/SessionStart', timeout: 10 }] }],
      // Not the app's: the recados hook and the Slack guard stay as they are.
      UserPromptSubmit: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:47817/recados/prompt' }, { type: 'command', command: 'sh $HOME/.donel/s/x/slack-guard.sh' }] }],
    },
    statusLine: { type: 'command', command: 'curl -s --noproxy 127.0.0.1 http://127.0.0.1:38470/h/StatusLine' },
  };

  function sandbox(withGate: boolean) {
    const home = tmp('donel-hooks-setup-');
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'tmux'), 0o755);
    chmodSync(join(bin, 'claude'), 0o755);
    mkdirSync(join(home, 'proj'));
    if (withGate) {
      mkdirSync(join(home, '.donel', 'oraculo'), { recursive: true });
      writeFileSync(join(home, '.donel', 'oraculo', 'portao'), '47817\n');
    }
    return { home, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` } };
  }

  function setup(env: NodeJS.ProcessEnv) {
    const meta = { sid: SID, hookToken: 't', hookPort: 38470, mcpToken: 'm', mcpPort: 26174, localCwd: '/p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' };
    const script = buildRemoteSetupScript({
      sid: SID,
      homeRelativeDir: 'proj',
      repoUrl: null,
      branch: null,
      files: [
        { name: 'settings.json', content: `${JSON.stringify(settings, null, 2)}\n` },
        { name: 'mcp.json', content: '{"mcpServers":{"donel":{"type":"http","url":"http://127.0.0.1:26174/mcp"}}}\n' },
      ],
      claudeArgs: [],
      meta,
    });
    return parseRemoteSetupOutput(execFileSync('bash', ['-s'], { input: script, env, encoding: 'utf8' }), 0);
  }

  const expected = (gatePort: number) => {
    const text = `${JSON.stringify(settings, null, 2)}\n`;
    return text.replaceAll('http://127.0.0.1:38470/h/', `http://127.0.0.1:${gatePort}/s/${SID}/h/`);
  };

  it('com o portão na máquina: os hooks do app vão ao portão, o de recados e a trava do Slack ficam', () => {
    const { home, env } = sandbox(true);
    expect(setup(env).kind).toBe('new');
    const written = readFileSync(join(home, '.donel', 's', SID, 'settings.json'), 'utf8');
    expect(written).toBe(expected(47817));
    expect(written).toContain('http://127.0.0.1:47817/recados/prompt');
    expect(written).toContain('sh $HOME/.donel/s/x/slack-guard.sh');
    expect(written).not.toContain(':38470/');
    expect(readFileSync(join(home, '.donel', 's', SID, 'mcp.json'), 'utf8')).toContain(`http://127.0.0.1:47817/s/${SID}/mcp`);
  });

  it('sem o portão na máquina: o settings.json fica como o PC escreveu', () => {
    const { home, env } = sandbox(false);
    expect(setup(env).kind).toBe('new');
    expect(readFileSync(join(home, '.donel', 's', SID, 'settings.json'), 'utf8')).toBe(`${JSON.stringify(settings, null, 2)}\n`);
  });

  it('--sessoes-vivas: o mesmo sed nas pastas das sessões, uma vez só, sem tocar no resto', () => {
    const { home, env } = sandbox(true);
    const folder = join(home, '.donel', 's', SID);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    const other = join(home, '.donel', 's', 'not a sid');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'settings.json'), 'http://127.0.0.1:38470/h/Stop\n');
    const script = join(__dirname, '..', 'scripts', 'vps', 'hooks-pelo-portao.sh');
    expect(readFileSync(script, 'utf8')).toContain(HOOKS_TO_GATE_SED);
    const run = () => execFileSync('bash', [script, '--sessoes-vivas'], { env, encoding: 'utf8' });
    expect(run()).toContain('1 ');
    expect(readFileSync(join(folder, 'settings.json'), 'utf8')).toBe(expected(47817));
    run();
    expect(readFileSync(join(folder, 'settings.json'), 'utf8')).toBe(expected(47817));
    expect(readFileSync(join(other, 'settings.json'), 'utf8')).toBe('http://127.0.0.1:38470/h/Stop\n');
    expect(() => execFileSync('bash', [script], { env, encoding: 'utf8', stdio: 'pipe' })).toThrow();
  });
});
