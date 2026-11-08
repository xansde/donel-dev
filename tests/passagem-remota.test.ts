// Passagem de bastão de uma sessão numa VPS (B36 remoto): sem isto a sessão da VPS recebia um caminho do PC, escrevia
// a passagem noutro lugar, o app não a achava e a sessão nova nunca abria (ou abria do zero, sem a passagem).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRemoteHomeScript,
  buildRemoteReadScript,
  buildRemoteWriteScript,
  createSessionRenewalService,
  parseRemoteHome,
  parseRemoteRead,
} from '../src/main/session-renewal';
import { parseHandoffHeader } from '../src/shared/sessionRenewal';

/** Runs a script the way `runRemoteScript` does (bash, on stdin), in a fake `$HOME`. */
function onPlace(home: string, script: string): string {
  const run = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, HOME: home } });
  expect(run.status).toBe(0);
  return run.stdout;
}

describe('passagem de bastão de uma sessão numa VPS', () => {
  it('as instruções e a passagem ficam na VPS, e as duas sessões recebem caminhos de lá', () => {
    const written: string[] = [];
    const service = createSessionRenewalService({
      handoffsDir: 'C:\\Users\\dono\\AppData\\Roaming\\donel-dev\\handoffs',
      randomId: () => 'r1',
      now: () => new Date(2026, 10, 8, 14, 5, 9).getTime(),
      fs: { mkdirSync: (path) => written.push(path), writeFileSync: (path) => written.push(path), readFileText: () => null },
    });
    const record = service.prepare(
      { sessionId: 'abcdef12-0000-4000-8000-000000000000', transcriptPath: null, cwd: '/root/seazone/Donel Dev', contextTokens: 260_000, limitTokens: 250_000 },
      { sshTarget: 'root@vps', home: '/root' },
    );
    expect(written).toEqual([]); // nada no PC: o main grava na VPS
    expect(record.handoffPath).toBe('/root/.donel/handoffs/2026-11-08-140509-donel-dev-abcdef12.md');
    expect(record.instructionsPath).toBe('/root/.donel/handoffs/2026-11-08-140509-donel-dev-abcdef12.instrucoes.md');
    expect(record.requestPrompt).toContain(record.instructionsPath);
    expect(record.instructions).toContain(record.handoffPath);
    expect(record.firstPrompt).toContain(record.handoffPath);
    expect(`${record.requestPrompt}${record.firstPrompt}${record.instructions}`).not.toContain('AppData');
    expect(record.remote?.localCopyPath).toContain('donel-dev');
    // A passagem da VPS é lida por ssh, nunca no disco do PC.
    expect(service.status('r1')).toEqual({ kind: 'missing' });
  });

  it('grava as instruções byte a byte na VPS e lê a passagem de volta, pronta', () => {
    const home = mkdtempSync(join(tmpdir(), 'donel-vps-home-'));
    expect(parseRemoteHome(`motd qualquer\n${onPlace(home, buildRemoteHomeScript())}`)).toBe(home);

    const path = `${home}/.donel/handoffs/x.instrucoes.md`;
    const tricky = "# Passagem\n$HOME `whoami` $(id -u) 'aspas' \"duplas\" \\ fim";
    expect(onPlace(home, buildRemoteWriteScript(path, tricky))).toContain('DONEL_OK');
    expect(readFileSync(path, 'utf8')).toBe(`${tricky}\n`);

    const handoff = `${home}/.donel/handoffs/x.md`;
    expect(parseHandoffHeader(parseRemoteRead(onPlace(home, buildRemoteReadScript(handoff))))).toEqual({ kind: 'missing' });
    onPlace(home, buildRemoteWriteScript(handoff, '---\ndonel-passagem: 1\nsessao-anterior: abc\ntrabalho-vivo: nenhum\n---\n# Passagem'));
    expect(parseHandoffHeader(parseRemoteRead(onPlace(home, buildRemoteReadScript(handoff))))).toEqual({ kind: 'ready', liveWork: null });
    // ssh que não respondeu: nunca vira "passagem pronta".
    expect(parseRemoteRead('')).toBeNull();
  });
});
