import { describe, expect, it, vi } from 'vitest';
import { shutdownThenQuit } from '../src/main/app-shutdown';

// 10/11 — a janela do Donel sumiu e o processo principal ficou vivo por horas, sem janela: o `window-all-closed`
// fazia uma dúzia de `dispose()` antes do `app.quit()`, e bastava um lançar para o app nunca sair.
// Guarda: o fechamento sempre chega ao quit e não pula as etapas seguintes.

describe('fechamento do app', () => {
  it('uma etapa que lança não impede as seguintes nem o quit', () => {
    const ran: string[] = [];
    const quit = vi.fn();
    const failures: string[] = [];
    shutdownThenQuit(
      [
        ['ptys', () => ran.push('ptys')],
        ['chatHub', () => {
          throw new Error('dispose quebrou');
        }],
        ['accountEngine', () => ran.push('accountEngine')],
      ],
      { quit, onError: (name) => failures.push(name) },
    );
    expect(ran).toEqual(['ptys', 'accountEngine']);
    expect(failures).toEqual(['chatHub']);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('nem uma promessa rejeitada nem um registro de erro que lança seguram o quit', async () => {
    const quit = vi.fn();
    const onError = vi.fn((_name: string, _error: unknown) => {
      throw new Error('disco cheio');
    });
    shutdownThenQuit(
      [
        ['hookBridge', () => Promise.reject(new Error('fechou torto'))],
        ['semaphore', () => {
          throw new Error('x');
        }],
      ],
      { quit, onError },
    );
    expect(quit).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError.mock.calls.map(([name]) => name)).toEqual(['semaphore', 'hookBridge']);
  });
});
