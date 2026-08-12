import { useMemo } from 'react';
import { Canvas, Node as ReaflowNode, type NodeData, type EdgeData } from 'reaflow';
import type { NeutralGraph, NeutralNode } from '../adapter';

interface TabProps {
  graph: NeutralGraph;
  selectedNodeId: string | null;
  onSelect: (node: NeutralNode) => void;
}

export function TabReaflow({ graph, selectedNodeId, onSelect }: TabProps) {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const nodes: NodeData[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        text: node.title,
        width: 180,
        height: 48,
      })),
    [graph],
  );

  const edges: EdgeData[] = useMemo(
    () =>
      graph.edges.map((edge, index) => ({
        id: `e-${index}-${edge.from}-${edge.to}`,
        from: edge.from,
        to: edge.to,
      })),
    [graph],
  );

  return (
    <div className="canvas-root">
      <Canvas
        nodes={nodes}
        edges={edges}
        direction="RIGHT"
        fit
        zoomable
        pannable
        maxZoom={2}
        minZoom={0.15}
        node={(nodeProps) => {
          const neutral = byId.get(nodeProps.id);
          const kind = neutral?.kind ?? 'artefato';
          const classes = ['graph-node', `graph-node--${kind}`];
          if (nodeProps.id === selectedNodeId) classes.push('graph-node--selected');

          return (
            <ReaflowNode
              {...nodeProps}
              onClick={() => {
                if (neutral) onSelect(neutral);
              }}
              style={{ fill: 'transparent', stroke: 'transparent' }}
            >
              {(event) => (
                <foreignObject width={event.width} height={event.height} style={{ pointerEvents: 'none' }}>
                  <div
                    className={classes.join(' ')}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxSizing: 'border-box',
                    }}
                  >
                    {neutral?.title ?? nodeProps.id}
                  </div>
                </foreignObject>
              )}
            </ReaflowNode>
          );
        }}
      />
    </div>
  );
}
