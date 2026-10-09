import { describe, expect, it } from 'vitest';
import { commandResolvesTo, matchOldestPending, matchesPrompt, normalizePrompt, unwrapPastedContent } from '../src/shared/chat/promptMatch';

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

  it('aceita o comando de barra puro que o CLI completou (`/mod` -> `/model`)', () => {
    expect(matchesPrompt('/mod', '/model')).toBe(true);
    expect(matchesPrompt('/compac', '/compact')).toBe(true);
  });

  it('não estende a tolerância: mensagens normais, argumentos e nomes sem prefixo seguem exatos', () => {
    expect(matchesPrompt('mod', 'model')).toBe(false);
    expect(matchesPrompt('/mod', '/model opus')).toBe(false);
    expect(matchesPrompt('/mod x', '/model x')).toBe(false);
    expect(matchesPrompt('/model', '/mod')).toBe(false);
    expect(matchesPrompt('/mod', '/compact')).toBe(false);
    expect(matchesPrompt('/', '/model')).toBe(false);
  });
});

describe('commandResolvesTo', () => {
  it('só vale para dois comandos de barra sem argumento, o enviado sendo prefixo do gravado', () => {
    expect(commandResolvesTo('/mod', '/model')).toBe(true);
    expect(commandResolvesTo(' /mod ', '/model\n')).toBe(true);
    expect(commandResolvesTo('/model', '/model')).toBe(false);
    expect(commandResolvesTo('/mod', 'model')).toBe(false);
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

describe('unwrapPastedContent', () => {
  it('removes the tags and the line break glued to each one', () => {
    expect(unwrapPastedContent('<pasted_content id="x">\nabc\n</pasted_content id="x">')).toBe('abc');
  });

  it('keeps text typed before the paste', () => {
    expect(unwrapPastedContent('teste\n<pasted_content id="x">\nabc\n</pasted_content id="x">')).toBe('teste\nabc');
  });

  it('handles two pastes', () => {
    const text = '<pasted_content id="a">\none\n</pasted_content id="a">\nmeio\n<pasted_content id="b">\ntwo\n</pasted_content id="b">';
    expect(unwrapPastedContent(text)).toBe('one\nmeio\ntwo');
  });

  it('keeps [Image #1] and inner spaces', () => {
    expect(unwrapPastedContent('[Image #1]  veja\n<pasted_content id="x">\n  a   b\n</pasted_content id="x">')).toBe('[Image #1]  veja\n  a   b');
  });

  it('leaves text without tags untouched', () => {
    expect(unwrapPastedContent('  a\n\n b  \n')).toBe('  a\n\n b  \n');
  });
});
