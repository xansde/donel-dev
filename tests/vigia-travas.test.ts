import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RemoteHealthReport } from '../src/shared/health/remote';
import type { RemoteSessionReading } from '../src/shared/health/remoteSessions';
import { buildVigiaProbeScript, classifySshFailure, detectTravas, parseVigiaProbe, planRound, type PlaceProbe, type VigiaState } from '../src/shared/vigia/travas';
import { createVigiaService, vigiaCard, vigiaClock } from '../src/main/vigia/vigia-service';
import { sanitizeVigiaPrefs } from '../src/shared/vigia/config';
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

  it('sessão parada há 9 min, só esperando o dono, ou numa resposta longa, não é trava', () => {
    const recent = session({ pane: 'login', paneActivityAt: NOW - 9 * MIN });
    const asking = session({ sid: 's3', pane: 'permission', paneActivityAt: NOW - 50 * MIN });
    // A long, legitimate answer: waiting on the API for 15 min, but not retrying a failed call.
    const longAnswer = session({ sid: 's4', pane: 'busy', last: 'request', lastAt: NOW - 15 * MIN, retry: null } as Partial<RemoteSessionReading>);
    expect(detectTravas({ probes: [ok], reports: [report([recent, asking, longAnswer])], now: NOW })).toEqual([]);
  });

  it('o erro do ssh separa "pedindo login" de "fora do ar"', () => {
    expect(classifySshFailure('# Tailscale SSH requires an additional check. To authenticate, visit: https://login.tailscale.com/a/x', false)).toBe('login');
    expect(classifySshFailure('root@vps: Permission denied (publickey).', false)).toBe('login');
    expect(classifySshFailure('ssh: connect to host vps port 22: Connection timed out', false)).toBe('fora');
    expect(classifySshFailure('', true)).toBe('fora');
  });
});

describe('rodadas: uma carta por trava', () => {
  const trava = { key: 'cofre:vps', kind: 'cofre' as const, placeId: 'vps', label: 'VPS', detail: 'trancado' };

  it('uma rodada não abre; a segunda abre uma; a terceira não abre outra; a trava que some fecha a carta', () => {
    const first = planRound({ open: {} }, [trava], NOW);
    expect(first.toOpen).toEqual([]);
    const second = planRound(first.state, [trava], NOW + 5 * MIN);
    expect(second.toOpen).toEqual([{ trava, firstSeen: NOW }]);
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

const COFRE = { command: 'cofre-cli', sessionFile: '.cofre/sessao' };

describe('serviço: uma carta por trava, aviso no PC quando o Oráculo não responde', () => {
  function setup(options: { cofre?: typeof COFRE | null } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'vigia-'));
    dirs.push(dir);
    const statePath = join(dir, 'vigia-travas.json');
    const state = { clock: NOW, locked: true, oraculoUp: true, reached: true };
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => state.clock });
    const ops: LedgerOp[] = [];
    const notes: Array<{ title: string; body: string }> = [];
    const scripts: string[] = [];
    const make = () =>
      createVigiaService({
        places: () => [{ id: 'vps', label: 'Homologações', sshTarget: 'vps' }],
        run: async (_target, script) => {
          scripts.push(script);
          if (!state.reached) return { code: 255, stdout: '', stderr: 'ssh: connect to host vps port 22: Connection timed out', timedOut: false };
          return { code: 0, stdout: `DONEL_VIGIA_OK\n${script.includes('DONEL_COFRE') ? `DONEL_COFRE ${state.locked ? 'locked' : 'unlocked'} 700\n` : ''}`, stderr: '', timedOut: false };
        },
        reports: () => [report([])],
        apply: async (actor, op) => {
          if (!state.oraculoUp) return { ok: false, reason: 'O Oráculo não respondeu.' };
          ops.push(op);
          const result = await ledger.apply(actor, op);
          return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
        },
        projectPath: () => '/projetos/donel',
        cofre: () => (options.cofre === undefined ? COFRE : options.cofre),
        notify: (title, body) => notes.push({ title, body }),
        statePath,
        now: () => state.clock,
      });
    const rounds = async (vigia: ReturnType<typeof make>, n: number): Promise<void> => {
      for (let i = 0; i < n; i += 1) {
        await vigia.round();
        state.clock += 5 * MIN;
      }
    };
    return { state, ledger, ops, notes, scripts, statePath, make, rounds };
  }

  it('a mesma trava em várias rodadas e depois de reiniciar gera uma carta só, que o dono vê; passando, a carta é cancelada', async () => {
    const t = setup();
    await t.rounds(t.make(), 4);
    const vigia = t.make(); // the app restarted
    await vigia.round();
    expect(t.ops.filter((op) => op.op === 'criar')).toHaveLength(1);
    const { doc } = await t.ledger.load();
    const inbox = ownerInbox(doc, null, t.state.clock);
    // On the owner's queue (desktop and phone): a decision card, which the phone warns once (Urgency high).
    expect(inbox.map((item) => item.kind)).toEqual(['decidir-entrega']);
    const cardId = inbox[0]!.task.id;
    expect(JSON.parse(readFileSync(t.statePath, 'utf8')).open['cofre:vps'].cartaId).toBe(cardId);
    expect(doc.tasks[cardId]).toMatchObject({ risk: 'alto', ownerPlaceId: 'servico:vigia' });
    expect(t.notes).toEqual([]);

    t.state.locked = false;
    await vigia.round();
    expect(ownerInbox((await t.ledger.load()).doc, null, t.state.clock)).toEqual([]);
    expect(t.ops.filter((op) => op.op === 'cancelar')).toHaveLength(1);
  });

  it('o Oráculo fora (a VPS dele caiu): aviso nativo no PC uma vez; quando ele volta, a carta sai com o horário real', async () => {
    const t = setup();
    t.state.oraculoUp = false;
    t.state.reached = false;
    const vigia = t.make();
    await t.rounds(vigia, 5);
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0]!.body).toContain(vigiaClock(NOW));
    t.state.oraculoUp = true;
    await t.rounds(vigia, 2);
    expect(t.notes).toHaveLength(1);
    const { doc } = await t.ledger.load();
    const card = ownerInbox(doc, null, t.state.clock).map((item) => item.task);
    expect(card).toHaveLength(1);
    expect(JSON.stringify(card[0])).toContain(vigiaClock(NOW)); // since the first reading, not since the card
  });

  it('a trava passa com o Oráculo fora: a carta de registro sai quando ele volta, com início e fim', async () => {
    const t = setup();
    t.state.oraculoUp = false;
    t.state.reached = false;
    const vigia = t.make();
    await t.rounds(vigia, 3);
    expect(t.notes).toHaveLength(1);
    t.state.reached = true;
    t.state.locked = false;
    const endedAt = t.state.clock;
    await t.rounds(vigia, 2); // passed, Oráculo still down: nothing yet
    t.state.oraculoUp = true;
    await t.rounds(vigia, 2);
    const items = ownerInbox((await t.ledger.load()).doc, null, t.state.clock);
    expect(items).toHaveLength(1);
    const text = JSON.stringify(items[0]!.task);
    expect(text).toContain(vigiaClock(NOW));
    expect(text).toContain(vigiaClock(endedAt));
    expect(JSON.parse(readFileSync(t.statePath, 'utf8')).open).toEqual({});
  });

  it('sem o adaptador do cofre na config, o vigia não olha cofre nenhum', async () => {
    const t = setup({ cofre: null });
    await t.rounds(t.make(), 3);
    expect(t.scripts.every((script) => !script.includes('DONEL_COFRE'))).toBe(true);
    expect(t.ops).toEqual([]);
    expect(sanitizeVigiaPrefs(undefined)).toEqual({ cofre: null });
    expect(sanitizeVigiaPrefs({ cofre: { command: 'x; rm', sessionFile: 'a' } })).toEqual({ cofre: null });
    expect(sanitizeVigiaPrefs({ cofre: { command: 'cofre-cli', sessionFile: '../fora' } })).toEqual({ cofre: null });
    expect(sanitizeVigiaPrefs({ cofre: COFRE })).toEqual({ cofre: COFRE });
  });

  it('a carta de cada tipo de trava, aberta ou já passada, passa na regra do Oráculo (texto de gente, sem código)', () => {
    for (const kind of ['vps-fora', 'vps-login', 'cofre', 'sessoes'] as const) {
      expect(forOwnerRefusal(vigiaCard({ kind, label: 'Homologações' }, NOW), [{ kind: 'texto', text: 'prova' }]), kind).toBeNull();
      expect(forOwnerRefusal(vigiaCard({ kind, label: 'Homologações' }, NOW, NOW + 30 * MIN), [{ kind: 'texto', text: 'prova' }]), kind).toBeNull();
    }
  });
});

describe.skipIf(process.platform === 'win32')('cofre: nada além do estado sai da VPS, e a chave nunca vai em argumento', () => {
  it('o script lê a chave no ambiente do comando do cofre e devolve só "status" e o tempo', () => {
    const home = mkdtempSync(join(tmpdir(), 'vigia-home-'));
    dirs.push(home);
    const bin = join(home, 'bin');
    mkdirSync(bin);
    mkdirSync(join(home, '.cofre'));
    const key = 'CHAVE-DE-SESSAO-FALSA-1234567890';
    writeFileSync(join(home, '.cofre', 'sessao'), `COFRE_SESSAO=${key}\n`, { mode: 0o600 });
    // A fake vault command: records its argv and whether the key came in the environment; answers its status.
    writeFileSync(
      join(bin, 'cofre-cli'),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "${home}/argv"\n[ "$COFRE_SESSAO" = "${key}" ] && echo sim > "${home}/env"\nprintf '{"userEmail":"x@y","status":"locked","sessao":"%s"}' "$COFRE_SESSAO"\n`,
    );
    chmodSync(join(bin, 'cofre-cli'), 0o755);
    const run = spawnSync('sh', ['-c', buildVigiaProbeScript(COFRE)], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home }, encoding: 'utf8' });
    expect(run.stdout.includes(key)).toBe(false);
    expect(run.stderr.includes(key)).toBe(false);
    expect(readFileSync(join(home, 'argv'), 'utf8').trim()).toBe('status');
    expect(readFileSync(join(home, 'env'), 'utf8').trim()).toBe('sim');
    expect(parseVigiaProbe(run.stdout)).toMatchObject({ reached: true, cofre: { status: 'locked' } });
  });

  it('sem o comando ou sem o arquivo de sessão: "ausente", sem trava', () => {
    const home = mkdtempSync(join(tmpdir(), 'vigia-home-'));
    dirs.push(home);
    const run = spawnSync('sh', ['-c', buildVigiaProbeScript(COFRE)], { env: { PATH: '/usr/bin:/bin', HOME: home }, encoding: 'utf8' });
    expect(parseVigiaProbe(run.stdout)).toMatchObject({ reached: true, cofre: { status: 'ausente' } });
  });
});
