import { stripAnsi } from './ansi';

// Ring buffer puro do preview de PTY (plan.md ponto 8). Extraído do
// PtyManager para ser testável sem precisar spawnar um processo real: junta
// o `rawTail` (cauda ainda sem quebra de linha, ANSI cru) com o chunk novo,
// fecha as linhas completas (aplicando `stripAnsi` só nelas — uma sequência
// ANSI partida entre dois chunks nunca é stripada pela metade, porque ela
// permanece crua em `rawTail` até a linha fechar), e capa o buffer em
// `maxLines`, descartando as mais antigas primeiro.

export interface RingBufferState {
  ringBuffer: string[];
  rawTail: string;
}

export function appendToRingBuffer(state: RingBufferState, chunk: string, maxLines: number): RingBufferState {
  const combined = state.rawTail + chunk;
  const lines = combined.split(/\r?\n/);
  const rawTail = lines.pop() ?? '';

  if (lines.length === 0) {
    return { ringBuffer: state.ringBuffer, rawTail };
  }

  const ringBuffer = [...state.ringBuffer, ...lines.map(stripAnsi)];
  if (ringBuffer.length > maxLines) {
    ringBuffer.splice(0, ringBuffer.length - maxLines);
  }
  return { ringBuffer, rawTail };
}
