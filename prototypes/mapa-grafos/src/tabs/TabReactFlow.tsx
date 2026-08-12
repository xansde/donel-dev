import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { NeutralGraph, NeutralNode } from '../adapter';

interface TabProps {
  graph: NeutralGraph;
  selectedNodeId: string | null;
  onSelect: (node: NeutralNode) => void;
}

type FlowNodeData = {
  neutral: NeutralNode;
  selected: boolean;
};

function GraphNode({ data }: NodeProps) {
  const { neutral, selected } = data as unknown as FlowNodeData;
  const classes = ['graph-node', `graph-node--${neutral.kind}`];
  if (selected) classes.push('graph-node--selected');

  return (
    <div className={classes.join(' ')}>
      <Handle type="target" position={Position.Left} />
      {neutral.title}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = {
  graphNode: GraphNode,
};

const elk = new ELK();

const NODE_WIDTH = 180;
const NODE_HEIGHT = 44;

async function layoutWithElk(graph: NeutralGraph): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: graph.edges.map((edge, index) => ({
      id: `e-${index}-${edge.from}-${edge.to}`,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };

  const layout = await elk.layout(elkGraph);

  const positionById = new Map<string, { x: number; y: number }>();
  for (const child of layout.children ?? []) {
    positionById.set(child.id!, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'graphNode',
    position: positionById.get(node.id) ?? { x: 0, y: 0 },
    data: { neutral: node, selected: false } as unknown as Record<string, unknown>,
  }));

  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `e-${index}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
  }));

  return { nodes, edges };
}

function TabReactFlowInner({ graph, selectedNodeId, onSelect }: TabProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    layoutWithElk(graph).then((result) => {
      if (cancelled) return;
      setNodes(result.nodes);
      setEdges(result.edges);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  const nodesWithSelection = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...(node.data as unknown as FlowNodeData),
          selected: node.id === selectedNodeId,
        } as unknown as Record<string, unknown>,
      })),
    [nodes, selectedNodeId],
  );

  if (!ready) {
    return <div className="tab-placeholder">Calculando auto-layout (elkjs)...</div>;
  }

  return (
    <div className="canvas-root">
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_event, node) => {
          const neutral = (node.data as unknown as FlowNodeData).neutral;
          onSelect(neutral);
        }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
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
