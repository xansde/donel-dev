// Navegador integrado — the `navegador_*` tools and the MCP JSON-RPC around them. Pure: the executor that
// actually drives the page is injected (main/browser/browser-service.ts), and so is the token lookup.
//
// The tools are a contract of the APP, not of one CLI (emenda agnóstica de 03/11, docs/design/navegador-interno.md):
// any agent that speaks MCP gets the same server (`donel`) and the same tools. The transport is a minimal
// Streamable HTTP done by hand (D9): POST with one JSON-RPC message (or a batch), answer `application/json`,
// no SSE, no session id. Notifications get `202` with no body.

export const MCP_SERVER_NAME = 'donel';
export const MCP_ENDPOINT_PATH = '/mcp';
/** Protocol versions this server answers with; a client asking for another one gets the newest of these. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** `navegador_esperar` never waits longer than this. */
export const MAX_WAIT_MS = 30_000;
export const MAX_TEXT_LENGTH = 10_000;

// ---------------------------------------------------------------------------------------------------------------
// Tools

export type ScrollDirection = 'baixo' | 'cima' | 'esquerda' | 'direita';

export type BrowserToolCall =
  | { readonly tool: 'navegador_abrir'; readonly url: string }
  | { readonly tool: 'navegador_ler' }
  | { readonly tool: 'navegador_extrair'; readonly pergunta?: string; readonly aPartir?: number }
  | { readonly tool: 'navegador_clicar'; readonly n: number }
  | { readonly tool: 'navegador_digitar'; readonly n: number; readonly texto: string }
  | { readonly tool: 'navegador_teclar'; readonly tecla: string }
  | { readonly tool: 'navegador_rolar'; readonly direcao: ScrollDirection }
  | { readonly tool: 'navegador_voltar' }
  | { readonly tool: 'navegador_print' }
  | { readonly tool: 'navegador_esperar'; readonly ms?: number; readonly texto?: string }
  | { readonly tool: 'navegador_pedir_humano'; readonly motivo: string };

export type BrowserToolName = BrowserToolCall['tool'];

/** What a tool returns to the agent. `error` becomes `isError: true` with the text. */
export type BrowserToolOutcome =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly base64: string; readonly mimeType: string; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string };

/** Runs one validated call against the browser of the session that owns the token. */
export type BrowserToolExecutor = (call: BrowserToolCall) => Promise<BrowserToolOutcome>;

interface ToolDefinition {
  readonly name: BrowserToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
}

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const ELEMENT_NUMBER = { type: 'integer', minimum: 1, description: 'Número [N] do elemento, da última navegador_ler.' };

export const BROWSER_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'navegador_abrir',
    title: 'Abrir endereço',
    description:
      'Abre um endereço http(s) no navegador integrado desta sessão (o dono vê a mesma página no painel do Donel). Endereço sem esquema vira https; localhost vira http. Depois, use navegador_ler para ver a página.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Endereço http ou https.' } }, required: ['url'], additionalProperties: false },
  },
  {
    name: 'navegador_ler',
    title: 'Ler a página',
    description:
      'Lê o que está na tela (todos os frames, inclusive iframes de outra origem e shadow DOM) como árvore de acessibilidade resumida. Cada elemento visível em que se pode agir vem numerado [N]; o que está fora da tela é só contado ("N acima / N abaixo") e o que está coberto por outro elemento fica de fora. Os números valem até a próxima leitura (navegar ou mudar a página os vence).',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'navegador_extrair',
    title: 'Extrair o conteúdo',
    description: `Devolve a página inteira (não só a tela) como Markdown legível: títulos, listas, tabelas e links. Use para ler conteúdo; para agir, use navegador_ler. Saída longa vem cortada com aviso; continue com "a_partir". A "pergunta" é só uma anotação sua: o navegador não responde, quem lê é você.`,
    inputSchema: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'O que você procura na página (opcional, só para registro).' },
        a_partir: { type: 'integer', minimum: 0, description: 'Posição (em caracteres) de onde continuar, dada no aviso de corte da extração anterior.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'navegador_clicar',
    title: 'Clicar',
    description: 'Clica no elemento [N] da última navegador_ler.',
    inputSchema: { type: 'object', properties: { n: ELEMENT_NUMBER }, required: ['n'], additionalProperties: false },
  },
  {
    name: 'navegador_digitar',
    title: 'Digitar',
    description: 'Digita o texto no campo [N] da última navegador_ler, substituindo o que houver nele. Para enviar, use navegador_teclar("Enter") em seguida.',
    inputSchema: {
      type: 'object',
      properties: { n: ELEMENT_NUMBER, texto: { type: 'string', description: 'Texto a digitar.' } },
      required: ['n', 'texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_teclar',
    title: 'Teclar',
    description: 'Aperta uma tecla ou combinação no elemento em foco. Exemplos: "Enter", "Tab", "Escape", "ArrowDown", "PageDown", "Ctrl+A".',
    inputSchema: { type: 'object', properties: { tecla: { type: 'string' } }, required: ['tecla'], additionalProperties: false },
  },
  {
    name: 'navegador_rolar',
    title: 'Rolar',
    description: 'Rola a página quase uma tela na direção pedida.',
    inputSchema: {
      type: 'object',
      properties: { direcao: { type: 'string', enum: ['baixo', 'cima', 'esquerda', 'direita'] } },
      required: ['direcao'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_voltar',
    title: 'Voltar',
    description: 'Volta para a página anterior do histórico.',
    inputSchema: NO_ARGS,
  },
  {
    name: 'navegador_print',
    title: 'Print da página',
    description: 'Tira um print (JPEG) da área visível da página.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'navegador_esperar',
    title: 'Esperar',
    description: `Espera um tempo (ms, até ${MAX_WAIT_MS}) ou até um texto aparecer na página (até ${MAX_WAIT_MS / 1000} s). Passe um dos dois.`,
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'integer', minimum: 1, maximum: MAX_WAIT_MS }, texto: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'navegador_pedir_humano',
    title: 'Pedir ajuda ao dono',
    description:
      'Pede ao dono que assuma o navegador (login, 2FA, captcha, uma decisão dele). O painel abre com o motivo e esta ferramenta só volta quando ele devolver o controle (até 30 min). Nunca peça senha ao dono pelo chat: ele digita na própria página.',
    inputSchema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'O que o dono precisa fazer, em uma frase.' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set<string>(BROWSER_TOOLS.map((tool) => tool.name));

export type ParsedToolCall = { readonly ok: true; readonly call: BrowserToolCall } | { readonly ok: false; readonly reason: string };

function isElementNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function boundedText(value: unknown, field: string): string | { error: string } {
  if (typeof value !== 'string') return { error: `"${field}" tem de ser texto.` };
  if (value.length > MAX_TEXT_LENGTH) return { error: `"${field}" longo demais (máximo ${MAX_TEXT_LENGTH} caracteres).` };
  return value;
}

/** Validates the arguments of a known tool. Unknown names are the caller's problem (protocol error). */
export function parseToolCall(name: string, rawArgs: unknown): ParsedToolCall {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'Argumentos têm de ser um objeto.' };
  switch (name) {
    case 'navegador_abrir': {
      const url = boundedText(args.url, 'url');
      if (typeof url !== 'string') return { ok: false, reason: url.error };
      return { ok: true, call: { tool: name, url } };
    }
    case 'navegador_extrair': {
      let pergunta: string | undefined;
      if (args.pergunta !== undefined) {
        const text = boundedText(args.pergunta, 'pergunta');
        if (typeof text !== 'string') return { ok: false, reason: text.error };
        pergunta = text.trim().slice(0, 500) || undefined;
      }
      const aPartir = args.a_partir;
      if (aPartir !== undefined && (typeof aPartir !== 'number' || !Number.isInteger(aPartir) || aPartir < 0)) return { ok: false, reason: '"a_partir" tem de ser um inteiro a partir de 0.' };
      return { ok: true, call: { tool: name, ...(pergunta ? { pergunta } : {}), ...(aPartir ? { aPartir } : {}) } };
    }
    case 'navegador_ler':
    case 'navegador_voltar':
    case 'navegador_print':
      return { ok: true, call: { tool: name } };
    case 'navegador_clicar':
      if (!isElementNumber(args.n)) return { ok: false, reason: '"n" tem de ser o número [N] de um elemento (inteiro a partir de 1).' };
      return { ok: true, call: { tool: name, n: args.n } };
    case 'navegador_digitar': {
      if (!isElementNumber(args.n)) return { ok: false, reason: '"n" tem de ser o número [N] de um elemento (inteiro a partir de 1).' };
      const texto = boundedText(args.texto, 'texto');
      if (typeof texto !== 'string') return { ok: false, reason: texto.error };
      return { ok: true, call: { tool: name, n: args.n, texto } };
    }
    case 'navegador_teclar': {
      if (typeof args.tecla !== 'string' || args.tecla.trim() === '' || args.tecla.length > 64) return { ok: false, reason: '"tecla" tem de ser uma tecla, como "Enter" ou "Ctrl+A".' };
      return { ok: true, call: { tool: name, tecla: args.tecla } };
    }
    case 'navegador_rolar': {
      const direcao = args.direcao;
      if (direcao !== 'baixo' && direcao !== 'cima' && direcao !== 'esquerda' && direcao !== 'direita') {
        return { ok: false, reason: '"direcao" tem de ser "baixo", "cima", "esquerda" ou "direita".' };
      }
      return { ok: true, call: { tool: name, direcao } };
    }
    case 'navegador_esperar': {
      const hasMs = args.ms !== undefined;
      const hasText = args.texto !== undefined;
      if (hasMs === hasText) return { ok: false, reason: 'Passe "ms" ou "texto" (um dos dois).' };
      if (hasMs) {
        if (typeof args.ms !== 'number' || !Number.isFinite(args.ms) || args.ms < 1) return { ok: false, reason: '"ms" tem de ser um número positivo.' };
        return { ok: true, call: { tool: name, ms: Math.min(Math.round(args.ms), MAX_WAIT_MS) } };
      }
      const texto = boundedText(args.texto, 'texto');
      if (typeof texto !== 'string') return { ok: false, reason: texto.error };
      if (texto.trim() === '') return { ok: false, reason: '"texto" vazio.' };
      return { ok: true, call: { tool: name, texto } };
    }
    case 'navegador_pedir_humano': {
      const motivo = boundedText(args.motivo, 'motivo');
      if (typeof motivo !== 'string') return { ok: false, reason: motivo.error };
      if (motivo.trim() === '') return { ok: false, reason: '"motivo" vazio: diga ao dono o que ele precisa fazer.' };
      return { ok: true, call: { tool: name, motivo: motivo.trim().slice(0, 500) } };
    }
    default:
      return { ok: false, reason: `Ferramenta desconhecida: ${name}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// JSON-RPC

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export interface McpHandlerContext {
  readonly executor: BrowserToolExecutor;
  readonly serverVersion: string;
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolResult(outcome: BrowserToolOutcome): Record<string, unknown> {
  switch (outcome.kind) {
    case 'text':
      return { content: [{ type: 'text', text: outcome.text }] };
    case 'image':
      return {
        content: [{ type: 'image', data: outcome.base64, mimeType: outcome.mimeType }, ...(outcome.text ? [{ type: 'text', text: outcome.text }] : [])],
      };
    case 'error':
      return { content: [{ type: 'text', text: outcome.text }], isError: true };
  }
}

function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
}

async function handleOne(message: unknown, ctx: McpHandlerContext): Promise<JsonRpcResponse | null> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return errorResponse(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  const { jsonrpc, id, method, params } = message as Record<string, unknown>;
  const validId = typeof id === 'string' || typeof id === 'number';
  if (jsonrpc !== '2.0' || typeof method !== 'string') return errorResponse(validId ? id : null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  // A notification (no id) never gets an answer: `notifications/initialized`, `notifications/cancelled`...
  if (id === undefined) return null;
  if (!validId) return errorResponse(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  const p = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateVersion(p.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, title: 'Donel Dev — navegador integrado', version: ctx.serverVersion },
          instructions:
            'Navegador integrado do Donel Dev, um por sessão, que o dono vê ao lado da conversa. Fluxo: navegador_abrir, navegador_ler (o que está na tela, elementos numerados [N]), navegador_clicar/navegador_digitar/navegador_teclar, e navegador_ler de novo. Para ler o conteúdo todo da página: navegador_extrair. Login, 2FA ou captcha: navegador_pedir_humano.',
        },
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: BROWSER_TOOLS } };
    case 'tools/call': {
      const name = p.name;
      if (typeof name !== 'string' || !TOOL_NAMES.has(name)) return errorResponse(id, JSON_RPC_ERRORS.invalidParams, `Unknown tool: ${String(name)}`);
      const parsed = parseToolCall(name, p.arguments);
      // Bad arguments go back as a tool error, so the model reads the reason and fixes the call.
      if (!parsed.ok) return { jsonrpc: '2.0', id, result: toolResult({ kind: 'error', text: parsed.reason }) };
      let outcome: BrowserToolOutcome;
      try {
        outcome = await ctx.executor(parsed.call);
      } catch (error) {
        outcome = { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
      return { jsonrpc: '2.0', id, result: toolResult(outcome) };
    }
    default:
      return errorResponse(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${method}`);
  }
}

/**
 * Handles the parsed body of one POST. Returns `null` when nothing is to be answered (only notifications:
 * the HTTP layer answers `202`), one response, or the responses of a batch.
 */
export async function handleMcpPayload(payload: unknown, ctx: McpHandlerContext): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return errorResponse(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
    const answers = (await Promise.all(payload.map((message) => handleOne(message, ctx)))).filter((answer): answer is JsonRpcResponse => answer !== null);
    return answers.length > 0 ? answers : null;
  }
  return handleOne(payload, ctx);
}

/** Parses the raw body; a body that is not JSON gets the JSON-RPC parse error. */
export function parseMcpBody(body: string): { ok: true; payload: unknown } | { ok: false; response: JsonRpcResponse } {
  try {
    return { ok: true, payload: JSON.parse(body) };
  } catch {
    return { ok: false, response: errorResponse(null, JSON_RPC_ERRORS.parse, 'Parse error') };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP gate (D9): loopback only, no browser origin, bearer token per PTY.

export interface McpHttpRequestInfo {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export type McpHttpGate =
  | { readonly ok: true; readonly ptyId: string }
  | { readonly ok: false; readonly status: number; readonly message: string; readonly headers?: Readonly<Record<string, string>> };

function header(info: McpHttpRequestInfo, name: string): string | undefined {
  const value = info.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Decides whether a request may reach the JSON-RPC handler. Any `Origin` is refused (a web page, including one
 * open in the panel itself, must never reach the server), the `Host` must be the loopback with our port
 * (DNS rebinding), and the bearer token names the PTY whose browser the call drives.
 */
export function checkMcpHttpRequest(info: McpHttpRequestInfo, port: number, resolveToken: (token: string) => string | null): McpHttpGate {
  const path = info.url.split('?', 1)[0];
  if (path !== MCP_ENDPOINT_PATH) return { ok: false, status: 404, message: 'Not found' };
  if (header(info, 'origin') !== undefined) return { ok: false, status: 403, message: 'Origin not allowed' };
  const host = header(info, 'host')?.toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { ok: false, status: 403, message: 'Host not allowed' };
  const auth = /^Bearer\s+([A-Za-z0-9_-]{16,256})$/.exec(header(info, 'authorization') ?? '');
  const ptyId = auth ? resolveToken(auth[1]) : null;
  if (!ptyId) return { ok: false, status: 401, message: 'Unauthorized' };
  if (info.method !== 'POST') return { ok: false, status: 405, message: 'Method not allowed', headers: { Allow: 'POST' } };
  return { ok: true, ptyId };
}
