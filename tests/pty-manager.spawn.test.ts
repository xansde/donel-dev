import { describe, expect, it } from 'vitest';
import { PtyManager } from '../src/main/pty-manager';

// Casos que abrem PTY de verdade (node-pty). Separados de `pty-manager.test.ts`
// (casos puros) para o arquivo puro rodar em milissegundos e o custo de spawn
// ficar isolado e visível.

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

  it('resize e input não lançam na janela entre o processo morrer e o onExit chegar', async () => {
    // Bug visto no alfa (08/10): o renderer manda resize de uma aba cuja sessão
    // acabou de sair; o node-pty já marcou o processo como encerrado, mas o
    // onExit ainda não removeu o registro — "Cannot resize a pty that has
    // already exited" virava exceção não tratada no main.
    const manager = new PtyManager();
    const ptyId = manager.create({ cols: 80, rows: 24, command: 'cmd.exe', args: ['/c', 'exit'] });
    let exited = false;
    manager.onExit(() => {
      exited = true;
    });
    const errors: unknown[] = [];
    while (!exited) {
      try {
        manager.resize(ptyId, 100, 30);
        manager.input(ptyId, '');
      } catch (error) {
        errors.push(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // Depois do onExit também não lança (registro já removido).
    expect(() => manager.resize(ptyId, 90, 20)).not.toThrow();
    expect(errors).toEqual([]);
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
    // Teto explícito: este teste spawna um PowerShell DE VERDADE, com o profile
    // do usuário. O default de 5 s do vitest não é uma régua do produto — é o
    // default — e a suíte roda os arquivos em paralelo, então o spawn compete
    // por CPU com os outros workers. Medido nesta máquina: mediana 1,8 s e pico
    // 3,2 s isolado; dentro da suíte cheia estourou os 5 s (5328 ms). O input
    // nunca se perdeu em 8 sondagens de 30 s — é latência de cauda, não race.
  }, 20_000);
});

// T014 — integração: `PtyManager.create` aplica `claudeConfigDir` no env real do processo spawnado (não só na função pura `buildPtyEnv` isolada).
describe('PtyManager — claudeConfigDir chega no processo spawnado (FR-005/CA-3)', () => {
  it('a variável CLAUDE_CONFIG_DIR aparece no ambiente real do PTY quando claudeConfigDir é passado', async () => {
    const manager = new PtyManager();
    const dataPromise = new Promise<string>((resolve) => {
      let collected = '';
      manager.onData((_ptyId, data) => {
        collected += data;
        if (collected.includes('DONEL_PROFILE_MARKER_END')) resolve(collected);
      });
    });

    const ptyId = manager.create({
      cols: 80,
      rows: 24,
      command: 'cmd.exe',
      args: ['/c', 'echo %CLAUDE_CONFIG_DIR% & echo DONEL_PROFILE_MARKER_END'],
      claudeConfigDir: 'C:\\Users\\fake-user\\.claude-profiles\\conta-b',
    });

    const collected = await dataPromise;
    expect(collected).toContain('C:\\Users\\fake-user\\.claude-profiles\\conta-b');

    manager.kill(ptyId);
  });
});

// FIX ambiente genérico (28/07, teste do colega) — spawn que falha precisa
// virar mensagem acionável, nunca exceção crua do node-pty atravessando o
// IPC (a aba nascia morta sem explicação na máquina dele).
describe('PtyManager — falha de spawn vira mensagem acionável', () => {
  it('comando inexistente lança com o comando no texto e a dica do node-pty', () => {
    const manager = new PtyManager();

    let thrown: unknown = null;
    try {
      manager.create({ cols: 80, rows: 24, command: 'Z:\\nao-existe\\claude-fantasma.exe', args: [] });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('não consegui iniciar');
    expect(message).toContain('claude-fantasma.exe');
    expect(message).toContain('node-pty');
  });
});
