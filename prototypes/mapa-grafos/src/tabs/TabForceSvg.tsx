import { useEffect, useMemo, useRef, useState } from 'react';
import type { BenchGraph, BenchNode } from '../benchGraph';
import { createForceLayout, type SimLink, type SimNode } from '../forceLayout';
import { GraphTooltip } from '../ui/GraphTooltip';
import { FpsCounter } from '../ui/FpsCounter';

interface TabProps {
  graph: BenchGraph;
  selectedNodeId: string | null;
  onSelect: (node: BenchNode) => void;
  showFps: boolean;
}

const STATE_CLASS: Record<BenchNode['state'], string> = {
  ok: 'node--ok',
  run: 'node--run',
  wait: 'node--wait',
  block: 'node--block',
  future: 'node--future',
};

const STATE_TOKEN: Record<BenchNode['state'], string> = {
  ok: 'var(--zone-ok)',
  run: 'var(--accent)',
  wait: 'var(--state-waiting)',
  block: 'var(--state-permission)',
  future: 'var(--state-done)',
};

/**
 * Aba A — d3-force + SVG próprio. O caminho do Obsidian: simulação AO VIVO
 * (nós chegam se acomodando, tick a tick), círculos + texto puro (sem lib
 * de render intermediária).
 */
export function TabForceSvg({ graph, selectedNodeId, onSelect, showFps }: TabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingNodeRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0,
  });

  const layout = useMemo(() => createForceLayout(graph), [graph]);
  const { simulation, nodes, links } = layout;

  const [, setTick] = useState(0);
  const [transform, setTransform] = useState({ x: 400, y: 220, k: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    simulation.on('tick', () => setTick((t) => t + 1));
    return () => {
      simulation.stop();
    };
  }, [simulation]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      const a = link.from;
      const b = link.to;
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [links]);

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    setTransform((prev) => ({ ...prev, k: Math.min(4, Math.max(0.15, prev.k * factor)) }));
  }

  function handleBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    panRef.current = { active: true, startX: event.clientX - transform.x, startY: event.clientY - transform.y };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (draggingNodeRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (event.clientX - rect.left - transform.x) / transform.k;
      const y = (event.clientY - rect.top - transform.y) / transform.k;
      draggingNodeRef.current.fx = x;
      draggingNodeRef.current.fy = y;
      simulation.alphaTarget(0.1).restart();
      return;
    }
    if (panRef.current.active) {
      setTransform((prev) => ({ ...prev, x: event.clientX - panRef.current.startX, y: event.clientY - panRef.current.startY }));
    }
  }

  function handlePointerUp() {
    panRef.current.active = false;
    if (draggingNodeRef.current) {
      draggingNodeRef.current.fx = null;
      draggingNodeRef.current.fy = null;
      draggingNodeRef.current = null;
      simulation.alphaTarget(0);
    }
  }

  function handleNodePointerDown(node: SimNode, event: React.PointerEvent) {
    event.stopPropagation();
    draggingNodeRef.current = node;
  }

  function handleNodeMouseEnter(node: SimNode, event: React.MouseEvent) {
    setHoveredId(node.id);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({ x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 });
    }
  }

  function handleNodeMouseMove(event: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({ x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 });
    }
  }

  function handleNodeMouseLeave() {
    setHoveredId(null);
    setTooltipPos(null);
  }

  function handleFit() {
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
    const k = Math.min(4, Math.max(0.15, Math.min((width - 80) / graphWidth, (height - 80) / graphHeight)));
    setTransform({ x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k, k });
  }

  const keepSet = hoveredId ? new Set([hoveredId, ...(neighbors.get(hoveredId) ?? [])]) : null;
  const hoveredNode = hoveredId ? byId.get(hoveredId) : undefined;

  return (
    <div className="canvas-root" ref={containerRef}>
      <div className="canvas-toolbar">
        <button type="button" onClick={handleFit}>
          fit
        </button>
      </div>
      {showFps ? <FpsCounter /> : null}
      <svg
        className="force-svg"
        width="100%"
        height="100%"
        onWheel={handleWheel}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          <g className="force-links">
            {links.map((link, index) => {
              const source = typeof link.source === 'object' ? (link.source as SimNode) : byId.get(link.from);
              const target = typeof link.target === 'object' ? (link.target as SimNode) : byId.get(link.to);
              if (!source || !target) return null;
              const on = keepSet ? keepSet.has(link.from) && keepSet.has(link.to) : true;
              const strokeColor = on && hoveredNode ? STATE_TOKEN[hoveredNode.state] : undefined;
              return (
                <line
                  key={index}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className="force-link"
                  style={{ opacity: keepSet ? (on ? 1 : 0.12) : 1, stroke: strokeColor }}
                />
              );
            })}
          </g>
          <g className="force-nodes">
            {nodes.map((node) => {
              const dimmed = keepSet ? !keepSet.has(node.id) : false;
              const classes = ['force-node', STATE_CLASS[node.state]];
              if (node.id === selectedNodeId) classes.push('force-node--selected');
              return (
                <g
                  key={node.id}
                  className={classes.join(' ')}
                  style={{ opacity: dimmed ? 0.18 : 1 }}
                  transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
                  onPointerDown={(event) => handleNodePointerDown(node, event)}
                  onMouseEnter={(event) => handleNodeMouseEnter(node, event)}
                  onMouseMove={handleNodeMouseMove}
                  onMouseLeave={handleNodeMouseLeave}
                  onClick={() => onSelect(node)}
                >
                  <circle r={node.radius} />
                  <text y={node.radius + 13} textAnchor="middle">
                    {node.title.split(/[—:]/)[0].trim().slice(0, 26)}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {hoveredNode && tooltipPos ? <GraphTooltip node={hoveredNode} x={tooltipPos.x} y={tooltipPos.y} /> : null}
    </div>
  );
}
