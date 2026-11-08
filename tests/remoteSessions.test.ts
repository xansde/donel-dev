import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAttachSshArgs, buildRemoteSetupScript, parseRemoteSetupOutput, remoteDirFor } from '../src/main/remote-session';

// Sessões remotas — argv de lançamento: o que quebraria a sessão na VPS sem o dono ver por quê.
const sid = '11111111-2222-4333-8444-555555555555';
const meta = { sid, hookToken: 'tok', hookPort: 21000, mcpToken: null, mcpPort: null, localCwd: 'C:\\p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' };

describe('sessões remotas', () => {
  it('leva o claude à pasta certa, com aspas que sobrevivem a apóstrofo e arquivos da sessão', () => {
    const script = buildRemoteSetupScript({
      sid,
      // Pasta local no formato do sistema em que o teste roda (o app roda no Windows e numa VPS Linux).
      homeRelativeDir: remoteDirFor(join(resolve('/Users/a'), 'seazone', 'Donel Dev'), [join(resolve('/Users/a'), 'seazone')]),
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
      '-o', 'ExitOnForwardFailure=yes',
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

  it('o erro de ssh traz o que o ssh disse, e o tempo esgotado diz que esgotou (07/11)', () => {
    const check = '# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/x\n';
    const timedOut = parseRemoteSetupOutput('', null, check, true);
    expect(timedOut.kind === 'error' && timedOut.message).toContain('não respondeu em 180 s');
    expect(timedOut.kind === 'error' && timedOut.message).toContain('https://login.tailscale.com/a/x');
    const refused = parseRemoteSetupOutput('', 255, 'root@vps: Permission denied (publickey).\r\n');
    expect(refused).toEqual({ kind: 'error', message: 'Não consegui entrar no lugar remoto por ssh: root@vps: Permission denied (publickey).' });
  });

  it('a linha do ssh chega sem caractere de controle ao terminal e ao chat (07/11)', () => {
    const noisy = 'progresso 10%\rprogresso 99%\r\x1b[31mroot@vps: \x1b]0;título\x07Permission\x00 denied\x1b[0m\x9b\x7f\n';
    const answer = parseRemoteSetupOutput('', 255, noisy);
    expect(answer).toEqual({ kind: 'error', message: 'Não consegui entrar no lugar remoto por ssh: root@vps: Permission denied' });
  });
});
