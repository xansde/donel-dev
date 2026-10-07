import type { BenchNode } from '../benchGraph';

const STATE_LABEL: Record<BenchNode['state'], string> = {
  ok: 'concluído',
  run: 'rodando',
  wait: 'esperando você',
  block: 'travado',
  future: 'ainda não começou',
};

interface GraphTooltipProps {
  node: BenchNode;
  x: number;
  y: number;
}

/**
 * Tooltip flutuante (título + estado colorido + descrição) — reproduz o
 * `#tip` do mockup-v3.html (D-M4). Posição em pixels relativos ao container
 * do canvas; cada aba calcula `x`/`y` a partir do próprio sistema de
 * coordenadas (SVG, sigma, React Flow) e passa aqui já convertido.
 */
export function GraphTooltip({ node, x, y }: GraphTooltipProps) {
  return (
    <div className="graph-tooltip" style={{ left: x, top: y }}>
      <strong>{node.title}</strong>
      <span className={`graph-tooltip-state graph-tooltip-state--${node.state}`}>
        ● {STATE_LABEL[node.state]}
      </span>
      {node.desc ? <p>{node.desc}</p> : null}
    </div>
  );
}
