import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STATE_CLASS } from './tabs/TabForceSvg';
import type { BenchNode } from './benchGraph';

// Regressão do achado 1 da Validar (12/08): o componente emitia `node--ok`
// e o CSS definia `.force-node--ok` — nenhum fill aplicava e todos os nós
// saíam pretos. Nenhum teste tocava render; este trava o contrato
// componente×CSS sem precisar de browser.
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

const STATES: BenchNode['state'][] = ['ok', 'run', 'wait', 'block', 'future'];

describe('classes de estado × styles.css', () => {
  it('toda classe emitida pela aba A (SVG próprio) tem regra de fill no CSS', () => {
    for (const state of STATES) {
      const cls = STATE_CLASS[state];
      expect(css, `sem regra para .${cls}`).toContain(`.${cls} circle`);
    }
  });

  it('toda classe de estado da aba C (React Flow) tem regra no CSS', () => {
    for (const state of STATES) {
      expect(css, `sem regra para .rf-circle-node--${state}`).toContain(`.rf-circle-node--${state}`);
    }
  });
});
