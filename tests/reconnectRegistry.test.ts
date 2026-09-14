import { describe, expect, it } from 'vitest';
import { createReconnectRegistry } from '../src/main/accounts/reconnect-registry';

// 011-contas-e-provedores, etapa 3, Fase 2 (D3) — registro em memória de
// contas que precisam reconectar. Puro (Set em memória): `has`/`mark`/`clear`
// não fazem I/O nenhum; a persistência entre reconstruções do motor vem de
// index.ts injetar a MESMA instância (testado em accountEngine.test.ts, não
// aqui — aqui só o contrato do registro isolado).

describe('createReconnectRegistry', () => {
  it('conta nova nunca está marcada', () => {
    const registry = createReconnectRegistry();
    expect(registry.has('a')).toBe(false);
  });

  it('mark marca a conta; has passa a devolver true', () => {
    const registry = createReconnectRegistry();
    registry.mark('a');
    expect(registry.has('a')).toBe(true);
  });

  it('clear remove a marca', () => {
    const registry = createReconnectRegistry();
    registry.mark('a');
    registry.clear('a');
    expect(registry.has('a')).toBe(false);
  });

  it('clear numa conta nunca marcada é no-op seguro', () => {
    const registry = createReconnectRegistry();
    expect(() => registry.clear('nunca-marcada')).not.toThrow();
    expect(registry.has('nunca-marcada')).toBe(false);
  });

  it('mark é idempotente', () => {
    const registry = createReconnectRegistry();
    registry.mark('a');
    registry.mark('a');
    expect(registry.has('a')).toBe(true);
  });

  it('marcas de contas diferentes são independentes', () => {
    const registry = createReconnectRegistry();
    registry.mark('a');
    expect(registry.has('a')).toBe(true);
    expect(registry.has('b')).toBe(false);
  });
});
