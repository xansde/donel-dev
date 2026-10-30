// The one rule of "avisar" (notificacoes-completas, 30/10): when a session's signal is news for the owner,
// what kind of news, which channel says it (the Jobu's bubble or the Windows toast), what the toast says,
// when the taskbar flashes and what the taskbar badge shows. Pure, so every case is a table here.
import { describe, expect, it } from 'vitest';
import {
  failureReasonText,
  newWaitNotice,
  noticeToast,
  overlayDescription,
  shouldFlash,
  shouldToast,
  toAttentionSignal,
} from '../src/shared/attention/rule';
import type { BubbleEvent } from '../src/shared/pet/types';

function event(kind: BubbleEvent['kind'], extra: Partial<BubbleEvent> = {}): BubbleEvent {
  return { kind, ptyId: 'pty-1', name: 'atlas', blockedKind: null, at: 0, ...extra };
}

describe('toAttentionSignal: what the semaphore published, read as the owner needs it', () => {
  it('no update yet is idle, error is done, the rest passes through', () => {
    expect(toAttentionSignal(undefined)).toBe('idle');
    expect(toAttentionSignal('error')).toBe('done');
    expect(toAttentionSignal('done')).toBe('done');
    expect(toAttentionSignal('working')).toBe('working');
    expect(toAttentionSignal('waiting')).toBe('waiting');
    expect(toAttentionSignal('permission')).toBe('permission');
  });

  it('#109: a waiting with background sub-agents alive is still working (the session will be woken)', () => {
    expect(toAttentionSignal('waiting', true)).toBe('working');
    // the mark only means something on `waiting`
    expect(toAttentionSignal('permission', true)).toBe('permission');
  });

  it('a turn that failed is a real wait even with sub-agents alive: the owner has to act', () => {
    expect(toAttentionSignal('waiting', true, true)).toBe('waiting');
    expect(toAttentionSignal('waiting', false, true)).toBe('waiting');
  });
});

describe('newWaitNotice: a wait was just born — is it news, and of what kind?', () => {
  it('a known session that the owner is not looking at: finished, blocked or failed', () => {
    expect(newWaitNotice({ known: true, semaphore: 'waiting', seenNow: false, failure: null })).toBe('finished');
    expect(newWaitNotice({ known: true, semaphore: 'permission', seenNow: false, failure: null })).toBe('blocked');
    expect(newWaitNotice({ known: true, semaphore: 'waiting', seenNow: false, failure: 'limite de uso' })).toBe('failed');
  });

  it('a pending wins over a failure: the session is asking for something', () => {
    expect(newWaitNotice({ known: true, semaphore: 'permission', seenNow: false, failure: 'limite de uso' })).toBe('blocked');
  });

  it('never for the session the owner is looking at (its tab in front, the Donel focused)', () => {
    expect(newWaitNotice({ known: true, semaphore: 'waiting', seenNow: true, failure: null })).toBeNull();
    expect(newWaitNotice({ known: true, semaphore: 'permission', seenNow: true, failure: null })).toBeNull();
    expect(newWaitNotice({ known: true, semaphore: 'waiting', seenNow: true, failure: 'limite de uso' })).toBeNull();
  });

  it('never for a session met for the first time: nobody saw it change', () => {
    expect(newWaitNotice({ known: false, semaphore: 'waiting', seenNow: false, failure: null })).toBeNull();
  });
});

describe('shouldToast: the Windows notification is the channel only when the Jobu is not on screen', () => {
  const base = { petEnabled: false, preference: 'all' as const, chatCoversPending: false };

  it('with the Jobu on, his bubble says it and the toast stays quiet, whatever the kind', () => {
    for (const kind of ['finished', 'blocked', 'failed', 'ended'] as const) {
      expect(shouldToast({ ...base, petEnabled: true, kind })).toBe(false);
    }
  });

  it('"Nenhuma" turns every toast off', () => {
    for (const kind of ['finished', 'blocked', 'failed', 'ended'] as const) {
      expect(shouldToast({ ...base, preference: 'none', kind })).toBe(false);
    }
  });

  it('"Todas" says everything: finished, blocked, failed and ended', () => {
    for (const kind of ['finished', 'blocked', 'failed', 'ended'] as const) expect(shouldToast({ ...base, kind })).toBe(true);
  });

  it('the default ("Só permissão pendente") says what needs the owner: a pending and a failure', () => {
    const preference = 'permission-only' as const;
    expect(shouldToast({ ...base, preference, kind: 'blocked' })).toBe(true);
    expect(shouldToast({ ...base, preference, kind: 'failed' })).toBe(true);
    expect(shouldToast({ ...base, preference, kind: 'finished' })).toBe(false);
    expect(shouldToast({ ...base, preference, kind: 'ended' })).toBe(false);
  });

  it('with the chat on, a pending is toasted by the chat (it knows what the pending is): never twice', () => {
    expect(shouldToast({ ...base, chatCoversPending: true, kind: 'blocked' })).toBe(false);
    expect(shouldToast({ ...base, chatCoversPending: true, kind: 'finished' })).toBe(true);
    expect(shouldToast({ ...base, chatCoversPending: true, kind: 'failed' })).toBe(true);
  });
});

describe('noticeToast: short pt-BR, the name of the session first', () => {
  it('says who finished, who needs you and who stopped with an error (and why)', () => {
    expect(noticeToast(event('finished')).title).toBe('atlas terminou');
    expect(noticeToast(event('blocked')).title).toBe('atlas precisa de você');
    expect(noticeToast(event('failed', { reason: 'limite de uso' })).title).toBe('atlas parou com erro: limite de uso');
    expect(noticeToast(event('failed')).title).toBe('atlas parou com erro');
    expect(noticeToast(event('ended')).title).toBe('atlas encerrou');
  });

  it('a pending of known kind says what it is in the body', () => {
    expect(noticeToast(event('blocked', { blockedKind: 'question' })).body).toBe('Tem uma pergunta para você.');
    expect(noticeToast(event('blocked', { blockedKind: 'plan' })).body).toBe('Tem um plano para aprovar.');
    expect(noticeToast(event('blocked')).body).toBe('Quer permissão para continuar.');
  });

  it('cuts a very long name like the bubble does', () => {
    const name = 'uma sessão com um nome comprido demais para caber';
    expect(noticeToast(event('finished', { name })).title).toBe(`${[...name].slice(0, 28).join('')}… terminou`);
  });
});

describe('failureReasonText: the `error` of the StopFailure hook in a few words', () => {
  it('maps the codes the CLI sends', () => {
    expect(failureReasonText('rate_limit')).toBe('limite de uso');
    expect(failureReasonText('billing_error')).toBe('problema de cobrança');
    expect(failureReasonText('authentication_failed')).toBe('login expirado');
    expect(failureReasonText('overloaded')).toBe('API sobrecarregada');
    expect(failureReasonText('server_error')).toBe('erro da API');
    expect(failureReasonText('max_output_tokens')).toBe('resposta longa demais');
  });

  it('an unknown or missing code is still an API error', () => {
    expect(failureReasonText('unknown')).toBe('erro da API');
    expect(failureReasonText('algo-novo')).toBe('erro da API');
    expect(failureReasonText(undefined)).toBe('erro da API');
    expect(failureReasonText(42)).toBe('erro da API');
  });
});

describe('shouldFlash: the taskbar button blinks when news arrives and the Donel is not in front', () => {
  it('blinks only with news, out of focus, and not with "Nenhuma"', () => {
    expect(shouldFlash({ preference: 'permission-only', windowInFront: false, notices: 1 })).toBe(true);
    expect(shouldFlash({ preference: 'all', windowInFront: true, notices: 1 })).toBe(false);
    expect(shouldFlash({ preference: 'all', windowInFront: false, notices: 0 })).toBe(false);
    expect(shouldFlash({ preference: 'none', windowInFront: false, notices: 2 })).toBe(false);
  });
});

describe('overlayDescription: what a screen reader says of the taskbar badge', () => {
  it('nothing at zero, singular and plural', () => {
    expect(overlayDescription(0)).toBe('');
    expect(overlayDescription(1)).toBe('1 sessão esperando você');
    expect(overlayDescription(3)).toBe('3 sessões esperando você');
  });
});
