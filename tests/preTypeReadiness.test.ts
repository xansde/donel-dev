import { describe, expect, it } from 'vitest';
import { CLI_READY_MARKER, hasClaudeReadyMarker, isReadyToPreType } from '../src/shared/preTypeReadiness';
import { TRUST_DIALOG_CONFIRM_MARKER, TRUST_DIALOG_EXIT_MARKER } from '../src/shared/trustDialog';

// T312/T319 (003-modo-dev, Batch B) — quando é seguro pré-digitar (CA-3/CA-16).
// Ver o comentário de topo de `src/shared/preTypeReadiness.ts` para o achado
// que obrigou dois sinais em vez do único previsto no plan.md.

const BANNER = ['✻ Welcome to Claude Code!', '> '];
const TRUST = [...BANNER, TRUST_DIALOG_CONFIRM_MARKER, TRUST_DIALOG_EXIT_MARKER];

describe('hasClaudeReadyMarker', () => {
  it('reconhece o banner do REPL sem depender de caixa', () => {
    expect(hasClaudeReadyMarker(BANNER)).toBe(true);
    expect(hasClaudeReadyMarker(['CLAUDE CODE v2'])).toBe(true);
  });

  it('buffer vazio ou só ruído não é prontidão', () => {
    expect(hasClaudeReadyMarker([])).toBe(false);
    expect(hasClaudeReadyMarker(['conectando...'])).toBe(false);
  });

  it('o marcador é o mesmo do smoke permanente do Modo Dev', () => {
    expect(CLI_READY_MARKER).toBe('claude code');
  });
});

describe('isReadyToPreType — primeiro passo', () => {
  it('banner desenhado libera a escrita mesmo sem nenhum evento de semáforo (sessão nova nunca chega a waiting)', () => {
    expect(isReadyToPreType({ isFirstStep: true, semaphore: undefined, armedAt: 0, renderedLines: BANNER })).toBe(true);
  });

  it('semáforo em waiting libera mesmo com o banner já fora do viewport (sessão antiga em foco)', () => {
    expect(
      isReadyToPreType({ isFirstStep: true, semaphore: { state: 'waiting', stateEnteredAt: 10 }, armedAt: 999, renderedLines: [] }),
    ).toBe(true);
  });

  it('sem banner e sem waiting, não escreve nada (CLI ainda subindo)', () => {
    expect(
      isReadyToPreType({ isFirstStep: true, semaphore: { state: 'working', stateEnteredAt: 1 }, armedAt: 0, renderedLines: ['...'] }),
    ).toBe(false);
  });

  it('diálogo de confiança de pasta na tela BLOQUEIA — pré-digitar cairia dentro da pergunta', () => {
    expect(isReadyToPreType({ isFirstStep: true, semaphore: { state: 'waiting', stateEnteredAt: 10 }, armedAt: 0, renderedLines: TRUST })).toBe(
      false,
    );
  });
});

describe('isReadyToPreType — segundo passo do CA-16 (dois Enters distintos)', () => {
  it('waiting ANTIGO (de antes do 1º comando ser escrito) não libera o 2º', () => {
    expect(
      isReadyToPreType({ isFirstStep: false, semaphore: { state: 'waiting', stateEnteredAt: 100 }, armedAt: 200, renderedLines: BANNER }),
    ).toBe(false);
  });

  it('waiting NOVO (turno do /esteira-liberar terminou) libera o 2º', () => {
    expect(
      isReadyToPreType({ isFirstStep: false, semaphore: { state: 'waiting', stateEnteredAt: 300 }, armedAt: 200, renderedLines: BANNER }),
    ).toBe(true);
  });

  it('banner sozinho NUNCA libera o 2º comando — senão os dois sairiam juntos', () => {
    expect(isReadyToPreType({ isFirstStep: false, semaphore: undefined, armedAt: 200, renderedLines: BANNER })).toBe(false);
  });

  it('sessão trabalhando (comando ainda rodando) não libera o 2º', () => {
    expect(
      isReadyToPreType({ isFirstStep: false, semaphore: { state: 'working', stateEnteredAt: 300 }, armedAt: 200, renderedLines: BANNER }),
    ).toBe(false);
  });
});
