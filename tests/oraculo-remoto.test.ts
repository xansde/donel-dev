// Oráculo na VPS (t-d7a974d0), fatia 2 — the PC in remote mode. What breaks without the owner noticing: the move
// that loses a task or a proof, an older channel (same userData) that starts a second ledger over the mirror, a PC
// that writes while the VPS is away, or a way back that does not bring the VPS's ledger as it is.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs } from '../src/main/ledger-store';
import { bringLedgerBack, createRemoteLedgerService, LEDGER_BEFORE_REMOTE, moveLedgerToRemote, readRemoteMarker, REMOTE_MIRROR_VERSION, type OracleHttp } from '../src/main/ledger-remote';
import { createOracleApiHandler } from '../src/oraculo/api';
import { createRemoteOracleHost, REMOTE_CONFIG_FILE } from '../src/main/ledger-remote-host';
import { createSwitchableLedger } from '../src/main/ledger-remote';
import { createReturnGuard } from '../src/oraculo/devolvido';
import { readdirSync } from 'node:fs';
import type { LedgerForOwner } from '../src/shared/ledger/contract';

const TOKEN = 'c'.repeat(64);
const io = createSystemConfigIoDeps();
const dirs: string[] = [];
const marker = { lugar: 'vps-pessoal', desde: '2026-11-07T18:00:00.000Z' };
const LIDER = { kind: 'lugar' as const, placeId: 'place:lider', roleId: 'lider' };
const DEV = { kind: 'lugar' as const, placeId: 'place:dev' };
const FOR_OWNER: LedgerForOwner = {
  question: 'Aceito assim?',
  summary: 'Feito e testado.',
  options: [
    { label: 'Aceitar', effect: 'Vai para o alfa.', closes: 'aceita', recommended: true },
    { label: 'Refazer', effect: 'Volta para quem fez.', closes: 'rejeitada' },
  ],
  why: 'Os testes passaram.',
  risk: 'Baixo.',
};

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** The daemon, in process: its API over its own folder, and an `OracleHttp` that can be switched off. */
function vps() {
  const dir = tempDir('vps-');
  const file = join(dir, 'ledger.json');
  const guard = createReturnGuard(createLedgerService({ filePath: file, io, proofFs: nodeLedgerProofFs }), dir);
  const ledger = guard.ledger;
  const handle = createOracleApiHandler({ ledger, ledgerFile: file, tokenHash: () => createHash('sha256').update(TOKEN).digest('hex'), returned: guard });
  let up = true;
  const http: OracleHttp = async (method, path, body) => {
    if (!up) throw new Error('ECONNREFUSED');
    const res = await handle({ method, url: path, authorization: `Bearer ${TOKEN}`, body: typeof body === 'string' ? body : '', ...(body instanceof Uint8Array ? { bytes: body } : {}) });
    const raw = typeof res.body === 'string' ? Buffer.from(res.body) : readFileSync(res.body.filePath);
    return { status: res.status, text: async () => raw.toString('utf8'), bytes: async () => new Uint8Array(raw) };
  };
  return { file, ledger, http, setUp: (value: boolean) => (up = value) };
}

/** The PC's userData today: one delivered task with a print. */
async function pcWithLedger() {
  const dir = tempDir('pc-');
  const file = join(dir, 'ledger.json');
  mkdirSync(ledgerProofsDir(file), { recursive: true });
  const shot = join(dir, 'print.png');
  writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]));
  const local = createLedgerService({ filePath: file, io, proofFs: nodeLedgerProofFs });
  const created = await local.apply(LIDER, { op: 'criar', projectPath: '/p', request: 'faz X', doneWhen: 'X feito', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'alto' });
  if (!created.ok) throw new Error(created.reason);
  await local.apply(DEV, { op: 'assumir', id: created.task.id });
  const proof = await local.importProof({ tipo: 'arquivo', caminho: shot });
  if ('error' in proof) throw new Error(proof.error);
  const delivered = await local.apply(DEV, { op: 'entregar', id: created.task.id, proofs: [proof], forOwner: { ...FOR_OWNER, visual: { kind: 'prova', proof: 0 } } });
  if (!delivered.ok) throw new Error(delivered.reason);
  return { dir, file, id: created.task.id, proof: proof as { kind: 'arquivo'; file: string }, before: readFileSync(file, 'utf8') };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Oráculo na VPS — o PC em modo remoto', { timeout: 30_000 }, () => {
  it('a troca leva o registro e as provas byte a byte, guarda o do PC e deixa um espelho que canal antigo só lê', async () => {
    const pc = await pcWithLedger();
    const remote = vps();
    expect(await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker })).toEqual({ ok: true, tarefas: 1 });

    expect(readFileSync(remote.file, 'utf8')).toBe(pc.before);
    expect(JSON.parse(readFileSync(remote.file, 'utf8')).schemaVersion).toBe(4);
    expect(readFileSync(join(ledgerProofsDir(remote.file), pc.proof.file))).toEqual(readFileSync(join(ledgerProofsDir(pc.file), pc.proof.file)));
    expect(readFileSync(join(pc.dir, LEDGER_BEFORE_REMOTE), 'utf8')).toBe(pc.before);

    const mirror = JSON.parse(readFileSync(pc.file, 'utf8'));
    expect(mirror.schemaVersion).toBe(REMOTE_MIRROR_VERSION);
    expect(readRemoteMarker(io, pc.file)).toEqual(marker);
    // An older channel on the same userData: reads every task, writes nothing.
    const older = createLedgerService({ filePath: pc.file, io, proofFs: nodeLedgerProofFs });
    expect(older.load()).toMatchObject({ readOnly: true });
    expect(Object.keys(older.load().doc.tasks)).toEqual([pc.id]);
    expect((await older.apply({ kind: 'dono' }, { op: 'aceitar', id: pc.id })).ok).toBe(false);
    expect(readFileSync(pc.file, 'utf8')).toBe(JSON.stringify(mirror, null, 2));
  });

  it('não troca nada quando a VPS já tem outro registro ou está fora', async () => {
    const pc = await pcWithLedger();
    const remote = vps();
    await remote.ledger.apply(LIDER, { op: 'criar', projectPath: '/p', request: 'outra', doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' });
    const refused = await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    expect(refused).toMatchObject({ ok: false, reason: expect.stringMatching(/já tem 1 tarefa/) });
    const off = vps();
    off.setUp(false);
    expect((await moveLedgerToRemote({ http: off.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker })).ok).toBe(false);
    expect(readFileSync(pc.file, 'utf8')).toBe(pc.before);
    expect(existsSync(join(pc.dir, LEDGER_BEFORE_REMOTE))).toBe(false);
  });

  it('grava só pela VPS; com a VPS fora, mostra o último retrato só para ler e não grava nada no PC', async () => {
    const pc = await pcWithLedger();
    const remote = vps();
    await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    const changes: boolean[] = [];
    const service = createRemoteLedgerService({ http: () => remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker, onChange: (s) => changes.push(s.readOnly) });
    expect(service.load().readOnly, 'antes da primeira resposta: o espelho, só para ler').toBe(true);
    expect(await service.refresh()).toBe(true);
    expect(service.load().readOnly).toBe(false);

    const accepted = await service.apply({ kind: 'dono' }, { op: 'aceitar', id: pc.id });
    expect(accepted.ok).toBe(true);
    expect(JSON.parse(readFileSync(remote.file, 'utf8')).tasks[pc.id].state).toBe('aceita');
    expect(JSON.parse(readFileSync(pc.file, 'utf8')).tasks[pc.id].state).toBe('aceita');
    expect(JSON.parse(readFileSync(pc.file, 'utf8')).schemaVersion).toBe(REMOTE_MIRROR_VERSION);

    remote.setUp(false);
    const mirrorBefore = readFileSync(pc.file, 'utf8');
    const refused = await service.apply(LIDER, { op: 'criar', projectPath: '/p', request: 'nova', doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' });
    expect(refused).toMatchObject({ ok: false, reason: expect.stringMatching(/não respondeu; nada foi gravado/) });
    expect(service.load()).toMatchObject({ readOnly: true });
    expect(service.load().doc.tasks[pc.id]!.state).toBe('aceita');
    expect(readFileSync(pc.file, 'utf8')).toBe(mirrorBefore);
    expect(Object.keys(JSON.parse(readFileSync(remote.file, 'utf8')).tasks)).toHaveLength(1);
    expect(changes.at(-1)).toBe(true);
  });

  it('um daemon anterior ao app que só diz "op malformada" vira um motivo que diz a causa e como atualizar', async () => {
    // t-7a8f84a9: o daemon da VPS pessoal (anterior ao andamento) respondia 400 "op malformada" e nada mais.
    const pc = await pcWithLedger();
    const remote = vps();
    await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    const older: OracleHttp = async (method, path, body) => {
      if (path === '/v1/apply' && typeof body === 'string' && JSON.parse(body).op.op === 'andamento') {
        const raw = JSON.stringify({ error: 'op malformada' });
        return { status: 400, text: async () => raw, bytes: async () => new Uint8Array(Buffer.from(raw)) };
      }
      return remote.http(method, path, body);
    };
    const service = createRemoteLedgerService({ http: () => older, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    expect(await service.refresh()).toBe(true);
    const refused = await service.apply({ kind: 'lugar', placeId: 'place:a' }, { op: 'andamento', id: pc.id, progress: { estado: 'trabalhando' } });
    expect(refused).toMatchObject({ ok: false, reason: expect.stringMatching(/não conhece a operação "andamento".*versão anterior.*scripts\/oraculo-vps\.sh atualizar.*nada foi gravado/s) });
  });

  it('a VPS gravou mas a resposta não chegou inteira: nunca diz "nada foi gravado" (a sessão repetia e duplicava a tarefa)', async () => {
    // t-d7912fb9: 12/11, t-706e8d28 gravada na VPS e o PC disse "recusou (200); nada foi gravado" — a nova tentativa criou t-c09dae04.
    const pc = await pcWithLedger();
    const remote = vps();
    await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    let cut: 'corpo' | 'rede' | 'antes' = 'antes';
    const slow: OracleHttp = async (method, path, body) => {
      if (path === '/v1/apply' && cut === 'antes') {
        // The op never reaches the daemon, while another session writes on the same task: that is not "gravado".
        await remote.ledger.apply(DEV, { op: 'andamento', id: pc.id, progress: { estado: 'trabalhando', proximo: 'outro escritor' } });
        throw new Error('The operation was aborted due to timeout');
      }
      const response = await remote.http(method, path, body);
      if (path !== '/v1/apply') return response;
      if (cut === 'rede') throw new Error('The operation was aborted due to timeout');
      return { status: 200, text: async () => Promise.reject(new Error('The operation was aborted due to timeout')), bytes: response.bytes };
    };
    const service = createRemoteLedgerService({ http: () => slow, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    expect(await service.refresh()).toBe(true);

    const lost = await service.apply({ kind: 'dono' }, { op: 'aceitar', id: pc.id });
    expect(JSON.parse(readFileSync(remote.file, 'utf8')).tasks[pc.id].state).toBe('entregue');
    expect(lost).toMatchObject({ ok: false, reason: expect.stringMatching(new RegExp(`pode ter sido gravada.*tarefa_ver ${pc.id}`, 's')) });

    cut = 'corpo';
    const created = await service.apply(LIDER, { op: 'criar', projectPath: '/p', request: 'nova', doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' });
    expect(Object.keys(JSON.parse(readFileSync(remote.file, 'utf8')).tasks)).toHaveLength(2);
    expect(created).toMatchObject({ ok: false, reason: expect.stringMatching(/pode ter sido gravada.*tarefa_listar/s) });
    expect(created.ok ? '' : created.reason).not.toMatch(/nada foi gravado/);

    const accepted = await service.apply({ kind: 'dono' }, { op: 'aceitar', id: pc.id });
    expect(accepted).toMatchObject({ ok: true, task: { id: pc.id, state: 'aceita' } });

    cut = 'rede';
    const again = await service.apply(LIDER, { op: 'criar', projectPath: '/p', request: 'outra', doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' });
    expect(Object.keys(JSON.parse(readFileSync(remote.file, 'utf8')).tasks)).toHaveLength(3);
    expect(again).toMatchObject({ ok: false, reason: expect.stringMatching(/pode ter sido gravada/) });
    expect(again.ok ? '' : again.reason).not.toMatch(/nada foi gravado/);
  });

  it('a prova entregue pelo PC vai à VPS e fica também na cópia do PC', async () => {
    const pc = await pcWithLedger();
    const remote = vps();
    await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    const service = createRemoteLedgerService({ http: () => remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    await service.refresh();
    const shot = join(pc.dir, 'outro.png');
    writeFileSync(shot, Buffer.from([1, 2, 3, 4]));
    const proof = await service.importProof({ tipo: 'arquivo', caminho: shot });
    if ('error' in proof) throw new Error(proof.error);
    expect(readFileSync(join(ledgerProofsDir(remote.file), (proof as { file: string }).file))).toEqual(readFileSync(shot));
    expect(readFileSync(service.proofPath(proof)!)).toEqual(readFileSync(shot));
    await service.discardProofs([proof]);
    expect(existsSync(join(ledgerProofsDir(remote.file), (proof as { file: string }).file))).toBe(false);
  });

  it('a volta traz o registro da VPS como ele está, e o PC volta a gravar sozinho', async () => {
    const pc = await pcWithLedger();
    const remote = vps();
    await moveLedgerToRemote({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs, marker });
    await remote.ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: pc.id });
    // A proof the PC never saw: comes back too.
    rmSync(join(ledgerProofsDir(pc.file), pc.proof.file));
    expect(await bringLedgerBack({ http: remote.http, ledgerFile: pc.file, io, proofFs: nodeLedgerProofFs })).toEqual({ ok: true, tarefas: 1 });
    expect(readFileSync(pc.file, 'utf8')).toBe(readFileSync(remote.file, 'utf8'));
    expect(readRemoteMarker(io, pc.file)).toBeNull();
    expect(existsSync(join(ledgerProofsDir(pc.file), pc.proof.file))).toBe(true);
    const local = createLedgerService({ filePath: pc.file, io, proofFs: nodeLedgerProofFs });
    expect(local.load()).toMatchObject({ readOnly: false });
    expect(local.load().doc.tasks[pc.id]!.state).toBe('aceita');
  });

  it('pelas Preferências: o ssh deixa só o hash do token na VPS, a troca e a volta trocam o serviço sem reiniciar', async () => {
    const pc = await pcWithLedger();
    const vpsDir = tempDir('vps-');
    const vpsFile = join(vpsDir, 'ledger.json');
    let hashOnVps: string | null = null;
    const vpsGuard = createReturnGuard(createLedgerService({ filePath: vpsFile, io, proofFs: nodeLedgerProofFs }), vpsDir);
    const daemon = createOracleApiHandler({ ledger: vpsGuard.ledger, ledgerFile: vpsFile, tokenHash: () => hashOnVps, returned: vpsGuard });
    const scripts: string[] = [];
    const runScript = async (_target: string, script: string) => {
      scripts.push(script);
      hashOnVps = /'([0-9a-f]{64})'/.exec(script)![1]!;
      return { code: 0, stdout: 'http://100.64.0.9:47816\n', stderr: '' };
    };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const { pathname, search } = new URL(url);
      const body = init.body;
      const res = await daemon({ method: init.method ?? 'GET', url: pathname + search, authorization: (init.headers as Record<string, string>).Authorization, body: typeof body === 'string' ? body : '', ...(body instanceof Uint8Array ? { bytes: body } : {}) });
      const raw = typeof res.body === 'string' ? Buffer.from(res.body) : readFileSync(res.body.filePath);
      return new Response(raw, { status: res.status });
    }) as unknown as typeof fetch;
    const localService = () => createLedgerService({ filePath: pc.file, io, proofFs: nodeLedgerProofFs });
    const held = createSwitchableLedger(localService());
    const host = createRemoteOracleHost({
      userDataDir: pc.dir,
      ledgerFile: pc.file,
      io,
      proofFs: nodeLedgerProofFs,
      remotes: () => [{ id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'eu@vps' }],
      runScript,
      localService,
      setService: (next) => held.set(next),
      freeze: (reason) => held.freeze(reason),
      onChange: () => undefined,
      fetchImpl,
    });
    try {
      expect(host.boot().load().readOnly).toBe(false);
      const moved = await host.move('vps-pessoal');
      expect(moved).toMatchObject({ ok: true, state: { mode: 'remoto', lugar: 'vps-pessoal', conectado: true } });
      // The token itself never went through the ssh: only its hash.
      expect(scripts.every((script) => !script.includes('Bearer'))).toBe(true);
      expect(JSON.parse(readFileSync(join(pc.dir, REMOTE_CONFIG_FILE), 'utf8'))).toEqual({ lugar: 'vps-pessoal' });
      expect(readFileSync(vpsFile, 'utf8')).toBe(pc.before);
      // What the app holds now writes on the VPS.
      expect((await held.apply({ kind: 'dono' }, { op: 'aceitar', id: pc.id })).ok).toBe(true);
      expect(JSON.parse(readFileSync(vpsFile, 'utf8')).tasks[pc.id].state).toBe('aceita');

      const back = await host.back();
      expect(back).toMatchObject({ ok: true, state: { mode: 'local' } });
      expect(existsSync(join(pc.dir, REMOTE_CONFIG_FILE))).toBe(false);
      expect(readFileSync(pc.file, 'utf8')).toBe(readFileSync(vpsFile, 'utf8'));
      expect(held.load()).toMatchObject({ readOnly: false });
      expect(held.load().doc.tasks[pc.id]!.state).toBe('aceita');
    } finally {
      host.dispose();
    }
  });

  // ── Revisão do #295: um só escritor durante a troca e a volta ──────────────────────────────────────────────────

  /** The PC app (switchable + host) talking to a daemon whose writers all pass the return guard; `hook` runs before a request. */
  function harness(pc: { dir: string; file: string }) {
    const vpsDir = tempDir('vps-');
    const vpsFile = join(vpsDir, 'ledger.json');
    let hash: string | null = null;
    // The daemon's writers (the phone, the MCP gate) all go through this one guarded service.
    const guard = createReturnGuard(createLedgerService({ filePath: vpsFile, io, proofFs: nodeLedgerProofFs }), vpsDir);
    const daemon = createOracleApiHandler({ ledger: guard.ledger, ledgerFile: vpsFile, tokenHash: () => hash, returned: guard });
    const hooks: { before?: (method: string, path: string) => Promise<void> } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const { pathname, search } = new URL(url);
      await hooks.before?.(init.method ?? 'GET', pathname);
      const body = init.body;
      const res = await daemon({ method: init.method ?? 'GET', url: pathname + search, authorization: (init.headers as Record<string, string>).Authorization, body: typeof body === 'string' ? body : '', ...(body instanceof Uint8Array ? { bytes: body } : {}) });
      return new Response(typeof res.body === 'string' ? res.body : readFileSync(res.body.filePath), { status: res.status });
    }) as unknown as typeof fetch;
    const localService = () => createLedgerService({ filePath: pc.file, io, proofFs: nodeLedgerProofFs });
    const held = createSwitchableLedger(localService());
    const host = createRemoteOracleHost({
      userDataDir: pc.dir,
      ledgerFile: pc.file,
      io,
      proofFs: nodeLedgerProofFs,
      remotes: () => [{ id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'eu@vps' }],
      runScript: async (_target, script) => {
        hash = /'([0-9a-f]{64})'/.exec(script)![1]!;
        return { code: 0, stdout: 'http://100.64.0.9:47816\n', stderr: '' };
      },
      localService,
      setService: (next) => held.set(next),
      freeze: (reason) => held.freeze(reason),
      onChange: () => undefined,
      fetchImpl,
    });
    return { vpsDir, vpsFile, phone: guard.ledger, held, host, hooks };
  }
  const tasksIn = (file: string): string[] => Object.keys(JSON.parse(readFileSync(file, 'utf8')).tasks).sort();
  const newTask = { op: 'criar' as const, projectPath: '/p', request: 'no meio da troca', doneWhen: 'x', due: '2026-11-10', ownerPlaceId: 'place:dev', risk: 'baixo' as const };

  it('durante a troca o app recusa gravar, sem ok falso, e nada fica só no arquivo guardado', async () => {
    const pc = await pcWithLedger();
    const h = harness(pc);
    const during: { ok: boolean; reason?: string }[] = [];
    h.hooks.before = async (method, path) => {
      if (method === 'PUT' && path.startsWith('/v1/provas/') && during.length === 0) during.push(await h.held.apply(LIDER, newTask));
    };
    try {
      expect((await h.host.move('vps-pessoal')).ok).toBe(true);
      expect(during).toEqual([{ ok: false, reason: expect.stringMatching(/mudando de lugar/) }]);
      expect(tasksIn(h.vpsFile)).toEqual([pc.id]);
      expect(tasksIn(pc.file)).toEqual([pc.id]);
      expect(readFileSync(join(pc.dir, LEDGER_BEFORE_REMOTE), 'utf8')).toBe(readFileSync(h.vpsFile, 'utf8'));
      // Thawed: the app writes again, on the VPS.
      expect((await h.held.apply(LIDER, newTask)).ok).toBe(true);
      expect(tasksIn(h.vpsFile)).toHaveLength(2);
    } finally {
      h.host.dispose();
    }
  });

  it('outro canal grava o ledger.json do PC no meio da troca: a cópia recomeça e nada some', async () => {
    const pc = await pcWithLedger();
    const h = harness(pc);
    let wrote = false;
    h.hooks.before = async (method, path) => {
      if (method === 'POST' && path === '/v1/importar' && !wrote) {
        wrote = true;
        // An older channel (same userData, its own process) writes the PC's file during the copy.
        expect((await createLedgerService({ filePath: pc.file, io, proofFs: nodeLedgerProofFs }).apply(LIDER, newTask)).ok).toBe(true);
      }
    };
    try {
      expect((await h.host.move('vps-pessoal')).ok).toBe(true);
      expect(tasksIn(h.vpsFile)).toHaveLength(2);
      expect(tasksIn(pc.file)).toEqual(tasksIn(h.vpsFile));
      expect(readFileSync(join(pc.dir, LEDGER_BEFORE_REMOTE), 'utf8')).toBe(readFileSync(h.vpsFile, 'utf8'));
    } finally {
      h.host.dispose();
    }
  });

  it('durante a volta nem o app nem quem grava na VPS ganha ok falso; a VPS devolvida não grava mais e pode receber de novo', async () => {
    const pc = await pcWithLedger();
    const h = harness(pc);
    try {
      expect((await h.host.move('vps-pessoal')).ok).toBe(true);
      const during: { ok: boolean; reason?: string }[] = [];
      h.hooks.before = async (method, path) => {
        if (method === 'GET' && path === '/v1/ledger/arquivo' && during.length === 0) {
          during.push(await h.held.apply(LIDER, newTask));
          during.push(await h.phone.apply(LIDER, newTask));
        }
      };
      expect((await h.host.back()).ok).toBe(true);
      expect(during).toEqual([
        { ok: false, reason: expect.stringMatching(/mudando de lugar/) },
        { ok: false, reason: expect.stringMatching(/voltou para o PC/) },
      ]);
      expect(readFileSync(pc.file, 'utf8')).toBe(readFileSync(h.vpsFile, 'utf8'));
      expect((await h.phone.apply(LIDER, newTask)).ok, 'a VPS devolvida segue recusando').toBe(false);
      expect((await h.held.apply(LIDER, newTask)).ok, 'o PC grava sozinho').toBe(true);

      // Taking it there again replaces the dead copy, keeping it.
      h.hooks.before = undefined;
      expect(await h.host.move('vps-pessoal')).toMatchObject({ ok: true });
      expect(tasksIn(h.vpsFile)).toHaveLength(2);
      expect(readdirSync(h.vpsDir).some((name) => name.startsWith('ledger.devolvido-'))).toBe(true);
      expect((await h.phone.apply(LIDER, { ...newTask, request: 'de novo na VPS' })).ok).toBe(true);
    } finally {
      h.host.dispose();
    }
  });

  it('com o oraculo-remoto.json esquecido e um registro normal no PC, não entra no modo remoto nem grava por cima', async () => {
    const pc = await pcWithLedger();
    writeFileSync(join(pc.dir, REMOTE_CONFIG_FILE), JSON.stringify({ lugar: 'vps-pessoal' }));
    const h = harness(pc);
    try {
      const service = h.host.boot();
      expect(service.load()).toMatchObject({ readOnly: false });
      expect(h.host.state()).toMatchObject({ mode: 'local', erro: expect.stringMatching(/registro normal/) });
      expect(readFileSync(pc.file, 'utf8')).toBe(pc.before);
    } finally {
      h.host.dispose();
    }
  });
});
