// Slack só com carta (owner, 05/11: "toda mensagem que for enviada para o slack em meu nome seja uma carta no
// oráculo antes de qualquer coisa") — the guard, pure. The hook bridge asks it on every `PreToolUse` of a session
// the Donel opened (here or on a remote place): a tool call that would post to Slack passes only when an
// ACCEPTED letter (`SlackLetter`, contract.ts) not used yet has the same destination, thread and exact text.
// Anything else is refused with a text that teaches the session to write the letter and wait.
//
// What counts as "posting to Slack":
// - an MCP tool of a Slack server whose name sends, posts, replies, schedules or edits a message (drafts do not
//   post and pass);
// - a Composio action `SLACK_*` that sends/posts/schedules/edits, called directly or inside the
//   `COMPOSIO_*EXECUTE*` tools (`tool_slug` + `arguments`);
// - a shell command that calls the Slack Web API to post (`chat.postMessage`, `chat.update`,
//   `chat.scheduleMessage`, `chat.postEphemeral`, `chat.meMessage`), an incoming webhook, or a script that posts
//   (`canal-produto.js postar|responder`, a `SLACK_SEND_MESSAGE` call).
// Structured calls are matched field by field. A shell command has no fields to read, so it passes only when it
// carries the letter's destination and the whole exact text as one quoted string (JSON or shell quotes).

import { slackLetterSent, type LedgerDoc, type LedgerTask } from './contract';

/** One message a tool call would post. */
export interface SlackSend {
  readonly destination: string;
  readonly thread: string | null;
  readonly text: string;
}

export type SlackSendDetection =
  | { readonly kind: 'none' }
  /** Structured: every send of the call, with its fields (`text` null = the call has no text field we can read). */
  | { readonly kind: 'structured'; readonly sends: ReadonlyArray<{ readonly destination: string | null; readonly thread: string | null; readonly text: string | null }> }
  /** A shell command that posts: only the raw command to look into. */
  | { readonly kind: 'shell'; readonly command: string };

export type SlackGuardVerdict =
  | { readonly kind: 'not-slack' }
  | { readonly kind: 'allow'; readonly letterIds: readonly string[] }
  | { readonly kind: 'deny'; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(input: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

const DESTINATION_KEYS = ['channel_id', 'channel', 'channelId', 'conversation_id', 'conversation', 'user_id', 'user', 'recipient', 'to', 'destino', 'canal'];
const THREAD_KEYS = ['thread_ts', 'threadTs', 'thread_id', 'thread', 'ts_thread'];
const TEXT_KEYS = ['text', 'message', 'markdown_text', 'markdown', 'content', 'body', 'texto', 'mensagem'];

function fieldsOf(input: unknown): { destination: string | null; thread: string | null; text: string | null } {
  const record = isRecord(input) ? input : {};
  return { destination: firstString(record, DESTINATION_KEYS), thread: firstString(record, THREAD_KEYS), text: firstString(record, TEXT_KEYS) };
}

/** A Slack action name (MCP tool part or Composio slug) that puts a message in Slack in the owner's name. */
function isPostingAction(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('draft')) return false;
  return /(sends?|posts?|repl(y|ies)|schedules?|updates?|edits?)[_-]?(an?[_-]?)?(slack[_-]?)?(ephemeral[_-]?|direct[_-]?)?(message|msg|reply|thread|to[_-]?(an?[_-]?)?(channel|thread|user|dm|slack))|chat[_.-]?(post|update|schedule|me)|send[_-]?dm|(message|msg)[_-]?(send|post)/.test(n);
}

const COMPOSIO_SLACK = /^SLACK_/i;

/** `tool_slug` + `arguments` pairs anywhere in a Composio execute call (one or many tools per call). */
function composioActions(input: unknown, out: Array<{ slug: string; args: unknown }> = [], depth = 0): Array<{ slug: string; args: unknown }> {
  if (depth > 6) return out;
  if (Array.isArray(input)) {
    for (const item of input) composioActions(item, out, depth + 1);
    return out;
  }
  if (!isRecord(input)) return out;
  const slug = firstString(input, ['tool_slug', 'toolSlug', 'slug', 'action', 'tool']);
  if (slug && COMPOSIO_SLACK.test(slug)) out.push({ slug, args: input.arguments ?? input.args ?? input.params ?? input.input ?? {} });
  for (const value of Object.values(input)) if (typeof value === 'object' && value !== null) composioActions(value, out, depth + 1);
  return out;
}

const SHELL_POSTS = [
  /chat\.(postMessage|update|scheduleMessage|postEphemeral|meMessage)/i,
  /hooks\.slack\.com\/(services|workflows|triggers)/i,
  /canal-produto(\.[cm]?js)?["']?\s+(postar|responder)/i,
  /SLACK_(SEND|POST|SCHEDULE|UPDATE)[A-Z_]*MESSAGE/i,
];

/** Does this tool call post a message to Slack, and with what? Pure. */
export function detectSlackSend(toolName: string, toolInput: unknown): SlackSendDetection {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = isRecord(toolInput) && typeof toolInput.command === 'string' ? toolInput.command : '';
    return SHELL_POSTS.some((re) => re.test(command)) ? { kind: 'shell', command } : { kind: 'none' };
  }
  if (!toolName.startsWith('mcp__')) return { kind: 'none' };
  const parts = toolName.split('__');
  const server = parts[1] ?? '';
  const action = parts.slice(2).join('__');
  // Composio and alike: the action is a `SLACK_*` slug, as the tool itself or inside an execute call.
  if (COMPOSIO_SLACK.test(action)) return isPostingAction(action) ? { kind: 'structured', sends: [fieldsOf(toolInput)] } : { kind: 'none' };
  const inner = composioActions(toolInput).filter((entry) => isPostingAction(entry.slug));
  if (inner.length > 0) return { kind: 'structured', sends: inner.map((entry) => fieldsOf(entry.args)) };
  if (/slack/i.test(server) && isPostingAction(action)) return { kind: 'structured', sends: [fieldsOf(toolInput)] };
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------------------------------------------
// Matching against the accepted letters

/** `#produto`, `@fulana` and `produto` name the same destination; ids keep their case-insensitive form. */
export function normalizeDestination(value: string): string {
  return value.trim().replace(/^[#@]/, '').toLowerCase();
}

function normalizeThread(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** The exact text, with line endings unified (a Windows `\r\n` and a `\n` are the same message). */
export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Letters that may still free a send: accepted, never used. */
export function openSlackLetters(doc: LedgerDoc): LedgerTask[] {
  return Object.values(doc.tasks)
    .filter((task) => task.slack !== undefined && task.state === 'aceita' && !slackLetterSent(task))
    .sort((a, b) => a.createdAt - b.createdAt);
}

function sameSend(task: LedgerTask, send: SlackSend): boolean {
  const slack = task.slack!;
  return (
    normalizeDestination(slack.destination) === normalizeDestination(send.destination) &&
    normalizeThread(slack.thread) === normalizeThread(send.thread) &&
    normalizeText(slack.text) === normalizeText(send.text)
  );
}

/**
 * The ways the WHOLE text can appear as one quoted string inside a shell command: a JSON string (curl -d '{...}'),
 * a single-quoted or a double-quoted shell argument. Always with its quotes, so the accepted text with something
 * more after it does not match.
 */
function shellForms(text: string): string[] {
  const t = normalizeText(text);
  const json = JSON.stringify(t);
  return [...new Set([json, json.replaceAll('/', '\\/'), `'${t.replaceAll("'", `'\\''`)}'`, `"${t.replace(/["\\$`]/g, (c) => `\\${c}`)}"`])];
}

function shellCarries(command: string, task: LedgerTask): boolean {
  const slack = task.slack!;
  const cmd = normalizeText(command);
  const destination = slack.destination.trim().replace(/^[#@]/, '');
  if (!destination || !cmd.toLowerCase().includes(destination.toLowerCase())) return false;
  if (slack.thread && !cmd.includes(slack.thread.trim())) return false;
  return shellForms(slack.text).some((form) => cmd.includes(form));
}

export const SLACK_GUARD_HOW_TO =
  'Toda mensagem ao Slack em nome do dono precisa antes de uma carta ACEITA no Oráculo Harrow. ' +
  'Faça assim: (1) chame a ferramenta carta_slack do servidor donel com "destino" (o mesmo valor que vai no campo de canal ou pessoa da ferramenta de envio), "thread" (o thread_ts, se for resposta), "texto" (a mensagem EXATA, caractere por caractere) e "motivo"; ' +
  '(2) avise que está esperando o dono e espere: veja a decisão com tarefa_ver <id>, sem ficar consultando em laço; ' +
  '(3) aceita: envie o MESMO texto ao MESMO destino e thread, uma vez só (cada carta libera um envio); ' +
  '(4) rejeitada: não envie; o motivo diz o ajuste que o dono pediu; crie outra carta com o texto ajustado. ' +
  'Não tente outro caminho de envio: todos passam por esta trava.';

/** The decision on one tool call, given the ledger. `doc` null = the ledger could not be read (refuse). Pure. */
export function slackGuard(doc: LedgerDoc | null, toolName: string, toolInput: unknown): SlackGuardVerdict {
  const detection = detectSlackSend(toolName, toolInput);
  if (detection.kind === 'none') return { kind: 'not-slack' };
  const deny = (why: string): SlackGuardVerdict => ({ kind: 'deny', reason: `Envio ao Slack bloqueado pelo Donel Dev: ${why} ${SLACK_GUARD_HOW_TO}` });
  if (doc === null) return deny('não consegui ler o Oráculo Harrow para conferir a carta.');
  const letters = openSlackLetters(doc);

  if (detection.kind === 'shell') {
    const letter = letters.find((task) => shellCarries(detection.command, task));
    return letter ? { kind: 'allow', letterIds: [letter.id] } : deny('não há carta aceita com este destino e este texto exato neste comando.');
  }

  const used = new Set<string>();
  for (const raw of detection.sends) {
    if (raw.destination === null || raw.text === null) return deny('não consegui ler o destino e o texto desta chamada para conferir a carta.');
    const send: SlackSend = { destination: raw.destination, thread: raw.thread, text: raw.text };
    const letter = letters.find((task) => !used.has(task.id) && sameSend(task, send));
    if (!letter) return deny('não há carta aceita com este destino, esta thread e este texto exato.');
    used.add(letter.id);
  }
  return { kind: 'allow', letterIds: [...used] };
}
