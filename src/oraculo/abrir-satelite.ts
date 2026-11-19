// t-d461e003 (19/11) — com o PC fora, o Líder único da VPS pessoal abre sessão num quadro que vive em outra máquina (o
// Homologação, na Homologações). The opening goes to that machine's satellite, which opens it there with its own
// abrir-local, and the answer comes back:
//
// - The Líder único's `sessao_abrir` reaches this VPS's abrir-local (the entregador's gate). A board its picture does not
//   have, but a fresh picture of another machine does (retrato-satelite.ts, `boardMachine`), becomes an order in that
//   machine's queue here (`<dir>/portoes-abrir/<name>.json`, 600): `request`. Apart (two units), the entregador asks the
//   registro, which keeps the queues, through `POST /v1/portao/abrir` with its local gate's token (`createRemoteOpenClient`).
// - The order's key is the opening's (`openingKey`: board, role, request, name). A repeat within 10 min answers the same:
//   "aceito" while it waits, the satellite's answer once it came (an error answer is said once and dropped, so the next
//   repeat tries again).
// - The satellite asks for its orders at each round (`POST /v1/portao/aberturas`, its gate's token), opens each with its
//   abrir-local (`openFor`: the same rules from the board on; its own `abertas.json` answers a repeat, so an order handed
//   twice opens once) and says the answers in the next call. The kit of roles goes with the orders when it changed (its
//   hash), with this machine's name in `place` and no `homeRelativeDir`: there the board's folder comes from its own
//   sessions of that board (abrir-local's `folderFromSessions`).
//
// Why "aceito" and not a wait for the session: the satellite calls every 10 s, the setup may clone or make a worktree,
// the CLI cuts an MCP call at 60 s, and the openings of one machine go in line (abrir-local): holding the call would hold
// every other opening. The new place shows in the satellite's picture within seconds; the repeat gives it by name.
//
// Nothing here carries a key: the kit has none (open-kit.ts), an order is the call's own words.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPEN_KIT_VERSION, type OpenKit } from '../main/open-kit';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import { LEADER_ROLE_ID } from '../shared/roles';
import { NO_KIT, openingKey, REPEAT_MS, type OpeningOrder } from './abrir-local';
import type { OpenCall } from './gate-abrir';
import { GATE_OPEN_PATH, GATE_OPENINGS_PATH } from './portoes';
import type { RemotePictures, RemotePictureView } from './retrato-satelite';
import { postJson, type SatelliteDeps, type SatellitePost } from './satelite';

const OPENINGS_DIR = 'portoes-abrir';
/** The satellite's copy of the registro's kit (`{hash, kit}`). */
export const REMOTE_KIT_FILE = 'abrir-remoto.json';
const GATE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY_PATTERN = /^[0-9a-f]{32}$/;
const MAX_ORDERS = 20;

/** One order as it waits here and goes to the satellite. */
export interface RemoteOpening extends OpeningOrder {
  readonly id: string;
  readonly at: number;
}

interface QueueEntry {
  readonly order: RemoteOpening;
  readonly answer?: { readonly ok: boolean; readonly text: string };
}

export interface RemoteOpenAnswer {
  readonly id: string;
  readonly ok: boolean;
  readonly text: string;
}

export interface RemoteOpenings {
  /** The Líder único's opening on another machine's board: queued there; `null` = no fresh picture has that board. */
  request(call: OpenCall): BrowserToolOutcome | null;
  /** The satellite `name` answered `respostas` and has the kit of `kitHash`: what waits for it, and the kit if it changed. */
  exchange(name: string, respostas: readonly RemoteOpenAnswer[], kitHash: string | null): { readonly aberturas: RemoteOpening[]; readonly kit?: { readonly hash: string; readonly kit: OpenKit } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const lastSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const fail = (text: string): BrowserToolOutcome => ({ kind: 'error', text });

/** The kit as it goes to machine `name`: its name in `place`, and no folder of the personal VPS. Pure. */
export function kitForMachine(kit: OpenKit, name: string, label: string): OpenKit {
  return { ...kit, place: { id: name, label }, boards: kit.boards.map((board) => ({ ...board, homeRelativeDir: '' })) };
}

const kitHashOf = (kit: OpenKit): string => createHash('sha256').update(JSON.stringify(kit)).digest('hex').slice(0, 32);

function parseKit(value: unknown): OpenKit | null {
  if (!isRecord(value) || value.version !== OPEN_KIT_VERSION || !Array.isArray(value.roles) || !Array.isArray(value.boards) || !isRecord(value.place)) return null;
  if (typeof value.place.label !== 'string' || typeof value.place.id !== 'string') return null;
  return value as unknown as OpenKit;
}

function parseOrder(value: unknown): RemoteOpening | null {
  if (!isRecord(value)) return null;
  const { id, at, pasta, papel, pedido, nome, tarefa } = value;
  if (typeof id !== 'string' || !KEY_PATTERN.test(id) || typeof at !== 'number' || typeof pasta !== 'string' || !pasta || typeof papel !== 'string' || !papel || typeof pedido !== 'string' || !pedido) return null;
  if ((nome !== undefined && typeof nome !== 'string') || (tarefa !== undefined && typeof tarefa !== 'string')) return null;
  return { id, at, pasta, papel, pedido, ...(typeof nome === 'string' ? { nome } : {}), ...(typeof tarefa === 'string' ? { tarefa } : {}) };
}

/** The registro's side (or the entregador's, with the registro in its process). */
export function createRemoteOpenings(deps: {
  readonly dir: string;
  readonly pictures: Pick<RemotePictures, 'boardMachine' | 'labelOf'>;
  readonly kit: () => OpenKit | null;
  readonly now?: () => number;
}): RemoteOpenings {
  const now = deps.now ?? Date.now;
  const fileOf = (name: string): string => join(deps.dir, OPENINGS_DIR, `${name}.json`);

  function load(name: string): Record<string, QueueEntry> {
    const at = now();
    try {
      const raw = JSON.parse(readFileSync(fileOf(name), 'utf8')) as unknown;
      if (!isRecord(raw)) return {};
      const kept: Record<string, QueueEntry> = {};
      for (const [key, entry] of Object.entries(raw)) {
        if (!isRecord(entry)) continue;
        const order = parseOrder(entry.order);
        if (!order || order.id !== key || at - order.at >= REPEAT_MS) continue;
        const answer = isRecord(entry.answer) && typeof entry.answer.ok === 'boolean' && typeof entry.answer.text === 'string' ? { ok: entry.answer.ok, text: entry.answer.text } : undefined;
        kept[key] = { order, ...(answer ? { answer } : {}) };
      }
      return kept;
    } catch {
      return {};
    }
  }

  function save(name: string, queue: Record<string, QueueEntry>): void {
    mkdirSync(join(deps.dir, OPENINGS_DIR), { recursive: true, mode: 0o700 });
    const file = fileOf(name);
    writeFileSync(`${file}.tmp`, JSON.stringify(queue), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  return {
    request(call) {
      if (!call.quadro) return null;
      const target = deps.pictures.boardMachine(call.quadro);
      if (!target) return null;
      const board = lastSegment(target.pasta);
      const where = call.onde?.trim().toLowerCase();
      if (where && !['aqui', 'auto', target.name, target.label.toLowerCase()].includes(where)) {
        return fail(`Com o PC desligado, o quadro ${board} só abre em ${target.label}, a máquina dele: use "onde": "${target.label}" (ou deixe sem).`);
      }
      const kit = deps.kit();
      if (!kit) return fail(NO_KIT);
      if (call.papel === LEADER_ROLE_ID) return fail('Não abri: com o PC desligado não abro um Líder (o Líder do quadro o dono põe pelo PC). Abra com outro papel.');
      const role = kit.roles.find((candidate) => candidate.id === call.papel);
      if (!role) return fail(`Papel "${call.papel}" não está no kit que o PC deixou (${kit.roles.map((candidate) => candidate.id).join(', ') || 'nenhum'}).`);
      if (!kit.boards.some((candidate) => candidate.localCwd === target.pasta)) return fail(`O kit que o PC deixou não traz o quadro ${board}. Tente quando o PC ligar.`);
      const nome = call.nome ?? role.name;
      const id = openingKey(target.pasta, role.id, call.pedido, nome);
      const queue = load(target.name);
      const entry = queue[id];
      if (entry?.answer) {
        // An error is said once: the next repeat tries again (the machine may have room, or a folder, by then).
        if (!entry.answer.ok) {
          const { [id]: _said, ...rest } = queue;
          save(target.name, rest);
        }
        return { kind: entry.answer.ok ? 'text' : 'error', text: entry.answer.text };
      }
      if (!entry) save(target.name, { ...queue, [id]: { order: { id, at: now(), pasta: target.pasta, papel: role.id, pedido: call.pedido, nome, ...(call.tarefa ? { tarefa: call.tarefa } : {}) } } });
      return {
        kind: 'text',
        text: JSON.stringify({
          quadro: board,
          nome,
          papel: role.id,
          roda: target.label,
          estado: entry ? `aguardando ${target.label}` : 'pedido aceito',
          porque: `O PC está desligado e o quadro ${board} vive em ${target.label}: o pedido foi à máquina de lá, que abre a sessão em até um minuto. Repita esta mesma chamada (mesmos quadro, papel, pedido e nome) para receber o lugar; a repetição nunca abre outra.`,
        }),
      };
    },

    exchange(name, respostas, kitHash) {
      if (!GATE_NAME.test(name)) return { aberturas: [] };
      const queue = load(name);
      let changed = false;
      for (const answer of respostas) {
        const entry = queue[answer.id];
        if (!entry || entry.answer) continue;
        queue[answer.id] = { ...entry, answer: { ok: answer.ok, text: answer.text } };
        changed = true;
      }
      if (changed) save(name, queue);
      const aberturas = Object.values(queue)
        .filter((entry) => !entry.answer)
        .map((entry) => entry.order)
        .slice(0, MAX_ORDERS);
      const kit = deps.kit();
      if (!kit) return { aberturas };
      const theirs = kitForMachine(kit, name, deps.pictures.labelOf(name));
      const hash = kitHashOf(theirs);
      return hash === kitHash ? { aberturas } : { aberturas, kit: { hash, kit: theirs } };
    },
  };
}

/** The body of `POST /v1/portao/abrir` as an `OpenCall`, or `null`. */
export function openCallOf(value: unknown): OpenCall | null {
  if (!isRecord(value)) return null;
  const { quadro, onde, papel, pedido, nome, tarefa } = value;
  if (typeof quadro !== 'string' || !quadro || typeof papel !== 'string' || !papel || typeof pedido !== 'string' || !pedido || pedido.length > 40_000) return null;
  for (const optional of [onde, nome, tarefa]) if (optional !== undefined && typeof optional !== 'string') return null;
  return {
    tool: 'sessao_abrir',
    quadro,
    papel,
    pedido,
    ...(typeof onde === 'string' ? { onde } : {}),
    ...(typeof nome === 'string' ? { nome } : {}),
    ...(typeof tarefa === 'string' ? { tarefa } : {}),
  };
}

/** The body of `POST /v1/portao/aberturas`: the answers and the kit's hash, or `null`. */
export function openingsBodyOf(value: Record<string, unknown>): { readonly respostas: RemoteOpenAnswer[]; readonly kitHash: string | null } | null {
  const raw = value.respostas ?? [];
  if (!Array.isArray(raw) || raw.length > 100) return null;
  const respostas: RemoteOpenAnswer[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.ok !== 'boolean' || typeof item.text !== 'string' || item.text.length > 20_000) return null;
    respostas.push({ id: item.id, ok: item.ok, text: item.text });
  }
  if (value.kit !== undefined && value.kit !== null && typeof value.kit !== 'string') return null;
  return { respostas, kitHash: typeof value.kit === 'string' ? value.kit : null };
}

/**
 * The entregador apart: the Líder único's opening on another machine's board asked of the registro (its local gate's
 * token), which alone writes `portoes-abrir/`. With `view` (the entregador's reader of the registro's pictures,
 * retrato-satelite.ts), asked only for a board a fresh picture has: any other is this machine's refusal, with no call.
 * `null` = the registro knows no other machine with that board (or is older than this route).
 */
export function createRemoteOpenClient(deps: SatelliteDeps & { readonly view?: Pick<RemotePictureView, 'boardMachine'> }): (call: OpenCall) => Promise<BrowserToolOutcome | null> {
  const post = deps.post ?? postJson;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_OPEN_PATH}`;
  return async (call) => {
    if (deps.view && (!call.quadro || !deps.view.boardMachine(call.quadro))) return null;
    const token = deps.token();
    if (!token) return null;
    const { tool: _tool, ...rest } = call;
    const result = await post(url, token, JSON.stringify({ call: rest }), deps.timeoutMs ?? 10_000);
    if (typeof result !== 'object') return fail('O registro do Oráculo nesta máquina não respondeu; nada foi pedido. Tente de novo.');
    if (result.status === 404) return null;
    try {
      const answer = JSON.parse(result.body) as { conhecido?: unknown; ok?: unknown; text?: unknown };
      if (answer.conhecido === false) return null;
      if (result.status === 200 && typeof answer.ok === 'boolean' && typeof answer.text === 'string') return { kind: answer.ok ? 'text' : 'error', text: answer.text };
    } catch {
      // below
    }
    return fail(`O registro do Oráculo recusou o pedido (HTTP ${result.status}).`);
  };
}

/** The satellite's copy of the registro's kit; `null` = none yet. */
export function readRemoteKit(dir: string): { readonly hash: string; readonly kit: OpenKit } | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, REMOTE_KIT_FILE), 'utf8')) as unknown;
    if (!isRecord(raw) || typeof raw.hash !== 'string') return null;
    const kit = parseKit(raw.kit);
    return kit ? { hash: raw.hash, kit } : null;
  } catch {
    return null;
  }
}

/** The satellite's side: one round asks for the orders (saying the answers it has) and opens each one here. */
export function createSatelliteOpenings(
  deps: SatelliteDeps & {
    readonly dir: string;
    readonly open: (order: OpeningOrder) => Promise<BrowserToolOutcome>;
    readonly log?: (line: string) => void;
  },
): { round(): Promise<void> } {
  const post: (url: string, token: string, body: string, timeoutMs: number) => Promise<SatellitePost> = deps.post ?? postJson;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_OPENINGS_PATH}`;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] satélite: ${line}`));
  /** Answers not yet said (said = the registro answered 200 to the call that carried them). */
  const unsaid = new Map<string, RemoteOpenAnswer>();
  /** Orders already opened here, until the registro stops handing them. */
  const done = new Set<string>();

  async function exchange(token: string): Promise<RemoteOpening[] | null> {
    const saying = [...unsaid.values()];
    const result = await post(url, token, JSON.stringify({ respostas: saying, kit: readRemoteKit(deps.dir)?.hash ?? null }), deps.timeoutMs ?? 15_000);
    // 404: a registro older than this route; nothing to do.
    if (typeof result !== 'object' || result.status !== 200) return null;
    for (const said of saying) unsaid.delete(said.id);
    let parsed: { aberturas?: unknown; kit?: unknown };
    try {
      parsed = JSON.parse(result.body) as typeof parsed;
    } catch {
      return [];
    }
    if (isRecord(parsed.kit) && typeof parsed.kit.hash === 'string' && parseKit(parsed.kit.kit)) {
      const file = join(deps.dir, REMOTE_KIT_FILE);
      writeFileSync(`${file}.tmp`, JSON.stringify({ hash: parsed.kit.hash, kit: parsed.kit.kit }), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    }
    const orders = Array.isArray(parsed.aberturas) ? parsed.aberturas.map(parseOrder).filter((order): order is RemoteOpening => order !== null) : [];
    for (const id of [...done]) if (!orders.some((order) => order.id === id)) done.delete(id);
    return orders;
  }

  return {
    async round() {
      const token = deps.token();
      if (!token) return;
      const orders = await exchange(token);
      if (!orders?.length) return;
      for (const order of orders) {
        if (done.has(order.id) || unsaid.has(order.id)) continue;
        let outcome: BrowserToolOutcome;
        try {
          outcome = await deps.open(order);
        } catch (error) {
          log(`abertura ${order.id} fica para a próxima volta: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        unsaid.set(order.id, { id: order.id, ok: outcome.kind !== 'error', text: outcome.text ?? '' });
        done.add(order.id);
      }
      if (unsaid.size) await exchange(token);
    },
  };
}
