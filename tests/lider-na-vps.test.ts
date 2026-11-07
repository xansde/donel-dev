import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carryTranscriptLocally } from '../src/main/lider/carry-transcript';
import { buildCarryTranscriptScript, remoteAliveFromMeta, type RemoteSessionMeta } from '../src/main/remote-session';
import { leaderMoves, leaderRemoteId, sanitizeLeaderPrefs } from '../src/shared/leaderPrefs';

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

describe('Líder único na VPS', () => {
  it('a escolha "onde o Líder roda" sobrevive ao config e cai para este computador quando o lugar some', () => {
    expect(sanitizeLeaderPrefs(undefined)).toEqual({ where: 'local' });
    expect(sanitizeLeaderPrefs({ where: 'vps-1' })).toEqual({ where: 'vps-1' });
    expect(sanitizeLeaderPrefs({ where: 42 })).toEqual({ where: 'local' });
    expect(leaderRemoteId({ where: 'vps-1' }, ['vps-1'])).toBe('vps-1');
    expect(leaderRemoteId({ where: 'vps-removida' }, ['vps-1'])).toBeUndefined();
    expect(leaderRemoteId({ where: 'local' }, ['vps-1'])).toBeUndefined();
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

  it.skipIf(process.platform === 'win32')('na ida à VPS, o preparo grava a conversa na pasta do CLI com a mesma regra', () => {
    const home = mkdtempSync(join(tmpdir(), 'lider-home-'));
    mkdirSync(join(home, 'seazone'));
    const run = (content: string): string =>
      spawnSync('bash', ['-s'], { input: buildCarryTranscriptScript('seazone', sid, content), env: { ...process.env, HOME: home }, encoding: 'utf8' }).stdout.trim();
    const slug = join(home, 'seazone').replace(/[^a-zA-Z0-9]/g, '-');
    const target = join(home, '.claude', 'projects', slug, `${sid}.jsonl`);

    expect(run('{"a":1}\n{"b":"ç"}\n')).toBe('DONEL_CARRIED');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n{"b":"ç"}\n');
    expect(run('{"a":1}\n')).toBe('DONEL_KEPT');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n{"b":"ç"}\n');
    expect(run('{"a":1}\n{"b":"ç"}\n{"c":3}\n')).toBe('DONEL_CARRIED');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n{"b":"ç"}\n{"c":3}\n');
    expect(existsSync(join(home, '.claude', 'projects', slug))).toBe(true);
    expect(readdirSync(join(home, '.claude', 'projects', slug)).some((name) => name.startsWith(`${sid}.jsonl.bak-`))).toBe(true);
  });
});
