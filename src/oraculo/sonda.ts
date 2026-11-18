// Canal do Donel fora do PC (t-e195b35c, §1 Satélite) — the picture of a session no PC push covers (every session of
// the Homologações, a session of the personal VPS the PC has not pictured), asked through the session's own tunnel to
// the PC while the PC answers: `sessao_quem_sou`, `sessao_listar` and `quadro_ler`, with the session's token from its
// `meta.json`, as its CLI would call. The board is rebuilt from `quadro_ler` (places and links) and the openers of
// `sessao_listar` (`abertaPor`, the opening arrows: the hierarchy the ledger's reach rules read).
//
// Gentle with the PC: a session is asked only when its picture is over a minute old and its last probe too; one session
// at a time with a pause between them; the first failure ends the round (a PC off or busy is not asked again at once).
// A failed probe keeps the last picture. No token is ever logged.

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { MindscapeBoard, MindscapeCard, MindscapeLink } from '../shared/mindscape/model';
import type { BoardPicture, PictureSession } from './portao';

const STALE_MS = 60_000;
const TIMEOUT_MS = 5_000;
const GAP_MS = 500;
const ROUND_MS = 15_000;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The board of a session from what it reads: the places and links of `quadro_ler`, and an opening arrow (`opened`)
 * from each `abertaPor` of `sessao_listar` to its place. A link a session drew stays a session's link: it lets a
 * message through, never puts anyone above. `undefined` = not a board's reading.
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
    const opened: MindscapeLink = { id: index >= 0 ? links[index]!.id : `aberta:${from}>${to}`, from, to, arrow: true, by: 'session', opened: true };
    if (index >= 0) links[index] = opened;
    else links.push(opened);
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

function readMeta(sessionsDir: string, sid: string): { readonly port: number; readonly token: string } | null {
  try {
    const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
    if (!isRecord(raw) || typeof raw.mcpToken !== 'string' || !raw.mcpToken || typeof raw.mcpPort !== 'number') return null;
    return { port: raw.mcpPort, token: raw.mcpToken };
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
  const lastProbe = new Map<string, number>();
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
    if (running) return;
    running = true;
    try {
      const live = [...(await deps.liveSessions())].filter((sid) => SID_PATTERN.test(sid)).sort();
      let first = true;
      for (const sid of live) {
        const picture = deps.picture();
        const mine = picture?.sessoes[sid];
        const at = now();
        if (mine && picture && at - (mine.at ?? picture.at) < staleMs) continue;
        if (at - (lastProbe.get(sid) ?? Number.NEGATIVE_INFINITY) < staleMs) continue;
        const meta = readMeta(deps.sessionsDir, sid);
        if (!meta) continue;
        if (!first && gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
        first = false;
        lastProbe.set(sid, now());
        const session = await probe(meta.port, meta.token);
        if (!session) {
          // The PC is off or busy: the rest waits for the next round.
          log(`[oraculo] sonda: a sessão ${sid} não respondeu pelo túnel; fica o retrato anterior.`);
          break;
        }
        deps.setSession(sid, session);
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
