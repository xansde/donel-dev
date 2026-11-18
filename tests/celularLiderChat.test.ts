import { describe, expect, it } from 'vitest';
import { createCelularLiderChat, phoneMarker, type CelularLiderChatDeps } from '../src/main/lider/celular-chat';

// Chat do Líder no celular (plano 18/11, item 11) — the desktop takes the owner's messages from the phone's queue in
// Supabase, gives them to the Líder único and sends his answer back. What would break without the owner noticing: a
// message that vanishes (marked delivered but never given to the Líder), one delivered twice, or an answer that goes
// to the wrong message, or never goes.

interface Call {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

function setup(rows: Array<{ id: string; texto: string }>, deliverOk = true) {
  const calls: Call[] = [];
  const delivered: string[] = [];
  let queue = [...rows];
  let next = 0;
  const deps: CelularLiderChatDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'celular_lider_tomar') {
        const taken = queue;
        queue = [];
        return taken.map((row) => ({ ...row, criada_em: '2026-11-18T04:00:00Z' }));
      }
      return true;
    },
    deliver: async (text) => {
      delivered.push(text);
      return deliverOk ? { ok: true } : { ok: false, reason: 'sem Líder' };
    },
    newId: () => `reply-${++next}`,
    log: () => undefined,
  };
  return { chat: createCelularLiderChat(deps), calls, delivered };
}

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('chat do Líder pelo celular', () => {
  it('entrega ao Líder, marca entregue e manda a resposta do turno à mensagem certa', async () => {
    const { chat, calls, delivered } = setup([{ id: A, texto: 'Como está o time?' }]);
    await chat.poll();
    expect(delivered).toEqual([`${phoneMarker(A)} Como está o time?`]);
    expect(calls.map((call) => call.fn)).toEqual(['celular_lider_tomar', 'celular_lider_entregue']);
    expect(calls[1]!.args).toEqual({ p_id: A, p_resultado: 'entregue ao Líder no desktop' });

    chat.promptSubmitted(`${phoneMarker(A)} Como está o time?`);
    await chat.turnEnded('Três Devs trabalhando.');
    expect(calls[2]).toEqual({ fn: 'celular_lider_responder', args: { p_id: 'reply-1', p_em_resposta_a: A, p_texto: 'Três Devs trabalhando.' } });

    // The next turn of the Líder (something else) does not go to the phone again.
    chat.promptSubmitted('outra coisa');
    await chat.turnEnded('ok');
    expect(calls).toHaveLength(3);
  });

  it('não marca entregue o que o Líder não recebeu (volta pela reserva)', async () => {
    const { chat, calls } = setup([{ id: A, texto: 'oi' }], false);
    await chat.poll();
    expect(calls.map((call) => call.fn)).toEqual(['celular_lider_tomar']);
    await chat.turnEnded('resposta de outra coisa');
    expect(calls).toHaveLength(1);
  });

  it('turno que não é da mensagem do celular não responde a ela', async () => {
    const { chat, calls } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    // The Líder was busy with a message of the team: that turn ends first.
    chat.promptSubmitted('[t-1234] recado do Dev');
    await chat.turnEnded('respondi ao Dev');
    expect(calls.filter((call) => call.fn === 'celular_lider_responder')).toHaveLength(0);
    chat.promptSubmitted(`${phoneMarker(A)} oi`);
    await chat.turnEnded('oi, dono');
    expect(calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args.p_em_resposta_a)).toEqual([A]);
  });

  it('duas mensagens no mesmo turno: a resposta inteira na mais nova, a outra apontada para ela; nenhuma fica sem resposta', async () => {
    const { chat, calls } = setup([
      { id: A, texto: 'primeira' },
      { id: B, texto: 'segunda' },
    ]);
    await chat.poll();
    chat.promptSubmitted(`${phoneMarker(A)} primeira\n${phoneMarker(B)} segunda`);
    await chat.turnEnded('as duas feitas');
    const replies = calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args);
    expect(replies).toEqual([
      { p_id: 'reply-1', p_em_resposta_a: B, p_texto: 'as duas feitas' },
      { p_id: 'reply-2', p_em_resposta_a: A, p_texto: '↳ respondi junto com a mensagem seguinte.' },
    ]);
  });

  it('mensagem injetada no meio do turno (sem prompt novo) é respondida no fim dele', async () => {
    const { chat, calls } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    await chat.turnEnded('oi, dono');
    expect(calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args.p_em_resposta_a)).toEqual([A]);
  });

  it('a mesma resposta não sai duas vezes se o envio falhar e tentar de novo (mesmo id)', async () => {
    const calls: Call[] = [];
    let failOnce = true;
    let next = 0;
    const chat = createCelularLiderChat({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === 'celular_lider_tomar') return [{ id: A, texto: 'oi', criada_em: 'x' }];
        if (fn === 'celular_lider_responder' && failOnce) {
          failOnce = false;
          throw new Error('sem rede');
        }
        return true;
      },
      deliver: async () => ({ ok: true }),
      newId: () => `reply-${++next}`,
      log: () => undefined,
    });
    await chat.poll();
    await chat.turnEnded('oi, dono');
    await chat.poll(); // retries the reply that failed before taking more
    const replies = calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args.p_id);
    expect(replies).toEqual(['reply-1', 'reply-1']);
  });
});
