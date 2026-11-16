// t-205b44c8 (incidente t-fe46929a) — um lugar remoto passou por /clear: o tmux `donel-A` segue vivo e o claude dele já
// leva a conversa B. Retomar B (sessao_retomar ou o duplo clique do dono) achava o transcript de B e abria `claude -r B`
// num tmux novo `donel-B`: dois CLIs na mesma conversa. A busca agora diz qual id do lugar tem tmux vivo, e a retomada
// se liga a ele, mas a aba segue levando B (o espelho, o lugar no quadro). Roda os scripts de verdade (bash), com tmux
// falso no PATH.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRemoteSetupScript,
  decideWhereLives,
  findRemoteTranscript,
  parseRemoteSetupOutput,
  RemoteSessionRegistry,
  remoteFolderAlreadyLive,
  remoteTranscriptPath,
} from '../src/main/remote-session';
import { resumeOtherIds } from '../src/shared/sessions';

const sidA = 'aaaaaaaa-1111-4111-8111-111111111111';
const sidB = 'bbbbbbbb-2222-4222-8222-222222222222';
const sidC = 'cccccccc-3333-4333-8333-333333333333';
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

/** The setup the main runs for a resume of B: in the live tmux's folder when the lookup named one (attach only). */
function setupOf(env: NodeJS.ProcessEnv, folder: string) {
  const script = buildRemoteSetupScript({
    sid: folder,
    homeRelativeDir: 'seazone/proj',
    repoUrl: null,
    branch: null,
    files: [],
    claudeArgs: ['-r', sidB],
    meta: meta(sidB),
    ...(folder !== sidB ? { attachOnly: true } : {}),
  });
  return parseRemoteSetupOutput(execFileSync('bash', ['-s'], { input: script, env, encoding: 'utf8' }), 0);
}

/** The shared transcript mirror of a place, faked: it records the transcript each `A` line asks it to follow. */
function fakeMirror() {
  const followed: string[] = [];
  const spawnMirror = () => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; killed: boolean; kill(): void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    child.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        const parts = line.split(' ');
        if (parts[0] === 'A' && parts.length === 4) followed.push(Buffer.from(parts[3], 'base64').toString('utf8'));
      }
    });
    return child as never;
  };
  return { followed, spawnMirror };
}

describe.skipIf(process.platform === 'win32')('retomar depois de /clear num lugar remoto', () => {
  it('com donel-A vivo levando B, a retomada de B se liga ao tmux de A, mas a aba espelha o transcript de B', async () => {
    const env = place(sidA);
    const answers = await findRemoteTranscript(places, 'seazone/proj', sidB, [sidA], bash(env));
    const where = decideWhereLives(false, answers, places);
    expect(where).toEqual({ kind: 'remote', remoteId: 'homolog', liveSessionId: sidA });

    const setup = setupOf(env, sidA);
    expect(setup).toMatchObject({ kind: 'alive', meta: { sid: sidA } });
    expect(existsSync(join(home, '.donel', 's', sidB))).toBe(false);
    if (setup.kind !== 'alive') return;

    const { followed, spawnMirror } = fakeMirror();
    const registry = new RemoteSessionRegistry(join(home, 'mirrors'), { spawnMirror });
    const mirror = registry.attach('pty-1', 'homolog', sidB, setup.remoteDir, sidA);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mirror).toBe(registry.mirrorPathFor(sidB));
    expect(followed).toEqual([remoteTranscriptPath(setup.remoteDir, sidB)]);
    // The tmux to end, relink and keep is A's; the conversation the tab carries is B.
    expect(registry.liveSessions()).toEqual([{ ptyId: 'pty-1', folder: sidA }]);
    registry.stopAll();
  });

  it('o tmux de A morreu entre a busca e a montagem: a montagem só para ligar não cria nada na pasta de A', () => {
    const env = place(null);
    expect(setupOf(env, sidA)).toEqual({ kind: 'gone' });
    expect(existsSync(join(home, '.donel', 's', sidA))).toBe(false);
    // The main then sets B up as before.
    expect(setupOf(env, sidB).kind).toBe('new');
  });

  it('sem tmux vivo no lugar, retoma B como antes', async () => {
    const env = place(null);
    const answers = await findRemoteTranscript(places, 'seazone/proj', sidB, [sidA], bash(env));
    expect(decideWhereLives(false, answers, places)).toEqual({ kind: 'remote', remoteId: 'homolog' });
    expect(setupOf(env, sidB).kind).toBe('new');
  });
});

describe('trava no main: a mesma pasta de tmux nunca ganha duas abas', () => {
  it('outra aba já segura a pasta de A naquele lugar: recusa; em outro lugar, ou outra pasta, deixa', () => {
    const registry = new RemoteSessionRegistry(join(tmpdir(), 'donel-trava-pasta'), { spawnMirror: fakeMirror().spawnMirror });
    registry.attach('pty-1', 'homolog', sidB, 'seazone/proj', sidA);
    const held = registry.heldFolders();
    expect(remoteFolderAlreadyLive(held, 'homolog', sidA)).toBe(true);
    expect(remoteFolderAlreadyLive(held, 'vps', sidA)).toBe(false);
    expect(remoteFolderAlreadyLive(held, 'homolog', sidB)).toBe(false);
    registry.stopAll();
  });
});

describe('quais outras conversas do lugar a busca pergunta se seguem vivas', () => {
  const card = { sessionId: sidC, previous: [sidA, sidB] };

  it('só quando se retoma a conversa atual do lugar, da mais nova para a mais velha', () => {
    expect(resumeOtherIds(card, sidC)).toEqual([sidB, sidA]);
  });

  it('retomar de propósito uma conversa mais velha não se liga ao tmux que leva a atual', () => {
    expect(resumeOtherIds(card, sidB)).toEqual([]);
    expect(resumeOtherIds(undefined, sidB)).toEqual([]);
  });

  it('com mais de 50 conversas anteriores, fica com as 50 mais novas', () => {
    const previous = Array.from({ length: 60 }, (_, n) => `0000${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`);
    const ids = resumeOtherIds({ sessionId: sidC, previous }, sidC);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe(previous[59]);
    expect(ids).not.toContain(previous[0]);
  });
});
