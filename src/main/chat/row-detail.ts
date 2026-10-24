// T048 (014-chat) - `chat:row-detail`: re-reads the row's LineRef from disk and
// extracts the heavy part the row dropped (output, diff, files, raw line).
// Nothing heavy is kept in memory; long text is cut unless `output-full`.

import type { RowDetail, RowDetailPart } from '../../shared/chat/ipc';
import type { ConversationRow, LineRef } from '../../shared/chat/rows';

export const DETAIL_TEXT_LIMIT = 20_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function cut(part: RowDetailPart, text: string, rest?: Omit<RowDetail, 'part' | 'text' | 'truncated'>): RowDetail {
  if (part !== 'output-full' && text.length > DETAIL_TEXT_LIMIT) {
    return { part, text: text.slice(0, DETAIL_TEXT_LIMIT), truncated: true, ...rest };
  }
  return { part, text, truncated: false, ...rest };
}

function refOf(row: ConversationRow): LineRef | undefined {
  if (row.kind === 'action') return row.detail;
  if (row.kind === 'unknown') return row.raw;
  return undefined;
}

/** Text of the `tool_result` block that answers `toolUseId` (string or text blocks). */
function resultText(line: Json, toolUseId: string | undefined): string {
  const content = obj(line.message).content;
  if (Array.isArray(content)) {
    for (const b of content) {
      const block = obj(b);
      if (block.type !== 'tool_result') continue;
      if (toolUseId !== undefined && block.tool_use_id !== toolUseId) continue;
      const c = block.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) return c.map((x) => str(obj(x).text) ?? '').filter((s) => s !== '').join('\n');
    }
  }
  const tur = line.toolUseResult;
  if (typeof tur === 'string') return tur;
  const r = obj(tur);
  return [str(r.stdout), str(r.stderr)].filter((s): s is string => s !== undefined && s !== '').join('\n');
}

function diffText(line: Json): string {
  const r = obj(line.toolUseResult);
  if (Array.isArray(r.structuredPatch)) {
    return r.structuredPatch
      .map((h) => {
        const hunk = obj(h);
        const header = `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`;
        const lines = Array.isArray(hunk.lines) ? hunk.lines.filter((l): l is string => typeof l === 'string') : [];
        return [header, ...lines].join('\n');
      })
      .join('\n');
  }
  const oldS = str(r.oldString);
  const newS = str(r.newString);
  if (oldS !== undefined || newS !== undefined) {
    const side = (prefix: string, s: string | undefined): string[] => (s === undefined || s === '' ? [] : s.split('\n').map((l) => `${prefix}${l}`));
    return [...side('-', oldS), ...side('+', newS)].join('\n');
  }
  return '';
}

function filesOf(line: Json): string[] {
  const r = obj(line.toolUseResult);
  const list = Array.isArray(r.filenames) ? r.filenames : Array.isArray(r.files) ? r.files : [];
  return list.filter((f): f is string => typeof f === 'string');
}

export async function buildRowDetail(
  row: ConversationRow | undefined,
  children: readonly ConversationRow[],
  part: RowDetailPart,
  readLine: (ref: LineRef) => Promise<string>,
): Promise<RowDetail> {
  if (row === undefined) return { part, text: '', truncated: false };
  if (row.kind === 'action-group') return { part, text: '', truncated: false, rows: children };
  const ref = refOf(row);
  if (ref === undefined) return { part, text: '', truncated: false };

  let raw: string;
  try {
    raw = await readLine(ref);
  } catch {
    return { part, text: '', truncated: false };
  }
  if (part === 'raw') return cut(part, raw);

  let line: Json;
  try {
    line = obj(JSON.parse(raw));
  } catch {
    return { part, text: '', truncated: false };
  }
  const toolUseId = row.kind === 'action' ? row.toolUseId : undefined;
  switch (part) {
    case 'output':
    case 'output-full':
      return cut(part, resultText(line, toolUseId));
    case 'diff':
      return cut(part, diffText(line));
    case 'files': {
      const files = filesOf(line);
      return cut(part, files.join('\n'), { files });
    }
    case 'content': {
      const r = obj(line.toolUseResult);
      const fileContent = str(obj(r.file).content) ?? str(r.content);
      return cut(part, fileContent ?? resultText(line, toolUseId));
    }
  }
}
