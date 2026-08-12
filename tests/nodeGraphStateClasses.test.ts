// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — aviso 3 herdado da bancada
// (`specs/012-esteira-4/mapa-grafos-escolha.md`, seção 3): na Validar da
// bancada, o componente emitia `node--ok` e o CSS definia `.force-node--ok` —
// nenhum fill aplicava e todos os nós saíam pretos, sem teste que visse.
// Este teste trava o contrato componente×CSS do mapa REAL: toda classe de tom
// que o componente emite tem regra de `fill` no CSS module (D-M2 — o estado é
// lido pela cor, de relance).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TONE_CLASS } from '../src/renderer/src/DevMode/nodeGraphForce';
import type { GraphTone } from '../src/renderer/src/DevMode/nodeGraphView';

const css = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/DevMode/NodeGraphOverlay.module.css', import.meta.url)),
  'utf-8',
);

const TONES: readonly GraphTone[] = ['muted', 'accent', 'ok', 'warn', 'error', 'lock'];

describe('classes de tom × NodeGraphOverlay.module.css', () => {
  it('TONE_CLASS cobre os seis tons da projeção (que cobrem os cinco estados de D-M2)', () => {
    for (const tone of TONES) {
      expect(TONE_CLASS[tone], `sem classe para o tom "${tone}"`).toBeTruthy();
    }
  });

  it('toda classe de tom emitida tem regra pintando o círculo (fill) no CSS module', () => {
    for (const tone of TONES) {
      const cls = TONE_CLASS[tone];
      const blockStart = css.indexOf(`.${cls} circle`);
      expect(blockStart, `sem regra ".${cls} circle" no CSS`).toBeGreaterThanOrEqual(0);
      const block = css.slice(blockStart, css.indexOf('}', blockStart));
      expect(block, `regra ".${cls} circle" não define fill`).toContain('fill:');
    }
  });

  it('D-M2: "ainda não começou" é cinza VAZADO — o tom muted tem stroke, não só fill', () => {
    const cls = TONE_CLASS.muted;
    const blockStart = css.indexOf(`.${cls} circle`);
    const block = css.slice(blockStart, css.indexOf('}', blockStart));
    expect(block).toContain('stroke:');
  });
});
