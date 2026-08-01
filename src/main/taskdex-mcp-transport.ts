import type { BoardReadTool, CallBoardReadTool, TaskdexServiceCredential } from './taskdex-board-client';

// Transporte real do board — a peça que T324/T330 deixou em aberto ("nenhuma
// task especificou endpoint nem protocolo, então não implementei um").
// O protocolo agora está determinado e medido contra o servidor real:
//
//   POST <baseUrl>  ·  JSON-RPC 2.0  ·  header `X-MCP-Key: <token>`
//   { "jsonrpc":"2.0", "id":N, "method":"tools/call",
//     "params": { "name": "<tool>", "arguments": { ... } } }
//   → { "result": { "content": [ { "type":"text", "text":"<JSON stringificado>" } ] } }
//
// Duas invariantes deste arquivo:
//  1. **Só leitura.** Ele só sabe montar as tools da união `BoardReadTool`
//     (lista fechada do CA-11) — nenhuma tool de escrita é representável.
//  2. **O token nunca aparece em mensagem de erro.** As exceções carregam só
//     o código HTTP/RPC; corpo, URL e header ficam de fora, porque quem chama
//     pode logar o erro.
//
// O `httpPost` é injetável: os testes exercitam o protocolo inteiro sem rede.

/** POST cru — devolve status + corpo em texto, sem interpretar nada. Nunca lança por status != 2xx. */
export interface HttpPostJson {
  (url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }>;
}

export function createSystemHttpPostJson(): HttpPostJson {
  return async (url, headers, body) => {
    const response = await fetch(url, { method: 'POST', headers, body });
    return { status: response.status, text: await response.text() };
  };
}

/**
 * Nomes de parâmetro do APP → nomes da API do TaskDex. O app fala `cardId`
 * (vocabulário da Esteira) em toda a superfície; só aqui isso vira `taskId`.
 * Concentrar a tradução no transporte é o que permite trocar de backend sem
 * mexer no espelho nem na porta de entrada.
 */
const PARAM_ALIASES: Readonly<Record<string, string>> = { cardId: 'taskId' };

/**
 * Parâmetros que vão para a API MESMO vazios, porque a tool os exige e o vazio
 * é o valor com significado. `search_tasks` pede `query` sempre; "todos os
 * cards desta etiqueta" é `query: ''` + `labelIds` — sem esta exceção a
 * varredura de travas morreria em validação e degradaria calada para "nenhuma
 * trava".
 */
const ALWAYS_SENT_PARAMS: readonly string[] = ['query'];

function toApiArguments(
  params: Readonly<Record<string, string | readonly string[]>>,
): Record<string, string | readonly string[]> {
  const apiArgs: Record<string, string | readonly string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    // Array vazio também não vai (nada a filtrar não é o mesmo que filtrar por nada).
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (empty && !ALWAYS_SENT_PARAMS.includes(key)) continue;
    apiArgs[PARAM_ALIASES[key] ?? key] = value;
  }
  return apiArgs;
}

/**
 * O servidor pode responder `application/json` puro ou SSE
 * (`text/event-stream`, negociado pelo header `Accept` que o MCP pede). Nos
 * dois casos o envelope JSON-RPC é o mesmo — no SSE ele vem na linha `data:`.
 */
function extractJsonRpcBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) return trimmed;

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());

  return dataLines.length > 0 ? dataLines[dataLines.length - 1] : trimmed;
}

/**
 * Desembrulha `result.content[0].text` (JSON stringificado dentro do envelope
 * MCP). Um `result` que já venha estruturado volta como está — não inventamos
 * formato quando o servidor muda.
 */
function unwrapToolResult(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;

  const textEntry = content.find(
    (entry): entry is { text: string } =>
      typeof entry === 'object' && entry !== null && typeof (entry as { text?: unknown }).text === 'string',
  );
  if (!textEntry) return result;

  try {
    return JSON.parse(textEntry.text);
  } catch {
    return textEntry.text;
  }
}

/**
 * Fábrica do `callTool` real que `createSystemBoardFactsReader` e
 * `createSystemTaskdexBoardReader` esperavam desde a Fatia 2. Lança em falha
 * de rede/protocolo — quem chama (`readBoardFactsFor`, `fetchBoardCards`) já
 * degrada para "sem fato"/lista vazia, mantendo a árvore inteira (C4).
 */
export function createJsonRpcCallTool(credential: TaskdexServiceCredential, post: HttpPostJson): CallBoardReadTool {
  let nextId = 1;

  return async (tool: BoardReadTool, params: Readonly<Record<string, string | readonly string[]>>): Promise<unknown> => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name: tool, arguments: toApiArguments(params) },
    });

    const { status, text } = await post(
      credential.baseUrl,
      {
        'X-MCP-Key': credential.token,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body,
    );

    // Mensagens propositalmente magras: só o código. Corpo e credencial ficam fora.
    if (status !== 200) throw new Error(`taskdex: resposta HTTP ${status}`);

    const envelope = JSON.parse(extractJsonRpcBody(text)) as { result?: unknown; error?: { code?: number } };
    if (envelope.error) throw new Error(`taskdex: erro JSON-RPC ${envelope.error.code ?? 'desconhecido'}`);

    return unwrapToolResult(envelope.result);
  };
}
