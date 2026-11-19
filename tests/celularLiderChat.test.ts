import { describe, expect, it } from 'vitest';
import { RpcRefused, answeredIds, answersIn, createCelularLiderChat, parseCelularChatState, phoneMarker, type CelularChatState, type CelularLiderChatDeps } from '../src/main/lider/celular-chat';

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

    await chat.turnEnded(tail(user(`${phoneMarker(A)} Como está o time?`), tool(), said('Três Devs trabalhando.')));
    expect(replies()).toEqual([{ p_id: 'reply-1', p_em_resposta_a: A, p_texto: 'Três Devs trabalhando.' }]);

    // The next turn of the Líder (the same message still in the tail, but already answered) does not answer again.
    await chat.turnEnded(tail(user(`${phoneMarker(A)} Como está o time?`), said('Três Devs trabalhando.'), user('outra coisa'), said('ok')));
    expect(replies()).toHaveLength(1);
  });

  it('turno de outro assunto, com a mensagem ainda na fila do CLI, não responde a ela; o turno que a lê, sim', async () => {
    // The reviewer's case: the Líder is in a turn opened by a message of the team when the phone's message arrives.
    const { chat, replies } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    await chat.turnEnded(tail(user('[t-1] recado do Dev'), said('respondi ao Dev')));
    // A turn with no prompt of its own (a background task ended) does not answer the phone either.
    await chat.turnEnded(tail(user('[t-1] recado do Dev'), said('respondi ao Dev'), said('tarefa em segundo plano terminou')));
    expect(replies()).toEqual([]);
    await chat.turnEnded(tail(said('respondi ao Dev'), user(`${phoneMarker(A)} oi`), said('oi, dono')));
    expect(replies()).toEqual([{ p_id: 'reply-1', p_em_resposta_a: A, p_texto: 'oi, dono' }]);
  });

  it('mensagem posta pelo CLI no meio de um turno é respondida no fim dele, se o Líder escreveu depois de lê-la', async () => {
    const { chat, replies } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    // Read mid-turn but nothing written after it yet: wait.
    await chat.turnEnded(tail(user('[t-1] recado'), said('vou ver'), queued(`${phoneMarker(A)} oi`)));
    expect(replies()).toEqual([]);
    await chat.turnEnded(tail(user('[t-1] recado'), queued(`${phoneMarker(A)} oi`), said('oi, dono; e o Dev já foi')));
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
    await chat.turnEnded(tail(user(`${phoneMarker(A)} primeira`), queued(`${phoneMarker(B)} segunda`), said('as duas feitas')));
    expect(replies()).toEqual([
      { p_id: 'reply-1', p_em_resposta_a: A, p_texto: '↳ respondi junto com a mensagem seguinte.' },
      { p_id: 'reply-2', p_em_resposta_a: B, p_texto: 'as duas feitas' },
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
    await second.turnEnded(tail(user(`${phoneMarker(A)} oi`), said('oi, dono')));
    expect(saved!.outbox.map((reply) => reply.p_id)).toEqual(['reply-x']);
    // Restart again before the retry: the answer that failed goes on the next poll, same id.
    const third = createCelularLiderChat(deps());
    await third.poll();
    expect(calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args.p_id)).toEqual(['reply-x', 'reply-x']);
    expect(saved!.outbox).toEqual([]);
    expect(saved!.waiting).toEqual([]);
  });

  it('turno que leu a mensagem e acabou sem texto: o turno seguinte, de outro assunto, não responde com a fala dele', () => {
    // The reviewer's case (round 2): the marker and the answer are old lines in the tail; the new turn is about another thing.
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said('x'), user('outro'), said('y')), [A])).toEqual(new Map([[A, 'x']]));
    expect(answeredIds(tail(user(`${phoneMarker(A)} oi`), tool(), user('outro'), said('y')), [A])).toEqual([]);
  });

  it('turno que leu a mensagem e só escreveu espaço: nada volta ao celular', () => {
    // t-d461e003: resposta vazia nunca vai ao dono; sem texto final, espera o próximo turno ou não manda nada.
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said('  \n '), tool(), user('outro'), said('y')), [A])).toEqual(new Map());
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said(' '), tool()), [A])).toEqual(new Map());
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said('oi, dono'), said('   ')), [A]).get(A)).toBe('oi, dono');
  });

  it('fala final que é só "-": não vai ao celular nem troca a resposta boa de antes', () => {
    // t-d461e003: "-" é o marcador do stdin do script, nunca mensagem; na dúvida, não manda.
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said('-')), [A])).toEqual(new Map());
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said(' - '), tool(), user('outro')), [A])).toEqual(new Map());
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), said('oi, dono'), said('-')), [A]).get(A)).toBe('oi, dono');
  });

  it('resultado de ferramenta e aviso entre a leitura e a resposta não cortam a resposta', () => {
    const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
    const notice = JSON.stringify({ type: 'user', message: { role: 'user', content: '<task-notification>feito</task-notification>' } });
    expect(answersIn(tail(user(`${phoneMarker(A)} oi`), tool(), toolResult, notice, said('oi, dono')), [A])).toEqual(new Map([[A, 'oi, dono']]));
  });

  it('mensagem longa ou de várias linhas, gravada pelo CLI como colagem, conta como lida', () => {
    // The reviewer's case (round 3): the app delivers by bracketed paste, the CLI records `<pasted_content id=…>`.
    const pasted = `\n\n<pasted_content id="f39d">\n${phoneMarker(A)} linha 1\nlinha 2\nlinha 3\nlinha 4\n</pasted_content id="f39d">\n`;
    expect(answersIn(tail(user(pasted), said('oi, dono')), [A]).get(A)).toBe('oi, dono');
    expect(answersIn(tail(queued(pasted), said('oi, dono')), [A]).get(A)).toBe('oi, dono');
  });

  it('espelho da VPS atrasado (sem a última fala ainda) não responde com texto do meio do turno', async () => {
    const { chat, replies } = setup([{ id: A, texto: 'oi' }]);
    await chat.poll();
    expect(await chat.turnEnded(tail(user(`${phoneMarker(A)} oi`), said('vou checar')), 'Tudo certo, dono.')).toBe(false);
    expect(replies()).toEqual([]);
    expect(await chat.turnEnded(tail(user(`${phoneMarker(A)} oi`), said('vou checar'), tool(), said('Tudo certo, dono.')), 'Tudo certo, dono.')).toBe(true);
    expect(replies().map((reply) => reply.p_texto)).toEqual(['Tudo certo, dono.']);
  });

  it('resposta recusada pelo banco sai da fila e não trava as mensagens novas; envio nunca roda duas vezes junto', async () => {
    const calls: Call[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let next = 0;
    const chat = createCelularLiderChat({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === 'celular_lider_tomar') return calls.filter((call) => call.fn === 'celular_lider_tomar').length === 1 ? [{ id: A, texto: 'oi' }, { id: B, texto: 'e aí' }] : [];
        if (fn === 'celular_lider_responder' && args.p_em_resposta_a === A) throw new RpcRefused('Supabase respondeu 400 em celular_lider_responder');
        if (fn === 'celular_lider_responder') await gate;
        return true;
      },
      deliver: async () => ({ ok: true }),
      newId: () => `reply-${++next}`,
      log: () => undefined,
    });
    await chat.poll();
    const ending = chat.turnEnded(tail(user(`${phoneMarker(A)} oi`), said('resposta A'), user(`${phoneMarker(B)} e aí`), said('resposta B')));
    const polling = chat.poll();
    release();
    await Promise.all([ending, polling]);
    const sent = calls.filter((call) => call.fn === 'celular_lider_responder').map((call) => call.args.p_em_resposta_a);
    // A refused once and dropped; B sent once, not by both senders; the next poll took the queue again.
    expect(sent).toEqual([A, B]);
    expect(calls.filter((call) => call.fn === 'celular_lider_tomar').length).toBe(2);
  });

  it('recado entregue pelo Stop hook no fim do turno conta como lido uma vez, e a fala depois dele é a resposta', () => {
    // 19/11: the #9c320674 reached the Líder working, by `recados-hook.sh fim-de-turno`; the CLI records it as these lines.
    const recado = `◆ Recado r-6d950d73 do Oráculo: Do dono, pelo chat do celular ${phoneMarker(A)}: «Não tô recebendo respostas»`;
    const feedback = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: `Stop hook feedback:\n${recado}\n\n◆ Recado r-4791d39e do Oráculo: outro` } });
    const blocking = JSON.stringify({ type: 'attachment', attachment: { type: 'hook_blocking_error', hookName: 'Stop', hookEvent: 'Stop', blockingError: { blockingError: recado, command: '~/.donel/bin/recados-hook.sh fim-de-turno' } } });
    const summary = JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', hookCount: 1 });
    expect(answersIn(tail(said('fim do turno anterior'), feedback, blocking, summary, said('Estão saindo de novo, dono.')), [A])).toEqual(new Map([[A, 'Estão saindo de novo, dono.']]));
    // The attachment alone repeats the text: not a second read (the answer is not cut by it).
    expect(answersIn(tail(feedback, said('parte 1'), blocking, said('parte 2')), [A]).get(A)).toBe('parte 2');
  });

  it('outra linha meta (lembrete, comando) não conta como lida', () => {
    const meta = (content: string): string => JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content } });
    expect(answeredIds(tail(meta(`<system-reminder>${phoneMarker(A)}</system-reminder>`), said('x')), [A])).toEqual([]);
    expect(answeredIds(tail(meta(`Caveat: ${phoneMarker(A)}`), said('x')), [A])).toEqual([]);
  });

  it('aviso de tarefa em segundo plano posto pelo CLI no meio do turno não corta a resposta', () => {
    // 19/11: the #dcd0176a lost its answer to a `<task-notification>` queued into the turn before he wrote.
    const notice = queued('<task-notification>\n<task-id>wj9r35o09</task-id>\n</task-notification>');
    expect(answersIn(tail(user(`${phoneMarker(A)} feche o Dev`), tool(), notice, tool(), said('Fechei a sessão do Dev.')), [A]).get(A)).toBe('Fechei a sessão do Dev.');
  });

  it('linha cortada no começo da cauda e conversa de subagente não contam', () => {
    const cut = user(`${phoneMarker(A)} oi`).slice(10);
    const sidechain = JSON.stringify({ type: 'user', isSidechain: true, message: { content: `${phoneMarker(B)} oi` } });
    expect(answeredIds(tail(cut, sidechain, said('feito')), [A, B])).toEqual([]);
  });
});
