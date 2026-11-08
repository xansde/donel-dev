import { describe, expect, it } from 'vitest';
import { SendDriver, type SendRequest } from '../src/renderer/src/chat/sendDriver';
import type { LineInput } from '../src/shared/screenLine';
import { AgentBridge, type AgentBridgePorts, type BridgeTab } from '../src/renderer/src/Mindscape/agentBridge';
import { addPlace, emptyMindscapeDoc } from '../src/shared/mindscape/model';

// 06/11 — "◆ … terminou" chegando enquanto o dono digita no terminal do Líder: o Enter do aviso levou junto o que
// ele digitava, cortado ("trava não fi"), e a mensagem dele esperava atrás de todos os avisos. Aqui o terminal é
// simulado byte a byte (a caixa do CLI, o Enter, a fila do CLI no meio do turno) e o relógio é manual.

const RULE = '─'.repeat(100);
const WORKING_FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for agents';
const IDLE_FOOTER = '  ⏸ manual mode on · ? for shortcuts · ← for agents';

/** The CLI's input box and what Enter submits, fed by the driver's writes and the owner's keys. */
class FakeCli {
  box = '';
  readonly submitted: string[] = [];
  /** How many of the next Enters the CLI swallows (a lost Enter: busy, short of RAM). */
  dropEnters = 0;
  /** A paste that the CLI only draws this long after it arrived (a loaded machine). */
  pasteDelayMs = 0;
  /** Each paste shows as `[Pasted text #N +M lines]`, as the CLI draws a long one (what Enter submits stays the text). */
  asPlaceholder = false;
  /** Text that lands in the box right before the next paste (a leftover redrawn late, after a reattach). */
  intrude: string | null = null;
  /** What the box shows (the box itself is what an Enter submits). */
  private shown = '';
  private pasteSeq = 0;
  constructor(
    private readonly clock: Clock,
    public working: boolean,
    private readonly onSubmit: (text: string) => void,
    private readonly onRedraw: () => void,
  ) {}

  write(data: string): boolean {
    let rest = data;
    while (rest !== '') {
      const paste = /^\x1b\[200~([\s\S]*?)\x1b\[201~/.exec(rest);
      if (paste) {
        const text = paste[1];
        if (this.intrude !== null) {
          this.add(this.intrude);
          this.intrude = null;
        }
        if (this.pasteDelayMs > 0)
          this.clock.after(this.pasteDelayMs, () => {
            this.add(text);
            this.onRedraw();
          });
        else this.add(text);
        rest = rest.slice(paste[0].length);
        continue;
      }
      const ch = rest[0];
      rest = rest.slice(1);
      if (ch === '\r' && this.dropEnters > 0) this.dropEnters -= 1;
      else if (ch === '\r') {
        const text = this.box;
        this.box = '';
        this.shown = '';
        if (text.trim() !== '') {
          this.submitted.push(text);
          this.clock.after(30, () => this.onSubmit(text));
        }
      } else if (ch === '\x1b' && rest[0] === '\x1b') {
        rest = rest.slice(1);
        this.box = ''; // Esc Esc clears the box
        this.shown = '';
      } else if (ch === '\x7f') {
        this.box = this.box.slice(0, -1);
        this.shown = this.shown.slice(0, -1);
      } else if (ch !== '\x1b') {
        this.box += ch;
        this.shown += ch;
      }
    }
    // The terminal redraws a moment later (what the driver's screen reads depend on).
    this.clock.after(15, () => this.onRedraw());
    return true;
  }

  private add(text: string): void {
    this.box += text;
    this.shown += this.asPlaceholder ? `[Pasted text #${++this.pasteSeq} +${(text.match(/\n/g) ?? []).length} lines]` : text;
  }

  lines(): LineInput[] {
    return ['● resposta anterior', RULE, this.shown === '' ? '❯' : `❯ ${this.shown}`, RULE, this.working ? WORKING_FOOTER : IDLE_FOOTER];
  }
}

class Clock {
  now = 0;
  private timers: { at: number; seq: number; cb: () => void; live: boolean }[] = [];
  private seq = 0;
  after(ms: number, cb: () => void): { live: boolean } {
    const timer = { at: this.now + ms, seq: ++this.seq, cb, live: true };
    this.timers.push(timer);
    return timer;
  }
  advanceTo(t: number): void {
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (due === undefined) break;
      due.live = false;
      this.now = due.at;
      due.cb();
    }
    this.timers = this.timers.filter((x) => x.live);
    this.now = t;
  }
}

function setup(working: boolean, signals = true, inTranscript?: (text: string) => boolean) {
  const clock = new Clock();
  let driver: SendDriver;
  const cli: FakeCli = new FakeCli(
    clock,
    working,
    (text) => {
      if (signals) driver.handleSignal({ signal: working ? 'enqueue' : 'submit', text, at: new Date(clock.now).toISOString(), origin: 'hook' });
    },
    () => driver.onScreen(),
  );
  driver = new SendDriver({
    now: () => clock.now,
    setTimeout: (cb, ms) => clock.after(ms, cb),
    clearTimeout: (h) => {
      if (h) (h as { live: boolean }).live = false;
    },
    write: (data) => cli.write(data),
    readLines: () => cli.lines(),
    ackLookup: (text) => Promise.resolve({ matched: inTranscript ? inTranscript(text) : cli.submitted.some((s) => s.includes(text)) }),
  });
  driver.setEnv({ working });
  /** The owner's keys in the terminal: through the driver's gate (as TerminalPane does), or straight to the PTY. */
  const ownerKey = (data: string): void => {
    const gate = (driver as unknown as { ownerInput?: (d: string, f: (d: string) => void) => void }).ownerInput;
    if (typeof gate === 'function') gate.call(driver, data, (d) => cli.write(d));
    else cli.write(data);
  };
  /** Types `text` one key every `gapMs`, from `at`, then Enter (unless `enter` is false). Returns when the Enter goes. */
  const typeAt = (at: number, text: string, gapMs = 120, enter = true): number => {
    [...text].forEach((ch, i) => clock.after(at - clock.now + i * gapMs, () => ownerKey(ch)));
    const enterAt = at + text.length * gapMs;
    if (enter) clock.after(enterAt - clock.now, () => ownerKey('\r'));
    return enterAt;
  };
  const notice = (text: string): string => driver.enqueue({ text, from: 'session' } as SendRequest);
  return { clock, cli, driver, typeAt, notice, ownerKey };
}

const NOTICES = [
  '◆ Revisor (place:r1, quadro Donel Dev) terminou: Aprovei o #254 e mesclei em staging.',
  '◆ Dev (place:d1, quadro Donel Dev) terminou: Já assumi a tarefa t-c86b9505.',
  '◆ Theo West (place:t1, quadro BizOps) terminou: A validação da correção passou.',
];
const OWNER = 'trava não fica esperando';

/** Each submitted prompt is the owner's whole text or only notices: never his text cut or glued to a notice. */
function expectOwnerIntact(submitted: readonly string[]): void {
  const withOwner = submitted.filter((s) => /trava|não fica|esperando/.test(s));
  expect(withOwner).toEqual([OWNER]);
  for (const s of submitted.filter((x) => x !== OWNER)) expect(s.split('\n').every((line) => line.startsWith('◆ '))).toBe(true);
}

/** Every notice went in, once. */
function expectNoNoticeLost(submitted: readonly string[]): void {
  const lines = submitted.flatMap((s) => s.split('\n')).filter((l) => l.startsWith('◆ '));
  expect([...lines].sort()).toEqual([...NOTICES].sort());
}

describe('aviso de sessão chegando enquanto o dono digita (06/11)', () => {
  it('o dono começa a digitar no terminal logo depois que o aviso foi colado (Claude no meio do turno): nada se mistura nem corta', () => {
    const { clock, cli, typeAt, notice } = setup(true);
    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    const enterAt = typeAt(1_005, OWNER);
    // More notices arrive while he types.
    clock.after(800, () => notice(NOTICES[1]));
    clock.after(1_600, () => notice(NOTICES[2]));
    clock.advanceTo(enterAt + 30_000);
    expectOwnerIntact(cli.submitted);
    expectNoNoticeLost(cli.submitted);
    // The ones that waited for him went in as ONE message, after his.
    expect(cli.submitted.indexOf(OWNER)).toBeLessThan(cli.submitted.length - 1);
    expect(cli.submitted.at(-1)).toBe(`${NOTICES[1]}\n${NOTICES[2]}`);
  });

  it('o dono deixa texto na caixa sem enviar: os avisos esperam, sem prazo, e entram depois do Enter dele', () => {
    const { clock, cli, typeAt, notice } = setup(false);
    clock.advanceTo(1_000);
    typeAt(1_000, 'trava não', 120, false);
    clock.after(2_000, () => notice(NOTICES[0]));
    clock.after(2_500, () => notice(NOTICES[1]));
    clock.after(3_000, () => notice(NOTICES[2]));
    // Two minutes away from the keyboard with half a message in the box.
    clock.advanceTo(121_000);
    expect(cli.submitted).toEqual([]);
    expect(cli.box).toBe('trava não');
    const enterAt = typeAt(121_000, ' fica esperando');
    clock.advanceTo(enterAt + 30_000);
    expectOwnerIntact(cli.submitted);
    expectNoNoticeLost(cli.submitted);
    expect(cli.submitted).toEqual([OWNER, NOTICES.join('\n')]);
  });

  it('a mensagem do dono (chat ou Jobu) passa na frente dos avisos que ainda não começaram', () => {
    const { clock, cli, driver, notice } = setup(false);
    clock.advanceTo(1_000);
    const ids = NOTICES.map((text) => notice(text));
    clock.advanceTo(1_005);
    const mine = driver.enqueue({ text: OWNER });
    clock.advanceTo(60_000);
    expectOwnerIntact(cli.submitted);
    expectNoNoticeLost(cli.submitted);
    // At most the notice already being written goes before him.
    expect(cli.submitted.indexOf(OWNER)).toBeLessThanOrEqual(1);
    // Every notice's id (merged or not) answers as delivered: none is lost for whoever waits on it (sessao_enviar).
    const carrierOf = (id: string) => (driver as unknown as { carrierOf?: (i: string) => string }).carrierOf?.(id) ?? id;
    for (const id of [...ids, mine]) {
      const view = driver.getItems().find((item) => item.id === carrierOf(id));
      expect(view?.state ?? 'accepted').toBe('accepted');
    }
  });

  it('o Enter do aviso se perde enquanto o dono digita: o app reenvia o Enter antes de soltar as teclas dele', () => {
    const { clock, cli, notice, typeAt } = setup(false);
    clock.advanceTo(1_000);
    cli.dropEnters = 1;
    notice(NOTICES[0]);
    const enterAt = typeAt(1_005, OWNER);
    clock.advanceTo(enterAt + 30_000);
    expect(cli.dropEnters).toBe(0);
    expect(cli.submitted).toEqual([NOTICES[0], OWNER]);
  });

  it('"Pedir" e "Escrever para…" do dono chegando no meio de avisos: entram sozinhos, na frente, nunca grudados', async () => {
    const { clock, cli, driver, notice, typeAt } = setup(true);
    const ATLAS = 'C:/atlas';
    const doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: 'place:lider' });
    const tabs: BridgeTab[] = [
      { id: 'tab-lider', name: 'Líder', cwd: ATLAS, placeId: 'place:lider', roleId: 'lider', leaderOfAll: true, claudeSessionId: 's-l', sessionType: 'claude' },
    ];
    // As the app wires the port: the line goes to the tab's send driver, as `session` unless the bridge says whose.
    const ports = {
      loaded: true,
      doc: () => doc,
      tabs: () => tabs,
      stateOf: () => 'working' as const,
      unconfirmed: () => false,
      deliverLine: async (_tab: string, text: string, _wait: number, from?: 'owner' | 'session') => {
        driver.enqueue({ text, from: from ?? 'session' });
        return { kind: 'entrou' as const };
      },
    } as unknown as AgentBridgePorts;
    const bridge = new AgentBridge(ports);
    const PEDIR = 'Líder, para tudo e me chama';
    const ESCREVER = 'pode mesclar o #254';

    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    // The owner types in the Líder's terminal; notices pile up; his "Pedir" and "Escrever" arrive in the middle.
    const enterAt = typeAt(1_005, OWNER);
    clock.after(600, () => notice(NOTICES[1]));
    clock.after(900, () => void bridge.deliverOwnerMessage({ projectPath: '', placeId: '', text: PEDIR, leaderText: PEDIR }));
    clock.after(1_200, () => notice(NOTICES[2]));
    clock.after(1_500, () => void bridge.deliverOwnerMessage({ projectPath: ATLAS, placeId: 'place:lider', text: ESCREVER, leaderText: ESCREVER }));
    await Promise.resolve();
    clock.advanceTo(enterAt + 60_000);

    const mine = [OWNER, PEDIR, ESCREVER];
    // Each message of the owner went in alone, whole; every other submission is only notices.
    for (const text of mine) expect(cli.submitted.filter((s) => s.includes(text))).toEqual([text]);
    for (const s of cli.submitted.filter((x) => !mine.includes(x))) expect(s.split('\n').every((line) => line.startsWith('◆ '))).toBe(true);
    expectNoNoticeLost(cli.submitted);
    // His messages go before the notices that were still waiting.
    expect(cli.submitted.indexOf(PEDIR)).toBeLessThan(cli.submitted.indexOf(`${NOTICES[1]}\n${NOTICES[2]}`));
    expect(cli.submitted.indexOf(ESCREVER)).toBeLessThan(cli.submitted.indexOf(`${NOTICES[1]}\n${NOTICES[2]}`));
  });
});

// t-116a8521 / t-1cf1ed54 (07/11) — sessão na VPS com o app a 100 % de CPU: o hook de aceite não chega, quem mandou ouve
// "não entrou" ou "o app não respondeu a tempo" e manda de novo; a mensagem chegava duplicada. E a sessão que já tinha
// pego o pedido era dada como "não começou" por nunca ter mandado um hook.
describe('mensagem de outra sessão sem sinal de aceite (07/11)', () => {
  const TEXT = '◆ De Revisor (place:r1): aprovei, pode mesclar.';

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('entra uma vez só: o reenvio enquanto a primeira está a caminho responde por ela, e a sessão conta como tendo pego a mensagem', async () => {
    const { clock, cli, driver } = setup(false, false);
    clock.advanceTo(1_000);
    expect(driver.tookMessage()).toBe(false);
    const first = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    clock.advanceTo(10_000); // quem mandou ouviu timeout e manda de novo, com a primeira ainda sem aceite
    const again = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    expect(driver.carrierOf(again)).toBe(first);
    clock.advanceTo(47_000); // a tab's first send waits 45 s for the acceptance, then asks the transcript
    await flush();
    clock.advanceTo(60_000);
    expect(cli.submitted).toEqual([TEXT]);
    expect(driver.getItems().find((i) => i.id === first)?.state).toBe('accepted');
    expect(driver.wasDelivered(again)).toBe(true);
    expect(driver.tookMessage()).toBe(true);
  });

  // Revisão do #281: "Siga de onde parou" mandado de novo depois de um segundo 429 não era escrito, e o Líder ouvia "entrou".
  it('o mesmo texto mandado de novo depois que a primeira entrou é mensagem nova, e entra', () => {
    const { clock, cli, driver } = setup(false);
    clock.advanceTo(1_000);
    const first = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    clock.advanceTo(20_000);
    expect(driver.getItems().find((i) => i.id === first)?.state).toBe('accepted');
    clock.advanceTo(140_000);
    const again = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    clock.advanceTo(170_000);
    expect(again).not.toBe(first);
    expect(cli.submitted).toEqual([TEXT, TEXT]);
    expect(driver.getItems().find((i) => i.id === again)?.state).toBe('accepted');
  });

  // Revisão do #281, item 2: Claude parado, caixa vazia, transcript da VPS chegando pelo espelho alguns segundos atrasado.
  // A consulta única dava "não foi", quem mandou reenviava, e a mensagem entrava duas vezes.
  it('transcript atrasado na hora da consulta: pergunta de novo antes de dizer "não foi"', async () => {
    let mirrored = false;
    const { clock, cli, driver } = setup(false, false, (text) => mirrored && cli.submitted.some((s) => s.includes(text)));
    clock.advanceTo(1_000);
    const first = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    clock.advanceTo(47_000); // prazo do aceite: o transcript ainda não chegou
    await flush();
    clock.advanceTo(50_000);
    expect(driver.getItems().find((i) => i.id === first)?.state).not.toBe('failed');
    mirrored = true; // o espelho trouxe o transcript
    clock.advanceTo(65_000);
    await flush();
    clock.advanceTo(66_000);
    expect(driver.getItems().find((i) => i.id === first)?.state).toBe('accepted');
    expect(cli.submitted).toEqual([TEXT]);
  });

  it('o reenvio de uma mensagem que de fato não entrou vai de novo', () => {
    const { clock, cli, driver } = setup(false);
    clock.advanceTo(1_000);
    driver.setEnv({ alive: false });
    const first = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    clock.advanceTo(300_000);
    expect(driver.getItems().find((i) => i.id === first)?.state).toBe('failed');
    driver.setEnv({ alive: true });
    const again = driver.enqueue({ text: TEXT, from: 'session', dedupe: true });
    clock.advanceTo(330_000);
    expect(driver.carrierOf(again)).toBe(again);
    expect(cli.submitted).toEqual([TEXT]);
  });

  // 08/11 — 6 sessões numa VPS com "[Pasted text #N +M lines]" parado na caixa, sem o Enter. O CLI de lá perdia Enters
  // (ssh + tmux, máquina carregada) e, ao reanexar, o terminal respondia às perguntas do tmux (versão, cores): o app
  // contava essas respostas como o dono digitando e parava de reenviar o Enter. Depois do "não foi", o aviso ficava na
  // caixa e travava todos os que vinham atrás dele ("sobrou texto na caixa").
  const terminalReplies = (driver: SendDriver): void => {
    for (const reply of ['\x1b[>0;276;0c', '\x1bP>|xterm.js(6.0.0)\x1b\\', '\x1b]11;rgb:0e0e/1111/1616\x1b\\']) driver.ownerInput(reply, () => undefined);
  };

  it('Enter perdido várias vezes numa sessão parada da VPS: o app insiste só no Enter até o aviso sair da caixa, e ele entra uma vez (08/11)', () => {
    const { clock, cli, driver, notice } = setup(false);
    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    clock.advanceTo(60_000);
    expect(cli.submitted).toEqual([NOTICES[0]]);
    cli.dropEnters = 5;
    notice(NOTICES[1]);
    clock.after(400, () => terminalReplies(driver)); // tmux reattached right after the Enter: the terminal answers it
    clock.advanceTo(180_000);
    expect(cli.box).toBe('');
    expect(cli.submitted).toEqual([NOTICES[0], NOTICES[1]]);
  });

  it('o CLI nunca pega o Enter: o aviso não fica parado na caixa travando os seguintes, e nada entra em dobro (08/11)', () => {
    const { clock, cli, driver, notice } = setup(false);
    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    clock.advanceTo(60_000);
    cli.dropEnters = 1_000;
    const stuck = notice(NOTICES[1]);
    clock.advanceTo(240_000);
    expect(driver.getItems().find((item) => item.id === stuck)?.state).toBe('failed');
    expect(cli.box).toBe('');
    cli.dropEnters = 0;
    notice(NOTICES[2]);
    clock.advanceTo(300_000);
    expect(cli.submitted).toEqual([NOTICES[0], NOTICES[2]]);
  });

  it('a colagem só aparece na caixa 40 s depois (máquina carregada): leva o Enter quando aparece, e entra uma vez (08/11)', () => {
    const { clock, cli, notice } = setup(false);
    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    clock.advanceTo(60_000);
    cli.pasteDelayMs = 40_000;
    notice(NOTICES[1]);
    clock.advanceTo(180_000);
    expect(cli.box).toBe('');
    expect(cli.submitted).toEqual([NOTICES[0], NOTICES[1]]);
  });

  // 08/11 (BizOps) — depois de reiniciar o PC, o texto que tinha ficado preso na caixa da sessão remota emendou na
  // mensagem seguinte: a caixa foi lida vazia, o resto reapareceu junto com a colagem, e o Enter levou os dois.
  const STALE = '◆ Dev (place:d9, quadro Donel Dev) terminou: resto de antes do reinício\n- e uma segunda linha';

  it('o resto parado reaparece na caixa junto com a colagem: o aviso não sai emendado nele, e entra uma vez (08/11)', () => {
    const { clock, cli, notice } = setup(false);
    cli.asPlaceholder = true;
    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    clock.advanceTo(60_000);
    cli.intrude = STALE;
    notice(NOTICES[1]);
    clock.advanceTo(300_000);
    expect(cli.submitted).toEqual([NOTICES[0], NOTICES[1]]);
    expect(cli.box).toBe('');
  });

  it('o mesmo no meio do turno do Claude de lá: não manda o Enter emendado; espera o turno acabar, limpa e cola de novo (08/11)', () => {
    const { clock, cli, driver, notice } = setup(true);
    clock.advanceTo(1_000);
    notice(NOTICES[0]);
    clock.advanceTo(60_000);
    cli.intrude = STALE;
    notice(NOTICES[1]);
    clock.after(30_000, () => {
      cli.working = false;
      driver.setEnv({ working: false });
      driver.onScreen();
    });
    clock.advanceTo(300_000);
    expect(cli.submitted.filter((s) => s.includes('resto de antes'))).toEqual([]);
    expect(cli.submitted).toEqual([NOTICES[0], NOTICES[1]]);
  });
});
