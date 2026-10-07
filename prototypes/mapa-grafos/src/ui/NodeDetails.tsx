import type { BenchNode } from '../benchGraph';

interface NodeDetailsProps {
  node: BenchNode | null;
}

const SIZE_LABEL: Record<BenchNode['size'], string> = {
  lg: 'Fase/Gate',
  md: 'Task',
  sm: 'Arquivo/Artefato',
};

const STATE_LABEL: Record<BenchNode['state'], string> = {
  ok: 'Concluído',
  run: 'Rodando',
  wait: 'Esperando você',
  block: 'Travado',
  future: 'Ainda não começou',
};

export function NodeDetails({ node }: NodeDetailsProps) {
  return (
    <div className="panel node-details">
      <h2>Nó selecionado</h2>
      {!node ? (
        <p className="node-details-empty">Clique em um nó do grafo para ver os detalhes.</p>
      ) : (
        <dl>
          <dt>Título</dt>
          <dd>{node.title}</dd>

          <dt>Tipo</dt>
          <dd>
            <span className={`kind-badge kind-badge--${node.size}`}>{SIZE_LABEL[node.size]}</span>
          </dd>

          <dt>Estado</dt>
          <dd>
            <span className={`state-badge state-badge--${node.state}`}>{STATE_LABEL[node.state]}</span>
          </dd>

          <dt>Descrição</dt>
          <dd>{node.desc ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}
