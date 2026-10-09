import { describe, expect, it } from 'vitest';
import { openStopWindow, STOP_WINDOW_MS, stepStopWindow } from '../src/renderer/src/chat/stopWindow';
import { planReturned } from '../src/renderer/src/chat/composer/returnedReclaim';
import { deriveFooter, isExpiredStop, STOP_TIMEOUT_MS } from '../src/renderer/src/chat/workingFooterModel';
import type { SendItemView } from '../src/renderer/src/chat/sendDriver';
import type { ConversationRow, LiveState, UserRow } from '../src/shared/chat/rows';

// 014-chat alfa-4 - fim de rodada pela tela, restrito à janela de um Parar/Esc.

const T = 1_000_000;
const working = { working: true, ready: false, boxText: '' as string | null };
const idle = (boxText: string | null = '') => ({ working: false, ready: true, boxText });

describe('stepStopWindow', () => {
  it('sem janela: nada muda, mesmo com a tela parada', () => {
    expect(stepStopWindow(null, idle('x'), T)).toEqual({ window: null, box: null });
  });

  it('tela ainda trabalhando logo após o pedido: segue aguardando', () => {
    const w = openStopWindow(T);
    expect(stepStopWindow(w, working, T + 100)).toEqual({ window: w, box: null });
  });

  it('trabalho sumiu e a caixa voltou vazia: confirma o fim, sem candidato', () => {
    const step = stepStopWindow(openStopWindow(T), idle(''), T + 500);
    expect(step.window?.confirmed).toBe(true);
    expect(step.box).toBeNull();
  });

  it('caixa com texto: devolve o candidato uma única vez', () => {
    const first = stepStopWindow(openStopWindow(T), idle('teste'), T + 500);
    expect(first.box).toBe('teste');
    const second = stepStopWindow(first.window, idle('teste'), T + 600);
    expect(second.box).toBeNull();
    expect(second.window?.confirmed).toBe(true);
  });

  it('diálogo na tela (caixa não pronta): não confirma', () => {
    const step = stepStopWindow(openStopWindow(T), { working: false, ready: false, boxText: null }, T + 500);
    expect(step.window?.confirmed).toBe(false);
  });

  it('trabalhando de novo depois de confirmado: nova rodada, janela encerrada', () => {
    const confirmed = stepStopWindow(openStopWindow(T), idle(''), T + 500).window;
    expect(stepStopWindow(confirmed, working, T + 900).window).toBeNull();
  });

  it('janela vencida sem confirmação: some', () => {
    expect(stepStopWindow(openStopWindow(T), idle(''), T + STOP_WINDOW_MS + 1).window).toBeNull();
    expect(stepStopWindow(openStopWindow(T), working, T + STOP_WINDOW_MS + 1).window).toBeNull();
  });
});

describe('isExpiredStop', () => {
  it('pedido que não escreveu nada já nasce vencido; o que escreveu não', () => {
    expect(isExpiredStop(T - STOP_TIMEOUT_MS, T)).toBe(true);
    expect(isExpiredStop(T, T)).toBe(false);
  });
});

describe('deriveFooter com fim por tela', () => {
  const live = { status: 'working', currentAction: null, activeSubagents: [], pendings: [] } as unknown as LiveState;
  it('sai de "trabalhando" quando a tela encerrou a rodada', () => {
    expect(deriveFooter({ live, rows: [], lastAction: null, screenWorking: false })?.kind).toBe('working');
    expect(deriveFooter({ live, rows: [], lastAction: null, screenWorking: false, endedByScreen: true })).toBeNull();
  });
});

describe('planReturned', () => {
  const user: UserRow = { kind: 'user', id: 'u1', turnId: 'u1', at: '2026-10-09T12:00:00.000Z', scope: 'main', text: 'teste grande', attachments: [] };
  const item = { id: 's1', text: 'teste grande', images: [], kind: 'prompt', mode: 'normal', state: 'accepted', label: 'entrou', leftover: null, createdAt: 0 } as SendItemView;
  it('casa com o último cartão sem saída e acha o envio', () => {
    expect(planReturned('teste grande', [user], [item])).toEqual({ text: 'teste grande', sourceId: 's1' });
  });
  it('com resposta depois do cartão, não', () => {
    const answer = { kind: 'assistant', id: 'a1', turnId: 'u1', at: user.at, scope: 'main', markdown: 'oi' } as unknown as ConversationRow;
    expect(planReturned('teste grande', [user, answer], [item])).toBeNull();
  });
});
