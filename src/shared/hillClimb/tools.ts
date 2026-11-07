// Hill climbing — the `hillclimb_*` tools of the MCP server `donel`: definitions and argument validation, pure.
// The main runs them (`src/main/hill-climb-store.ts`); the caller's place comes from the board, never from the
// arguments, so only the Escalador that proposed a mission sends its versions.

import {
  MAX_CRITERIA,
  MAX_DIRECTION_CHARS,
  MAX_INVENTORY_ITEM_CHARS,
  MAX_INVENTORY_ITEMS,
  MAX_TEXT_CHARS,
  MAX_VERSION_CHARS,
  type MissionMeasure,
} from './contract';

export type HillClimbToolCall =
  | {
      readonly tool: 'hillclimb_propor';
      readonly titulo: string;
      readonly pedido: string;
      readonly alvo: string;
      readonly leitor: string;
      readonly criterios: readonly string[];
      readonly medida?: MissionMeasure;
    }
  | {
      readonly tool: 'hillclimb_versao';
      readonly missao: string;
      readonly versao: string;
      readonly direcao?: string;
      readonly inventario?: readonly string[];
      readonly nota?: string;
      readonly medido?: number;
    }
  | { readonly tool: 'hillclimb_ver'; readonly missao?: string };

export type HillClimbToolName = HillClimbToolCall['tool'];

/** "Hill climbing: " + the title fits the Oráculo's 60 characters. */
export const MAX_MISSION_TITLE_CHARS = 44;

export const HILL_CLIMB_TOOLS = [
  {
    name: 'hillclimb_propor',
    title: 'Propor missão de hill climbing',
    description:
      'Propõe uma missão de hill climbing em que você é o Escalador: um alvo, quem vai ler ou usar o resultado, de 1 a 6 critérios e, se houver, uma medida com alvo numérico. A missão NUNCA começa sozinha: nasce como carta de risco alto no Oráculo e só roda depois que o dono aceitar. Regras fixas: conselho de 3 juízes às cegas (veem só os critérios, a versão e o leitor; nunca o alvo), corte 9 em todos os critérios por todos os juízes; a 1ª rodada (5 rounds) começa pelo inventário do que já existe e abre 3 direções do zero, e daí em diante se sobe a melhor; até 2 rodadas extras de 3 (cada uma pedida pelo dono); a rodada fecha antes se 2 rounds seguidos não subirem a menor nota ("estacionou"), com uma carta de decisão para o dono.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: `Nome humano da missão (até ${MAX_MISSION_TITLE_CHARS} caracteres, sem código).` },
        pedido: { type: 'string', description: 'A frase literal de quem pediu.' },
        alvo: { type: 'string', description: 'O que é "melhor" nesta missão, em texto de gente. O dono e você leem; os juízes NÃO (só o laço compara com o corte).' },
        leitor: {
          type: 'string',
          description: 'Quem vai ler ou usar o resultado ("o CTO", "o dono no celular"). Os juízes leem a versão como essa pessoa.',
        },
        criterios: { type: 'array', items: { type: 'string' }, description: `De 1 a ${MAX_CRITERIA} critérios, cada um julgado de 0 a 10.` },
        medida: {
          type: 'object',
          description: 'Opcional: alvo medido ("CI em segundos", alvo 30, sentido "menor"). Cada versão manda o valor medido.',
          properties: { rotulo: { type: 'string' }, alvo: { type: 'number' }, sentido: { type: 'string', enum: ['menor', 'maior'] } },
          required: ['rotulo', 'alvo', 'sentido'],
        },
      },
      required: ['titulo', 'pedido', 'alvo', 'leitor', 'criterios'],
    },
  },
  {
    name: 'hillclimb_versao',
    title: 'Enviar versão para o conselho',
    description:
      'Manda a versão atual da missão (o texto do artefato, ou o que os juízes precisam ler dele). O laço conta o round, chama os 3 juízes às cegas e devolve as notas por juiz e critério. A 1ª versão leva o "inventario" (o que já existe e não pode se perder); as 3 primeiras abrem 3 direções do zero, cada uma com um nome em "direcao"; depois disso cada versão sobe a melhor direção (a resposta diz qual). Quando a rodada fecha (passou do corte, estacionou ou acabaram os rounds), PARE: o dono recebe a carta de decisão e escolhe. Recusa enquanto a missão for proposta, com a rodada fechada ou sem a chave de LLM.',
    inputSchema: {
      type: 'object',
      properties: {
        missao: { type: 'string', description: 'Id da missão (hillclimb_ver).' },
        versao: { type: 'string', description: `A versão, até ${MAX_VERSION_CHARS} caracteres.` },
        direcao: {
          type: 'string',
          description: `Nas 3 primeiras versões: o nome curto da direção nova que esta versão abre (até ${MAX_DIRECTION_CHARS} caracteres). Depois, omita: o laço sobe a melhor.`,
        },
        inventario: {
          type: 'array',
          items: { type: 'string' },
          description: `Só na 1ª versão: o que já existe e não pode se perder, um item por linha (até ${MAX_INVENTORY_ITEMS}).`,
        },
        nota: { type: 'string', description: 'O que mudou desde a anterior (só o dono e você leem; os juízes não).' },
        medido: { type: 'number', description: 'O valor medido desta versão, quando a missão tem medida.' },
      },
      required: ['missao', 'versao'],
    },
  },
  {
    name: 'hillclimb_ver',
    title: 'Ver missões de hill climbing',
    description:
      'Sem "missao": as suas missões e o estado de cada uma. Com "missao": o histórico inteiro (rounds, notas por juiz e critério, motivo de cada rodada fechada e o novo rumo que o dono escreveu ao redirecionar).',
    inputSchema: { type: 'object', properties: { missao: { type: 'string', description: 'Id da missão.' } } },
  },
] as const;

const NAMES = new Set<string>(HILL_CLIMB_TOOLS.map((tool) => tool.name));

export function isHillClimbToolName(name: string): name is HillClimbToolName {
  return NAMES.has(name);
}

export const HILL_CLIMB_INSTRUCTIONS =
  'Hill climbing: hillclimb_propor (vira carta no Oráculo; só roda com aceite do dono), hillclimb_versao (um round: 3 juízes às cegas, sem ver o alvo, dão nota por critério; a 1ª rodada começa pelo inventário e abre 3 direções) e hillclimb_ver. Quando a rodada fechar, pare e espere o dono. ';

type Parsed = { readonly ok: true; readonly call: HillClimbToolCall } | { readonly ok: false; readonly reason: string };

function text(args: Record<string, unknown>, key: string, max: number, required: boolean): string | undefined | { error: string } {
  const value = args[key];
  if (value === undefined || value === null || value === '') return required ? { error: `"${key}" é obrigatório.` } : undefined;
  if (typeof value !== 'string') return { error: `"${key}" tem de ser texto.` };
  if (required && !value.trim()) return { error: `"${key}" é obrigatório.` };
  if (value.length > max) return { error: `"${key}" passa de ${max} caracteres.` };
  return value.trim();
}

function isError(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function parseHillClimbToolCall(name: HillClimbToolName, raw: unknown): Parsed {
  const args = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const fail = (reason: string): Parsed => ({ ok: false, reason });
  if (name === 'hillclimb_ver') {
    const missao = text(args, 'missao', 64, false);
    if (isError(missao)) return fail(missao.error);
    return { ok: true, call: { tool: name, ...(missao ? { missao } : {}) } };
  }
  if (name === 'hillclimb_versao') {
    const missao = text(args, 'missao', 64, true);
    const versao = text(args, 'versao', MAX_VERSION_CHARS, true);
    const nota = text(args, 'nota', MAX_TEXT_CHARS, false);
    const direcao = text(args, 'direcao', MAX_DIRECTION_CHARS, false);
    for (const value of [missao, versao, nota, direcao]) if (isError(value)) return fail(value.error);
    const medido = args.medido;
    if (medido !== undefined && (typeof medido !== 'number' || !Number.isFinite(medido))) return fail('"medido" tem de ser um número.');
    let inventario: string[] | undefined;
    if (args.inventario !== undefined) {
      const items = args.inventario;
      if (!Array.isArray(items) || items.length > MAX_INVENTORY_ITEMS) return fail(`"inventario": uma lista de até ${MAX_INVENTORY_ITEMS} itens.`);
      inventario = items.map((item) => (typeof item === 'string' ? item.trim() : ''));
      if (inventario.some((item) => !item || item.length > MAX_INVENTORY_ITEM_CHARS)) return fail(`"inventario": cada item é um texto de até ${MAX_INVENTORY_ITEM_CHARS} caracteres.`);
    }
    return {
      ok: true,
      call: {
        tool: name,
        missao: missao as string,
        versao: versao as string,
        ...(direcao ? { direcao: direcao as string } : {}),
        ...(inventario ? { inventario } : {}),
        ...(nota ? { nota: nota as string } : {}),
        ...(typeof medido === 'number' ? { medido } : {}),
      },
    };
  }
  const titulo = text(args, 'titulo', MAX_MISSION_TITLE_CHARS, true);
  const pedido = text(args, 'pedido', MAX_TEXT_CHARS, true);
  const alvo = text(args, 'alvo', MAX_TEXT_CHARS, true);
  const leitor = text(args, 'leitor', 200, true);
  for (const value of [titulo, pedido, alvo, leitor]) if (isError(value)) return fail(value.error);
  const criterios = args.criterios;
  if (!Array.isArray(criterios) || criterios.length === 0 || criterios.length > MAX_CRITERIA) return fail(`"criterios": de 1 a ${MAX_CRITERIA}.`);
  const names = criterios.map((c) => (typeof c === 'string' ? c.trim() : ''));
  if (names.some((c) => !c || c.length > 80)) return fail('"criterios": cada um é um texto de até 80 caracteres.');
  if (new Set(names).size !== names.length) return fail('"criterios": dois critérios com o mesmo nome.');
  let medida: MissionMeasure | undefined;
  if (args.medida !== undefined) {
    const m = args.medida as Record<string, unknown>;
    if (typeof m !== 'object' || m === null || typeof m.rotulo !== 'string' || !m.rotulo.trim() || typeof m.alvo !== 'number' || !Number.isFinite(m.alvo))
      return fail('"medida": rótulo (texto), alvo (número) e sentido ("menor" ou "maior").');
    if (m.sentido !== 'menor' && m.sentido !== 'maior') return fail('"medida.sentido": "menor" ou "maior".');
    medida = { label: m.rotulo.trim().slice(0, 80), target: m.alvo, direction: m.sentido };
  }
  return {
    ok: true,
    call: {
      tool: name,
      titulo: titulo as string,
      pedido: pedido as string,
      alvo: alvo as string,
      leitor: leitor as string,
      criterios: names,
      ...(medida ? { medida } : {}),
    },
  };
}
