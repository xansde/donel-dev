import { useEffect, useMemo, useState } from 'react';
import grafoMesaRaw from '../../../.esteira/plano/pln-esteira4-catalogo-e-grafo/grafo-mesa.json';
import { parseEsteiraGrafo } from './adapter';
import { neutralToBench, type BenchGraph, type BenchNode } from './benchGraph';
import { planoReal } from './data/planoReal';
import { syntheticGraph } from './data/synthetic';
import { Criteria, type TabId } from './ui/Criteria';
import { NodeDetails } from './ui/NodeDetails';
import { TabForceSvg } from './tabs/TabForceSvg';
import { TabSigma } from './tabs/TabSigma';
import { TabReactFlow } from './tabs/TabReactFlow';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'A', label: 'A — d3-force + SVG próprio' },
  { id: 'B', label: 'B — sigma.js + graphology' },
  { id: 'C', label: 'C — React Flow (posições de d3-force)' },
];

type DatasetId = 'mesa' | 'plano-real' | 'sintetico';

const DATASETS: Array<{ id: DatasetId; label: string }> = [
  { id: 'mesa', label: 'Fluxo canônico (mesa)' },
  { id: 'plano-real', label: 'Plano real (com estados)' },
  { id: 'sintetico', label: 'Sintético (fps)' },
];

const ACTIVE_TAB_KEY = 'bancada-mapa-grafos:aba-ativa';
const DATASET_KEY = 'bancada-mapa-grafos:dataset';

function useMesaGraph(): BenchGraph {
  return useMemo(() => neutralToBench(parseEsteiraGrafo(grafoMesaRaw)), []);
}

export default function App() {
  const mesaGraph = useMesaGraph();

  const [dataset, setDataset] = useState<DatasetId>(() => {
    const stored = localStorage.getItem(DATASET_KEY);
    return stored === 'mesa' || stored === 'plano-real' || stored === 'sintetico' ? stored : 'plano-real';
  });

  const graph: BenchGraph = useMemo(() => {
    if (dataset === 'mesa') return mesaGraph;
    if (dataset === 'sintetico') return syntheticGraph;
    return planoReal;
  }, [dataset, mesaGraph]);

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    return stored === 'A' || stored === 'B' || stored === 'C' ? stored : 'A';
  });

  const [selectedNode, setSelectedNode] = useState<BenchNode | null>(null);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    setSelectedNode(null);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(DATASET_KEY, dataset);
    setSelectedNode(null);
  }, [dataset]);

  const showFps = dataset === 'sintetico';

  return (
    <div className="app">
      <header className="app-header">
        <h1>Bancada — protótipo do mapa de grafos</h1>
        <div className="provenance">
          item wi-esteira4-mapa-grafos-prototipo ·{' '}
          <a href="/mockup-referencia.html" target="_blank" rel="noreferrer">
            mockup de referência ↗
          </a>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-button${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div className="dataset-select">
          <label htmlFor="dataset">dataset</label>
          <select
            id="dataset"
            value={dataset}
            onChange={(event) => setDataset(event.target.value as DatasetId)}
          >
            {DATASETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </nav>

      <div className="main-grid">
        <section className="canvas-panel">
          <div className="canvas-hint">pan · zoom · clique seleciona nó · hover realça vizinhança</div>
          {activeTab === 'A' && (
            <TabForceSvg graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelect={setSelectedNode} showFps={showFps} />
          )}
          {activeTab === 'B' && (
            <TabSigma graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelect={setSelectedNode} showFps={showFps} />
          )}
          {activeTab === 'C' && (
            <TabReactFlow graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelect={setSelectedNode} showFps={showFps} />
          )}
        </section>

        <aside className="side-column">
          <Criteria tab={activeTab} />
          <NodeDetails node={selectedNode} />
        </aside>
      </div>
    </div>
  );
}
