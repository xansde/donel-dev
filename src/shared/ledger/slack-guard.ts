// Slack só com carta (owner, 05/11: "toda mensagem que for enviada para o slack em meu nome seja uma carta no
// oráculo antes de qualquer coisa") — the guard, pure. The hook bridge asks it on every `PreToolUse` of a session
// the Donel opened (here or on a remote place): a tool call that would post to Slack passes only when an
// ACCEPTED letter (`SlackLetter`, contract.ts) not used yet has the same destination, thread and exact text.
// Anything else is refused with a text that teaches the session to write the letter and wait.
//
// Only a STRUCTURED call can be approved: an MCP tool of a Slack server, or a Composio `SLACK_*` action (direct or
// inside an execute call), whose fields are read one by one. Every field must be the letter's (destination,
// thread, text) or a harmless option; `blocks`, attachments, files, scheduling or anything else the letter does
// not show is refused, because Slack would show it and the owner never saw it (review of #241, case F).
//
// A shell command, a script, Composio's workbench or any other tool whose input carries a Slack post is NEVER
// approved: there is nothing to read field by field (a decoy text, a prefix-matching channel, a loop — cases A, B,
// C). Recognising one is deliberately broad: any write method of the Slack Web API (also assembled, `chat.$M`),
// an incoming webhook, a Composio `SLACK_*` posting slug, the SDK post calls, and any mention of `canal-produto`.
//
// Tool names in Portuguese are sends too (owner, 06/11: the Theo West MCP has `slack_enviar_arquivo`): a message
// (`slack_enviar_mensagem`, `responder_thread`) needs a letter; a file (`slack_enviar_arquivo`) is refused, like
// any upload, because a letter carries no file. Reading (`slack_baixar_arquivo`) is not a send.
//
// Limit, named on purpose: a hook only sees the call, not what a script written earlier does when it runs
// (`bash /tmp/posta.sh`). The guarantee is against a mistake, not against a session set on going around it.

import { slackLetterSent, type LedgerDoc, type LedgerTask } from './contract';

/** One message a tool call would post. */
export interface SlackSend {
  readonly destination: string;
  readonly thread: string | null;
  readonly text: string;
}

export type SlackSendDetection =
  | { readonly kind: 'none' }
  /** Structured: every send of the call, with its fields read, or the reason it cannot be read. */
  | { readonly kind: 'structured'; readonly sends: ReadonlyArray<SlackSend | { readonly unreadable: string }> }
  /** A post whose content cannot be checked (shell, script, workbench code): always refused. */
  | { readonly kind: 'unreadable'; readonly why: string };

export type SlackGuardVerdict =
  | { readonly kind: 'not-slack' }
  | { readonly kind: 'allow'; readonly letterIds: readonly string[] }
  | { readonly kind: 'deny'; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DESTINATION_KEYS = ['channel_id', 'channel', 'channelId', 'conversation_id', 'conversation', 'user_id', 'user', 'recipient', 'to', 'destino', 'canal'];
const THREAD_KEYS = ['thread_ts', 'threadTs', 'thread_id', 'thread', 'ts_thread'];
const TEXT_KEYS = ['text', 'message', 'markdown_text', 'markdown', 'content', 'body', 'texto', 'mensagem'];
/** Options that change nothing the owner reads. Anything else in a send is refused. */
const HARMLESS_KEYS = ['unfurl_links', 'unfurl_media', 'mrkdwn', 'link_names', 'parse'];

/** An absent value: a field the call did not really use. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** The one value of a group of keys: every key present must agree, or the send cannot be read. */
function oneValue(input: Record<string, unknown>, keys: readonly string[], normalize: (v: string) => string): { value: string | null } | { conflict: string } {
  let found: string | null = null;
  for (const key of keys) {
    if (isEmpty(input[key])) continue;
    const text = asText(input[key]);
    if (text === null) return { conflict: `o campo "${key}" não é texto` };
    if (found !== null && normalize(found) !== normalize(text)) return { conflict: `os campos de ${keys === TEXT_KEYS ? 'texto' : keys === THREAD_KEYS ? 'thread' : 'destino'} discordam entre si` };
    found ??= text;
  }
  return { value: found };
}

/** Reads a structured send field by field; anything the letter does not show makes it unreadable. */
function readSend(raw: unknown): SlackSend | { unreadable: string } {
  const input = isRecord(raw) ? raw : {};
  const known = new Set([...DESTINATION_KEYS, ...THREAD_KEYS, ...TEXT_KEYS, ...HARMLESS_KEYS]);
  const extra = Object.keys(input).filter((key) => !known.has(key) && !isEmpty(input[key]));
  if (extra.length > 0) return { unreadable: `a chamada leva ${extra.map((key) => `"${key}"`).join(', ')}, que a carta não mostra ao dono (só destino, thread e texto)` };
  const destination = oneValue(input, DESTINATION_KEYS, normalizeDestination);
  const thread = oneValue(input, THREAD_KEYS, normalizeThread);
  const text = oneValue(input, TEXT_KEYS, normalizeText);
  for (const field of [destination, thread, text]) if ('conflict' in field) return { unreadable: field.conflict };
  const d = (destination as { value: string | null }).value;
  const t = (text as { value: string | null }).value;
  if (d === null || t === null) return { unreadable: 'não achei o destino e o texto desta chamada' };
  return { destination: d, thread: (thread as { value: string | null }).value, text: t };
}

/** A Slack action name (MCP tool part or Composio slug) that puts a message in Slack in the owner's name. */
function isPostingAction(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('draft')) return false;
  return (
    /(sends?|posts?|repl(y|ies)|schedules?|updates?|edits?)[_-]?(an?[_-]?)?(slack[_-]?)?(ephemeral[_-]?|direct[_-]?)?(message|msg|reply|thread|to[_-]?(an?[_-]?)?(channel|thread|user|dm|slack))|chat[_.-]?(post|update|schedule|me)|send[_-]?dm|(message|msg)[_-]?(send|post)/.test(n) ||
    /(enviar|mandar|postar|publicar|responder|agendar|editar|atualizar)[_-]?((a|o|um|uma|no|na|em)[_-]?)?(mensagem|msg|resposta|thread|fio|canal|dm)/.test(n) ||
    isUploadAction(n)
  );
}

/** A file to Slack: it posts in the channel (with a comment or not), and a letter carries no file. */
function isUploadAction(name: string): boolean {
  return /upload|create[_-]?a?[_-]?file|share[_-]?file|file[_-]?(share|send|post)|remote[_-]?file[_-]?share|(enviar|mandar|subir|postar|publicar|compartilhar|anexar)[_-]?((o|um)[_-]?)?(arquivo|anexo|imagem|print)/i.test(name);
}

const COMPOSIO_SLACK = /^SLACK_/i;
/** Composio tools that only search or describe tools (a slug in them is a name, not a call). */
const COMPOSIO_META = /COMPOSIO_(SEARCH_TOOLS|GET_TOOL_SCHEMAS|MANAGE_CONNECTIONS|LIST_TOOLKITS|CHECK_ACTIVE_CONNECTIONS?|WAIT_FOR_CONNECTIONS?|INITIATE_CONNECTION|GET_TOOL_DEPENDENCY_GRAPH)/i;

/** `tool_slug` + `arguments` pairs anywhere in a Composio execute call (one or many tools per call). */
function composioActions(input: unknown, out: Array<{ slug: string; args: unknown }> = [], depth = 0): Array<{ slug: string; args: unknown }> {
  if (depth > 6) return out;
  if (Array.isArray(input)) {
    for (const item of input) composioActions(item, out, depth + 1);
    return out;
  }
  if (!isRecord(input)) return out;
  const slugKey = ['tool_slug', 'toolSlug', 'slug', 'action', 'tool'].find((key) => typeof input[key] === 'string');
  const slug = slugKey ? (input[slugKey] as string) : null;
  if (slug && COMPOSIO_SLACK.test(slug)) out.push({ slug, args: input.arguments ?? input.args ?? input.params ?? input.input ?? {} });
  for (const value of Object.values(input)) if (typeof value === 'object' && value !== null) composioActions(value, out, depth + 1);
  return out;
}

/** Slack Web API methods that only read. Any other method named in a call (or assembled: `chat.$M`) posts. */
const READ_METHOD =
  /^(conversations\.(history|replies|info|list|members)|users\.(info|list|lookupByEmail|conversations|getPresence|profile\.get)|auth\.test|team\.info|emoji\.list|search\.(messages|files|all)|reactions\.(get|list)|pins\.list|bookmarks\.list|files\.(info|list)|bots\.info|usergroups\.(list|users\.list)|chat\.getPermalink|dnd\.info)$/;

/** Why a free text (a shell command, workbench code, any tool input) carries a post to Slack; `null` = it does not. */
export function freeTextSlackPost(text: string): string | null {
  for (const match of text.matchAll(/slack\.com\/api\/([A-Za-z0-9_.${}()-]*)/gi)) {
    const method = match[1]!.replace(/[?#].*$/, '');
    if (!READ_METHOD.test(method)) return `chama a API do Slack (${method || 'método montado'})`;
  }
  if (/hooks\.slack\.com/i.test(text)) return 'usa um webhook do Slack';
  if (/canal-produto/i.test(text)) return 'usa o canal-produto';
  if (/\bchat[._](postMessage|post_message|update|scheduleMessage|schedule_message|postEphemeral|post_ephemeral|meMessage|me_message)\b/i.test(text)) return 'chama um envio do Slack';
  if (/\bfiles[._](upload|upload_v2|uploadV2|completeUploadExternal|complete_upload_external|getUploadURLExternal|get_upload_url_external|share)/i.test(text)) return 'manda arquivo ao Slack';
  if (/SLACK_[A-Z0-9_]*(SEND|POST|REPL|SCHEDULE|UPDATE|EDIT|UPLOAD|FILE|SHARE)/.test(text)) return 'chama uma ação de envio do Slack do Composio';
  return null;
}

/** Does this tool call post a message to Slack, and with what? Pure. */
export function detectSlackSend(toolName: string, toolInput: unknown): SlackSendDetection {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = isRecord(toolInput) && typeof toolInput.command === 'string' ? toolInput.command : '';
    const why = freeTextSlackPost(command);
    return why ? { kind: 'unreadable', why: `o comando ${why}, e pelo terminal o envio não pode ser conferido` } : { kind: 'none' };
  }
  if (!toolName.startsWith('mcp__')) return { kind: 'none' };
  const parts = toolName.split('__');
  const server = parts[1] ?? '';
  const action = parts.slice(2).join('__');
  if (server === 'donel') return { kind: 'none' }; // the letter itself, and the Oráculo
  const read = (args: unknown) => (isUploadAction(String(action)) ? { unreadable: 'manda arquivo ao Slack, e a carta não leva arquivo' } : readSend(args));
  // Composio and alike: the action is a `SLACK_*` slug, as the tool itself or inside an execute call.
  if (COMPOSIO_SLACK.test(action)) {
    if (!isPostingAction(action)) return { kind: 'none' };
    return { kind: 'structured', sends: [read(toolInput)] };
  }
  if (COMPOSIO_META.test(action)) return { kind: 'none' };
  const inner = composioActions(toolInput).filter((entry) => isPostingAction(entry.slug));
  if (inner.length > 0)
    return { kind: 'structured', sends: inner.map((entry) => (isUploadAction(entry.slug) ? { unreadable: 'manda arquivo ao Slack, e a carta não leva arquivo' } : readSend(entry.args))) };
  if (/slack/i.test(server) && isPostingAction(action)) return { kind: 'structured', sends: [read(toolInput)] };
  // Any other tool (Composio workbench, a remote bash, a runner): a post written inside it cannot be read.
  let flat = '';
  try {
    flat = JSON.stringify(toolInput) ?? '';
  } catch {
    flat = '';
  }
  const why = freeTextSlackPost(flat);
  return why ? { kind: 'unreadable', why: `a ferramenta ${action || toolName} ${why} dentro de código, e lá o envio não pode ser conferido` } : { kind: 'none' };
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

/** Letters that may still free a send: accepted, and never sent (or only sent once, and that send failed). */
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

export const SLACK_GUARD_HOW_TO =
  'Toda mensagem ao Slack em nome do dono precisa antes de uma carta ACEITA no Oráculo Harrow. ' +
  'Faça assim: (1) chame a ferramenta carta_slack do servidor donel com "destino" (o mesmo valor que vai no campo de canal ou pessoa da ferramenta de envio), "thread" (o thread_ts, se for resposta), "texto" (a mensagem EXATA, caractere por caractere) e "motivo"; ' +
  '(2) avise que está esperando o dono e espere: veja a decisão com tarefa_ver <id>, sem ficar consultando em laço; ' +
  '(3) aceita: envie pela ferramenta do Slack (MCP do Slack, ou a ação SLACK_SEND_MESSAGE do Composio) o MESMO texto ao MESMO destino e thread, uma vez só, só com esses campos: sem blocks, anexos, arquivo nem agendamento. Pelo terminal (curl, scripts, canal-produto) ou por código o envio é sempre recusado, porque lá não dá para conferir; ' +
  '(4) rejeitada: não envie; o motivo (ou o que o dono escreveu na carta) diz o ajuste; crie outra carta com o texto ajustado. ' +
  'Não tente outro caminho de envio: todos passam por esta trava.';

/** The decision on one tool call, given the ledger. `doc` null = the ledger could not be read (refuse). Pure. */
export function slackGuard(doc: LedgerDoc | null, toolName: string, toolInput: unknown): SlackGuardVerdict {
  const detection = detectSlackSend(toolName, toolInput);
  if (detection.kind === 'none') return { kind: 'not-slack' };
  const deny = (why: string): SlackGuardVerdict => ({ kind: 'deny', reason: `Envio ao Slack bloqueado pelo Donel Dev: ${why} ${SLACK_GUARD_HOW_TO}` });
  if (detection.kind === 'unreadable') return deny(`${detection.why}.`);
  if (doc === null) return deny('não consegui ler o Oráculo Harrow para conferir a carta.');
  const letters = openSlackLetters(doc);

  const used = new Set<string>();
  for (const send of detection.sends) {
    if ('unreadable' in send) return deny(`${send.unreadable}.`);
    const letter = letters.find((task) => !used.has(task.id) && sameSend(task, send));
    if (!letter) return deny('não há carta aceita com este destino, esta thread e este texto exato.');
    used.add(letter.id);
  }
  return { kind: 'allow', letterIds: [...used] };
}

// ---------------------------------------------------------------------------------------------------------------
// What did the send answer? (t-8119864a: the MCP answered "fetch failed", nothing reached Slack, and the letter
// was spent.) The letter is spent when the guard frees the call; only an EXPLICIT failure gives it back, once.
// An answer that shows neither (a plain "Message sent", or no answer at all) keeps it spent: "envio sem
// confirmação". The owner was promised one send, so a doubt never frees another.

export type SlackSendOutcome = { readonly kind: 'confirmado' } | { readonly kind: 'falhou'; readonly why: string } | { readonly kind: 'sem-confirmacao' };

const SLACK_TS = /^\d{6,}\.\d+$/;
const TS_KEYS = ['ts', 'message_ts', 'messageTs'];
/** Success in a text: `ok: true`, a message `ts`, or a Slack message link (`…/archives/C…/p1730900000123456`). */
const TEXT_SUCCESS = [/["']?\bok["']?\s*[:=]\s*true\b/i, /["']?\b(message_)?ts["']?\s*[:=]\s*["']?\d{6,}\.\d+/i, /\/p\d{10,}\b/, /(?<![\d.])\d{10}\.\d{6}(?![\d.])/];
/** Failure in a text: Slack's `ok: false`, and network errors that leave no doubt nothing went out. */
const TEXT_FAILURE = [
  /["']?\bok["']?\s*[:=]\s*false\b/i,
  /["']?\bisError["']?\s*[:=]\s*true\b|["']?\bsuccess(ful)?["']?\s*[:=]\s*false\b/i,
  /fetch failed|socket hang up|network error|getaddrinfo|\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNABORTED)\b/i,
];

interface Signals {
  success: boolean;
  failure: string | null;
}

function short(text: string): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

function scan(response: unknown, out: Signals, depth: number): void {
  if (depth > 8) return;
  if (typeof response === 'string') {
    const text = response.trim();
    if (/^[[{]/.test(text)) {
      try {
        scan(JSON.parse(text), out, depth + 1);
        return;
      } catch {
        // not JSON: read it as text below
      }
    }
    if (TEXT_SUCCESS.some((pattern) => pattern.test(text))) out.success = true;
    if (TEXT_FAILURE.some((pattern) => pattern.test(text))) out.failure ??= short(text);
    return;
  }
  if (Array.isArray(response)) {
    for (const item of response) scan(item, out, depth + 1);
    return;
  }
  if (!isRecord(response)) return;
  if (response.isError === true || response.ok === false || response.successful === false || response.success === false) {
    const error = response.error ?? response.message ?? response.content;
    out.failure ??= typeof error === 'string' && error.trim() ? short(error) : 'a ferramenta respondeu com erro';
  }
  if (response.ok === true) out.success = true;
  if (TS_KEYS.some((key) => typeof response[key] === 'string' && SLACK_TS.test((response[key] as string).trim()))) out.success = true;
  for (const value of Object.values(response)) if (typeof value === 'string' || typeof value === 'object') scan(value, out, depth + 1);
}

/**
 * The answer of a freed send. `event` is the hook (`PostToolUse`, `PostToolUseFailure`); `response` its
 * `tool_response` (MCP content, Composio result, raw Slack API JSON) and `error` its error text, if any. A signal of
 * success and one of failure in the same answer is a doubt, and a doubt spends the letter. Pure.
 */
export function slackSendOutcome(event: string, response: unknown, error?: unknown): SlackSendOutcome {
  const signals: Signals = { success: false, failure: null };
  scan(response, signals, 0);
  if (event === 'PostToolUseFailure') signals.failure ??= typeof error === 'string' && error.trim() ? short(error) : 'a chamada terminou em erro';
  if (signals.failure !== null && !signals.success) return { kind: 'falhou', why: signals.failure };
  if (signals.success && signals.failure === null) return { kind: 'confirmado' };
  return { kind: 'sem-confirmacao' };
}

