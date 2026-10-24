import { describe, expect, it } from 'vitest';
import { isReturnedPrompt, lastTurnOf, restoreDraft } from '../src/shared/chat/returnedPrompt';
import type { ConversationRow, UserRow } from '../src/shared/chat/rows';

// 014-chat alfa-4 - Esc antes da primeira resposta: o CLI devolve o texto à caixa do terminal.

const user = (id: string, text: string): UserRow => ({
  kind: 'user',
  id,
  turnId: id,
  at: '2026-10-09T12:00:00.000Z',
  scope: 'main',
  text,
  attachments: [],
});
const assistant = (id: string): ConversationRow =>
  ({ kind: 'assistant', id, turnId: 'u1', at: '2026-10-09T12:00:05.000Z', scope: 'main', markdown: 'oi' }) as unknown as ConversationRow;

describe('lastTurnOf', () => {
  it('sem cartão de usuário: null', () => {
    expect(lastTurnOf([])).toBeNull();
  });

  it('último cartão sem nada do Claude depois: sem saída', () => {
    const turn = lastTurnOf([user('u0', 'antes'), assistant('a0'), user('u1', 'teste')]);
    expect(turn?.user.id).toBe('u1');
    expect(turn?.hasAssistantOutput).toBe(false);
  });

  it('resposta depois do cartão: com saída', () => {
    expect(lastTurnOf([user('u1', 'teste'), assistant('a1')])?.hasAssistantOutput).toBe(true);
  });

  it('ignora cartões locais (mensagem na fila ainda não gravada)', () => {
    const turn = lastTurnOf([user('u1', 'teste'), user('local:send-2', 'depois')]);
    expect(turn?.user.id).toBe('u1');
  });
});

describe('isReturnedPrompt', () => {
  const row = user('u1', 'teste grande espere 15 segundos para responder');

  it('sobra igual ao último cartão e sem saída do Claude: texto devolvido', () => {
    expect(isReturnedPrompt('teste grande espere 15 segundos para responder', row, false)).toBe(true);
  });

  it('a caixa une linhas quebradas e espaços: continua casando', () => {
    const multi = user('u2', 'linha um\nlinha   dois');
    expect(isReturnedPrompt('linha umlinha dois', multi, false)).toBe(true);
  });

  it('com resposta do Claude no turno, é sobra de digitação', () => {
    expect(isReturnedPrompt('teste grande espere 15 segundos para responder', row, true)).toBe(false);
  });

  it('texto diferente do último cartão é sobra de digitação', () => {
    expect(isReturnedPrompt('outra coisa', row, false)).toBe(false);
  });

  it('sem cartão de usuário ou com cartão vazio: não é devolvido', () => {
    expect(isReturnedPrompt('algo', null, false)).toBe(false);
    expect(isReturnedPrompt('', user('u3', ''), false)).toBe(false);
  });

  it('comando com argumento casa pelo texto do comando', () => {
    const cmd: UserRow = { ...user('u4', ''), command: { name: 'model', args: 'opus' } } as UserRow;
    expect(isReturnedPrompt('/model opus', cmd, false)).toBe(true);
  });
});

describe('restoreDraft', () => {
  it('rascunho vazio: só o texto devolvido', () => {
    expect(restoreDraft('', 'volta')).toBe('volta');
    expect(restoreDraft('  \n', 'volta')).toBe('volta');
  });

  it('rascunho com conteúdo: não sobrescreve, o devolvido vem antes, separado por quebra de linha', () => {
    expect(restoreDraft('já digitei', 'volta')).toBe('volta\njá digitei');
  });
});
