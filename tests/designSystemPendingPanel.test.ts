import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ChoiceCard,
  ClaudeNote,
  DiffStat,
  OtherChoice,
  PendingFrame,
  PreviewPane,
  QuestionBlock,
} from '../design-system/src/components/PendingPanel';

const noop = () => undefined;

describe('PendingFrame', () => {
  it('renders header, counter, origin strip and footer', () => {
    const html = renderToStaticMarkup(
      createElement(
        PendingFrame,
        {
          ariaLabel: 'Pergunta do Claude',
          icon: null,
          title: 'O Claude pergunta',
          waiting: 'mais 2 esperando',
          origin: { name: 'Mapear usos' },
          footer: 'rodape',
        },
        'miolo',
      ),
    );
    expect(html).toContain('aria-label="Pergunta do Claude"');
    expect(html).toContain('mais 2 esperando');
    expect(html).toContain('pedido do subagente');
    expect(html).toContain('Mapear usos');
    expect(html).toContain('miolo');
    expect(html).toContain('rodape');
  });

  it('omits the counter and the origin when absent', () => {
    const html = renderToStaticMarkup(createElement(PendingFrame, { ariaLabel: 'x', icon: null, title: 't' }, 'm'));
    expect(html).not.toContain('esperando');
    expect(html).not.toContain('pedido do subagente');
  });
});

describe('ChoiceCard', () => {
  it('is a radio with aria-checked and draws the recommended suffix apart from the label', () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceCard, { kind: 'radio', checked: true, label: 'Ajustar', recommended: true, description: 'desc', onSelect: noop }),
    );
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('(Recomendado)');
    expect(html).toContain('desc');
  });
  it('is a checkbox for multiple choice and supports the roving tabindex', () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceCard, { kind: 'checkbox', checked: false, label: 'A', tabIndex: -1, onSelect: noop }),
    );
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('(Recomendado)');
  });
});

describe('QuestionBlock', () => {
  const base = {
    number: 1,
    title: 'Qual?',
    titleId: 't1',
    options: 'opts',
    other: createElement(OtherChoice, { kind: 'radio', active: false, children: 'in' }),
  };
  it('single choice is a radiogroup labelled by the title, with the preview column', () => {
    const html = renderToStaticMarkup(
      createElement(QuestionBlock, { ...base, hint: 'escolha uma', multiple: false, preview: createElement(PreviewPane, null, 'x') }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="t1"');
    expect(html).toContain('Prévia');
    expect(html).toContain('Outra');
  });
  it('multiple choice is a group', () => {
    const html = renderToStaticMarkup(createElement(QuestionBlock, { ...base, hint: 'escolha uma ou mais', multiple: true }));
    expect(html).toContain('role="group"');
    expect(html).toContain('escolha uma ou mais');
  });
  it('PreviewPane says when the option has no preview', () => {
    expect(renderToStaticMarkup(createElement(PreviewPane, { children: null }))).toContain('Esta opção não tem prévia.');
  });
});

describe('permission pieces', () => {
  it('ClaudeNote marks the text as his and DiffStat counts lines', () => {
    expect(renderToStaticMarkup(createElement(ClaudeNote, null, 'Instala a lib'))).toContain('descrição do Claude');
    const stat = renderToStaticMarkup(createElement(DiffStat, { added: 12, removed: 3 }));
    expect(stat).toContain('+12');
    expect(stat).toContain('−3');
  });
});
