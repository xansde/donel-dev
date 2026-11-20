// Renovar sessão no limite de contexto SEM o app do PC (t-49dee38d, 20/11) — with the PC's app closed nobody renewed a
// session past the context budget: it grew to ~1M and the CLI compacted it, with no handoff. This loop of the Oráculo
// on the personal VPS does what the app does (B36, `shared/sessionRenewal.ts`), for the sessions of this machine's tmux:
//
//   detect → ask for the handoff → wait for it → open the successor in the SAME place → wait for the successor to
//   ANSWER → recheck the old one is still stopped → only then end the old tmux.
//
// Rules no path may break (round 2: the Líder único's conditions, r-f475c1c9):
//   1. Off unless `<oraculo dir>/renovar-local.json` says `"enabled": true` AND lists the session (its sid or its
//      `place:`) in `"somente"` (missing or empty = nobody). Only roles in `"papeis"` (default `["dev"]`); the Líder de
//      quadro (`lider`) and the Theo (`theo-west`) only when listed there AND `"liberarLideres": true`; the Líder único
//      (`lider-unico`, or `leaderOfAll` in the meta) never, whatever the switch says (the successor opening refuses it too). Only with the PC away (`pcAway`: the app renews when it is on),
//      never a session born under 30 min ago. The switch, the list and `pcAway` are read again before typing the
//      request, before opening the successor and before the kill: any of them off = stop there, opening/killing nothing.
//   2. Only at the end of a turn: the last main entry of the transcript is the assistant's end of turn with no tool
//      call pending, the transcript quiet for 60 s, and the screen with no turn running, no background work waited
//      on and an empty input field — read again right before the request is typed.
//   3. The old session dies only after the NEW one ANSWERED (the last assistant entry after its first message is a real
//      end of turn with text and no tool call; an API error the CLI writes itself — `isApiErrorMessage`, model
//      `<synthetic>` — is no answer and undoes one before it, like the empty thinking a dropped connection leaves). T2:
//      that answer counts only with the new one's SCREEN stopped (as the old one's: no turn, no "esc to interrupt", no
//      dialog, empty field) and its transcript quiet for 60 s after it, read again at the end: a text cut by the network
//      gets its "Connection lost" 30 to 250 s later, while the screen shows the turn running. T1: before the old one is
//      closed, whatever reached it since the handoff request (recados delivered or typed, the owner typing) goes to the
//      new one (recados.ts `forwardAfterHandoff`); that failing closes nothing. A new one SILENT for 5 min (no real assistant entry after its first message) is
//      closed: it never worked. A new one with any assistant activity is never closed: it gets up to 30 min to end its
//      turn; without that, both stay alive ("duas vivas no lugar", lasting) and the Líder is told. The old one dies
//      only while it is still stopped (screen idle, no new transcript entry since the handoff was ready). Back at work:
//      wait up to 10 min for it to stop; still working = kill nothing, both stay alive ("duas vivas no lugar").
//   4. The mark `renovacao-local` in the session folder (`~/.donel/s/<sid>`) is written before anything is asked, and
//      a mark that does not write stops the renewal. No room on this machine, or another session alive in the same
//      place (a successor a give-up left alive counts), is checked BEFORE the handoff is asked: then nothing is asked
//      and no try is counted ("adiou"). A give-up for a passing cause after the request (tmux refused, no room, port
//      taken, the new one silent or gone, no handoff, the switch or the PC changed midway) lasts 30 min and counts one
//      try; the 2nd in a row is lasting. Lasting ones (2 tries, two sessions alive in the place, the session gone from
//      the tmux) stay until the mark is deleted by hand, and the Líder is told. A mark left midway (the entregador
//      restarted during a renewal) is never resumed: `recover` tells the Líder and the session stays out. The old folder
//      is never deleted.
//   5. Nothing read from a meta here is logged but the named fields (never a key).
//
// Each step logs one line `[oraculo] renovar-local: <passo> ...` (adiou, detectou, pediu, pronta, abriu, respondeu,
// fechou, desistiu, em voo). The Líder (deps.toLeader) hears one line, never a key, on: two sessions alive in the place,
// a lasting give-up, a renewal found in flight at start.

import { existsSync, mkdirSync, promises as fsp, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OwnerMessage } from '../main/ledger-card-writer';
import { isWorking } from '../shared/chat/screen';
import { contextTokensFromLine } from '../shared/contextWindow';
import { LEADER_ROLE_ID } from '../shared/roles';
import { buildHandoffInstructions, handoffBaseName, handoffFirstPrompt, handoffRequestPrompt, handoffStamp } from '../shared/sessionHandoff';
import { formatTokensK, parseHandoffHeader, RENEWAL_LIMIT_MAX_TOKENS, RENEWAL_LIMIT_MIN_TOKENS, type SessionRenewalPrefs } from '../shared/sessionRenewal';
import type { SuccessorCall, SuccessorOutcome } from './abrir-local';
import type { LocalLeader } from './lider-local';
import { fieldIsFree, typeable, type ForwardCall, type ForwardOutcome } from './recados';

export type { SuccessorOutcome } from './abrir-local';

/** The switch, in the Oráculo's folder (`~/.donel/oraculo`), per machine. */
export const RENEW_CONFIG_FILE = 'renovar-local.json';
/** The mark in the session folder: the renewal's step, and whether (and until when) the session stays out. */
export const RENEW_MARK = 'renovacao-local';

/** The switch of this machine. */
export interface LocalRenewalConfig extends SessionRenewalPrefs {
  /** The sessions it may renew: folder sids or `place:` ids. Empty = nobody, even enabled. */
  readonly somente: readonly string[];
  /** The roles it may renew (default only `dev`). */
  readonly papeis: readonly string[];
  /** The leaders' roles (`lider`, `theo-west`) only with this AND the role listed in `papeis`. Never the Líder único. */
  readonly liberarLideres: boolean;
}

export const DEFAULT_LOCAL_RENEWAL: LocalRenewalConfig = { enabled: false, limitTokens: 250_000, somente: [], papeis: ['dev'], liberarLideres: false };
/** Roles held back unless the switch frees them explicitly. */
export const GUARDED_ROLES: ReadonlySet<string> = new Set([LEADER_ROLE_ID, 'theo-west']);
/** Roles no switch frees: the Líder único (also barred by `leaderOfAll` in the meta). */
export const NEVER_ROLES: ReadonlySet<string> = new Set(['lider-unico']);
/** How often the loop looks. */
export const RENEW_TICK_MS = 30_000;
/** A session born this recently is never renewed (the limitador's renewal window). */
export const MIN_AGE_MS = 30 * 60_000;
/** The transcript must be this quiet. */
export const QUIET_MS = 60_000;
/** How long the session has to write its handoff (the app's `RENEWAL_HANDOFF_WAIT_MS`). */
export const HANDOFF_WAIT_MS = 7 * 60_000;
const HANDOFF_POLL_MS = 10_000;
/** How long a successor with no assistant activity at all has before it is closed as silent. */
export const ANSWER_WAIT_MS = 5 * 60_000;
/** How long a successor already working (assistant entries, tools) has to end its first turn; never closed after. */
export const TURN_WAIT_MS = 30 * 60_000;
const ANSWER_POLL_MS = 5_000;
/** How long the old one may take to stop again once it went back to work. */
export const STOP_WAIT_MS = 10 * 60_000;
const STOP_POLL_MS = 10_000;
/** How long a give-up for a passing cause keeps the session out. */
export const PASSING_GIVE_UP_MS = 30 * 60_000;
/** Passing give-ups in a row (after a request) that make the give-up lasting. */
export const MAX_TRIES = 2;
/** No room before the request: looked at again after this (no try counted). */
const NO_ROOM_RETRY_MS = 5 * 60_000;
const TAIL_BYTES = 400 * 1024;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
/** A board place: `place:<uuid>` (the PC's), or `session:<sid>` (the one an opening with the PC off names, abrir-local). */
const PLACE_PATTERN = /^(?:place|session):[A-Za-z0-9-]{1,64}$/;
const ROLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The steps of a renewal under way: a mark left on one of them was cut midway. */
const IN_FLIGHT_STEPS: ReadonlySet<string> = new Set(['detectou', 'pediu', 'pronta', 'abriu', 'respondeu']);

function stringList(value: unknown, pattern: RegExp): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && pattern.test(item)))];
}

/** Pure — the switch as read from its file; anything invalid falls to the safe side (off, nobody, only `dev`). */
export function sanitizeLocalRenewalConfig(value: unknown): LocalRenewalConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_LOCAL_RENEWAL;
  const raw = value as Record<string, unknown>;
  const limit = raw.limitTokens;
  const papeis = stringList(raw.papeis, ROLE_PATTERN);
  return {
    enabled: raw.enabled === true,
    limitTokens:
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(RENEWAL_LIMIT_MAX_TOKENS, Math.max(RENEWAL_LIMIT_MIN_TOKENS, Math.round(limit)))
        : DEFAULT_LOCAL_RENEWAL.limitTokens,
    somente: stringList(raw.somente, new RegExp(`${SID_PATTERN.source}|${PLACE_PATTERN.source}`)),
    papeis: papeis.length > 0 ? papeis : DEFAULT_LOCAL_RENEWAL.papeis,
    liberarLideres: raw.liberarLideres === true,
  };
}

/** The switch (off, nobody, only `dev` when the file is missing or invalid). */
export function readLocalRenewalConfig(oraculoDir: string): LocalRenewalConfig {
  try {
    return sanitizeLocalRenewalConfig(JSON.parse(readFileSync(join(oraculoDir, RENEW_CONFIG_FILE), 'utf8')) as unknown);
  } catch {
    return DEFAULT_LOCAL_RENEWAL;
  }
}

/** Pure — the role may be renewed under this switch. */
export function roleAllowed(roleId: string | undefined, config: LocalRenewalConfig): boolean {
  if (!roleId || NEVER_ROLES.has(roleId) || !config.papeis.includes(roleId)) return false;
  return !GUARDED_ROLES.has(roleId) || config.liberarLideres;
}

/** What the end of a transcript says: the context of its last turn and whether that turn ended with nothing pending. */
export interface TailVerdict {
  readonly tokens: number | null;
  /** The last main entry is the assistant's end of turn, with no `tool_use` in it. */
  readonly ended: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pure — the end of a transcript (its first line may be cut). */
export function readTailVerdict(tail: string): TailVerdict {
  const lines = tail.split('\n');
  let tokens: number | null = null;
  let ended: boolean | null = null;
  for (let index = lines.length - 1; index >= 0 && (tokens === null || ended === null); index -= 1) {
    const line = lines[index]!;
    if (tokens === null) tokens = contextTokensFromLine(line);
    if (ended !== null) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || (entry.type !== 'user' && entry.type !== 'assistant') || entry.isSidechain === true) continue;
    const message = isRecord(entry.message) ? entry.message : {};
    const content = Array.isArray(message.content) ? message.content : [];
    const toolPending = content.some((part) => isRecord(part) && part.type === 'tool_use');
    ended = entry.type === 'assistant' && (message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence') && !toolPending;
  }
  return { tokens, ended: ended === true };
}

/** The screen as plain lines (no colors nor other escapes). */
function plainLines(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b./g, '')
    .split('\n');
}

/**
 * Background work the CLI shows under an ended turn (seen on 20/11: "✻ Waiting for 1 dynamic workflow to finish"): the
 * turn is over, but killing the process would end that work.
 */
const BACKGROUND_ON_SCREEN = /\bwaiting for \d+\b[^\n]*\bto finish\b/i;

/** Pure — the screen shows no turn running, no background work and an empty input field (nobody's draft). */
export function screenIsIdle(screen: { readonly inMode: boolean; readonly text: string } | null): boolean {
  if (!screen || screen.inMode) return false;
  const lines = plainLines(screen.text);
  const plain = lines.join('\n');
  if (/esc to interrupt/i.test(plain) || BACKGROUND_ON_SCREEN.test(plain) || isWorking(lines)) return false;
  return fieldIsFree(screen.text).free;
}

/** An entry the CLI writes itself when the call failed (API error, timeout): never the model answering. */
function isSyntheticEntry(entry: Record<string, unknown>, message: Record<string, unknown>): boolean {
  return entry.isApiErrorMessage === true || message.model === '<synthetic>';
}

/**
 * Pure — where a successor is after its first message (a user entry with text). Decided by the LAST main assistant
 * entry after it: `respondeu` = a real one (not the CLI's own) with end of turn, no tool call pending and a non-empty
 * text block; `trabalhando` = real assistant entries, but the last is not such an answer; `calada` = none at all. The
 * CLI's own error entries (`isApiErrorMessage`, model `<synthetic>`) never answer and undo an answer before them: when
 * the connection drops mid-answer the CLI writes a real entry with only an empty thinking and end of turn, then the
 * synthetic "Connection lost" (seen in this VPS's transcripts, 19/11).
 */
export function successorProgress(tail: string): 'respondeu' | 'trabalhando' | 'calada' {
  let asked = false;
  let active = false;
  let answered = false;
  for (const line of tail.split('\n')) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.isSidechain === true) continue;
    const message = isRecord(entry.message) ? entry.message : {};
    const content = message.content;
    if (entry.type === 'user' && !asked) {
      asked = typeof content === 'string' ? content.trim() !== '' : Array.isArray(content) && content.some((part) => isRecord(part) && part.type === 'text');
      continue;
    }
    if (!asked || entry.type !== 'assistant') continue;
    if (isSyntheticEntry(entry, message)) {
      answered = false;
      continue;
    }
    active = true;
    const parts = Array.isArray(content) ? content : [];
    const toolPending = parts.some((part) => isRecord(part) && part.type === 'tool_use');
    const hasText = parts.some((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '');
    answered = (message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence') && !toolPending && hasText;
  }
  if (answered) return 'respondeu';
  return active ? 'trabalhando' : 'calada';
}

/** Pure — the successor ANSWERED its first message (its last real entry ends the turn with text; no API error after). */
export function answeredFirstMessage(tail: string): boolean {
  return successorProgress(tail) === 'respondeu';
}

/** The fields of a session's meta this needs (never its keys). */
interface RenewMeta {
  readonly leaderOfAll: boolean;
  readonly createdAt?: string;
  readonly localCwd?: string;
  readonly roleId?: string;
  readonly placeId?: string;
}

function readRenewMeta(sessionsDir: string, sid: string): RenewMeta | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
    if (!isRecord(raw)) return null;
    return {
      leaderOfAll: raw.leaderOfAll === true,
      ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
      ...(typeof raw.localCwd === 'string' && raw.localCwd ? { localCwd: raw.localCwd } : {}),
      ...(typeof raw.roleId === 'string' && raw.roleId ? { roleId: raw.roleId } : {}),
      ...(typeof raw.placeId === 'string' && PLACE_PATTERN.test(raw.placeId) ? { placeId: raw.placeId } : {}),
    };
  } catch {
    return null;
  }
}

function readSessionDir(sessionsDir: string, sid: string): string | undefined {
  try {
    const dir = readFileSync(join(sessionsDir, sid, 'dir'), 'utf8').trim();
    return dir.startsWith('/') && !dir.includes('\n') ? dir : undefined;
  } catch {
    return undefined;
  }
}

export interface LocalRenewalDeps {
  /** `~/.donel/s`. */
  readonly sessionsDir: string;
  /** `~/.donel/handoffs` (where the app writes them on a place too). */
  readonly handoffsDir: string;
  /** The switch, read at each round and again at each step. */
  readonly config: () => LocalRenewalConfig;
  /** The PC has not answered for a while (retrato-local.ts). */
  readonly pcAway: () => boolean;
  /** The Líder único alive here (lider-local.ts). */
  readonly leader: () => Promise<LocalLeader | null>;
  /** This machine's live tmux sessions (folder sids). */
  readonly liveSessions: () => Promise<ReadonlySet<string>>;
  /** The transcript the session's tmux writes now. */
  readonly transcriptOf: (sid: string) => Promise<string | undefined>;
  /** The last bytes of a file and its mtime; `null` = unreadable. */
  readonly readTail?: (path: string) => Promise<{ readonly text: string; readonly mtimeMs: number } | null>;
  readonly screen: (sid: string) => Promise<{ readonly inMode: boolean; readonly text: string } | null>;
  /** Types one line in the session's input field and presses Enter (`false` = tmux refused). */
  readonly type: (sid: string, text: string) => Promise<boolean>;
  /** `tmux kill-session` of the session (never its folder). */
  readonly kill: (sid: string) => Promise<boolean>;
  /** abrir-local.ts `openSuccessor`. */
  readonly openSuccessor: (call: SuccessorCall) => Promise<SuccessorOutcome>;
  /** The board place the picture gives a session (`place:` ids only), for a meta that names none. */
  readonly placeOf?: (sid: string) => string | undefined;
  /** Why this machine has no room for one more session; `null` = room (abrir-local `roomRefusal`). Read before asking. */
  readonly room?: () => string | null;
  /** One line to the Líder único (the entregador's `toLeader`): two alive in the place, lasting give-up, in flight. */
  readonly toLeader?: (message: OwnerMessage) => Promise<unknown>;
  /**
   * T1 — what reached the old session since the handoff request, to the successor (recados.ts `forwardAfterHandoff`).
   * Absent or `ok: false` = the old one is not closed.
   */
  readonly forward?: (call: ForwardCall) => Promise<ForwardOutcome>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface LocalRenewal {
  /** One round: looks at every live session and renews at most one (it waits for that one to end). */
  tick(): Promise<void>;
  /**
   * At the daemon's start: the marks a restart left midway (a renewal cut between the request and the kill). Never
   * resumed — logged for the Líder, and the session stays out until its mark is deleted by hand. The sids found.
   */
  recover(): Promise<string[]>;
  start(): void;
  stop(): void;
}

async function readFileTail(path: string): Promise<{ readonly text: string; readonly mtimeMs: number } | null> {
  try {
    const handle = await fsp.open(path, 'r');
    try {
      const { size, mtimeMs } = await handle.stat();
      const length = Math.min(size, TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return { text: buffer.toString('utf8'), mtimeMs };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

interface GiveUpOptions {
  /** Stays out until the mark is deleted by hand (default: 30 min, then a candidate again, one try counted). */
  readonly lasting?: boolean;
  readonly extra?: Record<string, unknown>;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function createLocalRenewal(deps: LocalRenewalDeps): LocalRenewal {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? ((line: string) => console.log(line));
  const readTail = deps.readTail ?? readFileTail;
  const say = (line: string): void => log(`[oraculo] renovar-local: ${line}`);
  const config = (): LocalRenewalConfig => sanitizeLocalRenewalConfig(deps.config());
  const iso = (ms: number): string => new Date(ms).toISOString();
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const markFile = (sid: string): string => join(deps.sessionsDir, sid, RENEW_MARK);
  /** Writes the mark; `false` = it did not write, and the renewal must stop (no lock, no renewal). */
  const mark = (sid: string, step: string, extra: Record<string, unknown> = {}): boolean => {
    try {
      writeFileSync(markFile(sid), `${JSON.stringify({ passo: step, em: iso(now()), ...extra })}\n`, { mode: 0o600 });
      return true;
    } catch (error) {
      say(`abortou ${sid.slice(0, 8)}: a marca '${step}' não gravou (${error instanceof Error ? error.message : String(error)}); nada segue sem a trava.`);
      return false;
    }
  };
  /** The mark: `null` = none, `'ilegivel'` = there but unreadable (keeps the session out). */
  const readMark = (sid: string): Record<string, unknown> | 'ilegivel' | null => {
    const text = readText(markFile(sid));
    if (text === null) return existsSync(markFile(sid)) ? 'ilegivel' : null;
    try {
      const value = JSON.parse(text) as unknown;
      return isRecord(value) ? value : 'ilegivel';
    } catch {
      return 'ilegivel';
    }
  };
  /** The mark keeps the session out: a renewal done or cut midway, or a give-up not yet expired. */
  const markBlocks = (sid: string): boolean => {
    const found = readMark(sid);
    if (found === null) return false;
    if (found === 'ilegivel' || found.passo !== 'desistiu' || typeof found.ate !== 'string') return true;
    const until = Date.parse(found.ate);
    return !(Number.isFinite(until) && now() >= until);
  };

  /** The session's board place: its meta's, else the one the PC's picture gives it. */
  const placeOfSession = (sid: string): string | undefined => readRenewMeta(deps.sessionsDir, sid)?.placeId ?? deps.placeOf?.(sid);
  /** The session is in the switch's list, by its sid or by its place (meta, else the PC's picture). */
  const listed = (sid: string, cfg: LocalRenewalConfig): boolean => {
    if (cfg.somente.includes(sid)) return true;
    const place = placeOfSession(sid);
    return place !== undefined && cfg.somente.includes(place);
  };
  /**
   * Another session alive in the place of `sid`: the successor a give-up left (`sucessora` of the mark), or any live
   * session of this tmux naming the same place. While one lives, no successor is opened.
   */
  const companionAlive = async (sid: string, leftBehind: string | undefined): Promise<string | undefined> => {
    const live = await deps.liveSessions();
    if (leftBehind && leftBehind !== sid && live.has(leftBehind)) return leftBehind;
    const place = placeOfSession(sid);
    if (!place) return undefined;
    for (const other of live) if (other !== sid && SID_PATTERN.test(other) && placeOfSession(other) === place) return other;
    return undefined;
  };
  /** One line to the Líder único, never a key (of the meta only the session's board folder). */
  const tellLeader = (sid: string, line: string): void => {
    if (!deps.toLeader) return;
    const words = oneLine(`renovação sem o PC: ${line}`);
    const message: OwnerMessage = {
      projectPath: readRenewMeta(deps.sessionsDir, sid)?.localCwd ?? '',
      placeId: '',
      text: `◆ Oráculo: ${words}`,
      leaderText: `◆ Oráculo: ${words}`,
      key: `renovar-local:${sid}:${now()}`,
    };
    const failed = (error: unknown): void => say(`o aviso ao Líder sobre ${sid.slice(0, 8)} não saiu (${error instanceof Error ? error.message : String(error)}).`);
    try {
      void deps.toLeader(message).catch(failed);
    } catch (error) {
      failed(error);
    }
  };
  /** The switch, the list and the PC read NOW: why to stop here, or `null` = go on. */
  const stopReason = (sid: string): string | null => {
    const cfg = config();
    if (!cfg.enabled) return 'a chave foi desligada';
    if (!deps.pcAway()) return 'o PC voltou';
    if (!listed(sid, cfg)) return 'a sessão saiu da lista "somente"';
    return null;
  };

  const transcriptTail = async (sid: string): Promise<{ readonly text: string; readonly mtimeMs: number } | null> => {
    const path = await deps.transcriptOf(sid);
    return path ? readTail(path) : null;
  };

  /** T1 — the forward, never throwing: absent or failed = `ok: false` (the old one stays). */
  const forwardTo = async (call: ForwardCall): Promise<ForwardOutcome> => {
    if (!deps.forward) return { ok: false, motivo: 'este Oráculo não reencaminha recados' };
    try {
      return await deps.forward(call);
    } catch (error) {
      return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
    }
  };

  /** The session is past the limit with its turn over; its tokens, or `null` = not now. */
  async function candidate(sid: string, cfg: LocalRenewalConfig, leaderSid: string | undefined): Promise<number | null> {
    if (!SID_PATTERN.test(sid) || sid === leaderSid || markBlocks(sid)) return null;
    const meta = readRenewMeta(deps.sessionsDir, sid);
    if (!meta || meta.leaderOfAll || !meta.localCwd || !roleAllowed(meta.roleId, cfg) || !listed(sid, cfg)) return null;
    const born = meta.createdAt ? Date.parse(meta.createdAt) : Number.NaN;
    if (!Number.isFinite(born) || now() - born < MIN_AGE_MS) return null;
    const tail = await transcriptTail(sid);
    if (!tail) return null;
    const verdict = readTailVerdict(tail.text);
    if (verdict.tokens === null || verdict.tokens < cfg.limitTokens || !verdict.ended || now() - tail.mtimeMs < QUIET_MS) return null;
    if (!screenIsIdle(await deps.screen(sid))) return null;
    return verdict.tokens;
  }

  /**
   * The successor answered its first message, left the tmux, stayed silent 5 min (no real assistant entry at all), or
   * worked 30 min without ending its first turn (`sem-fim`: never closed). T2 — an answer counts only with its screen
   * stopped and its transcript quiet for `QUIET_MS` after it, and once more on a last read: a text the network cut gets
   * its synthetic "Connection lost" up to minutes later, with the turn still running on the screen meanwhile.
   */
  async function waitAnswer(newSid: string): Promise<'respondeu' | 'saiu' | 'calada' | 'sem-fim'> {
    const startedAt = now();
    let active = false;
    for (;;) {
      if (!(await deps.liveSessions()).has(newSid)) return 'saiu';
      const tail = await transcriptTail(newSid);
      const progress = tail === null ? 'calada' : successorProgress(tail.text);
      if (progress !== 'calada') active = true;
      if (progress === 'respondeu' && tail && now() - tail.mtimeMs >= QUIET_MS && screenIsIdle(await deps.screen(newSid))) {
        const again = await transcriptTail(newSid);
        if (again && again.mtimeMs === tail.mtimeMs && successorProgress(again.text) === 'respondeu') return 'respondeu';
      }
      const elapsed = now() - startedAt;
      if (!active && elapsed >= ANSWER_WAIT_MS) return 'calada';
      // An answer still settling gets its quiet minute past the 30 (never more: a screen that never stops is no answer).
      if (active && elapsed >= TURN_WAIT_MS && (progress !== 'respondeu' || elapsed >= TURN_WAIT_MS + 2 * QUIET_MS)) return 'sem-fim';
      await sleep(ANSWER_POLL_MS);
    }
  }

  /**
   * The old session is stopped now: screen idle (no turn, no background work, no dialog, empty field) and either no
   * new transcript entry since the handoff was ready, or a turn that ended again and went quiet.
   */
  async function oldStopped(sid: string, readyMtime: number | null): Promise<boolean> {
    if (!screenIsIdle(await deps.screen(sid))) return false;
    const tail = await transcriptTail(sid);
    if (!tail) return false;
    if (readyMtime !== null && tail.mtimeMs === readyMtime) return true;
    return readTailVerdict(tail.text).ended && now() - tail.mtimeMs >= QUIET_MS;
  }

  async function waitOldStopped(sid: string, readyMtime: number | null): Promise<boolean> {
    const startedAt = now();
    let told = false;
    for (;;) {
      if (await oldStopped(sid, readyMtime)) return true;
      if (!told) {
        say(`${sid.slice(0, 8)} voltou a trabalhar depois da passagem; espero parar (até 10 min) antes de fechar.`);
        told = true;
      }
      if (now() - startedAt >= STOP_WAIT_MS) return false;
      await sleep(STOP_POLL_MS);
    }
  }

  async function renew(sid: string, tokens: number, cfg: LocalRenewalConfig): Promise<void> {
    const sid8 = sid.slice(0, 8);
    const previous = readMark(sid);
    const before = previous !== null && previous !== 'ilegivel' ? previous : {};
    const triesBefore = typeof before.tentativas === 'number' && Number.isFinite(before.tentativas) ? before.tentativas : 0;
    const leftBehind = typeof before.sucessora === 'string' && SID_PATTERN.test(before.sucessora) ? before.sucessora : undefined;
    const carry = triesBefore > 0 ? { tentativas: triesBefore } : {};
    /** The handoff was asked: from here a passing give-up counts one try. */
    let asked = false;
    const giveUp = (why: string, options: GiveUpOptions = {}): void => {
      const tries = asked && options.lasting !== true ? triesBefore + 1 : triesBefore;
      const capped = options.lasting !== true && asked && tries >= MAX_TRIES;
      const lasting = options.lasting === true || capped;
      const reason = capped ? `${why} (${tries}ª desistência seguida)` : why;
      mark(sid, 'desistiu', { motivo: reason, ...(tries > 0 ? { tentativas: tries } : {}), ...options.extra, ...(lasting ? { permanente: true } : { ate: iso(now() + PASSING_GIVE_UP_MS) }) });
      say(`desistiu de ${sid8}: ${reason}; ${lasting ? 'fica de fora até apagarem a marca' : 'volta a ser candidata em 30 min'}.`);
      if (lasting) tellLeader(sid, `desisti de renovar ${sid8} de vez: ${reason}. Fica de fora até apagarem ${RENEW_MARK} da pasta dela.`);
    };
    /** Not now: nothing asked, no try counted, a candidate again after `forMs`. */
    const defer = (why: string, forMs: number, extra: Record<string, unknown> = {}): void => {
      if (mark(sid, 'desistiu', { motivo: why, adiada: true, ...carry, ...extra, ate: iso(now() + forMs) })) {
        say(`adiou ${sid8}: ${why}; nada foi pedido, olha de novo em ${Math.round(forMs / 60_000)} min.`);
      }
    };
    // Before asking anything: another session alive in the place (never a 2nd successor), and room for the new one.
    const companion = await companionAlive(sid, leftBehind);
    if (companion) {
      defer(`outra sessão viva no lugar (${companion.slice(0, 8)})`, PASSING_GIVE_UP_MS, leftBehind ? { sucessora: leftBehind } : {});
      return;
    }
    const noRoom = deps.room?.() ?? null;
    if (noRoom) {
      defer(`sem vaga nesta máquina (${noRoom})`, NO_ROOM_RETRY_MS);
      return;
    }
    // The mark first: while it stands this session is not taken again. Not written = not renewed.
    if (!mark(sid, 'detectou', carry)) return;
    say(`detectou ${sid8} em ${formatTokensK(tokens)} (limite ${formatTokensK(cfg.limitTokens)}), turno parado.`);
    const cwd = readSessionDir(deps.sessionsDir, sid) ?? readRenewMeta(deps.sessionsDir, sid)?.localCwd ?? 'projeto';
    const at = now();
    const base = handoffBaseName(at, cwd, sid);
    const handoffPath = join(deps.handoffsDir, `${base}.md`);
    const instructionsPath = join(deps.handoffsDir, `${base}.instrucoes.md`);
    try {
      mkdirSync(deps.handoffsDir, { recursive: true, mode: 0o700 });
      writeFileSync(
        instructionsPath,
        buildHandoffInstructions({ handoffPath, sessionId: sid, cwd, date: handoffStamp(at).date, contextTokens: tokens, limitTokens: cfg.limitTokens }),
        { mode: 0o600 },
      );
    } catch (error) {
      giveUp(`as instruções da passagem não gravaram (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    // Right before typing: the switch, the list, the PC, and the screen again (a draft or a recado may have come).
    const beforeAsk = stopReason(sid);
    if (beforeAsk) {
      giveUp(`${beforeAsk} antes do pedido; nada foi digitado`);
      return;
    }
    if (!screenIsIdle(await deps.screen(sid))) {
      giveUp('a tela mudou antes do pedido (turno, rascunho ou diálogo); nada foi digitado');
      return;
    }
    // T1: what reaches the old one from here on is not in its handoff (a recado given at the end of the handoff turn too).
    const requestedAt = now();
    if (!(await deps.type(sid, typeable(handoffRequestPrompt({ contextTokens: tokens, limitTokens: cfg.limitTokens, instructionsPath }))))) {
      asked = true;
      giveUp('o tmux recusou o pedido de passagem');
      return;
    }
    asked = true;
    if (!mark(sid, 'pediu', { passagem: handoffPath, ...carry })) return;
    say(`pediu a passagem a ${sid8} em ${handoffPath}.`);

    // Ready = the header says `donel-passagem: 1` and no live work, and the session is no longer writing.
    const askedAt = now();
    let ready = false;
    let lastLiveWork: string | null = null;
    while (now() - askedAt < HANDOFF_WAIT_MS) {
      await sleep(HANDOFF_POLL_MS);
      if (!(await deps.liveSessions()).has(sid)) {
        giveUp('a sessão saiu do tmux antes da passagem', { lasting: true });
        return;
      }
      const midway = stopReason(sid);
      if (midway) {
        giveUp(`${midway} durante a passagem; a sessão nova não foi aberta`);
        return;
      }
      const status = parseHandoffHeader(readText(handoffPath));
      if (status.kind !== 'ready') continue;
      lastLiveWork = status.liveWork;
      if (status.liveWork !== null) continue;
      if (!screenIsIdle(await deps.screen(sid))) continue;
      ready = true;
      break;
    }
    if (!ready) {
      // Passing, one try; the 2nd in a row (live work again, or any other cause) makes the give-up lasting.
      if (lastLiveWork) {
        giveUp(`a passagem declara trabalho vivo (${lastLiveWork.slice(0, 80)}) até o prazo de 7 min`);
      } else {
        giveUp('a passagem não veio em 7 min');
      }
      return;
    }
    const readyMtime = (await transcriptTail(sid))?.mtimeMs ?? null;
    if (!mark(sid, 'pronta', { passagem: handoffPath, desde: iso(requestedAt), ...carry })) return;
    say(`pronta a passagem de ${sid8}, sem trabalho vivo.`);

    const beforeOpen = stopReason(sid);
    if (beforeOpen) {
      giveUp(`${beforeOpen}; a sessão nova não foi aberta`);
      return;
    }
    const companionNow = await companionAlive(sid, leftBehind);
    if (companionNow) {
      giveUp(`outra sessão viva no lugar (${companionNow.slice(0, 8)}); a sessão nova não foi aberta`);
      return;
    }
    const opened = await deps.openSuccessor({
      de: sid,
      firstPrompt: handoffFirstPrompt({ sessionId: sid, handoffPath, by: 'pelo Oráculo (PC fora)' }),
      ...(deps.placeOf?.(sid) ? { placeId: deps.placeOf(sid)! } : {}),
    });
    if (opened.kind !== 'aberta') {
      giveUp(`a sessão nova não abriu (${opened.text})`);
      return;
    }
    const new8 = opened.sid.slice(0, 8);
    if (!mark(sid, 'abriu', { sucessora: opened.sid, ...carry })) {
      const closed = await deps.kill(opened.sid);
      say(`${closed ? 'fechei' : 'o tmux recusou fechar'} a sessão nova ${new8}; ${sid8} segue viva.`);
      return;
    }
    say(`abriu ${new8} no lugar de ${sid8}.`);

    // The old one ends only once the new one ANSWERED its first message (alive in the tmux is not enough).
    const answer = await waitAnswer(opened.sid);
    if (answer === 'saiu') {
      giveUp(`a sessão nova ${new8} saiu do tmux antes de responder; a velha segue viva`, { extra: { sucessora: opened.sid } });
      return;
    }
    if (answer === 'calada') {
      // Silent for real (no assistant entry after its first message): it never worked, and only then is it closed.
      if (await deps.kill(opened.sid)) {
        giveUp(`a nova não respondeu: calada 5 min, sem nenhuma entrada do assistente (fechei ${new8}); a velha segue viva`, { extra: { sucessora: opened.sid } });
      } else {
        giveUp(`duas vivas no lugar: a nova ${new8} ficou calada e o tmux recusou fechá-la; ${sid8} segue viva; o Líder decide`, { lasting: true, extra: { sucessora: opened.sid } });
      }
      return;
    }
    if (answer === 'sem-fim') {
      // Working: never closed. Both stay alive and the Líder decides.
      giveUp(`duas vivas no lugar: a nova ${new8} trabalha há 30 min sem encerrar o 1º turno e não é fechada; ${sid8} segue viva; o Líder decide`, {
        lasting: true,
        extra: { sucessora: opened.sid },
      });
      return;
    }
    if (!mark(sid, 'respondeu', { sucessora: opened.sid, ...carry })) return;
    say(`respondeu: ${new8} respondeu à 1ª mensagem.`);

    // Right before the kill: the old one still stopped (a recado may have opened a turn), then the switch, list, PC.
    if (!(await waitOldStopped(sid, readyMtime))) {
      giveUp(`duas vivas no lugar: ${sid8} voltou a trabalhar e não parou em 10 min, e ${new8} já respondeu; o Líder decide`, { lasting: true, extra: { sucessora: opened.sid } });
      return;
    }
    const beforeKill = stopReason(sid);
    if (beforeKill) {
      giveUp(`duas vivas no lugar: ${beforeKill} antes de fechar ${sid8}, e ${new8} já respondeu; o Líder decide`, { lasting: true, extra: { sucessora: opened.sid } });
      return;
    }
    if (!(await deps.liveSessions()).has(opened.sid)) {
      giveUp(`a sessão nova ${new8} saiu do tmux antes do fechamento; a velha segue viva`, { extra: { sucessora: opened.sid } });
      return;
    }
    // T1 — what reached the old one since the request goes to the new one BEFORE the kill; failing, nothing is closed.
    const forwardCall: ForwardCall = { de: sid, para: opened.sid, lugar: placeOfSession(sid) ?? `session:${sid}`, desde: requestedAt, excluir: instructionsPath };
    const forwarded = await forwardTo(forwardCall);
    if (!forwarded.ok) {
      giveUp(`duas vivas no lugar: não reencaminhei a ${new8} o que chegou a ${sid8} depois da passagem (${oneLine(forwarded.motivo).slice(0, 160)}); ${sid8} segue viva; o Líder decide`, {
        lasting: true,
        extra: { sucessora: opened.sid },
      });
      return;
    }
    say(`reencaminhou a ${new8} ${forwarded.reencaminhados} recado(s) ou mensagem(ns) que chegaram a ${sid8} depois da passagem; ${forwarded.passados} da fila passaram a ela.`);
    const killed = await deps.kill(sid);
    mark(sid, killed ? 'fechou' : 'nao-fechou', { sucessora: opened.sid });
    say(killed ? `fechou o tmux de ${sid8} (a pasta fica); ${new8} segue no lugar dela.` : `nao-fechou: o tmux recusou encerrar ${sid8}; ${new8} já está viva no lugar dela.`);
    if (!killed) {
      tellLeader(sid, `duas vivas no lugar: o tmux recusou encerrar ${sid8}, e ${new8} já respondeu no lugar dela; o Líder decide.`);
      return;
    }
    // Once more after the kill: a recado typed into the old one between the forward and the kill (never twice).
    const after = await forwardTo(forwardCall);
    if (!after.ok) {
      say(`depois de fechar ${sid8}, o 2º reencaminhamento a ${new8} falhou (${oneLine(after.motivo).slice(0, 160)}).`);
      tellLeader(sid, `fechei ${sid8} e ${new8} segue no lugar dela, mas a conferência final do que chegou a ${sid8} depois da passagem falhou (${oneLine(after.motivo).slice(0, 160)}); confira os recados dela.`);
    } else if (after.reencaminhados || after.passados) {
      say(`reencaminhou a ${new8} mais ${after.reencaminhados} que chegaram a ${sid8} antes do fechamento; ${after.passados} da fila passaram a ela.`);
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const cfg = config();
      if (!cfg.enabled || cfg.somente.length === 0 || !deps.pcAway()) return;
      const leaderSid = (await deps.leader())?.sid;
      for (const sid of await deps.liveSessions()) {
        const tokens = await candidate(sid, cfg, leaderSid);
        if (tokens === null) continue;
        await renew(sid, tokens, cfg);
        return;
      }
    } catch (error) {
      say(`falhou a rodada (${error instanceof Error ? error.message : String(error)}).`);
    } finally {
      running = false;
    }
  }

  async function recover(): Promise<string[]> {
    let entries: string[];
    try {
      entries = readdirSync(deps.sessionsDir);
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const sid of entries) {
      if (!SID_PATTERN.test(sid)) continue;
      const current = readMark(sid);
      if (current === null || current === 'ilegivel' || typeof current.passo !== 'string' || !IN_FLIGHT_STEPS.has(current.passo)) continue;
      found.push(sid);
      const successor = typeof current.sucessora === 'string' && SID_PATTERN.test(current.sucessora) ? ` (sucessora ${current.sucessora.slice(0, 8)})` : '';
      const line =
        `em voo: a renovação de ${sid.slice(0, 8)} parou no passo '${current.passo}'${successor} quando o entregador reiniciou; ` +
        `não retomo, o Líder decide (apagar ${RENEW_MARK} da pasta devolve a sessão à fila).`;
      say(line);
      tellLeader(sid, line);
    }
    return found;
  }

  return {
    tick,
    recover,
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), RENEW_TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
