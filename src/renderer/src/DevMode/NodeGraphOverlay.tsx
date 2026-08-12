import { Button } from '@donel-dev/design-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoreSnapshot } from '../../../shared/esteira/store/storeFormat';
import type { MapSelection } from './esteiraMapView';
import {
  createNodeGraphSimulation,
  TONE_CLASS,
  type ForceNode,
  type NodeGraphSimulation,
} from './nodeGraphForce';
import { beginNodeGesture, gestureNavigates, trackNodeGesture, type NodeGesture } from './nodeGraphGesture';
import { buildNodeGraph, type GraphEdgeKind, type GraphNode, type GraphTone } from './nodeGraphView';
import styles from './NodeGraphOverlay.module.css';

// 012 Esteira 4.0 / wi-esteira4-mapa-grafos — o mapa de nós na forma fixada
// pelo dono (D-M1..D-M8) com o motor ratificado (A — d3-force + SVG próprio,
// `specs/012-esteira-4/mapa-grafos-escolha.md`). Substitui a versão React
// Flow reprovada (F25): grafo estilo Obsidian forçado à horizontal — nós
// circulares com rótulo embaixo, simulação AO VIVO com viés horizontal por
// profundidade, cores por estado, satélites pequenos para artefatos, hover
// com realce de vizinhança (D-M4).
//
// A fronteira não mudou: a projeção (`nodeGraphView.ts`) segue sendo a única
// fonte de nós, arestas, tons e frases — nenhuma frase de estado nasce aqui
// (o mesmo defeito já reapareceu três vezes no repo; ver cabeçalho de
// `nodeGraphView.ts`). A física mora em `nodeGraphForce.ts` (pura, testada).
//
// É CONTROLE DE NAVEGAÇÃO, não só visualização: clicar num nó fecha o overlay
// e leva o carrossel/esteira até ele — o MESMO alvo de seleção que o
// carrossel já usa (`onNavigate`, tipado como `MapSelection`).

export interface NodeGraphOverlayProps {
  /** A projeção inteira do store — o componente não a recalcula nem a completa. */
  readonly snapshot: StoreSnapshot | null;
  readonly onClose: () => void;
  /** O mesmo alvo de seleção que o carrossel já consome — o grafo não inventa um segundo modelo de navegação. */
  readonly onNavigate: (target: MapSelection) => void;
}

/** Tom → token, para o QUE não é o círculo (o ponto de estado do tooltip). O círculo é pintado por classe CSS (`TONE_CLASS`), travada por teste contra o CSS module. */
const TONE_VAR: Readonly<Record<GraphTone, string>> = {
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
  ok: 'var(--zone-ok)',
  warn: 'var(--state-waiting)',
  error: 'var(--state-permission)',
  lock: 'var(--state-error)',
};

const EDGE_LATERAL_KINDS: ReadonlySet<GraphEdgeKind> = new Set(['flows_into', 'ships_with']);

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface CanvasTransform {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

function NodeGraphCanvas({
  view,
  onNavigate,
}: {
  view: ReturnType<typeof buildNodeGraph>;
  onNavigate: (target: MapSelection) => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingNodeRef = useRef<ForceNode | null>(null);
  /** O gesto de pointer em curso num nó — decide clique×drag (`nodeGraphGesture.ts`). */
  const nodeGestureRef = useRef<NodeGesture | null>(null);
  const panRef = useRef<{ active: boolean; startX: number; startY: number }>({ active: false, startX: 0, startY: 0 });
  /** Depois do primeiro gesto do usuário (pan/zoom/drag), o enquadramento automático do fim da simulação não briga mais com ele. */
  const interactedRef = useRef(false);

  const [sim, setSim] = useState<NodeGraphSimulation | null>(null);
  const [, setTick] = useState(0);
  const [transform, setTransform] = useState<CanvasTransform>({ x: 0, y: 0, k: 1 });
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  function fitTo(nodes: readonly ForceNode[]): void {
    if (nodes.length === 0) return;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 800;
    const height = rect?.height ?? 500;
    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((width - 120) / graphWidth, (height - 120) / graphHeight)));
    setTransform({ x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k, k });
  }

  // A simulação nasce DENTRO do effect (aviso 1 herdado da bancada): sob
  // StrictMode o double-mount cria e descarta uma instância — criada aqui e
  // parada no cleanup, a descartada nunca roda um tick órfão.
  useEffect(() => {
    const created = createNodeGraphSimulation(view.nodes, view.edges);
    created.simulation.on('tick', () => setTick((t) => t + 1));
    // Enquadra sozinho QUANDO a física assenta — a não ser que o usuário já
    // tenha tomado o mapa para si (pan/zoom/drag): aí o enquadramento é dele.
    created.simulation.on('end', () => {
      if (!interactedRef.current) fitTo(created.nodes);
    });
    created.simulation.alpha(1).restart();
    setSim(created);
    return () => {
      created.simulation.stop();
    };
    // `fitTo` lê refs e um setState — recriá-la por render não muda o effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Enquadramento inicial: centraliza a faixa de colunas antes de a física
  // assentar, para o grafo nunca nascer fora da janela.
  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTransform({ x: rect.width / 4, y: rect.height / 2, k: 1 });
  }, []);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of view.edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set());
      if (!map.has(edge.to)) map.set(edge.to, new Set());
      map.get(edge.from)!.add(edge.to);
      map.get(edge.to)!.add(edge.from);
    }
    return map;
  }, [view.edges]);

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: (clientX - left - transform.x) / transform.k, y: (clientY - top - transform.y) / transform.k };
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>): void {
    interactedRef.current = true;
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    setTransform((prev) => ({ ...prev, k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor)) }));
  }

  function handleBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget) return;
    interactedRef.current = true;
    // `setPointerCapture` (aviso 2 herdado da bancada): sem ele, soltar o
    // mouse FORA do canvas nunca entrega o pointerup — o pan ficava preso e,
    // no drag de nó, a simulação ficava quente (`alphaTarget(0.1)`) para sempre.
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { active: true, startX: event.clientX - transform.x, startY: event.clientY - transform.y };
  }

  function handleNodePointerDown(node: ForceNode, event: React.PointerEvent<SVGGElement>): void {
    event.stopPropagation();
    interactedRef.current = true;
    // A captura é no PRÓPRIO <g> do nó, nunca no svg: com a captura no
    // ancestral, o pointerup era reentregue ao svg e o `click` nascia lá — o
    // onClick do nó não disparava e clicar não navegava (achado do e2e de
    // 12/08, D-M4). Capturado aqui, soltar fora do canvas continua entregando
    // o pointerup (que borbulha até o svg e esfria a simulação).
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingNodeRef.current = node;
    nodeGestureRef.current = beginNodeGesture(event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    const dragging = draggingNodeRef.current;
    if (dragging !== null && sim !== null) {
      const gesture = nodeGestureRef.current;
      if (gesture !== null) {
        const tracked = trackNodeGesture(gesture, event.clientX, event.clientY);
        nodeGestureRef.current = tracked;
        // Dentro do raio de tremor ainda é clique: não arrasta nem esquenta a simulação.
        if (!tracked.moved) return;
      }
      const world = toWorld(event.clientX, event.clientY);
      dragging.fx = world.x;
      dragging.fy = world.y;
      sim.simulation.alphaTarget(0.1).restart();
      return;
    }
    if (panRef.current.active) {
      setTransform((prev) => ({ ...prev, x: event.clientX - panRef.current.startX, y: event.clientY - panRef.current.startY }));
    }
  }

  function handlePointerUp(): void {
    panRef.current.active = false;
    const dragging = draggingNodeRef.current;
    if (dragging !== null) {
      dragging.fx = null;
      dragging.fy = null;
      draggingNodeRef.current = null;
      sim?.simulation.alphaTarget(0);
    }
  }

  function handleNodeHover(node: GraphNode, event: React.MouseEvent): void {
    setHoveredKey(node.key);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 });
  }

  function handleNodeFocus(forceNode: ForceNode): void {
    setHoveredKey(forceNode.node.key);
    // Foco por teclado não tem mouse: o tooltip ancora na posição projetada do nó.
    setTooltipPos({
      x: (forceNode.x ?? 0) * transform.k + transform.x + 14,
      y: (forceNode.y ?? 0) * transform.k + transform.y + 14,
    });
  }

  function handleNodeLeave(): void {
    setHoveredKey(null);
    setTooltipPos(null);
  }

  if (view.empty !== null) {
    return (
      <p className={styles.empty} data-testid="node-graph-empty">
        {view.empty}
      </p>
    );
  }

  // D-M4 — hover realça o nó + vizinhos e apaga o resto (o gesto do Obsidian).
  const keepSet = hoveredKey === null ? null : new Set([hoveredKey, ...(neighbors.get(hoveredKey) ?? [])]);
  const hovered = hoveredKey === null ? null : (view.nodes.find((node) => node.key === hoveredKey) ?? null);

  return (
    <div className={styles.canvas} data-testid="node-graph-canvas" ref={containerRef}>
      <div className={styles.toolbar}>
        <Button variant="ghost" onClick={() => sim !== null && fitTo(sim.nodes)} data-testid="node-graph-fit">
          Enquadrar
        </Button>
      </div>
      <svg
        ref={svgRef}
        className={styles.svg}
        width="100%"
        height="100%"
        onWheel={handleWheel}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          <g>
            {(sim?.links ?? []).map((link) => {
              const source = typeof link.source === 'object' ? link.source : null;
              const target = typeof link.target === 'object' ? link.target : null;
              if (source === null || target === null) return null;
              const on = keepSet === null || (keepSet.has(link.edge.from) && keepSet.has(link.edge.to));
              return (
                <line
                  key={link.edge.key}
                  x1={source.x ?? 0}
                  y1={source.y ?? 0}
                  x2={target.x ?? 0}
                  y2={target.y ?? 0}
                  className={EDGE_LATERAL_KINDS.has(link.edge.kind) ? styles.linkLateral : styles.link}
                  style={{
                    opacity: on ? undefined : 0.12,
                    stroke: on && hovered !== null ? TONE_VAR[hovered.tone] : undefined,
                  }}
                />
              );
            })}
          </g>
          <g>
            {(sim?.nodes ?? []).map((forceNode) => {
              const node = forceNode.node;
              const dimmed = keepSet !== null && !keepSet.has(node.key);
              const classes = [styles.node, styles[TONE_CLASS[node.tone]], node.deviation !== null ? styles.nodeDeviation : '']
                .filter(Boolean)
                .join(' ');
              return (
                <g
                  key={node.key}
                  className={classes}
                  style={{ opacity: dimmed ? 0.18 : 1 }}
                  transform={`translate(${forceNode.x ?? 0}, ${forceNode.y ?? 0})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title} — ${node.summary}`}
                  data-testid="node-graph-node"
                  data-kind={node.kind}
                  data-key={node.key}
                  data-deviation={node.deviation !== null ? 'true' : 'false'}
                  onPointerDown={(event) => handleNodePointerDown(forceNode, event)}
                  onMouseEnter={(event) => handleNodeHover(node, event)}
                  onMouseMove={(event) => handleNodeHover(node, event)}
                  onMouseLeave={handleNodeLeave}
                  onFocus={() => handleNodeFocus(forceNode)}
                  onBlur={handleNodeLeave}
                  onClick={() => {
                    // Depois de um drag, o click dispara no mesmo <g> (down e
                    // up capturados nele) — mas arrastar não é clicar.
                    if (!gestureNavigates(nodeGestureRef.current)) return;
                    onNavigate(node.navigateTo);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onNavigate(node.navigateTo);
                    }
                  }}
                >
                  <circle r={forceNode.radius} />
                  {/* D-M1/D-M3 — rótulo EMBAIXO do círculo, sempre visível. */}
                  <text y={forceNode.radius + 13} textAnchor="middle">
                    {truncate(node.title, 26)}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {/* D-M4 — hover mostra a descrição simples do que está sob o mouse. As
          frases (badge/summary) vêm inteiras da projeção, nunca daqui. */}
      {hovered !== null && tooltipPos !== null ? (
        <div className={styles.tooltip} style={{ left: tooltipPos.x, top: tooltipPos.y }} data-testid="node-graph-tooltip">
          <strong>{hovered.title}</strong>
          <span className={styles.tooltipState} style={{ color: TONE_VAR[hovered.tone] }}>
            ● {hovered.badge}
          </span>
          <p>{hovered.summary}</p>
          {hovered.deviation !== null ? <p className={styles.tooltipDeviation}>⚠ {hovered.deviation.title}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function NodeGraphOverlay({ snapshot, onClose, onNavigate }: NodeGraphOverlayProps): React.JSX.Element {
  const view = useMemo(() => buildNodeGraph(snapshot), [snapshot]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-label="Mapa de nós"
      data-testid="node-graph-overlay"
      onKeyDown={(event) => {
        // Fecha em Esc, como qualquer overlay modal do app — próprio, porque a
        // sobreposição cobre a janela inteira (inclusive a titlebar) e não
        // passa por nenhum handler já existente de outra tela.
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Mapa de nós</h2>
          <p className={styles.subtitle}>
            Outra vista do mesmo histórico da Esteira — {view.nodes.length} nó(s). Clique em um para ir até ele.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} data-testid="node-graph-close">
          Fechar (Esc)
        </Button>
      </header>
      <NodeGraphCanvas view={view} onNavigate={onNavigate} />
    </div>
  );
}
