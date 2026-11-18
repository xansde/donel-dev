// Canal do Donel fora do PC (t-e195b35c), PR 4 — the satellite: the Homologações's gate records tasks on the personal
// VPS's Oráculo (a gate token, one route), pictures its sessions by a probe through their tunnels, and a wrapper of the
// CLI points the sessions there with short hook deadlines. What breaks without the owner noticing: a token that opens
// more than its route (or the PC's token that opens it), a task written twice after a cut answer, a session drawn
// arrow read as hierarchy (a notice to the wrong place), and a wrapper that rewrites the wrong file or breaks `claude`.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, type LedgerCaller } from '../src/main/ledger-store';
import { whoHears } from '../src/shared/mindscape/reach';
import { callerOf, createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { createGateToolRoutes, GATE_TOOL_PATH, readGateHashes } from '../src/oraculo/portoes';
import { boardFromProbe, createProbe } from '../src/oraculo/sonda';
import { createSatelliteLedger, SATELLITE_DOWN } from '../src/oraculo/satelite';
import type { PictureSession } from '../src/oraculo/portao';

const PC = 'p'.repeat(64);
const GATE = 'g'.repeat(64);
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const PROJECT = '/root/seazone/Homologacao';
const ME = 'place:dev-homolog';
const dirs: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const MINE: PictureSession = {
  quemSou: { nome: 'Dev · Homologacao', pasta: PROJECT, lugar: ME, papel: 'dev' },
  listar: [{ id: ME, papel: 'dev', estado: 'trabalhando' }],
};

function api() {
  const dir = tempDir('oraculo-portao-');
  mkdirSync(join(dir, 'portoes'));
  writeFileSync(join(dir, 'portoes', 'homologacoes.sha256'), `${hash(GATE)}\n`);
  const file = join(dir, 'ledger.json');
  const ledger = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  const gates = (): ReadonlyMap<string, string> => readGateHashes(dir);
  const handle = createOracleApiHandler({ ledger, ledgerFile: file, tokenHash: () => hash(PC), gates, gateRoutes: createGateToolRoutes({ ledger: () => ledger }) });
  const call = (token: string | null, name: string, args: unknown, sessao: PictureSession = MINE): Promise<{ status: number; body: string }> =>
    handle(req({ method: 'POST', url: GATE_TOOL_PATH, body: JSON.stringify({ sessao, call: { name, arguments: args } }), ...(token ? { authorization: `Bearer ${token}` } : {}) })).then((r) => ({ status: r.status, body: r.body as string }));
  return { dir, ledger, handle, gates, call };
}

const CALLER: LedgerCaller = { projectPath: PROJECT, placeId: ME, boardPlaceIds: [ME] };
const req = (r: Partial<OracleRequest>): OracleRequest => ({ method: 'GET', url: '/', body: '', ...r });
const criar = { titulo: 'Satélite', pedido: 'registrar na VPS pessoal', criterio: 'a tarefa existe', prazo: '2026-11-19', risco: 'baixo' };

describe('rota do portão na API do Oráculo', () => {
  it('o token de portão cria e lista tarefas como o lugar da sessão; o do PC e nenhum token não entram', async () => {
    const g = api();
    const created = await g.call(GATE, 'tarefa_criar', criar);
    expect(created.status).toBe(200);
    const answer = JSON.parse(created.body) as { ok: boolean; text: string };
    expect(answer.ok).toBe(true);
    const id = (JSON.parse(answer.text) as { id: string }).id;
    expect(g.ledger.load().doc.tasks[id]?.ownerPlaceId).toBe(ME);
    const listed = JSON.parse((await g.call(GATE, 'tarefa_listar', {})).body) as { ok: boolean; text: string };
    expect(JSON.parse(listed.text).tarefas.map((t: { id: string }) => t.id)).toEqual([id]);

    expect((await g.call(PC, 'tarefa_criar', criar)).status).toBe(403);
    expect((await g.call(null, 'tarefa_criar', criar)).status).toBe(401);
    expect(Object.keys(g.ledger.load().doc.tasks)).toEqual([id]);
  });

  it('o token de portão só abre a rota dele, e o Líder único não registra por ela', async () => {
    const g = api();
    for (const r of [req({ url: '/v1/ledger' }), req({ method: 'POST', url: '/v1/apply', body: '{}' }), req({ url: '/v1/livro' }), req({ method: 'POST', url: '/v1/retrato', body: '{}' })])
      expect((await g.handle({ ...r, authorization: `Bearer ${GATE}` })).status).toBe(403);
    expect(callerOf(`Bearer ${GATE}`, hash(PC), new Map(), g.gates())).toEqual({ kind: 'portao', name: 'homologacoes' });
    const leader = await g.call(GATE, 'tarefa_criar', criar, { quemSou: { liderUnico: true }, listar: [] });
    expect(JSON.parse(leader.body)).toMatchObject({ ok: false });
    expect(Object.keys(g.ledger.load().doc.tasks)).toEqual([]);
  });
});

describe('satélite: registro remoto', () => {
  /** A personal Oráculo whose first answer never comes (a cut connection), then answers. */
  async function flakyOracle(): Promise<{ url: string; bodies: Array<{ call: { arguments: { chave?: string } } }> }> {
    const bodies: Array<{ call: { arguments: { chave?: string } } }> = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (bodies.length === 1) return; // hangs: the write may have happened, the answer is lost
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, text: '{"id":"t-1"}' }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
  }

  it('sem resposta a tempo, repete uma vez com a mesma chave (que ele mesmo gera quando a sessão não mandou)', async () => {
    const oracle = await flakyOracle();
    const run = createSatelliteLedger({ url: oracle.url, token: () => GATE, timeoutMs: 150 });
    const answer = await run(CALLER, { tool: 'tarefa_assumir', id: 't-1' }, { mine: MINE, args: { id: 't-1' } });
    expect(answer).toEqual({ ok: true, text: '{"id":"t-1"}' });
    expect(oracle.bodies).toHaveLength(2);
    const [first, second] = oracle.bodies.map((body) => body.call.arguments.chave);
    expect(first).toMatch(/\S/);
    expect(second).toBe(first);
  });

  it('com o Oráculo pessoal fora do ar, diz que nada foi gravado', async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    server.close();
    const run = createSatelliteLedger({ url: `http://127.0.0.1:${port}`, token: () => GATE, timeoutMs: 500 });
    expect(await run(CALLER, { tool: 'tarefa_assumir', id: 't-1' }, { mine: MINE, args: { id: 't-1' } })).toEqual({ ok: false, text: SATELLITE_DOWN });
  });
});

describe('sonda do retrato', () => {
  const LIDER = 'place:lider';
  const quadro = {
    lugares: [
      { id: LIDER, papel: 'lider', autor: 'dono', x: 0, y: 0 },
      { id: ME, papel: 'dev', autor: 'sessao', x: 300, y: 0 },
      { id: 'place:rev', papel: 'revisor', autor: 'sessao', x: 600, y: 0 },
    ],
    ligacoes: [
      { id: 'a', de: LIDER, para: ME, seta: true, autor: 'sessao' },
      // A session drew this one with quadro_aplicar: it lets the Revisor send, never puts it above the Dev.
      { id: 'b', de: 'place:rev', para: ME, seta: true, autor: 'sessao' },
    ],
  };
  const listar = [
    { id: LIDER, papel: 'lider', estado: 'parada' },
    { id: ME, papel: 'dev', estado: 'trabalhando', abertaPor: LIDER },
    { id: 'place:rev', papel: 'revisor', estado: 'parada', abertaPor: LIDER },
  ];

  it('a seta de quem abriu vira hierarquia; a seta que uma sessão desenhou não', () => {
    const board = boardFromProbe({ pasta: PROJECT, lugar: ME }, listar, quadro)!;
    expect(board.links.filter((link) => link.opened).map((link) => [link.from, link.to])).toEqual([
      [LIDER, ME],
      [LIDER, 'place:rev'],
    ]);
    expect(board.cards[ME]).toMatchObject({ kind: 'session', roleId: 'dev', by: 'session' });
    expect(board.cards[LIDER]).not.toHaveProperty('by');
    expect(whoHears(board, ME, () => true)).toBe(LIDER);
    // Without the Líder alive, the Revisor's own arrow does not make it hear the Dev.
    expect(whoHears(board, ME, (id) => id !== LIDER)).not.toBe('place:rev');
  });

  it('pergunta ao túnel da sessão com o token dela e guarda o retrato; sem resposta, fica o anterior', async () => {
    const home = tempDir('sonda-');
    const sid = '11111111-2222-4333-8444-555555555555';
    const token = 't'.repeat(43);
    const seen: Array<{ host?: string; auth?: string; tool: string }> = [];
    let up = true;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: number; params: { name: string } };
        seen.push({ host: request.headers.host, auth: request.headers.authorization, tool: message.params.name });
        if (!up) return void response.writeHead(502).end();
        const text = message.params.name === 'sessao_quem_sou' ? { pasta: PROJECT, lugar: ME, papel: 'dev' } : message.params.name === 'sessao_listar' ? listar : quadro;
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(text) }] } }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    mkdirSync(join(home, sid), { recursive: true });
    writeFileSync(join(home, sid, 'meta.json'), JSON.stringify({ sid, mcpPort: port, mcpToken: token }));
    let now = 1_000_000;
    const kept: Record<string, PictureSession> = {};
    const probe = createProbe({
      sessionsDir: home,
      liveSessions: async () => new Set([sid]),
      picture: () => ({ at: 0, sessoes: kept }),
      setSession: (folder, session) => void (kept[folder] = session),
      now: () => now,
      gapMs: 0,
      log: () => undefined,
    });
    await probe.round();
    expect(seen.map((call) => call.tool)).toEqual(['sessao_quem_sou', 'sessao_listar', 'quadro_ler']);
    expect(seen.every((call) => call.host === `127.0.0.1:${port}` && call.auth === `Bearer ${token}`)).toBe(true);
    expect(kept[sid]).toMatchObject({ quemSou: { lugar: ME }, at: now });
    expect(kept[sid]!.board!.links.some((link) => link.opened)).toBe(true);

    // Fresh: no new probe. Stale and the PC failing: the last picture stays.
    await probe.round();
    expect(seen).toHaveLength(3);
    now += 61_000;
    up = false;
    const before = kept[sid];
    await probe.round();
    expect(seen).toHaveLength(4);
    expect(kept[sid]).toBe(before);
  });
});

describe('claude embrulhado na VPS', () => {
  const WRAPPER = fileURLToPath(new URL('../scripts/vps/claude-wrapper.sh', import.meta.url));
  const SID = '11111111-2222-4333-8444-555555555555';

  function machine(withGate: boolean) {
    const home = tempDir('wrapper-');
    const bin = join(home, '.donel', 'bin');
    const real = join(home, 'real');
    mkdirSync(bin, { recursive: true });
    mkdirSync(real);
    writeFileSync(join(bin, 'claude'), readFileSync(WRAPPER));
    chmodSync(join(bin, 'claude'), 0o755);
    // The real CLI: prints its arguments, one per line.
    writeFileSync(join(real, 'claude'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
    chmodSync(join(real, 'claude'), 0o755);
    const s = join(home, '.donel', 's', SID);
    mkdirSync(s, { recursive: true });
    writeFileSync(
      join(s, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:23000/h/PreToolUse', headers: { 'X-Donel-Token': 'x' }, timeout: 10 }] }],
          PermissionRequest: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:23000/h/PermissionRequest', timeout: 86400 }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: 'curl -s', timeout: 10 }] }],
        },
      }),
    );
    writeFileSync(join(s, 'mcp.json'), JSON.stringify({ mcpServers: { donel: { type: 'http', url: 'http://127.0.0.1:29573/mcp', headers: { Authorization: 'Bearer y' }, timeout: 2100000 } } }));
    if (withGate) {
      mkdirSync(join(home, '.donel', 'oraculo'), { recursive: true });
      writeFileSync(join(home, '.donel', 'oraculo', 'portao'), '47817\n');
    }
    const run = (args: string[]) =>
      spawnSync(join(bin, 'claude'), args, { encoding: 'utf8', env: { HOME: home, PATH: `${bin}:${real}:/usr/bin:/bin` } });
    return { home, s, run };
  }

  it('reescreve os prazos dos hooks e aponta o MCP para o portão, e chama o claude de verdade com as cópias', () => {
    const m = machine(true);
    const out = m.run(['--resume', 'x', '--settings', join(m.s, 'settings.json'), '--mcp-config', join(m.s, 'mcp.json'), '--strict-mcp-config']);
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual(['--resume', 'x', '--settings', join(m.s, 'settings.vps.json'), '--mcp-config', join(m.s, 'mcp.vps.json'), '--strict-mcp-config']);
    const settings = JSON.parse(readFileSync(join(m.s, 'settings.vps.json'), 'utf8'));
    expect(settings.hooks.PreToolUse[0].hooks[0]).toMatchObject({ type: 'http', timeout: 2, headers: { 'X-Donel-Token': 'x' } });
    expect(settings.hooks.PermissionRequest[0].hooks[0].timeout).toBe(30);
    expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    const mcp = JSON.parse(readFileSync(join(m.s, 'mcp.vps.json'), 'utf8'));
    expect(mcp.mcpServers.donel).toMatchObject({ url: `http://127.0.0.1:47817/s/${SID}/mcp`, headers: { Authorization: 'Bearer y' } });
    // The originals stay as the app wrote them.
    expect(JSON.parse(readFileSync(join(m.s, 'mcp.json'), 'utf8')).mcpServers.donel.url).toBe('http://127.0.0.1:29573/mcp');
  });

  it('sem portão o MCP fica no túnel; fora das pastas do Donel e sem argumentos, passa direto', () => {
    const m = machine(false);
    const out = m.run(['--settings', join(m.s, 'settings.json'), '--mcp-config', join(m.s, 'mcp.json')]);
    expect(out.stdout.trim().split('\n')).toEqual(['--settings', join(m.s, 'settings.vps.json'), '--mcp-config', join(m.s, 'mcp.json')]);
    expect(existsSync(join(m.s, 'mcp.vps.json'))).toBe(false);
    const other = join(m.home, 'outro.json');
    writeFileSync(other, '{}');
    expect(m.run(['-p', 'oi', '--settings', other]).stdout.trim().split('\n')).toEqual(['-p', 'oi', '--settings', other]);
    expect(m.run(['--version']).stdout.trim()).toBe('--version');
  });

  it('um settings.json ilegível não quebra o claude: chama com os argumentos originais', () => {
    const m = machine(true);
    writeFileSync(join(m.s, 'settings.json'), '{ quebrado');
    const out = m.run(['--settings', join(m.s, 'settings.json')]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual(['--settings', join(m.s, 'settings.json')]);
  });
});
