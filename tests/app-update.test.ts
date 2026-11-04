// B33 — atualizar de dentro do app: o que quebraria sem o dono perceber é instalar por cima de turno em
// andamento, oferecer versão que não é nova, ou perder aba na volta.

import { describe, expect, it } from 'vitest';
import { evaluateUpdate, parseResumeFile, serializeResumeFile, updateReadiness, type ResumeTab, type UpdateFolderSnapshot } from '../src/shared/appUpdate';

const OWN = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const BUILT_AT = 1_000_000;

function folder(over: Partial<UpdateFolderSnapshot> = {}): UpdateFolderSnapshot {
  return {
    lastCommitText: `\uFEFF${NEW}\r\n`,
    lastCommitAtMs: BUILT_AT + 500,
    installers: [
      { name: 'Donel Dev Alfa-Setup-2026-11-02.exe', path: 'D:\\x\\2026-11-02.exe', mtimeMs: BUILT_AT - 10 },
      { name: 'Donel Dev Alfa-Setup-2026-11-03.exe', path: 'D:\\x\\2026-11-03.exe', mtimeMs: BUILT_AT + 400 },
    ],
    failedText: null,
    failedAtMs: null,
    ...over,
  };
}

describe('há versão nova?', () => {
  it('oferece o instalador mais novo quando o último build veio de outro commit', () => {
    const status = evaluateUpdate({ commit: OWN, builtAtMs: BUILT_AT }, folder());
    expect(status.available?.installerPath).toBe('D:\\x\\2026-11-03.exe');
    expect(status.failure).toBeNull();
  });

  it('não oferece nada quando é o mesmo commit, quando o instalador é mais velho que o app ou sem saber o próprio commit', () => {
    expect(evaluateUpdate({ commit: NEW, builtAtMs: BUILT_AT }, folder()).available).toBeNull();
    expect(evaluateUpdate({ commit: OWN, builtAtMs: BUILT_AT + 1000 }, folder()).available).toBeNull();
    expect(evaluateUpdate({ commit: null, builtAtMs: BUILT_AT }, folder()).available).toBeNull();
  });

  it('sem pasta o recurso some; FALHOU.txt mais novo que o último sucesso vira aviso', () => {
    expect(evaluateUpdate({ commit: OWN, builtAtMs: BUILT_AT }, null).enabled).toBe(false);
    const failed = evaluateUpdate({ commit: NEW, builtAtMs: BUILT_AT }, folder({ failedText: '\uFEFF2026-11-03 06:31  npm falhou\r\n', failedAtMs: BUILT_AT + 900 }));
    expect(failed.failure?.message).toBe('2026-11-03 06:31  npm falhou');
    expect(evaluateUpdate({ commit: NEW, builtAtMs: BUILT_AT }, folder({ failedText: 'velho', failedAtMs: BUILT_AT })).failure).toBeNull();
  });
});

describe('pode atualizar agora?', () => {
  it('espera turno em andamento, agente em segundo plano e pergunta aberta; ignora sessão parada, recém-aberta ou morta', () => {
    expect(updateReadiness([{ alive: true, state: 'waiting' }, { alive: true, state: 'working', unconfirmed: true }, { alive: false, state: 'working' }]).ready).toBe(true);
    expect(updateReadiness([{ alive: true, state: 'working' }])).toEqual({ ready: false, working: 1, waitingOnYou: 0 });
    expect(updateReadiness([{ alive: true, state: 'waiting', awaitingBackgroundAgents: true }]).ready).toBe(false);
    expect(updateReadiness([{ alive: true, state: 'permission' }, { alive: true, state: 'waiting', pendingKinds: ['question'] }])).toEqual({
      ready: false,
      working: 0,
      waitingOnYou: 2,
    });
  });
});

describe('arquivo de retomada', () => {
  const tabs: ResumeTab[] = [
    {
      sessionType: 'claude',
      name: 'Revisão',
      cwd: 'C:\\repos\\atlas',
      projectName: 'atlas',
      sessionId: 'sess-1',
      launchArgs: ['--model', 'opus', '--permission-mode', 'acceptEdits', '-r', 'sess-1'],
      roleId: 'revisor',
      color: 'accent',
      customTitle: null,
      view: 'chat',
      active: true,
    },
    { sessionType: 'claude', name: 'Lugar novo', cwd: 'C:\\repos\\atlas', placeId: 'place-9', launchArgs: ['--model', 'sonnet'], providerId: 'meu-provider' },
    { sessionType: 'shell', name: 'Terminal', cwd: 'C:\\repos\\beacon', pinned: true },
  ];

  it('grava e lê sem perder aba nem campo', () => {
    const text = serializeResumeFile('alfa', tabs, 5000);
    expect(parseResumeFile(text, { channel: 'alfa', now: 6000 })).toEqual(tabs);
  });

  it('não restaura arquivo de outro canal, velho ou quebrado; aba quebrada cai sozinha', () => {
    const text = serializeResumeFile('alfa', tabs, 5000);
    expect(parseResumeFile(text, { channel: 'beta', now: 6000 })).toEqual([]);
    expect(parseResumeFile(text, { channel: 'alfa', now: 5000 + 7 * 60 * 60 * 1000 })).toEqual([]);
    expect(parseResumeFile('{', { channel: 'alfa', now: 6000 })).toEqual([]);
    const withBroken = JSON.stringify({ version: 1, channel: 'alfa', writtenAt: 5000, tabs: [{ sessionType: 'x' }, tabs[2]] });
    expect(parseResumeFile(withBroken, { channel: 'alfa', now: 6000 })).toEqual([tabs[2]]);
  });
});
