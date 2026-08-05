import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { subscribeChannel } from '../src/preload/subscribeChannel';

// G5 (batch N5) — guarda contra segundo assinante silencioso de canal IPC.
//
// Achado real: `App.tsx` abria a SUA PRÓPRIA assinatura de
// `window.donel.accounts.list()`/`onChanged` além da que `AccountsPanel` já
// mantinha — dois round-trips de IPC no boot, ~80ms a mais, e nada denunciou
// isso além da cerca de performance do CA-7. `ipcRenderer` é um EventEmitter
// de verdade (mesma API), então `EventEmitter` do Node é um substituto fiel
// para testar sem Electron — nenhum mock de `ipcRenderer` é necessário.

describe('subscribeChannel — assinatura única por canal', () => {
  it('primeiro assinante: não avisa nada', () => {
    const emitter = new EventEmitter();
    const warn = vi.fn();
    subscribeChannel(emitter, 'esteira:changed', () => undefined, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('segundo assinante do MESMO canal: avisa, com o nome do canal na mensagem', () => {
    const emitter = new EventEmitter();
    const warn = vi.fn();
    subscribeChannel(emitter, 'accounts:changed', () => undefined, warn);
    subscribeChannel(emitter, 'accounts:changed', () => undefined, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('accounts:changed');
  });

  it('assinantes de canais DIFERENTES nunca disparam o aviso um do outro', () => {
    const emitter = new EventEmitter();
    const warn = vi.fn();
    subscribeChannel(emitter, 'esteira:changed', () => undefined, warn);
    subscribeChannel(emitter, 'accounts:changed', () => undefined, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a função devolvida remove SÓ o próprio handler — o canal aceita um novo assinante depois', () => {
    const emitter = new EventEmitter();
    const warn = vi.fn();
    const unsubscribe = subscribeChannel(emitter, 'esteira:changed', () => undefined, warn);
    expect(emitter.listenerCount('esteira:changed')).toBe(1);
    unsubscribe();
    expect(emitter.listenerCount('esteira:changed')).toBe(0);

    // Depois de liberar o canal, um novo assinante É o primeiro de novo — não
    // deveria ver o fantasma do que já foi removido.
    subscribeChannel(emitter, 'esteira:changed', () => undefined, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('o handler passado continua sendo o que recebe os eventos — o wrapper não engole nada', () => {
    const emitter = new EventEmitter();
    const received: unknown[] = [];
    subscribeChannel(emitter, 'pty:data', (payload: unknown) => received.push(payload));
    emitter.emit('pty:data', { chunk: 'olá' });
    expect(received).toEqual([{ chunk: 'olá' }]);
  });

  it('sem `warn` explícito, o default não lança — é seguro chamar em produção', () => {
    const emitter = new EventEmitter();
    subscribeChannel(emitter, 'esteira:changed', () => undefined);
    expect(() => subscribeChannel(emitter, 'esteira:changed', () => undefined)).not.toThrow();
  });
});
