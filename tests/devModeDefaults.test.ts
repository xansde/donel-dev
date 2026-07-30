import { describe, expect, it } from 'vitest';
import type { EsteiraPhase } from '../src/shared/devMode';
import { DEFAULT_PHASE_DEFAULTS, resolveCommandText } from '../src/shared/devModeDefaults';

// T302 (003-modo-dev, Batch A) — tabela de defaults por fase (CA-4/C6). Muda
// sem tocar em código (config editável, T307 devMode:setDefaults) — o que
// entra AQUI é só o ponto de partida.

const ALL_PHASES: readonly EsteiraPhase[] = [
  'discovery',
  'plano',
  'implementar',
  'validar',
  'documentar',
  'cliente',
  'concluir',
];

describe('DEFAULT_PHASE_DEFAULTS', () => {
  it('tem as 7 fases (CA-18: documentar/cliente entram)', () => {
    for (const phase of ALL_PHASES) {
      expect(DEFAULT_PHASE_DEFAULTS[phase]).toBeDefined();
    }
  });

  it('implementar contém a palavra-chave ultracode no commandTemplate (C6)', () => {
    expect(DEFAULT_PHASE_DEFAULTS.implementar.commandTemplate).toContain('ultracode');
  });

  // C6 (concluir) + §G do contrato v3 (cliente: inline, não abre sessão própria).
  it('concluir e cliente têm opensOwnSession: false; as demais, true', () => {
    const inlinePhases: readonly EsteiraPhase[] = ['concluir', 'cliente'];
    expect(DEFAULT_PHASE_DEFAULTS.concluir.opensOwnSession).toBe(false);
    expect(DEFAULT_PHASE_DEFAULTS.cliente.opensOwnSession).toBe(false);
    for (const phase of ALL_PHASES) {
      if (inlinePhases.includes(phase)) continue;
      expect(DEFAULT_PHASE_DEFAULTS[phase].opensOwnSession).toBe(true);
    }
  });

  it('validar é literalmente /esteira-validar {card_id}, sem --subset ou qualquer outra flag (D2)', () => {
    expect(DEFAULT_PHASE_DEFAULTS.validar.commandTemplate).toBe('/esteira-validar {card_id}');
  });

  it('nenhum commandTemplate contém flag inexistente na skill real (--subset)', () => {
    for (const phase of ALL_PHASES) {
      expect(DEFAULT_PHASE_DEFAULTS[phase].commandTemplate).not.toContain('--subset');
    }
  });
});

describe('resolveCommandText', () => {
  it('substitui o placeholder {card_id} sem deixá-lo literal no resultado', () => {
    const text = resolveCommandText(DEFAULT_PHASE_DEFAULTS.plano, 'card-123');
    expect(text).toBe('/esteira-plano card-123');
    expect(text).not.toContain('{card_id}');
  });

  it('substitui {card_id} também quando o template tem texto depois do placeholder', () => {
    const text = resolveCommandText(DEFAULT_PHASE_DEFAULTS.implementar, 'card-999');
    expect(text).toBe('/esteira-implementar card-999 ultracode');
  });
});
