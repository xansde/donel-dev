// Adapted from pingdotgg/t3code@9f48092 apps/web/src/pendingUserInput.ts — MIT, (c) 2026 T3 Tools Inc.
// Local changes: contract types replaced by `Question`/`QuestionOption` from ../rows (the CLI's AskUserQuestion
// shape); answers are keyed by the question text and options by their exact label (T3 had ids/values);
// an answer is always a string (multiple selection is joined with ", "); at most 4 questions; dropped
// attachments, the displaced-answer-into-prompt carry and the one-question-at-a-time progress (the panel has a
// single "Responder" for all questions). License text in ./LICENSE.

import type { Question } from '../rows';

/**
 * Pure state of the question wizard (AskUserQuestion). The renderer keeps one `QuestionDraft` per
 * question, keyed by the question text — the same key the CLI expects in `answers`.
 */

/** The CLI sends up to 4 questions per call; extras are ignored. */
export const MAX_WIZARD_QUESTIONS = 4;

/** Separator used to join a multiple selection into one answer string. */
export const MULTI_ANSWER_SEPARATOR = ', ';

export interface QuestionDraft {
  /** Exact option labels picked (the "(Recomendado)" suffix is part of the label and is never stripped). */
  readonly selected: readonly string[];
  /** Free text from "Outra". When non-blank it wins over `selected`. */
  readonly custom: string;
}

export type QuestionDrafts = Readonly<Record<string, QuestionDraft | undefined>>;

/** Keeps only the first `MAX_WIZARD_QUESTIONS` questions. */
export function limitQuestions(questions: readonly Question[]): readonly Question[] {
  return questions.slice(0, MAX_WIZARD_QUESTIONS);
}

/** Picked labels that still exist in the question, in option order, without duplicates. */
function validSelection(question: Question, draft: QuestionDraft | undefined): string[] {
  const picked = new Set(draft?.selected ?? []);
  const result: string[] = [];
  for (const option of question.options) {
    if (picked.has(option.label) && !result.includes(option.label)) result.push(option.label);
  }
  return result;
}

/**
 * The answer of one question, or `null` when there is none yet. Free text wins over any picked option;
 * a multiple selection is joined with ", " using the exact labels.
 */
export function resolveQuestionAnswer(question: Question, draft: QuestionDraft | undefined): string | null {
  const custom = draft?.custom.trim() ?? '';
  if (custom) return custom;
  const selected = validSelection(question, draft);
  if (selected.length === 0) return null;
  return question.multiSelect ? selected.join(MULTI_ANSWER_SEPARATOR) : selected[0];
}

export function isQuestionAnswered(question: Question, draft: QuestionDraft | undefined): boolean {
  return resolveQuestionAnswer(question, draft) !== null;
}

/** Typing in "Outra". Non-blank text wins over the selection (which is kept, so clearing the text restores it). */
export function setCustomAnswer(draft: QuestionDraft | undefined, custom: string): QuestionDraft {
  return { selected: draft?.selected ?? [], custom };
}

/**
 * Clicking an option. Single choice replaces the pick (clicking the picked one keeps it); multiple choice
 * toggles it. Either way the "Outra" text is cleared, because the click is a new decision.
 */
export function toggleOption(question: Question, draft: QuestionDraft | undefined, label: string): QuestionDraft {
  if (!question.multiSelect) return { selected: [label], custom: '' };
  const current = draft?.selected ?? [];
  const selected = current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label];
  return { selected, custom: '' };
}

/** How many of the (first 4) questions already have an answer. */
export function countAnsweredQuestions(questions: readonly Question[], drafts: QuestionDrafts): number {
  return limitQuestions(questions).filter((q) => isQuestionAnswered(q, drafts[q.question])).length;
}

/** Index of the first question without answer; the last index when all are answered; 0 when empty. */
export function firstUnansweredQuestionIndex(questions: readonly Question[], drafts: QuestionDrafts): number {
  const limited = limitQuestions(questions);
  const index = limited.findIndex((q) => !isQuestionAnswered(q, drafts[q.question]));
  return index === -1 ? Math.max(limited.length - 1, 0) : index;
}

/** `true` when every question has an answer — enables "Responder". */
export function areAllQuestionsAnswered(questions: readonly Question[], drafts: QuestionDrafts): boolean {
  const limited = limitQuestions(questions);
  return limited.length > 0 && countAnsweredQuestions(limited, drafts) === limited.length;
}

/** The `answers` payload (`question text → answer`), or `null` while any question is unanswered. */
export function buildQuestionAnswers(
  questions: readonly Question[],
  drafts: QuestionDrafts
): Record<string, string> | null {
  const limited = limitQuestions(questions);
  if (limited.length === 0) return null;
  const answers: Record<string, string> = {};
  for (const question of limited) {
    const answer = resolveQuestionAnswer(question, drafts[question.question]);
    if (answer === null) return null;
    answers[question.question] = answer;
  }
  return answers;
}
