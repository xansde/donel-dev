// Quadro de tarefas (t-1e354d15), PR 3 — the pure decisions of the board's cron on the VPS (src/board-cron/main.ts runs
// them every 15 min, the leader mode every minute). No fs, no tmux, no network here: the runner reads the cards, the
// sessions and the links, and does what these functions return.
//
// - justify: a card with a justification (Travado, or Fazendo parked on purpose). A response on its link after the
//   reference time wakes its session; a deadline gone charges it, every CHARGE_EVERY_MS, CHARGE_MAX times; after that
//   the lane's Líder hears it once.
// - vigia: only a card in Fazendo with NO justification whose session had no turn for STALL_MS (`isStalled`). A live
//   session is woken (at most VIGIA_MAX_PER_DAY in 24 h, with a growing pause); a closed one, or one past the cap,
//   goes to the lane's Líder, who reopens it. Every other stage is left alone.
// - leader: the PC asked for a lane's Líder (board.leader_requests): wake it if its session is alive, else say why not.

import { isStalled, isValidJustification, STAGE_LABELS, type BoardCard } from './rules';

export const CHARGE_EVERY_MS = 2 * 60 * 60 * 1000;
export const CHARGE_MAX = 3;
export const VIGIA_MAX_PER_DAY = 2;
/** First pause between two wakes of the same card; it doubles each time. */
export const VIGIA_PAUSE_MS = 15 * 60 * 1000;
export const LEADER_NOTICE_EVERY_MS = 2 * 60 * 60 * 1000;
export const LABEL = '[quadro de tarefas · VPS]';

/** A card as the cron reads it: the rule fields plus who to wake and what was already done. */
export interface CronCard extends BoardCard {
  readonly title: string;
  readonly sessionId: string | null;
  /** Epoch ms, or null. */
  readonly wokenAt: number | null;
  readonly chargedAt: number | null;
  readonly chargeCount: number;
  readonly leaderNoticedAt: number | null;
}

/** What the runner knows of a conversation on this machine. */
export interface SessionState {
  /** Its tmux session is open. */
  readonly alive: boolean;
  /** Epoch ms of its last user/assistant turn (transcript), or null when unknown. */
  readonly lastTurnAt: number | null;
}

export type LinkKind =
  | { readonly kind: 'github'; readonly owner: string; readonly repo: string; readonly type: 'pull' | 'issues'; readonly number: number }
  | { readonly kind: 'slack' }
  | { readonly kind: 'other' };

export function linkKind(link: string): LinkKind {
  const gh = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#].*)?$/.exec(link.trim());
  if (gh) return { kind: 'github', owner: gh[1]!, repo: gh[2]!, type: gh[3] as 'pull' | 'issues', number: Number(gh[4]) };
  if (/^https:\/\/[\w-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+/.test(link.trim())) return { kind: 'slack' };
  return { kind: 'other' };
}

export type CronAction =
  | { readonly do: 'wake'; readonly card: string; readonly session: string; readonly mark: 'woken' | 'charged'; readonly text: string }
  | { readonly do: 'leader'; readonly card: string; readonly text: string }
  | { readonly do: 'skip'; readonly card: string; readonly why: string };

const minutes = (ms: number): number => Math.round(ms / 60_000);

/** The reference a response must be newer than: the justification's stage start, or the last time we woke for one. */
export function responseSince(card: CronCard): number {
  return Math.max(card.stageSince, card.wokenAt ?? 0);
}

/**
 * The justification round for one card. `responded` is what the runner found on the link after `responseSince`
 * (null when the link cannot be read: only the deadline counts then).
 */
export function planJustify(card: CronCard, responded: boolean | null, now: number): CronAction {
  if (!card.justification) return { do: 'skip', card: card.id, why: 'sem justificativa' };
  const { link, due, text } = card.justification;
  if (!isValidJustification(card.justification, now)) {
    if (card.chargeCount < CHARGE_MAX) {
      if (card.chargedAt !== null && now - card.chargedAt < CHARGE_EVERY_MS) return { do: 'skip', card: card.id, why: 'cobrado há pouco' };
      if (!card.sessionId) return leaderOnce(card, now, `o prazo da justificativa venceu e o cartão não tem conversa para cobrar`);
      return {
        do: 'wake',
        card: card.id,
        session: card.sessionId,
        mark: 'charged',
        text: `${LABEL} O prazo do cartão ${card.id} ("${card.title}") venceu: você esperava "${text}" em ${link}. Confira o link e mova o cartão (card_move) ou dê uma justificativa nova com outro prazo (card_justify).`,
      };
    }
    return leaderOnce(card, now, `o prazo venceu e a sessão foi cobrada ${CHARGE_MAX} vezes sem mexer no cartão`);
  }
  if (!responded) return { do: 'skip', card: card.id, why: responded === null ? 'link sem leitura; espera o prazo' : 'sem resposta nova' };
  if (!card.sessionId) return leaderOnce(card, now, `chegou resposta em ${link}, mas o cartão não tem conversa para acordar`);
  return {
    do: 'wake',
    card: card.id,
    session: card.sessionId,
    mark: 'woken',
    text: `${LABEL} Chegou resposta em ${link}, onde o cartão ${card.id} ("${card.title}") esperava "${text}" (prazo ${new Date(due).toISOString()}). Leia e siga; mova o cartão com card_move.`,
  };
}

function leaderOnce(card: CronCard, now: number, why: string): CronAction {
  if (card.leaderNoticedAt !== null && now - card.leaderNoticedAt < LEADER_NOTICE_EVERY_MS) return { do: 'skip', card: card.id, why: 'Líder já avisado há pouco' };
  return {
    do: 'leader',
    card: card.id,
    text: `${LABEL} Cartão ${card.id} ("${card.title}", ${STAGE_LABELS[card.stage]}, lugar ${card.placeId ?? 'sem lugar'}): ${why}. Retome a sessão (sessao_retomar) ou mova o cartão.`,
  };
}

/** The vigia's wakes of a card in the last 24 h (epoch ms, oldest first), kept by the runner. */
export type WakeLog = readonly number[];

export function planVigia(card: CronCard, session: SessionState | null, wakes: WakeLog, now: number): CronAction {
  const lastTurn = session?.lastTurnAt ?? card.stageSince;
  if (!isStalled(card, lastTurn, now)) return { do: 'skip', card: card.id, why: 'não está parado sem justificativa' };
  const idle = minutes(now - Math.max(lastTurn, card.stageSince));
  if (!card.sessionId || !session?.alive) {
    return leaderOnce(card, now, `está em Fazendo, parado há ${idle} min, sem justificativa, e a sessão dele está fechada`);
  }
  const recent = wakes.filter((at) => now - at < 24 * 60 * 60 * 1000);
  if (recent.length >= VIGIA_MAX_PER_DAY) {
    return leaderOnce(card, now, `está em Fazendo, parado há ${idle} min, sem justificativa, e já foi acordado ${recent.length} vezes hoje`);
  }
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < VIGIA_PAUSE_MS * 2 ** (recent.length - 1)) return { do: 'skip', card: card.id, why: 'recuo' };
  return {
    do: 'wake',
    card: card.id,
    session: card.sessionId,
    mark: 'woken',
    text: `${LABEL} O cartão ${card.id} ("${card.title}") está em Fazendo, parado há ${idle} min, sem justificativa. Continue de onde parou. Se estiver esperando alguém, diga por quê, onde e até quando com card_justify (ou mova para Travado).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The input field of a Claude Code screen (port of despertador_sessoes.py `ler_campo`/`sem_sugestao`): the "❯" line
// between the last two "────" rulers is free only when empty. The dimmed text (SGR 2) is the CLI's suggestion, not
// something typed (11/11: read as "someone's draft", it blocked the despertador).

const SGR = /\x1b\[([0-9;]*)m/g;

function applySgr(params: readonly string[], dim: boolean): boolean {
  const ps = params.length ? params : ['0'];
  let next = dim;
  for (let i = 0; i < ps.length; ) {
    const p = ps[i] || '0';
    if (p === '38' || p === '48' || p === '58') {
      const mode = ps[i + 1] ?? '';
      i += mode === '5' ? 3 : mode === '2' ? 5 : 2;
      continue;
    }
    if (p === '2') next = true;
    else if (p === '0' || p === '22') next = false;
    i += 1;
  }
  return next;
}

export function withoutSuggestion(screen: string): string {
  return screen
    .split('\n')
    .map((line) => {
      let dim = false;
      let out = '';
      let pos = 0;
      for (const m of line.matchAll(SGR)) {
        if (!dim) out += line.slice(pos, m.index);
        dim = applySgr(m[1] ? m[1].split(';') : [], dim);
        pos = (m.index ?? 0) + m[0].length;
      }
      if (!dim) out += line.slice(pos);
      return out;
    })
    .join('\n');
}

export function fieldIsFree(screen: string): { readonly free: boolean; readonly why: string } {
  const lines = withoutSuggestion(screen).replace(/\n+$/, '').split('\n');
  const rulers = lines.flatMap((line, i) => (line.trim().startsWith('─'.repeat(10)) ? [i] : []));
  if (rulers.length < 2) return { free: false, why: 'campo não reconhecido na tela' };
  const [a, b] = [rulers[rulers.length - 2]!, rulers[rulers.length - 1]!];
  const middle = lines.slice(a + 1, b).map((line) => line.replace(/ /g, ' ').trim());
  if (!middle.length || !middle[0]!.startsWith('❯')) return { free: false, why: 'campo não reconhecido na tela' };
  const rest = [middle[0]!.slice(1).trim(), ...middle.slice(1)];
  if (rest.some(Boolean)) return { free: false, why: 'campo com texto (rascunho de alguém)' };
  return { free: true, why: '' };
}
