import { describe, expect, it } from 'vitest';
import { PtyManager } from '../src/main/pty-manager';

// T005 — caso (c) do dossiê de verificação: um processo que sai rápido deve
// disparar `onExit` (é o mesmo sinal que o TerminalPane usa pra mostrar o
// estado "sessão encerrada", FR-006). Usa `cmd.exe /c exit` como dummy —
// não precisa abrir uma sessão claude real pra validar o mecanismo de saída
// do PtyManager, que é agnóstico ao comando spawnado.

describe('PtyManager — ciclo de vida de um processo que sai sozinho', () => {
  it('dispara onExit quando o processo dummy termina (cmd.exe /c exit)', async () => {
    const manager = new PtyManager();

    const exitPromise = new Promise<{ ptyId: string; exitCode: number }>((resolve) => {
      manager.onExit((ptyId, exitCode) => resolve({ ptyId, exitCode }));
    });

    const ptyId = manager.create({ cols: 80, rows: 24, command: 'cmd.exe', args: ['/c', 'exit'] });

    const result = await exitPromise;

    expect(result.ptyId).toBe(ptyId);
    expect(result.exitCode).toBe(0);
  });

  it('spawna o comando/args default (terminal livre) quando command/args são omitidos', () => {
    const manager = new PtyManager();

    // Só garante que o comportamento original do T004 (sem command/args)
    // continua criando um id válido e não lança — não abrimos powershell de
    // verdade em CI além do necessário; o smoke playwright já cobre isso.
    const ptyId = manager.create({ cols: 80, rows: 24 });

    expect(typeof ptyId).toBe('string');
    manager.kill(ptyId);
  });
});
