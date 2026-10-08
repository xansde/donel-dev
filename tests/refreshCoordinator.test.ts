import { describe, expect, it } from 'vitest';
import { FakeVault, accountOf, buildPair, jsonResponse } from './helpers/localModFixtures';
import { createRefreshCoordinator } from '../src/main/accounts/refresh-coordinator';
import { createLocalMod } from '../src/main/accounts/mods/local-mod';
import type { HttpFetchLike } from '../src/main/accounts/usage-client';
import type { RefreshResult } from '../src/main/accounts/token-refresh';

// 011-contas-e-provedores, etapa 3, Fase 2 (R1, revisão) — o coordenador de
// renovação PRECISA sobreviver à reconstrução do mod (o motor troca de mod
// inteiro na F6): duas instâncias de `createLocalMod` que recebem o MESMO
// `RefreshCoordinator` nunca disparam dois refresh com o mesmo refresh token
// (uso único) para a mesma conta, mesmo chamando `listAccounts` em paralelo
// a partir de instâncias DIFERENTES.

describe('createRefreshCoordinator (puro)', () => {
  it('chamada com o MESMO id enquanto a primeira ainda está em voo recebe a MESMA promessa (task roda uma vez só)', async () => {
    const coordinator = createRefreshCoordinator();
    let taskCalls = 0;
    let resolveTask: (value: string) => void = () => {};
    const controlled = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });

    const p1 = coordinator.run('acc-1', async () => {
      taskCalls += 1;
      return controlled;
    });
    const p2 = coordinator.run('acc-1', async () => {
      taskCalls += 1;
      return 'nunca deveria rodar';
    });

    resolveTask('resultado-unico');
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(taskCalls).toBe(1);
    expect(r1).toBe('resultado-unico');
    expect(r2).toBe('resultado-unico');
  });

  it('ids DIFERENTES rodam a task cada um a sua vez, independentemente', async () => {
    const coordinator = createRefreshCoordinator();
    const calls: string[] = [];

    await Promise.all([
      coordinator.run('acc-1', async () => {
        calls.push('acc-1');
      }),
      coordinator.run('acc-2', async () => {
        calls.push('acc-2');
      }),
    ]);

    expect(calls.sort()).toEqual(['acc-1', 'acc-2']);
  });

  it('depois que a task termina (sucesso), o registro em voo limpa — a PRÓXIMA chamada roda a task de novo', async () => {
    const coordinator = createRefreshCoordinator();
    let taskCalls = 0;

    await coordinator.run('acc-1', async () => {
      taskCalls += 1;
    });
    await coordinator.run('acc-1', async () => {
      taskCalls += 1;
    });

    expect(taskCalls).toBe(2);
  });

  it('task que rejeita ainda limpa o registro em voo (finally) — chamada seguinte tenta de novo', async () => {
    const coordinator = createRefreshCoordinator();
    let taskCalls = 0;

    await expect(
      coordinator.run('acc-1', async () => {
        taskCalls += 1;
        throw new Error('falha (fake)');
      }),
    ).rejects.toThrow('falha (fake)');

    await coordinator.run('acc-1', async () => {
      taskCalls += 1;
    });

    expect(taskCalls).toBe(2);
  });

  it('chamada concorrente que chega enquanto a primeira está em voo recebe a MESMA rejeição quando a primeira rejeita', async () => {
    const coordinator = createRefreshCoordinator();
    let taskCalls = 0;
    let rejectTask: (error: Error) => void = () => {};
    const controlled = new Promise<void>((_resolve, reject) => {
      rejectTask = reject;
    });

    const p1 = coordinator.run('acc-1', async () => {
      taskCalls += 1;
      await controlled;
    });
    const p2 = coordinator.run('acc-1', async () => {
      taskCalls += 1;
    });

    rejectTask(new Error('recusado (fake)'));
    await expect(p1).rejects.toThrow('recusado (fake)');
    await expect(p2).rejects.toThrow('recusado (fake)');
    expect(taskCalls).toBe(1);
  });
});

// -- integração com o mod local ---------------------------------------------

describe('R1 — uma renovação por conta ENTRE instâncias do mod local', () => {
  it('DOIS mods (duas createLocalMod) com o MESMO coordenador e o mesmo cofre: listAccounts dos dois em paralelo para a mesma conta parada vencida -> refreshImpl chamado UMA vez, os dois leem a carga com o token novo', async () => {
    const coordinator = createRefreshCoordinator();
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'velho', expiresAt: Date.now() - 1000 })));
    const newPair = buildPair({ accessToken: 'novo-compartilhado', refreshToken: 'novo-refresh' });
    const refreshCalls: string[] = [];
    const usageCalls: string[] = [];

    async function refreshImpl(refreshToken: string): Promise<RefreshResult> {
      refreshCalls.push(refreshToken);
      await Promise.resolve();
      return { kind: 'ok', pair: newPair };
    }
    const fetchImpl: HttpFetchLike = async (_url, init) => {
      const auth = (init?.headers?.Authorization ?? '').replace('Bearer ', '');
      usageCalls.push(auth);
      return jsonResponse(200, { five_hour: { utilization: 1 }, seven_day: { utilization: 2 } });
    };

    // Duas instâncias DISTINTAS — o motor recria o mod (F6) e passaria a
    // MESMA dep `refreshCoordinator` pras duas; sem isso cada uma teria seu
    // próprio mapa em voo e chamaria refresh duas vezes (ver teste abaixo).
    const modA = createLocalMod({ accounts: [accountOf('acc-parada')], vault, fetchImpl, refreshImpl, refreshCoordinator: coordinator });
    const modB = createLocalMod({ accounts: [accountOf('acc-parada')], vault, fetchImpl, refreshImpl, refreshCoordinator: coordinator });

    const [resultA, resultB] = await Promise.all([modA.listAccounts(), modB.listAccounts()]);

    expect(refreshCalls).toHaveLength(1);
    if (resultA.kind !== 'ok' || resultB.kind !== 'ok') throw new Error('esperava ok');
    expect(resultA.accounts[0].load).toEqual({ fiveHour: 1, sevenDay: 2, sonnet: null, readAt: expect.any(String) });
    expect(resultB.accounts[0].load).toEqual({ fiveHour: 1, sevenDay: 2, sonnet: null, readAt: expect.any(String) });
    expect(usageCalls.every((token) => token === 'novo-compartilhado')).toBe(true);
    expect(vault.read('acc-parada')).toBe(JSON.stringify(newPair));
  });

  it('SEM refreshCoordinator compartilhado (default — um novo por mod), duas instâncias NÃO se protegem entre si: refreshImpl chamado duas vezes', async () => {
    // Prova a REGRESSÃO que R1 corrige e o limite do default: sem a dep
    // injetada, cada mod cria seu PRÓPRIO coordenador — continuam cegos um
    // pro outro, exatamente como o `pendingRefreshes` local de antes.
    const vault = new FakeVault();
    vault.write('acc-parada', JSON.stringify(buildPair({ accessToken: 'velho', expiresAt: Date.now() - 1000 })));
    const refreshCalls: string[] = [];

    async function refreshImpl(refreshToken: string): Promise<RefreshResult> {
      refreshCalls.push(refreshToken);
      await Promise.resolve();
      return { kind: 'ok', pair: buildPair({ accessToken: `novo-${refreshCalls.length}` }) };
    }
    const fetchImpl: HttpFetchLike = async () => jsonResponse(200, {});

    const modA = createLocalMod({ accounts: [accountOf('acc-parada')], vault, fetchImpl, refreshImpl });
    const modB = createLocalMod({ accounts: [accountOf('acc-parada')], vault, fetchImpl, refreshImpl });

    await Promise.all([modA.listAccounts(), modB.listAccounts()]);

    expect(refreshCalls).toHaveLength(2);
  });
});
