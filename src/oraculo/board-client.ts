// Quadro de tarefas (t-1e354d15) — the daemon's client of the task board in the owner's Supabase, schema `board`
// (docs/board/schema.sql), over PostgREST. Off unless `<home>/.donel/board/supabase.json` says where it is:
// `{ "url": "https://<ref>.supabase.co", "serviceKeyFile": "<path of a 600 file with the service key>" }`. Nothing
// here is hardcoded (the repo goes public): no URL, no key. The key is read at each call and never logged, never put in
// an error message.
//
// Writes go only through the RPCs, where the rules live; reads go to the tables and views.

import { readFileSync } from 'node:fs';
import type { BoardLane, Stage } from '../shared/board/rules';

/** A row of `board.cards`, as PostgREST gives it. */
export interface CardRow {
  readonly id: string;
  readonly project_id: string;
  readonly front: string | null;
  readonly title: string;
  readonly owner_request: string;
  readonly criterion: string | null;
  readonly requested_by: string;
  readonly stage: Stage;
  readonly stage_since: string;
  readonly note: string | null;
  readonly place_id: string | null;
  readonly session_id: string | null;
  readonly justification: string | null;
  readonly justification_link: string | null;
  readonly justification_due: string | null;
  readonly owner_reason: string | null;
  readonly done_summary: string | null;
  readonly version: number;
}

export interface CreateCardArgs {
  readonly p_project_id: string;
  readonly p_title: string;
  readonly p_owner_request: string;
  readonly p_criterion?: string;
  readonly p_front?: string;
  readonly p_requested_by: string;
  readonly p_actor: string;
  readonly p_stage?: 'inbox' | 'todo';
  readonly p_place_id?: string;
  readonly p_session_id?: string;
}

export interface MoveCardArgs {
  readonly p_card_id: string;
  readonly p_to: Stage;
  readonly p_actor: string;
  readonly p_expected_version: number;
  readonly p_note?: string;
  readonly p_justification?: string;
  readonly p_justification_link?: string;
  readonly p_justification_due?: string;
  readonly p_owner_reason?: string;
  readonly p_done_summary?: string;
  readonly p_place_id?: string;
  readonly p_session_id?: string;
}

/** What the card tools need from the board; the tests give a fake. */
export interface BoardStore {
  /** The project id of a folder (aliases of `board.projects`, worktree suffix removed); 'sem-projeto' when unknown. */
  projectOf(projectPath: string): Promise<string>;
  getCard(id: string): Promise<CardRow | null>;
  getLane(projectId: string): Promise<BoardLane>;
  listCards(projectId: string, options: { readonly stage?: Stage; readonly includeDone?: boolean }): Promise<readonly CardRow[]>;
  createCard(args: CreateCardArgs): Promise<CardRow>;
  moveCard(args: MoveCardArgs): Promise<CardRow>;
  touchLane(projectId: string, leaderPlace: string, leaderSession: string | undefined): Promise<void>;
}

export interface BoardConfig {
  readonly url: string;
  readonly serviceKeyFile: string;
}

/** The config file, or null (the board is off) when it is missing or malformed. */
export function readBoardConfig(file: string): BoardConfig | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof raw.url !== 'string' || !/^https:\/\/[^/\s]+$/.test(raw.url.replace(/\/+$/, ''))) return null;
    if (typeof raw.serviceKeyFile !== 'string' || !raw.serviceKeyFile) return null;
    return { url: raw.url.replace(/\/+$/, ''), serviceKeyFile: raw.serviceKeyFile };
  } catch {
    return null;
  }
}

/** A worktree folder is its project: `<repo>/.claude/worktrees/<name>` → `<repo>`; separators as the PC writes them too. */
export function projectFolderOf(projectPath: string): string {
  return projectPath.replace(/[\\/]+\.claude[\\/]+worktrees[\\/]+[^\\/]+[\\/]*$/, '').replace(/[\\/]+$/, '');
}

/** A Postgres error from PostgREST, as the session reads it (the rule's own sentence). */
export class BoardError extends Error {}

type Fetch = typeof fetch;

export function createBoardClient(config: BoardConfig, doFetch: Fetch = fetch): BoardStore {
  const key = (): string => readFileSync(config.serviceKeyFile, 'utf8').trim();

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const secret = key();
    const headers: Record<string, string> = { apikey: secret, Authorization: `Bearer ${secret}`, 'Accept-Profile': 'board', Accept: 'application/json' };
    if (method === 'POST') {
      headers['Content-Profile'] = 'board';
      headers['Content-Type'] = 'application/json';
    }
    let res: Response;
    try {
      res = await doFetch(`${config.url}/rest/v1/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new BoardError(`o quadro de tarefas não respondeu (${error instanceof Error ? error.name : 'erro'}); tente de novo`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = `o quadro de tarefas recusou (HTTP ${res.status})`;
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === 'string' && parsed.message) message = parsed.message;
      } catch {
        // keep the status line
      }
      throw new BoardError(message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  const rpc = <T>(fn: string, args: object): Promise<T> => call<T>('POST', `rpc/${fn}`, args);
  const q = encodeURIComponent;

  return {
    async projectOf(projectPath) {
      const folder = projectFolderOf(projectPath);
      const literal = `{"${folder.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"}`;
      const rows = await call<{ id: string }[]>('GET', `projects?select=id&aliases=cs.${q(literal)}&limit=1`);
      return rows[0]?.id ?? 'sem-projeto';
    },
    async getCard(id) {
      const rows = await call<CardRow[]>('GET', `cards?id=eq.${q(id)}&limit=1`);
      return rows[0] ?? null;
    },
    async getLane(projectId) {
      const rows = await call<{ leader_place: string | null }[]>('GET', `lanes?project_id=eq.${q(projectId)}&select=leader_place&limit=1`);
      return { projectId, leaderPlace: rows[0]?.leader_place ?? null };
    },
    async listCards(projectId, options) {
      const filters = [`project_id=eq.${q(projectId)}`];
      if (options.stage) filters.push(`stage=eq.${q(options.stage)}`);
      else if (!options.includeDone) filters.push('stage=neq.done');
      return call<CardRow[]>('GET', `project_cards?${filters.join('&')}&limit=200`);
    },
    createCard: (args) => rpc<CardRow>('create_card', args),
    moveCard: (args) => rpc<CardRow>('move_card', args),
    async touchLane(projectId, leaderPlace, leaderSession) {
      await rpc('touch_lane', { p_project_id: projectId, p_leader_place: leaderPlace, ...(leaderSession ? { p_leader_session: leaderSession } : {}) });
    },
  };
}
