import { describe, expect, it } from 'vitest';
import { buildMapView, tabToFocusFor, type MapSelection } from '../src/renderer/src/DevMode/esteiraMapView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 / batch B6 — o mapa passa a ler o STORE.
//
// A forma sobrevive (carrossel de dois eixos, chips de fase, painel de
// detalhe); o que muda é o que os nós significam: discovery → planos → ITENS,
// com tipo e ciclo de vida (D-4), macro etapa derivada (D-13) e os sinais do
// card — inclusive "não consegui ler", que o mapa antigo pintava como "não
// realizada" (issue #35, revertida aqui na origem).
//
// Este arquivo cobre a DECISÃO. O componente só desenha o que sai daqui: se
// uma frase de estado nascer no JSX, a próxima correção não sobe até a raiz —
// foi assim que o mesmo defeito reapareceu três vezes neste repo.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>, at = '2026-08-04T09:00:00.000Z'): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at, type, source: { kind: 'app' }, dedupe_key: null, payload };
}

const SELECTION_VAZIA: MapSelection = { discoveryId: null, planId: null, itemId: null, nodeKey: null, phase: null };

function snapshotDe(events: readonly StoreEvent[]) {
  return reduceEvents(events);
}

/** Um discovery com plano e dois itens — o esqueleto que quase todo caso usa. */
function eventosBase(): StoreEvent[] {
  return [
    evt('discovery.created', { id: 'dsc-1', title: 'Fila de importação trava sem sinal', targetRepo: 'donel-dev' }),
    evt('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: '2026-08-04T09:10:00.000Z' }),
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

describe('buildMapView — o vazio honesto', () => {
  it('sem store nenhum, o mapa não inventa nível nem card', () => {
    const view = buildMapView(null, SELECTION_VAZIA);
    expect(view.levels).toHaveLength(0);
    expect(view.empty).toContain('histórico');
  });

  it('store vazio diz que ele NASCE limpo — não que algo sumiu', () => {
    const view = buildMapView(snapshotDe([]), SELECTION_VAZIA);
    expect(view.empty).toBe('Nenhum card ainda. O histórico nasce limpo — nada foi importado do modelo antigo.');
    expect(view.empty).not.toContain('não realizada');
  });
});

describe('buildMapView — os níveis do modelo novo', () => {
  it('discovery sem plano tem o nível fantasma dos planos, com o que falta acontecer', () => {
    const view = buildMapView(snapshotDe([evt('discovery.created', { id: 'dsc-1', title: 'Um problema' })]), SELECTION_VAZIA);
    expect(view.levels.map((level) => level.key)).toEqual(['discovery', 'preview']);
    const fantasma = view.levels[1];
    expect(fantasma.focusable).toBe(false);
    expect(fantasma.cards[0].title).toBe('PLANOS');
    // Nunca "0 planos": a frase diz de onde o primeiro nasce.
    expect(fantasma.cards[0].metaLine).toContain('skill');
  });

  it('discovery com plano e item tem os três níveis, e o item é a unidade', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    expect(view.levels.map((level) => level.key)).toEqual(['discovery', 'planos', 'itens']);
    const itens = view.levels[2];
    expect(itens.cards).toHaveLength(1);
    expect(itens.cards[0].kind).toBe('item');
    expect(itens.cards[0].title).toBe('Expor o estado da fila no endpoint de saúde');
  });

  it('o eixo X do nível Discovery navega entre TODOS os discoveries do store', () => {
    const events = [
      ...eventosBase(),
      evt('discovery.created', { id: 'dsc-2', title: 'Outro problema' }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, discoveryId: 'dsc-2' });
    expect(view.levels[0].cards.map((card) => card.title)).toEqual(['Fila de importação trava sem sinal', 'Outro problema']);
    expect(view.levels[0].focusedCardIndex).toBe(1);
    expect(view.focused.discoveryId).toBe('dsc-2');
  });

  it('item sem plano nunca some do nível de itens — órfão se sinaliza, não se esconde', () => {
    const events = [
      ...eventosBase(),
      evt('work_item.created', { id: 'wki-orfao', discoveryId: 'dsc-1', itemType: 'spike', title: 'Medir onde o lote para' }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, planId: 'pln-1' });
    const itens = view.levels.find((level) => level.key === 'itens');
    expect(itens?.cards.map((card) => card.title)).toContain('Medir onde o lote para');
    const orfao = itens?.cards.find((card) => card.title === 'Medir onde o lote para');
    expect(orfao?.tags.some((tag) => tag.text === 'sem plano')).toBe(true);
  });
});

describe('buildMapView — o card do discovery', () => {
  it('mostra a macro etapa DERIVADA, com a palavra do modelo', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    expect(view.levels[0].cards[0].statusLabel).toBe('Planejado');
  });

  it('ajuste manual mostra a etapa forçada E o cálculo ao lado — override que esconde o cálculo engana', () => {
    const events = [
      ...eventosBase(),
      evt('stage.overridden', { discoveryId: 'dsc-1', value: 'done', by: 'xansd' }),
    ];
    const card = buildMapView(snapshotDe(events), SELECTION_VAZIA).levels[0].cards[0];
    expect(card.statusLabel).toBe('Concluído');
    expect(card.tags.some((tag) => tag.text.includes('ajuste manual') && tag.text.includes('Planejado'))).toBe(true);
  });

  it('os sinais do card viram etiquetas — inclusive "não consegui ler"', () => {
    const events = [
      ...eventosBase(),
      evt('ingest.failed', {
        resultPath: 'C:/outbox/run-9.json',
        subject: { entity: 'discovery', id: 'dsc-1' },
        issues: [{ code: 'unknown_field', path: 'facts[0].kind', message: 'campo desconhecido' }],
      }),
    ];
    const card = buildMapView(snapshotDe(events), SELECTION_VAZIA).levels[0].cards[0];
    const etiqueta = card.tags.find((tag) => tag.text === 'não consegui ler');
    expect(etiqueta).toBeDefined();
    expect(etiqueta?.tone).toBe('error');
    expect(card.tags.some((tag) => tag.text === 'não realizada')).toBe(false);
  });

  it('espelho pendente aparece como etiqueta, e não como falha do trabalho local', () => {
    const events = [
      ...eventosBase(),
      evt('mirror.queued', { subject: { entity: 'discovery', id: 'dsc-1' }, operation: 'column', payload: { column: 'Plano' } }),
    ];
    const card = buildMapView(snapshotDe(events), SELECTION_VAZIA).levels[0].cards[0];
    expect(card.tags.some((tag) => tag.text === 'espelho pendente')).toBe(true);
  });
});

describe('buildMapView — a trilha das fases', () => {
  it('a fase que rodou aparece com a palavra dela — e não sobra passo pendurado depois dela', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    const trilha = view.levels[0].cards[0].trail;
    expect(trilha[0].text).toBe('discovery — concluída');
    expect(trilha[0].glyph).toBe('done');
    // A trilha é POR ASSUNTO: o discovery já rodou a fase dele, e a fase de
    // plano é do PLANO — ela aparece no nível de baixo, não pendurada aqui.
    expect(trilha.some((step) => step.isNext)).toBe(false);
  });

  it('a próxima fase do plano é a que o catálogo (B2) oferece, no card do plano', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    const trilha = view.levels[1].cards[0].trail;
    const proxima = trilha.find((step) => step.isNext);
    expect(proxima?.phase).toBe('plano');
    expect(proxima?.text).toBe('plano — é a próxima');
    expect(proxima?.enabled).toBe(true);
  });

  it('card recém-criado tem a fase discovery como próxima, com o "Preparar" liberado', () => {
    const view = buildMapView(snapshotDe([evt('discovery.created', { id: 'dsc-1', title: 'Um problema', targetRepo: 'donel-dev' })]), SELECTION_VAZIA);
    const proxima = view.levels[0].cards[0].trail.find((step) => step.isNext);
    expect(proxima?.phase).toBe('discovery');
    expect(proxima?.enabled).toBe(true);
    expect(proxima?.glyph).toBe('not-started');
  });

  it('a trilha só nasce no card EM FOCO — os vizinhos ficam curtos, como no design', () => {
    const events = [...eventosBase(), evt('discovery.created', { id: 'dsc-2', title: 'Outro problema' })];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    expect(view.levels[0].cards[0].trail.length).toBeGreaterThan(0);
    expect(view.levels[0].cards[1].trail).toHaveLength(0);
  });

  it('fase que falhou diz que falhou, com o código — jamais "não realizada"', () => {
    const events = [
      ...eventosBase(),
      evt('phase.failed', {
        subject: { entity: 'work_item', id: 'wki-1' },
        phase: 'implementar',
        failure: { code: 'worktree-dirty', message: 'a worktree tem mudança não commitada' },
      }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, itemId: 'wki-1' });
    const item = view.levels[2].cards.find((card) => card.subject?.id === 'wki-1');
    expect(item?.trail[0].text).toBe('implementar — falhou: worktree-dirty');
    expect(item?.trail[0].glyph).toBe('failed');
  });

  it('trava no card: a próxima fase do plano vem BLOQUEADA, com a razão escrita', () => {
    const events = [
      ...eventosBase(),
      evt('lock.acquired', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', holderKind: 'app' }),
    ];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    const proxima = view.levels[1].cards[0].trail.find((step) => step.isNext);
    expect(proxima?.enabled).toBe(false);
    expect(proxima?.reason).toContain('travada');
  });
});

describe('buildMapView — o ciclo de vida do item (D-4)', () => {
  it('spike que respondeu "não dá" aparece CONCLUÍDO, não pela metade', () => {
    const events = [
      ...eventosBase(),
      evt('work_item.created', { id: 'wki-spike', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'spike', title: 'Dá para ler o transcript inteiro?' }),
      evt('verification.updated', {
        subject: { entity: 'work_item', id: 'wki-spike' },
        verificationKind: 'conclusion',
        state: 'passed',
        ref: 'não dá: o arquivo passa de 400 MB e o parser trava',
      }),
      evt('work_item.updated', { id: 'wki-spike', state: 'done' }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, itemId: 'wki-spike' });
    const card = view.levels[2].cards.find((c) => c.subject?.id === 'wki-spike');

    expect(card?.statusLabel).toBe('concluído');
    // O fecho do ciclo "pergunta respondida" é dito com todas as letras — e a
    // resposta negativa é desfecho, não pendência.
    expect(card?.closureLine).toContain('pergunta');
    expect(card?.closureLine).toContain('não dá: o arquivo passa de 400 MB e o parser trava');
    // E a trilha NÃO fica com um passo pendente pendurado: item fechado não tem
    // "próxima fase". Era isso que fazia um spike respondido parecer PR pela metade.
    expect(card?.trail.some((step) => step.isNext)).toBe(false);
  });

  it('o detalhe do item fechado não repete o fecho: a linha do topo continua sendo a meta do item', () => {
    // Achado da captura (print 19): o painel imprimia a MESMA frase de fecho
    // duas vezes — no resumo e na seção "Como este ciclo termina" — e, ao fazer
    // isso, deixava de dizer o que o item É (tipo, estado, repo, origem)
    // justamente no estado em que ele fecha.
    const events = [
      ...eventosBase(),
      evt('work_item.created', { id: 'wki-spike', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'spike', title: 'Dá para ler o transcript inteiro?' }),
      evt('verification.updated', {
        subject: { entity: 'work_item', id: 'wki-spike' },
        verificationKind: 'conclusion',
        state: 'passed',
        ref: 'não dá: o arquivo passa de 400 MB e o parser trava',
      }),
      evt('work_item.updated', { id: 'wki-spike', state: 'done' }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, itemId: 'wki-spike', nodeKey: 'work_item:wki-spike' });

    expect(view.detail?.closureLine).toContain('pergunta');
    expect(view.detail?.summary).not.toBe(view.detail?.closureLine);
    expect(view.detail?.summary).toContain('spike');
    expect(view.detail?.summary).toContain('concluído');
  });

  it('item de entrega de código em curso continua com a próxima fase à frente', () => {
    const events = [...eventosBase(), evt('work_item.updated', { id: 'wki-1', state: 'in-progress' })];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, itemId: 'wki-1' });
    const card = view.levels[2].cards.find((c) => c.subject?.id === 'wki-1');
    expect(card?.statusLabel).toBe('em curso');
    expect(card?.trail.some((step) => step.isNext)).toBe(true);
  });

  it('a linha do item diz o tipo, o ciclo e o repo — o herdado marcado como herdado', () => {
    const view = buildMapView(snapshotDe(eventosBase()), { ...SELECTION_VAZIA, itemId: 'wki-1' });
    const card = view.levels[2].cards.find((c) => c.subject?.id === 'wki-1');
    expect(card?.metaLine).toContain('issue');
    expect(card?.metaLine).toContain('donel-dev');
    expect(card?.metaLine).toContain('herdado');
  });
});

describe('buildMapView — o painel de detalhe', () => {
  it('sem nó escolhido, o detalhe é o card em foco — nunca uma tela vazia sem saída', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    expect(view.detail?.title).toBe('Fila de importação trava sem sinal');
    expect(view.breadcrumb).toEqual(['Fila de importação trava sem sinal']);
  });

  it('o PR da fase volta a aparecer — e não só o PR (D-4)', () => {
    const events = [
      ...eventosBase(),
      evt('verification.updated', {
        subject: { entity: 'work_item', id: 'wki-1' },
        verificationKind: 'pull-request',
        state: 'passed',
        ref: 'https://github.com/xansde/donel-dev/pull/44',
      }),
      evt('verification.updated', { subject: { entity: 'work_item', id: 'wki-1' }, verificationKind: 'check', state: 'failed', ref: 'npm test' }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, nodeKey: 'work_item:wki-1' });
    // Costura B6×B7: a frase vem de `verificationLines` do B7 (o mapa explícito
    // de 12 pares, que os prints do B7 validaram) e o ponteiro vem SEPARADO, em
    // `detail` — o handoff do B7 pediu reúso, não uma segunda redação compacta.
    expect(view.detail?.verifications.map((line) => line.text)).toEqual([
      'PR mergeado e verificado',
      'verificação falhou',
    ]);
    expect(view.detail?.verifications.map((line) => line.detail)).toEqual([
      'https://github.com/xansde/donel-dev/pull/44',
      'npm test',
    ]);
  });

  it('os artefatos declarados aparecem com o ponteiro inteiro (D-8)', () => {
    const events = [
      ...eventosBase(),
      evt('artifact.pinned', {
        owner: { entity: 'discovery', id: 'dsc-1' },
        artifactKind: 'spec',
        location: 'repo',
        repo: 'donel-dev',
        path: 'specs/010-esteira-donel/spec.md',
      }),
    ];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    expect(view.detail?.artifacts).toHaveLength(1);
    expect(view.detail?.artifacts[0].path).toBe('specs/010-esteira-donel/spec.md');
    expect(view.detail?.artifacts[0].note).toContain('donel-dev');
  });

  it('o erro de ingestão aparece no detalhe com caminho e motivo — e diz que nada se perdeu', () => {
    const events = [
      ...eventosBase(),
      evt('ingest.failed', {
        resultPath: 'C:/outbox/run-9.json',
        subject: { entity: 'discovery', id: 'dsc-1' },
        issues: [{ code: 'unknown_field', path: 'facts[0].kind', message: 'campo desconhecido' }],
      }),
    ];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    expect(view.detail?.ingestErrors[0].path).toBe('C:/outbox/run-9.json');
    expect(view.detail?.ingestErrors[0].reason).toContain('unknown_field');
    expect(view.detail?.ingestErrorNote).toContain('continua lá');
  });

  it('a trava aparece no detalhe com dono, hora e saída — o mesmo texto da tela do store', () => {
    const events = [
      ...eventosBase(),
      evt('lock.acquired', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'plano', holderKind: 'app' }),
    ];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    expect(view.detail?.lock?.title).toBe('Preparada — ninguém assumiu ainda');
    expect(view.detail?.lock?.line).toContain('plano');
  });

  it('o breadcrumb desce até o item escolhido', () => {
    const view = buildMapView(snapshotDe(eventosBase()), { ...SELECTION_VAZIA, nodeKey: 'work_item:wki-1' });
    expect(view.breadcrumb).toEqual([
      'Fila de importação trava sem sinal',
      'Instrumentar a fila',
      'Expor o estado da fila no endpoint de saúde',
    ]);
  });

  it('escolher uma etapa da trilha leva o detalhe àquela fase', () => {
    const view = buildMapView(snapshotDe(eventosBase()), { ...SELECTION_VAZIA, nodeKey: 'discovery:dsc-1', phase: 'discovery' });
    expect(view.detail?.phase).toBe('discovery');
    expect(view.detail?.summary).toBe('discovery — concluída');
  });
});

// ---------------------------------------------------------------------------
// T-14 do inventário — fechado no merge do B4 (04/08): a marca de "semeado"
// nos nós do mapa. Sem ela, o card semeado apareceria no carrossel como fato
// observado — o mesmo bug que a spec 010 existe para extinguir, na tela nova.
// ---------------------------------------------------------------------------
describe('buildMapView — proveniência "semeado" nos nós (T-14)', () => {
  function semeado(type: string, payload: Record<string, unknown>): StoreEvent {
    return { ...evt(type, payload), source: { kind: 'seed' } };
  }

  function eventosSemeados(): StoreEvent[] {
    return [
      semeado('discovery.created', { id: 'dsc-s', title: 'Trabalho que já existia' }),
      semeado('phase.completed', { subject: { entity: 'discovery', id: 'dsc-s' }, phase: 'discovery', outcome: 'done' }),
      semeado('plan.created', { id: 'pln-s', discoveryId: 'dsc-s', title: 'Plano semeado' }),
      semeado('work_item.created', {
        id: 'wki-s',
        discoveryId: 'dsc-s',
        planId: 'pln-s',
        itemType: 'issue',
        title: 'Item semeado',
        targetRepo: 'donel-dev',
        state: 'in-progress',
      }),
    ];
  }

  it('card, plano e item semeados carregam a etiqueta — a mesma palavra da tela do store', () => {
    const view = buildMapView(snapshotDe(eventosSemeados()), SELECTION_VAZIA);
    const [discovery] = view.levels[0].cards;
    const [plano] = view.levels[1].cards;
    const [item] = view.levels[2].cards;

    for (const card of [discovery, plano, item]) {
      const tag = card.tags.find((entry) => entry.text === 'semeado');
      expect(tag).toBeDefined();
      // O title explica o que a marca significa — vem de SEEDED_MARK, nunca reescrito.
      expect(tag?.title).toContain('afirmou');
    }
  });

  it('card declarado por skill não ganha etiqueta nenhuma — a ausência é o default', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    for (const level of view.levels) {
      for (const card of level.cards) {
        expect(card.tags.some((tag) => tag.text === 'semeado')).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// C1 (batch N5) — passe de densidade: chip/glifo/uma-palavra no nó, a frase
// honesta inteira desce para tooltip/painel de detalhe. NENHUMA informação
// morre — muda de camada. `label` (curto) nasce ao lado de `text`/`line`
// (a frase honesta), nas MESMAS funções puras.
// ---------------------------------------------------------------------------
describe('buildMapView — C1, densidade: metaLabel curto no card do item', () => {
  it('o card do item ganha metaLabel = o TIPO (uma palavra) — a frase inteira (tipo · estado · repo · origem · trava) continua em metaLine', () => {
    const view = buildMapView(snapshotDe(eventosBase()), { ...SELECTION_VAZIA, itemId: 'wki-1' });
    const item = view.levels[2].cards.find((card) => card.subject?.id === 'wki-1');
    expect(item?.metaLabel).toBe('issue');
    // Nada morreu: a frase inteira segue disponível pra tooltip/detalhe.
    expect(item?.metaLine).toContain('issue');
    expect(item?.metaLine).toContain('donel-dev');
  });

  it('discovery e plano não ganham metaLabel — a meta deles já é curta (contagem), sem frase pra encurtar', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    expect(view.levels[0].cards[0].metaLabel).toBeNull();
    expect(view.levels[1].cards[0].metaLabel).toBeNull();
  });
});

describe('buildMapView — C1, densidade: closureLabel curto + tooltip da trava', () => {
  it('item fechado ganha closureLabel curto; closureLine segue com a frase inteira', () => {
    const events = [
      ...eventosBase(),
      evt('work_item.created', { id: 'wki-spike', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'spike', title: 'Um spike' }),
      evt('verification.updated', {
        subject: { entity: 'work_item', id: 'wki-spike' },
        verificationKind: 'conclusion',
        state: 'passed',
        ref: 'não dá',
      }),
      evt('work_item.updated', { id: 'wki-spike', state: 'done' }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, itemId: 'wki-spike' });
    const card = view.levels[2].cards.find((c) => c.subject?.id === 'wki-spike');
    expect(card?.closureLabel).toBe('ver desfecho');
    expect(card?.closureLine).toContain('não dá');
  });

  it('item aberto: closureLabel e closureLine são os dois null — nada a mostrar', () => {
    const view = buildMapView(snapshotDe(eventosBase()), { ...SELECTION_VAZIA, itemId: 'wki-1' });
    const card = view.levels[2].cards.find((c) => c.subject?.id === 'wki-1');
    expect(card?.closureLabel).toBeNull();
    expect(card?.closureLine).toBeNull();
  });

  it('a etiqueta de trava carrega a frase honesta no title — dono, hora e sessão não somem mais', () => {
    const events = [...eventosBase(), evt('lock.acquired', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', holderKind: 'app', acquiredAt: 'x' })];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    const etiqueta = view.levels[0].cards[0].tags.find((tag) => tag.text.startsWith('trava:'));
    expect(etiqueta?.title).toContain('discovery');
    expect(etiqueta?.title).not.toBeNull();
  });
});

describe('buildMapView — C1, densidade: label curto em cada passo da trilha', () => {
  it('passo já rodado: label é só a palavra de estado; text continua sendo a frase inteira', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    const [passo] = view.levels[0].cards[0].trail;
    expect(passo.text).toBe('discovery — concluída');
    expect(passo.label).toBe('concluída');
  });

  it('passo "é a próxima": label curto, text continua a frase inteira', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    const proxima = view.levels[1].cards[0].trail.find((step) => step.isNext)!;
    expect(proxima.text).toBe('plano — é a próxima');
    expect(proxima.label.length).toBeLessThan(proxima.text.length);
  });

  it('passo que falhou: label é curto ("falhou"), o código do motivo fica só na frase/detalhe', () => {
    const events = [
      ...eventosBase(),
      evt('phase.failed', {
        subject: { entity: 'work_item', id: 'wki-1' },
        phase: 'implementar',
        failure: { code: 'worktree-dirty', message: 'a worktree tem mudança não commitada' },
      }),
    ];
    const view = buildMapView(snapshotDe(events), { ...SELECTION_VAZIA, itemId: 'wki-1' });
    const item = view.levels[2].cards.find((card) => card.subject?.id === 'wki-1');
    expect(item?.trail[0].text).toBe('implementar — falhou: worktree-dirty');
    expect(item?.trail[0].label).toBe('falhou');
  });
});

// ---------------------------------------------------------------------------
// B1 (batch N5) — "retomar fase concluída por clique": o passo da trilha
// carrega a sessão a reabrir (`resume`), quando a fase já fechou e há uma
// sessão de CLI completa (cliSessionId + cwd) pra ela. Sem dispatch novo, sem
// mudar estado do card — a decisão de QUAL sessão é a mesma de
// `esteiraSession.resolveResume`, importada, nunca recalculada aqui.
// ---------------------------------------------------------------------------
describe('buildMapView — B1, o passo concluído carrega a sessão pra "Retomar"', () => {
  function eventosComFaseConcluida(): StoreEvent[] {
    return [
      ...eventosBase(),
      evt('session.started', {
        id: 'ses-discovery-1',
        cliSessionId: 'cli-discovery-1',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        cwd: 'C:/dev/donel-dev',
        startedAt: '2026-08-04T09:00:00.000Z',
      }),
      evt('session.ended', { id: 'ses-discovery-1', at: '2026-08-04T09:05:00.000Z' }),
    ];
  }

  it('passo concluído com sessão completa (cliSessionId + cwd): carrega resume', () => {
    const view = buildMapView(snapshotDe(eventosComFaseConcluida()), SELECTION_VAZIA);
    const passo = view.levels[0].cards[0].trail.find((step) => step.phase === 'discovery')!;
    expect(passo.label).toBe('concluída');
    expect(passo.resume).toEqual({ cliSessionId: 'cli-discovery-1', cwd: 'C:/dev/donel-dev' });
  });

  it('passo concluído SEM nenhuma sessão de CLI (ex.: fase semeada): resume é null — nada pra retomar', () => {
    const view = buildMapView(snapshotDe(eventosBase()), SELECTION_VAZIA);
    const passo = view.levels[0].cards[0].trail.find((step) => step.phase === 'discovery')!;
    expect(passo.label).toBe('concluída');
    expect(passo.resume).toBeNull();
  });

  it('passo que é "a próxima" (ainda não rodou) nunca carrega resume', () => {
    const view = buildMapView(snapshotDe(eventosComFaseConcluida()), SELECTION_VAZIA);
    const proxima = view.levels[1].cards[0].trail.find((step) => step.isNext)!;
    expect(proxima.resume).toBeNull();
  });

  it('cadeia de handoff: resume aponta pra ÚLTIMA sessão da cadeia, não a primeira', () => {
    const events = [
      ...eventosComFaseConcluida(),
      evt('session.started', {
        id: 'ses-discovery-2',
        cliSessionId: 'cli-discovery-2',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        cwd: 'C:/dev/donel-dev',
        continuesSessionId: 'ses-discovery-1',
        startedAt: '2026-08-04T09:06:00.000Z',
      }),
      evt('session.ended', { id: 'ses-discovery-2', at: '2026-08-04T09:10:00.000Z' }),
    ];
    const view = buildMapView(snapshotDe(events), SELECTION_VAZIA);
    const passo = view.levels[0].cards[0].trail.find((step) => step.phase === 'discovery')!;
    expect(passo.resume?.cliSessionId).toBe('cli-discovery-2');
  });
});

// ---------------------------------------------------------------------------
// B2 (batch N5) — "navegar no mapa alterna para a aba da sessão VIVA do nó".
// `tabToFocusFor` é a decisão pura: dado o snapshot, o assunto e as abas
// abertas, qual aba (se alguma) merece o foco. Nó sem sessão viva não rouba
// foco (devolve null); sessão fechada nunca é alvo (existe o retomar
// explícito do B1 pra isso).
// ---------------------------------------------------------------------------
describe('tabToFocusFor — a aba da sessão viva do nó, quando existe', () => {
  const abas = [
    { id: 'tab-1', claudeSessionId: 'cli-viva' },
    { id: 'tab-2', claudeSessionId: 'cli-outra' },
  ];

  it('sessão viva com aba aberta: devolve o id da aba', () => {
    const events = [
      ...eventosBase(),
      evt('session.started', {
        id: 'ses-1',
        cliSessionId: 'cli-viva',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        startedAt: 'x',
      }),
    ];
    const snapshot = snapshotDe(events);
    expect(tabToFocusFor(snapshot, 'dsc-1', { entity: 'discovery', id: 'dsc-1' }, abas)).toBe('tab-1');
  });

  it('sem sessão viva nenhuma do assunto: null — nunca rouba foco', () => {
    const snapshot = snapshotDe(eventosBase());
    expect(tabToFocusFor(snapshot, 'dsc-1', { entity: 'discovery', id: 'dsc-1' }, abas)).toBeNull();
  });

  it('sessão viva, mas SEM aba aberta pra ela agora: null', () => {
    const events = [
      ...eventosBase(),
      evt('session.started', {
        id: 'ses-1',
        cliSessionId: 'cli-sem-aba',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        startedAt: 'x',
      }),
    ];
    const snapshot = snapshotDe(events);
    expect(tabToFocusFor(snapshot, 'dsc-1', { entity: 'discovery', id: 'dsc-1' }, abas)).toBeNull();
  });

  it('sessão JÁ encerrada nunca é alvo — mesmo tendo uma aba com o mesmo cliSessionId por coincidência', () => {
    const events = [
      ...eventosBase(),
      evt('session.started', {
        id: 'ses-1',
        cliSessionId: 'cli-viva',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        startedAt: 'x',
      }),
      evt('session.ended', { id: 'ses-1', at: 'y' }),
    ];
    const snapshot = snapshotDe(events);
    expect(tabToFocusFor(snapshot, 'dsc-1', { entity: 'discovery', id: 'dsc-1' }, abas)).toBeNull();
  });

  it('sem snapshot: null, nunca lança', () => {
    expect(tabToFocusFor(null, 'dsc-1', { entity: 'discovery', id: 'dsc-1' }, abas)).toBeNull();
  });
});
