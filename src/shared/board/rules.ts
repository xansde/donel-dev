// Quadro de tarefas (t-1e354d15, dono 16/11: "o ledger é um quadro de tarefas, não um registro"). The task board lives
// in the owner's personal Supabase, schema `board` (docs/board/schema.sql); the andamento of a session is its card
// moving between stages. It is NOT the Oráculo (the owner's decision desk, `src/shared/ledger/`): nothing here reads or
// writes it. The database enforces these same rules in `board.move_card` (the service key bypasses RLS, so a client
// cannot be trusted); this file is the copy the daemon and the cron use to refuse early, and what the tests pin.

/** The board's stages, in order. `column` is a reserved word in SQL, hence `stage`. */
export const STAGES = ['inbox', 'todo', 'doing', 'blocked', 'waiting_owner', 'done'] as const;
export type Stage = (typeof STAGES)[number];

/** What the owner reads on screen. */
export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  inbox: 'Entrada',
  todo: 'A fazer',
  doing: 'Fazendo',
  blocked: 'Travado',
  waiting_owner: 'Esperando você',
  done: 'Feito',
};

/**
 * The only reasons a card goes to "Esperando você" (dono, 16/11): main or production of a repo of his, a new
 * credential, money, or speaking in his name when the Laya marks it as needing him. Only the board's Líder moves it.
 */
export const OWNER_REASONS = ['main_prod', 'new_credential', 'money', 'laya'] as const;
export type OwnerReason = (typeof OWNER_REASONS)[number];

/** A card parked on purpose says why, where to look and until when. */
export interface Justification {
  readonly text: string;
  readonly link: string;
  /** Epoch ms. */
  readonly due: number;
}

export interface BoardCard {
  readonly id: string;
  readonly projectId: string;
  readonly stage: Stage;
  /** Epoch ms of the last stage change. */
  readonly stageSince: number;
  /** The place doing the card, when there is one. */
  readonly placeId?: string | null;
  readonly justification?: Justification | null;
  readonly version: number;
}

export interface BoardLane {
  readonly projectId: string;
  /** The board's Líder (the one the owner put there), or null when the lane has none. */
  readonly leaderPlace: string | null;
}

export interface MoveRequest {
  readonly card: BoardCard;
  readonly to: Stage;
  /** Who moves: a place id, `jobu`, `servico:<nome>`. Never taken from a session's own argument. */
  readonly actor: string;
  readonly lane: BoardLane;
  readonly now: number;
  /** Compare-and-swap: the version the caller read. */
  readonly expectedVersion: number;
  readonly justification?: Justification;
  readonly ownerReason?: OwnerReason;
  readonly doneSummary?: string;
}

export type MoveCheck = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** After this long with no turn, a card in "Fazendo" with no valid justification is stalled. */
export const STALL_MS = 30 * 60 * 1000;

function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

function isOwnerReason(value: unknown): value is OwnerReason {
  return typeof value === 'string' && (OWNER_REASONS as readonly string[]).includes(value);
}

/** Text, an http(s) link and a deadline still ahead. */
export function isValidJustification(j: Justification | null | undefined, now: number): j is Justification {
  if (!j) return false;
  if (!j.text.trim()) return false;
  if (!/^https?:\/\/\S+$/.test(j.link.trim())) return false;
  return Number.isFinite(j.due) && j.due > now;
}

const refuse = (error: string): MoveCheck => ({ ok: false, error });

/** Whether a move may happen; the error is what the session reads. Mirrors `board.move_card`. */
export function checkMove(req: MoveRequest): MoveCheck {
  if (!isStage(req.to)) return refuse(`coluna desconhecida: ${String(req.to)}`);
  if (req.card.version !== req.expectedVersion) {
    return refuse('o cartão mudou desde a sua leitura; leia de novo antes de mover');
  }
  if (req.to === 'waiting_owner') {
    if (!req.lane.leaderPlace || req.actor !== req.lane.leaderPlace) {
      return refuse('só o Líder do quadro põe um cartão em "Esperando você"; peça a ele');
    }
    if (!isOwnerReason(req.ownerReason)) {
      return refuse(`"Esperando você" só por: ${OWNER_REASONS.join(', ')}`);
    }
  }
  if (req.to === 'blocked' && !isValidJustification(req.justification, req.now)) {
    return refuse('"Travado" exige justificativa: o motivo, o link onde a resposta vai chegar e um prazo no futuro');
  }
  if (req.justification && !isValidJustification(req.justification, req.now)) {
    return refuse('justificativa incompleta: motivo, link http(s) e prazo no futuro');
  }
  if (req.to === 'done' && !req.doneSummary?.trim()) {
    return refuse('"Feito" exige o resumo do que foi entregue');
  }
  return { ok: true };
}

/**
 * The vigia's one question: a card in "Fazendo" whose session has had no turn for STALL_MS and that carries no
 * justification at all. A card with one, even expired, belongs to the justification cron (it charges the deadline,
 * then tells the Líder), so the two never wake the same session. Every other stage is left alone ("Travado" is the
 * cron's, "Esperando você" the Líder's and the owner's).
 */
export function isStalled(card: BoardCard, lastTurnAt: number, now: number): boolean {
  if (card.stage !== 'doing') return false;
  if (card.justification) return false;
  return now - Math.max(lastTurnAt, card.stageSince) >= STALL_MS;
}
