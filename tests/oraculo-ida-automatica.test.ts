// Oráculo na VPS (t-d7a974d0) — the night's version takes the ledger to the VPS by itself on the first open, with no
// click. What breaks without the owner noticing: the ledger that goes and does not come back whole when the move
// fails half way, a move that runs again over a ledger already there (or after the owner brought it back by hand),
// or a move to a place with no Oráculo installed.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps, type ConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createSwitchableLedger } from '../src/main/ledger-remote';
import { createRemoteOracleHost, ORACLE_INSTALLED, REMOTE_CONFIG_FILE } from '../src/main/ledger-remote-host';
import { createOracleApiHandler } from '../src/oraculo/api';
import { createReturnGuard } from '../src/oraculo/devolvido';

const realIo = createSystemConfigIoDeps();
const dirs: string[] = [];
const LIDER = { kind: 'lugar' as const, placeId: 'place:lider', roleId: 'lider' };
// Two places, as the owner has them: only the VPS has the Oráculo installed.
const REMOTES = [
  { id: 'homolog', label: 'Homologações', sshTarget: 'root@homolog' },
  { id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'eu@vps' },
];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function pcWithLedger() {
  const dir = tempDir('pc-');
  const file = join(dir, 'ledger.json');
  mkdirSync(ledgerProofsDir(file), { recursive: true });
  const local = createLedgerService({ filePath: file, io: realIo, proofFs: nodeLedgerProofFs });
  const created = await local.apply(LIDER, { op: 'criar', projectPath: '/p', request: 'faz X', doneWhen: 'X feito', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' });
  if (!created.ok) throw new Error(created.reason);
  return { dir, file, id: created.task.id, before: readFileSync(file, 'utf8') };
}

/** The VPS's daemon in process, and what the ssh of each place did. */
function vps() {
  const dir = tempDir('vps-');
  const file = join(dir, 'ledger.json');
  let hash: string | null = null;
  const guard = createReturnGuard(createLedgerService({ filePath: file, io: realIo, proofFs: nodeLedgerProofFs }), dir);
  const celular: boolean[] = [];
  const daemon = createOracleApiHandler({
    ledger: guard.ledger,
    ledgerFile: file,
    tokenHash: () => hash,
    returned: guard,
    extra: async (request, path) => {
      if (request.method === 'POST' && path === '/v1/celular/ligar') {
        celular.push(JSON.parse(request.body).enabled === true);
        return { status: 200, headers: {}, body: '{}' };
      }
      return null;
    },
  });
  const ssh: { target: string; wrote: boolean }[] = [];
  const runScript = async (target: string, script: string) => {
    const wrote = script.includes('pc.token.sha256');
    ssh.push({ target, wrote });
    if (target !== 'eu@vps') return { code: 0, stdout: 'sem-oraculo\n', stderr: '' };
    if (!wrote) return { code: 0, stdout: `${ORACLE_INSTALLED}\n`, stderr: '' };
    hash = /'([0-9a-f]{64})'/.exec(script)![1]!;
    return { code: 0, stdout: 'http://100.64.0.9:47816\n', stderr: '' };
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const { pathname, search } = new URL(url);
    const body = init.body;
    const res = await daemon({ method: init.method ?? 'GET', url: pathname + search, authorization: (init.headers as Record<string, string>).Authorization, body: typeof body === 'string' ? body : '', ...(body instanceof Uint8Array ? { bytes: body } : {}) });
    return new Response(typeof res.body === 'string' ? res.body : readFileSync(res.body.filePath), { status: res.status });
  }) as unknown as typeof fetch;
  return { file, phone: guard.ledger, celular, ssh, runScript, fetchImpl };
}

/** The PC's app on that userData: what index.ts builds at each open. */
function openApp(pc: { dir: string; file: string }, server: ReturnType<typeof vps>, io: ConfigIoDeps = realIo, celularWanted = true) {
  const localService = () => createLedgerService({ filePath: pc.file, io: realIo, proofFs: nodeLedgerProofFs });
  const held = createSwitchableLedger(localService());
  const host = createRemoteOracleHost({
    userDataDir: pc.dir,
    ledgerFile: pc.file,
    io,
    proofFs: nodeLedgerProofFs,
    remotes: () => REMOTES,
    runScript: server.runScript,
    localService,
    setService: (next) => held.set(next),
    freeze: (reason) => held.freeze(reason),
    onChange: () => undefined,
    fetchImpl: server.fetchImpl,
    celularWanted: () => celularWanted,
  });
  held.set(host.boot());
  return { held, host };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Oráculo vai sozinho para a VPS na primeira abertura', { timeout: 30_000 }, () => {
  it('leva o registro byte a byte ao lugar que tem o Oráculo, sem gravar nada no outro, e liga o celular lá', async () => {
    const pc = await pcWithLedger();
    const server = vps();
    const { held, host } = openApp(pc, server);
    try {
      const result = await host.autoMove();
      expect(result).toMatchObject({ ok: true, state: { mode: 'remoto', lugar: 'vps-pessoal', conectado: true } });
      expect(readFileSync(server.file, 'utf8')).toBe(pc.before);
      expect(JSON.parse(readFileSync(join(pc.dir, REMOTE_CONFIG_FILE), 'utf8'))).toEqual({ lugar: 'vps-pessoal' });
      // The place without the Oráculo was only asked; nothing was written there.
      expect(server.ssh.filter((call) => call.target === 'root@homolog').every((call) => !call.wrote)).toBe(true);
      expect(server.celular).toEqual([true]);
      // What the app holds now writes on the VPS.
      expect((await held.apply({ kind: 'dono' }, { op: 'cancelar', id: pc.id, reason: 'teste' })).ok).toBe(true);
      expect(JSON.parse(readFileSync(server.file, 'utf8')).tasks[pc.id].state).toBe('rejeitada');
    } finally {
      host.dispose();
    }
  });

  it('falhou no meio: o registro volta sozinho ao PC como estava, o PC grava de novo, e a próxima abertura tenta outra vez', async () => {
    const pc = await pcWithLedger();
    const server = vps();
    // The last step of the move (the file that says where the ledger lives) fails: the VPS already has the copy.
    const failing: ConfigIoDeps = {
      ...realIo,
      writeFileText: (path, text) => {
        if (path.includes(REMOTE_CONFIG_FILE)) throw new Error('EACCES');
        realIo.writeFileText(path, text);
      },
    };
    const first = openApp(pc, server, failing);
    try {
      const result = await first.host.autoMove();
      expect(result.ok).toBe(false);
      expect(result.state.mode).toBe('local');
      expect(readFileSync(pc.file, 'utf8')).toBe(pc.before);
      expect(existsSync(join(pc.dir, REMOTE_CONFIG_FILE))).toBe(false);
      expect(first.held.load().readOnly).toBe(false);
      expect((await first.held.apply(LIDER, { op: 'cancelar', id: pc.id, reason: 'o PC grava' })).ok).toBe(true);
      // The VPS's copy is dead: nothing written there would be lost on the PC.
      expect((await server.phone.apply({ kind: 'dono' }, { op: 'criar', projectPath: '/p', request: 'r', doneWhen: 'd', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' })).ok).toBe(false);
      expect(server.celular).toEqual([]);
    } finally {
      first.host.dispose();
    }
    const changed = readFileSync(pc.file, 'utf8');
    const second = openApp(pc, server);
    try {
      expect(await second.host.autoMove()).toMatchObject({ ok: true, state: { mode: 'remoto', lugar: 'vps-pessoal' } });
      expect(readFileSync(server.file, 'utf8')).toBe(changed);
    } finally {
      second.host.dispose();
    }
  });

  it('já está na VPS, ou foi trazido de volta à mão: não faz de novo nem abre ssh', async () => {
    const pc = await pcWithLedger();
    const server = vps();
    const first = openApp(pc, server);
    expect((await first.host.autoMove()).ok).toBe(true);
    first.host.dispose();

    const again = openApp(pc, server);
    try {
      const calls = server.ssh.length;
      expect(await again.host.autoMove()).toMatchObject({ ok: false, state: { mode: 'remoto' } });
      expect(server.ssh.length).toBe(calls);
      expect((await again.host.back()).ok).toBe(true);
    } finally {
      again.host.dispose();
    }

    const afterBack = openApp(pc, server);
    try {
      const calls = server.ssh.length;
      expect(await afterBack.host.autoMove()).toMatchObject({ ok: false, state: { mode: 'local' } });
      expect(server.ssh.length).toBe(calls);
      expect(existsSync(join(pc.dir, REMOTE_CONFIG_FILE))).toBe(false);
    } finally {
      afterBack.host.dispose();
    }
  });
});
