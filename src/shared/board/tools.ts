// Quadro de tarefas (t-1e354d15) — the `card_*` tools of the MCP server `donel`: definitions and argument validation,
// pure. The daemon on the VPS runs them (src/oraculo/board-tools.ts), intercepting them at the gate before the PC: the
// board lives on the VPS (a SQLite since 20/11, board-sqlite.ts) and must answer with the PC off. The caller's place and session come from the
// board picture, never from the arguments. Not the Oráculo's `tarefa_*` (the owner's desk): never mix the two.

import { OWNER_REASONS, STAGES, STAGE_LABELS, type OwnerReason, type Stage } from './rules';

export interface CardJustificationArg {
  readonly texto: string;
  readonly link: string;
  /** ISO date-time. */
  readonly prazo: string;
}

export type CardToolCall =
  | {
      readonly tool: 'card_create';
      readonly titulo: string;
      readonly pedido: string;
      readonly quemPediu: string;
      readonly criterio?: string;
      readonly frente?: string;
      readonly coluna?: 'inbox' | 'todo';
      readonly lugar?: string;
    }
  | {
      readonly tool: 'card_move';
      readonly id: string;
      readonly para: Stage;
      readonly nota?: string;
      readonly justificativa?: CardJustificationArg;
      readonly motivoDono?: OwnerReason;
      readonly resumo?: string;
      readonly lugar?: string;
      readonly frente?: string;
      readonly versao?: number;
    }
  | { readonly tool: 'card_justify'; readonly id: string; readonly justificativa: CardJustificationArg; readonly versao?: number }
  | { readonly tool: 'card_list'; readonly coluna?: Stage; readonly todos?: boolean };

export type CardToolName = CardToolCall['tool'];

export const MAX_CARD_TITLE_CHARS = 120;
export const MAX_CARD_NOTE_CHARS = 200;
export const MAX_CARD_TEXT_CHARS = 4000;

const STAGE_HELP = STAGES.map((stage) => `${stage} = ${STAGE_LABELS[stage]}`).join(', ');

const JUSTIFICATION_SCHEMA = {
  type: 'object',
  description: 'Por que o cartão está parado: o motivo, o link onde a resposta vai chegar (fio do Slack, PR, issue) e o prazo.',
  properties: {
    texto: { type: 'string', description: 'O motivo, curto ("esperando o Fazolin responder").' },
    link: { type: 'string', description: 'Link http(s) onde a resposta vai aparecer. O cron confere de 15 em 15 min e acorda você quando houver resposta.' },
    prazo: { type: 'string', description: 'Até quando, em ISO 8601 ("2026-11-17T16:00:00-03:00"). Vencido, o cron cobra você.' },
  },
  required: ['texto', 'link', 'prazo'],
} as const;

export const CARD_TOOLS = [
  {
    name: 'card_create',
    title: 'Criar cartão no quadro de tarefas',
    description:
      'Cria um cartão no quadro de tarefas do seu projeto. Cai na Entrada (inbox), onde o Líder do quadro tria; só o Líder cria direto em "A fazer" (todo), e pode dar o lugar que vai fazer. O quadro de tarefas NÃO é o Oráculo: decisão do dono continua no Oráculo.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: `Nome curto (até ${MAX_CARD_TITLE_CHARS} caracteres).` },
        pedido: { type: 'string', description: 'O pedido como veio de quem pediu.' },
        quemPediu: { type: 'string', description: 'A PESSOA de quem veio o pedido: "dono", "Fulano (Slack)", "sinal do X".' },
        criterio: { type: 'string', description: 'Quando está pronto.' },
        frente: { type: 'string', description: 'A frente de trabalho (até 40 caracteres): agrupa os cartões na tabela do projeto.' },
        coluna: { type: 'string', enum: ['inbox', 'todo'], description: 'inbox (padrão) ou todo (só o Líder).' },
        lugar: { type: 'string', description: 'Só o Líder: o lugar que vai fazer.' },
      },
      required: ['titulo', 'pedido', 'quemPediu'],
    },
  },
  {
    name: 'card_move',
    title: 'Mover cartão',
    description: `O andamento é o cartão mudando de coluna, com uma nota curta. Colunas: ${STAGE_HELP}. Fazendo é de quem move (o cartão fica com você). Travado exige "justificativa" (motivo, link e prazo). "Esperando você" é só do Líder do quadro e só por: main_prod (main/produção de repo do dono), new_credential, money, laya. Feito exige "resumo".`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id do cartão (c-…).' },
        para: { type: 'string', enum: [...STAGES], description: 'A coluna de destino. A mesma coluna troca só a nota e mantém justificativa, motivo e resumo que o cartão já tem.' },
        nota: { type: 'string', description: `Uma linha (até ${MAX_CARD_NOTE_CHARS}): o que mudou.` },
        justificativa: JUSTIFICATION_SCHEMA,
        motivoDono: { type: 'string', enum: [...OWNER_REASONS], description: 'Só para "Esperando você", só o Líder.' },
        resumo: { type: 'string', description: 'Só para Feito: o que foi entregue.' },
        lugar: { type: 'string', description: 'Só o Líder: o lugar que vai fazer (um lugar do seu quadro).' },
        frente: { type: 'string', description: 'Só o Líder, na triagem: a frente do cartão (até 40 caracteres; vazio tira).' },
        versao: { type: 'number', description: 'A versão que você leu (card_list); sem ela, vale a atual.' },
      },
      required: ['id', 'para'],
    },
  },
  {
    name: 'card_justify',
    title: 'Justificar cartão parado',
    description: 'Diz por que um cartão em Fazendo ou Travado está parado (motivo, link e prazo), sem mudar de coluna. Com justificativa, o vigia não acorda você; o cron confere o link e acorda quando houver resposta, ou cobra no prazo.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id do cartão.' }, justificativa: JUSTIFICATION_SCHEMA, versao: { type: 'number' } },
      required: ['id', 'justificativa'],
    },
  },
  {
    name: 'card_list',
    title: 'Ver cartões do projeto',
    description: 'Os cartões do seu projeto, agrupados por frente, com coluna, nota, quem faz e versão. Por padrão sem os de Feito.',
    inputSchema: {
      type: 'object',
      properties: {
        coluna: { type: 'string', enum: [...STAGES], description: 'Só os desta coluna.' },
        todos: { type: 'boolean', description: 'true: inclui os de Feito.' },
      },
    },
  },
] as const;

const NAMES = new Set<string>(CARD_TOOLS.map((tool) => tool.name));

export function isCardToolName(name: string): name is CardToolName {
  return NAMES.has(name);
}

type Parsed = { readonly ok: true; readonly call: CardToolCall } | { readonly ok: false; readonly reason: string };

class ArgError extends Error {}

function text(args: Record<string, unknown>, key: string, max: number, required: true): string;
function text(args: Record<string, unknown>, key: string, max: number, required: false): string | undefined;
function text(args: Record<string, unknown>, key: string, max: number, required: boolean): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ArgError(`"${key}" é obrigatório.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ArgError(`"${key}" tem de ser texto.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ArgError(`"${key}" é obrigatório.`);
  if (trimmed.length > max) throw new ArgError(`"${key}" passa de ${max} caracteres.`);
  return trimmed || undefined;
}

function stage(value: unknown, key: string): Stage | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && (STAGES as readonly string[]).includes(value)) return value as Stage;
  throw new ArgError(`"${key}" tem de ser uma de: ${STAGES.join(', ')}.`);
}

function version(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ArgError('"versao" tem de ser um inteiro (card_list mostra).');
  return value;
}

function justification(value: unknown, required: boolean): CardJustificationArg | undefined {
  if (value === undefined || value === null) {
    if (required) throw new ArgError('"justificativa" é obrigatória: {texto, link, prazo}.');
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new ArgError('"justificativa" tem de ser {texto, link, prazo}.');
  const j = value as Record<string, unknown>;
  const texto = text(j, 'texto', MAX_CARD_NOTE_CHARS, true);
  const link = text(j, 'link', 2000, true);
  const prazo = text(j, 'prazo', 64, true);
  if (!/^https?:\/\/\S+$/.test(link)) throw new ArgError('"link" tem de ser um endereço http(s).');
  if (!Number.isFinite(Date.parse(prazo))) throw new ArgError('"prazo" tem de ser data e hora ISO 8601.');
  return { texto, link, prazo };
}

export function parseCardToolCall(name: CardToolName, raw: unknown): Parsed {
  const args = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'card_create': {
        const coluna = stage(args.coluna, 'coluna');
        if (coluna && coluna !== 'inbox' && coluna !== 'todo') throw new ArgError('cartão novo entra em inbox ou todo.');
        const criterio = text(args, 'criterio', MAX_CARD_TEXT_CHARS, false);
        const frente = text(args, 'frente', 40, false);
        const lugar = text(args, 'lugar', 128, false);
        return {
          ok: true,
          call: {
            tool: name,
            titulo: text(args, 'titulo', MAX_CARD_TITLE_CHARS, true),
            pedido: text(args, 'pedido', MAX_CARD_TEXT_CHARS, true),
            quemPediu: text(args, 'quemPediu', 80, true),
            ...(criterio ? { criterio } : {}),
            ...(frente ? { frente } : {}),
            ...(coluna ? { coluna } : {}),
            ...(lugar ? { lugar } : {}),
          },
        };
      }
      case 'card_move': {
        const id = text(args, 'id', 64, true);
        const para = stage(args.para, 'para');
        if (!para) throw new ArgError('"para" é obrigatório.');
        const motivo = args.motivoDono;
        if (motivo !== undefined && !(typeof motivo === 'string' && (OWNER_REASONS as readonly string[]).includes(motivo))) {
          throw new ArgError(`"motivoDono" tem de ser uma de: ${OWNER_REASONS.join(', ')}.`);
        }
        const nota = text(args, 'nota', MAX_CARD_NOTE_CHARS, false);
        const resumo = text(args, 'resumo', MAX_CARD_TEXT_CHARS, false);
        const lugar = text(args, 'lugar', 128, false);
        const frente = typeof args.frente === 'string' ? (args.frente.trim().length > 40 ? undefined : args.frente.trim()) : undefined;
        if (typeof args.frente === 'string' && frente === undefined) throw new ArgError('"frente" passa de 40 caracteres.');
        const j = justification(args.justificativa, false);
        const v = version(args.versao);
        return {
          ok: true,
          call: {
            tool: name,
            id,
            para,
            ...(nota ? { nota } : {}),
            ...(j ? { justificativa: j } : {}),
            ...(motivo ? { motivoDono: motivo as OwnerReason } : {}),
            ...(resumo ? { resumo } : {}),
            ...(lugar ? { lugar } : {}),
            ...(frente !== undefined ? { frente } : {}),
            ...(v ? { versao: v } : {}),
          },
        };
      }
      case 'card_justify': {
        const v = version(args.versao);
        return { ok: true, call: { tool: name, id: text(args, 'id', 64, true), justificativa: justification(args.justificativa, true)!, ...(v ? { versao: v } : {}) } };
      }
      case 'card_list': {
        const coluna = stage(args.coluna, 'coluna');
        return { ok: true, call: { tool: name, ...(coluna ? { coluna } : {}), ...(args.todos === true ? { todos: true } : {}) } };
      }
    }
  } catch (error) {
    if (error instanceof ArgError) return { ok: false, reason: error.message };
    throw error;
  }
}
