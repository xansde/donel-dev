import { describe, expect, it } from 'vitest';
import {
  ownerSendState,
  SendDriver,
  type SendDriverPorts,
  type SendItemView,
} from '../src/renderer/src/chat/sendDriver';
import type { SendFailureDetail } from '../src/shared/chat/sendDiagnostics';
import type { LineInput } from '../src/shared/screenLine';

// 014-chat T065 — orquestração do envio (fila FIFO, dedupe hook+transcript, timers, ack-lookup, sobra).
// Tempo e terminal são injetados: nenhum timer real.

const RULE = '─'.repeat(100);
const IDLE_FOOTER = '  ⏸ manual mode on · ? for shortcuts · ← for agents';
const WORKING_FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for agents';
const screen = (box: string, footer = IDLE_FOOTER): LineInput[] => [
  '● resposta anterior',
  RULE,
  box === '' ? '❯' : `❯ ${box}`,
  RULE,
  footer,
];

class Harness {
  t = 1000;
  lines: LineInput[] = screen('');
  writes: string[] = [];
  timers: { at: number; cb: () => void; id: number }[] = [];
  private nextId = 1;
  lookups: { text: string; since: string }[] = [];
  lookupAnswer = false;
  alive = true;
  readonly ports: SendDriverPorts = {
    now: () => this.t,
    setTimeout: (cb, ms) => {
      const id = this.nextId++;
      this.timers.push({ at: this.t + ms, cb, id });
      return id;
    },
    clearTimeout: (h) => {
      this.timers = this.timers.filter((x) => x.id !== h);
    },
    write: (data) => {
      this.writes.push(data);
      // Simula o CLI: bracketed paste cai na caixa.
      const m = /^\x1b\[200~([\s\S]*)\x1b\[201~$/.exec(data);
      if (m && this.echoPaste) this.lines = screen(m[1]!.replace(/\n/g, ' '), this.footer);
      if (data === '\r' && this.clearOnEnter) this.lines = screen('', this.footer);
      return true;
    },
    readLines: () => this.lines,
    ackLookup: (text, since) => {
      this.lookups.push({ text, since });
      return Promise.resolve({ matched: this.lookupAnswer });
    },
  };
  footer = IDLE_FOOTER;
  echoPaste = true;
  clearOnEnter = true;
  driver = new SendDriver(this.ports);

  /** Avança o relógio disparando os timers devidos, na ordem. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = Math.max(this.t, due.at);
      due.cb();
    }
    this.t = end;
  }
  screenChanged(): void {
    this.driver.onScreen();
  }
  get items(): readonly SendItemView[] {
    return this.driver.getItems();
  }
  signal(signal: string, text: string | undefined, origin?: 'hook' | 'transcript'): void {
    this.driver.handleSignal({ signal: signal as never, text, at: new Date(this.t + 1).toISOString(), origin });
  }
}

const paste = (data: string) => `\x1b[200~${data}\x1b[201~`;

describe('SendDriver', () => {
  it('cola, confirma, manda Enter e fecha com o sinal do hook', () => {
    const h = new Harness();
    const id = h.driver.enqueue({ text: 'oi tudo bem' });
    expect(h.writes).toEqual([paste('oi tudo bem')]);
    h.screenChanged();
    h.advance(100);
    expect(h.writes).toEqual([paste('oi tudo bem'), '\r']);
    expect(h.items[0]!.id).toBe(id);
    expect(h.items[0]!.state).toBe('confirming');
    h.signal('submit', 'oi tudo bem', 'hook');
    expect(h.items[0]!.state).toBe('accepted');
    expect(h.items[0]!.label).toBe('entrou');
    expect(ownerSendState(h.items[0]!)).toBe('sent');
  });

  it('um sinal fecha só UM envio: hook e transcript do mesmo prompt são deduplicados', () => {
    const h = new Harness();
    h.driver.enqueue({ text: 'igual' });
    h.driver.enqueue({ text: 'igual' });
    h.screenChanged();
    h.advance(100);
    h.signal('submit', 'igual', 'hook');
    h.signal('submit', 'igual', 'transcript'); // eco do mesmo prompt
    // O eco não fecha o segundo envio: ele só começou a colar agora.
    expect(h.items.map((i) => i.state)).toEqual(['accepted', 'typing']);
    expect(h.writes.filter((w) => w.startsWith('\x1b[200~')).length).toBe(2);
    h.screenChanged();
    h.advance(100);
    h.signal('submit', 'igual', 'hook');
    h.signal('submit', 'igual', 'transcript');
    expect(h.items.map((i) => i.state)).toEqual(['accepted', 'accepted']);
  });

  it('comando que abre tela avisa a faixa do terminal no Enter (T070), e só ele', () => {
    const h = new Harness();
    let marks = 0;
    const ports: SendDriverPorts = { ...h.ports, opensScreen: () => (marks += 1) };
    h.driver = new SendDriver(ports);
    h.driver.enqueue({ text: '/model', opensScreen: true });
    h.screenChanged();
    expect(marks).toBe(0);
    h.advance(100);
    expect(h.writes.at(-1)).toBe('\r');
    expect(marks).toBe(1);
    h.driver.enqueue({ text: 'oi' });
    h.screenChanged();
    h.advance(100);
    expect(marks).toBe(1);
  });

  it('o segundo envio espera o primeiro (fila FIFO, uma ativa por vez)', () => {
    const h = new Harness();
    h.driver.enqueue({ text: 'primeiro' });
    h.driver.enqueue({ text: 'segundo' });
    expect(h.writes).toEqual([paste('primeiro')]);
    expect(h.items[1]!.state).toBe('pending');
    expect(ownerSendState(h.items[1]!)).toBe('queued');
    h.screenChanged();
    h.advance(100);
    h.signal('submit', 'primeiro', 'hook');
    expect(h.writes[h.writes.length - 1]).toBe(paste('segundo'));
  });

  it('durante a rodada a mensagem vira "na fila" com a causa e entra na entrega', () => {
    const h = new Harness();
    h.footer = WORKING_FOOTER;
    h.lines = screen('', WORKING_FOOTER);
    h.driver.enqueue({ text: 'depois' });
    h.screenChanged();
    h.advance(100);
    h.signal('enqueue', 'depois', 'transcript');
    expect(h.items[0]!.state).toBe('queued');
    expect(ownerSendState(h.items[0]!)).toBe('queued');
    expect(h.items[0]!.queuedReason).toBe('entra na próxima pausa do Claude');
    h.signal('deliver', 'depois', 'transcript');
    expect(h.items[0]!.state).toBe('accepted');
  });

  it('caixa escondida no meio da rodada: escreve na hora, Enter sem ver o texto, "na fila" e confere no fim do turno', async () => {
    // 30/10: "Só envia, sem esperar ele finalizar, e acompanha se o próprio Claude coleta."
    const h = new Harness();
    const failures: SendFailureDetail[] = [];
    h.driver = new SendDriver({ ...h.ports, reportFailure: (detail) => failures.push(detail) });
    h.echoPaste = false;
    h.clearOnEnter = false;
    h.lines = ['  ● Bash(npx vitest run)', '    ⎿  Running…'];
    h.driver.setEnv({ working: true });
    h.driver.enqueue({ text: 'no meio do turno' });
    expect(h.writes).toEqual([paste('no meio do turno')]);
    h.advance(12_100); // prazo da primeira colagem (12 s) + o intervalo do Enter
    expect(h.writes).toEqual([paste('no meio do turno'), '\r']);
    expect(h.items[0]!.state).toBe('confirming');
    h.advance(3_000);
    expect(h.items[0]!.state).toBe('queued');
    expect(h.items[0]!.queuedReason).toBe('entra na próxima pausa do Claude');
    h.advance(120_000);
    expect(h.lookups).toEqual([]);
    // O turno acaba sem entrega: 15 s depois procura o prompt; não achou → "não foi" com o motivo honesto.
    h.lines = screen('');
    h.driver.setEnv({ working: false });
    h.advance(15_000);
    expect(h.lookups).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.items[0]!.state).toBe('failed');
    expect(h.items[0]!.reason).toBe('o Claude não pegou a mensagem');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: 'o Claude não pegou a mensagem', step: 'verify' });
    expect(h.writes.filter((w) => w.includes('no meio do turno'))).toHaveLength(1);
  });

  it('comando espera a rodada acabar e diz a causa', () => {
    const h = new Harness();
    h.footer = WORKING_FOOTER;
    h.lines = screen('', WORKING_FOOTER);
    h.driver.enqueue({ text: '/status' });
    expect(h.items[0]!.state).toBe('waiting-cli');
    expect(h.items[0]!.queuedReason).toBe('entra na próxima pausa do Claude');
    expect(h.writes).toEqual([]);
  });

  it('pendência aberta segura o envio com a causa certa', () => {
    const h = new Harness();
    h.driver.setEnv({ pendingOpen: true });
    h.driver.enqueue({ text: 'oi' });
    expect(h.writes).toEqual([]);
    expect(h.items[0]!.queuedReason).toBe('entra depois que você responder');
    h.driver.setEnv({ pendingOpen: false });
    expect(h.writes).toEqual([paste('oi')]);
  });

  it('comando desconhecido: "não foi" com motivo; retry procura o aceite antes de reenviar', async () => {
    const h = new Harness();
    h.driver.enqueue({ text: '/foobar' });
    h.screenChanged();
    h.advance(100);
    h.signal('unknown-command', '/foobar', 'transcript');
    expect(h.items[0]!.state).toBe('failed');
    expect(h.items[0]!.reason).toBe('comando desconhecido');
    expect(ownerSendState(h.items[0]!)).toBe('failed');
    h.lookupAnswer = true;
    h.driver.retry(h.items[0]!.id);
    expect(h.lookups).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.items[0]!.state).toBe('accepted');
  });

  it('Enter perdido: reenvia um \\r depois de 3 s sem duplicar a mensagem', () => {
    const h = new Harness();
    h.clearOnEnter = false;
    h.driver.enqueue({ text: 'oi' });
    h.screenChanged();
    h.advance(100);
    expect(h.writes.filter((w) => w === '\r')).toHaveLength(1);
    h.advance(3000);
    expect(h.writes.filter((w) => w === '\r')).toHaveLength(2);
    expect(h.writes.filter((w) => w.startsWith('\x1b[200~'))).toHaveLength(1);
  });

  it('cada envio que termina em "não foi" vai uma vez ao diagnóstico, sem o texto da mensagem', async () => {
    const h = new Harness();
    const failures: SendFailureDetail[] = [];
    h.driver = new SendDriver({ ...h.ports, reportFailure: (detail) => failures.push(detail) });
    h.driver.enqueue({ text: '/foobar' });
    h.screenChanged();
    h.advance(100);
    h.signal('unknown-command', '/foobar', 'transcript');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: 'comando desconhecido', step: 'await-ack', sendKind: 'slash', attempts: 1 });
    expect(JSON.stringify(failures)).not.toContain('foobar');
    // Mais eventos sobre o envio já falho não repetem o registro.
    h.screenChanged();
    h.advance(20_000);
    expect(failures).toHaveLength(1);
    // Tentar de novo e falhar de novo é outro registro.
    h.driver.retry(h.items[0]!.id);
    await Promise.resolve();
    await Promise.resolve();
    h.screenChanged();
    h.advance(100);
    h.signal('unknown-command', '/foobar', 'transcript');
    expect(h.items[0]!.state).toBe('failed');
    expect(failures).toHaveLength(2);
  });

  it('envio aceito não vai ao diagnóstico; mensagem vazia vai', () => {
    const h = new Harness();
    const failures: SendFailureDetail[] = [];
    h.driver = new SendDriver({ ...h.ports, reportFailure: (detail) => failures.push(detail) });
    h.driver.enqueue({ text: 'oi' });
    h.screenChanged();
    h.advance(100);
    h.signal('submit', 'oi', 'hook');
    expect(h.items[0]!.state).toBe('accepted');
    expect(failures).toHaveLength(0);
    h.driver.enqueue({ text: '   ' });
    expect(failures).toEqual([expect.objectContaining({ reason: 'mensagem vazia', step: 'gate' })]);
  });

  it('sobra de texto na caixa: avisa e permite descartar', () => {
    const h = new Harness();
    h.lines = screen('rascunho do terminal');
    h.driver.enqueue({ text: 'oi' });
    expect(h.items[0]!.leftover).toEqual({ text: 'rascunho do terminal', canDiscard: true });
    expect(h.writes).toEqual([]);
    h.driver.discardAndSend(h.items[0]!.id);
    expect(h.writes).toEqual(['\x1b\x1b']);
  });

  it('texto devolvido pelo CLI: marcar o envio, descartar a sobra e a fila segue sem ficar presa', () => {
    const h = new Harness();
    const first = h.driver.enqueue({ text: 'teste grande' });
    h.screenChanged();
    h.advance(100);
    h.signal('submit', 'teste grande', 'hook');
    expect(h.items[0]!.state).toBe('accepted');
    // Esc antes da resposta: o CLI devolve o texto à caixa.
    h.lines = screen('teste grande');
    h.driver.enqueue({ text: 'segunda' });
    expect(h.items[1]!.leftover).toEqual({ text: 'teste grande', canDiscard: true });
    expect(h.items[1]!.queuedReason).toBe('entra quando a caixa do terminal esvaziar');
    h.driver.markReturned(first);
    expect(h.items[0]!.returned).toBe(true);
    expect(ownerSendState(h.items[0]!)).toBe('interrupted');
    h.driver.discardAndSend(h.items[1]!.id);
    expect(h.writes.at(-1)).toBe('');
    // A caixa esvazia: a segunda mensagem sai.
    h.lines = screen('');
    h.screenChanged();
    expect(h.writes.at(-1)).toBe(paste('segunda'));
    expect(h.items[1]!.leftover).toBeNull();
    expect(h.items[1]!.state).toBe('typing');
  });

  it('interromper e mandar: Esc primeiro, só depois o texto', () => {
    const h = new Harness();
    h.footer = WORKING_FOOTER;
    h.lines = screen('', WORKING_FOOTER);
    h.driver.enqueue({ text: 'para tudo', mode: 'interrupt-first' });
    // Esc primeiro; o texto só depois de o turno parar (colado junto, o ESC virava prefixo da colagem).
    expect(h.writes).toEqual(['\x1b']);
    h.footer = IDLE_FOOTER;
    h.lines = screen('', IDLE_FOOTER);
    h.screenChanged();
    expect(h.writes[0]).toBe('\x1b');
    expect(h.writes[1]).toBe(paste('para tudo'));
  });

  it('notifica os assinantes a cada mudança e para depois de cancelar', () => {
    const h = new Harness();
    let n = 0;
    const off = h.driver.subscribe(() => (n += 1));
    h.driver.enqueue({ text: 'oi' });
    expect(n).toBeGreaterThan(0);
    off();
    const before = n;
    h.driver.enqueue({ text: 'de novo' });
    expect(n).toBe(before);
  });

  it('dismiss tira o envio da lista; dispose cancela timers', () => {
    const h = new Harness();
    const id = h.driver.enqueue({ text: 'oi' });
    h.screenChanged();
    h.advance(100);
    h.signal('submit', 'oi', 'hook');
    h.driver.dismiss(id);
    expect(h.items).toHaveLength(0);
    h.driver.enqueue({ text: 'x' });
    h.driver.dispose();
    expect(h.timers).toHaveLength(0);
  });
});
