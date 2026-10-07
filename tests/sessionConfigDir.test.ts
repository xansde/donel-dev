import { describe, expect, it } from 'vitest';
import { resolveSessionConfigDir } from '../src/main/providers/session-config-dir';

// T1310 (011-contas-e-provedores, etapa 3, C21/D3) — `resolveSessionConfigDir`
// é a ÚNICA resposta do app pra "qual CLAUDE_CONFIG_DIR esta sessão usa".
// Tabela-verdade completa: provider vence motor e perfil; sem provider e
// motor ativo -> undefined (motor escreve em ~/.claude, sem override); sem
// provider e sem motor -> activeProfileConfigDir (mundo de hoje, com
// perfis); mundo pós-etapa 2 (sem perfil) -> os mesmos dois primeiros ramos
// intactos, terceiro ramo simplesmente ausente (undefined).

describe('resolveSessionConfigDir (puro, C21 — provider > motor > perfil)', () => {
  it('provider presente vence motor ativo e perfil', () => {
    const result = resolveSessionConfigDir({
      providerConfigDir: '/userdata/providers/openrouter-a1',
      accountsEngineActive: true,
      activeProfileConfigDir: '/profiles/trabalho/.claude',
    });
    expect(result).toBe('/userdata/providers/openrouter-a1');
  });

  it('provider presente vence mesmo sem motor e sem perfil', () => {
    const result = resolveSessionConfigDir({ providerConfigDir: '/userdata/providers/openrouter-a1', accountsEngineActive: false, activeProfileConfigDir: undefined });
    expect(result).toBe('/userdata/providers/openrouter-a1');
  });

  it('sem provider e motor ativo -> undefined (motor escreve em ~/.claude, sem override)', () => {
    const result = resolveSessionConfigDir({ providerConfigDir: undefined, accountsEngineActive: true, activeProfileConfigDir: '/profiles/trabalho/.claude' });
    expect(result).toBeUndefined();
  });

  it('sem provider e sem motor -> cai no perfil ativo (mundo de hoje, com perfis)', () => {
    const result = resolveSessionConfigDir({ providerConfigDir: undefined, accountsEngineActive: false, activeProfileConfigDir: '/profiles/trabalho/.claude' });
    expect(result).toBe('/profiles/trabalho/.claude');
  });

  it('sem provider, sem motor e sem perfil -> undefined (~/.claude real)', () => {
    const result = resolveSessionConfigDir({ providerConfigDir: undefined, accountsEngineActive: false, activeProfileConfigDir: undefined });
    expect(result).toBeUndefined();
  });

  it('mundo pós-etapa 2 (sem perfil, campo ausente): motor ativo -> undefined, motor inativo -> undefined', () => {
    expect(resolveSessionConfigDir({ providerConfigDir: undefined, accountsEngineActive: true })).toBeUndefined();
    expect(resolveSessionConfigDir({ providerConfigDir: undefined, accountsEngineActive: false })).toBeUndefined();
  });

  it('mundo pós-etapa 2 com provider: provider ainda vence', () => {
    const result = resolveSessionConfigDir({ providerConfigDir: '/userdata/providers/x', accountsEngineActive: true });
    expect(result).toBe('/userdata/providers/x');
  });
});
