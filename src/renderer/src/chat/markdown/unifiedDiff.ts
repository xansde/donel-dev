// Parser of the `diff` detail of a row (T053, D-C7). Pure.
//
// Input is the hunk text of the transcript's `structuredPatch` (the app never
// recomputes a diff — conversation-rows.md §4): `@@ -a,b +c,d @@` headers, then
// lines prefixed by ' ', '+' or '-'. Without a header the lines are shown with
// no numbers.
import type { DiffLine } from '@donel-dev/design-system';

export interface ParsedDiff {
  readonly lines: DiffLine[];
  /** Header of the only hunk; absent with 0 or 2+ hunks. */
  readonly hunk?: string;
  readonly added: number;
  readonly removed: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(text: string): ParsedDiff {
  const source = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (source === '') return { lines: [], added: 0, removed: 0 };

  const lines: DiffLine[] = [];
  const headers: string[] = [];
  let added = 0;
  let removed = 0;
  let oldNo: number | undefined;
  let newNo: number | undefined;

  for (const raw of source.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      if (headers.length > 0) lines.push({ kind: 'ctx', text: '⋯' });
      headers.push(raw.trimEnd());
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    const sign = raw[0];
    const body = raw.slice(1);
    if (sign === '+') {
      lines.push(newNo === undefined ? { kind: 'add', text: body } : { kind: 'add', text: body, number: newNo });
      if (newNo !== undefined) newNo += 1;
      added += 1;
    } else if (sign === '-') {
      lines.push(oldNo === undefined ? { kind: 'del', text: body } : { kind: 'del', text: body, number: oldNo });
      if (oldNo !== undefined) oldNo += 1;
      removed += 1;
    } else {
      const ctxText = sign === ' ' ? body : raw;
      lines.push(newNo === undefined ? { kind: 'ctx', text: ctxText } : { kind: 'ctx', text: ctxText, number: newNo });
      if (newNo !== undefined) newNo += 1;
      if (oldNo !== undefined) oldNo += 1;
    }
  }

  return headers.length === 1 ? { lines, hunk: headers[0], added, removed } : { lines, added, removed };
}
