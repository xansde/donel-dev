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

  it('spawna o comando/args default (terminal livre, PowerShell) quando command/args são omitidos', async () => {
    // Ciclo de correção 1 (auditoria batch 2) — antes só afirmava que o id
    // era string e que não lançava (smoke fraco). Agora exercita o caminho
    // default de verdade (sem passar command/args) e afirma um sinal
    // observável: o eco de um marcador único chega pelo onData, provando que
    // o PowerShell default foi spawnado e está processando input real.
    const manager = new PtyManager();
    const marker = 'donel-default-shell-probe';

    const dataPromise = new Promise<string>((resolve) => {
      let collected = '';
      manager.onData((_ptyId, data) => {
        collected += data;
        if (collected.includes(marker)) resolve(collected);
      });
    });

    const ptyId = manager.create({ cols: 80, rows: 24 });
    manager.input(ptyId, `echo ${marker}\r`);

    const collected = await dataPromise;
    expect(collected).toContain(marker);

    manager.kill(ptyId);
  });
});
