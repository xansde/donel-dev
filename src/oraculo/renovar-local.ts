// Renovar sessão no limite de contexto SEM o app do PC (t-49dee38d, 20/11) — with the PC's app closed nobody renewed a
// session past the context budget: it grew to ~1M and the CLI compacted it, with no handoff. This loop of the Oráculo
// on the personal VPS does what the app does (B36, `shared/sessionRenewal.ts`), for the sessions of this machine's tmux:
//
//   detect → ask for the handoff → wait for it → open the successor in the SAME place → only then end the old tmux.
//
// Rules no path may break:
//   1. Off unless `<oraculo dir>/renovar-local.json` says `"enabled": true` (read at each round: no restart). Only with
//      the PC away (`pcAway`: the app renews when it is on, and two renewals of one session would race), never the
//      Líder único (found in the tmux or marked in his meta), never a session born under 30 min ago.
//   2. Only at the end of a turn: the last main entry of the transcript is the assistant's end of turn with no tool
//      call pending, the transcript quiet for 60 s, and the screen with no turn running, no background work waited
//      on and an empty input field.
//   3. The old session dies only after the new one is alive in the tmux, and only with the handoff ready and no live
//      work declared. A handoff that does not come in 7 min, a successor that does not open: give up, log, kill nothing.
//   4. One renewal per session, ever: the mark `renovacao-local` in its folder (`~/.donel/s/<sid>`) is written before
//      anything is asked and never removed here (delete it by hand to try again). The old folder is never deleted.
//   5. Nothing read from a meta here is logged but the named fields (never a key).
//
// Each step logs one line `[oraculo] renovar-local: <passo> ...` (detectou, pediu, pronta, abriu, fechou, desistiu).

import { existsSync, mkdirSync, promises as fsp, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWorking } from '../shared/chat/screen';
import { contextTokensFromLine } from '../shared/contextWindow';
import { buildHandoffInstructions, handoffBaseName, handoffFirstPrompt, handoffRequestPrompt, handoffStamp } from '../shared/sessionHandoff';
import { formatTokensK, parseHandoffHeader, sanitizeSessionRenewalPrefs, type SessionRenewalPrefs } from '../shared/sessionRenewal';
import type { SuccessorCall, SuccessorOutcome } from './abrir-local';
import type { LocalLeader } from './lider-local';
import { fieldIsFree, typeable } from './recados';

export type { SuccessorOutcome } from './abrir-local';

/** The switch, in the Oráculo's folder (`~/.donel/oraculo`), per machine. */
export const RENEW_CONFIG_FILE = 'renovar-local.json';
/** The mark in the session folder: this session was taken once (never renewed twice). */
export const RENEW_MARK = 'renovacao-local';
export const DEFAULT_LOCAL_RENEWAL: SessionRenewalPrefs = { enabled: false, limitTokens: 250_000 };
/** How often the loop looks. */
export const RENEW_TICK_MS = 30_000;
/** A session born this recently is never renewed (the limitador's renewal window). */
export const MIN_AGE_MS = 30 * 60_000;
/** The transcript must be this quiet. */
export const QUIET_MS = 60_000;
/** How long the session has to write its handoff (the app's `RENEWAL_HANDOFF_WAIT_MS`). */
export const HANDOFF_WAIT_MS = 7 * 60_000;
const HANDOFF_POLL_MS = 10_000;
/** How long the successor has to show in the tmux. */
export const SUCCESSOR_WAIT_MS = 60_000;
const SUCCESSOR_POLL_MS = 2_000;
const TAIL_BYTES = 400 * 1024;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The switch (`enabled` false and 250k when the file is missing or a field is invalid). */
export function readLocalRenewalConfig(oraculoDir: string): SessionRenewalPrefs {
  try {
    return sanitizeSessionRenewalPrefs(JSON.parse(readFileSync(join(oraculoDir, RENEW_CONFIG_FILE), 'utf8')) as unknown, DEFAULT_LOCAL_RENEWAL);
  } catch {
    return DEFAULT_LOCAL_RENEWAL;
  }
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

/** The fields of a session's meta this needs (never its keys). */
interface RenewMeta {
  readonly leaderOfAll: boolean;
  readonly createdAt?: string;
  readonly localCwd?: string;
}

function readRenewMeta(sessionsDir: string, sid: string): RenewMeta | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
    if (!isRecord(raw)) return null;
    return {
      leaderOfAll: raw.leaderOfAll === true,
      ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
      ...(typeof raw.localCwd === 'string' && raw.localCwd ? { localCwd: raw.localCwd } : {}),
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
  /** The switch, read at each round. */
  readonly config: () => SessionRenewalPrefs;
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
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface LocalRenewal {
  /** One round: looks at every live session and renews at most one (it waits for that one to end). */
  tick(): Promise<void>;
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

export function createLocalRenewal(deps: LocalRenewalDeps): LocalRenewal {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? ((line: string) => console.log(line));
  const readTail = deps.readTail ?? readFileTail;
  const say = (line: string): void => log(`[oraculo] renovar-local: ${line}`);
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const markFile = (sid: string): string => join(deps.sessionsDir, sid, RENEW_MARK);
  const mark = (sid: string, step: string, extra: Record<string, unknown> = {}): void => {
    try {
      writeFileSync(markFile(sid), `${JSON.stringify({ passo: step, em: new Date(now()).toISOString(), ...extra })}\n`, { mode: 0o600 });
    } catch (error) {
      say(`aviso: a marca de ${sid.slice(0, 8)} não gravou (${error instanceof Error ? error.message : String(error)})`);
    }
  };

  /** The session is past the limit with its turn over; its tokens, or `null` = not now. */
  async function candidate(sid: string, prefs: SessionRenewalPrefs, leaderSid: string | undefined): Promise<number | null> {
    if (!SID_PATTERN.test(sid) || sid === leaderSid || existsSync(markFile(sid))) return null;
    const meta = readRenewMeta(deps.sessionsDir, sid);
    if (!meta || meta.leaderOfAll || !meta.localCwd) return null;
    const born = meta.createdAt ? Date.parse(meta.createdAt) : Number.NaN;
    if (!Number.isFinite(born) || now() - born < MIN_AGE_MS) return null;
    const path = await deps.transcriptOf(sid);
    const tail = path ? await readTail(path) : null;
    if (!tail) return null;
    const verdict = readTailVerdict(tail.text);
    if (verdict.tokens === null || verdict.tokens < prefs.limitTokens || !verdict.ended || now() - tail.mtimeMs < QUIET_MS) return null;
    if (!screenIsIdle(await deps.screen(sid))) return null;
    return verdict.tokens;
  }

  async function renew(sid: string, tokens: number, prefs: SessionRenewalPrefs): Promise<void> {
    const sid8 = sid.slice(0, 8);
    const giveUp = (why: string): void => {
      mark(sid, 'desistiu', { motivo: why });
      say(`desistiu de ${sid8}: ${why}; nada foi encerrado.`);
    };
    // The mark first: from here on this session is never taken again, whatever happens below.
    mark(sid, 'detectou');
    say(`detectou ${sid8} em ${formatTokensK(tokens)} (limite ${formatTokensK(prefs.limitTokens)}), turno parado.`);
    const cwd = readSessionDir(deps.sessionsDir, sid) ?? readRenewMeta(deps.sessionsDir, sid)?.localCwd ?? 'projeto';
    const at = now();
    const base = handoffBaseName(at, cwd, sid);
    const handoffPath = join(deps.handoffsDir, `${base}.md`);
    const instructionsPath = join(deps.handoffsDir, `${base}.instrucoes.md`);
    try {
      mkdirSync(deps.handoffsDir, { recursive: true, mode: 0o700 });
      writeFileSync(
        instructionsPath,
        buildHandoffInstructions({ handoffPath, sessionId: sid, cwd, date: handoffStamp(at).date, contextTokens: tokens, limitTokens: prefs.limitTokens }),
        { mode: 0o600 },
      );
    } catch (error) {
      giveUp(`as instruções da passagem não gravaram (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    if (!(await deps.type(sid, typeable(handoffRequestPrompt({ contextTokens: tokens, limitTokens: prefs.limitTokens, instructionsPath }))))) {
      giveUp('o tmux recusou o pedido de passagem');
      return;
    }
    mark(sid, 'pediu', { passagem: handoffPath });
    say(`pediu a passagem a ${sid8} em ${handoffPath}.`);

    // Ready = the header says `donel-passagem: 1` and no live work, and the session is no longer writing.
    const askedAt = now();
    let ready = false;
    let lastLiveWork: string | null = null;
    while (now() - askedAt < HANDOFF_WAIT_MS) {
      await sleep(HANDOFF_POLL_MS);
      if (!(await deps.liveSessions()).has(sid)) {
        giveUp('a sessão saiu do tmux antes da passagem');
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
      giveUp(lastLiveWork ? `a passagem declara trabalho vivo (${lastLiveWork.slice(0, 80)}) até o prazo de 7 min` : 'a passagem não veio em 7 min');
      return;
    }
    mark(sid, 'pronta', { passagem: handoffPath });
    say(`pronta a passagem de ${sid8}, sem trabalho vivo.`);

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
    mark(sid, 'abriu', { sucessora: opened.sid });
    say(`abriu ${new8} no lugar de ${sid8}.`);

    // The old one ends only once the new one is alive in the tmux.
    const openedAt = now();
    let alive = (await deps.liveSessions()).has(opened.sid);
    while (!alive && now() - openedAt < SUCCESSOR_WAIT_MS) {
      await sleep(SUCCESSOR_POLL_MS);
      alive = (await deps.liveSessions()).has(opened.sid);
    }
    if (!alive) {
      giveUp(`a sessão nova ${new8} não apareceu viva no tmux; as duas ficam como estão`);
      return;
    }
    const killed = await deps.kill(sid);
    mark(sid, killed ? 'fechou' : 'nao-fechou', { sucessora: opened.sid });
    say(killed ? `fechou o tmux de ${sid8} (a pasta fica); ${new8} segue no lugar dela.` : `nao-fechou: o tmux recusou encerrar ${sid8}; ${new8} já está viva no lugar dela.`);
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const prefs = deps.config();
      if (!prefs.enabled || !deps.pcAway()) return;
      const leaderSid = (await deps.leader())?.sid;
      for (const sid of await deps.liveSessions()) {
        const tokens = await candidate(sid, prefs, leaderSid);
        if (tokens === null) continue;
        await renew(sid, tokens, prefs);
        return;
      }
    } catch (error) {
      say(`falhou a rodada (${error instanceof Error ? error.message : String(error)}).`);
    } finally {
      running = false;
    }
  }

  return {
    tick,
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
