import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createBoardBridge } from '../src/main/board-bridge';
import { MINDSCAPE_CHANNELS } from '../src/shared/mindscape/channels';

// 09/11 (t-81ff5a82) — sessao_enviar voltava "O app não respondeu a tempo" com a mensagem entregue: em 48 h nesta VPS,
// 88 envios assim. O app do PC espera até 40 s a mensagem entrar e responde; essa resposta chegou com mediana de 45 s e
// p90 de 65 s (PC e túnel carregados), e o main desistia aos 50 s. Quem enviou ficava sem saber e mandava de novo.

afterEach(() => vi.useRealTimers());

function bridgeWithSlowRenderer(answerAfterMs: number, text: string) {
  const ipcMain = new EventEmitter();
  const sender = {};
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, request: { requestId: string }) => {
        if (channel !== MINDSCAPE_CHANNELS.boardRequest) return;
        setTimeout(() => ipcMain.emit(MINDSCAPE_CHANNELS.boardRespond, { sender }, { requestId: request.requestId, ok: true, text }), answerAfterMs);
      },
    },
  };
  return createBoardBridge({
    ipcMain: ipcMain as never,
    getWindow: () => window as never,
    isMainSender: (candidate) => candidate === sender,
  });
}

it('a resposta do app que chega 70 s depois (40 s esperando a entrega + atraso do PC) vai a quem enviou, não "não respondeu a tempo"', async () => {
  vi.useFakeTimers();
  const bridge = bridgeWithSlowRenderer(70_000, 'Entregue: entrou no Claude de lá.');
  const outcome = bridge.execute('pty-1', { tool: 'sessao_enviar', para: 'place:dev', texto: 'roda o verify' });
  await vi.advanceTimersByTimeAsync(70_000);
  expect(await outcome).toEqual({ kind: 'text', text: 'Entregue: entrou no Claude de lá.' });
});

it('sem resposta nenhuma (renderer travado de verdade), o envio ainda termina com o aviso de conferir antes de repetir', async () => {
  vi.useFakeTimers();
  const bridge = bridgeWithSlowRenderer(60 * 60_000, 'nunca');
  const outcome = bridge.execute('pty-1', { tool: 'sessao_enviar', para: 'place:dev', texto: 'roda o verify' });
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  const result = await outcome;
  expect(result.kind).toBe('error');
  expect(result.text).toMatch(/pode ter entrado/);
});
