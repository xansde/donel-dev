import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type StylesheetJson } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { NeutralGraph, NeutralNode } from '../adapter';

cytoscape.use(dagre);

interface TabProps {
  graph: NeutralGraph;
  selectedNodeId: string | null;
  onSelect: (node: NeutralNode) => void;
}

// Cores lidas de var(--token) via getComputedStyle — nunca hex hardcoded.
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildStylesheet(): StylesheetJson {
  const border = readToken('--border');
  const bgRaised = readToken('--bg-raised');
  const textPrimary = readToken('--text-primary');
  const accent = readToken('--accent');
  const stateWaiting = readToken('--state-waiting');
  const textMuted = readToken('--text-muted');

  return [
    {
      selector: 'node',
      style: {
        'background-color': bgRaised,
        color: textPrimary,
        label: 'data(title)',
        'font-size': 10,
        'text-wrap': 'wrap',
        'text-max-width': '140px',
        'text-valign': 'center',
        'text-halign': 'center',
        shape: 'round-rectangle',
        width: 160,
        height: 44,
        'border-width': 1.5,
        'border-color': border,
      },
    },
    {
      selector: 'node[kind = "gate"]',
      style: {
        'border-width': 3,
        'border-style': 'double',
        'border-color': stateWaiting,
      },
    },
    {
      selector: 'node[kind = "fase"]',
      style: {
        'border-color': accent,
      },
    },
    {
      selector: 'node[kind = "artefato"]',
      style: {
        'border-color': textMuted,
        'corner-radius': '20',
      },
    },
    {
      selector: 'node[kind = "nota"]',
      style: {
        'border-style': 'dashed',
        'border-color': textMuted,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-color': accent,
        'border-width': 3,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': border,
        'target-arrow-color': border,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
      },
    },
  ];
}

export function TabCytoscape({ graph, selectedNodeId, onSelect }: TabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = [
      ...graph.nodes.map((node) => ({
        data: { id: node.id, title: node.title, kind: node.kind },
      })),
      ...graph.edges.map((edge, index) => ({
        data: { id: `e-${index}`, source: edge.from, target: edge.to },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: buildStylesheet(),
      layout: {
        name: 'dagre',
        // @ts-expect-error -- opções específicas do cytoscape-dagre
        rankDir: 'LR',
        nodeSep: 24,
        rankSep: 96,
      },
      minZoom: 0.2,
      maxZoom: 2.5,
    });

    cy.on('tap', 'node', (event) => {
      const nodeId = event.target.id() as string;
      const neutral = graph.nodes.find((n) => n.id === nodeId);
      if (neutral) onSelect(neutral);
    });

    cy.on('tap', (event) => {
      if (event.target === cy) {
        cy.elements().unselect();
      }
    });

    cy.on('dbltap', () => {
      cy.fit(undefined, 32);
    });

    cy.ready(() => {
      cy.fit(undefined, 32);
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, onSelect]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selectedNodeId) {
      cy.getElementById(selectedNodeId).select();
    }
  }, [selectedNodeId]);

  return (
    <div className="canvas-root">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button
        type="button"
        onClick={() => cyRef.current?.fit(undefined, 32)}
        style={{
          position: 'absolute',
          top: 'var(--space-1)',
          right: 'var(--space-1)',
          zIndex: 5,
        }}
      >
        fit
      </button>
    </div>
  );
}
