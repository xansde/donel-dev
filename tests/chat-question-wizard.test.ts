import { describe, expect, it } from 'vitest';
import {
  MAX_WIZARD_QUESTIONS,
  buildQuestionAnswers,
  countAnsweredQuestions,
  firstUnansweredQuestionIndex,
  isQuestionAnswered,
  limitQuestions,
  resolveQuestionAnswer,
  setCustomAnswer,
  toggleOption,
  type QuestionDraft
} from '../src/shared/chat/t3/pendingUserInput';
import {
  PLAN_COLLAPSE_VISIBLE_LINES,
  buildCollapsedPlanPreview,
  planStepCount,
  planTitle
} from '../src/shared/chat/t3/proposedPlan';
import type { Question } from '../src/shared/chat/rows';

const single: Question = {
  question: 'Qual banco?',
  options: [{ label: 'Postgres (Recomendado)' }, { label: 'SQLite' }]
};
const multi: Question = {
  question: 'Quais camadas?',
  multiSelect: true,
  options: [{ label: 'main' }, { label: 'preload' }, { label: 'renderer' }]
};

describe('assistente de perguntas', () => {
  it('limita a 4 perguntas', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...single, question: `q${i}` }));
    expect(MAX_WIZARD_QUESTIONS).toBe(4);
    expect(limitQuestions(many)).toHaveLength(4);
  });

  it('escolha única substitui a anterior e devolve o rótulo exato, com (Recomendado)', () => {
    let d = toggleOption(single, undefined, 'SQLite');
    d = toggleOption(single, d, 'Postgres (Recomendado)');
    expect(d.selected).toEqual(['Postgres (Recomendado)']);
    expect(resolveQuestionAnswer(single, d)).toBe('Postgres (Recomendado)');
  });

  it('escolha única: clicar na já escolhida mantém a escolha', () => {
    const d = toggleOption(single, toggleOption(single, undefined, 'SQLite'), 'SQLite');
    expect(d.selected).toEqual(['SQLite']);
  });

  it('múltipla alterna e une por ", " na ordem das opções', () => {
    let d = toggleOption(multi, undefined, 'renderer');
    d = toggleOption(multi, d, 'main');
    expect(resolveQuestionAnswer(multi, d)).toBe('main, renderer');
    d = toggleOption(multi, d, 'main');
    expect(resolveQuestionAnswer(multi, d)).toBe('renderer');
    d = toggleOption(multi, d, 'renderer');
    expect(resolveQuestionAnswer(multi, d)).toBeNull();
  });

  it('ignora rótulo que não existe nas opções', () => {
    expect(resolveQuestionAnswer(single, { selected: ['fantasma'], custom: '' })).toBeNull();
  });

  it('texto livre ("Outra") vence a opção escolhida', () => {
    const d = { selected: ['SQLite'], custom: '  DuckDB  ' };
    expect(resolveQuestionAnswer(single, d)).toBe('DuckDB');
    expect(resolveQuestionAnswer(multi, { selected: ['main'], custom: 'tudo' })).toBe('tudo');
  });

  it('texto livre só com espaços não conta', () => {
    expect(resolveQuestionAnswer(single, setCustomAnswer(undefined, '   '))).toBeNull();
    expect(isQuestionAnswered(single, { selected: ['SQLite'], custom: '  ' })).toBe(true);
  });

  it('escolher uma opção depois do texto livre devolve a opção', () => {
    const d = toggleOption(single, setCustomAnswer(undefined, 'DuckDB'), 'SQLite');
    expect(d.custom).toBe('');
    expect(resolveQuestionAnswer(single, d)).toBe('SQLite');
  });

  it('só habilita Responder quando todas têm resposta', () => {
    const qs = [single, multi];
    const drafts: Record<string, QuestionDraft> = { [single.question]: toggleOption(single, undefined, 'SQLite') };
    expect(buildQuestionAnswers(qs, drafts)).toBeNull();
    expect(countAnsweredQuestions(qs, drafts)).toBe(1);
    expect(firstUnansweredQuestionIndex(qs, drafts)).toBe(1);
    drafts[multi.question] = setCustomAnswer(undefined, 'nenhuma');
    expect(countAnsweredQuestions(qs, drafts)).toBe(2);
    expect(buildQuestionAnswers(qs, drafts)).toEqual({
      'Qual banco?': 'SQLite',
      'Quais camadas?': 'nenhuma'
    });
  });

  it('sem perguntas não há o que responder', () => {
    expect(buildQuestionAnswers([], {})).toBeNull();
  });

  it('só considera as 4 primeiras perguntas', () => {
    const qs = Array.from({ length: 5 }, (_, i) => ({ ...single, question: `q${i}` }));
    const drafts: Record<string, QuestionDraft> = {};
    for (const q of qs.slice(0, 4)) drafts[q.question] = toggleOption(q, undefined, 'SQLite');
    expect(Object.keys(buildQuestionAnswers(qs, drafts) ?? {})).toHaveLength(4);
  });
});

describe('plano', () => {
  it('título: primeiro heading, senão primeira linha, senão null', () => {
    expect(planTitle('texto\n## Migrar banco\n1. a')).toBe('Migrar banco');
    expect(planTitle('\n\nMigrar banco\n1. a')).toBe('Migrar banco');
    expect(planTitle('  \n')).toBeNull();
  });

  it('plano curto não recolhe', () => {
    const p = buildCollapsedPlanPreview('# T\n1. a\n2. b\n3. c\n4. d');
    expect(p.collapsed).toBe(false);
    expect(p.title).toBe('T');
  });

  it('plano longo recolhe: título + 3 primeiros passos + quantos ficaram de fora', () => {
    const steps = Array.from({ length: 10 }, (_, i) => `${i + 1}. passo ${i + 1}`).join('\n');
    const p = buildCollapsedPlanPreview(`# Plano\n\n${steps}`);
    expect(PLAN_COLLAPSE_VISIBLE_LINES).toBe(8);
    expect(p.collapsed).toBe(true);
    expect(p.title).toBe('Plano');
    expect(p.steps).toEqual(['passo 1', 'passo 2', 'passo 3']);
    expect(p.hiddenStepCount).toBe(7);
    expect(p.stepCount).toBe(10);
  });

  it('limite é de linhas visíveis (T3): 8 não recolhe, 9 recolhe', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. s`).join('\n');
    expect(buildCollapsedPlanPreview(mk(8)).collapsed).toBe(false);
    expect(buildCollapsedPlanPreview(mk(9)).collapsed).toBe(true);
  });

  it('plano longo sem lista numerada: sem passos, recolhe pelas primeiras linhas', () => {
    const prose = Array.from({ length: 12 }, (_, i) => `linha ${i}`).join('\n');
    const p = buildCollapsedPlanPreview(`# T\n${prose}`);
    expect(p.collapsed).toBe(true);
    expect(p.stepCount).toBeNull();
    expect(p.steps).toEqual([]);
    expect(p.previewMarkdown.split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('"N passos" só com lista numerada de primeiro nível', () => {
    expect(planStepCount('# T\n1. a\n2. b\n3. c')).toBe(3);
    expect(planStepCount('# T\n- a\n- b')).toBeNull();
    expect(planStepCount('# T\n- x\n   1. aninhado\n   2. aninhado')).toBeNull();
    expect(planStepCount('# T\n1) a\n2) b')).toBe(2);
    expect(planStepCount('texto')).toBeNull();
  });

  it('passos em bloco de código não contam', () => {
    expect(planStepCount('1. a\n```\n1. x\n2. y\n```\n2. b')).toBe(2);
  });
});
