// Adapted from pingdotgg/t3code@9f48092 apps/web/src/proposedPlan.ts — MIT, (c) 2026 T3 Tools Inc.
// Local changes: kept only the title/heading helpers and the collapse rule (`stripDisplayedPlanMarkdown`,
// the 8-visible-line limit); dropped the implementation prompt, thread title, filename and download helpers;
// added the collapsed shape required by the design (title + first 3 steps, D-C16) and `planStepCount`
// ("N passos" from `extractPlanSteps`: the list under a steps-like heading, never just the first list); the title falls back to the first non-blank line.
// License text in ./LICENSE.

/** A plan with more visible body lines than this opens collapsed (T3 `maxLines`). */
export const PLAN_COLLAPSE_VISIBLE_LINES = 8;

/** Steps shown while collapsed. */
export const PLAN_COLLAPSED_STEP_COUNT = 3;

const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+)$/;
const FIRST_LEVEL_STEP_RE = /^\d+[.)]\s+(.*\S.*)$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

/** First markdown heading; otherwise the first non-blank line; `null` for an empty plan. */
export function planTitle(planMarkdown: string): string | null {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = planMarkdown.split(/\r?\n/).find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim() : null;
}

/** Plan body without the leading title heading and without a "Summary" heading right after it. */
export function stripDisplayedPlanMarkdown(planMarkdown: string): string {
  const lines = planMarkdown.trimEnd().split(/\r?\n/);
  const source = lines[0] && HEADING_RE.test(lines[0]) ? lines.slice(1) : [...lines];
  while (source[0]?.trim().length === 0) source.shift();
  const first = source[0]?.match(HEADING_RE);
  if (first?.[1]?.trim().toLowerCase() === 'summary') {
    source.shift();
    while (source[0]?.trim().length === 0) source.shift();
  }
  return source.join('\n');
}

const NUMBERED_HEADING_RE = /^\d+[.)]\s+(.*\S.*)$/;
const NESTED_LIST_RE = /^\s+([-*+]|\d+[.)])\s/;
/** Headings whose section holds the plan's steps. */
const STEPS_HEADING_RE = /passos|steps|mudan[cç]as|changes|implementa|plano de a[cç][aã]o/i;

/** Longest step text shown while collapsed, in characters. */
export const PLAN_STEP_PREVIEW_MAX_CHARS = 140;

interface PlanHeading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

interface PlanList {
  readonly line: number;
  readonly items: string[];
}

/** Headings and first-level numbered lists of a plan, ignoring fenced code. */
function scanPlan(planMarkdown: string): { headings: PlanHeading[]; lists: PlanList[] } {
  const headings: PlanHeading[] = [];
  const lists: PlanList[] = [];
  let current: PlanList | null = null;
  let afterBlank = false;
  let inFence = false;
  planMarkdown.split(/\r?\n/).forEach((line, index) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (line.trim().length === 0) {
      afterBlank = true;
      return;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2].trim(), line: index });
      current = null;
      afterBlank = false;
      return;
    }
    const step = line.match(FIRST_LEVEL_STEP_RE);
    if (step) {
      if (!current) {
        current = { line: index, items: [] };
        lists.push(current);
      }
      current.items.push(step[1].trim());
      afterBlank = false;
      return;
    }
    const indented = /^\s+\S/.test(line);
    if (current && (indented || !afterBlank)) {
      // Continuation of the last item (indented, or lazy right after it); nested lists are not part of the text.
      if (!NESTED_LIST_RE.test(line) && !(/^([-*+])\s/.test(line))) {
        const last = current.items.length - 1;
        current.items[last] = `${current.items[last]} ${line.trim()}`;
      } else if (!indented) {
        current = null;
      }
    } else {
      current = null;
    }
    afterBlank = false;
  });
  return { headings, lists };
}

/**
 * The plan's steps (D-C16): the numbered list under a steps-like heading ("Passos", "Mudanças"...); else the
 * numbered level-3 headings ("### 1. ...") of such a section; else the LAST first-level numbered list; else none.
 * A list item continued on following lines is one item.
 */
export function extractPlanSteps(planMarkdown: string): string[] {
  const { headings, lists } = scanPlan(planMarkdown);
  const nextHeadingLine = (i: number): number => headings[i + 1]?.line ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < headings.length; i++) {
    if (!STEPS_HEADING_RE.test(headings[i].text)) continue;
    const list = lists.find((l) => l.line > headings[i].line && l.line < nextHeadingLine(i));
    if (list) return list.items;
  }
  for (let i = 0; i < headings.length; i++) {
    const section = headings[i];
    if (!STEPS_HEADING_RE.test(section.text)) continue;
    const numbered: string[] = [];
    for (let j = i + 1; j < headings.length && headings[j].level > section.level; j++) {
      if (headings[j].level !== 3) continue;
      const m = headings[j].text.match(NUMBERED_HEADING_RE);
      if (m) numbered.push(m[1].trim());
    }
    if (numbered.length > 0) return numbered;
  }
  return lists.length > 0 ? lists[lists.length - 1].items : [];
}

/** Shortens a step for the collapsed card: at a sentence end, else at a word boundary with an explicit "…". */
export function shortenPlanStep(text: string, maxChars = PLAN_STEP_PREVIEW_MAX_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const window = clean.slice(0, maxChars);
  let sentenceEnd = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    if (/[.!?]/.test(window[i]) && (i === clean.length - 1 || /\s/.test(clean[i + 1]))) {
      sentenceEnd = i;
      break;
    }
  }
  if (sentenceEnd >= maxChars * 0.4) return window.slice(0, sentenceEnd + 1);
  const wordEnd = window.lastIndexOf(' ');
  let cut = (wordEnd > 0 ? window.slice(0, wordEnd) : window).replace(/[\s,;:\-—(]+$/, '');
  if ((cut.match(/`/g) ?? []).length % 2 === 1) cut += '`';
  return `${cut}…`;
}

/** Number of steps for the "N passos" tag — `null` unless the plan has a first-level numbered list (D-C16). */
export function planStepCount(planMarkdown: string): number | null {
  const count = extractPlanSteps(planMarkdown).length;
  return count > 0 ? count : null;
}

export interface CollapsedPlanPreview {
  readonly title: string | null;
  /** `true` when the plan is long (more than `PLAN_COLLAPSE_VISIBLE_LINES` visible body lines). */
  readonly collapsed: boolean;
  /** `planStepCount`, or `null` without a first-level numbered list. */
  readonly stepCount: number | null;
  /** First steps' text (up to 3) when collapsed and the plan has numbered steps; otherwise empty. */
  readonly steps: readonly string[];
  /** Steps left out of `steps` (0 when not collapsed or no numbered list). */
  readonly hiddenStepCount: number;
  /** Markdown to render while collapsed: the first 3 steps, or the first 3 non-blank body lines. Empty when not collapsed. */
  readonly previewMarkdown: string;
}

/**
 * Collapse rule of the plan card: the T3 limit of visible lines decides *when* to collapse; the design
 * decides *how* it looks (title + first 3 steps).
 */
export function buildCollapsedPlanPreview(
  planMarkdown: string,
  options?: { readonly maxLines?: number; readonly previewSteps?: number }
): CollapsedPlanPreview {
  const maxLines = options?.maxLines ?? PLAN_COLLAPSE_VISIBLE_LINES;
  const previewSteps = options?.previewSteps ?? PLAN_COLLAPSED_STEP_COUNT;
  const title = planTitle(planMarkdown);
  const body = stripDisplayedPlanMarkdown(planMarkdown);
  const visible = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const allSteps = extractPlanSteps(planMarkdown);
  const stepCount = allSteps.length > 0 ? allSteps.length : null;
  if (visible.length <= maxLines) {
    return { title, collapsed: false, stepCount, steps: [], hiddenStepCount: 0, previewMarkdown: '' };
  }
  if (allSteps.length > 0) {
    const steps = allSteps.slice(0, previewSteps);
    return {
      title,
      collapsed: true,
      stepCount,
      steps,
      hiddenStepCount: allSteps.length - steps.length,
      previewMarkdown: steps.map((step, i) => `${i + 1}. ${step}`).join('\n')
    };
  }
  return {
    title,
    collapsed: true,
    stepCount: null,
    steps: [],
    hiddenStepCount: 0,
    previewMarkdown: visible.slice(0, previewSteps).join('\n')
  };
}
