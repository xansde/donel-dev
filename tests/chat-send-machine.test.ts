import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyOutgoing,
  createSend,
  sanitizeOutgoing,
  step,
  type PromptSignal,
  type SendEffect,
  type SendEvent,
  type SendInput,
  type SendMachineState,
} from '../src/shared/chat/sendMachine';
import type { LineInput } from '../src/shared/screenLine';

// 014-chat T061 — máquina de envio pura (contracts/send-protocol.md). Sem timers: o tempo entra em `now`.

const RULE = '─'.repeat(100);
const IDLE_FOOTER = '  ⏸ manual mode on · ? for shortcuts · ← for agents';
const WORKING_FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for agents';

function screen(boxText: string, footer = IDLE_FOOTER, above: string[] = []): LineInput[] {
  return ['● resposta anterior', ...above, RULE, boxText === '' ? '❯' : `❯ ${boxText}`, RULE, footer];
}
const idleEmpty = () => screen('');
const workingEmpty = () => screen('', WORKING_FOOTER);
const slashMenu = (cmd: string) => screen(cmd, IDLE_FOOTER, [`  ❯ ${cmd}      comando de teste`, `    ${cmd}er     outro`]);
const dialog = (): LineInput[] =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'chat', 'screens', 'dialog-question.json'), 'utf8')).lines;

const paste = (data: string) => `\x1b[200~${data}\x1b[201~`;

class Sim {
  state: SendMachineState;
  log: SendEffect[] = [];
  last: readonly SendEffect[] = [];
  constructor(input: Partial<SendInput> & { text: string }, now = 0) {
    const r = createSend({ id: 's1', ...input }, now);
    this.state = r.state;
    this.last = r.effects;
    this.log.push(...r.effects);
  }
  ev(event: SendEvent) {
    const r = step(this.state, event);
    this.state = r.state;
    this.last = r.effects;
    this.log.push(...r.effects);
    return r;
  }
  screen(lines: LineInput[], now: number) {
    return this.ev({ type: 'screen', now, screen: { lines } });
  }
  tick(now: number) {
    return this.ev({ type: 'tick', now });
  }
  signal(signal: PromptSignal, now: number) {
    return this.ev({ type: 'signal', now, signal });
  }
  writes(effects: readonly SendEffect[] = this.last): string[] {
    return effects.filter((e): e is Extract<SendEffect, { type: 'write' }> => e.type === 'write').map((e) => e.data);
  }
  allWrites() {
    return this.writes(this.log);
  }
  get status() {
    const s = [...this.log].reverse().find((e) => e.type === 'status');
    return s as Extract<SendEffect, { type: 'status' }> | undefined;
  }
  get phase() {
    return this.state.phase;
  }
}

/** Leva um envio de prompt comum até Enter escrito (ocioso). */
function sendUntilEnter(text = 'oi tudo bem', input: Partial<SendInput> = {}) {
  const sim = new Sim({ text, ...input }, 0);
  sim.screen(idleEmpty(), 0);
  sim.screen(screen(text), 100);
  sim.tick(180);
  return sim;
}

describe('sanitizeOutgoing (§2)', () => {
  it('normaliza CRLF e CR para LF', () => {
    expect(sanitizeOutgoing('a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('remove controles, ESC e C1, mas mantém LF', () => {
    expect(sanitizeOutgoing('a\x1bb\x00c\x7fd\x85e\nf')).toBe('abcde\nf');
  });
  it('TAB vira 4 espaços', () => {
    expect(sanitizeOutgoing('a\tb')).toBe('a    b');
  });
  it('apara só as bordas', () => {
    expect(sanitizeOutgoing('  \n a  b \n ')).toBe('a  b');
  });
});

describe('classifyOutgoing (§5)', () => {
  it('prompt comum', () => {
    expect(classifyOutgoing('oi').kind).toBe('prompt');
  });
  it('skill/comando customizado', () => {
    expect(classifyOutgoing('/meu-skill arg')).toEqual({ kind: 'skill', name: 'meu-skill' });
  });
  it('/clear, /new e /reset', () => {
    for (const t of ['/clear', '/new', '/reset']) expect(classifyOutgoing(t).kind).toBe('clear');
  });
  it('/compact', () => {
    expect(classifyOutgoing('/compact foco').kind).toBe('compact');
  });
  it('comando nativo local', () => {
    expect(classifyOutgoing('/model').kind).toBe('native');
  });
  it('comando customizado com o nome de um nativo vence', () => {
    expect(classifyOutgoing('/model', { customCommands: new Set(['model']) }).kind).toBe('skill');
  });
  it('!bash', () => {
    expect(classifyOutgoing('!ls -la').kind).toBe('shell');
  });
});

describe('gate (§1)', () => {
  it('não escreve nada sem tela lida', () => {
    const sim = new Sim({ text: 'oi' });
    expect(sim.allWrites()).toEqual([]);
    expect(sim.phase).toBe('waiting-cli');
  });

  it('não escreve com diálogo na tela e não conta prazo', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(dialog(), 0);
    sim.tick(120_000);
    expect(sim.allWrites()).toEqual([]);
    expect(sim.phase).toBe('waiting-cli');
  });

  it('pendência aberta: espera sem prazo', () => {
    const sim = new Sim({ text: 'oi' });
    sim.ev({ type: 'env', now: 0, pendingOpen: true });
    sim.screen(idleEmpty(), 0);
    sim.tick(300_000);
    expect(sim.allWrites()).toEqual([]);
    expect(sim.phase).toBe('waiting-cli');
    sim.ev({ type: 'env', now: 300_001, pendingOpen: false });
    sim.screen(idleEmpty(), 300_001);
    expect(sim.allWrites()).toEqual([paste('oi')]);
  });

  it('faixa "o terminal precisa de você": espera sem prazo', () => {
    const sim = new Sim({ text: 'oi' });
    sim.ev({ type: 'env', now: 0, terminalNeeded: true });
    sim.screen(idleEmpty(), 0);
    sim.tick(100_000);
    expect(sim.phase).toBe('waiting-cli');
  });

  it('sem motivo visível: 30 s e falha "o Claude não ficou pronto"', () => {
    const sim = new Sim({ text: 'oi' }, 1000);
    sim.screen(['carregando...'], 1000);
    sim.tick(30_999);
    expect(sim.phase).toBe('waiting-cli');
    sim.tick(31_000);
    expect(sim.phase).toBe('failed');
    expect(sim.status?.reason).toBe('o Claude não ficou pronto');
  });

  it('devolve wake-at para o prazo de 30 s', () => {
    const sim = new Sim({ text: 'oi' }, 1000);
    const wake = sim.log.find((e) => e.type === 'wake-at') as Extract<SendEffect, { type: 'wake-at' }>;
    expect(wake.at).toBe(31_000);
  });

  it('processo morto não escreve', () => {
    const sim = new Sim({ text: 'oi' });
    sim.ev({ type: 'env', now: 0, alive: false });
    sim.screen(idleEmpty(), 0);
    expect(sim.allWrites()).toEqual([]);
  });

  it('prompt comum com o CLI trabalhando entra (vai para a fila do CLI)', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(workingEmpty(), 0);
    expect(sim.allWrites()).toEqual([paste('oi')]);
  });

  it.each(['/meu-skill x', '!ls'])('%s só com o CLI ocioso', (text) => {
    const sim = new Sim({ text });
    sim.screen(workingEmpty(), 0);
    sim.tick(600_000);
    expect(sim.allWrites()).toEqual([]);
    expect(sim.phase).toBe('waiting-cli');
    sim.screen(idleEmpty(), 600_001);
    expect(sim.allWrites()).toEqual([paste(text)]);
  });
});

describe('texto sobrando na caixa (§3)', () => {
  it('ocioso: pausa, avisa e oferece descartar', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(screen('rascunho'), 0);
    expect(sim.allWrites()).toEqual([]);
    const left = sim.log.find((e) => e.type === 'leftover') as Extract<SendEffect, { type: 'leftover' }>;
    expect(left).toMatchObject({ text: 'rascunho', canDiscard: true });
  });

  it('trabalhando: pausa sem descartar e ignora a ação', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(screen('rascunho', WORKING_FOOTER), 0);
    const left = sim.log.find((e) => e.type === 'leftover') as Extract<SendEffect, { type: 'leftover' }>;
    expect(left.canDiscard).toBe(false);
    sim.ev({ type: 'action', now: 10, action: 'discard-and-send' });
    expect(sim.allWrites()).toEqual([]);
  });

  it('descartar e enviar: Esc Esc numa escrita só, depois a colagem', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(screen('rascunho'), 0);
    sim.ev({ type: 'action', now: 10, action: 'discard-and-send' });
    expect(sim.writes()).toEqual(['\x1b\x1b']);
    sim.screen(idleEmpty(), 500);
    expect(sim.writes()).toEqual([paste('oi')]);
  });

  it('nunca Esc Esc com a caixa vazia', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(idleEmpty(), 0);
    sim.ev({ type: 'action', now: 10, action: 'discard-and-send' });
    expect(sim.allWrites().filter((w) => w === '\x1b\x1b')).toEqual([]);
  });

  it('placeholder e sugestão fantasma (dim) não são texto', () => {
    const sim = new Sim({ text: 'oi' });
    const ghost: LineInput[] = ['x', RULE, { text: '❯ sugestão fantasma', dim: [[2, 19]] }, RULE, IDLE_FOOTER];
    sim.screen(ghost, 0);
    expect(sim.allWrites()).toEqual([paste('oi')]);
  });
});

describe('sequência de bytes (§4)', () => {
  it('colagem, Enter em escrita separada ~80 ms depois', () => {
    const sim = new Sim({ text: 'oi tudo bem' });
    sim.screen(idleEmpty(), 0);
    expect(sim.writes()).toEqual([paste('oi tudo bem')]);
    expect(sim.phase).toBe('typing');
    const r = sim.screen(screen('oi tudo bem'), 100);
    expect(sim.phase).toBe('confirming');
    expect(sim.writes(r.effects)).toEqual([]);
    expect(r.effects).toContainEqual({ type: 'wake-at', at: 180 });
    sim.tick(150);
    expect(sim.allWrites()).toEqual([paste('oi tudo bem')]);
    sim.tick(180);
    expect(sim.writes()).toEqual(['\r']);
  });

  it('o texto é saneado antes de colar', () => {
    const sim = new Sim({ text: '  a\r\nb\tc ' });
    sim.screen(idleEmpty(), 0);
    expect(sim.writes()).toEqual([paste('a\nb    c')]);
  });

  it('texto longo vira placeholder [Pasted text #N +M lines] (M = nº de \\n)', () => {
    const text = 'l1\nl2\nl3\nl4\nl5';
    const sim = new Sim({ text });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('[Pasted text #1 +4 lines]'), 100);
    expect(sim.phase).toBe('confirming');
  });

  it('placeholder com contagem de linhas errada não vale', () => {
    const sim = new Sim({ text: 'l1\nl2\nl3\nl4\nl5' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('[Pasted text #1 +9 lines]'), 100);
    expect(sim.phase).toBe('typing');
  });

  it('imagens: uma colagem por imagem, esperando [Image #N], e só depois o texto', () => {
    const sim = new Sim({ text: 'descreva', imagePaths: ['C:\\a\\1.png', 'C:\\a\\2.png'] });
    sim.screen(idleEmpty(), 0);
    expect(sim.writes()).toEqual([paste('C:\\a\\1.png')]);
    sim.screen(screen('[Image #1]'), 100);
    expect(sim.writes()).toEqual([paste('C:\\a\\2.png')]);
    sim.screen(screen('[Image #1] [Image #2]'), 200);
    expect(sim.writes()).toEqual([paste('descreva')]);
    sim.screen(screen('[Image #1] [Image #2] descreva'), 300);
    expect(sim.phase).toBe('confirming');
  });

  it('só imagens (sem texto): vai para o Enter depois do último [Image #N]', () => {
    const sim = new Sim({ text: '', imagePaths: ['C:\\a\\1.png'] });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('[Image #1]'), 100);
    expect(sim.phase).toBe('confirming');
    sim.tick(180);
    expect(sim.writes()).toEqual(['\r']);
  });

  it('menu "/" aberto com o CLI ocioso: Esc, reconfere o texto e só então Enter', () => {
    const sim = new Sim({ text: '/spike-help' });
    sim.screen(idleEmpty(), 0);
    expect(sim.writes()).toEqual([paste('/spike-help')]);
    sim.screen(slashMenu('/spike-help'), 100);
    expect(sim.writes()).toEqual(['\x1b']);
    sim.tick(200);
    expect(sim.allWrites()).not.toContain('\r');
    sim.screen(screen('/spike-help'), 300);
    expect(sim.phase).toBe('confirming');
    sim.tick(380);
    expect(sim.writes()).toEqual(['\r']);
  });

  it('menu "/" aberto com o texto trocado depois do Esc: falha sem Enter', () => {
    const sim = new Sim({ text: '/spike-help' });
    sim.screen(idleEmpty(), 0);
    sim.screen(slashMenu('/spike-help'), 100);
    sim.screen(screen('/spike-helper'), 300);
    sim.tick(1000);
    expect(sim.allWrites()).not.toContain('\r');
  });

  it('interrupt-first: ESC com "esc to interrupt" visível e a colagem logo em seguida', () => {
    const sim = new Sim({ text: 'pare e faça', mode: 'interrupt-first' });
    sim.screen(workingEmpty(), 0);
    expect(sim.writes()).toEqual(['\x1b', paste('pare e faça')]);
  });

  it('interrupt-first com o CLI já ocioso: sem ESC', () => {
    const sim = new Sim({ text: 'oi', mode: 'interrupt-first' });
    sim.screen(idleEmpty(), 0);
    expect(sim.writes()).toEqual([paste('oi')]);
  });

  it('ação "interromper e mandar agora" numa espera com o CLI trabalhando', () => {
    const sim = new Sim({ text: '/meu-skill' });
    sim.screen(workingEmpty(), 0);
    sim.ev({ type: 'action', now: 5, action: 'interrupt-and-send' });
    expect(sim.writes()).toEqual(['\x1b', paste('/meu-skill')]);
  });
});

/** Caixa real do CLI com texto multilinha: `❯ ` + 1ª linha, continuações com 2 espaços de recuo, sem espaço no fim. */
function multilineScreen(rows: string[], footer = IDLE_FOOTER): LineInput[] {
  return ['● resposta anterior', RULE, `❯ ${rows[0]}`, ...rows.slice(1).map((r) => `  ${r}`), RULE, footer];
}

describe('texto multilinha na caixa (quebra por \n ou pela largura)', () => {
  it('rascunho com \n (Shift+Enter) é reconhecido', () => {
    const sim = new Sim({ text: 'primeira linha\nsegunda linha' });
    sim.screen(idleEmpty(), 0);
    sim.screen(multilineScreen(['primeira linha', 'segunda linha']), 100);
    expect(sim.phase).toBe('confirming');
  });

  it('linha longa quebrada num espaço pela largura é reconhecida', () => {
    const sim = new Sim({ text: 'quebra de texto longo demais' });
    sim.screen(idleEmpty(), 0);
    sim.screen(multilineScreen(['quebra', 'de texto longo demais']), 100);
    expect(sim.phase).toBe('confirming');
  });

  it('com [Image #1] na frente, \n e quebra pela largura', () => {
    const a = new Sim({ text: 'uma\nduas', imagePaths: ['a.png'] });
    a.screen(idleEmpty(), 0);
    a.screen(screen('[Image #1]'), 100);
    a.screen(multilineScreen(['[Image #1] uma', 'duas']), 200);
    expect(a.phase).toBe('confirming');

    const b = new Sim({ text: 'quebra de texto longo', imagePaths: ['a.png'] });
    b.screen(idleEmpty(), 0);
    b.screen(screen('[Image #1]'), 100);
    b.screen(multilineScreen(['[Image #1] quebra', 'de texto longo']), 200);
    expect(b.phase).toBe('confirming');
  });

  it('timeout: prefixo multilinha parcial é nosso e a caixa é limpa com Esc Esc', () => {
    const sim = new Sim({ text: 'primeira linha\nsegunda linha\nterceira' });
    sim.screen(idleEmpty(), 0);
    sim.screen(multilineScreen(['primeira linha', 'segunda']), 100);
    expect(sim.phase).toBe('typing');
    sim.tick(3000);
    expect(sim.phase).toBe('failed');
    expect(sim.allWrites()).toContain('\x1b\x1b');
  });

  it('timeout: texto multilinha alheio não é limpo', () => {
    const sim = new Sim({ text: 'primeira linha\nsegunda linha' });
    sim.screen(idleEmpty(), 0);
    sim.screen(multilineScreen(['outra coisa', 'do dono']), 100);
    sim.tick(3000);
    expect(sim.allWrites()).not.toContain('\x1b\x1b');
  });
});

describe('prazos (§6)', () => {
  it('imagem: 3 s por imagem, senão "a imagem não entrou"', () => {
    const sim = new Sim({ text: 'x', imagePaths: ['a.png'] });
    sim.screen(idleEmpty(), 0);
    sim.tick(2999);
    expect(sim.phase).toBe('typing');
    sim.tick(3000);
    expect(sim.phase).toBe('failed');
    expect(sim.status?.reason).toBe('a imagem não entrou');
  });

  it('texto: 3 s', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(idleEmpty(), 0);
    sim.tick(2999);
    expect(sim.phase).toBe('typing');
    sim.tick(3000);
    expect(sim.phase).toBe('failed');
  });

  it('texto: +1 s a cada 15 KB', () => {
    const sim = new Sim({ text: 'a'.repeat(30_000) });
    sim.screen(idleEmpty(), 0);
    sim.tick(4999);
    expect(sim.phase).toBe('typing');
    sim.tick(5000);
    expect(sim.phase).toBe('failed');
  });

  it('texto: 12 s na primeira colagem da sessão', () => {
    const sim = new Sim({ text: 'oi', firstPaste: true });
    sim.screen(idleEmpty(), 0);
    sim.tick(11_999);
    expect(sim.phase).toBe('typing');
    sim.tick(12_000);
    expect(sim.phase).toBe('failed');
  });

  it('o prazo do texto devolve wake-at', () => {
    const sim = new Sim({ text: 'oi' });
    const r = sim.screen(idleEmpty(), 1000);
    expect(r.effects).toContainEqual({ type: 'wake-at', at: 4000 });
  });

  it('estourar o prazo do texto limpa a caixa só se o texto for o nosso (ocioso)', () => {
    const sim = new Sim({ text: 'mensagem longa' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('mensagem'), 1000);
    sim.tick(3000);
    expect(sim.phase).toBe('failed');
    expect(sim.writes()).toEqual(['\x1b\x1b']);
  });

  it('estourar o prazo com a caixa vazia não escreve nada', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(idleEmpty(), 0);
    sim.screen(idleEmpty(), 1000);
    sim.tick(3000);
    expect(sim.writes()).toEqual([]);
  });

  it('aceite: 15 s depois do Enter, senão "não foi"', () => {
    const sim = sendUntilEnter();
    sim.screen(idleEmpty(), 14_999 + 180);
    expect(sim.phase).toBe('confirming');
    sim.tick(15_180);
    expect(sim.phase).toBe('failed');
    expect(sim.status?.reason).toBe('não foi');
  });
});

describe('reenvio e anti-duplicidade (§7)', () => {
  it('texto ainda na caixa 3 s depois do Enter: reenvia só \\r, uma vez', () => {
    const sim = sendUntilEnter('oi tudo bem');
    sim.screen(screen('oi tudo bem'), 3179);
    expect(sim.writes()).toEqual([]);
    sim.screen(screen('oi tudo bem'), 3180);
    expect(sim.writes()).toEqual(['\r']);
    sim.screen(screen('oi tudo bem'), 6500);
    expect(sim.writes()).toEqual([]);
    expect(sim.allWrites().filter((w) => w === '\r')).toHaveLength(2);
    expect(sim.allWrites().filter((w) => w.includes('oi tudo bem'))).toHaveLength(1);
  });

  it('caixa vazia sem aceite: espera sem reenviar', () => {
    const sim = sendUntilEnter();
    sim.screen(idleEmpty(), 3180);
    sim.screen(idleEmpty(), 10_000);
    expect(sim.allWrites().filter((w) => w === '\r')).toHaveLength(1);
    expect(sim.phase).toBe('confirming');
  });

  it('o aceite tardio ainda fecha antes do prazo', () => {
    const sim = sendUntilEnter();
    sim.screen(idleEmpty(), 3180);
    sim.signal({ signal: 'submit', text: 'oi tudo bem', at: 9000 }, 9000);
    expect(sim.phase).toBe('accepted');
  });

  it('"tentar de novo" consulta o aceite tardio antes de refazer', () => {
    const sim = sendUntilEnter('oi tudo bem');
    sim.tick(15_180);
    expect(sim.phase).toBe('failed');
    const r = sim.ev({ type: 'action', now: 20_000, action: 'retry' });
    expect(r.effects).toContainEqual({ type: 'ack-lookup', text: 'oi tudo bem', since: 0 });
    expect(sim.writes(r.effects)).toEqual([]);
  });

  it('aceite tardio achado: vira accepted sem escrever nada', () => {
    const sim = sendUntilEnter();
    sim.tick(15_180);
    sim.ev({ type: 'action', now: 20_000, action: 'retry' });
    const before = sim.allWrites().length;
    sim.ev({ type: 'ack-result', now: 20_001, found: true });
    expect(sim.phase).toBe('accepted');
    expect(sim.allWrites()).toHaveLength(before);
  });

  it('aceite tardio não achado: refaz a sequência desde o gate (nova colagem)', () => {
    const sim = sendUntilEnter('oi tudo bem');
    sim.tick(15_180);
    sim.ev({ type: 'action', now: 20_000, action: 'retry' });
    sim.ev({ type: 'ack-result', now: 20_001, found: false });
    expect(sim.phase).toBe('waiting-cli');
    sim.screen(idleEmpty(), 20_100);
    expect(sim.writes()).toEqual([paste('oi tudo bem')]);
  });

  it('retry fora de failed é ignorado', () => {
    const sim = new Sim({ text: 'oi' });
    const r = sim.ev({ type: 'action', now: 5, action: 'retry' });
    expect(r.effects.filter((e) => e.type === 'ack-lookup')).toEqual([]);
  });

  it('processo morto durante a digitação: falha, sem recolar', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(idleEmpty(), 0);
    sim.ev({ type: 'env', now: 500, alive: false });
    expect(sim.phase).toBe('failed');
  });
});

describe('aceite (§5)', () => {
  it('prompt comum, ocioso: UserPromptSubmit com o mesmo texto', () => {
    const sim = sendUntilEnter('oi tudo bem');
    sim.signal({ signal: 'submit', text: 'oi tudo bem', at: 200 }, 200);
    expect(sim.phase).toBe('accepted');
    expect(sim.status?.reason ?? '').not.toBe('não foi');
  });

  it('texto colado embrulhado casa', () => {
    const text = 'a\nb\nc\nd\ne';
    const sim = new Sim({ text });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('[Pasted text #1 +4 lines]'), 100);
    sim.tick(180);
    sim.signal({ signal: 'submit', text: `\n\n<pasted_content id="p">${text}</pasted_content id="p">\n`, at: 200 }, 200);
    expect(sim.phase).toBe('accepted');
  });

  it('sinal com outro texto é ignorado', () => {
    const sim = sendUntilEnter('oi tudo bem');
    sim.signal({ signal: 'submit', text: 'outra coisa', at: 200 }, 200);
    expect(sim.phase).toBe('confirming');
  });

  it('sinal anterior à criação do envio é ignorado', () => {
    const sim = new Sim({ text: 'oi' }, 1000);
    sim.screen(idleEmpty(), 1000);
    sim.screen(screen('oi'), 1100);
    sim.tick(1180);
    sim.signal({ signal: 'submit', text: 'oi', at: 500 }, 1200);
    expect(sim.phase).toBe('confirming');
  });

  it('trabalhando: enqueue/submit viram queued; deliver vira accepted', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(workingEmpty(), 0);
    sim.screen(screen('oi', WORKING_FOOTER), 100);
    sim.tick(180);
    sim.signal({ signal: 'enqueue', text: 'oi', at: 200 }, 200);
    expect(sim.phase).toBe('queued');
    expect(sim.status?.label).toBe('na fila');
    sim.tick(600_000);
    expect(sim.phase).toBe('queued');
    sim.signal({ signal: 'deliver', text: 'oi', at: 700_000 }, 700_000);
    expect(sim.phase).toBe('accepted');
  });

  it('trabalhando: UserPromptSubmit também vale queued', () => {
    const sim = new Sim({ text: 'oi' });
    sim.screen(workingEmpty(), 0);
    sim.screen(screen('oi', WORKING_FOOTER), 100);
    sim.tick(180);
    sim.signal({ signal: 'submit', text: 'oi', at: 200 }, 200);
    expect(sim.phase).toBe('queued');
  });

  it('skill: UserPromptSubmit com o texto cru', () => {
    const sim = new Sim({ text: '/meu-skill arg' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/meu-skill arg'), 100);
    sim.tick(180);
    sim.signal({ signal: 'submit', text: '/meu-skill arg', at: 200 }, 200);
    expect(sim.phase).toBe('accepted');
  });

  it('skill: linha <command-name> (sinal command)', () => {
    const sim = new Sim({ text: '/meu-skill arg' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/meu-skill arg'), 100);
    sim.tick(180);
    sim.signal({ signal: 'command', text: '/meu-skill', at: 200 }, 200);
    expect(sim.phase).toBe('accepted');
  });

  it('/clear: SessionEnd/Start(clear), não o submit', () => {
    const sim = new Sim({ text: '/clear' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/clear'), 100);
    sim.tick(180);
    sim.signal({ signal: 'submit', text: '/clear', at: 200 }, 200);
    expect(sim.phase).toBe('confirming');
    sim.signal({ signal: 'session-switch', at: 300 }, 300);
    expect(sim.phase).toBe('accepted');
  });

  it('/compact: sinal compact', () => {
    const sim = new Sim({ text: '/compact' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/compact'), 100);
    sim.tick(180);
    sim.signal({ signal: 'compact', at: 300 }, 300);
    expect(sim.phase).toBe('accepted');
  });

  it('comando nativo local: sinal local', () => {
    const sim = new Sim({ text: '/cost' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/cost'), 100);
    sim.tick(180);
    sim.signal({ signal: 'local', at: 300 }, 300);
    expect(sim.phase).toBe('accepted');
  });

  it('nativo que abre tela: a tela esperada aceita', () => {
    const sim = new Sim({ text: '/model', opensScreen: true });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/model'), 100);
    sim.tick(180);
    const modelScreen: LineInput[] = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'chat', 'screens', 'dialog-model.json'), 'utf8'),
    ).lines;
    sim.screen(modelScreen, 400);
    expect(sim.phase).toBe('accepted');
  });

  it('comando desconhecido: falha com o motivo', () => {
    const sim = new Sim({ text: '/naoexiste' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('/naoexiste'), 100);
    sim.tick(180);
    sim.signal({ signal: 'unknown-command', at: 300 }, 300);
    expect(sim.phase).toBe('failed');
    expect(sim.status?.reason).toBe('comando desconhecido');
  });

  it('!comando: sinal shell', () => {
    const sim = new Sim({ text: '!ls' });
    sim.screen(idleEmpty(), 0);
    sim.screen(screen('!ls'), 100);
    sim.tick(180);
    sim.signal({ signal: 'shell', text: 'ls', at: 300 }, 300);
    expect(sim.phase).toBe('accepted');
  });

  it('o sinal de tela sozinho nunca diz "entrou"', () => {
    const sim = sendUntilEnter();
    sim.screen(idleEmpty(), 500);
    expect(sim.phase).toBe('confirming');
  });
});

describe('status para a UI', () => {
  it('rótulos: na fila / enviando… / entrou / não foi', () => {
    const sim = new Sim({ text: 'oi' });
    expect(sim.status?.label).toBe('na fila');
    sim.screen(idleEmpty(), 0);
    expect(sim.status?.label).toBe('enviando…');
    sim.screen(screen('oi'), 100);
    expect(sim.status?.label).toBe('enviando…');
    sim.tick(180);
    sim.signal({ signal: 'submit', text: 'oi', at: 200 }, 200);
    expect(sim.status?.label).toBe('entrou');
  });

  it('a máquina é pura: mesmo estado e evento, mesmo resultado', () => {
    const a = new Sim({ text: 'oi' });
    const before = a.state;
    const r1 = step(before, { type: 'screen', now: 0, screen: { lines: idleEmpty() } });
    const r2 = step(before, { type: 'screen', now: 0, screen: { lines: idleEmpty() } });
    expect(r1).toEqual(r2);
    expect(a.state).toBe(before);
  });
});
