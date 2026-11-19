// Oráculo na VPS (docs/planos/oraculo-na-vps.md, "PC desligado") — the relay of what only the PC can deliver: the
// owner's words on a card and his decision (to the session that owns the task) and a "Pedir" (to the Líder único),
// which live on the PC's board. The daemon writes the message here (`<dir>/fila.json`, temp → rename) and tells the
// PC (`notify` → an events-stream `fila`); the PC delivers through today's driver and acks with where it went.
//
// Nothing vanishes: a message waits on disk until an ack that went somewhere ("nobody open" keeps it), and an
// unreadable `fila.json` is set aside, never written over. Nothing arrives twice: a retry of the same request (the
// message's `key`: the decision event, the phone's request id) joins the pending item, and one already delivered
// answers where it went. Two messages of the same words but different events are two messages (revisão do #299).
//
// Recado vencido (r-3ac3e0e4, vencimento.ts): an item older than `STALE_MS` still waiting is never handed out. It is
// marked `vencidoEm` (kept, terminal: a retry of its key does not revive it), logged, and a recado a session sent leaves
// a notice to it in this same queue, in the same write (one per item, `vencido:<key>`); the owner's words never go
// stale, they go marked "(atrasada: …)". Swept when the queue is opened (the daemon's boot) and at every `pending()`.
// The age crosses hops: an item's `at` is the message's `sentAt` when it came with one, and what it hands out carries it
// (`handOut`), so a notice that waited 5 h in a Líder's queue here does not start again at zero (revisão do #524). One
// that arrives already stale is recorded stale with no notice (the queue that let it age tells). An item handed out
// near the limit waits `ACK_GRACE_MS` for its ack before it can go stale, and is not handed out again meanwhile. On
// disk a stale item also carries `deliveredTo: {placeId: ''}` + `deliveredAt`, so a daemon of before this rule (a
// rollback, an old satellite) reads it as delivered, never as pending.

import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import type { DeliverOwnerMessage, OwnerMessage } from '../main/ledger-card-writer';
import type { ConfigIoDeps } from '../main/config-store';
import { ACK_GRACE_MS, ageText, expiryNotice, isOwnerMessage, isStale, markLate, relaySenderOf, sentAtOf } from './vencimento';

export interface RelayItem {
  readonly id: string;
  readonly key: string;
  readonly message: OwnerMessage;
  readonly at: number;
  /** Set by the ack. */
  readonly deliveredTo?: Exclude<LedgerDeliveredTo, null>;
  readonly deliveredAt?: number;
  /** Recado vencido: when it went stale undelivered (terminal; never handed out again). */
  readonly vencidoEm?: number;
}

export interface Relay {
  /**
   * Queues `message` (or joins the same one) and waits up to `waitMs` for the PC's ack. `'pendente'` = it waits in
   * the queue (the PC is off or did not answer in time); it still goes when the PC comes back.
   */
  send(message: OwnerMessage, waitMs: number): Promise<Exclude<LedgerDeliveredTo, null> | 'pendente'>;
  /** What still waits to go (stale items swept first: never handed out). */
  pending(): RelayItem[];
  /**
   * What goes out now to whoever delivers it (the PC's GET, a satellite's inbox, the notices' round): `pending()` but
   * an item handed out near the limit and still unacked (it waits for its ack); each message carries `sentAt`.
   */
  handOut(): RelayItem[];
  /** The item of `id`, whatever its state; `undefined` = not kept. */
  byId(id: string): RelayItem | undefined;
  /** The item of `key`, pending or delivered (kept 7 days); `undefined` = the relay never had it. */
  byKey(key: string): RelayItem | undefined;
  /** The PC delivered `id`; `null` (nobody open) keeps it queued. `true` = this ack took it out. */
  ack(id: string, deliveredTo: LedgerDeliveredTo): boolean;
}

/** A delivered message answers a retry for this long; an undelivered one gives up after `PENDING_DAYS`. */
const DELIVERED_DAYS = 7;
const PENDING_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): RelayItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.key !== 'string' || typeof value.at !== 'number' || !isRecord(value.message)) return null;
  const { projectPath, placeId, text, leaderText } = value.message;
  if (typeof projectPath !== 'string' || typeof placeId !== 'string' || typeof text !== 'string' || typeof leaderText !== 'string') return null;
  const to = value.deliveredTo;
  const deliveredTo = to === 'lider' ? 'lider' : isRecord(to) && typeof to.placeId === 'string' ? { placeId: to.placeId } : undefined;
  return {
    id: value.id,
    key: value.key,
    at: value.at,
    message: { projectPath, placeId, text, leaderText },
    // A stale item's `deliveredTo` on disk is only for a daemon of before the rule: here it was never delivered.
    ...(typeof value.vencidoEm === 'number'
      ? { vencidoEm: value.vencidoEm }
      : deliveredTo
        ? { deliveredTo, ...(typeof value.deliveredAt === 'number' ? { deliveredAt: value.deliveredAt } : {}) }
        : {}),
  };
}

/** On disk a stale item reads as delivered to nobody to a daemon of before the rule (it never hands it out again). */
const toDisk = (item: RelayItem): RelayItem =>
  item.vencidoEm !== undefined ? { ...item, deliveredTo: { placeId: '' }, deliveredAt: item.vencidoEm } : item;

export function createRelay(deps: {
  readonly filePath: string;
  readonly io: ConfigIoDeps;
  readonly now?: () => number;
  readonly notify?: () => void;
  readonly log?: (line: string) => void;
}): Relay {
  const { filePath, io } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] ${line}`));
  const waiters = new Map<string, Set<(to: Exclude<LedgerDeliveredTo, null>) => void>>();

  function read(): RelayItem[] {
    const text = io.readFileText(filePath);
    if (text === null) {
      if (io.existsSync(filePath)) throw new Error('fila.json existe mas não pôde ser lida');
      return [];
    }
    try {
      const raw = JSON.parse(text) as { items?: unknown };
      if (!Array.isArray(raw.items)) throw new Error('sem itens');
      return raw.items.map(parseItem).filter((item): item is RelayItem => item !== null);
    } catch {
      // Kept aside for a human, so the next write does not erase what was waiting in it.
      io.renameFile(filePath, filePath.replace(/\.json$/, `.ilegivel-${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`));
      console.error('[oraculo] fila.json ilegível: guardada à parte.');
      return [];
    }
  }

  function write(items: readonly RelayItem[]): void {
    const cutoff = now();
    const kept = items.filter((item) => {
      const closed = item.deliveredAt ?? item.vencidoEm;
      return closed !== undefined ? cutoff - closed < DELIVERED_DAYS * DAY : cutoff - item.at < PENDING_DAYS * DAY;
    });
    const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
      if (!io.existsSync(dirname(filePath))) io.mkdirSync(dirname(filePath));
      io.writeFileText(tmp, JSON.stringify({ items: kept.map(toDisk) }, null, 2));
      io.renameFile(tmp, filePath);
    } catch (error) {
      io.unlinkFile(tmp);
      throw error;
    }
  }

  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  /** When each item was last handed out (memory only): one near the limit waits `ACK_GRACE_MS` for its ack. */
  const handedOut = new Map<string, number>();
  const awaitingAck = (item: RelayItem, at: number): boolean => {
    const out = handedOut.get(item.id);
    return out !== undefined && at - out < ACK_GRACE_MS;
  };

  /**
   * Recado vencido: the stale items still waiting turn `vencidoEm` (a sender's recado leaves its notice here, in the
   * same write), the owner's are marked late; returns what still waits. Sync: nothing interleaves.
   */
  function sweep(): RelayItem[] {
    const items = read();
    const at = now();
    let changed = false;
    const notices: RelayItem[] = [];
    const next = items.map((item) => {
      if (item.deliveredTo || item.vencidoEm !== undefined || !isStale(item.at, at) || awaitingAck(item, at)) return item;
      const { message } = item;
      if (isOwnerMessage(item.key, message.text)) {
        const text = markLate(message.text, item.at);
        const leaderText = markLate(message.leaderText, item.at);
        if (text === message.text && leaderText === message.leaderText) return item;
        changed = true;
        return { ...item, message: { ...message, text, leaderText } };
      }
      changed = true;
      const to = message.placeId || 'o Líder único';
      log(`${name}: ${item.id} venceu sem entrega (${ageText(item.at, at)}, para ${to}).`);
      const notice = expiryNotice({ key: item.key, projectPath: message.projectPath, from: relaySenderOf(item.key), to, createdAt: item.at, text: message.text });
      if (notice && !items.some((other) => other.key === notice.key) && !notices.some((other) => other.key === notice.key))
        notices.push({ id: randomUUID(), key: notice.key!, message: notice, at });
      return { ...item, vencidoEm: at };
    });
    if (!changed) return next;
    const all = [...next, ...notices];
    write(all);
    if (notices.length) deps.notify?.();
    return all;
  }

  // The queue as it was left (a restart, hours later): stale items never go out.
  try {
    sweep();
  } catch (error) {
    log(`${name}: não deu para conferir os vencidos ao abrir: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    async send(message, waitMs) {
      const key = message.key ?? `unico:${randomUUID()}`;
      const items = read();
      const same = message.key ? items.find((item) => item.key === key) : undefined;
      if (same?.deliveredTo) return same.deliveredTo;
      // A retry of a stale one does not revive it.
      if (same?.vencidoEm !== undefined) return 'pendente';
      let item = same;
      if (!item) {
        const at = now();
        item = { id: randomUUID(), key, message, at: sentAtOf(message, at) };
        // Already stale on arrival (it aged in the queue before this one, which tells its sender): kept, never out.
        if (isStale(item.at, at) && !isOwnerMessage(key, message.text)) {
          write([...items, { ...item, vencidoEm: at }]);
          log(`${name}: ${item.id} chegou vencido (${ageText(item.at, at)}, para ${message.placeId || 'o Líder único'}): não sai.`);
          return 'pendente';
        }
        write([...items, item]);
      }
      deps.notify?.();
      if (waitMs <= 0) return 'pendente';
      const id = item.id;
      return new Promise((resolve) => {
        const done = (to: Exclude<LedgerDeliveredTo, null> | 'pendente'): void => {
          clearTimeout(timer);
          waiters.get(id)?.delete(onAck);
          resolve(to);
        };
        const onAck = (to: Exclude<LedgerDeliveredTo, null>): void => done(to);
        const timer = setTimeout(() => done('pendente'), waitMs);
        const set = waiters.get(id) ?? new Set();
        set.add(onAck);
        waiters.set(id, set);
      });
    },
    pending() {
      return sweep().filter((item) => !item.deliveredTo && item.vencidoEm === undefined);
    },
    handOut() {
      const at = now();
      const out = sweep().filter((item) => !item.deliveredTo && item.vencidoEm === undefined && !(isStale(item.at, at) && awaitingAck(item, at)));
      for (const id of [...handedOut.keys()]) if (at - handedOut.get(id)! >= ACK_GRACE_MS) handedOut.delete(id);
      for (const item of out) handedOut.set(item.id, at);
      return out.map((item) => ({ ...item, message: { ...item.message, sentAt: item.at } }));
    },
    byKey(key) {
      return read().find((item) => item.key === key);
    },
    byId(id) {
      return read().find((item) => item.id === id);
    },
    ack(id, deliveredTo) {
      if (deliveredTo === null) return false;
      const items = read();
      const index = items.findIndex((item) => item.id === id);
      // A stale one was already told as not delivered (its ack came after the grace): left as it is.
      if (index < 0 || items[index]!.deliveredTo || items[index]!.vencidoEm !== undefined) return false;
      handedOut.delete(id);
      items[index] = { ...items[index]!, deliveredTo, deliveredAt: now() };
      write(items);
      for (const resolve of waiters.get(id) ?? []) resolve(deliveredTo);
      waiters.delete(id);
      return true;
    },
  };
}

/**
 * t-4c60b815 — the card writer's way out on the VPS: the session that owns the task, when it runs on this machine,
 * hears it from `local` (its recados), with the PC off; only what runs elsewhere (or the Líder único) waits for the PC
 * in the relay. A key the relay already holds stays there (it joins, or answers where the PC delivered it), so one
 * message never goes both ways. The Líder único alive here takes `placeId: ''` the same way (t-c3fbe852).
 */
/** Whether the relay holds `key` (pending or delivered); an unreadable `fila.json` = not known. */
function known(relay: Pick<Relay, 'byKey'>, key: string): boolean {
  try {
    return relay.byKey(key) !== undefined;
  } catch {
    return false;
  }
}

export function deliverLocalFirst(local: DeliverOwnerMessage, relay: Pick<Relay, 'send' | 'byKey'>, waitMs: number): DeliverOwnerMessage {
  return async (message) => {
    // An unreadable fila.json (it throws) does not stop the local queue: the key is checked there too.
    const queued = message.key !== undefined && known(relay, message.key);
    // A local queue that failed (disk, an unreadable recados.json) is not the end: the relay still takes it.
    const here = queued ? null : await local(message).catch(() => null);
    if (here) return here;
    const to = await relay.send(message, waitMs);
    return to === 'pendente' ? null : to;
  };
}
