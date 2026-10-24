import { describe, expect, it } from 'vitest';
import { escapeAction } from '../src/renderer/src/chat/stopWorking';
import {
  choiceColumns,
  clampPage,
  diffToLines,
  questionPager,
  previewForQuestion,
  splitRecommended,
  stepRadio,
  waitingLabel,
} from '../src/renderer/src/chat/pending/pendingModel';
import type { Question } from '../src/shared/chat/rows';

describe('escapeAction (FR-008 / D-C24, cases 4 and 5)', () => {
  it('yields to an inner handler that already took the Esc', () => {
    expect(escapeAction({ defaultPrevented: true, working: true, openPendings: 1 })).toBe('none');
  });
  it('denies the head pending, without reason, before stopping', () => {
    expect(escapeAction({ defaultPrevented: false, working: true, openPendings: 2 })).toBe('deny-head');
    expect(escapeAction({ defaultPrevented: false, working: false, openPendings: 1 })).toBe('deny-head');
  });
  it('stops only when working and nothing is pending', () => {
    expect(escapeAction({ defaultPrevented: false, working: true, openPendings: 0 })).toBe('stop');
    expect(escapeAction({ defaultPrevented: false, working: false, openPendings: 0 })).toBe('none');
  });
});

describe('splitRecommended (D-C15)', () => {
  it('separates the suffix for styling without touching the label', () => {
    expect(splitRecommended('Ajustar a última parcela (Recomendado)')).toEqual({
      base: 'Ajustar a última parcela',
      recommended: true,
    });
    expect(splitRecommended('Truncar')).toEqual({ base: 'Truncar', recommended: false });
  });
});

describe('waitingLabel', () => {
  it('is null with nobody waiting', () => expect(waitingLabel(0)).toBeNull());
  it('says "mais N esperando"', () => expect(waitingLabel(2)).toBe('mais 2 esperando'));
});

describe('previewForQuestion', () => {
  const q: Question = {
    question: 'Qual?',
    options: [{ label: 'A', preview: 'prévia A' }, { label: 'B' }],
  };
  it('shows the preview of the picked option', () => {
    expect(previewForQuestion(q, { selected: ['A'], custom: '' })).toEqual({ show: true, text: 'prévia A' });
  });
  it('shows "no preview" for a picked option without one', () => {
    expect(previewForQuestion(q, { selected: ['B'], custom: '' })).toEqual({ show: true, text: null });
  });
  it('has no column when no option has a preview', () => {
    expect(previewForQuestion({ question: 'x', options: [{ label: 'A' }] }, undefined)).toEqual({ show: false, text: null });
  });
  it('multiple choice never shows the column', () => {
    expect(previewForQuestion({ ...q, multiSelect: true }, { selected: ['A'], custom: '' }).show).toBe(false);
  });
  it('free text ("Outra") has no preview', () => {
    expect(previewForQuestion(q, { selected: ['A'], custom: 'meu' })).toEqual({ show: true, text: null });
  });
});

describe('diffToLines (D-C14)', () => {
  it('turns the +/- prefixed diff into lines and counts', () => {
    const r = diffToLines('-a\n-b\n+c');
    expect(r.lines).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'c' },
    ]);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(2);
  });
});

describe('stepRadio (roving tabindex)', () => {
  it('moves with wrap-around', () => {
    expect(stepRadio(0, 3, 'ArrowDown')).toBe(1);
    expect(stepRadio(2, 3, 'ArrowRight')).toBe(0);
    expect(stepRadio(0, 3, 'ArrowUp')).toBe(2);
    expect(stepRadio(1, 3, 'Home')).toBe(0);
    expect(stepRadio(1, 3, 'End')).toBe(2);
    expect(stepRadio(1, 3, 'a')).toBeNull();
  });
});

describe('choiceColumns (no orphan option)', () => {
  it.each([[1, 1], [2, 2], [3, 3], [4, 2], [5, 3], [6, 3], [8, 2], [9, 3]])('%i options -> %i columns', (n, cols) => {
    expect(choiceColumns(n)).toBe(cols);
  });
  it('never leaves a single option alone on the last row for 2..9 options except odd counts above 4', () => {
    for (const n of [2, 3, 4, 6, 8, 9]) expect(n % choiceColumns(n)).not.toBe(1);
  });
});

describe('questionPager', () => {
  it('labels and bounds the pages', () => {
    expect(questionPager(0, 2)).toEqual({ page: 0, label: 'Pergunta 1 de 2', hasPrev: false, hasNext: true });
    expect(questionPager(1, 2)).toEqual({ page: 1, label: 'Pergunta 2 de 2', hasPrev: true, hasNext: false });
  });
  it('clamps out-of-range pages', () => {
    expect(clampPage(5, 2)).toBe(1);
    expect(clampPage(-1, 2)).toBe(0);
    expect(clampPage(3, 0)).toBe(0);
    expect(questionPager(9, 3).page).toBe(2);
  });
});
