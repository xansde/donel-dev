// Canal do Donel fora do PC (t-e195b35c, §1 Satélite) — the picture of a session no PC push covers (every session of
// the Homologações, a session of the personal VPS the PC has not pictured), asked through the session's own tunnel to
// the PC while the PC answers: `sessao_quem_sou`, `sessao_listar` and `quadro_ler`, with the session's token from its
// `meta.json`, as its CLI would call. The board is rebuilt from `quadro_ler` (places and links) and the openers of
// `sessao_listar` (`abertaPor`, the opening arrows: the hierarchy the ledger's reach rules read).
//
// Gentle with the PC (each call waits in the line of its window, the one that stalled on 18/11): a session is asked
// only when its picture is over 2 min old and its last probe too; at most 6 sessions a minute for the whole machine,
// those with no picture first, then the oldest; one at a time with a pause between them; the first failure ends the
// round, and a PC that took over 3 s to answer one session is left alone for 2 min. A failed probe keeps the last
// picture. A session that does not answer waits longer each time (2, 4, 8, 16, 32 min) and never holds the others: on
// 18/11 one mute session, always the oldest, was asked first every round, its 5 s timeout paused the probe, and no
// other picture moved for hours (their recados went to the PC). Two sessions that answered before failing in a row is
// the PC off or stalled: 2 min alone. No token is ever logged.

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { MindscapeBoard, MindscapeCard, MindscapeLink } from '../shared/mindscape/model';
import type { BoardPicture, PictureSession } from './portao';

const STALE_MS = 2 * 60_000;
/** Sessions probed per minute, at most (3 calls each): 18 calls a minute to the PC however many sessions run here. */
const PER_MINUTE = 6;
/** One session's three calls took this long: the PC is busy, and the probe waits `PAUSE_MS`. */
const SLOW_MS = 3_000;
const PAUSE_MS = 2 * 60_000;
const TIMEOUT_MS = 5_000;
const GAP_MS = 500;
const ROUND_MS = 15_000;
/** A session that failed `n` times in a row waits `STALE_MS * 2^min(n, MAX_BACKOFF)` since its last probe. */
const MAX_BACKOFF = 4;
/** This many sessions that had answered failing in a row: the PC itself is off or stalled. */
const PC_DOWN_AFTER = 2;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The board of a session from what it reads: the places and links of `quadro_ler`, and the arrow from each `abertaPor`
 * of `sessao_listar` to its place marked as the opening one (`opened`). Only an arrow the board still has: the app says
 * who opened a tab even after the owner deleted that arrow, and a deleted arrow puts no one above. Any other link a
 * session drew stays a session's link: it lets a message through, never puts anyone above. `undefined` = not a board's
 * reading.
 */
export function boardFromProbe(quemSou: Record<string, unknown>, listar: readonly unknown[], quadro: unknown): MindscapeBoard | undefined {
  if (!isRecord(quadro) || !Array.isArray(quadro.lugares) || !Array.isArray(quadro.ligacoes) || typeof quemSou.pasta !== 'string') return undefined;
  const cards: Record<string, MindscapeCard> = {};
  for (const place of quadro.lugares) {
    if (!isRecord(place) || typeof place.id !== 'string') continue;
    cards[place.id] = {
      kind: 'session',
      id: place.id,
      previous: [],
      ...(typeof place.papel === 'string' ? { roleId: place.papel } : {}),
      ...(place.autor === 'sessao' ? { by: 'session' as const } : {}),
      x: num(place.x),
      y: num(place.y),
    };
  }
  const links: MindscapeLink[] = [];
  for (const link of quadro.ligacoes) {
    if (!isRecord(link) || typeof link.id !== 'string' || typeof link.de !== 'string' || typeof link.para !== 'string') continue;
    links.push({ id: link.id, from: link.de, to: link.para, arrow: link.seta === true, ...(link.autor === 'sessao' ? { by: 'session' as const } : {}) });
  }
  for (const place of listar) {
    if (!isRecord(place) || typeof place.id !== 'string' || typeof place.abertaPor !== 'string') continue;
    const from = place.abertaPor;
    const to = place.id;
    // Only between two places of this board (the Líder único has no card).
    if (cards[from]?.kind !== 'session' || cards[to]?.kind !== 'session') continue;
    const index = links.findIndex((link) => link.from === from && link.to === to && link.arrow);
    if (index >= 0) links[index] = { id: links[index]!.id, from, to, arrow: true, by: 'session', opened: true };
  }
  return {
    projectPath: quemSou.pasta,
    pan: { x: 0, y: 0 },
    zoom: 1,
    cards,
    links,
    drawings: [],
    ...(quadro.alcance === 'todos os quadros' ? { reach: 'all' as const } : {}),
  };
}

/** Calls one tool of the PC's MCP through the session's tunnel; the parsed text of its answer, or `null`. */
export type ProbeCall = (port: number, token: string, tool: string, timeoutMs: number) => Promise<unknown>;

export const tunnelProbeCall: ProbeCall = (port, token, tool, timeoutMs) =>
  new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: {} } });
    let settled = false;
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          Host: `127.0.0.1:${port}`,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', () => finish(null));
        res.on('end', () => {
          if (res.statusCode !== 200) return finish(null);
          try {
            const answer = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { result?: { isError?: unknown; content?: Array<{ type?: unknown; text?: unknown }> } };
            const text = answer.result?.content?.[0]?.text;
            finish(answer.result?.isError === true || typeof text !== 'string' ? null : (JSON.parse(text) as unknown));
          } catch {
            finish(null);
          }
        });
      },
    );
    const timer = setTimeout(() => {
      outgoing.destroy();
      finish(null);
    }, timeoutMs);
    outgoing.on('error', () => finish(null));
    outgoing.end(body);
  });

function readMeta(sessionsDir: string, sid: string): { readonly port: number; readonly token: string; readonly withoutPc: boolean } | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
    if (!isRecord(raw) || typeof raw.mcpToken !== 'string' || !raw.mcpToken || typeof raw.mcpPort !== 'number') return null;
    return { port: raw.mcpPort, token: raw.mcpToken, withoutPc: raw.abertaSemPc === true };
  } catch {
    return null;
  }
}

export interface ProbeDeps {
  /** `~/.donel/s`. */
  readonly sessionsDir: string;
  /** The sessions alive in this machine's tmux (folder sids). */
  readonly liveSessions: () => Promise<ReadonlySet<string>>;
  readonly picture: () => BoardPicture | null;
  /** Keeps one session's new picture (with its `at`). */
  readonly setSession: (sid: string, session: PictureSession) => void;
  readonly call?: ProbeCall;
  readonly now?: () => number;
  readonly staleMs?: number;
  /** Sessions probed per minute, at most (default 6). */
  readonly perMinute?: number;
  readonly timeoutMs?: number;
  /** The pause between two sessions of a round. */
  readonly gapMs?: number;
  readonly log?: (line: string) => void;
}

export interface Probe {
  /** One round (the vitest calls it; `start` runs one every 15 s). */
  round(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createProbe(deps: ProbeDeps): Probe {
  const call = deps.call ?? tunnelProbeCall;
  const now = deps.now ?? Date.now;
  const staleMs = deps.staleMs ?? STALE_MS;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const gapMs = deps.gapMs ?? GAP_MS;
  const log = deps.log ?? ((line: string) => console.log(line));
  const perMinute = deps.perMinute ?? PER_MINUTE;
  const lastProbe = new Map<string, number>();
  /** Failures in a row of each session (none = it answered last time). */
  const failures = new Map<string, number>();
  /** Sessions that had answered, failing one after the other: `PC_DOWN_AFTER` of them pauses the probe. */
  let downStreak = 0;
  /** When each probe of the last minute started (the budget). */
  let recent: number[] = [];
  let pausedUntil = 0;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** The session's picture, or `null` (the PC did not answer one of the three). */
  async function probe(port: number, token: string): Promise<PictureSession | null> {
    const quemSou = await call(port, token, 'sessao_quem_sou', timeoutMs);
    if (!isRecord(quemSou)) return null;
    const listar = await call(port, token, 'sessao_listar', timeoutMs);
    if (!Array.isArray(listar)) return null;
    const quadro = await call(port, token, 'quadro_ler', timeoutMs);
    if (!isRecord(quadro)) return null;
    const board = boardFromProbe(quemSou, listar, quadro);
    return { quemSou, listar, ...(board ? { board } : {}), at: now() };
  }

  async function round(): Promise<void> {
    if (running || now() < pausedUntil) return;
    running = true;
    try {
      const picture = deps.picture();
      const at = now();
      const ageOf = (sid: string): number => {
        const mine = picture?.sessoes[sid];
        return mine && picture ? at - (mine.at ?? picture.at) : Number.POSITIVE_INFINITY;
      };
      // No picture first, then the oldest.
      const waitOf = (sid: string): number => staleMs * 2 ** Math.min(failures.get(sid) ?? 0, MAX_BACKOFF);
      const due = [...(await deps.liveSessions())]
        .filter((sid) => SID_PATTERN.test(sid) && ageOf(sid) >= staleMs && at - (lastProbe.get(sid) ?? Number.NEGATIVE_INFINITY) >= waitOf(sid))
        .sort((a, b) => ageOf(b) - ageOf(a) || a.localeCompare(b));
      let first = true;
      for (const sid of due) {
        recent = recent.filter((start) => now() - start < 60_000);
        if (recent.length >= perMinute) break;
        const meta = readMeta(deps.sessionsDir, sid);
        if (!meta) continue;
        // t-1a3f7150 — opened here with the PC off: no tunnel of its own until the PC adopts it (a probe would fail and
        // end the round). It answers from its synthetic picture until a PC push carries it.
        if (meta.withoutPc && picture?.sessoes[sid]?.pcAt === undefined) continue;
        if (!first && gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
        first = false;
        const started = now();
        lastProbe.set(sid, started);
        recent.push(started);
        const session = await probe(meta.port, meta.token);
        if (!session) {
          // This session waits longer before the next try; the others go on next round. Only sessions that answered
          // before, failing in a row, say the PC itself is off.
          const failed = (failures.get(sid) ?? 0) + 1;
          failures.set(sid, failed);
          if (failed === 1) downStreak += 1;
          if (downStreak >= PC_DOWN_AFTER) {
            downStreak = 0;
            pausedUntil = now() + PAUSE_MS;
            log(`[oraculo] sonda: ${PC_DOWN_AFTER} sessões seguidas sem resposta pelo túnel; a sonda espera ${PAUSE_MS / 60_000} min.`);
          } else {
            log(`[oraculo] sonda: a sessão ${sid} não respondeu pelo túnel (${failed}ª vez seguida); fica o retrato anterior e ela espera ${Math.round(waitOf(sid) / 60_000)} min.`);
          }
          break;
        }
        failures.delete(sid);
        downStreak = 0;
        deps.setSession(sid, session);
        if (now() - started >= SLOW_MS) {
          pausedUntil = now() + PAUSE_MS;
          log(`[oraculo] sonda: o PC levou ${Math.round((now() - started) / 1000)} s para a sessão ${sid}; a sonda espera ${PAUSE_MS / 60_000} min.`);
          break;
        }
      }
    } catch (error) {
      log(`[oraculo] sonda: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  }

  return {
    round,
    start() {
      if (timer) return;
      timer = setInterval(() => void round(), ROUND_MS);
      timer.unref?.();
      void round();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
