/**
 * Adapter — leitor tolerante do formato `esteira.grafo` (version 1).
 *
 * Único arquivo desta bancada com pretensão de sobreviver ao descarte do
 * resto do protótipo: se uma das 3 abordagens node-based virar a leitura
 * real do Modo Dev, este parser (ou uma versão próxima dele) migra junto.
 *
 * Contrato:
 * - valida a forma mínima do documento e recusa o que não bate;
 * - tolera e ignora campos desconhecidos (tolerant reader);
 * - devolve um modelo neutro, sem `x`/`y` obrigatórios (apresentação é
 *   responsabilidade de cada aba, nunca do adapter).
 */

export type NodeKind = 'gate' | 'fase' | 'artefato' | 'nota';

const NODE_KINDS: readonly NodeKind[] = ['gate', 'fase', 'artefato', 'nota'];

export interface NeutralNode {
  id: string;
  kind: NodeKind;
  title: string;
  handoff: string | null;
  note: string | null;
  x?: number;
  y?: number;
}

export interface NeutralEdge {
  from: string;
  to: string;
}

export interface NeutralGraph {
  nodes: NeutralNode[];
  edges: NeutralEdge[];
}

export class GrafoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrafoParseError';
  }
}

const SUPPORTED_VERSION = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Converte o JSON cru do formato `esteira.grafo` no modelo neutro que as 3
 * abas consomem. Lança `GrafoParseError` com mensagem em pt-BR nomeando o
 * campo/nó problemático assim que a forma não bate — nunca tenta adivinhar.
 */
export function parseEsteiraGrafo(raw: unknown): NeutralGraph {
  if (!isPlainObject(raw)) {
    throw new GrafoParseError('documento raiz precisa ser um objeto JSON.');
  }

  if (raw.kind !== 'esteira.grafo') {
    throw new GrafoParseError(
      `campo "kind" inválido: esperava "esteira.grafo", recebi ${JSON.stringify(raw.kind)}.`,
    );
  }

  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) {
    throw new GrafoParseError('campo "version" precisa ser um número inteiro.');
  }

  if (raw.version > SUPPORTED_VERSION) {
    throw new GrafoParseError(
      `versão ${raw.version} desconhecida — este leitor conhece até ${SUPPORTED_VERSION}.`,
    );
  }

  if (!Array.isArray(raw.nodes)) {
    throw new GrafoParseError('campo "nodes" precisa ser um array.');
  }

  if (!Array.isArray(raw.edges)) {
    throw new GrafoParseError('campo "edges" precisa ser um array.');
  }

  const seenIds = new Set<string>();
  const nodes: NeutralNode[] = raw.nodes.map((rawNode, index) => {
    if (!isPlainObject(rawNode)) {
      throw new GrafoParseError(`nó no índice ${index} não é um objeto.`);
    }

    const { id, kind, title, handoff, note, x, y } = rawNode;

    if (!isNonEmptyString(id)) {
      throw new GrafoParseError(`nó no índice ${index}: campo "id" precisa ser uma string não vazia.`);
    }

    if (seenIds.has(id)) {
      throw new GrafoParseError(`id de nó duplicado: "${id}".`);
    }
    seenIds.add(id);

    if (typeof kind !== 'string' || !NODE_KINDS.includes(kind as NodeKind)) {
      throw new GrafoParseError(
        `nó "${id}": kind ${JSON.stringify(kind)} fora do enum esperado (gate|fase|artefato|nota).`,
      );
    }

    if (!isNonEmptyString(title)) {
      throw new GrafoParseError(`nó "${id}": campo "title" precisa ser uma string não vazia.`);
    }

    if (!isStringOrNull(handoff)) {
      throw new GrafoParseError(`nó "${id}": campo "handoff" precisa ser string ou null.`);
    }

    if (!isStringOrNull(note)) {
      throw new GrafoParseError(`nó "${id}": campo "note" precisa ser string ou null.`);
    }

    const neutralNode: NeutralNode = {
      id,
      kind: kind as NodeKind,
      title,
      handoff: handoff ?? null,
      note: note ?? null,
    };

    if (typeof x === 'number') neutralNode.x = x;
    if (typeof y === 'number') neutralNode.y = y;

    return neutralNode;
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: NeutralEdge[] = raw.edges.map((rawEdge, index) => {
    if (!isPlainObject(rawEdge)) {
      throw new GrafoParseError(`aresta no índice ${index} não é um objeto.`);
    }

    const { from, to } = rawEdge;

    if (!isNonEmptyString(from)) {
      throw new GrafoParseError(`aresta no índice ${index}: campo "from" precisa ser uma string não vazia.`);
    }

    if (!isNonEmptyString(to)) {
      throw new GrafoParseError(`aresta no índice ${index}: campo "to" precisa ser uma string não vazia.`);
    }

    if (!nodeIds.has(from)) {
      throw new GrafoParseError(`aresta no índice ${index}: nó de origem "${from}" não existe.`);
    }

    if (!nodeIds.has(to)) {
      throw new GrafoParseError(`aresta no índice ${index}: nó de destino "${to}" não existe.`);
    }

    return { from, to };
  });

  return { nodes, edges };
}
