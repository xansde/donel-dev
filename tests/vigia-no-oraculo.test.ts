// Vigia de travas no daemon do Oráculo (t-ffbf8e7d): com o PC desligado, o cofre trancado e as sessões em laço da VPS
// do Oráculo ainda viram UMA carta urgente (o push sai do próprio daemon). Com o PC ligado, o PC não abre a mesma
// carta de novo: ele deixa o cofre e as sessões daquela VPS para o daemon, e segue avisando se a VPS some.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { handshakeScript, parseHandshakeUrl } from '../src/main/ledger-remote-host';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createVigiaService } from '../src/main/vigia/vigia-service';
import { ownerInbox } from '../src/shared/ledger/inbox';
import type { LedgerOp } from '../src/shared/ledger/contract';
import { createDaemonVigia, VIGIA_CONFIG_FILE, VIGIA_ON_FILE } from '../src/oraculo/vigia';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const MIN = 60_000;
const NOW = 1_800_000_000_000;
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-oraculo-'));
  dirs.push(dir);
  return dir;
};

describe('vigia no daemon do Oráculo', () => {
  it('com o PC desligado, o cofre trancado na VPS do Oráculo vira uma carta só, nunca duas', async () => {
    const dir = temp();
    writeFileSync(join(dir, VIGIA_CONFIG_FILE), JSON.stringify({ placeId: 'vps-pessoal', label: 'VPS pessoal', projectPath: 'C:/seazone/donel', cofre: { command: 'cofre-cli', sessionFile: '.cofre/sessao' } }));
    let clock = NOW;
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => clock });
    const vigia = createDaemonVigia({
      dir,
      ledger: () => ledger,
      // The probe asks the vault; the health read answers with no session.
      run: async (script) => ({ code: 0, stdout: script.includes('DONEL_COFRE') ? 'DONEL_VIGIA_OK\nDONEL_COFRE locked 400\n' : '', stderr: '', timedOut: false }),
      now: () => clock,
    });
    for (let i = 0; i < 4; i += 1) {
      await vigia.round();
      clock += 5 * MIN;
    }
    const items = ownerInbox(ledger.load().doc, null, clock);
    expect(items.map((item) => item.kind)).toEqual(['decidir-entrega']);
    expect(items[0]!.task).toMatchObject({ risk: 'alto', ownerPlaceId: 'servico:vigia', projectPath: 'C:/seazone/donel' });
  });

  it('sem a config que o PC deixa, o daemon não vigia nada (nem inventa o nome do lugar)', async () => {
    const dir = temp();
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
    const scripts: string[] = [];
    const vigia = createDaemonVigia({ dir, ledger: () => ledger, run: async (script) => (scripts.push(script), { code: 0, stdout: '', stderr: '', timedOut: false }) });
    await vigia.round();
    await vigia.round();
    expect(scripts).toEqual([]);
    expect(Object.keys(ledger.load().doc.tasks)).toEqual([]);
  });
});

describe('PC com o Oráculo na VPS', () => {
  it('deixa o cofre e as sessões da VPS do Oráculo para o daemon, mas avisa se ela some', async () => {
    const dir = temp();
    const state = { clock: NOW, reached: true };
    const ops: LedgerOp[] = [];
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => state.clock });
    const vigia = createVigiaService({
      places: () => [{ id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'vps' }],
      run: async () =>
        state.reached
          ? { code: 0, stdout: 'DONEL_VIGIA_OK\nDONEL_COFRE locked 400\n', stderr: '', timedOut: false }
          : { code: 255, stdout: '', stderr: 'ssh: connect to host vps port 22: Connection timed out', timedOut: false },
      reports: () => [],
      apply: async (actor, op) => {
        ops.push(op);
        const result = await ledger.apply(actor, op);
        return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
      },
      projectPath: () => 'C:/seazone/donel',
      cofre: () => ({ command: 'cofre-cli', sessionFile: '.cofre/sessao' }),
      notify: () => undefined,
      statePath: join(dir, 'vigia-travas.json'),
      now: () => state.clock,
      delegated: () => 'vps-pessoal',
    });
    for (let i = 0; i < 3; i += 1) {
      await vigia.round();
      state.clock += 5 * MIN;
    }
    expect(ops).toEqual([]); // the daemon opens the vault's card, not the PC
    state.reached = false;
    for (let i = 0; i < 2; i += 1) {
      await vigia.round();
      state.clock += 5 * MIN;
    }
    expect(ops.filter((op) => op.op === 'criar')).toHaveLength(1); // the place itself fell: only the PC can tell
  });

  it('o aperto de mão deixa a config do vigia na VPS e só diz "vigia ativo" quando o daemon vigia', () => {
    const home = temp();
    const hash = 'a'.repeat(64);
    const vigia = { placeId: 'vps-pessoal', label: "VPS d'Alexandre", projectPath: 'C:/seazone/donel', cofre: null };
    const d = join(home, '.donel', 'oraculo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'url'), 'http://100.64.0.9:47816\n');
    const run = (): string => spawnSync('bash', ['-s'], { input: handshakeScript(hash, vigia), encoding: 'utf8', env: { ...process.env, HOME: home } }).stdout;
    const before = run();
    expect(before).not.toContain('vigia-ativo');
    expect(parseHandshakeUrl(before)).toBe('http://100.64.0.9:47816');
    expect(JSON.parse(spawnSync('cat', [join(d, VIGIA_CONFIG_FILE)], { encoding: 'utf8' }).stdout)).toEqual(vigia);
    writeFileSync(join(d, VIGIA_ON_FILE), '1\n');
    const after = run();
    expect(after).toContain('vigia-ativo');
    expect(parseHandshakeUrl(after)).toBe('http://100.64.0.9:47816');
  });

  it('sem quadro para a carta, o aperto de mão não diz "vigia ativo": o daemon não vigiaria e o PC não delega', () => {
    const home = temp();
    const d = join(home, '.donel', 'oraculo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'url'), 'http://100.64.0.9:47816\n');
    writeFileSync(join(d, VIGIA_ON_FILE), '1\n');
    const script = handshakeScript('a'.repeat(64), { placeId: 'vps-pessoal', label: 'VPS pessoal', projectPath: null, cofre: null });
    const out = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, HOME: home } }).stdout;
    expect(out).not.toContain('vigia-ativo');
    expect(parseHandshakeUrl(out)).toBe('http://100.64.0.9:47816');
  });
});

// Revisão do #353: PC e daemon no mesmo Oráculo, com a delegação mudando no meio de uma trava viva. Uma trava = uma
// carta: quem vai abrir adota a carta viva do vigia para a mesma trava, e quem deixa de vigiar não a cancela.
describe('a delegação muda com a trava viva', () => {
  function setup() {
    const pcDir = temp();
    const daemonDir = temp();
    writeFileSync(join(daemonDir, VIGIA_CONFIG_FILE), JSON.stringify({ placeId: 'vps-pessoal', label: 'VPS pessoal', projectPath: 'C:/seazone/donel', cofre: { command: 'cofre-cli', sessionFile: '.cofre/sessao' } }));
    const world = { clock: NOW, cofre: 'locked', delegated: null as string | null };
    const ledger = createLedgerService({ filePath: join(daemonDir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => world.clock });
    const probe = (script: string) => ({ code: 0, stdout: script.includes('DONEL_COFRE') ? `DONEL_VIGIA_OK\nDONEL_COFRE ${world.cofre} 400\n` : '', stderr: '', timedOut: false });
    const daemon = createDaemonVigia({ dir: daemonDir, ledger: () => ledger, run: async (script) => probe(script), now: () => world.clock });
    const pc = createVigiaService({
      places: () => [{ id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'vps' }],
      run: async (_target, script) => probe(script),
      reports: () => [],
      apply: async (actor, op) => {
        const result = await ledger.apply(actor, op);
        return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
      },
      tasks: () => Object.values(ledger.load().doc.tasks),
      projectPath: () => 'C:/seazone/donel',
      cofre: () => ({ command: 'cofre-cli', sessionFile: '.cofre/sessao' }),
      notify: () => undefined,
      statePath: join(pcDir, 'vigia-travas.json'),
      now: () => world.clock,
      delegated: () => world.delegated,
    });
    const rounds = async (n: number, who: { daemon: boolean }): Promise<void> => {
      for (let i = 0; i < n; i += 1) {
        if (who.daemon) await daemon.round();
        await pc.round();
        world.clock += 5 * MIN;
      }
    };
    const cards = () => Object.values(ledger.load().doc.tasks).map((task) => ({ id: task.id, state: task.state }));
    const live = () => cards().filter((card) => card.state === 'entregue').map((card) => card.id);
    return { world, rounds, cards, live };
  }

  it('o Oráculo volta da VPS ao PC: o PC adota a carta do daemon e a cancela quando a trava passa', async () => {
    const { world, rounds, cards, live } = setup();
    world.delegated = 'vps-pessoal';
    await rounds(3, { daemon: true });
    expect(cards()).toHaveLength(1);
    world.delegated = null; // the Oráculo came back to the PC
    await rounds(2, { daemon: false });
    expect(cards()).toHaveLength(1);
    world.cofre = 'unlocked';
    await rounds(2, { daemon: false });
    expect(live()).toEqual([]);
  });

  it('ligar e desligar a delegação com a trava viva não abre uma segunda carta', async () => {
    const { world, rounds, cards } = setup();
    for (const delegated of ['vps-pessoal', null, 'vps-pessoal', null, null]) {
      world.delegated = delegated;
      await rounds(2, { daemon: true });
    }
    expect(cards()).toHaveLength(1);
  });

  it('a delegação começa com a carta do PC aberta: ela segue viva, sem "passou" falso, e o daemon a adota', async () => {
    const { world, rounds, cards, live } = setup();
    await rounds(3, { daemon: false });
    const [first] = live();
    expect(first).toBeDefined();
    world.delegated = 'vps-pessoal';
    await rounds(3, { daemon: true });
    expect(cards()).toEqual([{ id: first, state: 'entregue' }]);
    world.cofre = 'unlocked';
    await rounds(2, { daemon: true });
    expect(live()).toEqual([]);
  });
});

// Re-revisão do #353: dois ledgers, como na vida real. Na volta ao PC o daemon segue rodando, lê o ledger da VPS (que
// fica parado) e tem a escrita recusada. A trava passa e volta durante a volta; quando o Oráculo vai de novo à VPS, a
// carta que o PC abriu não pode ficar viva para sempre.
describe('a trava passa e volta durante a volta do Oráculo ao PC', () => {
  it('o daemon troca a carta morta do estado dele pela viva da mesma chave, e nenhuma fica viva quando a trava passa', async () => {
    const pcDir = temp();
    const daemonDir = temp();
    writeFileSync(join(daemonDir, VIGIA_CONFIG_FILE), JSON.stringify({ placeId: 'vps-pessoal', label: 'VPS pessoal', projectPath: 'C:/seazone/donel', cofre: { command: 'cofre-cli', sessionFile: '.cofre/sessao' } }));
    const world = { clock: NOW, cofre: 'locked', where: 'vps' as 'vps' | 'pc' };
    const ledgerAt = (dir: string) => createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => world.clock });
    const vps = ledgerAt(daemonDir);
    const pcLedger = ledgerAt(pcDir);
    const oracle = () => (world.where === 'vps' ? vps : pcLedger);
    const move = (to: 'vps' | 'pc'): void => {
      copyFileSync(join(world.where === 'vps' ? daemonDir : pcDir, 'ledger.json'), join(to === 'vps' ? daemonDir : pcDir, 'ledger.json'));
      world.where = to;
    };
    const probe = (script: string) => ({ code: 0, stdout: script.includes('DONEL_COFRE') ? `DONEL_VIGIA_OK\nDONEL_COFRE ${world.cofre} 400\n` : '', stderr: '', timedOut: false });
    // The return guard: with the Oráculo back on the PC, the daemon reads its stale ledger and cannot write.
    const guarded = { ...vps, apply: async (...args: Parameters<typeof vps.apply>) => (world.where === 'vps' ? vps.apply(...args) : { ok: false as const, reason: 'o Oráculo voltou ao PC' }) };
    const daemon = createDaemonVigia({ dir: daemonDir, ledger: () => guarded, run: async (script) => probe(script), now: () => world.clock });
    const pc = createVigiaService({
      places: () => [{ id: 'vps-pessoal', label: 'VPS pessoal', sshTarget: 'vps' }],
      run: async (_target, script) => probe(script),
      reports: () => [],
      apply: async (actor, op) => {
        const result = await oracle().apply(actor, op);
        return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
      },
      tasks: () => Object.values(oracle().load().doc.tasks),
      projectPath: () => 'C:/seazone/donel',
      cofre: () => ({ command: 'cofre-cli', sessionFile: '.cofre/sessao' }),
      notify: () => undefined,
      statePath: join(pcDir, 'vigia-travas.json'),
      now: () => world.clock,
      delegated: () => (world.where === 'vps' ? 'vps-pessoal' : null),
    });
    const rounds = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i += 1) {
        await daemon.round();
        await pc.round();
        world.clock += 5 * MIN;
      }
    };
    const live = () => Object.values(oracle().load().doc.tasks).filter((task) => task.state === 'entregue').map((task) => task.id);

    await rounds(3); // on the VPS: the daemon opens A
    const [a] = live();
    expect(a).toBeDefined();
    move('pc');
    await rounds(2); // the PC adopts A
    world.cofre = 'unlocked';
    await rounds(2); // the lock passes: the PC cancels A
    world.cofre = 'locked';
    await rounds(3); // it comes back: the PC opens B; the daemon re-adopts A, alive only in its stale ledger
    const [b] = live();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
    move('vps');
    await rounds(3); // the PC hands B over to the daemon
    expect(live()).toEqual([b]);
    world.cofre = 'unlocked';
    await rounds(2);
    expect(live()).toEqual([]);
  });
});
