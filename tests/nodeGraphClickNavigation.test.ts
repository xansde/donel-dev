// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — o achado bloqueante do e2e de
// 12/08 (`.e2e-visual/mapa-de-nos/relatorio.html`): clicar num nó NÃO
// navegava. `handleNodePointerDown` capturava o pointer no `svg`
// (`svgRef.current?.setPointerCapture`); com a captura no ancestral, o
// `pointerup` era reentregue ao svg e o evento `click` nascia lá — o `onClick`
// do `<g>` do nó nunca disparava (D-M4 quebrada). Hover, tooltip, drag e pan
// funcionavam, por isso os 2203 testes verdes não viram.
//
// Duas travas aqui:
// 1. O gesto clique×drag é decisão PURA (`nodeGraphGesture.ts`): arrastar um
//    nó não pode virar navegação só porque o click agora dispara no `<g>`.
// 2. A captura é no PRÓPRIO `<g>` (`event.currentTarget`), nunca no svg —
//    trava de fonte, no mesmo espírito do contrato classe×CSS
//    (`nodeGraphStateClasses.test.ts`): o defeito era invisível a teste de
//    comportamento puro, então o contrato estrutural é assertado direto.
// O comportamento ponta a ponta (clique fecha o overlay e navega) é do
// roteiro `mapa-de-nos.spec.ts`, que reprovou e agora prova.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  beginNodeGesture,
  CLICK_DRAG_THRESHOLD_PX,
  gestureNavigates,
  trackNodeGesture,
} from '../src/renderer/src/DevMode/nodeGraphGesture';

describe('nodeGraphGesture — clique navega, drag não', () => {
  it('apertar e soltar sem mover é clique — navega', () => {
    const gesture = beginNodeGesture(100, 100);
    expect(gestureNavigates(gesture)).toBe(true);
  });

  it('jitter abaixo do threshold continua sendo clique (mão de gente treme)', () => {
    let gesture = beginNodeGesture(100, 100);
    gesture = trackNodeGesture(gesture, 101, 102);
    expect(gestureNavigates(gesture)).toBe(true);
  });

  it('mover além do threshold é drag — soltar em cima do nó NÃO navega', () => {
    let gesture = beginNodeGesture(100, 100);
    gesture = trackNodeGesture(gesture, 100 + CLICK_DRAG_THRESHOLD_PX + 1, 100);
    expect(gestureNavigates(gesture)).toBe(false);
  });

  it('drag que volta ao ponto de partida segue sendo drag — moved não desmarca', () => {
    let gesture = beginNodeGesture(100, 100);
    gesture = trackNodeGesture(gesture, 160, 140);
    gesture = trackNodeGesture(gesture, 100, 100);
    expect(gestureNavigates(gesture)).toBe(false);
  });

  it('sem gesto de pointer (foco por teclado, Enter/Espaço) a navegação é livre', () => {
    expect(gestureNavigates(null)).toBe(true);
  });

  it('o threshold distingue de verdade: só o drag vira drag', () => {
    const clique = trackNodeGesture(beginNodeGesture(0, 0), 2, 2);
    const drag = trackNodeGesture(beginNodeGesture(0, 0), 30, 0);
    expect(gestureNavigates(clique)).toBe(true);
    expect(gestureNavigates(drag)).toBe(false);
  });
});

describe('NodeGraphOverlay — a captura do pointer no drag de nó é no próprio <g>', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/renderer/src/DevMode/NodeGraphOverlay.tsx', import.meta.url)),
    'utf-8',
  );

  it('nenhuma captura vai para o svg por ref — foi ela que matou o click do nó', () => {
    expect(source).not.toContain('svgRef.current?.setPointerCapture');
    expect(source).not.toContain('svgRef.current.setPointerCapture');
  });

  it('handleNodePointerDown captura em event.currentTarget (o <g> do nó)', () => {
    const start = source.indexOf('function handleNodePointerDown');
    expect(start, 'handleNodePointerDown sumiu — atualize esta trava junto com o componente').toBeGreaterThanOrEqual(0);
    const end = source.indexOf('function ', start + 1);
    const handler = source.slice(start, end === -1 ? undefined : end);
    expect(handler).toContain('event.currentTarget.setPointerCapture');
  });
});
