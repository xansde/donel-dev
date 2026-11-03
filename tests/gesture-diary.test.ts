import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGestureDiary } from '../src/main/gesture-diary';
import { GESTURE_TEXT_MAX_CHARS, gestureFileName, gestureLine, parseRendererGesture } from '../src/shared/learning/gestures';

describe('parseRendererGesture', () => {
  it('accepts a session opened from the tab, the Mindscape or a resume', () => {
    for (const via of ['aba', 'mindscape', 'retomar'] as const) {
      expect(parseRendererGesture({ type: 'sessao-aberta', sessionId: 's1', via })).toEqual({ type: 'sessao-aberta', sessionId: 's1', via });
    }
  });

  it('accepts the Mindscape actions with the optional card', () => {
    expect(parseRendererGesture({ type: 'mindscape', acao: 'organizar', projectPath: 'C:\\p' })).toEqual({ type: 'mindscape', acao: 'organizar', projectPath: 'C:\\p' });
    expect(parseRendererGesture({ type: 'mindscape', acao: 'arquivar', projectPath: 'C:\\p', cardKind: 'session-note', sessionId: 's1' })).toEqual({
      type: 'mindscape',
      acao: 'arquivar',
      projectPath: 'C:\\p',
      cardKind: 'session-note',
      sessionId: 's1',
    });
  });

  it('refuses what the renderer may not say, and anything malformed', () => {
    expect(parseRendererGesture({ type: 'turno-terminou', sessionId: 's', text: 'x' })).toBeNull();
    expect(parseRendererGesture({ type: 'sessao-aberta', sessionId: '', via: 'aba' })).toBeNull();
    expect(parseRendererGesture({ type: 'sessao-aberta', sessionId: 's', via: 'outra' })).toBeNull();
    expect(parseRendererGesture({ type: 'mindscape', acao: 'apagar', projectPath: 'p' })).toBeNull();
    expect(parseRendererGesture({ type: 'mindscape', acao: 'arquivar', projectPath: 'p', cardKind: 'session' })).toBeNull();
    expect(parseRendererGesture({ type: 'mindscape', acao: 'arquivar', projectPath: 'p', sessionId: 7 })).toBeNull();
    expect(parseRendererGesture(null)).toBeNull();
    expect(parseRendererGesture('x')).toBeNull();
  });

  it('drops fields it does not know', () => {
    expect(parseRendererGesture({ type: 'sessao-aberta', sessionId: 's', via: 'aba', segredo: 'x' })).toEqual({ type: 'sessao-aberta', sessionId: 's', via: 'aba' });
  });
});

describe('gestureFileName and gestureLine', () => {
  it('one file per local month', () => {
    expect(gestureFileName(new Date(2026, 9, 31, 23, 59).getTime())).toBe('gestos-2026-10.jsonl');
    expect(gestureFileName(new Date(2026, 10, 1, 0, 1).getTime())).toBe('gestos-2026-11.jsonl');
  });

  it('a JSON line, with the text of a turn cut at the cap', () => {
    const line = gestureLine({ type: 'turno-terminou', sessionId: 's', text: 'a'.repeat(GESTURE_TEXT_MAX_CHARS + 50), at: 1 });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line).text).toHaveLength(GESTURE_TEXT_MAX_CHARS);
  });
});

describe('createGestureDiary', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('appends one line per event, in order, creating the folder', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'gestos-'));
    const target = path.join(dir, 'aprendizado');
    const diary = createGestureDiary({ dir: target });
    const at = new Date(2026, 9, 31, 10, 0).getTime();
    void diary.record({ type: 'turno-terminou', sessionId: 's1', text: 'Antes de gravar, preciso do seu sim', at });
    void diary.record({ type: 'pedido-enviado', sessionId: 's1', promptLength: 3, at: at + 1 });
    await diary.record({ type: 'sessao-aberta', sessionId: 's1', via: 'mindscape', at: at + 2 });
    const lines = readFileSync(path.join(target, 'gestos-2026-10.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(['turno-terminou', 'pedido-enviado', 'sessao-aberta']);
    expect(lines[1]).toEqual({ type: 'pedido-enviado', sessionId: 's1', promptLength: 3, at: at + 1 });
  });

  it('a failed write is logged, never thrown, and the next one still goes', async () => {
    const logged: string[] = [];
    const written: string[] = [];
    let fail = true;
    const diary = createGestureDiary({
      dir: 'X:\\nao-existe',
      mkdir: async () => undefined,
      appendFile: async (_path, data) => {
        if (fail) {
          fail = false;
          throw new Error('disco cheio');
        }
        written.push(data);
      },
      log: (line) => logged.push(line),
    });
    await expect(diary.record({ type: 'sessao-aberta', sessionId: 's', via: 'aba', at: 1 })).resolves.toBeUndefined();
    await diary.record({ type: 'sessao-aberta', sessionId: 's', via: 'aba', at: 2 });
    expect(logged[0]).toContain('disco cheio');
    expect(written).toHaveLength(1);
  });
});
