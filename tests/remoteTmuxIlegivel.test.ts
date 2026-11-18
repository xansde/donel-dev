import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProbeScript, buildRemoteSetupScript, parseProbeOutput, parseRemoteSetupOutput } from '../src/main/remote-session';

// 'gone' fecha a aba remota (sonda) ou abre outro claude ao lado do tmux vivo (preparo só de religar): só a ausência
// que o próprio tmux afirma vale como sessão encerrada; tmux que não deu para ler é "sem resposta".
const sid = '11111111-2222-4333-8444-555555555555';
const meta = { sid, hookToken: 'tok', hookPort: 21000, mcpToken: null, mcpPort: null, localCwd: '/p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs `script` in bash with a fake `tmux` first in the PATH that fails saying `said` on stderr. */
function runWithFakeTmux(script: string, said: string, prepare?: (home: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'donel-tmux-'));
  dirs.push(root);
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$FAKE_TMUX_SAID" >&2\nexit 1\n`);
  chmodSync(join(bin, 'tmux'), 0o755);
  prepare?.(home);
  const run = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, FAKE_TMUX_SAID: said } });
  return run.stdout;
}

const unreadable = 'error connecting to /tmp/tmux-1000/donel (Permission denied)';
const absences = [`can't find session: donel-${sid}`, 'no server running on /tmp/tmux-1000/donel', 'error connecting to /tmp/tmux-1000/donel (No such file or directory)', 'error connecting to /tmp/tmux-1000/donel (Connection refused)'];

describe.skipIf(process.platform === 'win32')('tmux ilegível não é sessão morta', () => {
  it('a sonda dá "sem resposta" quando o tmux não deu para ler, e "encerrada" só quando ele diz que a sessão não existe', () => {
    expect(parseProbeOutput(runWithFakeTmux(buildProbeScript(sid), unreadable))).toBe('unreachable');
    for (const said of absences) expect(parseProbeOutput(runWithFakeTmux(buildProbeScript(sid), said)), said).toBe('gone');
  });

  it('o preparo só de religar não dá a sessão por encerrada quando o tmux não deu para ler', () => {
    const script = buildRemoteSetupScript({ sid, homeRelativeDir: 'p', repoUrl: null, branch: null, files: [], claudeArgs: [], meta, attachOnly: true });
    const withSession = (home: string): void => {
      const folder = join(home, '.donel', 's', sid);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'meta.json'), JSON.stringify(meta));
      writeFileSync(join(folder, 'dir'), home);
    };
    expect(parseRemoteSetupOutput(runWithFakeTmux(script, unreadable, withSession), 0).kind).toBe('error');
    for (const said of absences) expect(parseRemoteSetupOutput(runWithFakeTmux(script, said, withSession), 0).kind, said).toBe('gone');
    // Sem a pasta da sessão lá, não há o que religar.
    expect(parseRemoteSetupOutput(runWithFakeTmux(script, unreadable), 0).kind).toBe('gone');
  });
});
