import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carryLargestTranscript, carryTranscriptLocally } from '../src/main/lider/carry-transcript';
import { fetchTranscriptFromRemote, sendTranscriptToRemote, type RemoteCommand } from '../src/main/lider/transfer';
import { remoteAliveFromMeta, type RemoteSessionMeta } from '../src/main/remote-session';
import { isValidLiderCarryPayload } from '../src/shared/lider/ipc';
import { liveLeaderOfAllTab } from '../src/shared/mindscape/leader';
import { leaderCwd, leaderMoveCwd, leaderMoves, leaderRemoteId, sameFolder, sanitizeLeaderPrefs } from '../src/shared/leaderPrefs';
import { leaderFolderMoveKey, leaderLineRoute, planLeaderDelivery, startLeaderMove, type LeaderMoveDeps } from '../src/shared/lider/move';

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
  it('leader.home no config.json decide a pasta do Líder; sem ela, a pasta-mãe dos quadros (11/11)', () => {
    const boards = ['C:\\Users\\a\\seazone\\Donel Dev', 'C:\\Users\\a\\seazone\\BizOps'];
    const home = 'C:\\Users\\a\\seazone\\_orquestradora';
    // Sobrevive à leitura do config.json e a uma troca de "onde roda" (que regrava o bloco `leader`).
    const stored = sanitizeLeaderPrefs({ where: 'vps-1', chosen: true, home });
    expect(stored).toEqual({ where: 'vps-1', chosen: true, home });
    expect(sanitizeLeaderPrefs({ where: 'local', home })).toEqual({ where: 'auto', home });
    expect(leaderCwd(stored, boards)).toBe(home);
    expect(leaderCwd(sanitizeLeaderPrefs({ where: 'auto' }), boards)).toBe('C:\\Users\\a\\seazone');
    expect(leaderCwd(sanitizeLeaderPrefs({ where: 'auto', home: '   ' }), boards)).toBe('C:\\Users\\a\\seazone');
  });

  it('sem leader.home, o Líder roda na _orquestradora da pasta-mãe quando ela existe; senão, na pasta-mãe (12/11)', () => {
    const win = ['C:\\Users\\a\\seazone\\Donel Dev', 'C:\\Users\\a\\seazone\\BizOps'];
    const auto = sanitizeLeaderPrefs({ where: 'auto' });
    // Existe no disco (a lista vem do main com a caixa e a barra que ele achou): o caminho com o separador da base.
    expect(leaderCwd(auto, win, ['c:/users/a/SEAZONE/_orquestradora/'])).toBe('C:\\Users\\a\\seazone\\_orquestradora');
    expect(leaderCwd(auto, ['/home/a/seazone/Donel Dev', '/home/a/seazone/BizOps'], ['/home/a/seazone/_orquestradora'])).toBe('/home/a/seazone/_orquestradora');
    // Não existe (ou é a de outra raiz): a pasta-mãe, como antes.
    expect(leaderCwd(auto, win, [])).toBe('C:\\Users\\a\\seazone');
    expect(leaderCwd(auto, win, ['C:\\Users\\b\\seazone\\_orquestradora'])).toBe('C:\\Users\\a\\seazone');
    expect(leaderCwd(auto, win)).toBe('C:\\Users\\a\\seazone');
    // leader.home escrito à mão vence.
    expect(leaderCwd({ where: 'auto', home: 'D:\\outro' }, win, ['C:\\Users\\a\\seazone\\_orquestradora'])).toBe('D:\\outro');
    expect(sameFolder('C:\\Users\\a\\seazone\\', 'c:/users/a/seazone')).toBe(true);
    expect(sameFolder(undefined, undefined)).toBe(true);
    expect(sameFolder('/home/a', undefined)).toBe(false);
  });

  it('a pasta só leva o Líder vivo para a orquestradora ou para o leader.home; nunca de volta à pasta-mãe', () => {
    const auto = sanitizeLeaderPrefs({ where: 'auto' });
    const boards = ['/home/a/seazone/Donel Dev', '/home/a/seazone/BizOps'];
    const orq = '/home/a/seazone/_orquestradora';
    expect(leaderMoveCwd(auto, boards, [orq])).toBe(orq);
    // Um quadro fora de ~/seazone muda a pasta-mãe: a orquestradora dela não existe, o Líder que está na _orquestradora fica.
    expect(leaderMoveCwd(auto, [...boards, '/srv/outro'], [orq])).toBeUndefined();
    // O statSync falhou uma vez (lista vazia): ninguém sai da _orquestradora para a pasta-mãe.
    expect(leaderMoveCwd(auto, boards, [])).toBeUndefined();
    expect(leaderMoveCwd(auto, [], [orq])).toBeUndefined();
    // leader.home escrito à mão move, exista ou não na lista.
    expect(leaderMoveCwd({ where: 'auto', home: '/opt/lider' }, boards, [])).toBe('/opt/lider');
    // No plano: sem pasta-alvo, o Líder parado em outra pasta só recebe a mensagem.
    const tab = { id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: 'waiting', exited: false, cwd: orq } as const;
    expect(planLeaderDelivery(tab, 'vps-1', leaderMoveCwd(auto, [...boards, '/srv/outro'], [orq]))).toEqual({ kind: 'send', tabId: 't1' });
  });

  it('o pedido de cópia da conversa aceita a pasta nova (toCwd) e recusa uma inválida', () => {
    expect(isValidLiderCarryPayload({ sessionId: sid, cwd: '/home/a/seazone', toCwd: '/home/a/seazone/_orquestradora' })).toBe(true);
    expect(isValidLiderCarryPayload({ sessionId: sid, cwd: '/home/a/seazone' })).toBe(true);
    expect(isValidLiderCarryPayload({ sessionId: sid, toCwd: '' })).toBe(false);
    expect(isValidLiderCarryPayload({ sessionId: sid, toCwd: 42 })).toBe(false);
    expect(isValidLiderCarryPayload({ sessionId: sid, toCwd: 'x'.repeat(1001) })).toBe(false);
  });

  it('a conversa vai da pasta antiga para a da orquestradora neste computador: a maior cópia, sem perder a de lá', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lider-pasta-'));
    const old = join(dir, 'projects', '-home-a-seazone', `${sid}.jsonl`);
    const mirror = join(dir, 'espelho.jsonl');
    const dest = join(dir, 'projects', '-home-a-seazone--orquestradora', `${sid}.jsonl`);
    mkdirSync(join(dir, 'projects', '-home-a-seazone'), { recursive: true });
    writeFileSync(old, 'a\nb\nc\n');
    writeFileSync(mirror, 'a\n');
    expect(carryLargestTranscript([old, undefined, mirror], dest)).toBe('carried');
    expect(readFileSync(dest, 'utf8')).toBe('a\nb\nc\n');
    expect(readFileSync(old, 'utf8')).toBe('a\nb\nc\n');
    expect(carryLargestTranscript([join(dir, 'nada.jsonl')], join(dir, 'outro.jsonl'))).toBe('missing');
  });

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

  it('ida no mesmo lugar (só a pasta muda): o Líder vivo lá não é encerrado durante a cópia', async () => {
    const place = fakePlace();
    mkdirSync(join(place.home, 'seazone', '_orquestradora'));
    const source = join(mkdtempSync(join(tmpdir(), 'lider-src-')), `${sid}.jsonl`);
    writeFileSync(source, '{"a":1}\n');

    expect(await sendTranscriptToRemote(place.run, 'seazone/_orquestradora', sid, source, { keepSession: true })).toEqual({ ok: true, outcome: 'carried' });
    expect(existsSync(place.tmuxLog) ? readFileSync(place.tmuxLog, 'utf8') : '').not.toContain('kill-session');
    const slug = join(place.home, 'seazone', '_orquestradora').replace(/[^a-zA-Z0-9]/g, '-');
    expect(readFileSync(join(place.home, '.claude', 'projects', slug, `${sid}.jsonl`), 'utf8')).toBe('{"a":1}\n');
  });

  it('ida: a pasta nova que não existe no lugar é dita pelo nome, sem criar pasta vazia nem encerrar o Líder', async () => {
    const place = fakePlace();
    const source = join(mkdtempSync(join(tmpdir(), 'lider-src-')), `${sid}.jsonl`);
    writeFileSync(source, '{"a":1}\n');

    const result = await sendTranscriptToRemote(place.run, 'seazone/_orquestradora', sid, source, { keepSession: true });
    expect(result).toEqual({ ok: false, reason: 'A pasta ~/seazone/_orquestradora não existe no lugar remoto.' });
    expect(existsSync(join(place.home, 'seazone', '_orquestradora'))).toBe(false);
    expect(existsSync(place.tmuxLog)).toBe(false);
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

  it('aviso das sessões que chega durante a troca vai depois da primeira mensagem, na ordem, uma vez, a quem ficou', async () => {
    const log: Log = [];
    const notice = (text: string) => (tabId: string) => log.push(`aviso ${tabId}: ${text}`);
    const move = startLeaderMove('old', 'oi', deps(log, {}));
    move.enqueue('◆ De Dev: travada', notice('◆ De Dev: travada'));
    move.enqueue('segunda');
    move.enqueue('◆ não começou', notice('◆ não começou'));
    expect(log.filter((line) => line.startsWith('aviso'))).toEqual([]);
    expect(await move.done).toBe('moved');
    expect(log).toEqual(['carry', 'open new', 'first new: oi', 'adopt new', 'close old', 'aviso new: ◆ De Dev: travada', 'send new: segunda', 'aviso new: ◆ não começou']);

    const stayedLog: Log = [];
    const stayed = startLeaderMove('old', 'oi', deps(stayedLog, { newTakes: false }));
    stayed.enqueue('◆ aviso', (tabId) => stayedLog.push(`aviso ${tabId}`));
    expect(await stayed.done).toBe('stayed');
    expect(stayedLog.filter((line) => line.startsWith('send') || line.startsWith('aviso'))).toEqual(['send old: oi', 'aviso old']);
  });

  it('durante a troca, só a entrega à aba do Líder único vai para a fila; Líder de quadro e outras sessões recebem direto', () => {
    expect(leaderLineRoute(true, { leaderOfAll: true })).toBe('fila');
    expect(leaderLineRoute(true, { leaderOfAll: false })).toBe('direto');
    expect(leaderLineRoute(true, {})).toBe('direto');
    expect(leaderLineRoute(true, undefined)).toBe('direto');
    expect(leaderLineRoute(false, { leaderOfAll: true })).toBe('direto');
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

  function inPlaceDeps(log: Log, opts: { carry?: boolean; newTakes?: boolean; switchThrows?: boolean }): LeaderMoveDeps {
    return {
      ...deps(log, opts),
      openNew: () => {
        throw new Error('no mesmo lugar não abre aba nova');
      },
      inPlace: {
        switchTo: () => {
          log.push('switch to new folder');
          if (opts.switchThrows) throw new Error('a aba sumiu');
        },
        switchBack: () => log.push('switch back'),
        redeliver: (tabId, text) => log.push(`redeliver ${tabId}: ${text}`),
      },
    };
  }

  it('mesmo lugar, outra pasta: cópia, troca na mesma aba, primeira mensagem; o que chegou no meio vai depois, na ordem', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', inPlaceDeps(log, {}));
    move.enqueue('segunda');
    move.enqueue('terceira');
    expect(await move.done).toBe('moved');
    expect(log).toEqual(['carry', 'switch to new folder', 'first old: oi', 'adopt old', 'send old: segunda', 'send old: terceira']);
    move.enqueue('quarta');
    expect(log[log.length - 1]).toBe('send old: quarta');
  });

  it('mesmo lugar, a pasta nova não sobe: volta para a pasta antiga com a conversa e a mensagem vai lá, uma vez', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', inPlaceDeps(log, { newTakes: false }));
    move.enqueue('segunda');
    expect(await move.done).toBe('stayed');
    expect(log.slice(0, 6)).toEqual(['carry', 'switch to new folder', 'first old: oi', 'switch back', 'redeliver old: oi', 'send old: segunda']);
    expect(log.some((line) => line.startsWith('close'))).toBe(false);
    expect(log.filter((line) => line.includes(': oi'))).toEqual(['first old: oi', 'redeliver old: oi']);
    expect(log.find((line) => line.startsWith('notify'))).toContain('O Líder continua onde estava');
  });

  it('mesmo lugar, a troca falha antes de subir: volta, e a mensagem vai ao Líder na pasta antiga', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', inPlaceDeps(log, { switchThrows: true }));
    expect(await move.done).toBe('stayed');
    expect(log).toContain('switch back');
    expect(log).toContain('redeliver old: oi');
    expect(log.some((line) => line.startsWith('first'))).toBe(false);
  });

  it('mesmo lugar, a cópia falha: nada troca, a mensagem vai ao Líder onde está', async () => {
    const log: Log = [];
    const move = startLeaderMove('old', 'oi', inPlaceDeps(log, { carry: false }));
    expect(await move.done).toBe('stayed');
    expect(log.some((line) => line.startsWith('switch'))).toBe(false);
    expect(log.filter((line) => line.startsWith('send') || line.startsWith('redeliver'))).toEqual(['send old: oi']);
  });

  it('o Líder cuja ligação caiu (PC dormiu) é religado com a mesma conversa, nunca trocado por um novo', () => {
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: undefined, exited: true, cwd: undefined }, 'vps-1')).toEqual({
      kind: 'reconnect',
      tabId: 't1',
      sessionId: sid,
    });
    // Mesmo se o dono escolheu outro lugar: religa onde a conversa está; a troca vem na próxima mensagem.
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: undefined, exited: true, cwd: undefined }, undefined)).toMatchObject({ kind: 'reconnect' });
    // Sem id de conversa não há o que religar: abre um novo.
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: undefined, state: undefined, exited: true, cwd: undefined }, 'vps-1')).toEqual({ kind: 'open' });
    expect(planLeaderDelivery(undefined, 'vps-1')).toEqual({ kind: 'open' });
    // Vivo e parado em outro lugar: troca; vivo no lugar certo ou trabalhando: recebe a mensagem onde está.
    expect(planLeaderDelivery({ id: 't1', remoteId: undefined, claudeSessionId: sid, state: 'waiting', exited: false, cwd: undefined }, 'vps-1')).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: undefined, inPlace: false });
    expect(planLeaderDelivery({ id: 't1', remoteId: undefined, claudeSessionId: sid, state: 'working', exited: false, cwd: undefined }, 'vps-1')).toEqual({ kind: 'send', tabId: 't1' });
    expect(planLeaderDelivery({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: 'waiting', exited: false, cwd: undefined }, 'vps-1')).toEqual({ kind: 'send', tabId: 't1' });
  });

  it('o Líder vai para a pasta nova só parado, na próxima mensagem; no meio do turno ou na mesma pasta, fica', () => {
    const at = (cwd: string | undefined, state: 'waiting' | 'working' | 'done' | 'error' | 'permission') =>
      ({ id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state, exited: false, cwd }) as const;
    const orq = '/home/a/seazone/_orquestradora';
    expect(planLeaderDelivery(at('/home/a/seazone', 'waiting'), 'vps-1', orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: orq, inPlace: true });
    expect(planLeaderDelivery(at('/home/a/seazone', 'done'), 'vps-1', orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: orq, inPlace: true });
    expect(planLeaderDelivery(at('/home/a/seazone', 'working'), 'vps-1', orq)).toEqual({ kind: 'send', tabId: 't1' });
    expect(planLeaderDelivery(at('/home/a/seazone', 'permission'), 'vps-1', orq)).toEqual({ kind: 'send', tabId: 't1' });
    expect(planLeaderDelivery(at('/HOME/a/seazone/_orquestradora/', 'waiting'), 'vps-1', orq)).toEqual({ kind: 'send', tabId: 't1' });
    // Chamador sem a pasta: igual a antes.
    expect(planLeaderDelivery(at('/home/a/seazone', 'waiting'), 'vps-1')).toEqual({ kind: 'send', tabId: 't1' });
  });

  it('no mesmo lugar remoto, só a pasta muda: a troca é na mesma aba; entre lugares, aba nova', () => {
    const orq = '/home/a/seazone/_orquestradora';
    const at = (remoteId: string | undefined) => ({ id: 't1', remoteId, claudeSessionId: sid, state: 'waiting', exited: false, cwd: '/home/a/seazone' }) as const;
    expect(planLeaderDelivery(at('vps-1'), 'vps-1', orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: orq, inPlace: true });
    expect(planLeaderDelivery(at(undefined), undefined, orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: orq, inPlace: false });
    expect(planLeaderDelivery(at(undefined), 'vps-1', orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: orq, inPlace: false });
    // Só o lugar muda: a pasta é a mesma.
    expect(planLeaderDelivery(at(undefined), 'vps-1')).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: '/home/a/seazone', inPlace: false });
  });

  it('aba do Líder sem pasta conhecida: não troca de pasta (a volta subiria na pasta nova); só o lugar, se mudar', () => {
    const orq = '/home/a/seazone/_orquestradora';
    const at = (remoteId: string | undefined) => ({ id: 't1', remoteId, claudeSessionId: sid, state: 'waiting', exited: false, cwd: undefined }) as const;
    // Mesmo lugar remoto, sem cwd: a mensagem vai a ele onde está.
    expect(planLeaderDelivery(at('vps-1'), 'vps-1', orq)).toEqual({ kind: 'send', tabId: 't1' });
    // Este computador, sem cwd: idem.
    expect(planLeaderDelivery(at(undefined), undefined, orq)).toEqual({ kind: 'send', tabId: 't1' });
    // O lugar muda: só o move de lugar, na pasta da aba (nenhuma).
    expect(planLeaderDelivery(at(undefined), 'vps-1', orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: undefined, inPlace: false });
    expect(planLeaderDelivery(at('vps-1'), undefined, orq)).toEqual({ kind: 'move', tabId: 't1', sessionId: sid, cwd: undefined, inPlace: false });
  });

  it('a mudança de pasta que falhou não se tenta de novo (mesma conversa, lugar e pasta); outra pasta ou lugar tenta', () => {
    const orq = '/home/a/seazone/_orquestradora';
    const tab = { id: 't1', remoteId: 'vps-1', claudeSessionId: sid, state: 'waiting', exited: false, cwd: '/home/a/seazone' } as const;
    const failed = new Set([leaderFolderMoveKey(sid, 'vps-1', orq)]);
    expect(planLeaderDelivery(tab, 'vps-1', orq, failed)).toEqual({ kind: 'send', tabId: 't1' });
    // A chave ignora caixa e barra final.
    expect(planLeaderDelivery(tab, 'vps-1', '/home/a/seazone/_orquestradora/', failed)).toEqual({ kind: 'send', tabId: 't1' });
    // Pasta destino diferente: tenta.
    expect(planLeaderDelivery(tab, 'vps-1', '/opt/lider', failed)).toMatchObject({ kind: 'move', cwd: '/opt/lider' });
    // O dono escolheu outro lugar: o lugar muda, a pasta que falhou lá não é a mesma chave.
    expect(planLeaderDelivery({ ...tab, remoteId: undefined }, 'vps-1', orq, new Set([leaderFolderMoveKey(sid, 'vps-1', orq)]))).toEqual({
      kind: 'move',
      tabId: 't1',
      sessionId: sid,
      cwd: '/home/a/seazone',
      inPlace: false,
    });
  });
});

describe('a aba do Líder único logo depois da troca', () => {
  const leader = (id: string) => ({ id, sessionType: 'claude' as const, roleId: 'lider', leaderOfAll: true });
  it('a aba antiga que o app já está fechando não conta: o aviso vai à nova, mesmo com a lista de abas ainda velha', () => {
    const tabs = [leader('antiga'), leader('nova')];
    const closing = new Set(['antiga']);
    expect(liveLeaderOfAllTab(tabs, (id) => !closing.has(id))?.id).toBe('nova');
    expect(liveLeaderOfAllTab(tabs, (id) => !closing.has(id), 'antiga')?.id).toBe('nova');
    expect(liveLeaderOfAllTab([leader('antiga')], (id) => !closing.has(id))).toBeUndefined();
  });
  it('a lembrada vence a primeira da lista; uma aba sem a marca nunca é o Líder', () => {
    const tabs = [leader('a'), leader('b'), { id: 'c', sessionType: 'claude' as const, roleId: 'lider' }];
    expect(liveLeaderOfAllTab(tabs, () => true, 'b')?.id).toBe('b');
    expect(liveLeaderOfAllTab(tabs, () => true)?.id).toBe('a');
    expect(liveLeaderOfAllTab(tabs, (id) => id === 'c')).toBeUndefined();
  });
});
