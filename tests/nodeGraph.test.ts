import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { beginNodeGesture, CLICK_DRAG_THRESHOLD_PX, gestureNavigates, trackNodeGesture } from '../src/renderer/src/DevMode/nodeGraphGesture';
import { COLUMN_WIDTH, createNodeGraphSimulation, RADIUS_BY_KIND, TONE_CLASS } from '../src/renderer/src/DevMode/nodeGraphForce';
import { buildNodeGraph, NODE_GRAPH_EMPTY, type GraphEdge, type GraphNode, type GraphTone } from '../src/renderer/src/DevMode/nodeGraphView';
import { cardView, itemMeta, verificationLines } from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

describe('nodeGraphClickNavigation', () => {
  // 012 Esteira 4.0 / wi-esteira4-mapa-grafos — o achado bloqueante do e2e de
  // 12/08 (`.e2e-visual/mapa-de-nos/relatorio.html`): clicar num nó NÃO
  // navegava. `handleNodePointerDown` capturava o pointer no `svg`
  // (`svgRef.current?.setPointerCapture`); com a captura no ancestral, o
  // `pointerup` era reentregue ao svg e o evento `click` nascia lá — o `onClick`
  // do `<g>` do nó nunca disparava (D-M4 quebrada). Hover, tooltip, drag e pan
  // funcionavam, por isso os 2203 testes verdes não viram.
  //
  // Duas travas aqui:
  // 1. O gesto clique×drag é decisão PURA (`nodeGraphGesture.ts`): arrastar um
  //    nó não pode virar navegação só porque o click agora dispara no `<g>`.
  // 2. A captura é no PRÓPRIO `<g>` (`event.currentTarget`), nunca no svg —
  //    trava de fonte, no mesmo espírito do contrato classe×CSS
  //    (`nodeGraphStateClasses.test.ts`): o defeito era invisível a teste de
  //    comportamento puro, então o contrato estrutural é assertado direto.
  // O comportamento ponta a ponta (clique fecha o overlay e navega) é do
  // roteiro `mapa-de-nos.spec.ts`, que reprovou e agora prova.


  describe('nodeGraphGesture — clique navega, drag não', () => {
    it('apertar e soltar sem mover é clique — navega', () => {
      const gesture = beginNodeGesture(100, 100);
      expect(gestureNavigates(gesture)).toBe(true);
    });

    it('jitter abaixo do threshold continua sendo clique (mão de gente treme)', () => {
      let gesture = beginNodeGesture(100, 100);
      gesture = trackNodeGesture(gesture, 101, 102);
      expect(gestureNavigates(gesture)).toBe(true);
    });

    it('mover além do threshold é drag — soltar em cima do nó NÃO navega', () => {
      let gesture = beginNodeGesture(100, 100);
      gesture = trackNodeGesture(gesture, 100 + CLICK_DRAG_THRESHOLD_PX + 1, 100);
      expect(gestureNavigates(gesture)).toBe(false);
    });

    it('drag que volta ao ponto de partida segue sendo drag — moved não desmarca', () => {
      let gesture = beginNodeGesture(100, 100);
      gesture = trackNodeGesture(gesture, 160, 140);
      gesture = trackNodeGesture(gesture, 100, 100);
      expect(gestureNavigates(gesture)).toBe(false);
    });

    it('sem gesto de pointer (foco por teclado, Enter/Espaço) a navegação é livre', () => {
      expect(gestureNavigates(null)).toBe(true);
    });

    it('o threshold distingue de verdade: só o drag vira drag', () => {
      const clique = trackNodeGesture(beginNodeGesture(0, 0), 2, 2);
      const drag = trackNodeGesture(beginNodeGesture(0, 0), 30, 0);
      expect(gestureNavigates(clique)).toBe(true);
      expect(gestureNavigates(drag)).toBe(false);
    });
  });

  describe('NodeGraphOverlay — a captura do pointer no drag de nó é no próprio <g>', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/DevMode/NodeGraphOverlay.tsx', import.meta.url)),
      'utf-8',
    );

    it('nenhuma captura vai para o svg por ref — foi ela que matou o click do nó', () => {
      expect(source).not.toContain('svgRef.current?.setPointerCapture');
      expect(source).not.toContain('svgRef.current.setPointerCapture');
    });

    it('handleNodePointerDown captura em event.currentTarget (o <g> do nó)', () => {
      const start = source.indexOf('function handleNodePointerDown');
      expect(start, 'handleNodePointerDown sumiu — atualize esta trava junto com o componente').toBeGreaterThanOrEqual(0);
      const end = source.indexOf('function ', start + 1);
      const handler = source.slice(start, end === -1 ? undefined : end);
      expect(handler).toContain('event.currentTarget.setPointerCapture');
    });
  });
});

describe('nodeGraphForce', () => {
  // 012 Esteira 4.0 / wi-esteira4-mapa-grafos — a física do mapa novo (motor A,
  // d3-force + SVG próprio, ratificado em `specs/012-esteira-4/mapa-grafos-escolha.md`).
  //
  // O que se trava aqui:
  // - D-M1: viés horizontal por profundidade — o tempo corre da esquerda para a
  //   direita; a posição nasce de simulação, nunca de coordenada à mão.
  // - Divergência 1 do diagrama (`mapa-grafos-arquitetura.md`): a profundidade é
  //   o `column` (BFS) que `nodeGraphView.ts` já entrega — este módulo NÃO
  //   recalcula profundidade (o `computeDepth` da bancada não foi portado).
  // - D-M3: raios por tipo — fase/gate grande, task média, artefato/verificação
  //   pequenos (satélites).
  // - Aviso 1 herdado da bancada (StrictMode): a simulação nasce PARADA; quem
  //   monta o componente decide quando dar `restart()` dentro do effect — a
  //   simulação descartada pelo double-mount nunca roda ticks órfãos.


  function node(key: string, column: number, kind: GraphNode['kind'] = 'work_item'): GraphNode {
    return {
      key,
      kind,
      title: `Nó ${key}`,
      badge: 'badge',
      summary: 'resumo',
      tone: 'muted',
      deviation: null,
      column,
      navigateTo: { discoveryId: 'dsc-1', planId: null, itemId: null, nodeKey: key, phase: null },
    };
  }

  function edge(from: string, to: string): GraphEdge {
    return { key: `originated|${from}|${to}`, kind: 'originated', label: 'originou', from, to };
  }

  describe('RADIUS_BY_KIND (D-M3)', () => {
    it('fase/gate (discovery, plano) são os nós grandes; task é média; artefato e verificação são satélites pequenos', () => {
      expect(RADIUS_BY_KIND.discovery).toBe(RADIUS_BY_KIND.plan);
      expect(RADIUS_BY_KIND.artifact).toBe(RADIUS_BY_KIND.verification);
      expect(RADIUS_BY_KIND.discovery).toBeGreaterThan(RADIUS_BY_KIND.work_item);
      expect(RADIUS_BY_KIND.work_item).toBeGreaterThan(RADIUS_BY_KIND.artifact);
    });
  });

  describe('createNodeGraphSimulation', () => {
    it('nasce PARADA: nenhum tick roda sozinho depois da criação (aviso StrictMode da bancada)', async () => {
      const sim = createNodeGraphSimulation([node('a', 0), node('b', 1)], [edge('a', 'b')]);
      const before = sim.nodes.map((n) => [n.x, n.y]);
      // d3-force auto-inicia por timer (~17ms por tick); 80ms parados provam o stop.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(sim.nodes.map((n) => [n.x, n.y])).toEqual(before);
    });

    it('D-M1: depois de estabilizar, a profundidade vira ordem horizontal (x cresce com o column)', () => {
      const sim = createNodeGraphSimulation(
        [node('a', 0, 'discovery'), node('b', 1, 'plan'), node('c', 2)],
        [edge('a', 'b'), edge('b', 'c')],
      );
      for (let i = 0; i < 300; i += 1) sim.simulation.tick();
      const x = new Map(sim.nodes.map((n) => [n.node.key, n.x ?? 0]));
      expect(x.get('a')!).toBeLessThan(x.get('b')!);
      expect(x.get('b')!).toBeLessThan(x.get('c')!);
    });

    it('a profundidade vem do column da projeção, não das arestas: nós SEM aresta ainda se separam por coluna', () => {
      const sim = createNodeGraphSimulation([node('perto', 0), node('longe', 4)], []);
      for (let i = 0; i < 300; i += 1) sim.simulation.tick();
      const perto = sim.nodes.find((n) => n.node.key === 'perto')!;
      const longe = sim.nodes.find((n) => n.node.key === 'longe')!;
      // Com força de coluna 0.5 e 300 ticks, cada nó converge para perto do seu
      // alvo — a distância observada fica próxima das 4 colunas de diferença.
      expect((longe.x ?? 0) - (perto.x ?? 0)).toBeGreaterThan(COLUMN_WIDTH * 2);
    });

    it('cada nó carrega o raio do seu tipo (D-M3)', () => {
      const sim = createNodeGraphSimulation(
        [node('d', 0, 'discovery'), node('t', 1, 'work_item'), node('f', 2, 'artifact')],
        [],
      );
      const byKey = new Map(sim.nodes.map((n) => [n.node.key, n]));
      expect(byKey.get('d')!.radius).toBe(RADIUS_BY_KIND.discovery);
      expect(byKey.get('t')!.radius).toBe(RADIUS_BY_KIND.work_item);
      expect(byKey.get('f')!.radius).toBe(RADIUS_BY_KIND.artifact);
    });

    it('aresta apontando para nó que não existe é descartada sem lançar (nunca trava o mapa)', () => {
      const sim = createNodeGraphSimulation([node('a', 0)], [edge('a', 'fantasma')]);
      expect(sim.links).toHaveLength(0);
      expect(() => {
        for (let i = 0; i < 10; i += 1) sim.simulation.tick();
      }).not.toThrow();
    });

    it('entrada vazia: simulação vazia, sem lançar', () => {
      const sim = createNodeGraphSimulation([], []);
      expect(sim.nodes).toHaveLength(0);
      expect(sim.links).toHaveLength(0);
    });

    it('cada link preserva a aresta da projeção (tipo lateral distinguível no render)', () => {
      const lateral: GraphEdge = { key: 'flows_into|a|b', kind: 'flows_into', label: 'deságua em', from: 'a', to: 'b' };
      const sim = createNodeGraphSimulation([node('a', 0), node('b', 1)], [lateral]);
      expect(sim.links).toHaveLength(1);
      expect(sim.links[0].edge.kind).toBe('flows_into');
    });
  });
});

describe('nodeGraphStateClasses', () => {
  // 012 Esteira 4.0 / wi-esteira4-mapa-grafos — aviso 3 herdado da bancada
  // (`specs/012-esteira-4/mapa-grafos-escolha.md`, seção 3): na Validar da
  // bancada, o componente emitia `node--ok` e o CSS definia `.force-node--ok` —
  // nenhum fill aplicava e todos os nós saíam pretos, sem teste que visse.
  // Este teste trava o contrato componente×CSS do mapa REAL: toda classe de tom
  // que o componente emite tem regra de `fill` no CSS module (D-M2 — o estado é
  // lido pela cor, de relance).


  const css = readFileSync(
    fileURLToPath(new URL('../src/renderer/src/DevMode/NodeGraphOverlay.module.css', import.meta.url)),
    'utf-8',
  );

  const TONES: readonly GraphTone[] = ['muted', 'accent', 'ok', 'warn', 'error', 'lock'];

  describe('classes de tom × NodeGraphOverlay.module.css', () => {
    it('TONE_CLASS cobre os seis tons da projeção (que cobrem os cinco estados de D-M2)', () => {
      for (const tone of TONES) {
        expect(TONE_CLASS[tone], `sem classe para o tom "${tone}"`).toBeTruthy();
      }
    });

    it('toda classe de tom emitida tem regra pintando o círculo (fill) no CSS module', () => {
      for (const tone of TONES) {
        const cls = TONE_CLASS[tone];
        const blockStart = css.indexOf(`.${cls} circle`);
        expect(blockStart, `sem regra ".${cls} circle" no CSS`).toBeGreaterThanOrEqual(0);
        const block = css.slice(blockStart, css.indexOf('}', blockStart));
        expect(block, `regra ".${cls} circle" não define fill`).toContain('fill:');
      }
    });

    it('D-M2: "ainda não começou" é cinza VAZADO — o tom muted tem stroke, não só fill', () => {
      const cls = TONE_CLASS.muted;
      const blockStart = css.indexOf(`.${cls} circle`);
      const block = css.slice(blockStart, css.indexOf('}', blockStart));
      expect(block).toContain('stroke:');
    });
  });
});

describe('nodeGraphView', () => {
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
});
