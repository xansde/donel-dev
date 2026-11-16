// t-205b44c8 (incidente t-fe46929a) — um lugar remoto passou por /clear: o tmux `donel-A` segue vivo e o claude dele já
// leva a conversa B. Retomar B (sessao_retomar ou o duplo clique do dono) achava o transcript de B e abria `claude -r B`
// num tmux novo `donel-B`: dois CLIs na mesma conversa. A busca agora diz qual id do lugar tem tmux vivo, e a retomada
// se liga a ele. Roda os scripts de verdade (bash), com tmux falso no PATH.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRemoteSetupScript, decideWhereLives, findRemoteTranscript, parseRemoteSetupOutput } from '../src/main/remote-session';
import { resumeSessionIdOf } from '../src/shared/sessions';

const sidA = 'aaaaaaaa-1111-4111-8111-111111111111';
const sidB = 'bbbbbbbb-2222-4222-8222-222222222222';
const meta = (sid: string) => ({ sid, hookToken: 't', hookPort: 21000, mcpToken: null, mcpPort: null, localCwd: '/p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' });
const places = [{ id: 'homolog', label: 'Homologações', sshTarget: 'homolog' }];

let home = '';
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

/** A place where `donel-<alive>` runs (folder and meta of it there) and the transcript of B exists for the project. */
function place(alive: string | null): NodeJS.ProcessEnv {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'donel-clear-')));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\ncase "$*" in *"has-session -t donel-${alive ?? 'none'}") exit 0;; esac\nexit 1\n`);
  chmodSync(join(bin, 'tmux'), 0o755);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const project = join(home, 'seazone', 'proj');
  mkdirSync(project, { recursive: true });
  const slug = project.replace(/[^a-zA-Z0-9]/g, '-');
  mkdirSync(join(home, '.claude', 'projects', slug), { recursive: true });
  writeFileSync(join(home, '.claude', 'projects', slug, `${sidA}.jsonl`), '{}\n');
  writeFileSync(join(home, '.claude', 'projects', slug, `${sidB}.jsonl`), '{}\n');
  if (alive) {
    const s = join(home, '.donel', 's', alive);
    mkdirSync(s, { recursive: true });
    writeFileSync(join(s, 'meta.json'), `${JSON.stringify(meta(alive))}\n`);
    writeFileSync(join(s, 'dir'), project);
  }
  return { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` };
}

const bash = (env: NodeJS.ProcessEnv) => async (_target: string, script: string) => ({
  code: 0,
  stdout: execFileSync('bash', ['-s'], { input: script, env, encoding: 'utf8' }),
  stderr: '',
  timedOut: false,
});

/** The resume of B as the renderer does it: where it lives (with the place's other ids), then the setup of the id it opens. */
async function resumeB(env: NodeJS.ProcessEnv) {
  const answers = await findRemoteTranscript(places, 'seazone/proj', sidB, [sidA], bash(env));
  const where = decideWhereLives(false, answers, places);
  const opened = resumeSessionIdOf(where, sidB);
  const script = buildRemoteSetupScript({ sid: opened, homeRelativeDir: 'seazone/proj', repoUrl: null, branch: null, files: [], claudeArgs: ['-r', opened], meta: meta(opened) });
  return { where, opened, setup: parseRemoteSetupOutput(execFileSync('bash', ['-s'], { input: script, env, encoding: 'utf8' }), 0) };
}

describe.skipIf(process.platform === 'win32')('retomar depois de /clear num lugar remoto', () => {
  it('com donel-A vivo levando B, a retomada de B se liga ao tmux de A e não monta sessão nova para B', async () => {
    const env = place(sidA);
    const { where, opened, setup } = await resumeB(env);
    expect(where).toEqual({ kind: 'remote', remoteId: 'homolog', liveSessionId: sidA });
    expect(opened).toBe(sidA);
    expect(setup).toMatchObject({ kind: 'alive', meta: { sid: sidA } });
    expect(existsSync(join(home, '.donel', 's', sidB))).toBe(false);
  });

  it('sem tmux vivo no lugar, retoma B como antes', async () => {
    const env = place(null);
    const { where, opened, setup } = await resumeB(env);
    expect(where).toEqual({ kind: 'remote', remoteId: 'homolog' });
    expect(opened).toBe(sidB);
    expect(setup.kind).toBe('new');
  });
});
