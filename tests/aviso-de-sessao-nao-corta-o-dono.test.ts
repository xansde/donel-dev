import { describe, expect, it } from 'vitest';
import { SendDriver, type SendRequest } from '../src/renderer/src/chat/sendDriver';
import type { LineInput } from '../src/shared/screenLine';

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
        this.box += paste[1];
        rest = rest.slice(paste[0].length);
        continue;
      }
      const ch = rest[0];
      rest = rest.slice(1);
      if (ch === '\r') {
        const text = this.box;
        this.box = '';
        if (text.trim() !== '') {
          this.submitted.push(text);
          this.clock.after(30, () => this.onSubmit(text));
        }
      } else if (ch === '\x7f') this.box = this.box.slice(0, -1);
      else if (ch !== '\x1b') this.box += ch;
    }
    // The terminal redraws a moment later (what the driver's screen reads depend on).
    this.clock.after(15, () => this.onRedraw());
    return true;
  }

  lines(): LineInput[] {
    return ['● resposta anterior', RULE, this.box === '' ? '❯' : `❯ ${this.box}`, RULE, this.working ? WORKING_FOOTER : IDLE_FOOTER];
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

function setup(working: boolean) {
  const clock = new Clock();
  let driver: SendDriver;
  const cli: FakeCli = new FakeCli(
    clock,
    working,
    (text) =>
      driver.handleSignal({ signal: working ? 'enqueue' : 'submit', text, at: new Date(clock.now).toISOString(), origin: 'hook' }),
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
    ackLookup: (text) => Promise.resolve({ matched: cli.submitted.some((s) => s.includes(text)) }),
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
  return { clock, cli, driver, typeAt, notice };
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
});
