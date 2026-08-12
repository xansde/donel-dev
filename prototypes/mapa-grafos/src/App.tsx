import { useEffect, useMemo, useState } from 'react';
import grafoMesaRaw from '../../../.esteira/plano/pln-esteira4-catalogo-e-grafo/grafo-mesa.json';
import { parseEsteiraGrafo, type NeutralNode } from './adapter';
import { Criteria, type TabId } from './ui/Criteria';
import { NodeDetails } from './ui/NodeDetails';
import { TabReactFlow } from './tabs/TabReactFlow';
import { TabCytoscape } from './tabs/TabCytoscape';
import { TabReaflow } from './tabs/TabReaflow';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'A', label: 'A — React Flow retrabalhado' },
  { id: 'B', label: 'B — Cytoscape.js' },
  { id: 'C', label: 'C — Reaflow' },
];

const ACTIVE_TAB_KEY = 'bancada-mapa-grafos:aba-ativa';

export default function App() {
  const graph = useMemo(() => parseEsteiraGrafo(grafoMesaRaw), []);

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    return stored === 'A' || stored === 'B' || stored === 'C' ? stored : 'A';
  });

  const [selectedNode, setSelectedNode] = useState<NeutralNode | null>(null);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    setSelectedNode(null);
  }, [activeTab]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Bancada — protótipo do mapa de grafos</h1>
        <div className="provenance">item wi-esteira4-mapa-grafos-prototipo</div>
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
      </nav>

      <div className="main-grid">
        <section className="canvas-panel">
          <div className="canvas-hint">pan · zoom · clique seleciona nó · fit-view</div>
          {activeTab === 'A' && (
            <TabReactFlow graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelect={setSelectedNode} />
          )}
          {activeTab === 'B' && (
            <TabCytoscape graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelect={setSelectedNode} />
          )}
          {activeTab === 'C' && (
            <TabReaflow graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelect={setSelectedNode} />
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
