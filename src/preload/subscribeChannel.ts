// G5 (batch N5, 010 — mapa/forma/leitura) — guarda contra segundo assinante
// silencioso de canal IPC.
//
// Achado real (011-contas-e-provedores, etapa 2, T1232): `App.tsx` abria a
// SUA PRÓPRIA assinatura de `window.donel.accounts.list()`/`onChanged` além
// da que `AccountsPanel` já mantinha — dois round-trips de IPC a cada boot,
// ~80ms a mais (250ms → ~330ms), e nada denunciou isso além de uma cerca de
// performance apertar por coincidência. Cada canal `onX` deste preload existe
// para ter UM assinante — o padrão certo é o de cima subir o dado via prop
// (`onViewChange`), nunca abrir uma segunda escuta do mesmo canal.
//
// `ipcRenderer` É um EventEmitter do Node por baixo (mesma API pública), então
// este helper pede só o que precisa dela (`on`/`removeListener`/
// `listenerCount`) — testável com `EventEmitter` puro, sem mock de Electron.

// `any[]` aqui é o mesmo molde do `EventEmitter`/`IpcRenderer` reais do Node —
// `on`/`removeListener` não sabem, em geral, quantos argumentos o evento
// carrega. `subscribeChannel` abaixo é genérico sobre a assinatura REAL do
// handler (`A`); este `any[]` fica só na borda do adaptador.
export interface ChannelEmitter {
  listenerCount(channel: string): number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(channel: string, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener(channel: string, listener: (...args: any[]) => void): unknown;
}

/**
 * Assina `channel` em `emitter` e devolve a função de cancelamento — mesma
 * forma que todo canal `onX` deste preload já devolve. A ÚNICA diferença do
 * `ipcRenderer.on` direto: se o canal JÁ tinha alguém escutando, avisa antes
 * de somar mais um. Não IMPEDE o segundo assinante (pode haver caso legítimo
 * que este batch não previu) — só recusa deixá-lo acontecer em silêncio.
 */
export function subscribeChannel<A extends unknown[]>(
  emitter: ChannelEmitter,
  channel: string,
  handler: (...args: A) => void,
  warn: (message: string) => void = (message) => console.warn(message),
): () => void {
  const jaTinhaAssinante = emitter.listenerCount(channel) > 0;
  if (jaTinhaAssinante) {
    warn(
      `[donel] canal "${channel}" ganhou um segundo assinante. Cada canal onX deste preload espera UM assinante só — ` +
        `dois custam o trabalho em dobro a cada evento, em silêncio (achado real: App.tsx + AccountsPanel duplicando "accounts:changed", ~80ms a mais no boot). ` +
        `Se os dois lados precisam do dado, suba-o por prop a partir de quem já assina, em vez de assinar de novo.`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitter.on(channel, handler as (...args: any[]) => void);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => emitter.removeListener(channel, handler as (...args: any[]) => void);
}
