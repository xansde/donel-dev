import type { NeutralNode } from '../adapter';

interface NodeDetailsProps {
  node: NeutralNode | null;
}

const KIND_LABEL: Record<NeutralNode['kind'], string> = {
  gate: 'Gate',
  fase: 'Fase',
  artefato: 'Artefato',
  nota: 'Nota',
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
            <span className={`kind-badge kind-badge--${node.kind}`}>{KIND_LABEL[node.kind]}</span>
          </dd>

          <dt>Handoff</dt>
          <dd>{node.handoff ?? '—'}</dd>

          <dt>Nota</dt>
          <dd>{node.note ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}
