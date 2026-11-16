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
  /**
   * The actor is the board's Líder the OWNER put there, as the board's picture shows it now (`isBoardOrchestrator`):
   * a new Líder has the power at once and one that lost the role loses it. Sent to the database as `p_as_leader`.
   */
  readonly actorIsLeader: boolean;
  readonly now: number;
  /** Compare-and-swap: the version the caller read. */
  readonly expectedVersion: number;
  /** A justification the caller sends now. */
  readonly justification?: Justification;
  /** The one the card already has, which still counts for a note edit in the same stage. */
  readonly keptJustification?: Justification;
  readonly ownerReason?: OwnerReason;
  readonly doneSummary?: string;
  /** Only the Líder gives a card to another place. */
  readonly assignPlace?: string;
  /** Only the Líder changes the front. */
  readonly front?: string;
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

/** Something besides blanks (space, tab, newline): `board.has_text` in SQL. */
export const hasText = (value: string | null | undefined): boolean => /\S/.test(value ?? '');

/** Text, an http(s) link (as sent: no trimming, as the database) and a deadline still ahead. */
export function isValidJustification(j: Justification | null | undefined, now: number): j is Justification {
  if (!j) return false;
  if (!hasText(j.text)) return false;
  if (!/^https?:\/\/\S+$/.test(j.link)) return false;
  return Number.isFinite(j.due) && j.due > now;
}

const refuse = (error: string): MoveCheck => ({ ok: false, error });

/**
 * Whether a move may happen; the error is what the session reads. Mirrors `board.move_card`, including who moves
 * (design §2): the Líder anything; "Entrada", "A fazer", "Esperando você", giving a place and the front are his only;
 * anyone else moves only a card that is theirs, or takes an unowned one from "A fazer" to "Fazendo".
 */
export function checkMove(req: MoveRequest): MoveCheck {
  if (!isStage(req.to)) return refuse(`coluna desconhecida: ${String(req.to)}`);
  if (!hasText(req.actor)) return refuse('quem move é obrigatório (actor)');
  if (req.card.version !== req.expectedVersion) {
    return refuse('o cartão mudou desde a sua leitura; leia de novo antes de mover');
  }
  const same = req.to === req.card.stage;
  if (!req.actorIsLeader) {
    if (req.to === 'waiting_owner') return refuse('só o Líder do quadro põe um cartão em "Esperando você"; peça a ele');
    if (req.to === 'inbox' || req.to === 'todo') return refuse('só o Líder do quadro tria (Entrada e A fazer); peça a ele');
    if (req.assignPlace) return refuse('só o Líder do quadro dá o cartão a outro lugar');
    if (req.front !== undefined) return refuse('só o Líder do quadro muda a frente do cartão');
    if (req.card.placeId && req.card.placeId !== req.actor) return refuse(`o cartão é de ${req.card.placeId}: só ele ou o Líder do quadro o move`);
    if (!req.card.placeId && !(req.to === 'doing' && req.card.stage === 'todo')) {
      return refuse('cartão sem dono: pegue-o de "A fazer" para "Fazendo", ou peça ao Líder');
    }
  }
  if (req.to === 'waiting_owner' && !isOwnerReason(req.ownerReason)) {
    return refuse(`"Esperando você" só por: ${OWNER_REASONS.join(', ')}`);
  }
  const justification = req.justification ?? (same ? req.keptJustification : undefined);
  if (req.to === 'blocked' && !isValidJustification(justification, req.now)) {
    return refuse('"Travado" exige justificativa: o motivo, o link onde a resposta vai chegar e um prazo no futuro');
  }
  if (req.to === 'done' && !hasText(req.doneSummary)) {
    return refuse('"Feito" exige o resumo do que foi entregue');
  }
  if (req.justification && !isValidJustification(req.justification, req.now)) {
    return refuse('justificativa incompleta: motivo, link http(s) e prazo no futuro');
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
