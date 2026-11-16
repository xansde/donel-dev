// t-fe46929a (16/11) — o app reabriu e o quadro inteiro da Homologações ficou "fechada" com 64 tmux vivos lá: a busca
// das sessões vivas no boot é um ssh só, e um lugar que não respondeu passava por "nada vivo lá", sem nova tentativa.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchTranscriptFromRemote, type RemoteCommand } from '../src/main/lider/transfer';
import { buildDiscoverScript, discoverAnswered, discoverRemoteSessions } from '../src/main/remote-session';

const sidA = 'aaaaaaaa-1111-4111-8111-111111111111';
const sidB = 'bbbbbbbb-2222-4222-8222-222222222222';
const metaLine = (sid: string): string =>
  `DONEL_META ${JSON.stringify({ sid, hookToken: 't', hookPort: 1, mcpToken: null, mcpPort: null, localCwd: '/p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' })}`;

let home = '';
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

describe('busca das sessões vivas no boot', () => {
  it('lugar que falhou, estourou o tempo ou cortou a lista no meio é dito como mudo, com o que chegou; o que respondeu, não', async () => {
    const answers: Record<string, { code: number | null; stdout: string; stderr: string; timedOut: boolean }> = {
      ok: { code: 0, stdout: `${metaLine(sidA)}\nDONEL_DISCOVER_END\n`, stderr: '', timedOut: false },
      vazio: { code: 0, stdout: 'DONEL_DISCOVER_END\n', stderr: '', timedOut: false },
      ssh: { code: 255, stdout: '', stderr: 'kex_exchange_identification: Connection reset by peer\r\n', timedOut: false },
      cortado: { code: null, stdout: `${metaLine(sidB)}\n`, stderr: '', timedOut: true },
    };
    const result = await discoverRemoteSessions(
      Object.keys(answers).map((id) => ({ id, sshTarget: `host-${id}` })),
      async (sshTarget) => answers[sshTarget.slice('host-'.length)],
    );

    expect(result.sessions.map((s) => [s.remoteId, s.meta.sid])).toEqual([
      ['ok', sidA],
      ['cortado', sidB],
    ]);
    expect(result.places.filter((p) => !p.answered).map((p) => p.id)).toEqual(['ssh', 'cortado']);
    expect(result.places.find((p) => p.id === 'ssh')).toMatchObject({ code: 255, found: 0, said: 'kex_exchange_identification: Connection reset by peer' });
    expect(result.places.find((p) => p.id === 'vazio')).toMatchObject({ answered: true, found: 0 });
  });

  it.skipIf(process.platform === 'win32')('o script de verdade termina com a marca, com e sem sessões vivas', () => {
    home = mkdtempSync(join(tmpdir(), 'donel-discover-'));
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'tmux'), 0o755);
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` };
    const run = (): string => execFileSync('bash', ['-s'], { input: buildDiscoverScript(), env, encoding: 'utf8' });

    expect(discoverAnswered(run())).toBe(true);
    mkdirSync(join(home, '.donel', 's', sidA), { recursive: true });
    writeFileSync(join(home, '.donel', 's', sidA, 'meta.json'), `${metaLine(sidA).slice('DONEL_META '.length)}\n`);
    const out = run();
    expect(out).toContain(`"sid":"${sidA}"`);
    expect(discoverAnswered(out)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('a conversa do Líder único é achada na pasta atrás de symlink, pelo caminho físico', async () => {
    home = mkdtempSync(join(tmpdir(), 'donel-lider-link-'));
    const real = join(home, 'opt', 'Homologacao');
    mkdirSync(real, { recursive: true });
    mkdirSync(join(home, 'seazone'));
    symlinkSync(real, join(home, 'seazone', 'Homologação'));
    const slug = real.replace(/[^a-zA-Z0-9]/g, '-');
    mkdirSync(join(home, '.claude', 'projects', slug), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', slug, `${sidA}.jsonl`), '{"a":1}\n');
    const run: RemoteCommand = (command) => spawn('sh', ['-c', command], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });

    const dest = join(home, 'veio.jsonl');
    expect(await fetchTranscriptFromRemote(run, 'seazone/Homologação', sidA, dest)).toEqual({ ok: true, size: 8 });
  });
});
