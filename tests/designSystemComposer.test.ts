import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Composer } from '../design-system/src/components/Composer';
import { TextArea, computeTextAreaHeight, textAreaHeightForRows } from '../design-system/src/components/TextArea';

const noop = () => undefined;

describe('TextArea — altura', () => {
  it('cresce com o conteúdo entre o piso e o teto', () => {
    expect(computeTextAreaHeight(60, 1, 10)).toBe(60);
  });
  it('não passa do teto de maxRows (depois rola)', () => {
    expect(computeTextAreaHeight(5000, 1, 10)).toBe(textAreaHeightForRows(10));
    expect(textAreaHeightForRows(10)).toBe(212);
  });
  it('não fica abaixo de minRows', () => {
    expect(computeTextAreaHeight(0, 3, 10)).toBe(textAreaHeightForRows(3));
  });
});

describe('TextArea — marcação', () => {
  it('é controlada e expõe o rótulo acessível', () => {
    const html = renderToStaticMarkup(createElement(TextArea, { value: 'oi', onChange: noop, label: 'Mensagem' }));
    expect(html).toContain('<label');
    expect(html).toContain('Mensagem');
    expect(html).toContain('>oi</textarea>');
  });
});

describe('Composer — Enviar ⇄ SplitButton', () => {
  const field = createElement(TextArea, { value: '', onChange: noop, 'aria-label': 'Mensagem', appearance: 'bare' });

  it('ocioso: só o botão Enviar, sem seta de menu', () => {
    const html = renderToStaticMarkup(createElement(Composer, { onSend: noop, onInterruptAndSend: noop, children: field }));
    expect(html).toContain('Enviar');
    expect(html).not.toContain('aria-haspopup');
  });

  it('trabalhando: Enviar vira SplitButton com menu', () => {
    const html = renderToStaticMarkup(
      createElement(Composer, { onSend: noop, onInterruptAndSend: noop, working: true, children: field }),
    );
    expect(html).toContain('Enviar');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('dica padrão com Kbd e modo ajuste com etiqueta', () => {
    const html = renderToStaticMarkup(
      createElement(Composer, { onSend: noop, footerHint: true, adjust: true, children: field }),
    );
    expect(html).toContain('<kbd');
    expect(html).toContain('quebra linha');
    expect(html).toContain('Ajuste no plano');
  });
});
