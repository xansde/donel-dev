// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — a decisão clique×drag de um nó
// do mapa, PURA (testada em `tests/nodeGraphClickNavigation.test.ts`).
//
// Existe por causa do fix do achado do e2e de 12/08: com a captura do pointer
// no próprio `<g>` do nó (e não mais no svg), o `click` volta a disparar no
// nó — inclusive DEPOIS de um arrasto, porque down e up acontecem no mesmo
// elemento. Arrastar não é clicar: o gesto marca `moved` quando o pointer sai
// do raio de tolerância e nunca desmarca — soltar o nó em cima de onde ele
// começou continua sendo drag.

/** Tolerância de tremor da mão: até aqui o gesto ainda é clique. */
export const CLICK_DRAG_THRESHOLD_PX = 4;

export interface NodeGesture {
  readonly startX: number;
  readonly startY: number;
  readonly moved: boolean;
}

export function beginNodeGesture(x: number, y: number): NodeGesture {
  return { startX: x, startY: y, moved: false };
}

/** Marca o gesto como drag quando sai do raio — e drag nunca volta a ser clique. */
export function trackNodeGesture(gesture: NodeGesture, x: number, y: number): NodeGesture {
  if (gesture.moved) return gesture;
  const beyond = Math.hypot(x - gesture.startX, y - gesture.startY) > CLICK_DRAG_THRESHOLD_PX;
  return beyond ? { ...gesture, moved: true } : gesture;
}

/** `null` = não houve gesto de pointer (foco por teclado): a navegação é livre. */
export function gestureNavigates(gesture: NodeGesture | null): boolean {
  return gesture === null || !gesture.moved;
}
