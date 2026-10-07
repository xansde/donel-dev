import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { Settings as SigmaSettings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { BenchGraph, BenchNode } from '../benchGraph';
import { runToStable } from '../forceLayout';
import { resolveFutureFill, resolveStateColor } from '../themeColors';
import { GraphTooltip } from '../ui/GraphTooltip';
import { FpsCounter } from '../ui/FpsCounter';

interface TabProps {
  graph: BenchGraph;
  selectedNodeId: string | null;
  onSelect: (node: BenchNode) => void;
  showFps: boolean;
}

function colorForNode(state: BenchNode['state']): string {
  return state === 'future' ? resolveFutureFill() : resolveStateColor(state);
}

/**
 * Desenha o rótulo EMBAIXO do nó (D-M1) — sigma, por padrão, desenha à
 * direita. Sobrescrevemos `defaultDrawNodeLabel` na Settings da instância;
 * é a "briga" desta aba contra a forma fixada, ver README/relatório.
 */
function drawLabelBelow(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: SigmaSettings,
): void {
  if (!data.label) return;
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  context.font = `${weight} ${size}px ${font}`;
  context.fillStyle = '#c3c9d4';
  context.textAlign = 'center';
  context.fillText(data.label, data.x, data.y + data.size + size + 2);
}

/**
 * Aba B — sigma.js + graphology (WebGL). Posições vêm da física
 * compartilhada JÁ estabilizada (`runToStable`) — sigma não recebe física
 * ao vivo aqui; o grafo é montado uma vez com x/y finais.
 */
export function TabSigma({ graph, selectedNodeId, onSelect, showFps }: TabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [hoveredNode, setHoveredNode] = useState<BenchNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const stable = useMemo(() => runToStable(graph), [graph]);

  const graphology = useMemo(() => {
    const g = new Graph();
    for (const node of stable.nodes) {
      g.addNode(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        size: node.radius,
        color: colorForNode(node.state),
        label: node.title.split(/[—:]/)[0].trim().slice(0, 26),
        state: node.state,
        bench: { id: node.id, title: node.title, desc: node.desc, size: node.size, state: node.state } as BenchNode,
      });
    }
    for (const link of stable.links) {
      if (!g.hasEdge(link.from, link.to)) {
        g.addEdge(link.from, link.to, { color: '#3a404c', size: 1.2 });
      }
    }
    return g;
  }, [stable]);

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new Sigma(graphology, containerRef.current, {
      defaultDrawNodeLabel: drawLabelBelow,
      renderLabels: true,
      labelColor: { color: '#c3c9d4' },
    });
    sigmaRef.current = renderer;

    renderer.on('enterNode', ({ node, event }) => {
      const bench = graphology.getNodeAttribute(node, 'bench') as BenchNode;
      setHoveredNode(bench);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({ x: event.x - rect.left + 14, y: event.y - rect.top + 14 });
      }
      renderer.refresh();
    });
    renderer.on('leaveNode', () => {
      setHoveredNode(null);
      setTooltipPos(null);
      renderer.refresh();
    });
    renderer.on('clickNode', ({ node }) => {
      const bench = graphology.getNodeAttribute(node, 'bench') as BenchNode;
      onSelect(bench);
    });

    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphology]);

  // Realce de vizinhança (D-M4) via reducers — recalcula a cada hover.
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;

    if (!hoveredNode) {
      renderer.setSetting('nodeReducer', null);
      renderer.setSetting('edgeReducer', null);
      renderer.refresh();
      return;
    }

    const keep = new Set<string>([hoveredNode.id]);
    graphology.forEachNeighbor(hoveredNode.id, (neighbor) => keep.add(neighbor));

    renderer.setSetting('nodeReducer', (node, data) => ({
      ...data,
      zIndex: node === hoveredNode.id ? 2 : 0,
      color: keep.has(node) ? data.color : `${data.color}2e`,
    }));
    renderer.setSetting('edgeReducer', (edge, data) => {
      const [source, target] = graphology.extremities(edge);
      const on = keep.has(source) && keep.has(target);
      return {
        ...data,
        color: on ? colorForNode(hoveredNode.state) : '#3a404c1e',
        size: on ? 2 : data.size,
      };
    });
    renderer.refresh();
  }, [hoveredNode, graphology]);

  // Seleção visual — contorno no nó selecionado.
  useEffect(() => {
    graphology.forEachNode((node) => {
      graphology.setNodeAttribute(node, 'highlighted', node === selectedNodeId);
    });
    sigmaRef.current?.refresh();
  }, [selectedNodeId, graphology]);

  return (
    <div className="canvas-root">
      {showFps ? <FpsCounter /> : null}
      <div className="sigma-container" ref={containerRef} />
      {hoveredNode && tooltipPos ? <GraphTooltip node={hoveredNode} x={tooltipPos.x} y={tooltipPos.y} /> : null}
    </div>
  );
}
