// Oráculo na VPS (docs/planos/oraculo-na-vps.md, "PC desligado") — the relay of what only the PC can deliver: the
// owner's words on a card and his decision (to the session that owns the task) and a "Pedir" (to the Líder único),
// which live on the PC's board. The daemon writes the message here (`<dir>/fila.json`, temp → rename) and tells the
// PC (`notify` → an events-stream `fila`); the PC delivers through today's driver and acks with where it went.
//
// Nothing vanishes: a message waits on disk until an ack that went somewhere ("nobody open" keeps it). Nothing
// arrives twice: the same message (same place, same words) joins the pending item, and one already delivered
// answers where it went without a second send (the phone's queue retries).

import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { ConfigIoDeps } from '../main/config-store';

export interface RelayItem {
  readonly id: string;
  readonly key: string;
  readonly message: OwnerMessage;
  readonly at: number;
  /** Set by the ack. */
  readonly deliveredTo?: Exclude<LedgerDeliveredTo, null>;
  readonly deliveredAt?: number;
}

export interface Relay {
  /**
   * Queues `message` (or joins the same one) and waits up to `waitMs` for the PC's ack. `'pendente'` = it waits in
   * the queue (the PC is off or did not answer in time); it still goes when the PC comes back.
   */
  send(message: OwnerMessage, waitMs: number): Promise<Exclude<LedgerDeliveredTo, null> | 'pendente'>;
  pending(): RelayItem[];
  /** The PC delivered `id`; `null` (nobody open) keeps it queued. `true` = this ack took it out. */
  ack(id: string, deliveredTo: LedgerDeliveredTo): boolean;
}

/** A delivered message answers a retry for this long; an undelivered one gives up after `PENDING_DAYS`. */
const DELIVERED_DAYS = 7;
const PENDING_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

function keyOf(message: OwnerMessage): string {
  return createHash('sha256').update(`${message.projectPath}\n${message.placeId}\n${message.text}\n${message.leaderText}`).digest('hex');
}

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
    ...(deliveredTo ? { deliveredTo, ...(typeof value.deliveredAt === 'number' ? { deliveredAt: value.deliveredAt } : {}) } : {}),
  };
}

export function createRelay(deps: { readonly filePath: string; readonly io: ConfigIoDeps; readonly now?: () => number; readonly notify?: () => void }): Relay {
  const { filePath, io } = deps;
  const now = deps.now ?? Date.now;
  const waiters = new Map<string, Set<(to: Exclude<LedgerDeliveredTo, null>) => void>>();

  function read(): RelayItem[] {
    const text = io.readFileText(filePath);
    if (text === null) return [];
    try {
      const raw = JSON.parse(text) as { items?: unknown };
      return Array.isArray(raw.items) ? raw.items.map(parseItem).filter((item): item is RelayItem => item !== null) : [];
    } catch {
      return [];
    }
  }

  function write(items: readonly RelayItem[]): void {
    const cutoff = now();
    const kept = items.filter((item) => (item.deliveredAt !== undefined ? cutoff - item.deliveredAt < DELIVERED_DAYS * DAY : cutoff - item.at < PENDING_DAYS * DAY));
    const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
      if (!io.existsSync(dirname(filePath))) io.mkdirSync(dirname(filePath));
      io.writeFileText(tmp, JSON.stringify({ items: kept }, null, 2));
      io.renameFile(tmp, filePath);
    } catch (error) {
      io.unlinkFile(tmp);
      throw error;
    }
  }

  return {
    async send(message, waitMs) {
      const key = keyOf(message);
      const items = read();
      const same = items.find((item) => item.key === key);
      if (same?.deliveredTo) return same.deliveredTo;
      let item = same;
      if (!item) {
        item = { id: randomUUID(), key, message, at: now() };
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
      return read().filter((item) => !item.deliveredTo);
    },
    ack(id, deliveredTo) {
      if (deliveredTo === null) return false;
      const items = read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0 || items[index]!.deliveredTo) return false;
      items[index] = { ...items[index]!, deliveredTo, deliveredAt: now() };
      write(items);
      for (const resolve of waiters.get(id) ?? []) resolve(deliveredTo);
      waiters.delete(id);
      return true;
    },
  };
}
