// Vigia de travas no daemon do Oráculo (t-ffbf8e7d): com o PC desligado, o cofre trancado e as sessões em laço da VPS
// do Oráculo ainda viram UMA carta urgente (o push sai do próprio daemon). Com o PC ligado, o PC não abre a mesma
// carta de novo: ele deixa o cofre e as sessões daquela VPS para o daemon, e segue avisando se a VPS some.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});
