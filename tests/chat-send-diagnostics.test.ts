import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSendFailure, KNOWN_SEND_REASONS, sanitizeSendFailure } from '../src/shared/chat/sendDiagnostics';
import { createSend, step, type SendEvent, type SendMachineState } from '../src/shared/chat/sendMachine';
import type { LineInput } from '../src/shared/screenLine';

// Diagnóstico do envio que falhou: o `chat-diagnostics.log` recebe o motivo e o estado do portão, nunca o texto
// da mensagem nem o da tela (regra de privacidade do topo de `src/main/chat/diagnostics-log.ts`).

const RULE = '─'.repeat(100);
const IDLE_FOOTER = '  ⏸ manual mode on · ? for shortcuts · ← for agents';
const SECRET = 'segredo da conversa 4242';
const box = (text: string, footer: string | null = IDLE_FOOTER): LineInput[] => [
  '● resposta anterior com texto da tela',
  RULE,
  text === '' ? '❯' : `❯ ${text}`,
  RULE,
  ...(footer === null ? [] : [footer]),
];
const noBox = (): LineInput[] => ['● o Claude ainda está desenhando a tela', 'linha qualquer'];

function run(text: string, events: SendEvent[]): SendMachineState {
  let state = createSend({ id: 's1', text }, 0).state;
  for (const event of events) state = step(state, event).state;
  return state;
}

describe('describeSendFailure', () => {
  it('portão vencido sem caixa na tela: motivo, última espera e caixa não achada', () => {
    const state = run(SECRET, [
      { type: 'screen', now: 10, screen: { lines: noBox() } },
      { type: 'tick', now: 30_010 },
    ]);
    expect(state.phase).toBe('failed');
    const detail = describeSendFailure(state, 30_010);
    expect(detail).toEqual({
      reason: 'o Claude não ficou pronto',
      step: 'gate',
      lastWait: 'esperando o Claude ficar pronto',
      sendKind: 'prompt',
      mode: 'normal',
      attempts: 0,
      images: 0,
      firstPaste: false,
      screenRead: true,
      boxFound: false,
      footer: false,
      screenWorking: false,
      working: false,
      alive: true,
      pendingOpen: false,
      terminalNeeded: false,
      elapsedMs: 30_010,
    });
  });

  it('sem nenhuma leitura de tela: a última espera é "lendo a tela do Claude" e a caixa fica desconhecida', () => {
    const state = run(SECRET, [{ type: 'tick', now: 30_000 }]);
    const detail = describeSendFailure(state, 30_000);
    expect(detail.reason).toBe('o Claude não ficou pronto');
    expect(detail.lastWait).toBe('lendo a tela do Claude');
    expect(detail.screenRead).toBe(false);
    expect(detail.boxFound).toBeNull();
    expect(detail.footer).toBeNull();
    expect(detail.screenWorking).toBeNull();
  });

  it('caixa sem rodapé: "esperando o Claude ficar pronto" com caixa achada e sem rodapé', () => {
    const state = run(SECRET, [
      { type: 'screen', now: 5, screen: { lines: box('', null) } },
      { type: 'tick', now: 30_005 },
    ]);
    const detail = describeSendFailure(state, 30_005);
    expect(detail.lastWait).toBe('esperando o Claude ficar pronto');
    expect(detail.boxFound).toBe(true);
    expect(detail.footer).toBe(false);
  });

  it('texto que não entrou na caixa: passo "text", uma tentativa, hooks em turno', () => {
    const state = run(SECRET, [
      { type: 'env', now: 0, working: false },
      { type: 'screen', now: 1, screen: { lines: box('') } },
      { type: 'tick', now: 3_001 },
    ]);
    expect(state.phase).toBe('failed');
    const detail = describeSendFailure(state, 3_001);
    expect(detail.reason).toBe('o texto não entrou na caixa');
    expect(detail.step).toBe('text');
    expect(detail.attempts).toBe(1);
    expect(detail.boxFound).toBe(true);
    expect(detail.footer).toBe(true);
    // A última espera do portão nesta tentativa: antes da primeira leitura da tela.
    expect(detail.lastWait).toBe('lendo a tela do Claude');
  });

  it('nunca leva texto da mensagem nem da tela', () => {
    const state = run(SECRET, [
      { type: 'screen', now: 1, screen: { lines: box(`${SECRET} que ficou na caixa`) } },
      { type: 'tick', now: 3_001 },
    ]);
    const raw = JSON.stringify(describeSendFailure(state, 3_001));
    expect(raw).not.toContain('segredo');
    expect(raw).not.toContain('4242');
    expect(raw).not.toContain('resposta anterior');
  });
});

describe('sanitizeSendFailure (o main não confia no renderer)', () => {
  const good = () => {
    const state = run(SECRET, [{ type: 'tick', now: 30_000 }]);
    return describeSendFailure(state, 30_000);
  };

  it('passa um detalhe válido sem mudar nada', () => {
    const detail = good();
    expect(sanitizeSendFailure(detail)).toEqual(detail);
  });

  it('descarta campos que não conhece e troca motivo fora da lista por "outro"', () => {
    const out = sanitizeSendFailure({ ...good(), reason: SECRET, lastWait: `espera ${SECRET}`, text: SECRET, lines: [SECRET] });
    expect(out).not.toBeNull();
    expect(out!.reason).toBe('outro');
    expect(out!.lastWait).toBe('outro');
    expect(JSON.stringify(out)).not.toContain('segredo');
    expect(Object.keys(out!)).not.toContain('text');
    expect(Object.keys(out!)).not.toContain('lines');
  });

  it('tipos errados viram vazio, e entrada que não é objeto é recusada', () => {
    const out = sanitizeSendFailure({ ...good(), attempts: 'muitas', boxFound: 'sim', step: 'qualquer', sendKind: SECRET, elapsedMs: -5 });
    expect(out!.attempts).toBe(0);
    expect(out!.boxFound).toBeNull();
    expect(out!.step).toBeNull();
    expect(out!.sendKind).toBeNull();
    expect(out!.elapsedMs).toBe(0);
    expect(sanitizeSendFailure(null)).toBeNull();
    expect(sanitizeSendFailure('texto')).toBeNull();
  });
});

describe('KNOWN_SEND_REASONS', () => {
  it('cobre todo motivo literal que a máquina de envio escreve', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'shared', 'chat', 'sendMachine.ts'), 'utf8');
    const literals = new Set<string>();
    for (const m of source.matchAll(/fail\(\w+, '([^']+)'\)/g)) literals.add(m[1]!);
    for (const m of source.matchAll(/reason = '([^']+)'/g)) literals.add(m[1]!);
    expect(literals.size).toBeGreaterThan(5);
    for (const literal of literals) expect(KNOWN_SEND_REASONS).toContain(literal);
  });
});
