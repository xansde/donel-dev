// Quadro de tarefas (t-1e354d15), PR 3 — the pure decisions of the board's cron on the VPS (src/board-cron/main.ts runs
// them every 15 min, the leader mode every minute). No fs, no tmux, no network here: the runner reads the cards, the
// sessions and the links, and does what these functions return.
//
// - justify: a card with a justification (Travado, or Fazendo parked on purpose). A response on its link after the
//   reference time wakes its session; a deadline gone charges it, every CHARGE_EVERY_MS, CHARGE_MAX times; one interval
//   after the last charge the lane's Líder hears it, once per stage. A session not open on this machine goes straight
//   to the Líder (charging it would never land).
// - vigia: only a card in Fazendo with NO justification whose session had no turn for STALL_MS (`isStalled`), never one
//   whose open session is only slow (a background Bash, a subagent, CPU) or has no `card_*` tools. A live
//   session is woken (at most VIGIA_MAX_PER_DAY in 24 h, with a growing pause); a closed one, or one past the cap,
//   goes to the lane's Líder, who reopens it (`sessao_retomar`): the cron does not reopen a session itself, since the
//   only ways to open one without the app live inside the daemon (abrir-local.ts) and a third one is not made here.
//   A card whose task waits for its acceptance on the owner's desk (`desk`: entregue in the Oráculo) is not stopped,
//   it is waiting for the Revisor; one whose task closed there (accepted, cancelled) goes to the Líder once, to be
//   moved to Feito. Every other stage is left alone.
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
  /** When the current justification was given (a justification in the same stage does not move `stageSince`). */
  readonly justifiedAt: number | null;
  /** The card's task on the owner's desk (the Oráculo, read-only), when it has one and it was read. */
  readonly desk?: { readonly state: string; readonly closed: boolean };
}

/** What the runner knows of a conversation on this machine. */
export interface SessionState {
  /** Its tmux session is open. */
  readonly alive: boolean;
  /**
   * Epoch ms since when it is idle: its last entry is the assistant's finished turn (end_turn). Null when it is working
   * (a tool call running, a turn not finished) or unknown: the vigia never wakes those.
   */
  readonly idleSince: number | null;
  /**
   * t-8406f473 — why it is only slow, not stopped (the despertador's filter): a background Bash of its claude still
   * running, a subagent that wrote in the last minutes, or its claude using CPU. Absent = none seen.
   */
  readonly busy?: string;
  /** It was served the `card_*` tools (the gate's mark) or already called one: it can move its card. */
  readonly cards: boolean;
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
  /**
   * `via: 'busy'`: the session's field stayed busy; this notice keeps its own mark, never the card's (`leader_noticed_at`).
   * `closed`: the card's session, not open on this machine (the Líder reopens it). `why`: the reason, for the log.
   */
  | { readonly do: 'leader'; readonly card: string; readonly text: string; readonly via?: 'busy'; readonly closed?: string; readonly why?: string }
  | { readonly do: 'skip'; readonly card: string; readonly why: string };

const minutes = (ms: number): number => Math.round(ms / 60_000);

/** The reference a response must be newer than: the justification (or its stage), or the last time we woke for one. */
export function responseSince(card: CronCard): number {
  return Math.max(card.stageSince, card.justifiedAt ?? 0, card.wokenAt ?? 0);
}

/**
 * The justification round for one card. `responded` is what the runner found on the link after `responseSince`
 * (null when the link cannot be read: only the deadline counts then).
 */
export function planJustify(card: CronCard, responded: boolean | null, session: SessionState | null, now: number): CronAction {
  if (!card.justification) return { do: 'skip', card: card.id, why: 'sem justificativa' };
  const { link, due, text } = card.justification;
  const reachable = Boolean(card.sessionId && session?.alive);
  if (!isValidJustification(card.justification, now)) {
    if (card.chargedAt !== null && now - card.chargedAt < CHARGE_EVERY_MS) return { do: 'skip', card: card.id, why: 'cobrado há pouco' };
    if (card.chargeCount < CHARGE_MAX) {
      if (!reachable) return leaderOnce(card, now, `o prazo da justificativa venceu e a sessão do cartão não está aberta nesta máquina`, 'once', card.sessionId);
      return {
        do: 'wake',
        card: card.id,
        session: card.sessionId!,
        mark: 'charged',
        text: `${LABEL} O prazo do cartão ${card.id} ("${card.title}") venceu: você esperava "${text}" em ${link}. Confira o link e mova o cartão (card_move) ou dê uma justificativa nova com outro prazo (card_justify).`,
      };
    }
    return leaderOnce(card, now, `o prazo venceu e a sessão foi cobrada ${CHARGE_MAX} vezes sem mexer no cartão`, 'once');
  }
  if (!responded) return { do: 'skip', card: card.id, why: responded === null ? 'link sem leitura; espera o prazo' : 'sem resposta nova' };
  if (!reachable) return leaderOnce(card, now, `chegou resposta em ${link}, mas a sessão do cartão não está aberta nesta máquina`, 'every', card.sessionId);
  return {
    do: 'wake',
    card: card.id,
    session: card.sessionId!,
    mark: 'woken',
    text: `${LABEL} Chegou resposta em ${link}, onde o cartão ${card.id} ("${card.title}") esperava "${text}" (prazo ${new Date(due).toISOString()}). Leia e siga; mova o cartão com card_move.`,
  };
}

/** `once`: the Líder hears it once in this stage (`leader_noticed_at` is cleared when the card moves); `every`: again every LEADER_NOTICE_EVERY_MS. */
function leaderOnce(card: CronCard, now: number, why: string, repeat: 'once' | 'every', closed?: string | null): CronAction {
  if (card.leaderNoticedAt !== null && (repeat === 'once' || now - card.leaderNoticedAt < LEADER_NOTICE_EVERY_MS)) return { do: 'skip', card: card.id, why: 'Líder já avisado' };
  return {
    do: 'leader',
    card: card.id,
    text: `${LABEL} Cartão ${card.id} ("${card.title}", ${STAGE_LABELS[card.stage]}, lugar ${card.placeId ?? 'sem lugar'}${closed ? `, sessão ${closed}` : ''}): ${why}. Retome a sessão (sessao_retomar) ou mova o cartão.`,
    ...(closed ? { closed } : {}),
    why,
  };
}

/** Rounds in a row a wake found the session's field busy (draft, dialog, copy mode) before the Líder hears it. */
export const BUSY_MAX = 3;

/**
 * A wake that found the field busy marks nothing (nothing was typed), so without this the charge count and the vigia's
 * cap never grow and the card never reaches the Líder (the despertador's MAX_REENVIO_TURNO does the same). `busy` is
 * how many rounds in a row it was busy, this one included; it keeps counting until the Líder hears it, so a Líder
 * closed or busy is tried again the next round. `heardAt`: when the Líder last heard this (the runner's own mark,
 * never the card's `leader_noticed_at`, which would silence the once-per-stage notices of a charge run out).
 */
export function afterBusyField(card: CronCard, busy: number, why: string, heardAt: number | null, now: number): CronAction {
  if (busy < BUSY_MAX) return { do: 'skip', card: card.id, why: `campo ocupado (${busy} de ${BUSY_MAX})` };
  if (heardAt !== null && now - heardAt < LEADER_NOTICE_EVERY_MS) return { do: 'skip', card: card.id, why: 'Líder já avisado do campo ocupado' };
  return {
    do: 'leader',
    via: 'busy',
    card: card.id,
    text: `${LABEL} Cartão ${card.id} ("${card.title}", ${STAGE_LABELS[card.stage]}, lugar ${card.placeId ?? 'sem lugar'}): o aviso à sessão ${card.sessionId ?? '(sem sessão)'} não entrou em ${busy} rondas seguidas (${why}). Veja a tela dela (sessao_ver_tela) ou mova o cartão.`,
  };
}

/** The Líder notice the vigia's shadow would have marked on the card (cleared, as the real one, when the card moves). */
export interface ShadowNotice {
  readonly at: number;
  readonly stageSince: number;
}

/** The card as the vigia in shadow sees it: its own simulated notice to the Líder in place of the database's. */
export function withShadowNotice(card: CronCard, notice: ShadowNotice | undefined): CronCard {
  return { ...card, leaderNoticedAt: notice && notice.stageSince === card.stageSince ? notice.at : null };
}

/** The vigia's wakes of a card in the last 24 h (epoch ms, oldest first), kept by the runner. */
export type WakeLog = readonly number[];

export function planVigia(card: CronCard, session: SessionState | null, wakes: WakeLog, now: number): CronAction {
  if (card.stage === 'doing' && card.desk?.state === 'entregue' && !card.desk.closed) return { do: 'skip', card: card.id, why: 'entregue no Oráculo, esperando o aceite' };
  // Its task closed on the owner's desk (accepted or cancelled): not stopped work, a card nobody moved to Feito.
  if (card.stage === 'doing' && card.desk?.closed) return leaderOnce(card, now, 'a tarefa dele já fechou no Oráculo (aceita ou cancelada) e o cartão segue em Fazendo; mova-o para Feito', 'once');
  const open = Boolean(card.sessionId && session?.alive);
  // An open session that is working (a long tool call) or whose transcript says nothing is never woken.
  if (open && session!.idleSince === null) return { do: 'skip', card: card.id, why: 'sessão trabalhando' };
  // t-8406f473 — a turn ended while a background job works is only slow; a session with no card_* cannot move its card,
  // so waking it (or telling the Líder it stopped) only nags. Both as the despertador: nothing typed, nothing escalated.
  if (open && session!.busy) return { do: 'skip', card: card.id, why: `só lenta: ${session!.busy}` };
  if (open && !session!.cards) return { do: 'skip', card: card.id, why: 'sessão sem card_*' };
  const lastTurn = open ? session!.idleSince! : card.stageSince;
  if (!isStalled(card, lastTurn, now)) return { do: 'skip', card: card.id, why: 'não está parado sem justificativa' };
  const idle = minutes(now - Math.max(lastTurn, card.stageSince));
  if (!open) {
    const why = card.sessionId ? 'a sessão dele está fechada nesta máquina' : 'o cartão não diz a sessão dele';
    return leaderOnce(card, now, `está em Fazendo, parado há ${idle} min, sem justificativa, e ${why}`, 'every', card.sessionId);
  }
  const recent = wakes.filter((at) => now - at < 24 * 60 * 60 * 1000);
  if (recent.length >= VIGIA_MAX_PER_DAY) {
    return leaderOnce(card, now, `está em Fazendo, parado há ${idle} min, sem justificativa, e já foi acordado ${recent.length} vezes hoje`, 'every');
  }
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < VIGIA_PAUSE_MS * 2 ** (recent.length - 1)) return { do: 'skip', card: card.id, why: 'recuo' };
  return {
    do: 'wake',
    card: card.id,
    session: card.sessionId!,
    mark: 'woken',
    text: `${LABEL} O cartão ${card.id} ("${card.title}") está em Fazendo, parado há ${idle} min, sem justificativa. Continue de onde parou. Se estiver esperando alguém, diga por quê, onde e até quando com card_justify (ou mova para Travado).`,
  };
}

/** Who hears what goes to a lane's Líder: its Líder alive here, else the Líder único alive here (he reaches every board). */
export type LeaderPick =
  | { readonly kind: 'lane'; readonly session: string; readonly place: string }
  | { readonly kind: 'reserve'; readonly session: string; readonly why: string }
  | { readonly kind: 'none'; readonly why: string };

export function pickLeader(lane: { readonly leader_place: string | null; readonly leader_session: string | null } | undefined, alive: (session: string) => boolean, leaderOfAll: string | null): LeaderPick {
  const place = lane?.leader_place ?? null;
  const session = lane?.leader_session ?? null;
  if (place && session && alive(session)) return { kind: 'lane', session, place };
  const why = !place ? 'a raia não tem Líder registrado' : !session ? `o Líder ${place} da raia não tem sessão registrada` : `a sessão ${session} do Líder ${place} da raia está fechada`;
  if (leaderOfAll && leaderOfAll !== session && alive(leaderOfAll)) return { kind: 'reserve', session: leaderOfAll, why };
  return { kind: 'none', why };
}

/** A lane whose Líder now runs in another session than the one the board has (`followLaneLeaders`). */
export interface LaneFollow {
  readonly project: string;
  readonly place: string;
  readonly session: string;
  readonly was: string | null;
}

/**
 * The lanes' Líder follows its place (devolução do Revisor, 20/11): the board kept the session it was given, and a
 * Líder that reopened or ran `/clear` left it pointing at a closed session, so every notice of the lane fell to the
 * reserve. `sessionOf` answers which session alive here holds a place on a project (the seed's resolver, with the
 * liveness test), `leaderOfAll` the Líder único alive here (the lane `lider`); a lane neither resolves keeps its
 * session (the reserve, as before). Only the lanes that change come back.
 */
export function followLaneLeaders(
  lanes: readonly { readonly project_id: string; readonly leader_place: string | null; readonly leader_session: string | null }[],
  sessionOf: (projectId: string, placeId: string) => string | undefined,
  leaderOfAll: () => string | null,
): LaneFollow[] {
  const out: LaneFollow[] = [];
  for (const lane of lanes) {
    const place = lane.leader_place;
    if (!place) continue;
    const session = place === 'lider' ? leaderOfAll() : sessionOf(lane.project_id, place);
    if (session && session !== lane.leader_session) out.push({ project: lane.project_id, place, session, was: lane.leader_session });
  }
  return out;
}

/**
 * The card follows its place (sobra da t-1e354d15, 20/11): `session_id` is the session that last moved the card, and a
 * place renewed (or reopened, or `/clear`) leaves it pointing at a closed one; the seed only fills an empty one. The
 * round resolves the card's place to the session alive here that holds it now (`sessionOf`, the lanes' resolver) and
 * uses that one; nothing alive holds the place = the card keeps its own (the Líder hears it is closed). Nothing is
 * written: who to wake is not a step of the card.
 */
export function followCardSession(card: CronCard, sessionOf: (projectId: string, placeId: string) => string | undefined): CronCard {
  if (!card.placeId) return card;
  const session = sessionOf(card.projectId, card.placeId);
  return session && session !== card.sessionId ? { ...card, sessionId: session } : card;
}

/** One notice per session in a round: the texts of all its cards in one, in the order they came. */
export interface NoticeGroup<T> {
  readonly session: string;
  readonly items: readonly T[];
  readonly text: string;
}

/**
 * The fieldIsFree check only sees whether the field holds text, so a session with three cards got three notices in a
 * row in one round (devolução de 20/11). Grouped, it gets one: a single card keeps its own text; more join under one
 * label, numbered.
 */
export function groupNotices<T>(items: readonly T[], sessionOf: (item: T) => string, textOf: (item: T) => string): NoticeGroup<T>[] {
  const bySession = new Map<string, T[]>();
  for (const item of items) bySession.set(sessionOf(item), [...(bySession.get(sessionOf(item)) ?? []), item]);
  const bare = (text: string): string => (text.startsWith(LABEL) ? text.slice(LABEL.length).trim() : text);
  return [...bySession].map(([session, list]) => ({
    session,
    items: list,
    text: list.length === 1 ? textOf(list[0]!) : `${LABEL} ${list.length} avisos nesta ronda: ${list.map((item, i) => `(${i + 1}) ${bare(textOf(item))}`).join(' ')}`,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// A response on the card's link is someone else's (design §5: "mensagem de outra pessoa"). The sessions comment with
// the same GitHub and Slack accounts the cron reads with, so what that account wrote never counts.

/** A GitHub account: `type` is "Bot" for an app (its login ends in "[bot]"). */
interface GithubAccount {
  readonly login?: string;
  readonly type?: string;
}

interface GithubAuthored {
  readonly user?: GithubAccount | null;
}

export interface GithubReading {
  readonly comments: readonly (GithubAuthored & { readonly created_at?: string })[];
  readonly reviews?: readonly (GithubAuthored & { readonly submitted_at?: string })[];
  /** issues/<n>: closed_at and closed_by (a PR is an issue there too). */
  readonly issue?: { readonly closed_at?: string | null; readonly closed_by?: GithubAccount | null };
  /** pulls/<n>: merged_at and merged_by. */
  readonly pull?: { readonly merged_at?: string | null; readonly merged_by?: GithubAccount | null };
}

const newer = (iso: string | null | undefined, since: number): boolean => typeof iso === 'string' && Date.parse(iso) > since;

/**
 * Something on a GitHub link after `since` that `self` (the gh account of this machine) did not do. A bot (CI, preview,
 * dependabot, a review app) is nobody's response: its comment would wake the session for nothing.
 */
export function othersOnGithub(reading: GithubReading, self: string, since: number): boolean {
  const other = (who: GithubAccount | null | undefined): boolean => {
    const login = (who?.login ?? '').toLowerCase();
    return login !== self.toLowerCase() && !login.endsWith('[bot]') && who?.type !== 'Bot';
  };
  if (reading.comments.some((c) => newer(c.created_at, since) && other(c.user))) return true;
  if ((reading.reviews ?? []).some((r) => newer(r.submitted_at, since) && other(r.user))) return true;
  if (reading.pull && newer(reading.pull.merged_at, since) && other(reading.pull.merged_by)) return true;
  if (reading.issue && newer(reading.issue.closed_at, since) && !(reading.pull && newer(reading.pull.merged_at, since)) && other(reading.issue.closed_by)) return true;
  return false;
}

/**
 * A message in a Slack thread as the thread reader prints it (`--- dd/mm HH:MM <author> (ts <epoch>)`, ler_fio.py) after
 * `since`, whose author is none of `self` (the names and ids of the account the sessions write with). The reader gives
 * the author's name (or its id when the name is not known); the owner writes with that same account, so a reply of his
 * in the thread does not count either.
 */
export function othersOnSlack(output: string, self: readonly string[], since: number): boolean {
  const mine = new Set(self.map((name) => name.trim().toLowerCase()).filter(Boolean));
  for (const line of output.split('\n')) {
    const m = /^--- \S+ \S+ (.*) \(ts (\d+(?:\.\d+)?)\)(?: \[mensagem do link\])?\s*$/.exec(line);
    if (!m) continue;
    if (Number(m[2]) * 1000 > since && !mine.has(m[1]!.trim().toLowerCase())) return true;
  }
  return false;
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

/** What is typed in the Claude Code input field (between the two last rules); `null` = no field on the screen. */
export function fieldTextOf(screen: string): string | null {
  const lines = withoutSuggestion(screen).replace(/\n+$/, '').split('\n');
  const rulers = lines.flatMap((line, i) => (line.trim().startsWith('─'.repeat(10)) ? [i] : []));
  if (rulers.length < 2) return null;
  const [a, b] = [rulers[rulers.length - 2]!, rulers[rulers.length - 1]!];
  const middle = lines.slice(a + 1, b).map((line) => line.replace(/\u00a0/g, ' ').trim());
  if (!middle.length || !middle[0]!.startsWith('❯')) return null;
  return [middle[0]!.slice(1).trim(), ...middle.slice(1)].filter(Boolean).join(' ');
}

/**
 * Caixa pendurada (19/11): does the field `left` hold nothing but the `notice` this cron typed (whose Enter did not
 * take)? Yes when it is that text (the screen may wrap or cut it: compared without spaces, as a prefix of it), or the one
 * paste placeholder a long notice turns into. Anything else (the owner wrote after it, pasted another text) is not ours
 * and stays.
 */
export function fieldHoldsOnlyNotice(left: string, notice: string): boolean {
  const bare = (text: string): string => text.replace(/\s+/g, '');
  const shown = bare(left);
  if (!shown) return false;
  if (/^\[Pastedtext#\d+[^\]]*\]$/.test(shown)) return true;
  return shown.startsWith(bare(LABEL)) && bare(notice).startsWith(shown);
}

export function fieldIsFree(screen: string): { readonly free: boolean; readonly why: string } {
  const text = fieldTextOf(screen);
  if (text === null) return { free: false, why: 'campo não reconhecido na tela' };
  if (text) return { free: false, why: 'campo com texto (rascunho de alguém)' };
  return { free: true, why: '' };
}
