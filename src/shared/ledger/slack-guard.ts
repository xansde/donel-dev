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
// A file (owner, 06/11: "preciso que o theo west seja capaz de ler e enviar arquivos pelo slack"): an UPLOAD tool
// of a Slack MCP server is read the same way, plus the local path and the file name, and passes only with an
// accepted letter that carries that same file (`SlackLetter.file`). A letter with a file frees only an upload, and
// one without frees only a message. Composio's uploads (content inline) stay refused: nothing to compare.
// Tool names in Portuguese (`slack_enviar_arquivo`, `slack_enviar_mensagem`) are recognised as sends too.
//
// A shell command, a script, Composio's workbench or any other tool whose input carries a Slack post is NEVER
// approved: there is nothing to read field by field (a decoy text, a prefix-matching channel, a loop — cases A, B,
// C). Recognising one is deliberately broad: any write method of the Slack Web API (also assembled, `chat.$M`),
// an incoming webhook, a Composio `SLACK_*` posting slug, the SDK post calls, and any mention of `canal-produto`.
//
// Limit, named on purpose: a hook only sees the call, not what a script written earlier does when it runs
// (`bash /tmp/posta.sh`). The guarantee is against a mistake, not against a session set on going around it.

import { slackLetterSent, type LedgerDoc, type LedgerTask } from './contract';

/** One message a tool call would post. */
export interface SlackSend {
  readonly destination: string;
  readonly thread: string | null;
  readonly text: string;
  /** An upload: the local path the tool sends and the name Slack shows. */
  readonly file?: { readonly path: string; readonly name: string };
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
/** An upload's comment (Slack's `initial_comment`) is its text. */
const COMMENT_KEYS = [...TEXT_KEYS, 'initial_comment', 'comment', 'comentario', 'comentário'];
const FILE_PATH_KEYS = ['caminho', 'path', 'file_path', 'filePath', 'arquivo'];
const FILE_NAME_KEYS = ['nome', 'filename', 'file_name', 'fileName', 'nome_arquivo', 'arquivoNome'];

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
    if (found !== null && normalize(found) !== normalize(text)) return { conflict: `os campos de ${keys === TEXT_KEYS || keys === COMMENT_KEYS ? 'texto' : keys === THREAD_KEYS ? 'thread' : keys === FILE_PATH_KEYS ? 'caminho do arquivo' : keys === FILE_NAME_KEYS ? 'nome do arquivo' : 'destino'} discordam entre si` };
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

/** The name Slack shows for a path without an explicit name: its last part. */
export function fileNameOf(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

/** Reads an upload of a Slack MCP server: destination, thread, comment, local path and name, nothing else. */
function readUpload(raw: unknown): SlackSend | { unreadable: string } {
  const input = isRecord(raw) ? raw : {};
  const known = new Set([...DESTINATION_KEYS, ...THREAD_KEYS, ...COMMENT_KEYS, ...FILE_PATH_KEYS, ...FILE_NAME_KEYS, ...HARMLESS_KEYS]);
  const extra = Object.keys(input).filter((key) => !known.has(key) && !isEmpty(input[key]));
  if (extra.length > 0) return { unreadable: `a chamada leva ${extra.map((key) => `"${key}"`).join(', ')}, que a carta não mostra ao dono (só destino, thread, texto e o arquivo)` };
  const fields = [
    oneValue(input, DESTINATION_KEYS, normalizeDestination),
    oneValue(input, THREAD_KEYS, normalizeThread),
    oneValue(input, COMMENT_KEYS, normalizeText),
    oneValue(input, FILE_PATH_KEYS, normalizeFilePath),
    oneValue(input, FILE_NAME_KEYS, (v) => v.trim()),
  ];
  for (const field of fields) if ('conflict' in field) return { unreadable: field.conflict };
  const [destination, thread, text, path, name] = fields.map((field) => (field as { value: string | null }).value);
  if (destination == null || text == null) return { unreadable: 'não achei o destino e o texto (o comentário do arquivo) desta chamada' };
  if (path == null || !path.trim()) return { unreadable: 'não achei o caminho do arquivo desta chamada' };
  return { destination, thread: thread ?? null, text, file: { path: normalizeFilePath(path), name: name?.trim() || fileNameOf(path) } };
}

/** A Slack action name (MCP tool part or Composio slug) that puts a message in Slack in the owner's name. */
function isPostingAction(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('draft')) return false;
  return (
    /(sends?|posts?|repl(y|ies)|schedules?|updates?|edits?)[_-]?(an?[_-]?)?(slack[_-]?)?(ephemeral[_-]?|direct[_-]?)?(message|msg|reply|thread|to[_-]?(an?[_-]?)?(channel|thread|user|dm|slack))|chat[_.-]?(post|update|schedule|me)|send[_-]?dm|(message|msg)[_-]?(send|post)/.test(n) ||
    // The same in Portuguese (`slack_enviar_mensagem`, `responder_thread`, `postar_no_canal`).
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
  const inlineUpload = { unreadable: 'manda arquivo ao Slack com o conteúdo dentro da chamada, e a carta só confere um arquivo pelo caminho (use a ferramenta de upload do MCP do Slack)' };
  // Composio and alike: the action is a `SLACK_*` slug, as the tool itself or inside an execute call.
  if (COMPOSIO_SLACK.test(action)) {
    if (!isPostingAction(action)) return { kind: 'none' };
    // `slack_*` of a Slack MCP server (`slack_enviar_arquivo`) also lands here: its upload is read by the path.
    const upload = isUploadAction(action) ? (/slack/i.test(server) ? readUpload(toolInput) : inlineUpload) : null;
    return { kind: 'structured', sends: [upload ?? readSend(toolInput)] };
  }
  if (COMPOSIO_META.test(action)) return { kind: 'none' };
  const inner = composioActions(toolInput).filter((entry) => isPostingAction(entry.slug));
  if (inner.length > 0)
    return { kind: 'structured', sends: inner.map((entry) => (isUploadAction(entry.slug) ? inlineUpload : readSend(entry.args))) };
  if (/slack/i.test(server) && isPostingAction(action)) return { kind: 'structured', sends: [isUploadAction(action) ? readUpload(toolInput) : readSend(toolInput)] };
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

/** A local path, compared exactly as the session wrote it (the same machine's path, in the letter and the call). */
export function normalizeFilePath(value: string): string {
  return value.trim();
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
  const sameFile =
    slack.file === undefined
      ? send.file === undefined
      : send.file !== undefined && normalizeFilePath(slack.file.path) === normalizeFilePath(send.file.path) && slack.file.name.trim() === send.file.name.trim();
  return (
    normalizeDestination(slack.destination) === normalizeDestination(send.destination) &&
    normalizeThread(slack.thread) === normalizeThread(send.thread) &&
    normalizeText(slack.text) === normalizeText(send.text) &&
    sameFile
  );
}

export const SLACK_GUARD_HOW_TO =
  'Toda mensagem ao Slack em nome do dono precisa antes de uma carta ACEITA no Oráculo Harrow. ' +
  'Faça assim: (1) chame a ferramenta carta_slack do servidor donel com "destino" (o mesmo valor que vai no campo de canal ou pessoa da ferramenta de envio), "thread" (o thread_ts, se for resposta), "texto" (a mensagem EXATA, caractere por caractere) e "motivo"; ' +
  '(2) avise que está esperando o dono e espere: veja a decisão com tarefa_ver <id>, sem ficar consultando em laço; ' +
  '(3) aceita: envie pela ferramenta do Slack (MCP do Slack, ou a ação SLACK_SEND_MESSAGE do Composio) o MESMO texto ao MESMO destino e thread, uma vez só, só com esses campos: sem blocks, anexos nem agendamento. Arquivo: a carta leva também "arquivo" (o caminho local, igual ao da ferramenta) e "arquivoNome" se o nome no Slack for outro; o texto é o comentário; e o envio vai pela ferramenta de upload do MCP do Slack com esses mesmos campos. Pelo terminal (curl, scripts, canal-produto) ou por código o envio é sempre recusado, porque lá não dá para conferir; ' +
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
