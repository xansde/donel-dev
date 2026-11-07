import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createCardWriter, type OwnerMessage } from '../src/main/ledger-card-writer';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { OWN_OPTION, ownerQueue, type LedgerDeliveredTo } from '../src/shared/ledger/contract';
import { createLedgerMobilePort } from '../src/main/celular/ledger-port';
import { slackGuard } from '../src/shared/ledger/slack-guard';
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

async function slackLetter(): Promise<{ service: ReturnType<typeof createLedgerService>; id: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'carta-mandar-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 6, 17);
  const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
  const created = await service.apply(theo, {
    op: 'carta-slack',
    projectPath: 'C:\\fake\\atlas',
    slack: { destination: 'DESTINO-FALSO', destinationLabel: 'Destino Falso (DM)', text: 'Texto que nunca sai.', reason: 'Teste do botão da caixa.' },
  });
  if (!created.ok) throw new Error(created.reason);
  return { service, id: created.task.id };
}

describe('Mandar à sessão, na carta de Slack', () => {
  it('sucesso: vai uma vez à sessão dona, fica na frente da carta com o recibo e não decide nem libera o Slack', async () => {
    const { service, id } = await slackLetter();
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
    const { service, id } = await slackLetter();
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

// "Eu escrevo minha própria opção e não some o cartão" (dono, 07/11). Writing on the card now decides it by default
// ("Decidir assim"): the card leaves the owner's pile, the decision is the owner's literal words as the option
// "Outra", and the session is told to go on from them. "Só perguntar" keeps the card (the old "Mandar à sessão").
describe('Escrever a própria opção na carta', () => {
  const dev = { kind: 'lugar' as const, placeId: 'place:dev', roleId: 'dev' };

  async function deliveredCard(): Promise<{ service: ReturnType<typeof createLedgerService>; id: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'carta-outra-'));
    dirs.push(dir);
    let clock = Date.UTC(2026, 10, 7, 12);
    const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
    const created = await service.apply({ kind: 'dono' }, { op: 'criar', projectPath: 'C:/fake/atlas', request: 'Libera o deploy', doneWhen: 'no ar', due: '2026-11-08', ownerPlaceId: dev.placeId, risk: 'alto' });
    if (!created.ok) throw new Error(created.reason);
    const id = created.task.id;
    for (const op of [
      { op: 'assumir' as const, id },
      {
        op: 'entregar' as const,
        id,
        proofs: [{ kind: 'texto' as const, text: '12 passed' }],
        forOwner: {
          question: 'Espero o OK do Fernando antes de subir?',
          summary: 'Está pronto; falta só o OK dele.',
          options: [
            { label: 'Esperar o Fernando', effect: 'Fica parado até ele responder.', closes: 'aceita' as const, recommended: true as const },
            { label: 'Não subir', effect: 'Nada sobe.', closes: 'rejeitada' as const },
          ],
          why: 'Ele pediu para ver antes.',
          risk: 'Subir sem ele pode irritar o time.',
        },
      },
    ]) {
      const result = await service.apply(dev, op);
      if (!result.ok) throw new Error(result.reason);
    }
    return { service, id };
  }

  it('escrever decide: a carta sai da pilha, a decisão é o texto literal do dono e a sessão segue a partir dele', async () => {
    const { service, id } = await deliveredCard();
    const sent: OwnerMessage[] = [];
    const writer = createCardWriter({ service: () => service, deliver: async (message) => (sent.push(message), { placeId: message.placeId }) });
    const phone = createLedgerMobilePort(() => service, undefined, () => writer);

    // "Só perguntar": goes to the session, the card stays in the pile.
    expect(await writer.write({ id, text: 'Ele já viu?', requestId: 'pedido-p0001' })).toMatchObject({ ok: true });
    expect(ownerQueue(service.load().doc, null).map((task) => task.id)).toEqual([id]);

    // Nothing written is no decision.
    expect(await service.apply({ kind: 'dono' }, { op: 'decidir-outra', id, text: '   ' })).toMatchObject({ ok: false });

    // "Decidir assim", from the phone (the desktop applies the same op): one decision, a retry records nothing new.
    const words = 'Faz sem o OK do Fernando. Só dale';
    const decide = () => phone.decidir({ pedidoId: 'pedido-d0001', itemId: id, decisao: 'aceitar', motivo: null, opcao: OWN_OPTION, texto: words });
    expect(await decide()).toEqual({ ok: true, estado: 'aceita' });
    expect(await decide()).toEqual({ ok: true, estado: 'aceita' });
    await Promise.resolve();

    const doc = service.load().doc;
    expect(ownerQueue(doc, null)).toEqual([]);
    expect(phone.pendentes()).toEqual([]);
    const decisions = doc.tasks[id]!.events.filter((event) => event.kind === 'aceita' || event.kind === 'rejeitada');
    expect(decisions).toEqual([expect.objectContaining({ kind: 'aceita', by: { kind: 'dono' }, option: OWN_OPTION, text: words })]);
    // The question went first; then the decision, with the literal words and what to do with them.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ placeId: dev.placeId });
    expect(sent[1]!.text).toContain(`«${words}»`);
    expect(sent[1]!.text).toContain('Siga a partir');
  });

  it('na carta de Slack, a própria opção nunca libera o envio: fecha como rejeitada, com o texto literal', async () => {
    const { service, id } = await slackLetter();
    const sent: OwnerMessage[] = [];
    const writer = createCardWriter({ service: () => service, deliver: async (message) => (sent.push(message), { placeId: message.placeId }) });
    const result = await service.apply({ kind: 'dono' }, { op: 'decidir-outra', id, text: 'Manda amanhã cedo, não hoje.' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.task.state).toBe('rejeitada');
    expect(result.task.events.at(-1)).toMatchObject({ kind: 'rejeitada', by: { kind: 'dono' }, option: OWN_OPTION, text: 'Manda amanhã cedo, não hoje.' });
    expect(slackGuard(service.load().doc, 'mcp__slack__slack_send_message', { channel_id: 'DESTINO-FALSO', text: 'Texto que nunca sai.' })).toMatchObject({ kind: 'deny' });
    await writer.tellDecision(result.task, 'Manda amanhã cedo, não hoje.');
    expect(sent[0]!.text).toContain('«Manda amanhã cedo, não hoje.»');
    expect(sent[0]!.text).toContain('Não envie');
  });
});
