// t-d461e003, item 4 (19/11): com o PC fora, o Líder único da VPS pessoal alcança o quadro Homologação. The picture of
// another machine's sessions (the Homologações's satellite, `DONEL_PORTAO_SATELITE`) comes from that machine itself:
// its satellite makes it with the same logic as this VPS's (retrato-local.ts: its tmux, the non-secret fields of its
// session folders, the boards of its last picture of the PC) and sends it here (`POST /v1/portao/retrato`, the gate's
// token), compact: each board once (`quadros`), and each session by its place (`sessoes`: who it is, never its keys).
//
// Here the picture of each machine is kept apart (`<dir>/portoes-retrato/<name>.json`, 600; a restart keeps it), and
// what the gate and the recados read is this VPS's own picture with the others' sessions added (`combine`):
// - a sid or a board (folder) this VPS's picture has is never replaced nor removed by another machine's: the PC's
//   picture, when it comes back, rules as today;
// - each machine's push replaces only its own sessions; an older push (`at`) than the one kept is ignored.
//
// A message for a place that runs on another machine (`machineOf`) waits in that machine's queue here
// (`<dir>/portoes-recados/<name>.json`, the relay's format: on disk before the answer, the same key joins). The satellite
// takes it at each round (`POST /v1/portao/recados`, `inbox`), queues it in its own recados and says so in the next
// call (`entregues`): an ack lost on the way hands the same item again, and its key joins it there (never twice).
//
// A machine's picture only routes a message while its satellite is heard (`STALE_MS` since its last call, picture or
// queue: the picture itself goes up only when it changes, or every 5 min). Past that the satellite is taken as gone and
// the message takes the way it took before t-d461e003 (the PC's relay, or the refusal with the PC off); what already
// waits in its queue stays there for when it comes back. A picture read from disk at boot counts as heard then.
//
// Passo 9 (t-5358d400), the entregador apart: it runs in another process and never writes these files. The registro
// (`shareHeard`) also writes when it last heard each satellite (`<dir>/portoes-ouvido/<name>`, the instant in ms), and
// reads it back at boot instead of "heard now"; the entregador reads the pictures and those instants
// (`createRemotePicturesReader`) and combines and routes by the same rules, so both processes agree on who is heard.

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigIoDeps } from '../main/config-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { MindscapeBoard } from '../shared/mindscape/model';
import { picturedBoards, type BoardPicture, type PictureSession } from './portao';
import { createRelay, type Relay } from './relay';

const PICTURES_DIR = 'portoes-retrato';
const QUEUES_DIR = 'portoes-recados';
/** Passo 9 — when the registro last heard each satellite, for the entregador apart (see the header). */
export const HEARD_DIR = 'portoes-ouvido';
const GATE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
/** What of a session's `sessao_quem_sou` goes to the other machine: who it is on its board, nothing else. */
const WHO_FIELDS = ['nome', 'projeto', 'pasta', 'lugar', 'papel', 'papelNome', 'orquestrador', 'roda'] as const;
/** The most items one `inbox` answer hands over (the rest go in the next rounds). */
const INBOX_BATCH = 50;
/** A machine whose satellite (one call every 10 s) has not called for this long no longer routes messages. */
export const STALE_MS = 2 * 60_000;
/**
 * t-d461e003 (19/11, 14h48): a picture with no session, when the one kept has sessions, does not replace it at once: a
 * satellite under load whose `tmux ls` failed sent one and the Homologação left the Líder único's reach. It replaces the
 * kept one only once empties came `EMPTY_PICTURE_REPEATS` times in a row over at least `EMPTY_PICTURE_HOLD_MS` (the
 * satellite sends an empty that was not kept again every round, 10 s); any picture with sessions ends the run. The
 * satellite itself sends no picture when its tmux failed (satelite.ts): this is the registro's own defense.
 */
export const EMPTY_PICTURE_REPEATS = 3;
export const EMPTY_PICTURE_HOLD_MS = 60_000;

export interface RemoteBoard {
  readonly listar: readonly unknown[];
  readonly board?: MindscapeBoard;
}

export interface RemoteSession {
  readonly quemSou: Readonly<Record<string, unknown>>;
  readonly at?: number;
}

/** One machine's picture as its satellite sends it. */
export interface RemotePicture {
  readonly at: number;
  readonly quadros: Readonly<Record<string, RemoteBoard>>;
  readonly sessoes: Readonly<Record<string, RemoteSession>>;
}

/** An item waiting in a machine's queue, as `inbox` hands it (the message with its key). */
export interface RemoteRecado {
  readonly id: string;
  readonly message: OwnerMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The places without one session's own marks (`voce`, `podeMandar`): the board's list, the same for all. */
function placesOnly(listar: readonly unknown[]): unknown[] {
  return listar.map((place) => {
    if (!isRecord(place)) return place;
    const { voce: _voce, podeMandar: _podeMandar, ...rest } = place;
    return rest;
  });
}

/**
 * The satellite's side — its picture (retrato-local's) as it goes to the personal VPS: the sessions alive in its tmux
 * (`live`) by who they are, and each of their boards once. The Líder único (no place) and a closed session stay home.
 */
export function compactPicture(picture: BoardPicture | null, at: number, live: ReadonlySet<string>): RemotePicture {
  const boards = picturedBoards(picture);
  const quadros: Record<string, RemoteBoard> = {};
  const sessoes: Record<string, RemoteSession> = {};
  for (const [sid, session] of Object.entries(picture?.sessoes ?? {})) {
    const who = session.quemSou;
    if (!live.has(sid) || who.liderUnico === true || typeof who.lugar !== 'string' || typeof who.pasta !== 'string') continue;
    const pictured = boards.get(who.pasta);
    if (!pictured) continue;
    quadros[who.pasta] ??= { listar: placesOnly(pictured.listar), ...(pictured.board ? { board: pictured.board } : {}) };
    const quemSou: Record<string, unknown> = {};
    for (const field of WHO_FIELDS) if (who[field] !== undefined) quemSou[field] = who[field];
    sessoes[sid] = { quemSou, ...(typeof session.at === 'number' ? { at: session.at } : {}) };
  }
  return { at, quadros, sessoes };
}

/** A picture as it came over the network: the shape this module reads, the rest dropped; `null` = not one. */
export function parseRemotePicture(value: unknown): RemotePicture | null {
  if (!isRecord(value) || typeof value.at !== 'number' || !Number.isFinite(value.at) || !isRecord(value.quadros) || !isRecord(value.sessoes)) return null;
  const quadros: Record<string, RemoteBoard> = {};
  for (const [pasta, raw] of Object.entries(value.quadros)) {
    if (!pasta || !isRecord(raw) || !Array.isArray(raw.listar)) continue;
    const board = raw.board;
    const okBoard = isRecord(board) && isRecord(board.cards) && Array.isArray(board.links);
    quadros[pasta] = { listar: raw.listar, ...(okBoard ? { board: board as unknown as MindscapeBoard } : {}) };
  }
  const sessoes: Record<string, RemoteSession> = {};
  for (const [sid, raw] of Object.entries(value.sessoes)) {
    if (!SID_PATTERN.test(sid) || !isRecord(raw) || !isRecord(raw.quemSou)) continue;
    const who = raw.quemSou;
    if (who.liderUnico === true || typeof who.lugar !== 'string' || typeof who.pasta !== 'string' || !quadros[who.pasta]) continue;
    sessoes[sid] = { quemSou: who, ...(typeof raw.at === 'number' ? { at: raw.at } : {}) };
  }
  return { at: value.at, quadros, sessoes };
}

/** The machines' pictures by name, as kept here or read from `portoes-retrato/`. */
type PicturesByName = ReadonlyMap<string, RemotePicture>;

/** `local` with the other machines' sessions it does not have (see the header). Pure. */
function combinePictures(local: BoardPicture | null, pictures: PicturesByName): BoardPicture | null {
  const own = local?.sessoes ?? {};
  const ownBoards = picturedBoards(local);
  const sessoes: Record<string, PictureSession> = { ...own };
  const added = new Map<string, string>();
  for (const [name, picture] of pictures) {
    for (const [sid, session] of Object.entries(picture.sessoes)) {
      const pasta = session.quemSou.pasta as string;
      const quadro = picture.quadros[pasta];
      // Never over a session or a board of this VPS (the PC's picture rules), nor over another machine's.
      if (sessoes[sid] || !quadro || ownBoards.has(pasta)) continue;
      sessoes[sid] = { quemSou: session.quemSou, listar: quadro.listar, ...(quadro.board ? { board: quadro.board } : {}), at: session.at ?? picture.at, maquina: name };
      added.set(pasta, name);
    }
  }
  if (!added.size) return local;
  // The Líder único's `sessao_quem_sou` names the boards he can reach: the other machines' too. The picture made
  // here lists their names; the PC's, an object per board.
  for (const [sid, session] of Object.entries(sessoes)) {
    const quadros = session.quemSou.quadros;
    if (session.quemSou.liderUnico !== true || !Array.isArray(quadros)) continue;
    const names = quadros.every((item) => typeof item === 'string');
    const known = new Set(quadros.map((item) => (isRecord(item) ? item.pasta : item)));
    const more = [...added]
      .filter(([pasta]) => !known.has(pasta) && !known.has(lastSegment(pasta)))
      .map(([pasta, machine]) => (names ? lastSegment(pasta) : { nome: lastSegment(pasta), pasta, maquina: machine }));
    if (more.length) sessoes[sid] = { ...session, quemSou: { ...session.quemSou, quadros: [...quadros, ...more] } };
  }
  return { at: local?.at ?? 0, sessoes };
}

/** The machine heard within `STALE_MS` of `at` whose picture has `placeId` on `projectPath`. Pure. */
function machineIn(pictures: PicturesByName, heardAt: (name: string) => number | undefined, at: number, projectPath: string, placeId: string): string | undefined {
  for (const [name, picture] of pictures) {
    if (at - (heardAt(name) ?? -Infinity) > STALE_MS) continue;
    for (const session of Object.values(picture.sessoes)) if (session.quemSou.pasta === projectPath && session.quemSou.lugar === placeId) return name;
  }
  return undefined;
}

/** t-d461e003 — a board of another machine: that machine's gate name, the board's key and how it is named (`roda`). */
export interface BoardMachine {
  readonly name: string;
  readonly pasta: string;
  readonly label: string;
}

/** How the sessions of machine `name` name it (`roda`); its gate name when none says. Pure. */
function labelIn(pictures: PicturesByName, name: string): string {
  const sessions = Object.values(pictures.get(name)?.sessoes ?? {});
  return sessions.map((session) => session.quemSou.roda).find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? name;
}

/** The machine heard within `STALE_MS` of `at` whose picture has the board `quadro` (folder or last name). Pure. */
function boardMachineIn(pictures: PicturesByName, heardAt: (name: string) => number | undefined, at: number, quadro: string): BoardMachine | undefined {
  for (const [name, picture] of pictures) {
    if (at - (heardAt(name) ?? -Infinity) > STALE_MS) continue;
    const pasta = Object.keys(picture.quadros).find((key) => key === quadro || lastSegment(key) === quadro);
    if (pasta) return { name, pasta, label: labelIn(pictures, name) };
  }
  return undefined;
}

/** What reads the other machines' pictures: the registro's store, or the entregador's reader of its files. */
export interface RemotePictureView {
  /** This VPS's picture with the other machines' sessions it does not have (see the header). Pure of `local`. */
  combine(local: BoardPicture | null): BoardPicture | null;
  /** The machine whose fresh picture (see `STALE_MS`) has `placeId` on the board `projectPath`; `undefined` = none. */
  machineOf(projectPath: string, placeId: string): string | undefined;
  /**
   * t-d461e003 — the machine whose fresh picture has the board `quadro` (its folder, or the folder's last name): its gate
   * name, the board's key and how its sessions name that machine (`roda`). `undefined` = none.
   */
  boardMachine(quadro: string): BoardMachine | undefined;
  /** How the sessions of machine `name` name it (`roda`); its gate name when none says. */
  labelOf(name: string): string;
}

export interface RemotePictures extends RemotePictureView {
  /**
   * Keeps `picture` as machine `name`'s, unless the one kept is as new or newer, or it is an empty one held (see
   * `EMPTY_PICTURE_REPEATS`). `true` = kept.
   */
  accept(name: string, picture: RemotePicture): boolean;
  /** A message for a place of another machine: queued there (`null` = it runs on no other machine). */
  queue(message: OwnerMessage): Promise<string | null>;
  /** The satellite of `name` took `entregues`; what still waits for it. */
  inbox(name: string, entregues: readonly string[]): RemoteRecado[];
}

export function createRemotePictures(deps: {
  readonly dir: string;
  readonly io: ConfigIoDeps;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** Passo 9 — the entregador runs apart and reads these files: when each satellite was heard goes to `portoes-ouvido/`. */
  readonly shareHeard?: boolean;
}): RemotePictures {
  const log = deps.log ?? ((line: string) => console.log(`[oraculo] retrato do portão: ${line}`));
  const now = deps.now ?? Date.now;
  const picturesDir = join(deps.dir, PICTURES_DIR);
  const heardDir = join(deps.dir, HEARD_DIR);
  const pictures = new Map<string, RemotePicture>();
  /** When each machine's satellite last called here (picture or queue). */
  const heard = new Map<string, number>();
  /** The run of empty pictures held per machine: when the first came (this clock) and how many. */
  const empties = new Map<string, { readonly since: number; readonly count: number }>();
  const hear = (name: string): void => {
    const at = now();
    heard.set(name, at);
    if (!deps.shareHeard) return;
    try {
      mkdirSync(heardDir, { recursive: true, mode: 0o700 });
      const file = join(heardDir, name);
      writeFileSync(`${file}.tmp`, `${at}\n`, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      log(`não gravei quando ouvi ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    for (const file of readdirSync(picturesDir)) {
      const name = file.endsWith('.json') ? file.slice(0, -'.json'.length) : '';
      if (!GATE_NAME.test(name)) continue;
      try {
        const parsed = parseRemotePicture(JSON.parse(readFileSync(join(picturesDir, file), 'utf8')));
        if (parsed) {
          pictures.set(name, parsed);
          hear(name);
        }
      } catch {
        log(`${file} ilegível: fica de lado até o próximo retrato dessa máquina.`);
      }
    }
  } catch {
    // none yet
  }
  const queues = new Map<string, Relay>();
  const queueOf = (name: string): Relay => {
    let queue = queues.get(name);
    if (!queue) {
      queue = createRelay({ filePath: join(deps.dir, QUEUES_DIR, `${name}.json`), io: deps.io, ...(deps.now ? { now: deps.now } : {}) });
      queues.set(name, queue);
    }
    return queue;
  };
  let version = 0;
  let memo: { local: BoardPicture | null; version: number; out: BoardPicture | null } | null = null;

  const machineOf = (projectPath: string, placeId: string): string | undefined => machineIn(pictures, (name) => heard.get(name), now(), projectPath, placeId);

  return {
    accept(name, picture) {
      if (!GATE_NAME.test(name)) return false;
      hear(name);
      const kept = pictures.get(name);
      if (kept && kept.at >= picture.at) return false;
      if (Object.keys(picture.sessoes).length === 0 && kept && Object.keys(kept.sessoes).length > 0) {
        const at = now();
        const run = empties.get(name);
        const next = { since: run?.since ?? at, count: (run?.count ?? 0) + 1 };
        if (next.count < EMPTY_PICTURE_REPEATS || at - next.since < EMPTY_PICTURE_HOLD_MS) {
          empties.set(name, next);
          log(`${name} mandou um retrato sem sessões (${next.count}º seguido): o último com sessões fica até o vazio se repetir.`);
          return false;
        }
      }
      empties.delete(name);
      mkdirSync(picturesDir, { recursive: true, mode: 0o700 });
      const file = join(picturesDir, `${name}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify(picture), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      pictures.set(name, picture);
      version += 1;
      return true;
    },

    combine(local) {
      if (memo && memo.local === local && memo.version === version) return memo.out;
      const out = combinePictures(local, pictures);
      memo = { local, version, out };
      return out;
    },

    machineOf,

    boardMachine: (quadro) => boardMachineIn(pictures, (name) => heard.get(name), now(), quadro),

    labelOf: (name) => labelIn(pictures, name),

    async queue(message) {
      if (!message.placeId) return null;
      const name = machineOf(message.projectPath, message.placeId);
      if (!name) return null;
      await queueOf(name).send(message, 0);
      return name;
    },

    inbox(name, entregues) {
      if (GATE_NAME.test(name)) hear(name);
      const queue = queueOf(name);
      for (const id of entregues) {
        const item = queue.pending().find((candidate) => candidate.id === id);
        if (item) queue.ack(id, item.message.placeId ? { placeId: item.message.placeId } : 'lider');
      }
      return queue
        .pending()
        .slice(0, INBOX_BATCH)
        .map((item) => ({ id: item.id, message: { ...item.message, key: item.key } }));
    },
  };
}

/**
 * Passo 9 (t-5358d400) — the entregador apart: the other machines' pictures as the registro keeps them, read only
 * (`portoes-retrato/*.json`, parsed again when a file's mtime moves) with when the registro last heard each satellite
 * (`portoes-ouvido/<name>`): the same `combine`, `machineOf` and `boardMachine` as the registro's. A machine the registro never said it
 * heard does not route (its picture still shows, as the registro's own does after its satellite went quiet).
 */
export function createRemotePicturesReader(deps: { readonly dir: string; readonly now?: () => number }): RemotePictureView {
  const now = deps.now ?? Date.now;
  const picturesDir = join(deps.dir, PICTURES_DIR);
  const heardDir = join(deps.dir, HEARD_DIR);
  const parsed = new Map<string, { readonly mtime: number; readonly picture: RemotePicture | null }>();
  let current: { readonly key: string; readonly pictures: PicturesByName } = { key: '', pictures: new Map() };
  let memo: { local: BoardPicture | null; key: string; out: BoardPicture | null } | null = null;

  const read = (): typeof current => {
    let files: string[];
    try {
      files = readdirSync(picturesDir);
    } catch {
      files = [];
    }
    const pictures = new Map<string, RemotePicture>();
    const marks: string[] = [];
    const seen = new Set<string>();
    for (const file of files.sort()) {
      const name = file.endsWith('.json') ? file.slice(0, -'.json'.length) : '';
      if (!GATE_NAME.test(name)) continue;
      let mtime: number;
      try {
        mtime = statSync(join(picturesDir, file)).mtimeMs;
      } catch {
        continue;
      }
      seen.add(name);
      let entry = parsed.get(name);
      if (entry?.mtime !== mtime) {
        let picture: RemotePicture | null = null;
        try {
          picture = parseRemotePicture(JSON.parse(readFileSync(join(picturesDir, file), 'utf8')));
        } catch {
          // being written, or not a picture: kept aside until its next write
        }
        entry = { mtime, picture };
        parsed.set(name, entry);
      }
      if (!entry.picture) continue;
      pictures.set(name, entry.picture);
      marks.push(`${name}:${mtime}`);
    }
    for (const name of parsed.keys()) if (!seen.has(name)) parsed.delete(name);
    const key = marks.join('|');
    if (key !== current.key) current = { key, pictures };
    return current;
  };

  const heardAt = (name: string): number | undefined => {
    try {
      const at = Number(readFileSync(join(heardDir, name), 'utf8').trim());
      return Number.isFinite(at) && at > 0 ? at : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    combine(local) {
      const { key, pictures } = read();
      if (memo && memo.local === local && memo.key === key) return memo.out;
      const out = combinePictures(local, pictures);
      memo = { local, key, out };
      return out;
    },
    machineOf: (projectPath, placeId) => machineIn(read().pictures, heardAt, now(), projectPath, placeId),
    // t-d461e003 — the opening on another machine's board: the entregador asks the registro only for a board a fresh
    // picture here has (the registro keeps the queues, `portoes-abrir/`).
    boardMachine: (quadro) => boardMachineIn(read().pictures, heardAt, now(), quadro),
    labelOf: (name) => labelIn(read().pictures, name),
  };
}
