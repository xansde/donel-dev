// 014-chat (T078) - pure helpers of the pending panel. No React, no IPC.

import type { DiffLine } from '@donel-dev/design-system';
import type { Question } from '../../../../shared/chat/rows';
import type { QuestionDraft } from '../../../../shared/chat/t3/pendingUserInput';

const RECOMMENDED_SUFFIX = /\s*\(Recomendado\)\s*$/;

/** D-C15: styles the "(Recomendado)" suffix without ever changing the label that is sent back. */
export function splitRecommended(label: string): { base: string; recommended: boolean } {
  if (!RECOMMENDED_SUFFIX.test(label)) return { base: label, recommended: false };
  return { base: label.replace(RECOMMENDED_SUFFIX, ''), recommended: true };
}

export function waitingLabel(waiting: number): string | null {
  return waiting > 0 ? `mais ${waiting} esperando` : null;
}

/**
 * The preview column of a single-choice question: it exists when any option has a preview; it shows the
 * picked option's preview, or `null` text ("Esta opção não tem prévia.").
 */
export function previewForQuestion(
  question: Question,
  draft: QuestionDraft | undefined,
): { show: boolean; text: string | null } {
  if (question.multiSelect) return { show: false, text: null };
  if (!question.options.some((o) => o.preview !== undefined && o.preview !== '')) return { show: false, text: null };
  if ((draft?.custom.trim() ?? '') !== '') return { show: true, text: null };
  const picked = draft?.selected[0];
  const text = question.options.find((o) => o.label === picked)?.preview;
  return { show: true, text: text !== undefined && text !== '' ? text : null };
}

/** D-C14: `PermissionPayload.diff` ('-'/'+' prefixed lines, no numbers) -> DS lines + counts. */
export function diffToLines(diff: string): { lines: DiffLine[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1) });
      added += 1;
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1) });
      removed += 1;
    } else lines.push({ kind: 'ctx', text: raw });
  }
  return { lines, added, removed };
}

/** Roving-tabindex keyboard step of a radio group; `null` = key not handled. */
export function stepRadio(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Columns of the multiple-choice grid, chosen so the last row is never a lone option:
 * 1 -> 1, 2 -> 2, 3 -> 3, 4 -> 2 (2x2); above 4: 3 when divisible by 3, else 2 when even, else 3.
 */
export function choiceColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 3) return count;
  if (count === 4) return 2;
  if (count % 3 === 0) return 3;
  return count % 2 === 0 ? 2 : 3;
}

/** Keeps a page index inside `[0, count - 1]` (0 when there are no pages). */
export function clampPage(page: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(page, 0), count - 1);
}

/** Wizard navigation: one question per page. The "Responder" send stays global (all answers together). */
export function questionPager(
  page: number,
  count: number,
): { page: number; label: string; hasPrev: boolean; hasNext: boolean } {
  const current = clampPage(page, count);
  return {
    page: current,
    label: `Pergunta ${current + 1} de ${count}`,
    hasPrev: current > 0,
    hasNext: current < count - 1,
  };
}
