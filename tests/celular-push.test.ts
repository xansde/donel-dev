import { createECDH, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyLedgerOp, emptyLedgerDoc, type LedgerDoc } from '../src/shared/ledger/contract';
import {
  encryptPushPayload,
  generateVapidKeys,
  isPushSubscription,
  newlyWaiting,
  pushMessageFor,
  sendPush,
  vapidAuthorization,
  type PushSubscription,
} from '../src/main/celular/webpush';

// Aviso no celular — the push leaves encrypted for the phone's own keys (the push service reads nothing), signed
// so the service takes it, and only for a letter that STARTED waiting for the owner, with its human title.

const sub: PushSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

describe('aviso no celular', () => {
  it('encrypts for the phone, signs for the push service, and only posts to a push service', async () => {
    // RFC 8291, Appendix A: the same keys and salt give the same bytes.
    const server = createECDH('prime256v1');
    server.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
    const body = encryptPushPayload(sub, Buffer.from('When I grow up, I want to be a watermelon'), { salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), serverEcdh: server });
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );

    const keys = generateVapidKeys();
    const header = vapidAuthorization(sub.endpoint, keys, Date.UTC(2026, 10, 5));
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt!.split('.');
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com' });
    const raw = Buffer.from(keys.publicKey, 'base64url');
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'))).toBe(true);

    // A paired phone can't make the PC post anywhere else.
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x']) {
      expect(isPushSubscription({ ...sub, endpoint }), endpoint).toBe(false);
    }
    let posts = 0;
    const fetchFn = async () => ((posts += 1), { status: 410 });
    expect(await sendPush({ ...sub, endpoint: 'https://evil.example/x' }, { title: 't', body: 'b', tag: 'x', url: '/' }, keys, fetchFn)).toBe('gone');
    expect(posts).toBe(0);
    expect(await sendPush(sub, { title: 't', body: 'b', tag: 'x', url: '/' }, keys, fetchFn)).toBe('gone');
    expect(posts).toBe(1);
  });

  it('warns once per letter that starts waiting, with its human title and a link to it', () => {
    let doc: LedgerDoc = emptyLedgerDoc();
    let seq = 0;
    const ctx = () => ({ now: Date.UTC(2026, 10, 5, 15) + seq * 1000, newId: () => `t-${++seq}` });
    const dev = { kind: 'lugar' as const, placeId: 'place:dev' };
    const made = applyLedgerOp(doc, dev, { op: 'carta-slack', projectPath: 'C:/p', slack: { destination: 'C0123ABC', destinationLabel: '#produto', text: 'oi', reason: 'avisar' } }, ctx());
    if (!made.ok) throw new Error(made.reason);
    doc = made.doc;

    const first = newlyWaiting(new Map(), doc);
    expect(first.fresh.map(pushMessageFor)).toEqual([{ title: 'Mensagem no Slack para #produto', body: 'Esperando você no Oráculo Harrow.', tag: `carta-${made.task.id}`, url: `/#carta=${made.task.id}` }]);
    expect(newlyWaiting(first.next, doc).fresh).toEqual([]);

    // Decided: leaves the queue, and nothing is warned.
    const accepted = applyLedgerOp(doc, { kind: 'dono' }, { op: 'aceitar', id: made.task.id }, ctx());
    if (!accepted.ok) throw new Error(accepted.reason);
    const after = newlyWaiting(first.next, accepted.doc);
    expect(after.fresh).toEqual([]);
    expect(after.next.size).toBe(0);
  });
});
