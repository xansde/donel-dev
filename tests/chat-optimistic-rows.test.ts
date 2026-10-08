import { describe, expect, it } from 'vitest';
import { mergeOptimistic } from '../src/renderer/src/chat/composer/optimistic';
import type { SendItemView } from '../src/renderer/src/chat/sendDriver';
import type { ConversationRow, UserRow } from '../src/shared/chat/rows';

// 014-chat T067 - mensagens otimistas na timeline: fundem com a linha real, sem duplicar (D-C11).

const T0 = Date.parse('2026-10-08T12:00:00.000Z');
const real = (id: string, text: string, at = '2026-10-08T12:00:05.000Z', extra: Partial<UserRow> = {}): UserRow => ({
  kind: 'user',
  id,
  turnId: id,
  at,
  scope: 'main',
  text,
  attachments: [],
  ...extra,
});
const item = (id: string, text: string, state: SendItemView['state'], extra: Partial<SendItemView> = {}): SendItemView => ({
  id,
  text,
  images: [],
  kind: text.startsWith('/') ? 'slash' : text.startsWith('!') ? 'shell' : 'prompt',
  mode: 'normal',
  state,
  label: 'enviando…',
  leftover: null,
  createdAt: T0,
  ...extra,
});
const ids = (rows: readonly ConversationRow[]) => rows.map((r) => r.id);

describe('mergeOptimistic', () => {
  it('mostra a mensagem enviada como linha local ao final', () => {
    const out = mergeOptimistic([real('u1', 'antes', '2026-10-08T11:00:00.000Z')], [item('s1', 'oi', 'confirming')]);
    expect(ids(out.rows)).toEqual(['u1', 'local:s1']);
    expect(out.overlays.get('local:s1')).toMatchObject({ sendState: 'sending' });
    expect(out.overlays.has('u1')).toBe(false);
  });

  it('quando a linha real chega, some a local e a real mantém "entrou"', () => {
    const out = mergeOptimistic([real('u2', 'oi  tudo\nbem')], [item('s1', 'oi tudo\nbem', 'accepted', { label: 'entrou' })]);
    expect(ids(out.rows)).toEqual(['u2']);
    expect(out.overlays.get('u2')).toMatchObject({ sendState: 'sent' });
  });

  it('não funde com linha anterior ao envio', () => {
    const old = real('u0', 'oi', '2026-10-08T11:00:00.000Z');
    const out = mergeOptimistic([old], [item('s1', 'oi', 'typing')]);
    expect(ids(out.rows)).toEqual(['u0', 'local:s1']);
  });

  it('mensagens iguais seguidas casam em ordem, cada linha real com um envio', () => {
    const rows = [real('u1', 'igual', '2026-10-08T12:00:02.000Z')];
    const out = mergeOptimistic(rows, [
      item('s1', 'igual', 'accepted', { createdAt: T0 }),
      item('s2', 'igual', 'confirming', { createdAt: T0 + 1000 }),
    ]);
    expect(ids(out.rows)).toEqual(['u1', 'local:s2']);
    expect(out.overlays.get('u1')).toMatchObject({ sendState: 'sent' });
  });

  it('"na fila" leva a causa; "não foi" leva o motivo e o id para tentar de novo', () => {
    const out = mergeOptimistic(
      [],
      [
        item('s1', 'a', 'queued', { queuedReason: 'entra na próxima pausa do Claude' }),
        item('s2', 'b', 'failed', { reason: 'o Claude não ficou pronto' }),
        item('s3', 'c', 'pending', { queuedReason: 'entra depois da mensagem anterior' }),
      ],
    );
    expect(out.overlays.get('local:s1')).toMatchObject({ sendState: 'queued', queuedReason: 'entra na próxima pausa do Claude' });
    expect(out.overlays.get('local:s2')).toMatchObject({ sendState: 'failed', failedReason: 'o Claude não ficou pronto', sendId: 's2' });
    expect(out.overlays.get('local:s3')).toMatchObject({ sendState: 'queued' });
  });

  it('comando aceito some da lista local (a linha real do comando já o mostra)', () => {
    const out = mergeOptimistic([], [item('s1', '/status', 'accepted', { label: 'entrou' })]);
    expect(ids(out.rows)).toEqual([]);
  });

  it('prompt aceito sem linha real ainda fica visível como "entrou"', () => {
    const out = mergeOptimistic([], [item('s1', 'oi', 'accepted', { label: 'entrou' })]);
    expect(out.overlays.get('local:s1')).toMatchObject({ sendState: 'sent' });
  });

  it('linha real de comando (command.name/args) casa com o envio', () => {
    const r = real('u3', '', '2026-10-08T12:00:03.000Z', { command: { name: 'model', args: 'opus' } });
    const out = mergeOptimistic([r], [item('s1', '/model opus', 'accepted')]);
    expect(ids(out.rows)).toEqual(['u3']);
    expect(out.overlays.get('u3')).toMatchObject({ sendState: 'sent' });
  });

  it('linha real já na fila do CLI recebe "na fila"', () => {
    const r = real('u4', 'depois', '2026-10-08T12:00:03.000Z', { queued: true });
    const out = mergeOptimistic([r], [item('s1', 'depois', 'queued', { queuedReason: 'entra na próxima pausa do Claude' })]);
    expect(ids(out.rows)).toEqual(['u4']);
    expect(out.overlays.get('u4')).toMatchObject({ sendState: 'queued', queuedReason: 'entra na próxima pausa do Claude' });
  });
});

describe('mergeOptimistic - cartão "não foi" no ponto do envio', () => {
  it('falho enviado antes de uma mensagem posterior aparece ANTES dela', () => {
    const later = real('u9', 'depois', '2026-10-08T12:05:00.000Z');
    const before = real('u0', 'antes', '2026-10-08T11:00:00.000Z');
    const out = mergeOptimistic([before, later], [item('s1', 'falhou', 'failed', { reason: 'x', createdAt: T0 })]);
    expect(ids(out.rows)).toEqual(['u0', 'local:s1', 'u9']);
    expect(out.overlays.get('local:s1')).toMatchObject({ sendState: 'failed', sendId: 's1' });
  });

  it('falho mais novo que tudo continua no fim', () => {
    const out = mergeOptimistic([real('u0', 'antes', '2026-10-08T11:00:00.000Z')], [item('s1', 'falhou', 'failed', { reason: 'x' })]);
    expect(ids(out.rows)).toEqual(['u0', 'local:s1']);
  });

  it('descartado (item removido do driver) some da lista', () => {
    const later = real('u9', 'depois', '2026-10-08T12:05:00.000Z');
    const out = mergeOptimistic([later], []);
    expect(ids(out.rows)).toEqual(['u9']);
  });
});
