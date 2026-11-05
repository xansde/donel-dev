// Ledger com prova (item 19) — the `tarefa_*` tools of the MCP server `donel`: definitions and argument
// validation, pure. The main runs them (`src/main/ledger-store.ts`): the session's place and role come from
// the board (the same answer as `sessao_quem_sou`), never from the arguments, so a session cannot pose as
// the Revisor or as the owner.

import { MAX_PROOFS, MAX_PROOF_TEXT_CHARS, MAX_REQUEST_CHARS, type LedgerRisk, type LedgerTaskState } from './contract';

/** A proof as the session sends it. A file is a path on the session's computer; the main copies it in. */
export type ProofInput =
  | { readonly tipo: 'arquivo'; readonly caminho: string }
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'link'; readonly url: string };

export type LedgerToolCall =
  | { readonly tool: 'tarefa_criar'; readonly pedido: string; readonly criterio: string; readonly prazo: string; readonly dono?: string; readonly risco: LedgerRisk }
  | { readonly tool: 'tarefa_assumir'; readonly id: string }
  | { readonly tool: 'tarefa_entregar'; readonly id: string; readonly provas: readonly ProofInput[]; readonly nota?: string }
  | { readonly tool: 'tarefa_aceitar'; readonly id: string }
  | { readonly tool: 'tarefa_rejeitar'; readonly id: string; readonly motivo: string }
  | { readonly tool: 'tarefa_listar'; readonly estado?: LedgerTaskState; readonly todos?: boolean }
  | { readonly tool: 'tarefa_ver'; readonly id: string };

export type LedgerToolName = LedgerToolCall['tool'];

const ID = { type: 'string', description: 'Id da tarefa (tarefa_listar).' };
const STATES: readonly LedgerTaskState[] = ['aberta', 'em-execucao', 'entregue', 'aceita', 'rejeitada'];

export const LEDGER_TOOLS = [
  {
    name: 'tarefa_criar',
    title: 'Criar tarefa no ledger',
    description:
      'Registra uma tarefa entre lugares do quadro: a frase literal de quem pediu, o critério de pronto, o prazo, o lugar dono do trabalho e o risco. Nasce "aberta". Risco baixo pode ser aceito por um lugar com papel Revisor; risco alto espera o dono. Risco baixo só vale quando quem cria não é o dono do trabalho nem foi aberto por ele; senão a tarefa nasce em risco alto.',
    inputSchema: {
      type: 'object',
      properties: {
        pedido: { type: 'string', description: 'A frase LITERAL de quem pediu, sem resumir.' },
        criterio: { type: 'string', description: 'Pronto quando… (o que a prova tem de mostrar).' },
        prazo: { type: 'string', description: 'Data AAAA-MM-DD.' },
        dono: { type: 'string', description: 'Id do lugar que faz o trabalho (sessao_listar); padrão: o seu.' },
        risco: { type: 'string', enum: ['baixo', 'alto'] },
      },
      required: ['pedido', 'criterio', 'prazo', 'risco'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_assumir',
    title: 'Assumir tarefa',
    description: 'O lugar dono começa (ou retoma, depois de rejeitada) a tarefa: vai para "em execução".',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'tarefa_entregar',
    title: 'Entregar tarefa com prova',
    description:
      `Marca a tarefa como entregue. Sem prova é recusada. Provas (1 a ${MAX_PROOFS}): {"tipo":"arquivo","caminho":"C:/…/print.png"} (print ou vídeo neste computador; o app copia para o ledger), {"tipo":"texto","texto":"saída do comando"} ou {"tipo":"link","url":"https://… (o CI)"}. Quem entrega não aceita a própria entrega.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        provas: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PROOFS,
          items: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['arquivo', 'texto', 'link'] },
              caminho: { type: 'string', description: 'arquivo: caminho absoluto do print ou vídeo (png, jpg, gif, webp, mp4, webm, mov).' },
              texto: { type: 'string', description: 'texto: a saída do comando.' },
              url: { type: 'string', description: 'link: http(s), ex. a execução do CI.' },
            },
            required: ['tipo'],
            additionalProperties: false,
          },
        },
        nota: { type: 'string', description: 'O que foi feito, em uma ou duas frases (opcional).' },
      },
      required: ['id', 'provas'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_aceitar',
    title: 'Aceitar entrega',
    description:
      'Aceita uma entrega. ANTES, leia a prova com tarefa_ver (sem isso o aceite é recusado) e confira que ela mostra o critério. Só um lugar com papel Revisor, só risco baixo, só do seu quadro e de fora da cadeia de quem entregou (não aberto por ele nem abaixo dele); quem entregou nunca aceita. O resto espera o dono.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'tarefa_rejeitar',
    title: 'Rejeitar entrega',
    description: 'Rejeita uma entrega com motivo, depois de ler a prova com tarefa_ver (mesma regra de quem aceita). O lugar dono pode assumir de novo.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, motivo: { type: 'string', description: 'O que falta ou está errado.' } },
      required: ['id', 'motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_listar',
    title: 'Listar tarefas do ledger',
    description: 'As tarefas do quadro deste projeto (ou de todos), com estado, dono, prazo, risco e o resumo da última entrega, e a faixa de números do quadro. A prova inteira se lê com tarefa_ver.',
    inputSchema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: STATES },
        todos: { type: 'boolean', description: 'true: de todos os quadros (padrão: só o deste projeto).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tarefa_ver',
    title: 'Ver tarefa e prova',
    description:
      'Uma tarefa inteira, com a prova da última entrega: o texto completo, o link e, para print ou vídeo, o caminho do arquivo copiado (o primeiro print vem também como imagem). Quem decide (tarefa_aceitar, tarefa_rejeitar) lê a prova aqui antes.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
] as const;

const NAMES: ReadonlySet<string> = new Set(LEDGER_TOOLS.map((tool) => tool.name));

export function isLedgerToolName(name: string): name is LedgerToolName {
  return NAMES.has(name);
}

export type ParsedLedgerCall = { readonly ok: true; readonly call: LedgerToolCall } | { readonly ok: false; readonly reason: string };

function text(value: unknown, field: string, max: number, required: boolean): string | undefined | { error: string } {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) return { error: `"${field}" é obrigatório (texto).` };
  if (value.length > max) return { error: `"${field}" longo demais (máximo ${max} caracteres).` };
  return value;
}

function parseProofInput(raw: unknown, index: number): ProofInput | string {
  const where = `prova ${index + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return `${where}: tem de ser um objeto.`;
  const r = raw as Record<string, unknown>;
  switch (r.tipo) {
    case 'arquivo':
      return typeof r.caminho === 'string' && r.caminho.trim() ? { tipo: 'arquivo', caminho: r.caminho.trim() } : `${where}: "caminho" é obrigatório.`;
    case 'texto':
      return typeof r.texto === 'string' && r.texto.trim() && r.texto.length <= MAX_PROOF_TEXT_CHARS
        ? { tipo: 'texto', texto: r.texto }
        : `${where}: "texto" é obrigatório (até ${MAX_PROOF_TEXT_CHARS} caracteres).`;
    case 'link':
      return typeof r.url === 'string' && r.url.trim() ? { tipo: 'link', url: r.url.trim() } : `${where}: "url" é obrigatório.`;
    default:
      return `${where}: "tipo" tem de ser arquivo, texto ou link.`;
  }
}

export function parseLedgerToolCall(name: string, rawArgs: unknown): ParsedLedgerCall {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'Argumentos têm de ser um objeto.' };
  const fail = (reason: string): ParsedLedgerCall => ({ ok: false, reason });
  const id = text(args.id, 'id', 120, true);
  switch (name) {
    case 'tarefa_criar': {
      const pedido = text(args.pedido, 'pedido', MAX_REQUEST_CHARS, true);
      const criterio = text(args.criterio, 'criterio', MAX_REQUEST_CHARS, true);
      const prazo = text(args.prazo, 'prazo', 40, true);
      const dono = text(args.dono, 'dono', 120, false);
      for (const value of [pedido, criterio, prazo, dono]) if (typeof value === 'object') return fail(value.error);
      if (args.risco !== 'baixo' && args.risco !== 'alto') return fail('"risco" tem de ser baixo ou alto.');
      return {
        ok: true,
        call: { tool: 'tarefa_criar', pedido: pedido as string, criterio: criterio as string, prazo: (prazo as string).trim(), ...(typeof dono === 'string' && dono.trim() ? { dono: dono.trim() } : {}), risco: args.risco },
      };
    }
    case 'tarefa_assumir':
    case 'tarefa_aceitar':
    case 'tarefa_ver':
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      return { ok: true, call: { tool: name, id: id.trim() } };
    case 'tarefa_entregar': {
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      if (!Array.isArray(args.provas) || args.provas.length === 0) return fail('Entrega sem prova é recusada: "provas" precisa de ao menos uma (arquivo, texto ou link).');
      if (args.provas.length > MAX_PROOFS) return fail(`No máximo ${MAX_PROOFS} provas por entrega.`);
      const provas: ProofInput[] = [];
      for (const [index, raw] of args.provas.entries()) {
        const proof = parseProofInput(raw, index);
        if (typeof proof === 'string') return fail(proof);
        provas.push(proof);
      }
      const nota = text(args.nota, 'nota', MAX_REQUEST_CHARS, false);
      if (typeof nota === 'object') return fail(nota.error);
      return { ok: true, call: { tool: 'tarefa_entregar', id: id.trim(), provas, ...(nota?.trim() ? { nota } : {}) } };
    }
    case 'tarefa_rejeitar': {
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      const motivo = text(args.motivo, 'motivo', MAX_REQUEST_CHARS, true);
      if (typeof motivo === 'object' || motivo === undefined) return fail('"motivo" é obrigatório para rejeitar.');
      return { ok: true, call: { tool: 'tarefa_rejeitar', id: id.trim(), motivo } };
    }
    case 'tarefa_listar': {
      if (args.estado !== undefined && !STATES.includes(args.estado as LedgerTaskState)) return fail(`"estado" tem de ser ${STATES.join(', ')}.`);
      if (args.todos !== undefined && typeof args.todos !== 'boolean') return fail('"todos" é true ou false.');
      return { ok: true, call: { tool: 'tarefa_listar', ...(args.estado ? { estado: args.estado as LedgerTaskState } : {}), ...(args.todos ? { todos: true } : {}) } };
    }
    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
