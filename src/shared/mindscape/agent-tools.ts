// Quadro por MCP (PDA mindscape-openrig, items 08 and 13 + B37) — the tools a session uses to read and
// build its project's Mindscape live, and to open and direct other sessions, through the app's MCP server
// `donel`. This file is pure: definitions, argument validation and the board reducer. The renderer owns
// the document (ADR 0004) and applies `applyBoardOps` as ONE owner gesture, so Ctrl+Z takes the whole
// batch back.
//
// Ownership rule (B34/B37, owner 04/11): what a session makes carries `by: 'session'` (schema v4); a session
// may move, edit or remove ONLY that (and the post-it written by a session). Never the owner's post-its,
// places, drawings or links.

import { addDrawing, removeItems, translateDrawing } from './drawings';
import {
  addLink,
  addOwnerCard,
  addPlace,
  editOwnerCard,
  ensureBoard,
  moveCard,
  placeCardId,
  placeHasStarted,
  placeOfSession,
  removeLink,
  setOwnerColor,
  type DrawingStroke,
  type MindscapeBoard,
  type MindscapeCard,
  type MindscapeDoc,
  type MindscapeDrawing,
  type OwnerCardColor,
} from './model';

export type BoardToolCall =
  | { readonly tool: 'quadro_ler' }
  | { readonly tool: 'papeis_listar' }
  | { readonly tool: 'quadro_aplicar'; readonly ops: readonly BoardOp[] }
  | { readonly tool: 'sessao_quem_sou' }
  | { readonly tool: 'sessao_listar' }
  | { readonly tool: 'sessao_abrir'; readonly papel: string; readonly pedido: string; readonly nome?: string; readonly onde?: string }
  | { readonly tool: 'sessao_enviar'; readonly para: string; readonly texto: string }
  | { readonly tool: 'sessao_ver_tela'; readonly quem: string };

export type BoardToolName = BoardToolCall['tool'];

export type BoardColor = 'nenhuma' | 'azul' | 'dourado';
export type BoardStroke = 'fina' | 'media' | 'grossa';

/** One operation of `quadro_aplicar`. `id` "$algo" names a new item for the later operations of the same batch. */
export type BoardOp =
  | { readonly op: 'lugar'; readonly id?: string; readonly papel?: string; readonly pedido?: string; readonly x?: number; readonly y?: number }
  | { readonly op: 'postit'; readonly id?: string; readonly texto: string; readonly cor?: BoardColor; readonly x?: number; readonly y?: number }
  | { readonly op: 'ligacao'; readonly id?: string; readonly de: string; readonly para: string; readonly seta?: boolean }
  | { readonly op: 'retangulo' | 'elipse'; readonly id?: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly cor?: BoardColor; readonly espessura?: BoardStroke }
  | { readonly op: 'linha'; readonly id?: string; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly seta?: boolean; readonly cor?: BoardColor; readonly espessura?: BoardStroke }
  | { readonly op: 'mover'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly op: 'editar'; readonly id: string; readonly texto?: string; readonly cor?: BoardColor }
  | { readonly op: 'apagar'; readonly id: string };

export const MAX_BOARD_OPS = 60;
export const MAX_POSTIT_CHARS = 4000;
export const MAX_MESSAGE_CHARS = 20_000;
/** Board units; anything beyond is a typo, not a plan. */
const MAX_COORD = 100_000;

const COLORS: Readonly<Record<BoardColor, OwnerCardColor>> = { nenhuma: 'none', azul: 'accent', dourado: 'donel-accent' };
const STROKES: Readonly<Record<BoardStroke, DrawingStroke>> = { fina: 'thin', media: 'medium', grossa: 'thick' };
const COLOR_NAMES = Object.keys(COLORS);
const STROKE_NAMES = Object.keys(STROKES);
const OP_NAMES = ['lugar', 'postit', 'ligacao', 'retangulo', 'elipse', 'linha', 'mover', 'editar', 'apagar'];

// ---------------------------------------------------------------------------------------------------------------
// Tool definitions (MCP `tools/list`)

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const COLOR_SCHEMA = { type: 'string', enum: COLOR_NAMES, description: 'Cor (padrão: nenhuma).' };
const STROKE_SCHEMA = { type: 'string', enum: STROKE_NAMES, description: 'Espessura (padrão: media).' };
const NUM = { type: 'number' };
const PLACE_REF = { type: 'string', description: 'Id do lugar (sessao_listar ou quadro_ler).' };

export const BOARD_TOOLS = [
  {
    name: 'quadro_ler',
    title: 'Ler o quadro (Mindscape)',
    description:
      'O Mindscape do projeto desta sessão, em JSON: lugares (sessões, com papel e estado), post-its, desenhos e ligações, cada item com "autor" (dono ou sessao), e qual lugar é o seu. Coordenadas em unidades do quadro (lugar 230×140, post-it 230×270).',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'papeis_listar',
    title: 'Listar papéis de sessão',
    description: 'Os papéis disponíveis (id e nome) para abrir sessões e criar lugares.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'quadro_aplicar',
    title: 'Montar o quadro (Mindscape)',
    description:
      'Aplica um lote de operações no Mindscape do projeto desta sessão, ao vivo e como UM gesto que o dono desfaz com Ctrl+Z. Tudo ou nada: uma operação inválida recusa o lote inteiro. Operações: ' +
      '"lugar" (sessão com papel que ainda não começou; o dono abre com dois cliques; "pedido" vira um post-it ligado a ele), ' +
      '"postit", "ligacao" (de/para: id de cartão ou "$nome" criado neste lote; "seu" = o seu lugar), ' +
      '"retangulo", "elipse", "linha" (seta opcional), e, só no que uma sessão criou (autor sessao): "mover" (x/y do canto), "editar" (texto/cor de post-it) e "apagar". ' +
      'Nunca mexe no que o dono fez (a ferramenta recusa). Sem x/y, o app acha um espaço livre. Devolve os ids reais.',
    inputSchema: {
      type: 'object',
      properties: {
        operacoes: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BOARD_OPS,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: OP_NAMES },
              id: { type: 'string', description: 'Criar: "$nome" para usar nas operações seguintes do lote. mover/editar/apagar: id do item.' },
              papel: { type: 'string', description: 'lugar: id do papel (papeis_listar).' },
              pedido: { type: 'string', description: 'lugar: o que essa sessão vai fazer (vira post-it ligado).' },
              texto: { type: 'string', description: 'postit/editar: o texto.' },
              de: { type: 'string' },
              para: { type: 'string' },
              seta: { type: 'boolean', description: 'ligacao/linha: ponta de seta no fim (padrão: true na ligação, false na linha).' },
              x: NUM,
              y: NUM,
              w: NUM,
              h: NUM,
              x1: NUM,
              y1: NUM,
              x2: NUM,
              y2: NUM,
              cor: COLOR_SCHEMA,
              espessura: STROKE_SCHEMA,
            },
            required: ['op'],
            additionalProperties: false,
          },
        },
      },
      required: ['operacoes'],
      additionalProperties: false,
    },
  },
  {
    name: 'sessao_quem_sou',
    title: 'Quem sou eu no quadro',
    description: 'Seu lugar no quadro, papel, nome, projeto e onde você roda (este computador ou um lugar remoto).',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sessao_listar',
    title: 'Listar as sessões do quadro',
    description:
      'As sessões (lugares) do quadro do projeto: id, papel, nome, estado (trabalhando, parada, precisa do dono, não começou, fechada), se você pode mandar mensagem a ela (ligação com seta sua → dela) e quem a abriu.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sessao_abrir',
    title: 'Abrir uma sessão com papel',
    description:
      'Abre uma sessão nova com papel, no mesmo projeto e (salvo `onde`) no mesmo lugar onde você roda, com o pedido como primeira mensagem. Ela nasce no quadro ligada por uma seta sua → dela (então você pode mandar mensagens com sessao_enviar), e você é avisado quando ela terminar cada turno. Até 4 abertas por você ao mesmo tempo; a partir da 5ª o dono precisa permitir, e esta ferramenta espera a resposta dele.',
    inputSchema: {
      type: 'object',
      properties: {
        papel: { type: 'string', description: 'Id do papel (papeis_listar).' },
        pedido: { type: 'string', description: 'A primeira mensagem: o trabalho, completo e autossuficiente.' },
        nome: { type: 'string', description: 'Nome curto da aba (opcional).' },
        onde: { type: 'string', description: 'Onde ela roda (opcional): "aqui" (padrão, onde você roda), "este computador" ou o nome de um lugar remoto (ex.: a VPS; veja sessao_quem_sou).' },
      },
      required: ['papel', 'pedido'],
      additionalProperties: false,
    },
  },
  {
    name: 'sessao_enviar',
    title: 'Mandar mensagem a outra sessão',
    description:
      'Manda uma mensagem ao chat de outra sessão aberta. Só pela ligação: precisa existir uma seta do seu lugar para o dela. Se o dono está digitando lá ou há uma permissão aberta, a mensagem fica retida e entra sozinha depois.',
    inputSchema: {
      type: 'object',
      properties: { para: PLACE_REF, texto: { type: 'string', description: 'A mensagem.' } },
      required: ['para', 'texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'sessao_ver_tela',
    title: 'Ver o que outra sessão fez',
    description: 'O estado de uma sessão do quadro e o post-it do fim do último turno dela (o resumo do que fez).',
    inputSchema: { type: 'object', properties: { quem: PLACE_REF }, required: ['quem'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
] as const;

const BOARD_TOOL_NAMES: ReadonlySet<string> = new Set(BOARD_TOOLS.map((tool) => tool.name));

export function isBoardToolName(name: string): name is BoardToolName {
  return BOARD_TOOL_NAMES.has(name);
}

// ---------------------------------------------------------------------------------------------------------------
// Argument validation

export type ParsedBoardCall = { readonly ok: true; readonly call: BoardToolCall } | { readonly ok: false; readonly reason: string };

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORD;
}

function optionalText(value: unknown, field: string, max: number): string | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return { error: `"${field}" tem de ser texto.` };
  if (value.length > max) return { error: `"${field}" longo demais (máximo ${max} caracteres).` };
  return value;
}

function requiredText(value: unknown, field: string, max: number): string | { error: string } {
  const text = optionalText(value, field, max);
  if (typeof text !== 'string' || !text.trim()) return { error: typeof text === 'object' ? text.error : `"${field}" é obrigatório.` };
  return text;
}

function parseOp(raw: unknown, index: number): BoardOp | string {
  const where = `operação ${index + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return `${where}: tem de ser um objeto.`;
  const r = raw as Record<string, unknown>;
  const cor = r.cor;
  if (cor !== undefined && !(typeof cor === 'string' && COLOR_NAMES.includes(cor))) return `${where}: "cor" tem de ser ${COLOR_NAMES.join(', ')}.`;
  const espessura = r.espessura;
  if (espessura !== undefined && !(typeof espessura === 'string' && STROKE_NAMES.includes(espessura))) return `${where}: "espessura" tem de ser ${STROKE_NAMES.join(', ')}.`;
  if (r.seta !== undefined && typeof r.seta !== 'boolean') return `${where}: "seta" é true ou false.`;
  const hasXY = r.x !== undefined || r.y !== undefined;
  if (hasXY && !(isCoord(r.x) && isCoord(r.y))) return `${where}: "x" e "y" vão juntos, como números.`;
  const xy = hasXY ? { x: r.x as number, y: r.y as number } : {};
  const id = optionalText(r.id, 'id', 120);
  if (typeof id === 'object') return `${where}: ${id.error}`;
  const tempId = id ? { id } : {};
  const style = { ...(cor ? { cor: cor as BoardColor } : {}), ...(espessura ? { espessura: espessura as BoardStroke } : {}) };
  switch (r.op) {
    case 'lugar': {
      const papel = optionalText(r.papel, 'papel', 80);
      if (typeof papel === 'object') return `${where}: ${papel.error}`;
      const pedido = optionalText(r.pedido, 'pedido', MAX_POSTIT_CHARS);
      if (typeof pedido === 'object') return `${where}: ${pedido.error}`;
      return { op: 'lugar', ...tempId, ...(papel ? { papel } : {}), ...(pedido?.trim() ? { pedido } : {}), ...xy };
    }
    case 'postit': {
      const texto = requiredText(r.texto, 'texto', MAX_POSTIT_CHARS);
      if (typeof texto === 'object') return `${where}: ${texto.error}`;
      return { op: 'postit', ...tempId, texto, ...(cor ? { cor: cor as BoardColor } : {}), ...xy };
    }
    case 'ligacao': {
      if (typeof r.de !== 'string' || typeof r.para !== 'string' || !r.de || !r.para) return `${where}: "de" e "para" são obrigatórios.`;
      return { op: 'ligacao', ...tempId, de: r.de, para: r.para, ...(r.seta !== undefined ? { seta: r.seta as boolean } : {}) };
    }
    case 'retangulo':
    case 'elipse': {
      if (!isCoord(r.x) || !isCoord(r.y) || !isCoord(r.w) || !isCoord(r.h) || (r.w as number) === 0 || (r.h as number) === 0)
        return `${where}: "x", "y", "w" e "h" são números, com largura e altura diferentes de zero.`;
      return { op: r.op, ...tempId, x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number, ...style };
    }
    case 'linha': {
      if (!isCoord(r.x1) || !isCoord(r.y1) || !isCoord(r.x2) || !isCoord(r.y2)) return `${where}: "x1", "y1", "x2" e "y2" são números.`;
      return { op: 'linha', ...tempId, x1: r.x1 as number, y1: r.y1 as number, x2: r.x2 as number, y2: r.y2 as number, ...(r.seta !== undefined ? { seta: r.seta as boolean } : {}), ...style };
    }
    case 'mover': {
      if (!id) return `${where}: "id" é obrigatório.`;
      if (!hasXY) return `${where}: "x" e "y" são obrigatórios.`;
      return { op: 'mover', id, x: r.x as number, y: r.y as number };
    }
    case 'editar': {
      if (!id) return `${where}: "id" é obrigatório.`;
      const texto = optionalText(r.texto, 'texto', MAX_POSTIT_CHARS);
      if (typeof texto === 'object') return `${where}: ${texto.error}`;
      if (texto === undefined && !cor) return `${where}: diga "texto" ou "cor".`;
      return { op: 'editar', id, ...(texto !== undefined ? { texto } : {}), ...(cor ? { cor: cor as BoardColor } : {}) };
    }
    case 'apagar':
      if (!id) return `${where}: "id" é obrigatório.`;
      return { op: 'apagar', id };
    default:
      return `${where}: "op" desconhecida (${String(r.op)}).`;
  }
}

export function parseBoardToolCall(name: string, rawArgs: unknown): ParsedBoardCall {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'Argumentos têm de ser um objeto.' };
  switch (name) {
    case 'quadro_ler':
    case 'papeis_listar':
    case 'sessao_quem_sou':
    case 'sessao_listar':
      return { ok: true, call: { tool: name } };
    case 'quadro_aplicar': {
      const list = args.operacoes;
      if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: '"operacoes" tem de ser uma lista com ao menos uma operação.' };
      if (list.length > MAX_BOARD_OPS) return { ok: false, reason: `No máximo ${MAX_BOARD_OPS} operações por lote.` };
      const ops: BoardOp[] = [];
      for (const [index, raw] of list.entries()) {
        const op = parseOp(raw, index);
        if (typeof op === 'string') return { ok: false, reason: op };
        ops.push(op);
      }
      return { ok: true, call: { tool: 'quadro_aplicar', ops } };
    }
    case 'sessao_abrir': {
      const papel = requiredText(args.papel, 'papel', 80);
      if (typeof papel === 'object') return { ok: false, reason: papel.error };
      const pedido = requiredText(args.pedido, 'pedido', MAX_MESSAGE_CHARS);
      if (typeof pedido === 'object') return { ok: false, reason: pedido.error };
      const nome = optionalText(args.nome, 'nome', 60);
      if (typeof nome === 'object') return { ok: false, reason: nome.error };
      const onde = optionalText(args.onde, 'onde', 80);
      if (typeof onde === 'object') return { ok: false, reason: onde.error };
      return { ok: true, call: { tool: 'sessao_abrir', papel, pedido, ...(nome?.trim() ? { nome: nome.trim() } : {}), ...(onde?.trim() ? { onde: onde.trim() } : {}) } };
    }
    case 'sessao_enviar': {
      const para = requiredText(args.para, 'para', 120);
      if (typeof para === 'object') return { ok: false, reason: para.error };
      const texto = requiredText(args.texto, 'texto', MAX_MESSAGE_CHARS);
      if (typeof texto === 'object') return { ok: false, reason: texto.error };
      return { ok: true, call: { tool: 'sessao_enviar', para, texto } };
    }
    case 'sessao_ver_tela': {
      const quem = requiredText(args.quem, 'quem', 120);
      if (typeof quem === 'object') return { ok: false, reason: quem.error };
      return { ok: true, call: { tool: 'sessao_ver_tela', quem } };
    }
    default:
      return { ok: false, reason: `Ferramenta desconhecida: ${name}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership

/** What a session may move, edit or remove: what a session made, and the post-it written by a session. */
export function cardIsSessions(card: MindscapeCard): boolean {
  return card.kind === 'session-note' || card.by === 'session';
}

/** Arrow link `from → to` on the board (drawn by the owner or made by a session): it authorizes `sessao_enviar`. */
export function hasArrowLink(board: MindscapeBoard | undefined, from: string, to: string): boolean {
  return board?.links.some((link) => link.arrow && link.from === from && link.to === to) ?? false;
}

// ---------------------------------------------------------------------------------------------------------------
// Applying a batch (pure)

export interface BoardOpsContext {
  /** A fresh unique id (`crypto.randomUUID()` in the renderer). */
  newId(): string;
  readonly now: number;
  /** Role ids that exist (`<userData>/papeis/`). */
  readonly roleIds: ReadonlySet<string>;
  /** The caller's place, if it has one on this board ("seu" in a link). */
  readonly selfPlaceId?: string;
}

export type BoardOpsResult =
  | { readonly ok: true; readonly doc: MindscapeDoc; readonly ids: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: string };

/** Below a place: where its "pedido" post-it goes. */
const PEDIDO_OFFSET_Y = 140 + 24;

/**
 * The whole batch or nothing. Creates with `by: 'session'`; `mover`, `editar` and `apagar` refuse
 * anything that is not the sessions' (`cardIsSessions`, or a session drawing/link).
 */
export function applyBoardOps(doc: MindscapeDoc, projectPath: string, ops: readonly BoardOp[], ctx: BoardOpsContext): BoardOpsResult {
  let current = ensureBoard(doc, projectPath);
  const ids: Record<string, string> = {};
  const board = (): MindscapeBoard => current.boards[projectPath]!;

  const resolve = (ref: string): string | undefined => {
    if (ref === 'seu') return ctx.selfPlaceId;
    if (ref.startsWith('$')) return ids[ref];
    return ref;
  };
  const claimTemp = (tempId: string | undefined, realId: string, where: string): string | null => {
    if (!tempId) return null;
    if (!tempId.startsWith('$')) return `${where}: "id" de algo novo começa com "$" (ex.: "$dev").`;
    if (ids[tempId]) return `${where}: "${tempId}" já foi usado neste lote.`;
    ids[tempId] = realId;
    return null;
  };
  const newPostit = (text: string, color: OwnerCardColor, where: string, at?: { x: number; y: number }): string | { error: string } => {
    const id = ctx.newId();
    let next = addOwnerCard(current, projectPath, { id, createdAt: ctx.now, by: 'session' });
    if (next === current) return { error: `${where}: o post-it não entrou.` };
    next = editOwnerCard(next, projectPath, id, text);
    if (color !== 'none') next = setOwnerColor(next, projectPath, id, color);
    if (at) next = moveCard(next, projectPath, id, at.x, at.y);
    current = next;
    return id;
  };
  const notOwners = (where: string, ref: string): string => `${where}: "${ref}" é do dono; a sessão só mexe no que uma sessão criou.`;

  for (const [index, op] of ops.entries()) {
    const where = `operação ${index + 1} (${op.op})`;
    switch (op.op) {
      case 'lugar': {
        if (op.papel && !ctx.roleIds.has(op.papel)) return { ok: false, reason: `${where}: papel "${op.papel}" não existe (veja papeis_listar).` };
        const id = placeCardId(ctx.newId());
        let next = addPlace(current, projectPath, { id, by: 'session', ...(op.papel ? { roleId: op.papel } : {}) });
        if (next === current) return { ok: false, reason: `${where}: o lugar não entrou.` };
        if (op.x !== undefined && op.y !== undefined) next = moveCard(next, projectPath, id, op.x, op.y);
        current = next;
        const clash = claimTemp(op.id, id, where);
        if (clash) return { ok: false, reason: clash };
        if (op.pedido) {
          const place = board().cards[id]!;
          const note = newPostit(op.pedido, 'none', where, { x: place.x, y: place.y + PEDIDO_OFFSET_Y });
          if (typeof note !== 'string') return { ok: false, reason: note.error };
          current = addLink(current, projectPath, { id: ctx.newId(), from: id, to: note, arrow: false, by: 'session' });
        }
        break;
      }
      case 'postit': {
        const note = newPostit(op.texto, COLORS[op.cor ?? 'nenhuma'], where, op.x !== undefined && op.y !== undefined ? { x: op.x, y: op.y } : undefined);
        if (typeof note !== 'string') return { ok: false, reason: note.error };
        const clash = claimTemp(op.id, note, where);
        if (clash) return { ok: false, reason: clash };
        break;
      }
      case 'ligacao': {
        const from = resolve(op.de);
        const to = resolve(op.para);
        const cards = board().cards;
        if (!from || !cards[from]) return { ok: false, reason: `${where}: "${op.de}" não é um cartão do quadro.` };
        if (!to || !cards[to]) return { ok: false, reason: `${where}: "${op.para}" não é um cartão do quadro.` };
        const id = ctx.newId();
        const next = addLink(current, projectPath, { id, from, to, arrow: op.seta ?? true, by: 'session' });
        if (next === current) return { ok: false, reason: `${where}: esses dois cartões já estão ligados (ou é o mesmo cartão).` };
        current = next;
        const clash = claimTemp(op.id, id, where);
        if (clash) return { ok: false, reason: clash };
        break;
      }
      case 'retangulo':
      case 'elipse':
      case 'linha': {
        const id = ctx.newId();
        const color = COLORS[op.cor ?? 'nenhuma'];
        const stroke = STROKES[op.espessura ?? 'media'];
        const drawing: MindscapeDrawing =
          op.op === 'linha'
            ? { kind: 'line', id, color, stroke, arrow: op.seta ?? false, x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2, by: 'session' }
            : { kind: op.op === 'retangulo' ? 'rect' : 'ellipse', id, color, stroke, x: op.x, y: op.y, w: op.w, h: op.h, by: 'session' };
        const next = addDrawing(current, projectPath, drawing);
        if (next === current) return { ok: false, reason: `${where}: o desenho não entrou (medidas inválidas).` };
        current = next;
        const clash = claimTemp(op.id, id, where);
        if (clash) return { ok: false, reason: clash };
        break;
      }
      case 'mover': {
        const id = resolve(op.id);
        const card = id ? board().cards[id] : undefined;
        if (id && card) {
          if (!cardIsSessions(card)) return { ok: false, reason: notOwners(where, op.id) };
          current = moveCard(current, projectPath, id, op.x, op.y);
          break;
        }
        const drawing = id ? board().drawings.find((candidate) => candidate.id === id) : undefined;
        if (!drawing) return { ok: false, reason: `${where}: "${op.id}" não está no quadro.` };
        if (drawing.kind === 'image' || drawing.by !== 'session') return { ok: false, reason: notOwners(where, op.id) };
        const origin = drawing.kind === 'line' ? { x: drawing.x1, y: drawing.y1 } : drawing.kind === 'pencil' ? { x: drawing.points[0]!, y: drawing.points[1]! } : { x: drawing.x, y: drawing.y };
        const moved = translateDrawing(drawing, op.x - origin.x, op.y - origin.y);
        current = { ...current, boards: { ...current.boards, [projectPath]: { ...board(), drawings: board().drawings.map((candidate) => (candidate.id === drawing.id ? moved : candidate)) } } };
        break;
      }
      case 'editar': {
        const id = resolve(op.id);
        const card = id ? board().cards[id] : undefined;
        if (!id || !card) return { ok: false, reason: `${where}: "${op.id}" não é um cartão do quadro.` };
        if (card.kind !== 'owner') return { ok: false, reason: `${where}: só post-its criados por sessão têm texto e cor editáveis.` };
        if (card.by !== 'session') return { ok: false, reason: notOwners(where, op.id) };
        if (op.texto !== undefined) current = editOwnerCard(current, projectPath, id, op.texto);
        if (op.cor) current = setOwnerColor(current, projectPath, id, COLORS[op.cor]);
        break;
      }
      case 'apagar': {
        const id = resolve(op.id);
        if (!id) return { ok: false, reason: `${where}: "${op.id}" não está no quadro.` };
        const card = board().cards[id];
        if (card) {
          if (!cardIsSessions(card)) return { ok: false, reason: notOwners(where, op.id) };
          if (card.kind === 'session' && placeHasStarted(card)) return { ok: false, reason: `${where}: esse lugar já tem conversa; só sai pelo dono.` };
          current = removeItems(current, projectPath, { cards: [id], drawings: [] });
          break;
        }
        const drawing = board().drawings.find((candidate) => candidate.id === id);
        if (drawing) {
          if (drawing.kind === 'image' || drawing.by !== 'session') return { ok: false, reason: notOwners(where, op.id) };
          current = removeItems(current, projectPath, { cards: [], drawings: [id] });
          break;
        }
        const link = board().links.find((candidate) => candidate.id === id);
        if (link) {
          if (link.by !== 'session') return { ok: false, reason: notOwners(where, op.id) };
          current = removeLink(current, projectPath, id);
          break;
        }
        return { ok: false, reason: `${where}: "${op.id}" não está no quadro.` };
      }
    }
  }
  return { ok: true, doc: current, ids };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the board (`quadro_ler`)

export interface BoardReadContext {
  readonly selfPlaceId?: string;
  /** Live state of a conversation with an open tab (`trabalhando`, `parada`, `precisa do dono`…); absent = closed. */
  stateOf(sessionId: string): string | undefined;
  readonly roleNames: ReadonlyMap<string, string>;
}

const COLOR_BACK: Readonly<Record<string, BoardColor>> = { none: 'nenhuma', accent: 'azul', 'donel-accent': 'dourado' };

export function placeState(card: MindscapeCard & { kind: 'session' }, stateOf: (sessionId: string) => string | undefined): string {
  if (!placeHasStarted(card)) return 'nao-comecou';
  return (card.sessionId ? stateOf(card.sessionId) : undefined) ?? 'fechada';
}

export function describeBoard(doc: MindscapeDoc, projectPath: string, ctx: BoardReadContext): Record<string, unknown> {
  const board = doc.boards[projectPath];
  if (!board) return { projeto: projectPath, vazio: true, lugares: [], postits: [], desenhos: [], ligacoes: [] };
  const lugares: unknown[] = [];
  const postits: unknown[] = [];
  for (const card of Object.values(board.cards)) {
    const pos = { x: Math.round(card.x), y: Math.round(card.y) };
    if (card.kind === 'session') {
      lugares.push({
        id: card.id,
        ...(card.roleId ? { papel: card.roleId, papelNome: ctx.roleNames.get(card.roleId) ?? card.roleId } : {}),
        estado: placeState(card, ctx.stateOf),
        autor: card.by === 'session' ? 'sessao' : 'dono',
        ...(card.id === ctx.selfPlaceId ? { voce: true } : {}),
        ...pos,
      });
    } else if (card.kind === 'session-note') {
      const place = placeOfSession(board, card.sessionId);
      postits.push({ id: card.id, autor: 'sessao', escritoPelaSessao: place?.id ?? card.sessionId, texto: card.text, ...pos });
    } else {
      postits.push({ id: card.id, autor: card.by === 'session' ? 'sessao' : 'dono', texto: card.text, cor: COLOR_BACK[card.color] ?? 'nenhuma', ...pos });
    }
  }
  const desenhos = board.drawings.map((drawing) => {
    const autor = drawing.kind !== 'image' && drawing.by === 'session' ? 'sessao' : 'dono';
    switch (drawing.kind) {
      case 'line':
        return { id: drawing.id, tipo: drawing.arrow ? 'seta' : 'linha', autor, x1: drawing.x1, y1: drawing.y1, x2: drawing.x2, y2: drawing.y2 };
      case 'pencil':
        return { id: drawing.id, tipo: 'rabisco', autor, pontos: drawing.points.length / 2 };
      default:
        return { id: drawing.id, tipo: drawing.kind === 'rect' ? 'retangulo' : drawing.kind === 'ellipse' ? 'elipse' : 'print', autor, x: drawing.x, y: drawing.y, w: drawing.w, h: drawing.h };
    }
  });
  const ligacoes = board.links.map((link) => ({ id: link.id, de: link.from, para: link.to, seta: link.arrow, autor: link.by === 'session' ? 'sessao' : 'dono' }));
  return { projeto: projectPath, ...(ctx.selfPlaceId ? { seuLugar: ctx.selfPlaceId } : {}), lugares, postits, desenhos, ligacoes };
}
