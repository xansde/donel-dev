// Etapa 2 do pivô para o celular (t-c3fbe852) — o Líder único vivo no tmux da VPS pessoal ouve o chat do celular, os
// pedidos, os avisos e os recados "para":"lider" pela fila local de recados, sem o relay que só o PC esvazia; e a
// resposta dele volta ao celular a partir do transcript local. O que quebraria sem o dono ver: a mensagem dele ao Líder
// sumir ou chegar duas vezes (dois tomadores, a volta ao relay quando o Líder sai daqui), a linha marcada como entregue
// antes de o Líder ler, ou a resposta de outro assunto voltando ao celular.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { createCelularLiderChat, desktopTakesPhoneQueue } from '../src/main/lider/celular-chat';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { chatCelularQueueOver, chatKey, createChatCelularConsumer, DELIVERED_NOTE, PARKED, type ChatCelularReplies } from '../src/oraculo/chat-celular';
import { pickLocalLeader, PICTURE_FRESH_MS } from '../src/oraculo/lider-local';
import { createGateHandler, mergePicture, type BoardPicture, type GateForward, type PictureSession } from '../src/oraculo/portao';
import { createGateRecados, createTmuxLocalSessions, type RecadosTmux } from '../src/oraculo/recados';
import { createRelay, deliverLocalFirst } from '../src/oraculo/relay';
import { createTarefasPedidasConsumer, type TarefaPedidaRow, type TarefasPedidasQueue } from '../src/oraculo/tarefas-pedidas';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const DEV = 'place:dev';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_LIDER = '77777777-2222-4333-8444-555555555555';
const SID_LIDER_NOVO = '88888888-2222-4333-8444-555555555555';
const ROW_ID = '9c4a90af-1111-4222-8333-444455556666';
const MIN = 60_000;

const card = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });
const BOARD: MindscapeBoard = { projectPath: PROJECT, pan: { x: 0, y: 0 }, zoom: 1, cards: { [DEV]: card(DEV, 'dev') }, links: [], drawings: [] };
const LISTAR = [{ id: DEV, papel: 'dev', estado: 'trabalhando' }];
const DEV_SESSION: PictureSession = { quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: DEV, papel: 'dev', papelNome: 'Dev' }, listar: LISTAR, board: BOARD };
const LIDER_SESSION: PictureSession = { quemSou: { nome: 'Líder', papel: 'lider', liderUnico: true, lugar: null }, listar: [] };

/** Transcript lines as the CLI writes them: the end-of-turn delivery is a meta "Stop hook feedback" prompt. */
const stopFeedback = (text: string): string => JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: `Stop hook feedback:\n${text}` } });
const said = (text: string, stop: string | null = 'end_turn'): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop } });

interface Row {
  id: string;
  texto: string;
  criada_em: string;
  entregue_em: number | null;
  resultado: string | null;
  tomada_em: number | null;
}

/** `celular.lider_mensagens` and its RPCs (014 + 019 of donel-celular), on a clock the test moves. */
function fakeSupabase(clock: { now: number }) {
  const rows: Row[] = [{ id: ROW_ID, texto: 'Dê acesso a Raiza à VPS de homologação', criada_em: '2026-11-18T12:25:00Z', entregue_em: null, resultado: null, tomada_em: null }];
  const replies: Array<Record<string, unknown>> = [];
  const taken: string[] = [];
  const out = (row: Row) => ({ id: row.id, texto: row.texto, criada_em: row.criada_em });
  const rpc = async (fn: string, args: object): Promise<unknown> => {
    const a = args as Record<string, unknown>;
    const open = (row: Row) => row.entregue_em === null;
    switch (fn) {
      case 'celular_lider_tomar': {
        const list = rows.filter((row) => open(row) && row.resultado === null && (row.tomada_em === null || row.tomada_em < clock.now - 10 * MIN));
        for (const row of list) {
          row.tomada_em = clock.now;
          taken.push(row.id);
        }
        return list.map(out);
      }
      case 'celular_lider_entregue': {
        const row = rows.find((r) => r.id === a.p_id && open(r));
        if (!row) return null;
        row.entregue_em = clock.now;
        row.resultado = String(a.p_resultado);
        return true;
      }
      case 'celular_lider_estacionar': {
        const row = rows.find((r) => r.id === a.p_id && open(r) && r.resultado === null);
        if (!row) return null;
        row.resultado = String(a.p_resultado);
        return true;
      }
      case 'celular_lider_estacionadas':
        return rows.filter((row) => open(row) && row.resultado === a.p_resultado).map(out);
      case 'celular_lider_responder':
        if (!replies.some((reply) => reply.p_id === a.p_id)) replies.push(a);
        return true;
      default:
        throw new Error(`rpc desconhecida ${fn}`);
    }
  };
  return { rows, rpc, replies, taken };
}

/** This VPS: the recados queue, the relay (only the PC drains it), the Líder único alive in tmux (or not). */
function vps(options: { leaderAlive?: boolean; respondida?: (id: string) => boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lider-vps-'));
  dirs.push(dir);
  const clock = { now: Date.parse('2026-11-18T12:25:05Z') };
  const live = new Set<string>([SID_DEV, ...(options.leaderAlive === false ? [] : [SID_LIDER])]);
  const picture: BoardPicture = { at: clock.now, sessoes: { [SID_DEV]: DEV_SESSION, [SID_LIDER]: LIDER_SESSION, [SID_LIDER_NOVO]: LIDER_SESSION } };
  const tails = new Map<string, string>();
  const tmux: RecadosTmux = {
    // A busy screen: nothing is typed, the end of the turn delivers.
    screen: async () => ({ inMode: false, text: 'esc to interrupt' }),
    type: async () => true,
    enter: async () => true,
    clear: async () => true,
  };
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => clock.now });
  const relay = createRelay({ filePath: join(dir, 'fila.json'), io, now: () => clock.now });
  const newRecados = () => createGateRecados({
    file: join(dir, 'recados.json'),
    io,
    ledger: () => ledger,
    picture: () => picture,
    localSessions: async () => new Set(live),
    leader: async () => pickLocalLeader(live, picture, () => null),
    tmux,
    relay: (message) => relay.send(message, 0),
    transcriptOf: async (sid) => `/t/${sid}.jsonl`,
    lastTurn: async () => null,
    transcriptHas: async () => false,
    now: () => clock.now,
    log: () => undefined,
  });
  const db = fakeSupabase(clock);
  // `chat-celular-respostas.json`: what waits for the Líder's answer survives a restart of the daemon.
  const repliesFile = join(dir, 'chat-celular-respostas.json');
  const store = {
    load: (): ChatCelularReplies | null => {
      try {
        return JSON.parse(readFileSync(repliesFile, 'utf8')) as ChatCelularReplies;
      } catch {
        return null;
      }
    },
    save: (state: ChatCelularReplies): void => writeFileSync(repliesFile, JSON.stringify(state)),
  };
  const newChat = (gate: ReturnType<typeof newRecados>) =>
    createChatCelularConsumer({
      queue: () => ({ ...chatCelularQueueOver(db.rpc), ...(options.respondida ? { respondida: options.respondida } : {}) }),
      relay,
      waitMs: 5,
      local: { deliver: gate.deliverLocal, state: gate.stateOf, tail: async (sid) => tails.get(sid) ?? null },
      store,
      log: () => undefined,
    });
  let recados = newRecados();
  let chat = newChat(recados);
  /** The PC (any app): delivers what the relay holds to the Líder único and acks. */
  const toLiderByPc: string[] = [];
  const pcDrains = (): void => {
    for (const item of relay.pending()) {
      toLiderByPc.push(item.message.leaderText);
      relay.ack(item.id, 'lider');
    }
  };
  const endTurn = async (sid: string): Promise<{ decision?: string; reason?: string }> =>
    JSON.parse((await recados.hook('fim-de-turno', { 'x-donel-tmux': `donel-${sid}` }, JSON.stringify({ session_id: sid }))).body) as { decision?: string; reason?: string };
  const w = {
    dir, clock, live, picture, tails, ledger, relay, recados, db, chat, pcDrains, toLiderByPc, endTurn, row: db.rows[0]!,
    /** `systemctl restart donel-oraculo`: the queue and the wait come back from their files. */
    restart(): void {
      recados.stop();
      recados = newRecados();
      chat = newChat(recados);
      w.recados = recados;
      w.chat = chat;
    },
  };
  return w;
}

describe('Líder único local: quem é', () => {
  it('a sessão viva no tmux com a marca do Jobu (meta) ou com liderUnico no retrato; fora do tmux, ninguém', () => {
    const picture: BoardPicture = { at: 0, sessoes: { [SID_DEV]: DEV_SESSION } };
    const meta = (sid: string) => (sid === SID_LIDER ? { leaderOfAll: true } : null);
    expect(pickLocalLeader(new Set([SID_DEV, SID_LIDER]), picture, meta)).toEqual({ sid: SID_LIDER });
    expect(pickLocalLeader(new Set([SID_DEV]), picture, meta)).toBeNull();
    expect(pickLocalLeader(new Set([SID_DEV, SID_LIDER_NOVO]), { at: 0, sessoes: { [SID_LIDER_NOVO]: LIDER_SESSION } }, () => null)).toEqual({ sid: SID_LIDER_NOVO });
    expect(pickLocalLeader(new Set([SID_DEV]), picture, () => null)).toBeNull();
  });
});

describe('chat do celular com o Líder único vivo nesta VPS', () => {
  it('vai pela fila local, marca entregue só depois do fim de turno que entregou, e a resposta do transcript volta ao celular uma vez', async () => {
    const w = vps();
    await w.chat.round();
    expect(w.row.resultado).toBe(PARKED); // the desktop (#470) never takes it again
    expect(w.row.entregue_em).toBeNull(); // queued here, not read yet
    expect(w.relay.pending()).toHaveLength(0);
    await w.chat.round();
    expect(w.row.entregue_em).toBeNull();

    const stop = await w.endTurn(SID_LIDER);
    expect(stop.decision).toBe('block');
    expect(stop.reason).toContain('[celular #9c4a90af]');
    expect(stop.reason).toContain(w.row.texto);
    await w.chat.round();
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
    expect(w.row.entregue_em).not.toBeNull();

    // The turn that read it is still going: nothing goes back yet.
    w.tails.set(SID_LIDER, [stopFeedback(stop.reason!), said('Vou ver.', 'tool_use')].join('\n'));
    await w.chat.round();
    expect(w.db.replies).toHaveLength(0);
    // It ended: his answer, to that message.
    w.tails.set(SID_LIDER, [stopFeedback(stop.reason!), said('Vou ver.', 'tool_use'), said('Pronto: a Raiza já entra na VPS.')].join('\n'));
    await w.chat.round();
    await w.chat.round();
    expect(w.db.replies).toEqual([expect.objectContaining({ p_em_resposta_a: ROW_ID, p_texto: 'Pronto: a Raiza já entra na VPS.' })]);
    expect(w.toLiderByPc).toHaveLength(0);
  });

  it('daemon reinicia entre a entrega e o fim do turno, e o Stop hook já entrega outro recado: a resposta sai uma vez', async () => {
    // 19/11 (t-d461e003): restarts at 10h27 and 10h33; the #9c320674 reached the Líder working, by the Stop hook, and the
    // next recado came in the same second his answer ended, so no round ever saw the turn ended.
    const w = vps();
    await w.chat.round();
    const stop = await w.endTurn(SID_LIDER);
    expect(stop.reason).toContain('[celular #9c4a90af]');
    await w.chat.round();
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
    w.restart();
    const blocking = JSON.stringify({ type: 'attachment', attachment: { type: 'hook_blocking_error', hookName: 'Stop', hookEvent: 'Stop', blockingError: { blockingError: stop.reason, command: '~/.donel/bin/recados-hook.sh fim-de-turno' } } });
    const summary = JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', hookCount: 2 });
    const turn = [said('fim do turno anterior'), stopFeedback(stop.reason!), blocking, summary, said('Vou ver.', 'tool_use'), said('Pronto: a Raiza já entra na VPS.')];
    w.tails.set(SID_LIDER, [...turn, stopFeedback('◆ Recado r-4791d39e do Oráculo: outro assunto')].join('\n'));
    await w.chat.round();
    expect(w.db.replies).toEqual([expect.objectContaining({ p_em_resposta_a: ROW_ID, p_texto: 'Pronto: a Raiza já entra na VPS.' })]);
    // Another restart, and the turn that went on ends: nothing goes a second time.
    w.restart();
    await w.chat.round();
    w.tails.set(SID_LIDER, [...turn, stopFeedback('◆ Recado r-4791d39e do Oráculo: outro assunto'), said('Feito o outro.')].join('\n'));
    await w.chat.round();
    expect(w.db.replies).toEqual([expect.objectContaining({ p_em_resposta_a: ROW_ID, p_texto: 'Pronto: a Raiza já entra na VPS.' })]);
  });

  it('mensagem já respondida à mão (chat_lider.py) não recebe uma segunda resposta e sai da espera', async () => {
    const byHand = new Set<string>();
    const w = vps({ respondida: (id) => byHand.has(id) });
    await w.chat.round();
    const stop = await w.endTurn(SID_LIDER);
    await w.chat.round();
    byHand.add(ROW_ID);
    w.tails.set(SID_LIDER, [stopFeedback(stop.reason!), said('Pronto: a Raiza já entra na VPS.')].join('\n'));
    await w.chat.round();
    w.restart();
    await w.chat.round();
    expect(w.db.replies).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(w.dir, 'chat-celular-respostas.json'), 'utf8'))).toEqual({ waiting: [], outbox: [] });
  });

  it('o desktop de hoje (#470, tomando a cada 5 s) e a VPS juntos: a mensagem chega uma vez só', async () => {
    const w = vps();
    const toDesktopLider: string[] = [];
    const desktop = createCelularLiderChat({
      rpc: w.db.rpc,
      now: () => w.clock.now,
      deliver: async (text) => {
        toDesktopLider.push(text);
        return { ok: true };
      },
    });
    await w.chat.round();
    for (let i = 0; i < 3; i += 1) {
      w.clock.now += 11 * MIN; // past the 10 min reservation
      await desktop.poll();
      await w.chat.round();
    }
    expect(toDesktopLider).toHaveLength(0);
    const stop = await w.endTurn(SID_LIDER);
    expect(stop.reason!.split('[celular #9c4a90af]')).toHaveLength(2);
    await w.chat.round();
    expect((await w.endTurn(SID_LIDER)).decision).toBeUndefined();
    expect(w.relay.pending()).toHaveLength(0);
  });

  it('sem Líder local: vai ao relay como hoje', async () => {
    const w = vps({ leaderAlive: false });
    await w.chat.round();
    expect(w.relay.pending().map((item) => item.key)).toEqual([chatKey(ROW_ID)]);
    w.pcDrains();
    await w.chat.round();
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
    expect(w.toLiderByPc).toHaveLength(1);
  });

  it('o Líder saiu daqui antes de ler: o item volta ao relay com a mesma chave, uma vez, e o PC entrega', async () => {
    const w = vps();
    await w.chat.round();
    w.live.delete(SID_LIDER); // closed, or moved back to the PC
    await w.recados.tick();
    expect(w.relay.pending()).toHaveLength(0); // a tmux hiccup is not a closed session
    w.clock.now += MIN;
    await w.recados.tick();
    await w.recados.tick();
    await w.chat.round();
    expect(w.relay.pending().map((item) => item.key)).toEqual([chatKey(ROW_ID)]);
    expect(w.recados.stateOf(chatKey(ROW_ID))?.estado).toBe('devolvido');
    // The Líder back here (a new tmux): the item that went to the relay stays there, never queued here again.
    w.live.add(SID_LIDER_NOVO);
    await w.chat.round();
    await w.recados.tick();
    expect((await w.endTurn(SID_LIDER_NOVO)).decision).toBeUndefined();
    w.pcDrains();
    await w.chat.round();
    expect(w.toLiderByPc).toHaveLength(1);
    expect(w.toLiderByPc[0], 'pelo PC, a resposta não volta sozinha: o texto não promete isso').not.toContain('volta sozinho');
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
    expect(w.relay.pending()).toHaveLength(0);
  });

  it('o Líder renovado nesta mesma VPS: o item segue para o tmux novo, sem passar pelo relay', async () => {
    const w = vps();
    await w.chat.round();
    w.live.delete(SID_LIDER);
    w.live.add(SID_LIDER_NOVO);
    await w.recados.tick();
    w.clock.now += MIN;
    await w.recados.tick();
    expect(w.relay.pending()).toHaveLength(0);
    expect((await w.endTurn(SID_LIDER_NOVO)).reason).toContain('[celular #9c4a90af]');
  });
});

describe('recados e avisos que caem no Líder único vivo nesta VPS', () => {
  it('"para":"lider" vai à fila local (PC ligado ou não); sem Líder local, com o PC ligado, segue ao PC', async () => {
    const w = vps();
    // A Dev the Líder único opened: it reaches him by the PC's rule (t-d461e003).
    const opened: PictureSession = { ...DEV_SESSION, listar: [{ ...LISTAR[0]!, abertaPor: 'lider' }] };
    const sent = await w.recados.enviar(SID_DEV, opened, { tool: 'sessao_enviar', para: 'lider', texto: 'terminei o PR' }, 'ligado');
    expect(sent).not.toBe('repassar');
    expect(JSON.parse((sent as { text: string }).text)).toMatchObject({ entregue: 'na-fila', para: 'lider' });
    expect((await w.endTurn(SID_LIDER)).reason).toContain('terminei o PR');
    expect(w.relay.pending()).toHaveLength(0);

    const away = vps({ leaderAlive: false });
    expect(await away.recados.enviar(SID_DEV, opened, { tool: 'sessao_enviar', para: 'lider', texto: 'terminei o PR' }, 'ligado')).toBe('repassar');
    // One the owner opened by hand, with no one above: with the PC off it is refused here as the PC would.
    const refused = await w.recados.enviar(SID_DEV, DEV_SESSION, { tool: 'sessao_enviar', para: 'lider', texto: 'oi' }, 'desligado');
    expect(refused).toMatchObject({ kind: 'error', text: expect.stringContaining('Sem ligação com o Líder único') });
  });

  it('"travada" de quem não tem ninguém acima chega ao Líder único pela fila local, uma vez', async () => {
    const w = vps();
    const caller: LedgerCaller = { projectPath: PROJECT, placeId: DEV, roleId: 'dev', boardPlaceIds: [DEV], board: BOARD };
    const created = await runLedgerTool(w.ledger, caller, { tool: 'tarefa_criar', pedido: 'faz', criterio: 'x', prazo: '2026-11-30', risco: 'baixo', dono: DEV });
    const id = (JSON.parse(created.text) as { id: string }).id;
    const call = { tool: 'tarefa_andamento' as const, id, estado: 'travada' as const, precisa: 'acesso ao banco' };
    const answer = await runLedgerTool(w.ledger, caller, call);
    w.recados.depoisDaTarefa(SID_DEV, DEV_SESSION, caller, call, answer.text);
    w.recados.depoisDaTarefa(SID_DEV, DEV_SESSION, caller, call, answer.text);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stop = await w.endTurn(SID_LIDER);
    expect(stop.reason).toContain('acesso ao banco');
    expect(stop.reason!.split('acesso ao banco')).toHaveLength(2);
    expect(w.relay.pending()).toHaveLength(0);
  });

  it('decisão já entregue pelo PC (relay com ack) não é entregue de novo pela fila local', async () => {
    const w = vps();
    const message = { projectPath: '', placeId: '', text: '◆ aviso', leaderText: '◆ aviso ao Líder', key: 'pedido:1' };
    await w.relay.send(message, 0);
    w.pcDrains();
    const deliver = deliverLocalFirst(w.recados.deliverLocal, w.relay, 0);
    expect(await deliver(message)).toBe('lider');
    expect((await w.endTurn(SID_LIDER)).decision).toBeUndefined();
  });
});

describe('pedido de tarefa pelo celular avisa o Líder', () => {
  it('a tarefa criada avisa o Líder uma vez, com a chave do pedido', async () => {
    const w = vps();
    const pedido = '00000000-0000-4000-8000-000000000001';
    const rows: Array<TarefaPedidaRow & { resultado?: string }> = [
      { pedido, titulo: 'Botão de pausar a VPS', texto: 'Quero um botão no celular.', criterio: null, prazo: null, frente: null, criada_em: '2026-11-18T11:00:00Z' },
    ];
    const queue: TarefasPedidasQueue = {
      tomar: async () => rows.filter((row) => row.resultado === undefined),
      marcar: async (id, resultado) => {
        const row = rows.find((entry) => entry.pedido === id)!;
        if (row.resultado !== undefined) return false;
        row.resultado = resultado;
        return true;
      },
      espelhar: async () => undefined,
    };
    const consumer = createTarefasPedidasConsumer({
      queue: () => queue,
      ledger: () => w.ledger,
      returned: () => false,
      quadro: () => PROJECT,
      hasMirror: true,
      avisarLider: deliverLocalFirst(w.recados.deliverLocal, w.relay, 0),
    });
    await consumer.round();
    await consumer.round();
    const id = Object.keys(w.ledger.load().doc.tasks)[0]!;
    const stop = await w.endTurn(SID_LIDER);
    expect(stop.reason).toContain(id);
    expect(stop.reason).toContain('Botão de pausar a VPS');
    expect(stop.reason!.split(id)).toHaveLength(2);
    expect(w.relay.pending()).toHaveLength(0);
  });
});

describe('portão: tarefa_* do Líder único com o PC fora', () => {
  const TOKEN = 'd'.repeat(43);
  function gate(forward: GateForward) {
    const w = vps();
    const sessions = join(w.dir, 's');
    mkdirSync(join(sessions, SID_LIDER), { recursive: true });
    writeFileSync(join(sessions, SID_LIDER, 'meta.json'), JSON.stringify({ sid: SID_LIDER, mcpToken: TOKEN, mcpPort: 25711, leaderOfAll: true }));
    const handle = createGateHandler({ sessionsDir: sessions, ledger: () => w.ledger, picture: () => w.picture, forward, serverVersion: 'teste', recados: w.recados });
    const tool = async (name: string, args: unknown) => {
      const res = await handle({ method: 'POST', path: `/s/${SID_LIDER}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      const result = (JSON.parse(res.body) as { result: { content: { text: string }[]; isError?: boolean } }).result;
      return { error: result.isError === true, text: result.content[0]!.text };
    };
    return { ...w, tool };
  }

  it('respondidas aqui como o Líder único, nos quadros que o retrato tem', async () => {
    const g = gate(async () => 'desligado');
    const created = await g.tool('tarefa_criar', { quadro: 'atlas', dono: DEV, titulo: 'Sem PC', pedido: 'faz sem o PC', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    expect(created.error).toBe(false);
    const id = (JSON.parse(created.text) as { id: string }).id;
    expect(g.ledger.load().doc.tasks[id]).toMatchObject({ projectPath: PROJECT, ownerPlaceId: DEV });
    const listed = await g.tool('tarefa_listar', {});
    expect(listed.error).toBe(false);
    expect(listed.text).toContain(id);
    expect(await g.tool('tarefa_criar', { quadro: 'beacon', dono: DEV, pedido: 'x', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' })).toMatchObject({ error: true });
    expect((await g.tool('tarefa_cancelar', { id, motivo: 'era teste' })).error).toBe(false);
  });

  it('a entrega do Líder com o PC fora avisa o Revisor de fora da cadeia pela fila local, como o caminho normal', async () => {
    const g = gate(async () => 'desligado');
    // The board with a live Revisor on this VPS.
    const REV = 'place:rev';
    const SID_REV = '99999999-2222-4333-8444-555555555555';
    const board: MindscapeBoard = { ...BOARD, cards: { ...BOARD.cards, [REV]: card(REV, 'revisor') } };
    const listar = [...LISTAR, { id: REV, papel: 'revisor', estado: 'trabalhando' }];
    const sessoes = g.picture.sessoes as Record<string, PictureSession>;
    sessoes[SID_DEV] = { ...DEV_SESSION, listar, board };
    sessoes[SID_REV] = { quemSou: { nome: 'Revisor · atlas', pasta: PROJECT, lugar: REV, papel: 'revisor', papelNome: 'Revisor' }, listar, board };
    g.live.add(SID_REV);
    const created = await g.tool('tarefa_criar', { quadro: 'atlas', dono: DEV, titulo: 'Sem PC', pedido: 'faz sem o PC', criterio: 'x', prazo: '2026-11-30', risco: 'baixo' });
    const id = (JSON.parse(created.text) as { id: string }).id;
    expect((await g.tool('tarefa_transferir', { id, para: 'seu', motivo: 'eu faço' })).error).toBe(false);
    expect((await g.tool('tarefa_assumir', { id })).error).toBe(false);
    const delivered = await g.tool('tarefa_entregar', { id, provas: [{ tipo: 'texto', texto: 'verde' }] });
    expect(delivered.error, delivered.text).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stop = await g.endTurn(SID_REV);
    expect(stop.reason).toContain(`entregou a tarefa ${id}`);
    // Nothing of his own step comes back to him, nor goes to the PC's relay.
    expect((await g.endTurn(SID_LIDER)).decision).toBeUndefined();
    expect(g.relay.pending()).toHaveLength(0);
  });

  it('com o PC ligado, seguem ao PC como hoje', async () => {
    const seen: string[] = [];
    const g = gate(async (_port, request) => {
      seen.push(request.body);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"do PC"}]}}' };
    });
    expect(await g.tool('tarefa_listar', {})).toEqual({ error: false, text: 'do PC' });
    expect(seen).toHaveLength(1);
  });
});

describe('app do desktop: quando toma a fila do celular', () => {
  const VPS = { id: 'vps-pessoal', sshTarget: 'dono@vps-pessoal' };
  const HOMOLOG = { id: 'homologacoes', sshTarget: 'dono@homologacoes' };
  const remotes = [VPS, HOMOLOG];
  const oracle = { mode: 'remoto' as const, lugar: VPS.id };
  const tabs = new Map([
    ['pty-vps', VPS.sshTarget],
    ['pty-homolog', HOMOLOG.sshTarget],
  ]);
  const sshTargetOf = (ptyId: string): string | undefined => tabs.get(ptyId);

  it('sem Líder aberto toma (e abre um); Líder no PC toma; Líder na Homologações toma; só o Líder na máquina do Oráculo deixa a fila ao Oráculo', () => {
    expect(desktopTakesPhoneQueue({ leaderPtyId: null, sshTargetOf, oracle, remotes })).toBe(true);
    expect(desktopTakesPhoneQueue({ leaderPtyId: 'pty-local', sshTargetOf, oracle, remotes })).toBe(true);
    expect(desktopTakesPhoneQueue({ leaderPtyId: 'pty-homolog', sshTargetOf, oracle, remotes })).toBe(true);
    expect(desktopTakesPhoneQueue({ leaderPtyId: 'pty-vps', sshTargetOf, oracle, remotes })).toBe(false);
    // The ledger on this PC (no Oráculo away): nobody else takes the queue.
    expect(desktopTakesPhoneQueue({ leaderPtyId: 'pty-vps', sshTargetOf, oracle: { mode: 'local', lugar: null }, remotes })).toBe(true);
    expect(desktopTakesPhoneQueue({ leaderPtyId: 'pty-vps', sshTargetOf, oracle: null, remotes })).toBe(true);
  });

  it('com o Líder fechado, o desktop toma e entrega (o deliver abre o Líder, como no #470); com ele na VPS do Oráculo, não toma', async () => {
    const clock = { now: Date.parse('2026-11-18T12:25:05Z') };
    const db = fakeSupabase(clock);
    let leaderPtyId: string | null = 'pty-vps';
    const delivered: string[] = [];
    const desktop = createCelularLiderChat({
      rpc: db.rpc,
      now: () => clock.now,
      mayTake: () => desktopTakesPhoneQueue({ leaderPtyId, sshTargetOf, oracle, remotes }),
      deliver: async (text) => {
        delivered.push(text);
        return { ok: true };
      },
    });
    await desktop.poll();
    expect(db.taken).toHaveLength(0);
    leaderPtyId = null;
    await desktop.poll();
    expect(delivered).toHaveLength(1);
  });
});

describe('Líder órfão: retrato do PC recente sem Líder nesta VPS', () => {
  const at = Date.parse('2026-11-18T12:00:00Z');
  const meta = (sid: string) => (sid === SID_LIDER ? { leaderOfAll: true } : null);
  const live = new Set([SID_DEV, SID_LIDER]);

  it('o PC empurrou há pouco e nenhuma sessão daqui é o Líder: a marca da pasta sozinha não faz Líder', () => {
    const picture = mergePicture(null, { at, sessoes: { [SID_DEV]: DEV_SESSION } }, () => true);
    expect(pickLocalLeader(live, picture, meta, at + 30_000)).toBeNull();
  });

  it('retrato velho (PC fora) ou nenhum: vale a marca da pasta', () => {
    const picture = mergePicture(null, { at, sessoes: { [SID_DEV]: DEV_SESSION } }, () => true);
    expect(pickLocalLeader(live, picture, meta, at + PICTURE_FRESH_MS + 1)).toEqual({ sid: SID_LIDER });
    expect(pickLocalLeader(live, null, meta, at)).toEqual({ sid: SID_LIDER });
  });

  it('retrato recente com o Líder: ele; o Líder que ficou só de um retrato antigo (o PC não o mostra mais) não conta', () => {
    const old = mergePicture(null, { at, sessoes: { [SID_DEV]: DEV_SESSION, [SID_LIDER]: LIDER_SESSION } }, () => true);
    expect(pickLocalLeader(live, old, meta, at + 1000)).toEqual({ sid: SID_LIDER });
    // 5 min later the PC pushes again, without the Líder (it went back to the PC): his old entry is kept by the merge.
    const later = mergePicture(old, { at: at + 5 * MIN, sessoes: { [SID_DEV]: DEV_SESSION } }, () => true);
    expect(later.sessoes[SID_LIDER]).toBeDefined();
    expect(pickLocalLeader(live, later, meta, at + 5 * MIN + 1000)).toBeNull();
  });
});

describe('tmux ls que falha não fecha as sessões', () => {
  it('falha ou timeout: o último conjunto vivo; servidor do tmux fora: nenhuma', async () => {
    const answers: Array<{ code: number; stdout: string; stderr: string }> = [
      { code: 0, stdout: `donel-${SID_DEV}\ndonel-${SID_LIDER}\noutra\n`, stderr: '' },
      { code: 1, stdout: '', stderr: '' }, // timeout (killed) or any failure
      { code: 1, stdout: '', stderr: 'server exited unexpectedly' },
      { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/donel' },
    ];
    const ls = createTmuxLocalSessions(async () => answers.shift()!);
    expect([...(await ls())]).toEqual([SID_DEV, SID_LIDER]);
    expect([...(await ls())]).toEqual([SID_DEV, SID_LIDER]);
    expect([...(await ls())]).toEqual([SID_DEV, SID_LIDER]);
    expect([...(await ls())]).toEqual([]);
  });

  it('o prompt atrasado de um recado que já voltou ao relay não o marca entregue (iria duas vezes)', async () => {
    const w = vps();
    await w.chat.round();
    w.live.delete(SID_LIDER);
    await w.recados.tick();
    w.clock.now += MIN;
    await w.recados.tick();
    expect(w.recados.stateOf(chatKey(ROW_ID))?.estado).toBe('devolvido');
    // As if it had been typed once before going back (a typing not confirmed in time).
    const file = join(w.dir, 'recados.json');
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { items: Array<Record<string, unknown>> };
    doc.items = doc.items.map((item) => ({ ...item, tentativas: 1 }));
    writeFileSync(file, JSON.stringify(doc));
    const texto = String(doc.items[0]!.texto);
    await w.recados.hook('ocupada', { 'x-donel-tmux': `donel-${SID_LIDER}` }, JSON.stringify({ session_id: SID_LIDER, prompt: texto }));
    expect(w.recados.stateOf(chatKey(ROW_ID))?.estado).toBe('devolvido');
  });
});

describe('o entregador local do #488 (decisão do dono a uma sessão daqui)', () => {
  const decision = (key: string) => ({ projectPath: PROJECT, placeId: DEV, text: '◆ O dono devolveu t-1: falta o caso vazio', leaderText: '◆ O dono devolveu t-1 (Dev)', key });

  it('a sessão morre antes do fim de turno: o item volta ao relay com a mesma chave, uma vez', async () => {
    const w = vps();
    const deliver = deliverLocalFirst(w.recados.deliverLocal, w.relay, 0);
    expect(await deliver(decision('decisao:1'))).toEqual({ placeId: DEV });
    w.live.delete(SID_DEV);
    await w.recados.tick();
    w.clock.now += MIN;
    await w.recados.tick();
    await w.recados.tick();
    expect(w.relay.pending().map((item) => item.key)).toEqual(['decisao:1']);
    expect(w.recados.stateOf('decisao:1')?.estado).toBe('devolvido');
    // A retry of the same decision now joins the relay, never the local queue again.
    expect(await deliver(decision('decisao:1'))).toBeNull();
    expect(w.relay.pending()).toHaveLength(1);
  });

  it('a mesma chave junta mesmo depois de 2 min (sem a chave, seriam dois recados)', async () => {
    const w = vps();
    const deliver = deliverLocalFirst(w.recados.deliverLocal, w.relay, 0);
    expect(await deliver(decision('decisao:2'))).toEqual({ placeId: DEV });
    w.clock.now += 5 * MIN;
    expect(await deliver(decision('decisao:2'))).toEqual({ placeId: DEV });
    const stop = await w.endTurn(SID_DEV);
    expect(stop.reason!.split('falta o caso vazio')).toHaveLength(2);
    w.clock.now += 5 * MIN;
    expect(await deliver(decision('decisao:2'))).toEqual({ placeId: DEV });
    expect((await w.endTurn(SID_DEV)).decision).toBeUndefined();
  });

  it('chave já pendente no relay fica lá: nada na fila local', async () => {
    const w = vps();
    await w.relay.send(decision('decisao:3'), 0);
    const deliver = deliverLocalFirst(w.recados.deliverLocal, w.relay, 0);
    expect(await deliver(decision('decisao:3'))).toBeNull();
    expect(w.relay.pending().map((item) => item.key)).toEqual(['decisao:3']);
    expect(w.recados.stateOf('decisao:3')).toBeUndefined();
    expect((await w.endTurn(SID_DEV)).decision).toBeUndefined();
  });

  it('fila.json ilegível não impede a entrega local (decisão e chat do celular)', async () => {
    const w = vps();
    mkdirSync(join(w.dir, 'fila.json')); // there, but unreadable: the relay throws on every read
    expect(() => w.relay.pending()).toThrow();
    const deliver = deliverLocalFirst(w.recados.deliverLocal, w.relay, 0);
    expect(await deliver(decision('decisao:4'))).toEqual({ placeId: DEV });
    await w.chat.round();
    const stop = await w.endTurn(SID_LIDER);
    expect(stop.reason).toContain('[celular #9c4a90af]');
    await w.chat.round();
    expect(w.row.resultado).toBe(DELIVERED_NOTE);
  });
});
