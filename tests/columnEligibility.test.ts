import { describe, expect, it } from 'vitest';
import { DISPATCHABLE_COLUMNS, eligiblePhaseForColumn } from '../src/shared/columnEligibility';

// 009-modo-dev-v3, lote 5 — CA-1: TaskDex responde "o que posso disparar
// agora" pela COLUNA do card, nunca por label (achado 12 da spec: nenhuma
// tool de leitura do TaskDex expõe labels — `taskdex-board-client.ts:258-286`
// já documentava isso antes deste módulo existir). Mapeamento fechado,
// nascido ANTES do código de produção (TDD): coluna → fase disparável, ou
// `null` por omissão. Este módulo NÃO decide duplo-disparo — esse veto
// continua em `esteira/tools/preflight.py`, do lado da skill (CA-1 literal).

describe('eligiblePhaseForColumn (CA-1)', () => {
  it('Discovery → discovery', () => {
    expect(eligiblePhaseForColumn('discovery')).toBe('discovery');
  });

  it('Plano → plano', () => {
    expect(eligiblePhaseForColumn('plano')).toBe('plano');
  });

  it('Implementar → implementar', () => {
    expect(eligiblePhaseForColumn('implementar')).toBe('implementar');
  });

  it('Validar → validar', () => {
    expect(eligiblePhaseForColumn('validar')).toBe('validar');
  });

  it('Documentar → documentar', () => {
    expect(eligiblePhaseForColumn('documentar')).toBe('documentar');
  });

  it('Backlog não dispara nada', () => {
    expect(eligiblePhaseForColumn('backlog')).toBeNull();
  });

  it('Concluído não dispara nada (nenhuma grafia — "concluido" nem "concluir")', () => {
    expect(eligiblePhaseForColumn('concluido')).toBeNull();
    expect(eligiblePhaseForColumn('concluir')).toBeNull();
  });

  it('Validação com Cliente não está na lista do CA-1 → nada, por omissão', () => {
    expect(eligiblePhaseForColumn('validacao-cliente')).toBeNull();
  });

  it('coluna desconhecida → nada por omissão, nunca lança', () => {
    expect(eligiblePhaseForColumn('coluna-esquisita')).toBeNull();
    expect(eligiblePhaseForColumn('')).toBeNull();
  });
});

describe('DISPATCHABLE_COLUMNS — fonte única também para a porta de entrada (CA-2)', () => {
  it('lista exatamente as 5 colunas do CA-1, nesta ordem', () => {
    expect(DISPATCHABLE_COLUMNS).toEqual(['discovery', 'plano', 'implementar', 'validar', 'documentar']);
  });
});
