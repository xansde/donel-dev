// Navegador integrado — the `navegador_*` tools and the MCP JSON-RPC around them. Pure: the executor that
// actually drives the page is injected (main/browser/browser-service.ts), and so is the token lookup.
//
// The tools are a contract of the APP, not of one CLI (emenda agnóstica de 03/11, docs/design/navegador-interno.md):
// any agent that speaks MCP gets the same server (`donel`) and the same tools. The transport is a minimal
// Streamable HTTP done by hand (D9): POST with one JSON-RPC message (or a batch), answer `application/json`,
// no SSE, no session id. Notifications get `202` with no body.

import { boardTools, isBoardToolName, parseBoardToolCall, type BoardToolCall } from '../mindscape/agent-tools';
import { isLedgerToolName, LEDGER_TOOLS, parseLedgerToolCall, type LedgerToolCall } from '../ledger/tools';
import { HILL_CLIMB_INSTRUCTIONS, HILL_CLIMB_TOOLS, isHillClimbToolName, parseHillClimbToolCall, type HillClimbToolCall } from '../hillClimb/tools';

export const MCP_SERVER_NAME = 'donel';

const BOARD_INSTRUCTIONS =
  'Quadro (Mindscape) do projeto desta sessão, que o dono vê e usa para falar com você desenhando: quadro_ler mostra lugares (sessões com papel), post-its, desenhos e ligações; quadro_aplicar monta o quadro ao vivo num gesto que o dono desfaz com Ctrl+Z (lugares com papel e pedido, post-its, ligações, retângulos, elipses, linhas, mover); papeis_listar dá os papéis. Mover, editar e apagar só no que uma sessão criou; nunca no que o dono fez (a ferramenta recusa). Prefira mostrar um fluxo no quadro a um texto longo. Time de sessões: sessao_quem_sou, sessao_listar, sessao_abrir (papel + pedido; nasce ligada a você por uma seta), sessao_enviar (só pelas setas do quadro) e sessao_ver_tela. Para falar com outra sessão do Donel use sessao_enviar, nunca um recurso de mensagens do próprio agente: o app entrega direto no chat dela, sem pedir aprovação. ';
const LEDGER_INSTRUCTIONS =
  'Oráculo Harrow (o registro de tarefas entre lugares): tarefa_criar (frase literal de quem pediu, critério, prazo, dono, risco), tarefa_assumir, tarefa_entregar (sempre com prova: print, vídeo, protótipo .html autocontido, saída de comando ou link do CI; no risco alto, com o bloco paraODono: a carta que o dono lê, em texto de gente, sem código), tarefa_ver (a prova inteira: leia antes de decidir), tarefa_aceitar e tarefa_rejeitar (Revisor só no risco baixo, no próprio quadro e de fora da cadeia de quem entregou; quem entregou nunca aceita), tarefa_listar (por padrão só as vivas), tarefa_transferir (passa a tarefa adiante quando o lugar dono fechou ou outro vai fazer) e tarefa_cancelar (encerra com motivo o que não vai sair, como a carta substituída). O andamento de cada sessão vai no Oráculo, não em aviso ao Líder: tarefa_andamento (estado, o que precisa, prova, próximo passo; travada e precisa-do-dono chegam na hora ao Líder do quadro) e tarefa_novidades (o que mudou desde a sua última leitura, por sessão). Mensagem ao Slack em nome do dono: SEMPRE antes uma carta_slack (destino, thread, texto exato, motivo) aceita pelo dono; sem ela o envio é bloqueado. ';
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
  | { readonly tool: 'navegador_opcoes'; readonly n: number }
  | { readonly tool: 'navegador_selecionar'; readonly n: number; readonly opcao: string }
  | { readonly tool: 'navegador_achar_texto'; readonly texto: string }
  | { readonly tool: 'navegador_abas' }
  | { readonly tool: 'navegador_trocar_aba'; readonly i: number }
  | { readonly tool: 'navegador_fechar_aba'; readonly i: number }
  | { readonly tool: 'navegador_enviar_arquivo'; readonly n: number; readonly caminho: string }
  | { readonly tool: 'navegador_liberar_pasta'; readonly pasta: string; readonly quadro?: string }
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
const TAB_NUMBER = { type: 'integer', minimum: 1, description: 'Número da aba em navegador_abas (a primeira é 1).' };

export const BROWSER_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'navegador_abrir',
    title: 'Abrir endereço',
    description:
      'Abre um endereço http(s) no navegador integrado desta sessão (o dono vê a mesma página no painel do Donel). Endereço sem esquema vira https; localhost vira http. Também abre um arquivo deste computador que seja página HTML, imagem ou PDF, pelo caminho completo (C:\\pasta\\relatorio.html) ou file:///: use para mostrar ao dono um HTML que você gerou. Pasta, outro tipo de arquivo e pasta de rede são recusados. Depois, use navegador_ler para ver a página.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Endereço http ou https, ou caminho completo de um arquivo HTML, imagem ou PDF deste computador.' } }, required: ['url'], additionalProperties: false },
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
    description: 'Clica no elemento [N] da última navegador_ler. Botões de comprar, pagar ou excluir são travados: nesses, chame navegador_pedir_humano.',
    inputSchema: { type: 'object', properties: { n: ELEMENT_NUMBER }, required: ['n'], additionalProperties: false },
  },
  {
    name: 'navegador_digitar',
    title: 'Digitar',
    description: 'Digita o texto no campo [N] da última navegador_ler, substituindo o que houver nele. Para enviar, use navegador_teclar("Enter") em seguida. Campos de senha e de cartão são travados: nesses, chame navegador_pedir_humano.',
    inputSchema: {
      type: 'object',
      properties: { n: ELEMENT_NUMBER, texto: { type: 'string', description: 'Texto a digitar.' } },
      required: ['n', 'texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_opcoes',
    title: 'Ver as opções de uma lista',
    description: 'Lista as opções da lista [N] (<select> ou lista acessível, como combobox e listbox). Uma lista fechada é aberta para ler. Depois, use navegador_selecionar.',
    inputSchema: { type: 'object', properties: { n: ELEMENT_NUMBER }, required: ['n'], additionalProperties: false },
  },
  {
    name: 'navegador_selecionar',
    title: 'Selecionar uma opção',
    description: 'Escolhe uma opção da lista [N] pelo texto (ou pelo valor) que navegador_opcoes mostrou.',
    inputSchema: {
      type: 'object',
      properties: { n: ELEMENT_NUMBER, opcao: { type: 'string', description: 'Texto da opção.' } },
      required: ['n', 'opcao'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_achar_texto',
    title: 'Rolar até um texto',
    description: 'Rola a página até o primeiro lugar visível com este texto (sem diferenciar maiúsculas), em qualquer frame. Depois, use navegador_ler.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'], additionalProperties: false },
  },
  {
    name: 'navegador_abas',
    title: 'Ver as abas',
    description: 'Lista as abas do navegador desta sessão. Popup e link que abre em nova janela viram aba nova, que passa a ser a ativa.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'navegador_trocar_aba',
    title: 'Trocar de aba',
    description: 'Passa para a aba i de navegador_abas (o dono vê a troca no painel). Leia a página de novo depois.',
    inputSchema: { type: 'object', properties: { i: TAB_NUMBER }, required: ['i'], additionalProperties: false },
  },
  {
    name: 'navegador_fechar_aba',
    title: 'Fechar uma aba',
    description: 'Fecha a aba i de navegador_abas. A última aba não fecha.',
    inputSchema: { type: 'object', properties: { i: TAB_NUMBER }, required: ['i'], additionalProperties: false },
  },
  {
    name: 'navegador_enviar_arquivo',
    title: 'Enviar um arquivo',
    description:
      'Coloca um arquivo no campo de envio [N] (ou no campo de arquivo ligado a esse botão). Passe o caminho COMPLETO do arquivo. Saem os anexos do chat e os arquivos das pastas liberadas para o seu quadro (pelo dono ou pelo orquestrador do quadro). Pasta ainda não liberada: peça ao Líder do seu quadro (ou ao Líder único) que a libere com navegador_liberar_pasta; não peça ao dono. Arquivo de segredo (chaves, tokens, config com credenciais) nunca sai.',
    inputSchema: {
      type: 'object',
      properties: { n: ELEMENT_NUMBER, caminho: { type: 'string', description: 'Caminho completo do arquivo (relativo só vale dentro de uma pasta já autorizada).' } },
      required: ['n', 'caminho'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_liberar_pasta',
    title: 'Liberar uma pasta de envio',
    description:
      'Só o orquestrador: o Líder que o dono pôs num quadro libera, para as sessões do próprio quadro, uma pasta de onde navegador_enviar_arquivo pode enviar; o Líder único libera em qualquer quadro, dizendo qual em "quadro". Fica registrado quem liberou e quando, e o dono vê e remove em Regras. A raiz do disco e a pasta de usuário inteira não são liberadas, e arquivo de segredo dentro da pasta continua recusado.',
    inputSchema: {
      type: 'object',
      properties: {
        pasta: { type: 'string', description: 'Caminho completo da pasta, neste computador.' },
        quadro: { type: 'string', description: 'Só o Líder único: o quadro, pelo nome ou pela pasta do projeto.' },
      },
      required: ['pasta'],
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
      'Pede ao dono que assuma o navegador (login, 2FA, captcha, uma decisão dele). O painel abre com o motivo e esta ferramenta só volta quando ele devolver o controle (até 30 min). Nunca peça senha ao dono pelo chat: ele digita na própria página. Para enviar arquivo não use esta: a pasta é liberada pelo orquestrador do quadro (navegador_liberar_pasta).',
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
    case 'navegador_opcoes':
      if (!isElementNumber(args.n)) return { ok: false, reason: '"n" tem de ser o número [N] de um elemento (inteiro a partir de 1).' };
      return { ok: true, call: { tool: name, n: args.n } };
    case 'navegador_selecionar': {
      if (!isElementNumber(args.n)) return { ok: false, reason: '"n" tem de ser o número [N] de um elemento (inteiro a partir de 1).' };
      const opcao = boundedText(args.opcao, 'opcao');
      if (typeof opcao !== 'string') return { ok: false, reason: opcao.error };
      if (opcao.trim() === '') return { ok: false, reason: '"opcao" vazia.' };
      return { ok: true, call: { tool: name, n: args.n, opcao } };
    }
    case 'navegador_achar_texto': {
      const texto = boundedText(args.texto, 'texto');
      if (typeof texto !== 'string') return { ok: false, reason: texto.error };
      if (texto.trim() === '') return { ok: false, reason: '"texto" vazio.' };
      return { ok: true, call: { tool: name, texto } };
    }
    case 'navegador_abas':
      return { ok: true, call: { tool: name } };
    case 'navegador_trocar_aba':
    case 'navegador_fechar_aba':
      if (!isElementNumber(args.i)) return { ok: false, reason: '"i" tem de ser o número da aba em navegador_abas (inteiro a partir de 1).' };
      return { ok: true, call: { tool: name, i: args.i } };
    case 'navegador_enviar_arquivo': {
      if (!isElementNumber(args.n)) return { ok: false, reason: '"n" tem de ser o número [N] de um elemento (inteiro a partir de 1).' };
      const caminho = boundedText(args.caminho, 'caminho');
      if (typeof caminho !== 'string') return { ok: false, reason: caminho.error };
      if (caminho.trim() === '') return { ok: false, reason: '"caminho" vazio.' };
      return { ok: true, call: { tool: name, n: args.n, caminho: caminho.trim() } };
    }
    case 'navegador_liberar_pasta': {
      const pasta = boundedText(args.pasta, 'pasta');
      if (typeof pasta !== 'string') return { ok: false, reason: pasta.error };
      if (pasta.trim() === '') return { ok: false, reason: '"pasta" vazia.' };
      let quadro: string | undefined;
      if (args.quadro !== undefined) {
        const text = boundedText(args.quadro, 'quadro');
        if (typeof text !== 'string') return { ok: false, reason: text.error };
        quadro = text.trim() || undefined;
      }
      return { ok: true, call: { tool: name, pasta: pasta.trim(), ...(quadro ? { quadro } : {}) } };
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
  /** Quadro por MCP — the Mindscape tools; absent = the server offers only the browser. */
  readonly boardExecutor?: (call: BoardToolCall) => Promise<BrowserToolOutcome>;
  /** The owner's cap of sessions one session may open (`teamPrefs.ts`); `null`/absent = no limit. */
  readonly openCap?: () => number | null;
  /** Ledger com prova (item 19) — the `tarefa_*` tools; absent = no ledger tools. */
  readonly ledgerExecutor?: (call: LedgerToolCall) => Promise<BrowserToolOutcome>;
  /** Hill climbing — the `hillclimb_*` tools of the Escalador; absent = no hill climbing tools. */
  readonly hillClimbExecutor?: (call: HillClimbToolCall) => Promise<BrowserToolOutcome>;
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
          serverInfo: { name: MCP_SERVER_NAME, title: 'Donel Dev — navegador integrado e quadro', version: ctx.serverVersion },
          instructions:
            (ctx.boardExecutor ? BOARD_INSTRUCTIONS : '') +
            (ctx.ledgerExecutor ? LEDGER_INSTRUCTIONS : '') +
            (ctx.hillClimbExecutor ? HILL_CLIMB_INSTRUCTIONS : '') +
            'Navegador integrado do Donel Dev, um por sessão, que o dono vê ao lado da conversa. Fluxo: navegador_abrir, navegador_ler (o que está na tela, elementos numerados [N]), navegador_clicar/navegador_digitar/navegador_teclar, e navegador_ler de novo. Para ler o conteúdo todo da página: navegador_extrair. Login, 2FA, captcha, campo de senha ou cartão e botão de comprar, pagar ou excluir são do dono: navegador_pedir_humano. O dono também pode limitar os domínios que o agente abre.',
        },
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: [...(ctx.boardExecutor ? boardTools(ctx.openCap?.() ?? null) : []), ...(ctx.ledgerExecutor ? LEDGER_TOOLS : []), ...(ctx.hillClimbExecutor ? HILL_CLIMB_TOOLS : []), ...BROWSER_TOOLS] },
      };
    case 'tools/call': {
      const name = p.name;
      if (typeof name === 'string' && ctx.boardExecutor && isBoardToolName(name)) {
        const board = parseBoardToolCall(name, p.arguments);
        if (!board.ok) return { jsonrpc: '2.0', id, result: toolResult({ kind: 'error', text: board.reason }) };
        let boardOutcome: BrowserToolOutcome;
        try {
          boardOutcome = await ctx.boardExecutor(board.call);
        } catch (error) {
          boardOutcome = { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
        return { jsonrpc: '2.0', id, result: toolResult(boardOutcome) };
      }
      if (typeof name === 'string' && ctx.ledgerExecutor && isLedgerToolName(name)) {
        const ledger = parseLedgerToolCall(name, p.arguments);
        if (!ledger.ok) return { jsonrpc: '2.0', id, result: toolResult({ kind: 'error', text: ledger.reason }) };
        let ledgerOutcome: BrowserToolOutcome;
        try {
          ledgerOutcome = await ctx.ledgerExecutor(ledger.call);
        } catch (error) {
          ledgerOutcome = { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
        return { jsonrpc: '2.0', id, result: toolResult(ledgerOutcome) };
      }
      if (typeof name === 'string' && ctx.hillClimbExecutor && isHillClimbToolName(name)) {
        const climb = parseHillClimbToolCall(name, p.arguments);
        if (!climb.ok) return { jsonrpc: '2.0', id, result: toolResult({ kind: 'error', text: climb.reason }) };
        let climbOutcome: BrowserToolOutcome;
        try {
          climbOutcome = await ctx.hillClimbExecutor(climb.call);
        } catch (error) {
          climbOutcome = { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
        return { jsonrpc: '2.0', id, result: toolResult(climbOutcome) };
      }
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
 *
 * B38 — a session on a remote place (VPS) reaches us through the reverse tunnel the app itself opened
 * (`ssh -R 127.0.0.1:<remote>:127.0.0.1:<port>`), so its CLI sends `Host: 127.0.0.1:<remote>`. That port is
 * accepted only together with the token of the PTY it was opened for (`tunnelPortOf`): no new listener, no port
 * on the tailnet, and the loopback-only Host rule still stands against DNS rebinding.
 */
export function checkMcpHttpRequest(
  info: McpHttpRequestInfo,
  port: number,
  resolveToken: (token: string) => string | null,
  tunnelPortOf: (ptyId: string) => number | null = () => null,
): McpHttpGate {
  const path = info.url.split('?', 1)[0];
  if (path !== MCP_ENDPOINT_PATH) return { ok: false, status: 404, message: 'Not found' };
  if (header(info, 'origin') !== undefined) return { ok: false, status: 403, message: 'Origin not allowed' };
  const auth = /^Bearer\s+([A-Za-z0-9_-]{16,256})$/.exec(header(info, 'authorization') ?? '');
  const ptyId = auth ? resolveToken(auth[1]) : null;
  const tunnelPort = ptyId ? tunnelPortOf(ptyId) : null;
  const host = header(info, 'host')?.toLowerCase();
  const allowedHost = (p: number): boolean => host === `127.0.0.1:${p}` || host === `localhost:${p}`;
  if (!allowedHost(port) && (tunnelPort === null || !allowedHost(tunnelPort))) return { ok: false, status: 403, message: 'Host not allowed' };
  if (!ptyId) return { ok: false, status: 401, message: 'Unauthorized' };
  if (info.method !== 'POST') return { ok: false, status: 405, message: 'Method not allowed', headers: { Allow: 'POST' } };
  return { ok: true, ptyId };
}
