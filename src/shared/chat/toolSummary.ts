// T025 (014-chat) — resumo em português de uma chamada de ferramenta
// (contracts/conversation-rows.md §4). Puro: recebe o `tool_use` e, quando já
// existir, o `toolUseResult` do transcript; devolve categoria + resumo.

import type { ActionCategory, ActionSummary } from './rows';
import { commandDisplayText } from './t3/commandLabel';

export interface ToolSummaryInput {
  /** Nome da ferramenta (`Read`, `Bash`, `mcp__srv__tool`...). */
  readonly name: string;
  /** `tool_use.input` (qualquer forma; tolera lixo). */
  readonly input: unknown;
  /** `toolUseResult` do transcript, se o resultado já chegou. */
  readonly result?: unknown;
  /** Diretório de trabalho da sessão, para caminhos relativos. */
  readonly cwd: string;
}

export interface ToolSummaryOutput {
  readonly category: ActionCategory;
  readonly summary: ActionSummary;
  /** Tooltip: caminho inteiro quando o alvo foi encurtado. */
  readonly title?: string;
}

const MAX_COMMAND_LABEL = 60;
const MINUS = '−';

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Relative to cwd when inside it; otherwise the file name (full path goes in `title`). */
export function displayPath(filePath: string, cwd: string): { target: string; title?: string } {
  const file = normalizeSlashes(filePath);
  const base = normalizeSlashes(cwd).replace(/\/+$/, '');
  const windowsLike = /^[A-Za-z]:/.test(file) || /^[A-Za-z]:/.test(base);
  const f = windowsLike ? file.toLowerCase() : file;
  const b = windowsLike ? base.toLowerCase() : base;
  if (base && f.startsWith(b + '/')) {
    const rel = file.slice(base.length + 1);
    return { target: rel, title: rel === filePath ? undefined : filePath };
  }
  const name = file.split('/').filter(Boolean).pop() ?? filePath;
  return { target: name, title: name === filePath ? undefined : filePath };
}

function withPath(
  category: ActionCategory,
  verb: string,
  filePath: string | undefined,
  cwd: string,
  stats?: string,
): ToolSummaryOutput {
  if (!filePath) return { category, summary: stats ? { verb, stats } : { verb } };
  const { target, title } = displayPath(filePath, cwd);
  const summary: ActionSummary = stats ? { verb, target, stats } : { verb, target };
  return title ? { category, summary, title } : { category, summary };
}

// ---------------------------------------------------------------------------
// helpers per tool
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function patchStats(result: Obj): string | undefined {
  const patch = result.structuredPatch;
  if (!Array.isArray(patch)) return undefined;
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    const lines = obj(hunk).lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return `+${added} ${MINUS}${removed}`;
}

function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

function summarizeRead(input: Obj, result: Obj, cwd: string): ToolSummaryOutput {
  const filePath = str(input.file_path);
  const kind = str(result.type);
  const ext = filePath?.split('.').pop()?.toLowerCase();
  const isImage = kind === 'image' || (kind === undefined && !!ext && ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext));
  const isPdf = kind === 'pdf' || (kind === undefined && ext === 'pdf');
  if (isImage || isPdf) {
    return withPath('read', isImage ? 'Viu a imagem' : 'Leu o PDF', filePath, cwd);
  }
  let stats: string | undefined;
  const file = obj(result.file);
  const start = num(file.startLine);
  const count = num(file.numLines);
  const total = num(file.totalLines);
  if (start !== undefined && count !== undefined && total !== undefined) {
    if (count < total) stats = `linhas ${start}–${start + count - 1}`;
  } else {
    const offset = num(input.offset);
    const limit = num(input.limit);
    if (offset !== undefined && limit !== undefined) stats = `linhas ${offset}–${offset + limit - 1}`;
  }
  return withPath('read', 'Leu', filePath, cwd, stats);
}

function summarizeWrite(input: Obj, result: Obj, cwd: string): ToolSummaryOutput {
  const filePath = str(input.file_path) ?? str(result.filePath);
  const kind = str(result.type);
  if (kind === 'create') {
    const content = str(result.content) ?? str(input.content) ?? '';
    return withPath('write', 'Criou', filePath, cwd, plural(countLines(content), 'linha', 'linhas'));
  }
  if (kind === 'update') return withPath('write', 'Reescreveu', filePath, cwd, patchStats(result));
  return withPath('write', 'Escreveu', filePath, cwd);
}

/** One-line label of at most 60 characters, wrappers removed. */
function commandLabel(command: string): string {
  let text = commandDisplayText(command);
  const ps = /^\s*(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*?-c(?:ommand)?\s+(["'])([\s\S]*)\1\s*$/i.exec(text);
  if (ps) text = ps[2]!;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_COMMAND_LABEL) return oneLine;
  return oneLine.slice(0, MAX_COMMAND_LABEL - 1).trimEnd() + '…';
}

function summarizeShell(input: Obj): ToolSummaryOutput {
  const command = str(input.command);
  const verb = input.run_in_background === true ? 'Rodou em segundo plano' : 'Rodou';
  const target = command ? commandLabel(command) : '';
  return { category: 'bash', summary: target ? { verb, target } : { verb } };
}

function summarizeGrep(input: Obj, result: Obj): ToolSummaryOutput {
  const pattern = str(input.pattern);
  const n = num(result.numFiles);
  let stats: string | undefined;
  if (n !== undefined) stats = n === 0 ? 'nada encontrado' : `em ${plural(n, 'arquivo', 'arquivos')}`;
  const summary: ActionSummary = { verb: 'Buscou', ...(pattern ? { target: `'${pattern}'` } : {}), ...(stats ? { stats } : {}) };
  return { category: 'search', summary };
}

function summarizeGlob(input: Obj, result: Obj): ToolSummaryOutput {
  const pattern = str(input.pattern);
  const n = num(result.numFiles);
  const summary: ActionSummary = {
    verb: 'Listou',
    ...(pattern ? { target: pattern } : {}),
    ...(n !== undefined ? { stats: plural(n, 'arquivo', 'arquivos') } : {}),
  };
  return { category: 'search', summary };
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function simple(category: ActionCategory, verb: string, target?: string): ToolSummaryOutput {
  return { category, summary: target ? { verb, target } : { verb } };
}

const TASK_LIST_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput']);

/** Summarizes one tool call. Never throws. */
export function summarizeTool(i: ToolSummaryInput): ToolSummaryOutput {
  const input = obj(i.input);
  const result = obj(i.result);
  const { name, cwd } = i;

  switch (name) {
    case 'Read':
      return summarizeRead(input, result, cwd);
    case 'Write':
      return summarizeWrite(input, result, cwd);
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return withPath('edit', 'Editou', str(input.file_path) ?? str(input.notebook_path), cwd, patchStats(result));
    case 'Bash':
    case 'PowerShell':
      return summarizeShell(input);
    case 'Grep':
      return summarizeGrep(input, result);
    case 'Glob':
      return summarizeGlob(input, result);
    case 'WebFetch': {
      const url = str(input.url);
      return simple('web', 'Abriu', url ? domainOf(url) : undefined);
    }
    case 'WebSearch': {
      const q = str(input.query);
      return simple('web', 'Pesquisou na web', q ? `'${q}'` : undefined);
    }
    case 'ToolSearch':
      return simple('other', 'Carregou ferramentas');
    case 'Monitor':
      return simple('task', 'Acompanhou tarefa', str(input.description) ?? str(input.task_id) ?? str(result.taskId));
    case 'TaskStop':
      return simple('task', 'Parou tarefa', str(input.task_id) ?? str(result.task_id));
    case 'SendMessage':
      return simple('task', 'Mandou mensagem', str(input.to));
    case 'Workflow':
      return simple('task', 'Rodou workflow', str(input.workflow) ?? str(input.name) ?? str(result.workflowName));
    case 'Agent':
    case 'Task':
      return simple('agent', 'Lançou subagente', str(input.description));
    case 'Skill':
      return simple('skill', 'Usou a skill', str(input.skill) ?? str(input.command));
    default:
      break;
  }

  if (TASK_LIST_TOOLS.has(name)) return simple('task', 'Atualizou a lista de tarefas');

  if (name.startsWith('mcp__')) {
    const rest = name.slice('mcp__'.length);
    const sep = rest.indexOf('__');
    if (sep > 0 && sep < rest.length - 2) {
      return simple('mcp', 'Usou', `${rest.slice(0, sep)} · ${rest.slice(sep + 2)}`);
    }
    return simple('mcp', 'Usou', rest || name);
  }

  return simple('other', 'Usou', name);
}
