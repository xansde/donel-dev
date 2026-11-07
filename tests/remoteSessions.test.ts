import { describe, expect, it } from 'vitest';
import { buildAttachSshArgs, buildRemoteSetupScript, parseRemoteSetupOutput, remoteDirFor } from '../src/main/remote-session';

// Sessões remotas — argv de lançamento: o que quebraria a sessão na VPS sem o dono ver por quê.
const sid = '11111111-2222-4333-8444-555555555555';
const meta = { sid, hookToken: 'tok', hookPort: 21000, mcpToken: null, mcpPort: null, localCwd: 'C:\\p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' };

describe('sessões remotas', () => {
  it('leva o claude à pasta certa, com aspas que sobrevivem a apóstrofo e arquivos da sessão', () => {
    const script = buildRemoteSetupScript({
      sid,
      homeRelativeDir: remoteDirFor('C:\\Users\\a\\seazone\\Donel Dev', ['C:\\Users\\a\\seazone']),
      repoUrl: null,
      branch: null,
      files: [],
      claudeArgs: ['-n', "it's", '--settings', '@S/settings.json'],
      meta,
    });
    const claudeSh = Buffer.from(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > "\$S"\/'claude\.sh'/.exec(script)![1], 'base64').toString('utf8');
    expect(claudeSh).toContain(`cd "$HOME"/'seazone/Donel Dev' || exit 1`);
    expect(claudeSh).toContain(`exec claude '-n' 'it'\\''s' '--settings' "$S"/'settings.json'`);
  });

  it('em bypass, o claude.sh libera o bypass (e o IS_SANDBOX quando roda como root); fora dele, não', () => {
    const claudeShOf = (claudeArgs: string[]): string => {
      const script = buildRemoteSetupScript({ sid, homeRelativeDir: 'p', repoUrl: null, branch: null, files: [], claudeArgs, meta });
      return Buffer.from(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > "\$S"\/'claude\.sh'/.exec(script)![1], 'base64').toString('utf8');
    };
    const bypass = claudeShOf(['--model', 'opus', '--permission-mode', 'bypassPermissions']);
    const exports = bypass.indexOf('export CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1');
    expect(exports).toBeGreaterThan(-1);
    expect(bypass).toContain('if [ "$(id -u)" = 0 ]; then export IS_SANDBOX=1; fi');
    expect(exports).toBeLessThan(bypass.indexOf('exec claude'));
    expect(bypass).toContain(`exec claude '--model' 'opus' '--permission-mode' 'bypassPermissions'`);
    expect(claudeShOf(['--permission-mode', 'auto'])).not.toContain('SKIP_PERMISSIONS');
    expect(claudeShOf(['--permission-mode', 'auto'])).not.toContain('IS_SANDBOX');
  });

  it('abre o ssh com terminal e um túnel reverso por porta, só no loopback', () => {
    expect(buildAttachSshArgs({ sshTarget: 'u@vps', sid, tunnels: [{ remotePort: 21000, localPort: 5555 }] })).toEqual([
      '-t',
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
      '-R', '127.0.0.1:21000:127.0.0.1:5555',
      '--',
      'u@vps',
      `bash -l "$HOME/.donel/s/${sid}/run.sh"`,
    ]);
    expect(() => buildAttachSshArgs({ sshTarget: 'u@vps', sid: 'x; rm -rf ~', tunnels: [] })).toThrow();
  });

  it('distingue sessão nova, sessão viva (reusa tokens) e erro', () => {
    expect(parseRemoteSetupOutput('DONEL_NEW\n/home/u/p\n', 0)).toEqual({ kind: 'new', remoteDir: '/home/u/p' });
    const alive = parseRemoteSetupOutput(`DONEL_ALIVE\n/home/u/p\n${JSON.stringify(meta)}\n`, 0);
    expect(alive.kind === 'alive' && alive.meta.hookToken).toBe('tok');
    expect(parseRemoteSetupOutput('DONEL_ERR sem tmux\n', 3)).toEqual({ kind: 'error', message: 'sem tmux' });
  });
});
