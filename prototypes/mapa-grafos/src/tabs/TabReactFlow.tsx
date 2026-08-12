import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BenchGraph, BenchNode } from '../benchGraph';
import { runToStable } from '../forceLayout';
import { GraphTooltip } from '../ui/GraphTooltip';
import { FpsCounter } from '../ui/FpsCounter';

interface TabProps {
  graph: BenchGraph;
  selectedNodeId: string | null;
  onSelect: (node: BenchNode) => void;
  showFps: boolean;
}

type FlowNodeData = {
  bench: BenchNode;
  radius: number;
  selected: boolean;
  onHover: (bench: BenchNode | null, event?: React.MouseEvent) => void;
  dimmed: boolean;
};

function CircleNode({ data }: NodeProps) {
  const { bench, radius, selected, onHover, dimmed } = data as unknown as FlowNodeData;
  const size = radius * 2;

  return (
    <div
      className={`rf-circle-node rf-circle-node--${bench.state}${selected ? ' rf-circle-node--selected' : ''}`}
      style={{ width: size, height: size, opacity: dimmed ? 0.18 : 1 }}
      onMouseEnter={(event) => onHover(bench, event)}
      onMouseMove={(event) => onHover(bench, event)}
      onMouseLeave={() => onHover(null)}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="rf-circle-node-label">
        {bench.title.split(/[—:]/)[0].trim().slice(0, 26)}
      </span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { circleNode: CircleNode };

/**
 * Aba C — React Flow posicionado por d3-force. Diferente da A, a física
 * roda uma vez (`runToStable`) e as posições finais viram coordenadas
 * ESTÁTICAS do React Flow: esta aba "perde o vivo" da simulação de
 * propósito — é característica registrada, não bug (ver decisão do dono).
 */
function TabReactFlowInner({ graph, selectedNodeId, onSelect, showFps }: TabProps) {
  const stable = useMemo(() => runToStable(graph), [graph]);
  const [hovered, setHovered] = useState<{ node: BenchNode; x: number; y: number } | null>(null);

  function handleHover(bench: BenchNode | null, event?: React.MouseEvent) {
    if (!bench || !event) {
      setHovered(null);
      return;
    }
    const container = (event.currentTarget as HTMLElement).closest('.canvas-root') as HTMLElement | null;
    const rect = container?.getBoundingClientRect();
    setHovered({
      node: bench,
      x: (rect ? event.clientX - rect.left : event.clientX) + 14,
      y: (rect ? event.clientY - rect.top : event.clientY) + 14,
    });
  }

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of stable.links) {
      if (!map.has(link.from)) map.set(link.from, new Set());
      if (!map.has(link.to)) map.set(link.to, new Set());
      map.get(link.from)!.add(link.to);
      map.get(link.to)!.add(link.from);
    }
    return map;
  }, [stable.links]);

  const keepSet = hovered ? new Set([hovered.node.id, ...(neighbors.get(hovered.node.id) ?? [])]) : null;

  const nodes: Node[] = useMemo(
    () =>
      stable.nodes.map((n) => ({
        id: n.id,
        type: 'circleNode',
        position: { x: n.x ?? 0, y: n.y ?? 0 },
        data: {
          bench: { id: n.id, title: n.title, desc: n.desc, size: n.size, state: n.state },
          radius: n.radius,
          selected: n.id === selectedNodeId,
          onHover: handleHover,
          dimmed: keepSet ? !keepSet.has(n.id) : false,
        } as unknown as Record<string, unknown>,
        draggable: false,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stable.nodes, selectedNodeId, keepSet],
  );

  const edges: Edge[] = useMemo(
    () =>
      stable.links.map((link, index) => {
        const on = keepSet ? keepSet.has(link.from) && keepSet.has(link.to) : true;
        return {
          id: `e-${index}-${link.from}-${link.to}`,
          source: link.from,
          target: link.to,
          type: 'straight',
          style: { opacity: keepSet ? (on ? 1 : 0.12) : 1 },
        };
      }),
    [stable.links, keepSet],
  );

  return (
    <div className="canvas-root">
      {showFps ? <FpsCounter /> : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        onNodeClick={(_event, node) => {
          const bench = (node.data as unknown as FlowNodeData).bench;
          onSelect(bench);
        }}
      >
        <Background />
        <Controls />
        <MiniMap
          pannable
          zoomable
          bgColor="var(--bg-raised)"
          maskColor="color-mix(in srgb, var(--bg-app) 70%, transparent)"
          nodeColor="var(--border)"
          nodeStrokeColor="var(--text-muted)"
        />
      </ReactFlow>
      {hovered ? <GraphTooltip node={hovered.node} x={hovered.x} y={hovered.y} /> : null}
    </div>
  );
}

export function TabReactFlow(props: TabProps) {
  return (
    <ReactFlowProvider>
      <TabReactFlowInner {...props} />
    </ReactFlowProvider>
  );
}
