// Adapted from pingdotgg/t3code@9f48092 apps/web/src/proposedPlan.ts — MIT, (c) 2026 T3 Tools Inc.
// Local changes: kept only the title/heading helpers and the collapse rule (`stripDisplayedPlanMarkdown`,
// the 8-visible-line limit); dropped the implementation prompt, thread title, filename and download helpers;
// added the collapsed shape required by the design (title + first 3 steps, D-C16) and `planStepCount`
// ("N passos" only for a first-level numbered list); the title falls back to the first non-blank line.
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

/** Text of each first-level numbered item ("1. x" / "1) x" at column 0), ignoring fenced code. */
function firstLevelSteps(planMarkdown: string): string[] {
  const steps: string[] = [];
  let inFence = false;
  for (const line of planMarkdown.split(/\r?\n/)) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(FIRST_LEVEL_STEP_RE);
    if (match) steps.push(match[1].trim());
  }
  return steps;
}

/** Number of steps for the "N passos" tag — `null` unless the plan has a first-level numbered list (D-C16). */
export function planStepCount(planMarkdown: string): number | null {
  const count = firstLevelSteps(planMarkdown).length;
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
  const allSteps = firstLevelSteps(body);
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
