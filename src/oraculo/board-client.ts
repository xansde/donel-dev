// Quadro de tarefas (t-1e354d15) — the daemon's client of the task board in the owner's Supabase, schema `board`
// (docs/board/schema.sql), over PostgREST. Off unless `<home>/.donel/board/supabase.json` says where it is:
// `{ "url": "https://<ref>.supabase.co", "serviceKeyFile": "<path of a 600 file with the service key>" }`. Nothing
// here is hardcoded (the repo goes public): no URL, no key. The key is read at each call and never logged, never put in
// an error message.
//
// Writes go only through the RPCs, where the rules live; reads go to the tables and views.

import { readFileSync } from 'node:fs';
import type { Stage } from '../shared/board/rules';

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
  readonly woken_at?: string | null;
  readonly charged_at?: string | null;
  readonly charge_count?: number;
  readonly leader_noticed_at?: string | null;
  readonly justified_at?: string | null;
  /** The card on the owner's desk (the Oráculo task the seed imported it from), when there is one. */
  readonly oraculo_id?: string | null;
}

export interface LaneRow {
  readonly project_id: string;
  readonly leader_place: string | null;
  readonly leader_session: string | null;
  readonly leader_seen_at: string | null;
}

export interface LeaderRequestRow {
  readonly id: number;
  readonly project_id: string;
  readonly actor: string;
  readonly created_at: string;
}

/** What the cron on the VPS needs (src/board-cron/main.ts). */
export interface BoardCronStore {
  /** Cards in Fazendo or Travado of the projects that run on `host`: the only ones this machine's cron looks at. */
  parkedOrDoing(host: string): Promise<readonly CardRow[]>;
  lanes(host: string): Promise<readonly LaneRow[]>;
  pendingLeaderRequests(host: string): Promise<readonly LeaderRequestRow[]>;
  markCron(cardId: string, kind: 'woken' | 'charged' | 'leader'): Promise<void>;
  /** The vigia's note on a card in Fazendo (board.vigia_note); false when the card is no longer there. */
  vigiaNote(cardId: string, note: string): Promise<boolean>;
  resolveLeaderRequest(id: number, status: 'done' | 'failed', reason: string): Promise<void>;
  touchLane(projectId: string, leaderPlace: string, leaderSession: string | undefined, force?: boolean): Promise<void>;
  overview(): Promise<readonly import('../shared/board/page').OverviewRow[]>;
  /** Every card not done, plus the ones done in the last 3 days, for the page. */
  pageCards(): Promise<readonly import('../shared/board/page').PageCard[]>;
}

export interface CreateCardArgs {
  readonly p_project_id: string;
  readonly p_title: string;
  readonly p_owner_request: string;
  readonly p_criterion?: string;
  readonly p_front?: string;
  readonly p_requested_by: string;
  readonly p_actor: string;
  readonly p_client_ref?: string;
  readonly p_stage?: 'inbox' | 'todo';
  readonly p_place_id?: string;
  readonly p_session_id?: string;
  /** `AAAA-MM-DD`. */
  readonly p_due?: string;
  readonly p_risk?: 'baixo' | 'alto';
  readonly p_oraculo_id?: string;
  /** The board's picture shows the caller as the Líder the owner put there (see docs/board/schema.sql). */
  readonly p_as_leader?: boolean;
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
  readonly p_front?: string;
  readonly p_as_leader?: boolean;
}

/** What the card tools need from the board; the tests give a fake. */
export interface BoardStore {
  /** The project id of a folder (aliases of `board.projects`, worktree suffix removed); 'sem-projeto' when unknown. */
  projectOf(projectPath: string): Promise<string>;
  getCard(id: string): Promise<CardRow | null>;
  listCards(projectId: string, options: { readonly stage?: Stage; readonly includeDone?: boolean }): Promise<readonly CardRow[]>;
  /** The card a create_card with this client_ref made, if any. */
  cardByClientRef(ref: string): Promise<CardRow | null>;
  createCard(args: CreateCardArgs): Promise<CardRow>;
  moveCard(args: MoveCardArgs): Promise<CardRow>;
  /** `force`: the Líder the picture shows takes the lane at once (only the daemon passes it). */
  touchLane(projectId: string, leaderPlace: string, leaderSession: string | undefined, force?: boolean): Promise<void>;
}

export interface BoardConfig {
  readonly url: string;
  readonly serviceKeyFile: string;
}

/** The config file, or null (the board is off) when it is missing or malformed. */
export function readBoardConfig(file: string): BoardConfig | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    // https, or plain http only on this machine (the end-to-end test's local PostgREST): the key never leaves in clear.
    if (typeof raw.url !== 'string' || !/^(https:\/\/[^/\s]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(raw.url.replace(/\/+$/, ''))) return null;
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

export function createBoardClient(config: BoardConfig, doFetch: Fetch = fetch): BoardStore & BoardCronStore {
  // Read at each call; an unreadable file says so without its path (someone might paste the key in the path field).
  const key = (): string => {
    try {
      return readFileSync(config.serviceKeyFile, 'utf8').trim();
    } catch {
      throw new BoardError('a chave do quadro de tarefas não pôde ser lida (serviceKeyFile em ~/.donel/board/supabase.json)');
    }
  };

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const secret = key();
    const headers: Record<string, string> = { apikey: secret, Authorization: `Bearer ${secret}`, 'Accept-Profile': 'board', Accept: 'application/json' };
    if (method === 'POST') {
      headers['Content-Profile'] = 'board';
      headers['Content-Type'] = 'application/json';
    }
    let res: Response | null = null;
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await doFetch(`${config.url}/rest/v1/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        // A kept-alive socket the server already closed: one retry on a fresh one, for reads only. A POST is not
        // retried, since it may have reached the database (mark_cron 'charged' would count twice); its caller sees
        // the error (the cron types the notice again next round rather than count twice).
        const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
        if (attempt === 0 && method === 'GET' && (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET')) continue;
        throw new BoardError(`o quadro de tarefas não respondeu (${error instanceof Error ? error.name : 'erro'}); tente de novo`);
      }
    }
    let text: string;
    try {
      text = await res.text();
    } catch (error) {
      throw new BoardError(`o quadro de tarefas não terminou de responder (${error instanceof Error ? error.name : 'erro'}); tente de novo`);
    }
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
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new BoardError('o quadro de tarefas respondeu algo que não é JSON (HTTP ' + res.status + ')');
    }
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
    async listCards(projectId, options) {
      const filters = [`project_id=eq.${q(projectId)}`];
      if (options.stage) filters.push(`stage=eq.${q(options.stage)}`);
      else if (!options.includeDone) filters.push('stage=neq.done');
      return call<CardRow[]>('GET', `project_cards?${filters.join('&')}&limit=200`);
    },
    async cardByClientRef(ref) {
      const rows = await call<CardRow[]>('GET', `cards?client_ref=eq.${q(ref)}&limit=1`);
      return rows[0] ?? null;
    },
    createCard: (args) => rpc<CardRow>('create_card', args),
    moveCard: (args) => rpc<CardRow>('move_card', args),
    async touchLane(projectId, leaderPlace, leaderSession, force) {
      await rpc('touch_lane', { p_project_id: projectId, p_leader_place: leaderPlace, ...(leaderSession ? { p_leader_session: leaderSession } : {}), ...(force ? { p_force: true } : {}) });
    },
    // `projects!inner(host)` + `projects.host=eq.<host>`: only the projects that run on this machine (projects.host)
    parkedOrDoing: (host) => call<CardRow[]>('GET', `cards?select=*,projects!inner(host)&stage=in.(doing,blocked)&projects.host=eq.${q(host)}&limit=1000`),
    lanes: (host) => call<LaneRow[]>('GET', `lanes?select=project_id,leader_place,leader_session,leader_seen_at,projects!inner(host)&projects.host=eq.${q(host)}`),
    pendingLeaderRequests: (host) =>
      call<LeaderRequestRow[]>('GET', `leader_requests?select=id,project_id,actor,created_at,projects!inner(host)&status=eq.pending&projects.host=eq.${q(host)}&order=id`),
    async markCron(cardId, kind) {
      await rpc('mark_cron', { p_card_id: cardId, p_kind: kind });
    },
    vigiaNote: (cardId, note) => rpc<boolean>('vigia_note', { p_card_id: cardId, p_note: note }),
    async resolveLeaderRequest(id, status, reason) {
      await rpc('resolve_leader_request', { p_id: id, p_status: status, p_reason: reason });
    },
    overview: () => call('GET', 'overview?order=project_id'),
    pageCards: () =>
      call('GET', `project_cards?or=(stage.neq.done,updated_at.gt.${q(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())})&limit=2000`),
  };
}
