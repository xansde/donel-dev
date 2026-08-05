import { Button } from '@donel-dev/design-system';
import { useEffect, useMemo, useState } from 'react';
import type { StoreSnapshot } from '../../../shared/esteira/store/storeFormat';
import type { MapSelection } from './esteiraMapView';
import { buildNodeGraph, type GraphNode, type GraphTone } from './nodeGraphView';
import styles from './NodeGraphOverlay.module.css';

// Spec 010 / batch N7 (D1) — o mapa de nós em TELA CHEIA. Componente burro de
// propósito: `nodeGraphView.ts` decide nó, aresta, coluna, desvio e resumo;
// aqui só se converte coluna em pixel (layout em camadas, à mão, sem
// biblioteca de grafo) e se desenha o SVG. Nenhuma frase de estado nasce
// neste arquivo — o mesmo defeito já reapareceu três vezes no repo por causa
// disso (ver cabeçalho de `nodeGraphView.ts`).
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

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 92;
const NODE_WIDTH = 208;
const NODE_HEIGHT = 64;
const PADDING = 48;

const TONE_VAR: Readonly<Record<GraphTone, string>> = {
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
  ok: 'var(--zone-ok)',
  warn: 'var(--state-waiting)',
  error: 'var(--state-permission)',
  lock: 'var(--state-error)',
};

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export function NodeGraphOverlay({ snapshot, onClose, onNavigate }: NodeGraphOverlayProps): React.JSX.Element {
  const view = useMemo(() => buildNodeGraph(snapshot), [snapshot]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Fecha em Esc, como qualquer overlay modal do app — próprio, porque a
  // sobreposição cobre a janela inteira (inclusive a titlebar) e não passa
  // por nenhum handler já existente de outra tela.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const clearHover = (key: string): void => setHoveredKey((current) => (current === key ? null : current));

  const nodesByColumn = useMemo(() => {
    const map = new Map<number, GraphNode[]>();
    for (const node of view.nodes) {
      const list = map.get(node.column) ?? [];
      list.push(node);
      map.set(node.column, list);
    }
    return map;
  }, [view.nodes]);

  const positionByKey = useMemo(() => {
    const map = new Map<string, NodePosition>();
    for (const [column, nodes] of nodesByColumn) {
      nodes.forEach((node, row) => {
        map.set(node.key, { x: PADDING + column * COLUMN_WIDTH, y: PADDING + row * ROW_HEIGHT });
      });
    }
    return map;
  }, [nodesByColumn]);

  const maxRows = Math.max(1, ...[...nodesByColumn.values()].map((nodes) => nodes.length));
  const width = PADDING * 2 + Math.max(1, view.columns) * COLUMN_WIDTH - (COLUMN_WIDTH - NODE_WIDTH);
  const height = PADDING * 2 + maxRows * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT);

  const hovered = hoveredKey === null ? null : (view.nodes.find((node) => node.key === hoveredKey) ?? null);

  return (
    <div className={styles.overlay} role="dialog" aria-label="Mapa de nós" data-testid="node-graph-overlay">
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

      {view.empty ? (
        <p className={styles.empty} data-testid="node-graph-empty">
          {view.empty}
        </p>
      ) : (
        <>
          <div className={styles.canvas}>
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafo de nós da Esteira">
              <g aria-hidden="true">
                {view.edges.map((edge) => {
                  const from = positionByKey.get(edge.from);
                  const to = positionByKey.get(edge.to);
                  if (!from || !to) return null;
                  const x1 = from.x + NODE_WIDTH;
                  const y1 = from.y + NODE_HEIGHT / 2;
                  const x2 = to.x;
                  const y2 = to.y + NODE_HEIGHT / 2;
                  const midX = (x1 + x2) / 2;
                  return (
                    <path
                      key={edge.key}
                      d={`M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`}
                      className={styles.edge}
                      data-kind={edge.kind}
                    >
                      <title>{edge.label}</title>
                    </path>
                  );
                })}
              </g>
              <g>
                {view.nodes.map((node) => {
                  const pos = positionByKey.get(node.key);
                  if (!pos) return null;
                  return (
                    <g
                      key={node.key}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.title} — ${node.summary}`}
                      className={styles.node}
                      data-testid="node-graph-node"
                      data-kind={node.kind}
                      data-key={node.key}
                      data-deviation={node.deviation ? 'true' : 'false'}
                      onMouseEnter={() => setHoveredKey(node.key)}
                      onMouseLeave={() => clearHover(node.key)}
                      onFocus={() => setHoveredKey(node.key)}
                      onBlur={() => clearHover(node.key)}
                      onClick={() => onNavigate(node.navigateTo)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onNavigate(node.navigateTo);
                        }
                      }}
                    >
                      <rect
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx={8}
                        className={[styles.nodeBox, node.deviation ? styles.nodeBoxDeviation : ''].filter(Boolean).join(' ')}
                        style={{ ['--node-tone' as string]: TONE_VAR[node.tone] }}
                      />
                      <text className={styles.nodeTitle} x={12} y={24}>
                        {truncate(node.title, 26)}
                      </text>
                      <text className={styles.nodeBadge} x={12} y={42}>
                        {truncate(node.badge, 30)}
                      </text>
                      {node.deviation ? (
                        <text className={styles.nodeDeviation} x={12} y={58}>
                          ⚠ {truncate(node.deviation.label, 26)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
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
      )}
    </div>
  );
}
