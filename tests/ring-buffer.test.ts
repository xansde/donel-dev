import { describe, expect, it } from 'vitest';
import { appendToRingBuffer, type RingBufferState } from '../src/main/ring-buffer';

// Ciclo de correção 1 (auditoria batch 2) — appendToRingBuffer é o helper
// puro extraído do PtyManager (ponto 8) pra poder testar carry-over de linha
// sem newline e o cap de tamanho sem precisar spawnar um PTY de verdade.

const EMPTY: RingBufferState = { ringBuffer: [], rawTail: '' };

describe('appendToRingBuffer', () => {
  it('buffers a chunk with no line break as rawTail, without touching ringBuffer', () => {
    const result = appendToRingBuffer(EMPTY, 'partial line without break', 50);

    expect(result.ringBuffer).toEqual([]);
    expect(result.rawTail).toBe('partial line without break');
  });

  it('flushes a completed line into ringBuffer and keeps the remainder as rawTail', () => {
    const result = appendToRingBuffer(EMPTY, 'line one\nline two without break', 50);

    expect(result.ringBuffer).toEqual(['line one']);
    expect(result.rawTail).toBe('line two without break');
  });

  it('strips ANSI from a line whose escape sequence is split across two chunks', () => {
    // Chunk 1 termina no meio de um CSI de cor — sem newline, então nada é
    // stripado/flushado ainda: a sequência incompleta fica crua em rawTail.
    const afterFirstChunk = appendToRingBuffer(EMPTY, 'hello \x1B[31', 50);
    expect(afterFirstChunk.ringBuffer).toEqual([]);
    expect(afterFirstChunk.rawTail).toBe('hello \x1B[31');

    // Chunk 2 completa a sequência e fecha a linha — só aí o stripAnsi roda
    // sobre a linha inteira já remontada.
    const afterSecondChunk = appendToRingBuffer(afterFirstChunk, 'mworld\n', 50);

    expect(afterSecondChunk.ringBuffer).toEqual(['hello world']);
    expect(afterSecondChunk.rawTail).toBe('');
  });

  it('caps the ring buffer at maxLines, dropping the oldest lines first', () => {
    const manyLines = `${Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')}\n`;

    const result = appendToRingBuffer(EMPTY, manyLines, 50);

    expect(result.ringBuffer).toHaveLength(50);
    expect(result.ringBuffer[0]).toBe('line 10');
    expect(result.ringBuffer[49]).toBe('line 59');
  });

  it('treats \\r\\n line endings the same as \\n', () => {
    const result = appendToRingBuffer(EMPTY, 'line one\r\nline two\r\n', 50);

    expect(result.ringBuffer).toEqual(['line one', 'line two']);
    expect(result.rawTail).toBe('');
  });
});
