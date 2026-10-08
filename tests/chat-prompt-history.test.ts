import { describe, expect, it } from 'vitest';
import { buildPromptHistoryEntries, stepPromptHistory, type PromptHistoryPosition } from '../src/shared/chat/t3/promptHistory';

// 014-chat T066 — recall de prompts com ↑/↓ no compositor.

const messages = [
  { id: '1', role: 'user', text: 'primeiro' },
  { id: '2', role: 'assistant', text: 'resposta' },
  { id: '3', role: 'user', text: 'segundo' },
  { id: '4', role: 'user', text: 'segundo' },
  { id: '5', role: 'user', text: '   ' },
  { id: '6', role: 'user', text: 'terceiro' },
];

describe('buildPromptHistoryEntries', () => {
  const entries = buildPromptHistoryEntries(messages);

  it('só mensagens do dono, sem vazias', () => {
    expect(entries.map((e) => e.prompt)).toEqual(['primeiro', 'segundo', 'terceiro']);
  });

  it('sem duplicatas seguidas: fica a mais nova', () => {
    expect(entries.find((e) => e.prompt === 'segundo')?.id).toBe('4');
  });

  it('duplicata não adjacente é mantida', () => {
    const e = buildPromptHistoryEntries([
      { id: 'a', role: 'user', text: 'x' },
      { id: 'b', role: 'user', text: 'y' },
      { id: 'c', role: 'user', text: 'x' },
    ]);
    expect(e.map((i) => i.prompt)).toEqual(['x', 'y', 'x']);
  });
});

describe('stepPromptHistory', () => {
  const entries = buildPromptHistoryEntries(messages);

  it('↑ com a caixa vazia traz o prompt mais recente', () => {
    const step = stepPromptHistory({ direction: 'backward', entries, position: null, currentPrompt: '' });
    expect(step?.prompt).toBe('terceiro');
  });

  it('↑ com texto digitado e fora de navegação cai no movimento normal do cursor', () => {
    expect(stepPromptHistory({ direction: 'backward', entries, position: null, currentPrompt: 'rascunho' })).toBeNull();
  });

  it('↑ navegando só vale com o cursor na primeira linha', () => {
    const position: PromptHistoryPosition = { entryId: '6', recalled: 'terceiro' };
    expect(stepPromptHistory({ direction: 'backward', entries, position, currentPrompt: 'terceiro', cursorAtTopEdge: false })).toBeNull();
    const step = stepPromptHistory({ direction: 'backward', entries, position, currentPrompt: 'terceiro', cursorAtTopEdge: true });
    expect(step?.prompt).toBe('segundo');
  });

  it('↑ para no mais antigo', () => {
    const position: PromptHistoryPosition = { entryId: '1', recalled: 'primeiro' };
    expect(stepPromptHistory({ direction: 'backward', entries, position, currentPrompt: 'primeiro' })).toBeNull();
  });

  it('↓ volta ao mais novo e depois esvazia a caixa', () => {
    const position: PromptHistoryPosition = { entryId: '4', recalled: 'segundo' };
    const fwd = stepPromptHistory({ direction: 'forward', entries, position, currentPrompt: 'segundo' });
    expect(fwd?.prompt).toBe('terceiro');
    const end = stepPromptHistory({ direction: 'forward', entries, position: fwd?.position ?? null, currentPrompt: 'terceiro' });
    expect(end).toEqual({ position: null, prompt: '' });
  });

  it('↓ sem navegação não faz nada', () => {
    expect(stepPromptHistory({ direction: 'forward', entries, position: null, currentPrompt: '' })).toBeNull();
  });

  it('↓ navegando só vale com o cursor na última linha', () => {
    const position: PromptHistoryPosition = { entryId: '4', recalled: 'segundo' };
    expect(stepPromptHistory({ direction: 'forward', entries, position, currentPrompt: 'segundo', cursorAtBottomEdge: false })).toBeNull();
  });

  it('editar o texto recordado encerra a navegação', () => {
    const position: PromptHistoryPosition = { entryId: '6', recalled: 'terceiro' };
    expect(stepPromptHistory({ direction: 'forward', entries, position, currentPrompt: 'terceiro editado' })).toBeNull();
  });
});
