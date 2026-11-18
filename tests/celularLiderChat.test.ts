import { describe, expect, it } from 'vitest';
import { answeredIds, createCelularLiderChat, parseCelularChatState, phoneMarker, type CelularChatState, type CelularLiderChatDeps } from '../src/main/lider/celular-chat';

// Chat do Líder pelo celular (plano 18/11, item 11) — the desktop takes the owner's messages from the phone's queue in
// Supabase, gives them to the Líder único and sends his answer back. What would break without the owner noticing: a
// message that vanishes (marked delivered but never answered), one answered twice, or an answer of another subject
// (a turn that never read it), also across a restart of the app.

interface Call {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

/** Transcript lines as the CLI writes them. */
const user = (text: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const queued = (text: string): string => JSON.stringify({ type: 'attachment', attachment: { type: 'queued_command', prompt: text, commandMode: 'prompt' } });
const said = (text: string): string => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (): string => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
const tail = (...lines: string[]): string => lines.join('\n');

function setup(rows: Array<{ id: string; texto: string }>, options: { deliverOk?: boolean; state?: CelularChatState | null } = {}) {
  const calls: Call[] = [];
  const delivered: string[] = [];
  const saved: CelularChatState[] = [];
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
      return options.deliverOk === false ? { ok: false, reason: 'sem Líder' } : { ok: true };
    },
    newId: () => `reply-${++next}`,
    now: () => 1_000,
    log: () => undefined,
    load: () => options.state ?? null,
    save: (state) => saved.push(JSON.parse(JSON.stringify(state)) as CelularChatState),
  };
  const replies = (): Array<Record<string, unknown>> => calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args);
  return { chat: createCelularLiderChat(deps), calls, delivered, saved, replies };
}

describe('chat do Líder pelo celular', () => {
  it('entrega ao Líder, marca entregue e responde quando o turno que leu a mensagem termina', async () => {
    const { chat, calls, delivered, replies } = setup([{ id: A, texto: 'Como está o time?' }]);
    await chat.poll();
    expect(delivered).toEqual([`${phoneMarker(A)} Como está o time?`]);
    expect(calls.map((call) => call.fn)).toEqual(['celular_lider_tomar', 'celular_lider_entregue']);
    expect(calls[1]!.args).toEqual({ p_id: A, p_resultado: 'entregue ao Líder no desktop' });

    await chat.turnEnded('Três Devs trabalhando.', tail(user(`${phoneMarker(A)} Como está o time?`), tool(), said('Três Devs trabalhando.')));
    expect(replies()).toEqual([{ p_id: 'reply-1', p_em_resposta_a: A, p_texto: 'Três Devs trabalhando.' }]);

    // The next turn of the Líder (the same message still in the tail, but already answered) does not answer again.
    await chat.turnEnded('ok', tail(user(`${phoneMarker(A)} Como está o time?`), said('Três Devs trabalhando.'), user('outra coisa'), said('ok')));
    expect(replies()).toHaveLength(1);
  });

  it('turno de outro assunto, com a mensagem ainda na fila do CLI, não responde a ela; o turno que a lê, sim', async () => {
    // The reviewer's case: the Líder is in a turn opened by a message of the team when the phone's message arrives.
    const { chat, replies } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    await chat.turnEnded('respondi ao Dev', tail(user('[t-1] recado do Dev'), said('respondi ao Dev')));
    // A turn with no prompt of its own (a background task ended) does not answer the phone either.
    await chat.turnEnded('tarefa em segundo plano terminou', tail(user('[t-1] recado do Dev'), said('respondi ao Dev'), said('tarefa em segundo plano terminou')));
    expect(replies()).toEqual([]);
    await chat.turnEnded('oi, dono', tail(said('respondi ao Dev'), user(`${phoneMarker(A)} oi`), said('oi, dono')));
    expect(replies()).toEqual([{ p_id: 'reply-1', p_em_resposta_a: A, p_texto: 'oi, dono' }]);
  });

  it('mensagem posta pelo CLI no meio de um turno é respondida no fim dele, se o Líder escreveu depois de lê-la', async () => {
    const { chat, replies } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    // Read mid-turn but nothing written after it yet: wait.
    await chat.turnEnded('fim do Dev', tail(user('[t-1] recado'), said('vou ver'), queued(`${phoneMarker(A)} oi`)));
    expect(replies()).toEqual([]);
    await chat.turnEnded('oi, dono; e o Dev já foi', tail(user('[t-1] recado'), queued(`${phoneMarker(A)} oi`), said('oi, dono; e o Dev já foi')));
    expect(replies().map((reply) => reply.p_em_resposta_a)).toEqual([A]);
  });

  it('não marca entregue o que o Líder não recebeu (volta pela reserva)', async () => {
    const { chat, calls } = setup([{ id: A, texto: 'oi' }], { deliverOk: false });
    await chat.poll();
    expect(calls.map((call) => call.fn)).toEqual(['celular_lider_tomar']);
  });

  it('duas mensagens lidas no mesmo turno: a resposta inteira na mais nova, a outra apontada para ela', async () => {
    const { chat, replies } = setup([
      { id: A, texto: 'primeira' },
      { id: B, texto: 'segunda' },
    ]);
    await chat.poll();
    await chat.turnEnded('as duas feitas', tail(user(`${phoneMarker(A)} primeira`), queued(`${phoneMarker(B)} segunda`), said('as duas feitas')));
    expect(replies()).toEqual([
      { p_id: 'reply-1', p_em_resposta_a: B, p_texto: 'as duas feitas' },
      { p_id: 'reply-2', p_em_resposta_a: A, p_texto: '↳ respondi junto com a mensagem seguinte.' },
    ]);
  });

  it('o que espera resposta sobrevive a um reinício do app, e a resposta que falhou sai de novo com o mesmo id', async () => {
    const first = setup([{ id: A, texto: 'oi' }]);
    await first.chat.poll();
    const afterDelivery = first.saved[first.saved.length - 1]!;
    expect(afterDelivery.waiting.map((entry) => entry.id)).toEqual([A]);

    // The app restarts; the new instance answers from the state on disk.
    const calls: Call[] = [];
    let failOnce = true;
    let saved: CelularChatState | null = parseCelularChatState(JSON.stringify(afterDelivery));
    const deps = (): CelularLiderChatDeps => ({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === 'celular_lider_responder' && failOnce) {
          failOnce = false;
          throw new Error('sem rede');
        }
        return fn === 'celular_lider_tomar' ? [] : true;
      },
      deliver: async () => ({ ok: true }),
      newId: () => 'reply-x',
      log: () => undefined,
      load: () => saved,
      save: (state) => {
        saved = parseCelularChatState(JSON.stringify(state));
      },
    });
    const second = createCelularLiderChat(deps());
    await second.turnEnded('oi, dono', tail(user(`${phoneMarker(A)} oi`), said('oi, dono')));
    expect(saved!.outbox.map((reply) => reply.p_id)).toEqual(['reply-x']);
    // Restart again before the retry: the answer that failed goes on the next poll, same id.
    const third = createCelularLiderChat(deps());
    await third.poll();
    expect(calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args.p_id)).toEqual(['reply-x', 'reply-x']);
    expect(saved!.outbox).toEqual([]);
    expect(saved!.waiting).toEqual([]);
  });

  it('linha cortada no começo da cauda e conversa de subagente não contam', () => {
    const cut = user(`${phoneMarker(A)} oi`).slice(10);
    const sidechain = JSON.stringify({ type: 'user', isSidechain: true, message: { content: `${phoneMarker(B)} oi` } });
    expect(answeredIds(tail(cut, sidechain, said('feito')), [A, B])).toEqual([]);
  });
});
