import { Button } from '@donel-dev/design-system';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Compass, FileText, ListTree, ShieldCheck, SquareCheck, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StoreSnapshot } from '../../../shared/esteira/store/storeFormat';
import type { MapSelection } from './esteiraMapView';
import { LAYOUT_NODE_HEIGHT, LAYOUT_NODE_WIDTH, layoutNodeGraph } from './nodeGraphLayout';
import { buildNodeGraph, type GraphEdgeKind, type GraphNode, type GraphNodeKind, type GraphTone, type NodeGraphView } from './nodeGraphView';
import styles from './NodeGraphOverlay.module.css';

// Spec 010 / batch F25 (D1) — refeitura da CAMADA VISUAL do mapa de nós.
// Veredito do dono sobre a versão anterior (overlay SVG à mão, batch N7):
// "Feio. Não navega corretamente. Difícil de identificar o mapa." Esta
// versão troca o desenho à mão por `@xyflow/react` (motor node-based real,
// autorizado pelo dono) — pan/zoom, minimapa e controles de verdade — sem
// tocar a PROJEÇÃO (`nodeGraphView.ts`, 24 testes) nem o CÁLCULO de layout
// (`nodeGraphLayout.ts`, layout em camadas feito à mão, sem dagre/elkjs).
//
// Nenhuma frase de estado nasce neste arquivo — o mesmo defeito já reapareceu
// três vezes no repo por causa disso (ver cabeçalho de `nodeGraphView.ts`).
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

const TONE_VAR: Readonly<Record<GraphTone, string>> = {
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
  ok: 'var(--zone-ok)',
  warn: 'var(--state-waiting)',
  error: 'var(--state-permission)',
  lock: 'var(--state-error)',
};

/** Ícone por tipo — a resposta a "difícil de identificar o que é o quê" (veredito do dono): cor de borda sozinha nunca basta. */
const KIND_ICON: Readonly<Record<GraphNodeKind, LucideIcon>> = {
  discovery: Compass,
  plan: ListTree,
  work_item: SquareCheck,
  artifact: FileText,
  verification: ShieldCheck,
};

/** Legenda compacta — mesmo vocabulário de tipo que o resto do mapa usa, nunca uma segunda redação. */
const KIND_LABEL: Readonly<Record<GraphNodeKind, string>> = {
  discovery: 'Discovery',
  plan: 'Plano',
  work_item: 'Item',
  artifact: 'Artefato',
  verification: 'Verificação',
};

const KIND_ORDER: readonly GraphNodeKind[] = ['discovery', 'plan', 'work_item', 'artifact', 'verification'];

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface GraphNodeData extends Record<string, unknown> {
  readonly graphNode: GraphNode;
  readonly hovered: boolean;
  readonly onHoverChange: (key: string | null) => void;
}

/**
 * Nó custom ÚNICO que se comporta como "um por tipo" (ícone, cor de borda e
 * badge mudam com `data.graphNode.kind`) em vez de cinco componentes quase
 * idênticos — o que muda entre discovery/plano/item/artefato/verificação é
 * dado (`GraphNode`), não estrutura. Registrado em `nodeTypes` sob as 5
 * chaves de `GraphNodeKind` (ver mais abaixo) para o React Flow rotear por
 * tipo como o motor espera.
 */
function GraphNodeCard({ data }: { data: GraphNodeData }): React.JSX.Element {
  const { graphNode: node, hovered, onHoverChange } = data;
  const Icon = KIND_ICON[node.kind];

  return (
    <div
      className={[styles.node, node.deviation ? styles.nodeDeviation : ''].filter(Boolean).join(' ')}
      style={{ ['--node-tone' as string]: TONE_VAR[node.tone] }}
      role="button"
      tabIndex={0}
      aria-label={`${node.title} — ${node.summary}`}
      data-testid="node-graph-node"
      data-kind={node.kind}
      data-key={node.key}
      data-deviation={node.deviation ? 'true' : 'false'}
      onMouseEnter={() => onHoverChange(node.key)}
      onMouseLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(node.key)}
      onBlur={() => onHoverChange(null)}
    >
      <div className={styles.nodeHeader}>
        <Icon size={13} strokeWidth={1.75} aria-hidden />
        <span className={styles.nodeTitle}>{truncate(node.title, 28)}</span>
      </div>
      <span className={styles.nodeBadge}>{truncate(node.badge, 34)}</span>
      {node.deviation ? <span className={styles.nodeDeviationLabel}>⚠ {truncate(node.deviation.label, 28)}</span> : null}
      {hovered ? <span className={styles.nodeHoverHint}>Enter/clique para ir até aqui</span> : null}
    </div>
  );
}

// As 5 chaves precisam existir em `nodeTypes` para o React Flow aceitar
// `type: node.kind` em cada `Node` — todas apontam pro MESMO componente
// (decisão acima), então uma única função basta; `nodeTypes` fixo fora do
// componente evita o warning do React Flow de "nodeTypes recriado a cada render".
const NODE_TYPES: NodeTypes = {
  discovery: GraphNodeCard,
  plan: GraphNodeCard,
  work_item: GraphNodeCard,
  artifact: GraphNodeCard,
  verification: GraphNodeCard,
} as unknown as NodeTypes;

const EDGE_LATERAL_KINDS: ReadonlySet<GraphEdgeKind> = new Set(['flows_into', 'ships_with']);

function NodeGraphCanvas({
  view,
  onNavigate,
}: {
  view: NodeGraphView;
  onNavigate: (target: MapSelection) => void;
}): React.JSX.Element {
  const layout = useMemo(() => layoutNodeGraph(view.nodes), [view.nodes]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const nodes: Node[] = useMemo(
    () =>
      layout.nodes.map(({ node, position }): Node => {
        const data: GraphNodeData = { graphNode: node, hovered: hoveredKey === node.key, onHoverChange: setHoveredKey };
        return {
          id: node.key,
          type: node.kind,
          position,
          data,
          width: LAYOUT_NODE_WIDTH,
          height: LAYOUT_NODE_HEIGHT,
          draggable: false,
          connectable: false,
        };
      }),
    [layout.nodes, hoveredKey],
  );

  const edges: Edge[] = useMemo(
    () =>
      view.edges.map((edge): Edge => ({
        id: edge.key,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        type: 'smoothstep',
        className: EDGE_LATERAL_KINDS.has(edge.kind) ? styles.edgeLateral : styles.edge,
        labelBgStyle: { fill: 'var(--bg-panel)' },
        labelStyle: { fill: 'var(--text-muted)', fontSize: 10 },
      })),
    [view.edges],
  );

  const hovered = hoveredKey === null ? null : (view.nodes.find((node) => node.key === hoveredKey) ?? null);

  const handleNodeClick: NodeMouseHandler = (_event, rfNode) => {
    const found = view.nodes.find((node) => node.key === rfNode.id);
    if (found) onNavigate(found.navigateTo);
  };

  if (view.empty) {
    return (
      <p className={styles.empty} data-testid="node-graph-empty">
        {view.empty}
      </p>
    );
  }

  return (
    <>
      <div className={styles.canvas} data-testid="node-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} className={styles.background} />
          <Controls showInteractive={false} className={styles.controls} />
          <MiniMap
            className={styles.minimap}
            pannable
            zoomable
            nodeColor={(node) => {
              const data = node.data as GraphNodeData;
              return TONE_VAR[data.graphNode.tone];
            }}
            maskColor="rgba(14, 17, 22, 0.75)"
          />
          {/* Legenda compacta — a resposta direta a "difícil de identificar o mapa" (veredito do dono). */}
          <Panel position="top-left" className={styles.legend} data-testid="node-graph-legend">
            {KIND_ORDER.map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <span key={kind} className={styles.legendItem}>
                  <Icon size={12} strokeWidth={1.75} aria-hidden />
                  {KIND_LABEL[kind]}
                </span>
              );
            })}
          </Panel>
        </ReactFlow>
      </div>

      <footer className={styles.infoBar} data-testid="node-graph-hover-summary">
        {hovered ? (
          <p className={styles.infoLine}>
            <strong>{hovered.title}</strong>
            <span> — {hovered.summary}</span>
          </p>
        ) : (
          <p className={styles.infoHint}>Passe o mouse (ou o foco) sobre um nó para ver o resumo. Clique para ir até ele.</p>
        )}
      </footer>
    </>
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
        // passa por nenhum handler já existente de outra tela. React Flow
        // captura teclado para pan/zoom, então o listener fica no wrapper
        // (fase de bubble) em vez de `window`, para nunca perder o Esc.
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

      {/* `ReactFlowProvider` isolado deste componente (não do app inteiro): o
          mapa de nós é a única tela que usa React Flow, e o overlay
          monta/desmonta inteiro a cada abertura — não há estado do motor
          para preservar entre uma sessão do overlay e outra. */}
      <ReactFlowProvider>
        <NodeGraphCanvas view={view} onNavigate={onNavigate} />
      </ReactFlowProvider>
    </div>
  );
}
