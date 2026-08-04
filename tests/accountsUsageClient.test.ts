import { describe, expect, it } from 'vitest';
import { parseUsagePayload, readAccountUsage, type HttpFetchLike } from '../src/main/accounts/usage-client';

// T1112 (011-contas-e-provedores, etapa 1) — cliente HTTP do endpoint OAuth
// de usage (mod local, contracts/backends-http.md §B). Parse das janelas
// 5h/7d; payload malformado/HTTP 5xx -> null, nunca lança; token nunca
// aparece em erro. HTTP injetável (mesmo espírito de quota-headroom.ts).

describe('parseUsagePayload (puro)', () => {
  it('extrai as janelas 5h/7d de um payload válido', () => {
    const result = parseUsagePayload({ five_hour: { utilization: 42 }, seven_day: { utilization: 18 } });
    expect(result).toEqual({ fiveHour: 42, sevenDay: 18 });
  });

  it('janela ausente vira null isolada (sucesso parcial)', () => {
    expect(parseUsagePayload({ five_hour: { utilization: 42 } })).toEqual({ fiveHour: 42, sevenDay: null });
  });

  it('payload nulo/vazio/malformado devolve as duas janelas null', () => {
    expect(parseUsagePayload(null)).toEqual({ fiveHour: null, sevenDay: null });
    expect(parseUsagePayload(undefined)).toEqual({ fiveHour: null, sevenDay: null });
    expect(parseUsagePayload('lixo')).toEqual({ fiveHour: null, sevenDay: null });
    expect(parseUsagePayload({})).toEqual({ fiveHour: null, sevenDay: null });
  });

  it('utilization com tipo errado vira null só naquela janela', () => {
    expect(parseUsagePayload({ five_hour: { utilization: 'quarenta' }, seven_day: { utilization: 10 } })).toEqual({
      fiveHour: null,
      sevenDay: 10,
    });
  });
});

function fakeFetch(response: { status: number; body?: unknown; throws?: Error }): HttpFetchLike {
  return async () => {
    if (response.throws) throw response.throws;
    return {
      status: response.status,
      json: async () => response.body,
    };
  };
}

describe('readAccountUsage (I/O injetável)', () => {
  const ACCESS_TOKEN = 'super-secret-access-token';

  it('sucesso: devolve as janelas parseadas', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { five_hour: { utilization: 55 }, seven_day: { utilization: 20 } } });
    const result = await readAccountUsage(ACCESS_TOKEN, { fetchImpl, timeoutMs: 100 });
    expect(result).toEqual({ fiveHour: 55, sevenDay: 20 });
  });

  it('HTTP 5xx devolve null, nunca lança', async () => {
    const fetchImpl = fakeFetch({ status: 500 });
    const result = await readAccountUsage(ACCESS_TOKEN, { fetchImpl, timeoutMs: 100 });
    expect(result).toBeNull();
  });

  it('payload malformado (não é JSON válido / lança no .json()) devolve null', async () => {
    const fetchImpl: HttpFetchLike = async () => ({
      status: 200,
      json: async () => {
        throw new Error('unexpected token');
      },
    });
    const result = await readAccountUsage(ACCESS_TOKEN, { fetchImpl, timeoutMs: 100 });
    expect(result).toBeNull();
  });

  it('erro de rede (fetch lança) devolve null, nunca lança', async () => {
    const fetchImpl = fakeFetch({ status: 0, throws: new Error('network down') });
    const result = await readAccountUsage(ACCESS_TOKEN, { fetchImpl, timeoutMs: 100 });
    expect(result).toBeNull();
  });

  it('token nunca aparece em mensagem de erro', async () => {
    const fetchImpl: HttpFetchLike = async () => {
      throw new Error(`falhou com token ${ACCESS_TOKEN}`); // simula um erro mal-comportado de uma lib
    };
    try {
      const result = await readAccountUsage(ACCESS_TOKEN, { fetchImpl, timeoutMs: 100 });
      expect(result).toBeNull();
    } catch (error) {
      // Se por acaso lançar (não deveria), a mensagem JAMAIS pode conter o token.
      expect(String(error)).not.toContain(ACCESS_TOKEN);
    }
  });

  it('token vai no header Authorization Bearer', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl: HttpFetchLike = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return { status: 200, json: async () => ({}) };
    };
    await readAccountUsage(ACCESS_TOKEN, { fetchImpl, timeoutMs: 100 });
    expect(capturedHeaders?.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});
