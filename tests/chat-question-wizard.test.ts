import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_NOTES_CHARS,
  MAX_WIZARD_QUESTIONS,
  buildQuestionAnnotations,
  buildQuestionAnswers,
  countAnsweredQuestions,
  firstUnansweredQuestionIndex,
  isQuestionAnswered,
  limitQuestions,
  resolveQuestionAnswer,
  setCustomAnswer,
  setQuestionNotes,
  toggleOption,
  type QuestionDraft
} from '../src/shared/chat/t3/pendingUserInput';
import {
  PLAN_COLLAPSE_VISIBLE_LINES,
  buildCollapsedPlanPreview,
  planStepCount,
  extractPlanSteps,
  shortenPlanStep,
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

describe('observação por pergunta', () => {
  it('sem observação não há anotação nenhuma (o payload segue igual ao de antes)', () => {
    const drafts: Record<string, QuestionDraft> = { [single.question]: toggleOption(single, undefined, 'SQLite') };
    expect(buildQuestionAnnotations([single], drafts)).toBeUndefined();
  });

  it('observação só com espaços não conta', () => {
    const drafts = { [single.question]: setQuestionNotes(toggleOption(single, undefined, 'SQLite'), '  \n  ') };
    expect(buildQuestionAnnotations([single], drafts)).toBeUndefined();
  });

  it('a observação vai em annotations[pergunta].notes, aparada e com as quebras de linha', () => {
    const drafts = { [single.question]: setQuestionNotes(toggleOption(single, undefined, 'SQLite'), '  só em dev\nem prod é Postgres  ') };
    expect(buildQuestionAnnotations([single], drafts)).toEqual({ 'Qual banco?': { notes: 'só em dev\nem prod é Postgres' } });
    expect(buildQuestionAnswers([single], drafts)).toEqual({ 'Qual banco?': 'SQLite' });
  });

  it('vale para múltipla escolha e para "Outra"; só as perguntas com observação entram', () => {
    const drafts: Record<string, QuestionDraft> = {
      [single.question]: setQuestionNotes(setCustomAnswer(undefined, 'DuckDB'), 'é o que já usamos'),
      [multi.question]: setQuestionNotes(toggleOption(multi, undefined, 'main'), 'preload fica para depois'),
    };
    expect(buildQuestionAnswers([single, multi], drafts)).toEqual({ 'Qual banco?': 'DuckDB', 'Quais camadas?': 'main' });
    expect(buildQuestionAnnotations([single, multi], drafts)).toEqual({
      'Qual banco?': { notes: 'é o que já usamos' },
      'Quais camadas?': { notes: 'preload fica para depois' },
    });
    delete drafts[multi.question];
    drafts[multi.question] = toggleOption(multi, undefined, 'main');
    expect(Object.keys(buildQuestionAnnotations([single, multi], drafts) ?? {})).toEqual(['Qual banco?']);
  });

  it('escolher opção, alternar ou escrever em "Outra" não apaga a observação', () => {
    let d = setQuestionNotes(undefined, 'nota');
    d = toggleOption(single, d, 'SQLite');
    d = setCustomAnswer(d, 'DuckDB');
    d = toggleOption(single, d, 'Postgres (Recomendado)');
    expect(d.notes).toBe('nota');
    let m = setQuestionNotes(toggleOption(multi, undefined, 'main'), 'nota m');
    m = toggleOption(multi, m, 'main');
    expect(m.notes).toBe('nota m');
  });

  it('observação sozinha não responde a pergunta', () => {
    const d = setQuestionNotes(undefined, 'ainda não sei');
    expect(isQuestionAnswered(single, d)).toBe(false);
  });

  it('corta no limite que o CLI aceita (8192 caracteres)', () => {
    expect(MAX_QUESTION_NOTES_CHARS).toBe(8192);
    const drafts = { [single.question]: setQuestionNotes(toggleOption(single, undefined, 'SQLite'), 'x'.repeat(9000)) };
    expect(buildQuestionAnnotations([single], drafts)?.['Qual banco?']?.notes).toHaveLength(8192);
  });

  it('só considera as 4 primeiras perguntas', () => {
    const qs = Array.from({ length: 5 }, (_, i) => ({ ...single, question: `q${i}` }));
    const drafts: Record<string, QuestionDraft> = {};
    for (const q of qs) drafts[q.question] = setQuestionNotes(toggleOption(q, undefined, 'SQLite'), 'n');
    expect(Object.keys(buildQuestionAnnotations(qs, drafts) ?? {})).toEqual(['q0', 'q1', 'q2', 'q3']);
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

  const REAL_PLAN = [
    '# Plano — envio multilinha do chat + cartão "não foi"',
    '',
    '## Contexto',
    '',
    'Achados do e2e no alfa:',
    '',
    '1. **Todo texto que ocupa mais de uma linha na caixa do CLI falha.** Isso vale',
    '   para `Shift+Enter` e também para uma linha longa que quebra pela largura.',
    '2. **O cartão "não foi" não tem descartar** e fica preso no fim da conversa.',
    '',
    '### Causa provável do item 1',
    '- ...',
    '',
    '## Mudanças',
    '',
    '### 1. Reconhecimento do texto (TDD, vitest)',
    '- ...',
    '### 2. Cartão "não foi": descartar e posição',
    '- ...',
    '### 3. Registro',
    '- ...',
    '',
    '## Verificação',
    '- ...'
  ].join('\n');

  it('plano real: passos são os cabeçalhos numerados de "Mudanças", não a lista do Contexto', () => {
    expect(extractPlanSteps(REAL_PLAN)).toEqual([
      'Reconhecimento do texto (TDD, vitest)',
      'Cartão "não foi": descartar e posição',
      'Registro'
    ]);
    expect(planStepCount(REAL_PLAN)).toBe(3);
    expect(buildCollapsedPlanPreview(REAL_PLAN).stepCount).toBe(3);
  });

  it('lista numerada sob "## Passos" vence a lista do Contexto; continuação vira um item só', () => {
    const md = [
      '# P', '## Contexto', '1. contexto a', '2. contexto b', '',
      '## Passos', '1. Primeiro passo que continua', '   na linha seguinte.', '   - sub item ignorado',
      '2. Segundo', '', '3. Terceiro'
    ].join('\n');
    expect(extractPlanSteps(md)).toEqual(['Primeiro passo que continua na linha seguinte.', 'Segundo', 'Terceiro']);
    expect(planStepCount(md)).toBe(3);
  });

  it('sem cabeçalho de passos: vale a ÚLTIMA lista numerada de topo', () => {
    const md = '# P\n\n1. a\n2. b\n\ntexto solto\n\n1. x\n2. y\n3. z';
    expect(extractPlanSteps(md)).toEqual(['x', 'y', 'z']);
  });

  it('sem lista numerada nem cabeçalhos numerados: sem contagem', () => {
    expect(planStepCount('# P\n## Mudanças\n- a\n- b')).toBeNull();
  });

  it('recolhido: item encurtado em fim de frase, ou em limite de palavra com reticências', () => {
    const cut = shortenPlanStep('palavra '.repeat(30).trim());
    expect(cut.endsWith('palavra…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(141);
    const sentence = 'Esta é a primeira frase do passo, longa o bastante para passar do mínimo. ' + 'depois vem mais texto sem fim '.repeat(8);
    expect(shortenPlanStep(sentence)).toBe('Esta é a primeira frase do passo, longa o bastante para passar do mínimo.');
    expect(shortenPlanStep('curto')).toBe('curto');
  });

  it('recolhido mostra o passo inteiro, não a primeira linha física', () => {
    const md = ['# P', '## Passos', '1. Faz a primeira coisa', '   e termina aqui.', ...Array.from({ length: 9 }, (_, i) => `${i + 2}. s${i}`)].join('\n');
    const p = buildCollapsedPlanPreview(md);
    expect(p.collapsed).toBe(true);
    expect(p.steps[0]).toBe('Faz a primeira coisa e termina aqui.');
  });
});
