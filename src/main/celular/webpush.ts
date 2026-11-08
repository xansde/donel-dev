// Aviso no celular (demanda slack-carta, fatia 3) — Web Push feito à mão com `node:crypto`, sem dependência:
// VAPID (RFC 8292, JWT ES256) para o serviço de push aceitar o envio, e o corpo cifrado `aes128gcm` (RFC 8291)
// com as chaves que o próprio celular gerou. O serviço de push do navegador (Google no Android, Apple no iPhone)
// é quem acorda o celular com o app fechado: ele só vê bytes cifrados, nunca o título da carta.
//
// O que fica no PC, em `<userData>/celular-push.json`: o par VAPID deste app e a inscrição de cada celular
// pareado (o endereço de push e as chaves públicas dele). Nenhum segredo do dono.

import { createECDH, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type JsonWebKey } from 'node:crypto';
import type { ConfigIoDeps } from '../config-store';
import { slackDestinationLabel, type LedgerDoc, type LedgerTask } from '../../shared/ledger/contract';
import { CARD_KINDS, ownerInbox, type OwnerInboxItem, type OwnerInboxKind, type PlaceStates } from '../../shared/ledger/inbox';

export interface VapidKeys {
  /** Ponto público P-256 não comprimido (65 bytes), base64url: o `applicationServerKey` do celular. */
  readonly publicKey: string;
  /** A chave privada em JWK (só o main usa). */
  readonly privateJwk: JsonWebKey;
}

export interface PushSubscription {
  readonly endpoint: string;
  /** base64url do ponto P-256 do celular (65 bytes). */
  readonly p256dh: string;
  /** base64url do segredo de autenticação (16 bytes). */
  readonly auth: string;
}

const b64url = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString('base64url');
const fromB64url = (value: string): Buffer => Buffer.from(value, 'base64url');

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([0x04]), fromB64url(pub.x!), fromB64url(pub.y!)]);
  return { publicKey: b64url(raw), privateJwk: privateKey.export({ format: 'jwk' }) };
}

/**
 * Serviços de push dos navegadores. O app só faz POST para eles: um celular pareado não consegue fazer o PC
 * chamar um endereço qualquer.
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/i.test(url.hostname);
}

export function isPushSubscription(value: unknown): value is PushSubscription {
  if (typeof value !== 'object' || value === null) return false;
  const { endpoint, p256dh, auth } = value as Record<string, unknown>;
  return (
    typeof endpoint === 'string' &&
    endpoint.length <= 2000 &&
    isPushServiceEndpoint(endpoint) &&
    typeof p256dh === 'string' &&
    fromB64url(p256dh).length === 65 &&
    typeof auth === 'string' &&
    fromB64url(auth).length === 16
  );
}

/** O cabeçalho `Authorization: vapid t=…, k=…` (RFC 8292). `sub` genérico: nada do dono sai no token. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: number = Date.now()): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: 'https://github.com/xansde/donel' })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey({ key: keys.privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** RFC 8291 — o corpo cifrado para UMA inscrição (um único registro `aes128gcm`). */
export function encryptPushPayload(subscription: PushSubscription, plaintext: Buffer, options: { salt?: Buffer; serverEcdh?: ReturnType<typeof createECDH> } = {}): Buffer {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  const ecdh = options.serverEcdh ?? createECDH('prime256v1');
  if (!options.serverEcdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = options.salt ?? randomBytes(16);
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // Último (e único) registro: o texto seguido do delimitador 0x02.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>;

/** Envia um aviso. `gone` = o celular desinscreveu (ou trocou de inscrição): apagar a inscrição. */
export async function sendPush(subscription: PushSubscription, message: PushMessage, keys: VapidKeys, fetchFn: PushFetch): Promise<'ok' | 'gone' | 'failed'> {
  if (!isPushServiceEndpoint(subscription.endpoint)) return 'gone';
  try {
    const response = await fetchFn(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 60 * 60),
        Urgency: 'high',
        Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'carta',
      },
      body: encryptPushPayload(subscription, Buffer.from(JSON.stringify(message))),
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.status >= 200 && response.status < 300 ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// O que avisa: uma carta que PASSOU a esperar o dono.

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** Agrupa: um segundo aviso da mesma carta substitui o primeiro. */
  readonly tag: string;
  /** Abre a carta no app do celular. */
  readonly url: string;
}

const MAX_TITLE = 70;

function shorten(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
}

/** O título humano da carta: nunca o id da tarefa nem o do lugar. */
export function pushTitle(task: LedgerTask): string {
  if (task.slack) return shorten(`Mensagem no Slack para ${slackDestinationLabel(task.slack)}`);
  const human = (task as { title?: unknown }).title;
  return shorten(typeof human === 'string' && human.trim() ? human : task.request);
}

/** Ledger v5, fatia 2 — the line under the title, by kind of item of the box "Esperando você". */
const BODIES: Readonly<Record<OwnerInboxKind, string>> = {
  'decidir-entrega': 'Esperando você no Oráculo Harrow.',
  'aprovar-carta': 'Esperando você no Oráculo Harrow.',
  'entrega-parada': 'Entregue há um dia sem decisão: você decide no lugar do Revisor.',
  'amostra-revisor': 'Um aceite do Revisor para você conferir.',
  'carta-parada': 'Você aceitou e a mensagem ainda não saiu.',
  'conferir-envio': 'Confira no Slack se a mensagem chegou.',
  'para-repassar': 'Ninguém está fazendo: peça ao Líder para repassar.',
};

/** The warning of one item: a card kind opens its card; the others open the app (the box is there). */
export function pushMessageFor(item: OwnerInboxItem): PushMessage {
  const { task, kind } = item;
  const onCard = CARD_KINDS.has(kind);
  return {
    title: pushTitle(task),
    body: BODIES[kind],
    tag: onCard ? `carta-${task.id}` : `caixa-${kind}-${task.id}`,
    url: onCard ? `/#carta=${encodeURIComponent(task.id)}` : '/',
  };
}

/**
 * The items of the box "Esperando você" (fatia 1) that started waiting since `known` (the ones already warned).
 * Returns the whole box for the next comparison. An item leaving and coming back (a delivery rejected and delivered
 * again), or a task that changes kind (a letter accepted, then stuck), warns again: its wait started again. Some items
 * are born with time alone (a letter stuck for 30 min), so the caller also runs this with no change in the ledger.
 */
export function newlyWaiting(
  known: ReadonlyMap<string, number>,
  doc: LedgerDoc,
  now: number,
  places?: PlaceStates,
): { fresh: OwnerInboxItem[]; next: Map<string, number> } {
  const next = new Map<string, number>();
  const fresh: OwnerInboxItem[] = [];
  for (const item of ownerInbox(doc, null, now, places)) {
    const key = `${item.task.id}:${item.kind}`;
    next.set(key, item.since);
    if (known.get(key) !== item.since) fresh.push(item);
  }
  return { fresh, next };
}

// ---------------------------------------------------------------------------------------------------------------
// Arquivo `celular-push.json`

export interface PushStoreDoc {
  readonly vapid: VapidKeys | null;
  /** Por aparelho pareado (`CelularDevice.id`). */
  readonly subscriptions: Readonly<Record<string, PushSubscription>>;
}

export interface PushStore {
  keys(): VapidKeys;
  subscribe(deviceId: string, subscription: PushSubscription): void;
  /** Aparelhos inscritos agora. */
  subscriptions(): ReadonlyArray<{ deviceId: string; subscription: PushSubscription }>;
  remove(deviceId: string): void;
}

function parsePushStore(raw: unknown): PushStoreDoc {
  const empty: PushStoreDoc = { vapid: null, subscriptions: {} };
  if (typeof raw !== 'object' || raw === null) return empty;
  const record = raw as Record<string, unknown>;
  const vapid = record.vapid as Partial<VapidKeys> | undefined;
  const subscriptions: Record<string, PushSubscription> = {};
  if (typeof record.subscriptions === 'object' && record.subscriptions !== null) {
    for (const [id, sub] of Object.entries(record.subscriptions as Record<string, unknown>)) if (isPushSubscription(sub)) subscriptions[id] = sub;
  }
  return {
    vapid: vapid && typeof vapid.publicKey === 'string' && typeof vapid.privateJwk === 'object' && vapid.privateJwk !== null ? (vapid as VapidKeys) : null,
    subscriptions,
  };
}

export function createPushStore(filePath: string, io: ConfigIoDeps): PushStore {
  const read = (): PushStoreDoc => {
    const text = io.readFileText(filePath);
    if (text === null) return { vapid: null, subscriptions: {} };
    try {
      return parsePushStore(JSON.parse(text));
    } catch {
      return { vapid: null, subscriptions: {} };
    }
  };
  const write = (doc: PushStoreDoc): void => {
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    io.writeFileText(tmp, JSON.stringify(doc, null, 2));
    io.renameFile(tmp, filePath);
  };
  return {
    keys() {
      const doc = read();
      if (doc.vapid) return doc.vapid;
      const vapid = generateVapidKeys();
      write({ ...doc, vapid });
      return vapid;
    },
    subscribe(deviceId, subscription) {
      const doc = read();
      write({ vapid: doc.vapid ?? generateVapidKeys(), subscriptions: { ...doc.subscriptions, [deviceId]: subscription } });
    },
    subscriptions() {
      return Object.entries(read().subscriptions).map(([deviceId, subscription]) => ({ deviceId, subscription }));
    },
    remove(deviceId) {
      const doc = read();
      if (!(deviceId in doc.subscriptions)) return;
      const subscriptions = { ...doc.subscriptions };
      delete subscriptions[deviceId];
      write({ ...doc, subscriptions });
    },
  };
}

/** `tailscale serve status --json` → o endereço https que a Tailscale serve na porta 443, se houver. */
export function httpsServeUrl(status: unknown): string | null {
  if (typeof status !== 'object' || status === null) return null;
  const web = (status as Record<string, unknown>).Web;
  if (typeof web !== 'object' || web === null) return null;
  const host = Object.keys(web).find((key) => /^[a-z0-9.-]+\.ts\.net:443$/i.test(key));
  return host ? `https://${host.slice(0, -':443'.length)}` : null;
}
