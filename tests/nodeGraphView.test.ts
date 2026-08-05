import { describe, expect, it } from 'vitest';
import { buildNodeGraph, NODE_GRAPH_EMPTY } from '../src/renderer/src/DevMode/nodeGraphView';
import { cardView, itemMeta, verificationLines } from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 / batch N7 (D1) — o mapa de nós é OUTRA projeção do mesmo snapshot
// que `esteiraMapView.test.ts` já cobre para o carrossel. Este arquivo cobre a
// PROJEÇÃO EM GRAFO: nós, arestas e desvios — a forma de tela (SVG, hover,
// clique) mora no componente e não tem teste aqui de propósito (é
// encanamento; a decisão está toda nesta função pura).

let seq = 0;
function evt(type: string, payload: Record<string, unknown>, at = '2026-08-05T09:00:00.000Z'): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at, type, source: { kind: 'app' }, dedupe_key: null, payload };
}

function snapshotDe(events: readonly StoreEvent[]) {
  return reduceEvents(events);
}

/** Um discovery com plano e item — o esqueleto que a maioria dos casos usa. */
function eventosBase(): StoreEvent[] {
  return [
    evt('discovery.created', { id: 'dsc-1', title: 'Fila de importação trava sem sinal', targetRepo: 'donel-dev' }),
    evt('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: '2026-08-05T09:10:00.000Z' }),
    evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Instrumentar a fila' }),
    evt('work_item.created', {
      id: 'wki-1',
      discoveryId: 'dsc-1',
      planId: 'pln-1',
      itemType: 'issue',
      title: 'Expor o estado da fila no endpoint de saúde',
      createdBySkill: true,
    }),
  ];
}

describe('buildNodeGraph — o vazio honesto', () => {
  it('sem snapshot nenhum, o grafo não inventa nó', () => {
    const view = buildNodeGraph(null);
    expect(view.nodes).toHaveLength(0);
    expect(view.edges).toHaveLength(0);
    expect(view.columns).toBe(0);
    expect(view.empty).toBe(NODE_GRAPH_EMPTY);
  });

  it('snapshot vazio (nenhum discovery) diz que ele NASCE limpo', () => {
    const view = buildNodeGraph(snapshotDe([]));
    expect(view.nodes).toHaveLength(0);
    expect(view.empty).toBe(NODE_GRAPH_EMPTY);
  });
});

describe('buildNodeGraph — nós e arestas do esqueleto discovery → plano → item', () => {
  it('os três nós existem, com os tipos certos', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    expect(view.empty).toBeNull();
    const kinds = view.nodes.map((node) => `${node.kind}:${node.key}`).sort();
    expect(kinds).toEqual(['discovery:discovery:dsc-1', 'plan:plan:pln-1', 'work_item:work_item:wki-1']);
  });

  it('os títulos são os do modelo — nunca o id cru (F5)', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    const discovery = view.nodes.find((node) => node.kind === 'discovery')!;
    const plan = view.nodes.find((node) => node.kind === 'plan')!;
    const item = view.nodes.find((node) => node.kind === 'work_item')!;
    expect(discovery.title).toBe('Fila de importação trava sem sinal');
    expect(plan.title).toBe('Instrumentar a fila');
    expect(item.title).toBe('Expor o estado da fila no endpoint de saúde');
    // Invariante geral: NENHUM título de NENHUM nó começa com um id cru do modelo.
    for (const node of view.nodes) {
      expect(node.title).not.toMatch(/^(dsc|pln|wi|wki)-/);
    }
  });

  it('as arestas estruturais existem, rotuladas "originou"', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    const discoveryToPlan = view.edges.find((edge) => edge.from === 'discovery:dsc-1' && edge.to === 'plan:pln-1');
    const planToItem = view.edges.find((edge) => edge.from === 'plan:pln-1' && edge.to === 'work_item:wki-1');
    expect(discoveryToPlan).toMatchObject({ kind: 'originated', label: 'originou' });
    expect(planToItem).toMatchObject({ kind: 'originated', label: 'originou' });
  });

  it('a coluna é a profundidade da BFS a partir do discovery', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    const byKey = new Map(view.nodes.map((node) => [node.key, node]));
    expect(byKey.get('discovery:dsc-1')?.column).toBe(0);
    expect(byKey.get('plan:pln-1')?.column).toBe(1);
    expect(byKey.get('work_item:wki-1')?.column).toBe(2);
    expect(view.columns).toBe(3);
  });

  it('o item traz tipo · ciclo · estado no rótulo curto', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    const item = view.nodes.find((node) => node.kind === 'work_item')!;
    expect(item.badge).toContain('issue');
    expect(item.badge).toContain('aberto');
  });

  it('o resumo do item é a MESMA frase que o resto do app usa (itemMeta) — nenhuma segunda redação', () => {
    const snapshot = snapshotDe(eventosBase());
    const view = buildNodeGraph(snapshot);
    const card = cardView(snapshot, 'dsc-1')!;
    const item = card.items[0];
    const node = view.nodes.find((entry) => entry.kind === 'work_item')!;
    expect(node.summary).toBe(itemMeta(item, card.discovery, null));
  });
});

describe('buildNodeGraph — desvio: item sem plano', () => {
  function eventosComOrfao(): StoreEvent[] {
    return [
      ...eventosBase(),
      evt('work_item.created', { id: 'wki-orfao', discoveryId: 'dsc-1', itemType: 'spike', title: 'Medir onde o lote para' }),
    ];
  }

  it('o item órfão fica UMA coluna mais perto do discovery que os irmãos com plano', () => {
    const view = buildNodeGraph(snapshotDe(eventosComOrfao()));
    const byKey = new Map(view.nodes.map((node) => [node.key, node]));
    // Com plano: discovery(0) → plano(1) → item(2).
    expect(byKey.get('work_item:wki-1')?.column).toBe(2);
    // Órfão: discovery(0) → item(1) direto — o atalho estrutural que a BFS enxerga sozinha.
    expect(byKey.get('work_item:wki-orfao')?.column).toBe(1);
  });

  it('o item órfão carrega o desvio sinalizado', () => {
    const view = buildNodeGraph(snapshotDe(eventosComOrfao()));
    const orfao = view.nodes.find((node) => node.key === 'work_item:wki-orfao')!;
    expect(orfao.deviation).not.toBeNull();
    expect(orfao.deviation?.label).toContain('sem plano');
    expect(orfao.tone).toBe('warn');
  });

  it('o item COM plano não carrega desvio nenhum', () => {
    const view = buildNodeGraph(snapshotDe(eventosComOrfao()));
    const comPlano = view.nodes.find((node) => node.key === 'work_item:wki-1')!;
    expect(comPlano.deviation).toBeNull();
  });

  it('a aresta do órfão sai direto do discovery, não de um plano fantasma', () => {
    const view = buildNodeGraph(snapshotDe(eventosComOrfao()));
    const aresta = view.edges.find((edge) => edge.to === 'work_item:wki-orfao');
    expect(aresta?.from).toBe('discovery:dsc-1');
    expect(aresta?.kind).toBe('originated');
  });
});

describe('buildNodeGraph — artefatos são nós-folha', () => {
  function eventosComArtefato(): StoreEvent[] {
    return [
      ...eventosBase(),
      evt('artifact.pinned', {
        owner: { entity: 'work_item', id: 'wki-1' },
        artifactKind: 'spec',
        location: 'repo',
        repo: 'atlas',
        path: 'specs/031-fila-observavel/spec.md',
      }),
    ];
  }

  it('o artefato vira nó próprio, uma coluna depois do dono', () => {
    const view = buildNodeGraph(snapshotDe(eventosComArtefato()));
    const item = view.nodes.find((node) => node.kind === 'work_item')!;
    const artefato = view.nodes.find((node) => node.kind === 'artifact')!;
    expect(artefato).toBeDefined();
    expect(artefato.column).toBe(item.column + 1);
    expect(artefato.title).toBe('spec'); // humano (categoria), nunca o path cru como título
    expect(artefato.summary).toContain('specs/031-fila-observavel/spec.md');
  });

  it('nenhuma aresta SAI de um nó de artefato — é folha de verdade', () => {
    const view = buildNodeGraph(snapshotDe(eventosComArtefato()));
    const artefato = view.nodes.find((node) => node.kind === 'artifact')!;
    expect(view.edges.some((edge) => edge.from === artefato.key)).toBe(false);
  });

  it('clicar no artefato navega para o ITEM dono, não para um nó que o carrossel não sabe focar', () => {
    const view = buildNodeGraph(snapshotDe(eventosComArtefato()));
    const item = view.nodes.find((node) => node.kind === 'work_item')!;
    const artefato = view.nodes.find((node) => node.kind === 'artifact')!;
    expect(artefato.navigateTo).toEqual(item.navigateTo);
    expect(artefato.navigateTo.itemId).toBe('wki-1');
  });
});

describe('buildNodeGraph — verificações fecham o ciclo', () => {
  function eventosComVerificacoes(): StoreEvent[] {
    return [
      ...eventosBase(),
      evt('verification.updated', {
        subject: { entity: 'work_item', id: 'wki-1' },
        verificationKind: 'pull-request',
        state: 'passed',
        ref: 'https://github.com/exemplo/atlas/pull/128',
      }),
      evt('verification.updated', {
        subject: { entity: 'work_item', id: 'wki-1' },
        verificationKind: 'review',
        state: 'failed',
        ref: 'pediu mudança',
      }),
    ];
  }

  it('cada verificação vira um nó, com o MESMO texto de verificationLines', () => {
    const snapshot = snapshotDe(eventosComVerificacoes());
    const view = buildNodeGraph(snapshot);
    const card = cardView(snapshot, 'dsc-1')!;
    const linhas = verificationLines(card);

    const nos = view.nodes.filter((node) => node.kind === 'verification');
    expect(nos).toHaveLength(2);
    for (const linha of linhas) {
      const no = nos.find((entry) => entry.summary === linha.text);
      expect(no).toBeDefined();
    }
  });

  it('a verificação que falhou carrega desvio e tom de erro; a que passou não carrega', () => {
    const view = buildNodeGraph(snapshotDe(eventosComVerificacoes()));
    const passou = view.nodes.find((node) => node.kind === 'verification' && node.badge === 'passou')!;
    const falhou = view.nodes.find((node) => node.kind === 'verification' && node.badge === 'falhou')!;
    expect(passou.deviation).toBeNull();
    expect(passou.tone).toBe('ok');
    expect(falhou.deviation).not.toBeNull();
    expect(falhou.tone).toBe('error');
  });

  it('nenhuma aresta SAI de um nó de verificação — é o fecho do ciclo', () => {
    const view = buildNodeGraph(snapshotDe(eventosComVerificacoes()));
    for (const node of view.nodes.filter((entry) => entry.kind === 'verification')) {
      expect(view.edges.some((edge) => edge.from === node.key)).toBe(false);
    }
  });
});

describe('buildNodeGraph — relações explícitas do contrato', () => {
  function eventosComRelacao(): StoreEvent[] {
    return [
      ...eventosBase(),
      evt('work_item.created', { id: 'wki-2', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'issue', title: 'Consumir o estado no painel', createdBySkill: true }),
      evt('relation.added', { relation: 'flows_into', from: { entity: 'work_item', id: 'wki-1' }, to: { entity: 'work_item', id: 'wki-2' } }),
    ];
  }

  it('a relação flows_into vira aresta própria, rotulada em português', () => {
    const view = buildNodeGraph(snapshotDe(eventosComRelacao()));
    const aresta = view.edges.find((edge) => edge.kind === 'flows_into');
    expect(aresta).toMatchObject({ from: 'work_item:wki-1', to: 'work_item:wki-2', label: 'deságua em' });
  });

  it('uma relação "originated" explícita que repete a estrutural não vira DUAS arestas', () => {
    const events = [
      ...eventosBase(),
      evt('relation.added', { relation: 'originated', from: { entity: 'discovery', id: 'dsc-1' }, to: { entity: 'plan', id: 'pln-1' } }),
    ];
    const view = buildNodeGraph(snapshotDe(events));
    const arestas = view.edges.filter((edge) => edge.from === 'discovery:dsc-1' && edge.to === 'plan:pln-1');
    expect(arestas).toHaveLength(1);
  });

  it('relação apontando para uma entidade que não existe no snapshot não vira aresta pendurada', () => {
    const events = [
      ...eventosBase(),
      evt('relation.added', { relation: 'flows_into', from: { entity: 'work_item', id: 'wki-1' }, to: { entity: 'work_item', id: 'wki-fantasma' } }),
    ];
    const view = buildNodeGraph(snapshotDe(events));
    expect(view.edges.some((edge) => edge.to === 'work_item:wki-fantasma')).toBe(false);
  });
});

describe('buildNodeGraph — vários discoveries', () => {
  it('cada discovery é sua própria raiz na coluna 0, com o próprio subgrafo', () => {
    const events = [...eventosBase(), evt('discovery.created', { id: 'dsc-2', title: 'Outro problema' })];
    const view = buildNodeGraph(snapshotDe(events));
    const discoveries = view.nodes.filter((node) => node.kind === 'discovery');
    expect(discoveries).toHaveLength(2);
    expect(discoveries.every((node) => node.column === 0)).toBe(true);
  });
});

describe('buildNodeGraph — navegação (a mesma seleção que o carrossel já usa)', () => {
  it('o nó do discovery navega só até o discovery', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    const discovery = view.nodes.find((node) => node.kind === 'discovery')!;
    expect(discovery.navigateTo).toEqual({ discoveryId: 'dsc-1', planId: null, itemId: null, nodeKey: 'discovery:dsc-1', phase: null });
  });

  it('o nó do item navega com discovery + plano + item preenchidos', () => {
    const view = buildNodeGraph(snapshotDe(eventosBase()));
    const item = view.nodes.find((node) => node.kind === 'work_item')!;
    expect(item.navigateTo).toEqual({ discoveryId: 'dsc-1', planId: 'pln-1', itemId: 'wki-1', nodeKey: 'work_item:wki-1', phase: null });
  });
});
