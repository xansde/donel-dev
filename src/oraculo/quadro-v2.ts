// t-f091595a — the task board (docs/design/quadro-de-tarefas-sqlite.md) read by the phone: `GET /api/v2/quadro` (one
// line per project) and `GET /api/v2/quadro/projeto?id=<slug>` (the project's cards, groupable by front). Read only:
// the SQLite is opened `readOnly` at each request (never created, no schema, no chmod: that is `createBoardSqlite`, the
// writers'); the Supabase board, when it is the one configured, only gets the GETs of its two views. The config is the
// daemon's (`chooseBoard`), read at each call: writing `sqlite.json` turns the phone's board on without a restart.
//
// Contract for the app: ~/seazone/_scratch/t-f091595a/contrato-quadro.md.

import { join } from 'node:path';
import type { OverviewRow, PageCard } from '../shared/board/page';
import { STAGES, STAGE_LABELS, type Stage } from '../shared/board/rules';
import { createBoardClient } from './board-client';
import { BOARD_SQLITE_CONFIG, chooseBoard, openBoardSqliteReadOnly, type BoardReadView } from './board-sqlite';

export interface QuadroPaths {
  readonly sqliteConfig: string;
  readonly supabaseConfig: string;
}

/** Where the daemon reads the board's config (the same env overrides as entregador.ts). */
export function quadroPathsOf(home: string, env: Readonly<Record<string, string | undefined>> = process.env): QuadroPaths {
  return {
    sqliteConfig: env.DONEL_BOARD_SQLITE_CONFIG || join(home, '.donel', 'board', BOARD_SQLITE_CONFIG),
    supabaseConfig: env.DONEL_BOARD_CONFIG || join(home, '.donel', 'board', 'supabase.json'),
  };
}

/** A card as the view gives it (`c.*`): `PageCard` plus what the phone shows. */
export type QuadroCardRow = PageCard & {
  readonly oraculo_id?: string | null;
  readonly owner_request?: string;
  readonly criterion?: string | null;
  readonly requested_by?: string;
  readonly owner_reason?: string | null;
  readonly done_summary?: string | null;
  readonly risk?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
};

export type QuadroOverviewRow = OverviewRow & { readonly oldest_parked_since?: string | null };

export type QuadroLeitura =
  | { readonly kind: 'ok'; readonly overview: readonly QuadroOverviewRow[]; readonly cards: readonly QuadroCardRow[] }
  | { readonly kind: 'desligado' }
  | { readonly kind: 'invalido' }
  | { readonly kind: 'indisponivel' };

export function createQuadroLeitor(
  paths: QuadroPaths,
  options: { readonly home?: string; readonly now?: () => number; readonly log?: (line: string) => void } = {},
): () => Promise<QuadroLeitura> {
  return async () => {
    const choice = chooseBoard(paths, options.home);
    if (choice.kind === 'off') return { kind: 'desligado' };
    if (choice.kind === 'invalid') return { kind: 'invalido' };
    let view: BoardReadView | null = null;
    try {
      view = choice.kind === 'sqlite' ? openBoardSqliteReadOnly(choice.file, options.now ? { now: options.now } : {}) : createBoardClient(choice.config);
      const [overview, cards] = await Promise.all([view.overview(), view.pageCards()]);
      return { kind: 'ok', overview, cards };
    } catch (error) {
      options.log?.(`[quadro-v2] leitura do quadro falhou: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: 'indisponivel' };
    } finally {
      view?.close?.();
    }
  };
}

export const COLUNAS = STAGES.map((id) => ({ id, nome: STAGE_LABELS[id] }));

const OPEN: readonly Stage[] = ['inbox', 'todo', 'doing', 'blocked', 'waiting_owner'];
const isOverdue = (due: string | null | undefined, stage: Stage, today: string): boolean => !!due && stage !== 'done' && due < today;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function linhaDoProjeto(row: QuadroOverviewRow) {
  const contagem = Object.fromEntries(STAGES.map((stage) => [stage, Number(row[stage]) || 0])) as Record<Stage, number>;
  const vencidos = Number(row.overdue) || 0;
  const atencao = [
    ...(contagem.waiting_owner ? [`${contagem.waiting_owner} esperando você`] : []),
    ...(contagem.blocked ? [plural(contagem.blocked, 'travado', 'travados')] : []),
    ...(vencidos ? [`${vencidos} com prazo vencido`] : []),
    ...(contagem.inbox ? [`${contagem.inbox} na entrada`] : []),
  ];
  return {
    id: row.project_id,
    nome: row.name,
    host: row.host,
    contagem,
    abertos: OPEN.reduce((sum, stage) => sum + contagem[stage], 0),
    vencidos,
    parado_desde: row.oldest_parked_since ?? null,
    ultima_mudanca: row.last_change ?? null,
    atencao,
    pede_atencao: atencao.length > 0,
  };
}

/** `GET quadro`: the projects that have a card, by id. */
export function visaoGeral(overview: readonly QuadroOverviewRow[], now: number) {
  return {
    colunas: COLUNAS,
    projetos: overview.filter((row) => STAGES.some((stage) => Number(row[stage]) > 0)).map(linhaDoProjeto),
    gerado_em: new Date(now).toISOString(),
  };
}

/** `GET quadro/projeto`: null = no such project. `nomeDoLugar` gives the place's name, when known. */
export function projetoDoQuadro(
  id: string,
  leitura: { readonly overview: readonly QuadroOverviewRow[]; readonly cards: readonly QuadroCardRow[] },
  now: number,
  nomeDoLugar: (placeId: string) => string | undefined = () => undefined,
) {
  const row = leitura.overview.find((candidate) => candidate.project_id === id);
  if (!row) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  // The view's order (front, then nulls last; stage; position) is kept: a front's cards come together.
  const cartoes = leitura.cards
    .filter((card) => card.project_id === id)
    .map((card) => ({
      id: card.id,
      oraculo_id: card.oraculo_id ?? null,
      titulo: card.title,
      frente: card.front,
      coluna: card.stage,
      coluna_nome: STAGE_LABELS[card.stage] ?? card.stage,
      desde: card.stage_since,
      dono: card.place_id,
      dono_nome: card.place_id ? (nomeDoLugar(card.place_id) ?? null) : null,
      prazo: card.due,
      vencido: isOverdue(card.due, card.stage, today),
      risco: card.risk ?? 'baixo',
      nota: card.note,
      justificativa: card.justification ? { texto: card.justification, link: card.justification_link, ate: card.justification_due } : null,
      motivo_dono: card.owner_reason ?? null,
      resumo: card.done_summary ?? null,
      pedido: card.owner_request ?? null,
      criterio: card.criterion ?? null,
      quem_pediu: card.requested_by ?? null,
      criado_em: card.created_at ?? null,
      atualizado_em: card.updated_at ?? null,
    }));
  const frentes: Array<{ frente: string | null; total: number; abertos: number }> = [];
  for (const card of cartoes) {
    let group = frentes.find((candidate) => candidate.frente === card.frente);
    if (!group) frentes.push((group = { frente: card.frente, total: 0, abertos: 0 }));
    group.total += 1;
    if (card.coluna !== 'done') group.abertos += 1;
  }
  return { projeto: linhaDoProjeto(row), colunas: COLUNAS, frentes, cartoes, gerado_em: new Date(now).toISOString() };
}
