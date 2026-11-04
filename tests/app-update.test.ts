// B33 — atualizar de dentro do app: o que quebraria sem o dono perceber é instalar por cima de turno em
// andamento ou perder aba na volta.

import { describe, expect, it } from 'vitest';
import { parseResumeFile, serializeResumeFile, updateReadiness, type ResumeTab } from '../src/shared/appUpdate';

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
