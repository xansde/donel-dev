import { describe, expect, it } from 'vitest';
import { matchOldestPending, matchesPrompt, normalizePrompt } from '../src/shared/chat/promptMatch';

// 014-chat T062 — comparação do texto enviado com o texto dos sinais de aceite (send-protocol §5).

describe('normalizePrompt', () => {
  it('desembrulha <pasted_content id=…>…</pasted_content id=…>', () => {
    const wrapped = '\n\n<pasted_content id="abc123">linha 1\nlinha 2</pasted_content id="abc123">\n';
    expect(normalizePrompt(wrapped)).toBe('linha 1\nlinha 2');
  });

  it('desembrulha com texto antes do bloco', () => {
    const wrapped = 'veja isto\n\n<pasted_content id="x1">conteudo</pasted_content id="x1">\n';
    expect(normalizePrompt(wrapped)).toBe('veja isto\n\nconteudo');
  });

  it('normaliza CRLF, CR, TAB (colapsado) e bordas', () => {
    expect(normalizePrompt('  a\r\nb\rc\td  \n')).toBe('a\nb\nc d');
  });

  it('ignora o número do [Image #N]', () => {
    expect(normalizePrompt('[Image #3] descreva')).toBe(normalizePrompt('[Image #9] descreva'));
  });
});

describe('matchesPrompt', () => {
  it('casa texto idêntico', () => {
    expect(matchesPrompt('oi', 'oi')).toBe(true);
  });

  it('casa o texto colado que o CLI embrulhou', () => {
    const sent = 'a\nb\nc\nd\ne\nf';
    const signal = `\n\n<pasted_content id="p1">${sent}</pasted_content id="p1">\n`;
    expect(matchesPrompt(sent, signal)).toBe(true);
  });

  it('casa quando o sinal traz [Image #N] e o texto enviado não', () => {
    expect(matchesPrompt('descreva a imagem', '[Image #12] descreva a imagem')).toBe(true);
    expect(matchesPrompt('descreva a imagem', '[Image #1] [Image #2] descreva a imagem')).toBe(true);
  });

  it('não casa textos diferentes', () => {
    expect(matchesPrompt('oi', 'oi tudo bem')).toBe(false);
  });

  it('tolera TAB e CRLF de diferença', () => {
    expect(matchesPrompt('a\tb\nc', 'a    b\r\nc')).toBe(true);
  });
});

describe('matchOldestPending', () => {
  const pending = [
    { id: 'b', text: 'igual', createdAt: 20 },
    { id: 'a', text: 'igual', createdAt: 10 },
    { id: 'c', text: 'outro', createdAt: 5 },
  ];

  it('mensagens idênticas seguidas: cada sinal fecha só o mais antigo', () => {
    const first = matchOldestPending(pending, 'igual');
    expect(first?.id).toBe('a');
    const rest = pending.filter((p) => p.id !== first?.id);
    expect(matchOldestPending(rest, 'igual')?.id).toBe('b');
    const last = rest.filter((p) => p.id !== 'b');
    expect(matchOldestPending(last, 'igual')).toBeNull();
  });

  it('desempata pela ordem da lista quando o horário é igual', () => {
    const same = [
      { id: 'x', text: 't', createdAt: 1 },
      { id: 'y', text: 't', createdAt: 1 },
    ];
    expect(matchOldestPending(same, 't')?.id).toBe('x');
  });

  it('devolve null sem candidatos', () => {
    expect(matchOldestPending([], 'x')).toBeNull();
  });
});
