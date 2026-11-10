import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carryTranscriptLocally } from '../src/main/lider/carry-transcript';
import { fetchTranscriptFromRemote, sendTranscriptToRemote, type RemoteCommand } from '../src/main/lider/transfer';
import { remoteAliveFromMeta, type RemoteSessionMeta } from '../src/main/remote-session';
import { defaultAppConfig, sanitizeAppConfig } from '../src/main/config-store';
import { leaderMoves, leaderRemoteId, sanitizeLeaderPrefs } from '../src/shared/leaderPrefs';
import { planLeaderDelivery, startLeaderMove, type LeaderMoveDeps } from '../src/shared/lider/move';

// Líder único na VPS (docs/planos/lider-na-vps.md): o que faria o Líder sumir ou perder a conversa sem o dono ver.
const sid = '11111111-2222-4333-8444-555555555555';
const meta: RemoteSessionMeta = {
  sid,
  hookToken: 'tok',
  hookPort: 21000,
  mcpToken: null,
  mcpPort: null,
  localCwd: 'C:\\Users\\a\\seazone',
  projectName: 'C:\\Users\\a\\seazone',
  name: 'Líder',
  launchArgs: ['--model', 'opus'],
  createdAt: '',
};

/** A "remote place" that is a folder here: the command runs in `sh`, with `home` as `$HOME` and a fake `tmux`. */
function fakePlace(): { home: string; run: RemoteCommand; tmuxLog: string; target: string } {
  const home = mkdtempSync(join(tmpdir(), 'lider-home-'));
  mkdirSync(join(home, 'seazone'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const tmuxLog = join(home, 'tmux.log');
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\necho "$@" >> '${tmuxLog}'\n`);
  chmodSync(join(bin, 'tmux'), 0o755);
  const run: RemoteCommand = (command) =>
    spawn('sh', ['-c', command], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  const slug = join(home, 'seazone').replace(/[^a-zA-Z0-9]/g, '-');
  return { home, run, tmuxLog, target: join(home, '.claude', 'projects', slug, `${sid}.jsonl`) };
}

/** A transcript of `bytes` bytes, made of JSONL lines. */
function bigTranscript(path: string, bytes: number): string {
  const line = `${JSON.stringify({ type: 'assistant', text: randomBytes(300).toString('base64') })}\n`;
  const content = line.repeat(Math.ceil(bytes / line.length));
  writeFileSync(path, content);
  return content;
}

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

describe('Líder único na VPS', () => {
  it('o Líder roda na VPS por padrão; "este computador" só quando o dono escolheu', () => {
    const remotes = [
      { id: 'vps-sem-conta', hasAccount: false },
      { id: 'vps-1', hasAccount: true },
    ];
    // Sem escolha: o primeiro lugar remoto com conta (owner, 08/11: a orquestradora na VPS, o PC só com o app).
    expect(sanitizeLeaderPrefs(undefined)).toEqual({ where: 'auto' });
    expect(leaderRemoteId(sanitizeLeaderPrefs(undefined), remotes)).toBe('vps-1');
    expect(leaderRemoteId({ where: 'auto' }, [{ id: 'vps-sem-conta', hasAccount: false }])).toBeUndefined();
    // O #296 gravou o padrão antigo ('local') na primeira escrita do config: sem a marca de escolha, vira 'auto'.
    expect(sanitizeLeaderPrefs({ where: 'local' })).toEqual({ where: 'auto' });
    expect(sanitizeLeaderPrefs({ where: 'local', chosen: true })).toEqual({ where: 'local', chosen: true });
    expect(leaderRemoteId({ where: 'local', chosen: true }, remotes)).toBeUndefined();
    expect(sanitizeLeaderPrefs({ where: 'vps-1', chosen: true })).toEqual({ where: 'vps-1', chosen: true });
    expect(sanitizeLeaderPrefs({ where: 42 })).toEqual({ where: 'auto' });
    expect(leaderRemoteId({ where: 'vps-1' }, remotes)).toBe('vps-1');
    // Um lugar escolhido que foi removido: este computador, nunca outro lugar no escuro.
    expect(leaderRemoteId({ where: 'vps-removida', chosen: true }, remotes)).toBeUndefined();
  });

  it('"Este computador" escolhido sobrevive a um alfa antigo que regrava a config sem a marca', () => {
    const remotes = [{ id: 'vps-1', hasAccount: true }];
    const defaults = defaultAppConfig(['C:/seazone']);
    // O dono escolhe "Este computador" no alfa novo: o que vai para o disco.
    const written = { ...defaults, leader: { where: 'local', chosen: true }, leaderChoice: { where: 'local' } };
    // O alfa 26.1108.2000 lê e regrava: `leader` só com `where` (a marca morre), a chave que ele não conhece fica intacta.
    const { unknownFields: _bag, ...rest } = written;
    const byOldAlfa = { ...rest, leader: { where: written.leader.where } };
    const read = sanitizeAppConfig(JSON.parse(JSON.stringify(byOldAlfa)), defaults);
    expect(read.leader).toEqual({ where: 'local', chosen: true });
    expect(leaderRemoteId(read.leader, remotes)).toBeUndefined();
    // O dono troca para a VPS no alfa antigo (só `leader` muda): vale a troca dele, não a escolha velha.
    const changedThere = sanitizeAppConfig({ ...byOldAlfa, leader: { where: 'vps-1' } }, defaults);
    expect(leaderRemoteId(changedThere.leader, remotes)).toBe('vps-1');
    // Sem escolha nenhuma, o 'local' que o #296 gravava continua sendo o padrão antigo: VPS.
    const legacy = sanitizeAppConfig({ ...rest, leader: { where: 'local' }, leaderChoice: undefined }, defaults);
    expect(leaderRemoteId(legacy.leader, remotes)).toBe('vps-1');
  });

  it('troca de lugar só com o Líder parado; trabalhando ou pedindo permissão, ele fica onde está', () => {
    expect(leaderMoves({ remoteId: undefined, state: 'waiting' }, 'vps-1')).toBe(true);
    expect(leaderMoves({ remoteId: 'vps-1', state: 'done' }, undefined)).toBe(true);
    expect(leaderMoves({ remoteId: 'vps-1', state: 'waiting' }, 'vps-1')).toBe(false);
    expect(leaderMoves({ remoteId: undefined, state: 'working' }, 'vps-1')).toBe(false);
    expect(leaderMoves({ remoteId: undefined, state: 'permission' }, 'vps-1')).toBe(false);
    expect(leaderMoves({ remoteId: undefined, state: undefined }, 'vps-1')).toBe(false);
  });

  it('o Líder que volta da VPS depois de reiniciar o app é o Líder único de novo, sem projeto', () => {
    const back = remoteAliveFromMeta('vps-1', { ...meta, roleId: 'lider', leaderOfAll: true });
    expect(back).toMatchObject({ remoteId: 'vps-1', sessionId: sid, roleId: 'lider', leaderOfAll: true });
    expect(back.projectName).toBeUndefined();
    // Uma sessão comum segue como antes.
    const plain = remoteAliveFromMeta('vps-1', { ...meta, projectName: 'Donel Dev', roleId: 'dev' });
    expect(plain).toMatchObject({ projectName: 'Donel Dev', roleId: 'dev' });
    expect(plain.leaderOfAll).toBeUndefined();
  });

  it('na volta ao PC, a conversa maior substitui a antiga, que fica guardada; a menor nunca sobrescreve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lider-carry-'));
    const source = join(dir, 'espelho.jsonl');
    const dest = join(dir, 'projects', 'x', `${sid}.jsonl`);
    writeFileSync(source, 'a\nb\n');
    expect(carryTranscriptLocally(source, dest)).toBe('carried');
    expect(readFileSync(dest, 'utf8')).toBe('a\nb\n');

    writeFileSync(source, 'a\n');
    expect(carryTranscriptLocally(source, dest)).toBe('kept');
    expect(readFileSync(dest, 'utf8')).toBe('a\nb\n');

    writeFileSync(source, 'a\nb\nc\n');
    expect(carryTranscriptLocally(source, dest)).toBe('carried');
    expect(readFileSync(dest, 'utf8')).toBe('a\nb\nc\n');
    expect(readdirSync(join(dir, 'projects', 'x')).some((name) => name.startsWith(`${sid}.jsonl.bak-`))).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('Líder único na VPS — a conversa viaja por stream e é conferida', () => {
  it('ida: uma conversa de 19 MB chega inteira (mesmo sha256) em poucos segundos, sem travar o app', async () => {
    const place = fakePlace();
    const source = join(mkdtempSync(join(tmpdir(), 'lider-src-')), `${sid}.jsonl`);
    const content = bigTranscript(source, 19 * 1024 * 1024);

    // The main keeps running while the copy goes (it is a stream, not a 19 MB string built on the main thread).
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks += 1;
    }, 20);
    const started = Date.now();
    const result = await sendTranscriptToRemote(place.run, 'seazone', sid, source);
    const elapsed = Date.now() - started;
    clearInterval(ticker);
    console.log(`[lider-na-vps] ida de ${(content.length / 1024 / 1024).toFixed(1)} MB: ${elapsed} ms (${ticks} tiques do event loop)`);

    expect(result).toEqual({ ok: true, outcome: 'carried' });
    expect(sha(readFileSync(place.target))).toBe(sha(content));
    expect(elapsed).toBeLessThan(15_000);
    expect(ticks).toBeGreaterThan(0);
  }, 60_000);

  it('ida: uma cópia que chega cortada é recusada e não mexe na conversa de lá', async () => {
    const place = fakePlace();
    mkdirSync(join(place.target, '..'), { recursive: true });
    writeFileSync(place.target, 'antiga\n');
    const source = join(mkdtempSync(join(tmpdir(), 'lider-src-')), `${sid}.jsonl`);
    bigTranscript(source, 200_000);
    // The "network" drops all but the first 1000 bytes.
    const cut: RemoteCommand = (command) => place.run(`head -c 1000 | ${command}`);

    const result = await sendTranscriptToRemote(cut, 'seazone', sid, source);

    expect(result.ok).toBe(false);
    expect(readFileSync(place.target, 'utf8')).toBe('antiga\n');
    expect(existsSync(`${place.target}.chegando`)).toBe(false);
  });

  it('ida: o Líder velho que ficou vivo lá (a volta não conseguiu encerrar) é encerrado antes, para ninguém se ligar a ele', async () => {
    const place = fakePlace();
    const source = join(mkdtempSync(join(tmpdir(), 'lider-src-')), `${sid}.jsonl`);
    writeFileSync(source, '{"a":1}\n');

    expect(await sendTranscriptToRemote(place.run, 'seazone', sid, source)).toEqual({ ok: true, outcome: 'carried' });
    expect(readFileSync(place.tmuxLog, 'utf8')).toContain(`kill-session -t donel-${sid}`);
  });

  it('ida: a cópia maior de lá não é sobrescrita pela menor daqui', async () => {
    const place = fakePlace();
    mkdirSync(join(place.target, '..'), { recursive: true });
    writeFileSync(place.target, '{"a":1}\n{"b":2}\n');
    const source = join(mkdtempSync(join(tmpdir(), 'lider-src-')), `${sid}.jsonl`);
    writeFileSync(source, '{"a":1}\n');

    expect(await sendTranscriptToRemote(place.run, 'seazone', sid, source)).toEqual({ ok: true, outcome: 'kept' });
    expect(readFileSync(place.target, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('volta: o PC recebe o arquivo da VPS (não o espelho que foi chegando), inteiro e conferido, também com 19 MB', async () => {
    const place = fakePlace();
    mkdirSync(join(place.target, '..'), { recursive: true });
    const content = bigTranscript(place.target, 19 * 1024 * 1024);
    const dest = join(mkdtempSync(join(tmpdir(), 'lider-dest-')), 'veio.jsonl');

    const started = Date.now();
    const result = await fetchTranscriptFromRemote(place.run, 'seazone', sid, dest);
    console.log(`[lider-na-vps] volta de ${(content.length / 1024 / 1024).toFixed(1)} MB: ${Date.now() - started} ms`);

    expect(result).toEqual({ ok: true, size: content.length });
    expect(sha(readFileSync(dest))).toBe(sha(content));
  }, 60_000);

  it('volta: VPS que não responde dá erro e não deixa arquivo pela metade', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'lider-dest-')), 'veio.jsonl');
    const down: RemoteCommand = () => spawn('sh', ['-c', 'echo "ssh: connect to host vps port 22: Connection timed out" >&2; exit 255']);

    const result = await fetchTranscriptFromRemote(down, 'seazone', sid, dest);

    expect(result.ok).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });
});

describe('Líder único na VPS — a troca nunca fecha o Líder antigo antes do novo estar vivo', () => {
  type Log = string[];
  function deps(log: Log, opts: { carry?: boolean; newTakes?: boolean }): LeaderMoveDeps {
    return {
      carry: async () => {
        log.push('carry');
        return opts.carry === false ? { ok: false, reason: 'a VPS não respondeu' } : { ok: true };
      },
      openNew: () => {
        log.push('open new');
        return 'new';
      },
      deliverFirst: async (tabId, text) => {
        log.push(`first ${tabId}: ${text}`);
        return opts.newTakes !== false;
      },
      send: (tabId, text) => log.push(`send ${tabId}: ${text}`),
      close: (tabId) => log.push(`close ${tabId}`),
      adopt: (tabId) => log.push(`adopt ${tabId}`),
      notify: (message) => log.push(`notify ${message}`),
    };
  }

  it('sucesso: o novo recebe a mensagem e só então o antigo fecha; o que chegou no meio vai ao novo, na ordem, uma vez', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', deps(log, {}));
    move.enqueue('segunda');
    expect(await move.done).toBe('moved');
    expect(log).toEqual(['carry', 'open new', 'first new: oi', 'adopt new', 'close old', 'send new: segunda']);
  });

  it('a cópia falha: o Líder fica onde estava, com a conversa, e recebe as mensagens', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', deps(log, { carry: false }));
    move.enqueue('segunda');
    expect(await move.done).toBe('stayed');
    expect(log.filter((line) => line.startsWith('close'))).toEqual([]);
    expect(log.filter((line) => line.startsWith('open'))).toEqual([]);
    expect(log.filter((line) => line.startsWith('send'))).toEqual(['send old: oi', 'send old: segunda']);
    expect(log.some((line) => line.startsWith('notify'))).toBe(true);
  });

  it('o novo não sobe: ele fecha, o antigo segue e recebe as mensagens', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', deps(log, { newTakes: false }));
    move.enqueue('segunda');
    expect(await move.done).toBe('stayed');
    expect(log).toContain('close new');
    expect(log).not.toContain('close old');
    expect(log).not.toContain('adopt new');
    expect(log.filter((line) => line.startsWith('send'))).toEqual(['send old: oi', 'send old: segunda']);
  });

  it('o Líder cuja ligação caiu (PC dormiu) é religado com a mesma conversa, nunca trocado por um novo', () => {
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: undefined, exited: true }, 'vps-1')).toEqual({
      kind: 'reconnect',
      tabId: 't1',
      sessionId: sid,
    });
    // Mesmo se o dono escolheu outro lugar: religa onde a conversa está; a troca vem na próxima mensagem.
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: undefined, exited: true }, undefined)).toMatchObject({ kind: 'reconnect' });
    // Sem id de conversa não há o que religar: abre um novo.
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: undefined, state: undefined, exited: true }, 'vps-1')).toEqual({ kind: 'open' });
    expect(planLeaderDelivery(undefined, 'vps-1')).toEqual({ kind: 'open' });
    // Vivo e parado em outro lugar: troca; vivo no lugar certo ou trabalhando: recebe a mensagem onde está.
    expect(planLeaderDelivery({ id: 't1', remoteId: undefined, claudeSessionId: sid, state: 'waiting', exited: false }, 'vps-1')).toEqual({ kind: 'move', tabId: 't1', sessionId: sid });
    expect(planLeaderDelivery({ id: 't1', remoteId: undefined, claudeSessionId: sid, state: 'working', exited: false }, 'vps-1')).toEqual({ kind: 'send', tabId: 't1' });
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: 'waiting', exited: false }, 'vps-1')).toEqual({ kind: 'send', tabId: 't1' });
  });
});
