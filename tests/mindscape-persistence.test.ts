import { describe, expect, it } from 'vitest';
import { emptyMindscapeDoc, placeSessionCard } from '../src/shared/mindscape/model';
import { decideAfterSave, MINDSCAPE_SAVE_RETRY_DELAYS_MS, mindscapeAlert, shouldFlushOnClose } from '../src/shared/mindscape/persistence';

// Mindscape — what the renderer does with a failed load or save, so that
// neither one loses the board (handoffs/mindscape-revisao.md, items 2 and 3).

describe('decideAfterSave', () => {
  it('a save that went through ends the retries', () => {
    expect(decideAfterSave({ ok: true }, 0)).toEqual({ status: 'saved', retryInMs: null });
    expect(decideAfterSave({ ok: true }, 2)).toEqual({ status: 'saved', retryInMs: null });
  });

  it('a failed write (or a rejected IPC) is retried with a growing, bounded wait', () => {
    const delays = MINDSCAPE_SAVE_RETRY_DELAYS_MS;
    expect(delays.length).toBeGreaterThan(0);
    delays.forEach((delay, retriesDone) => {
      expect(decideAfterSave({ ok: false, reason: 'write-failed' }, retriesDone)).toEqual({ status: 'retrying', retryInMs: delay });
      expect(decideAfterSave(null, retriesDone)).toEqual({ status: 'retrying', retryInMs: delay });
      if (retriesDone > 0) expect(delay).toBeGreaterThan(delays[retriesDone - 1]!);
    });
  });

  it('after the last retry it gives up and the failure is shown', () => {
    const retriesDone = MINDSCAPE_SAVE_RETRY_DELAYS_MS.length;
    expect(decideAfterSave({ ok: false, reason: 'write-failed' }, retriesDone)).toEqual({ status: 'failed', retryInMs: null });
    expect(decideAfterSave(null, retriesDone + 3)).toEqual({ status: 'failed', retryInMs: null });
  });

  it('a newer schema on disk is not retried (it will not stop being newer)', () => {
    expect(decideAfterSave({ ok: false, reason: 'read-only' }, 0)).toEqual({ status: 'read-only', retryInMs: null });
  });
});

describe('mindscapeAlert', () => {
  it('nothing to say while loading, or loaded and saved or still retrying', () => {
    expect(mindscapeAlert('loading', 'saved')).toBeNull();
    expect(mindscapeAlert('ready', 'saved')).toBeNull();
    expect(mindscapeAlert('ready', 'retrying')).toBeNull();
  });

  it('a failed load says nothing will be written, and offers to read again', () => {
    expect(mindscapeAlert('failed', 'saved')).toEqual({ kind: 'load-failed', text: 'Não consegui abrir o quadro — nada será gravado até reabrir.', retry: true });
    // The load wins: nothing was written anyway.
    expect(mindscapeAlert('failed', 'failed')?.kind).toBe('load-failed');
  });

  it('a save that gave up warns and offers to try again; a newer schema only warns', () => {
    expect(mindscapeAlert('ready', 'failed')).toEqual({ kind: 'save-failed', text: 'Não consegui gravar o quadro — as mudanças seguem só na memória.', retry: true });
    expect(mindscapeAlert('ready', 'read-only')).toEqual({
      kind: 'read-only',
      text: 'Este quadro foi gravado por uma versão mais nova do Donel Dev — nada daqui será gravado.',
      retry: false,
    });
  });
});

describe('shouldFlushOnClose', () => {
  const saved = emptyMindscapeDoc();
  const changed = placeSessionCard(saved, 'C:/work/atlas', 's1');

  it('flushes a loaded board whose last version was not saved yet', () => {
    expect(shouldFlushOnClose('ready', changed, saved)).toBe(true);
  });

  it('does not write what is already saved', () => {
    expect(shouldFlushOnClose('ready', saved, saved)).toBe(false);
  });

  it('never writes a board that did not load (it would overwrite the file)', () => {
    expect(shouldFlushOnClose('failed', changed, saved)).toBe(false);
    expect(shouldFlushOnClose('loading', changed, saved)).toBe(false);
  });
});
