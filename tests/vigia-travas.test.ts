import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RemoteHealthReport } from '../src/shared/health/remote';
import type { RemoteSessionReading } from '../src/shared/health/remoteSessions';
import { buildVigiaProbeScript, classifySshFailure, detectTravas, parseVigiaProbe, planRound, type PlaceProbe, type VigiaState } from '../src/shared/vigia/travas';
import { createVigiaService, vigiaCard } from '../src/main/vigia/vigia-service';
import { forOwnerRefusal, type LedgerOp } from '../src/shared/ledger/contract';
import { ownerInbox } from '../src/shared/ledger/inbox';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createSystemConfigIoDeps } from '../src/main/config-store';

// Vigia de travas, fase 1 (t-f15b71a7): o que congela tudo vira UMA carta urgente por trava (o Oráculo manda o push),
// nunca duas, nem depois de reiniciar; a trava que passa fecha a carta; nada do cofre além do estado sai da VPS.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const MIN = 60_000;
const NOW = 1_800_000_000_000;

function session(over: Partial<RemoteSessionReading>): RemoteSessionReading {
  return {
    sid: 's1',
    name: 'Dev · fatia',
    rssBytes: 1,
    cpuTicks: 1,
    clkTck: 100,
    pane: 'idle',
    paneActivityAt: NOW - 30 * MIN,
    transcript: true,
    lastAt: NOW - 30 * MIN,
    turn: 'ended',
    last: 'reply',
    ...over,
  } as RemoteSessionReading;
}

function report(sessions: RemoteSessionReading[], over: Partial<RemoteHealthReport> = {}): RemoteHealthReport {
  return {
    id: 'vps',
    label: 'VPS',
    status: 'ok',
    checkedAt: NOW,
    lastOkAt: NOW,
    severity: 'ok',
    reading: { readAt: NOW, sessionDetails: sessions } as unknown as RemoteHealthReport['reading'],
    ...over,
  } as RemoteHealthReport;
}

const ok: PlaceProbe = { placeId: 'vps', label: 'VPS', reached: true, cofre: { status: 'unlocked', ms: 900 } };

describe('detecção', () => {
  it('VPS ok, cofre aberto e sessões andando: nenhuma trava', () => {
    const working = session({ pane: 'busy', last: 'tool', lastAt: NOW - 20 * MIN });
    expect(detectTravas({ probes: [ok], reports: [report([working])], now: NOW })).toEqual([]);
  });

  it('cada trava: fora do ar, pedindo login, cofre trancado/lento, sessão em laço há mais de 10 min', () => {
    const keys = (probe: PlaceProbe, sessions: RemoteSessionReading[] = []): string[] =>
      detectTravas({ probes: [probe], reports: [report(sessions)], now: NOW }).map((trava) => trava.key);
    expect(keys({ ...ok, reached: false, failure: 'fora', cofre: undefined })).toEqual(['vps-fora:vps']);
    expect(keys({ ...ok, reached: false, failure: 'login', cofre: undefined })).toEqual(['vps-login:vps']);
    expect(keys({ ...ok, cofre: { status: 'locked', ms: 800 } })).toEqual(['cofre:vps']);
    expect(keys({ ...ok, cofre: { status: 'unauthenticated', ms: 800 } })).toEqual(['cofre:vps']);
    expect(keys({ ...ok, cofre: { status: 'unlocked', ms: 25_000 } })).toEqual(['cofre:vps']);
    expect(keys({ ...ok, cofre: { status: 'sem-resposta', ms: 25_000 } })).toEqual(['cofre:vps']);
    expect(keys({ ...ok, cofre: { status: 'ausente', ms: 0 } })).toEqual([]);
    const loop = session({ pane: 'busy', last: 'request', retry: { attempt: 7, at: NOW - 12 * MIN, text: '529 overloaded' } } as Partial<RemoteSessionReading>);
    const login = session({ sid: 's2', pane: 'login', paneActivityAt: NOW - 15 * MIN });
    expect(keys(ok, [loop, login])).toEqual(['sessoes:vps']);
  });

  it('sessão parada há 9 min, ou só esperando o dono, não é trava', () => {
    const recent = session({ pane: 'login', paneActivityAt: NOW - 9 * MIN });
    const asking = session({ sid: 's3', pane: 'permission', paneActivityAt: NOW - 50 * MIN });
    expect(detectTravas({ probes: [ok], reports: [report([recent, asking])], now: NOW })).toEqual([]);
  });

  it('o erro do ssh separa "pedindo login" de "fora do ar"', () => {
    expect(classifySshFailure('# Tailscale SSH requires an additional check. To authenticate, visit: https://login.tailscale.com/a/x', false)).toBe('login');
    expect(classifySshFailure('root@vps: Permission denied (publickey).', false)).toBe('login');
    expect(classifySshFailure('ssh: connect to host vps port 22: Connection timed out', false)).toBe('fora');
    expect(classifySshFailure('', true)).toBe('fora');
  });
});

describe('rodadas: uma carta por trava', () => {
  const trava = { key: 'cofre:vps', kind: 'cofre' as const, placeId: 'vps', label: 'VPS', since: NOW, detail: 'trancado' };

  it('uma rodada não abre; a segunda abre uma; a terceira não abre outra; a trava que some fecha a carta', () => {
    const first = planRound({ open: {} }, [trava], NOW);
    expect(first.toOpen).toEqual([]);
    const second = planRound(first.state, [trava], NOW + 5 * MIN);
    expect(second.toOpen.map((t) => t.key)).toEqual(['cofre:vps']);
    const withCarta: VigiaState = { open: { ...second.state.open, 'cofre:vps': { ...second.state.open['cofre:vps']!, cartaId: 't-1' } } };
    const third = planRound(withCarta, [trava], NOW + 10 * MIN);
    expect(third.toOpen).toEqual([]);
    const gone = planRound(third.state, [], NOW + 15 * MIN);
    expect(gone.toClose).toEqual([{ key: 'cofre:vps', cartaId: 't-1' }]);
    expect(gone.state.open).toEqual({});
    // Back again: it may warn again (after two rounds).
    expect(planRound(planRound(gone.state, [trava], NOW).state, [trava], NOW).toOpen).toHaveLength(1);
  });
});

describe('serviço: não repete carta nem push, nem depois de reiniciar', () => {
  it('a mesma trava em várias rodadas e depois de reiniciar gera uma carta só, que o dono vê; passando, a carta é cancelada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vigia-'));
    dirs.push(dir);
    const statePath = join(dir, 'vigia-travas.json');
    let clock = NOW;
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => clock });
    const ops: LedgerOp[] = [];
    let locked = true;
    const make = () =>
      createVigiaService({
        places: () => [{ id: 'vps', label: 'Homologações', sshTarget: 'vps' }],
        run: async () => ({ code: 0, stdout: `DONEL_VIGIA_OK\nDONEL_COFRE ${locked ? 'locked' : 'unlocked'} 700\n`, stderr: '', timedOut: false }),
        reports: () => [report([])],
        apply: async (actor, op) => {
          ops.push(op);
          const result = await ledger.apply(actor, op);
          return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
        },
        projectPath: () => '/projetos/donel',
        statePath,
        now: () => clock,
      });
    let vigia = make();
    for (let i = 0; i < 4; i += 1) {
      await vigia.round();
      clock += 5 * MIN;
    }
    vigia = make(); // the app restarted
    await vigia.round();
    expect(ops.filter((op) => op.op === 'criar')).toHaveLength(1);
    const { doc } = await ledger.load();
    const inbox = ownerInbox(doc, null, clock);
    // On the owner's queue (desktop and phone): a decision card, which the phone warns once (Urgency high).
    expect(inbox.map((item) => item.kind)).toEqual(['decidir-entrega']);
    const cardId = inbox[0]!.task.id;
    expect(JSON.parse(readFileSync(statePath, 'utf8')).open['cofre:vps'].cartaId).toBe(cardId);
    expect(doc.tasks[cardId]).toMatchObject({ risk: 'alto', ownerPlaceId: 'servico:vigia' });

    locked = false;
    await vigia.round();
    const after = await ledger.load();
    expect(ownerInbox(after.doc, null, clock)).toEqual([]);
    expect(ops.filter((op) => op.op === 'cancelar')).toHaveLength(1);
  });

  it('a carta de cada tipo de trava passa na regra do Oráculo (texto de gente, sem código)', () => {
    for (const kind of ['vps-fora', 'vps-login', 'cofre', 'sessoes'] as const) {
      expect(forOwnerRefusal(vigiaCard({ kind, label: 'Homologações' }), [{ kind: 'texto', text: 'prova' }]), kind).toBeNull();
    }
  });
});

describe.skipIf(process.platform === 'win32')('cofre: nada além do estado sai da VPS, e a chave nunca vai em argumento', () => {
  it('o script lê a chave no ambiente do bw e devolve só "status" e o tempo', () => {
    const home = mkdtempSync(join(tmpdir(), 'vigia-home-'));
    dirs.push(home);
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const key = 'CHAVE-DE-SESSAO-FALSA-1234567890';
    writeFileSync(join(home, '.bw_session'), `BW_SESSION=${key}\n`, { mode: 0o600 });
    // A fake `bw`: records its argv and whether the key came in the environment; answers like `bw status`.
    writeFileSync(
      join(bin, 'bw'),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${home}/argv"\n[ "$BW_SESSION" = "${key}" ] && echo sim > "${home}/env"\nprintf '{"serverUrl":null,"userEmail":"x@y","status":"locked","session":"%s"}' "$BW_SESSION"\n`,
    );
    chmodSync(join(bin, 'bw'), 0o755);
    const run = spawnSync('sh', ['-c', buildVigiaProbeScript()], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home }, encoding: 'utf8' });
    expect(run.stdout.includes(key)).toBe(false);
    expect(run.stderr.includes(key)).toBe(false);
    expect(readFileSync(join(home, 'argv'), 'utf8').includes(key)).toBe(false);
    expect(readFileSync(join(home, 'env'), 'utf8').trim()).toBe('sim');
    expect(parseVigiaProbe(run.stdout)).toMatchObject({ reached: true, cofre: { status: 'locked' } });
    expect(buildVigiaProbeScript().includes('--session')).toBe(false);
  });

  it('sem bw ou sem a sessão: "ausente", sem trava', () => {
    const home = mkdtempSync(join(tmpdir(), 'vigia-home-'));
    dirs.push(home);
    const run = spawnSync('sh', ['-c', buildVigiaProbeScript()], { env: { PATH: '/usr/bin:/bin', HOME: home }, encoding: 'utf8' });
    expect(parseVigiaProbe(run.stdout)).toMatchObject({ reached: true, cofre: { status: 'ausente' } });
  });
});
