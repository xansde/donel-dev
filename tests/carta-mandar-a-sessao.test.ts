import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createCardWriter, type OwnerMessage } from '../src/main/ledger-card-writer';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import type { LedgerDeliveredTo } from '../src/shared/ledger/contract';
import { mandarDaCarta, notasDaFrente } from '../src/shared/ledger/labels';

// t-8fed1d77 — "ao pressionar esse botão de Enviar, nada acontece" (dono, 06/11, numa carta de Slack). The text was
// recorded, but the card redrew itself on the new event and the receipt lived only in local state (and on the
// back): the front looked untouched. And a call that threw or never answered left the card silent. The front now
// reads what was written from the card itself, and every send comes back with a receipt or a reason.

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const theo = { kind: 'lugar' as const, placeId: 'place:00000000-0000-4000-8000-00000000f01a', roleId: 'theo-west' };

function slackLetter(): { service: ReturnType<typeof createLedgerService>; id: string } {
  const dir = mkdtempSync(join(tmpdir(), 'carta-mandar-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 6, 17);
  const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
  const created = service.apply(theo, {
    op: 'carta-slack',
    projectPath: 'C:\\fake\\atlas',
    slack: { destination: 'DESTINO-FALSO', destinationLabel: 'Destino Falso (DM)', text: 'Texto que nunca sai.', reason: 'Teste do botão da caixa.' },
  });
  if (!created.ok) throw new Error(created.reason);
  return { service, id: created.task.id };
}

describe('Mandar à sessão, na carta de Slack', () => {
  it('sucesso: vai uma vez à sessão dona, fica na frente da carta com o recibo e não decide nem libera o Slack', async () => {
    const { service, id } = slackLetter();
    const sent: OwnerMessage[] = [];
    let answer: LedgerDeliveredTo = { placeId: theo.placeId };
    const writer = createCardWriter({ service: () => service, deliver: async (message) => (sent.push(message), answer) });
    const send = (text: string, requestId: string) => mandarDaCarta(() => writer.write({ id, text, requestId }), 5_000);

    expect(await send('Troque "ligar" por "testar".', 'pedido-0001')).toEqual({ ok: true });
    // A second click with the same request joins the first: one message.
    expect(await send('Troque "ligar" por "testar".', 'pedido-0001')).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.placeId).toBe(theo.placeId);
    expect(sent[0]!.text).toContain('«Mensagem no Slack para Destino Falso (DM)»: Troque "ligar" por "testar".');

    // Both sessions closed: it is still recorded, and the front says it reached nobody.
    answer = null;
    expect(await send('E me avisa.', 'pedido-0002')).toEqual({ ok: true });

    const task = service.load().doc.tasks[id]!;
    expect(task.state).toBe('entregue');
    expect(task.events.some((event) => event.kind === 'aceita' || event.kind === 'enviada')).toBe(false);
    const front = notasDaFrente(task, 'Theo West');
    expect(front.map((note) => [note.text, note.delivered])).toEqual([
      ['Troque "ligar" por "testar".', true],
      ['E me avisa.', false],
    ]);
    expect(front[0]!.receipt).toMatch(/^Enviado a Theo West, às/);
    expect(front[1]!.receipt).toContain('fica guardado na carta');
  });

  it('falha: recusa, erro, exceção e falta de resposta voltam sempre com motivo, sem gravar', async () => {
    const { service, id } = slackLetter();
    const deliver = vi.fn(async (): Promise<LedgerDeliveredTo> => ({ placeId: theo.placeId }));
    const writer = createCardWriter({ service: () => service, deliver });

    const refused = await mandarDaCarta(() => writer.write({ id, text: '   ', requestId: 'pedido-0003' }), 5_000);
    expect(refused).toEqual({ ok: false, reason: expect.stringContaining('escreva alguma coisa') });

    const gone = await mandarDaCarta(() => writer.write({ id: 't-naoexiste', text: 'Oi', requestId: 'pedido-0004' }), 5_000);
    expect(gone).toEqual({ ok: false, reason: 'Esta carta não existe mais.' });

    // The bridge missing in the window (a call that throws before any promise) is a reason, not a stuck button.
    const thrown = await mandarDaCarta(() => {
      throw new TypeError('window.donel.ledger.comment is not a function');
    }, 5_000);
    expect(thrown).toEqual({ ok: false, reason: expect.stringContaining('O texto continua aqui') });

    const rejected = await mandarDaCarta(() => Promise.reject(new Error('IPC fechado')), 5_000);
    expect(rejected).toEqual({ ok: false, reason: expect.stringContaining('IPC fechado') });

    vi.useFakeTimers();
    const pending = mandarDaCarta(() => new Promise(() => undefined), 120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toEqual({ ok: false, reason: expect.stringContaining('não confirmou em 120 s') });

    expect(deliver).not.toHaveBeenCalled();
    expect(notasDaFrente(service.load().doc.tasks[id]!, 'Theo West')).toEqual([]);
  });
});
