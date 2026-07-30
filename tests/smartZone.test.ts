import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_TOKENS,
  formatSmartZoneLabel,
  getSmartZone,
  smartZonePercent,
} from '../design-system/src/lib/smartZone';

// CA-22 (009-modo-dev-v3) — o `%` de contexto voltou ao rodapé, e o número é
// calculado no `SmartZoneMeter` (design-system). O denominador continua sendo
// decisão do app (`shared/contextWindow.effectiveContextZone`, coberto por
// tests/contextWindow.test.ts); o que se prova aqui é a aritmética do `%` e o
// acordo dela com as faixas de cor — as duas leituras aparecem juntas no rodapé
// e discordar uma da outra seria pior que não mostrar nada.
//
// O módulo é TS puro (sem React, sem CSS): dá para importar direto do
// design-system nesta suíte, sem build do pacote.

describe('smartZonePercent', () => {
  it('divide pela zona e arredonda para inteiro', () => {
    expect(smartZonePercent(135_000, 300_000)).toBe(45);
    expect(smartZonePercent(150_000, 300_000)).toBe(50);
  });

  it('arredonda, e o estouro aparece já no primeiro ponto percentual', () => {
    expect(smartZonePercent(302_000, 300_000)).toBe(101);
    // MEDIDO (não escolhido): 301_500/300_000*100 dá 100.49999999999999 em
    // ponto flutuante, então `Math.round` devolve 100 — o meio exato é
    // inalcançável nesta divisão. Fica documentado em vez de "corrigido": um
    // ponto percentual de diferença num rodapé não justifica aritmética
    // decimal, e conhecer o valor real evita um teste que passa por acidente.
    expect(smartZonePercent(301_500, 300_000)).toBe(100);
  });

  it('NÃO tem teto em 100 — é o ponto da feature (CA-8 da 006)', () => {
    expect(smartZonePercent(380_000, 300_000)).toBe(127);
    expect(smartZonePercent(700_000, 300_000)).toBe(233);
  });

  it('tem piso em 0 e nunca devolve negativo', () => {
    expect(smartZonePercent(0, 300_000)).toBe(0);
    expect(smartZonePercent(-5_000, 300_000)).toBe(0);
  });

  it('devolve 0 quando a zona é 0 ou negativa, em vez de dividir por zero', () => {
    expect(smartZonePercent(135_000, 0)).toBe(0);
    expect(smartZonePercent(135_000, -1)).toBe(0);
  });

  it('usa a zona default do design-system quando o denominador é omitido', () => {
    expect(smartZonePercent(200_000)).toBe(50);
    expect(DEFAULT_MAX_TOKENS).toBe(400_000);
  });

  it('acompanha getSmartZone nas fronteiras das faixas', () => {
    // Número e cor saem do mesmo par (used, max) e o rodapé mostra os dois
    // juntos — as fronteiras precisam ser conhecidas, não presumidas.
    expect(smartZonePercent(210_000, 300_000)).toBe(70);
    expect(getSmartZone(210_000, 300_000)).toBe('warn');

    expect(smartZonePercent(300_000, 300_000)).toBe(100);
    // 100% cheio ainda é `warn` (a faixa de atenção é 70–100 inclusive); só
    // acima dela vira `over` — o limite da zona cumprido não é estouro.
    expect(getSmartZone(300_000, 300_000)).toBe('warn');
    expect(getSmartZone(300_001, 300_000)).toBe('over');

    // MEDIDO: `getSmartZone` compara o percentual CRU (69,9997) e
    // `smartZonePercent` exibe o ARREDONDADO (70) — na faixa de um token antes
    // da fronteira, o rótulo diz "70%" com a barra ainda verde. Documentado, não
    // alinhado: fazer `getSmartZone` arredondar mudaria a cor do `StateDot` e do
    // medidor grande junto, para ganhar um token de precisão.
    expect(smartZonePercent(209_999, 300_000)).toBe(70);
    expect(getSmartZone(209_999, 300_000)).toBe('ok');
  });

  it('a régua em tokens continua ao lado do `%` (o número sozinho não diz de quê)', () => {
    expect(formatSmartZoneLabel(135_000, 300_000)).toBe('135k/300k');
  });
});
