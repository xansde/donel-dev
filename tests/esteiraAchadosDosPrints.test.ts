import { describe, expect, it } from 'vitest';
import { cardView, discardHint, dispatchHint, lockView } from '../src/renderer/src/Esteira/esteiraView';
import { deriveStage, reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent, WorkItemSnapshot } from '../src/shared/esteira/store/storeFormat';

// Spec 010, batch B3 — os quatro defeitos que a captura `gestos-do-card` de
// 04/08 revelou e que os 1.491 testes verdes nao pegaram. Cada bloco nomeia o
// PRINT que o mostrou, porque a foto e a prova e o teste e a trava.
//
// O padrao entre eles e o de `erros-conhecidos.md` #1: a palavra nasce longe do
// estado — hardcoded no TSX, ou numa funcao pura que nao recebeu o que precisava
// para dizer a verdade. Todos foram corrigidos na funcao que PRODUZ o texto.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at: '2026-08-04T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

function item(overrides: Partial<WorkItemSnapshot> = {}): WorkItemSnapshot {
  return {
    id: 'wi-1',
    discoveryId: 'dsc-1',
    planId: 'pln-1',
    itemType: 'issue',
    lifecycle: 'code-delivery',
    title: 'Expor o estado da fila no endpoint de saúde',
    targetRepo: 'atlas',
    scopeRepos: [],
    state: 'open',
    createdBySkill: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    seeded: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Print 12 — "Planejado" para um card que ja concluiu um item
// ---------------------------------------------------------------------------

describe('deriveStage — trabalho que ja fechou nao volta a ser trabalho que nunca comecou', () => {
  const base = { discoveryConcluded: true, discoveryOutcome: 'done' as const, planCount: 1 };

  it('print 12: um item concluido e outro aberto e Execucao, nunca Planejado', () => {
    const { stage } = deriveStage({
      ...base,
      items: [
        { state: 'done', everConcluded: true },
        { state: 'open', everConcluded: false },
      ],
    });
    expect(stage).toBe('execution');
  });

  it('prints 12 e 15: um aberto + um concluido da a MESMA etapa, nao importa qual dos dois esta aberto', () => {
    const primeiroFechado = deriveStage({
      ...base,
      items: [
        { state: 'done', everConcluded: true },
        { state: 'open', everConcluded: false },
      ],
    });
    const segundoFechado = deriveStage({
      ...base,
      items: [
        { state: 'open', everConcluded: true },
        { state: 'done', everConcluded: true },
      ],
    });
    expect(primeiroFechado.stage).toBe(segundoFechado.stage);
  });

  it('item abandonado tambem e trabalho que aconteceu — desistir nao devolve o card para Planejado', () => {
    const { stage } = deriveStage({
      ...base,
      items: [
        { state: 'abandoned', everConcluded: true },
        { state: 'open', everConcluded: false },
      ],
    });
    expect(stage).toBe('execution');
  });

  it('Planejado continua existindo: plano declarado e nenhum item jamais tocado', () => {
    const { stage } = deriveStage({
      ...base,
      items: [
        { state: 'open', everConcluded: false },
        { state: 'open', everConcluded: false },
      ],
    });
    expect(stage).toBe('planned');
  });

  it('todos fechados continua Concluido — a memoria de execucao nao sequestra o desfecho', () => {
    const { stage } = deriveStage({
      ...base,
      items: [
        { state: 'done', everConcluded: true },
        { state: 'abandoned', everConcluded: true },
      ],
    });
    expect(stage).toBe('done');
  });

  it('o retrocesso do print 15 segue de pe: item reaberto puxa o card de Concluido para Execucao', () => {
    const { stage } = deriveStage({
      ...base,
      items: [
        { state: 'open', everConcluded: true },
        { state: 'done', everConcluded: true },
      ],
    });
    expect(stage).toBe('execution');
  });
});

// ---------------------------------------------------------------------------
// Prints 26 e 27 — "sem bloqueio" embaixo do item que o app bloqueia
// ---------------------------------------------------------------------------

describe('discardHint — a frase do descarte nao promete o que o app recusa', () => {
  const travaNoItem = {
    subject: { entity: 'work_item' as const, id: 'wi-1' },
    phase: 'implementar',
    holderKind: 'skill' as const,
    acquiredAt: '2026-08-04T12:00:00.000Z',
    cliSessionId: null,
    mirroredLabel: null,
  };

  it('sem trava, o descarte e um gesto so — D-16 inteiro', () => {
    const hint = discardHint(item(), null);
    expect(hint).toContain('sem bloqueio');
    expect(hint).toContain('histórico');
  });

  it('print 26/27: item travado NAO diz "sem bloqueio" — o app recusa o descarte dele na mesma tela', () => {
    const hint = discardHint(item(), travaNoItem);
    expect(hint).not.toContain('sem bloqueio');
  });

  it('e diz o que fazer para destravar, em vez de so negar', () => {
    const hint = discardHint(item(), travaNoItem);
    expect(hint).toContain('trava');
    expect(hint).toContain('Libere');
  });

  it('a trava de OUTRO item nao contamina a frase deste', () => {
    const hint = discardHint(item({ id: 'wi-2', title: 'Desenhar o painel' }), travaNoItem);
    expect(hint).toContain('sem bloqueio');
  });

  it('trava do card nao bloqueia o descarte de item — o gesto recusado e so o do assunto travado', () => {
    const travaNoCard = { ...travaNoItem, subject: { entity: 'discovery' as const, id: 'dsc-1' } };
    expect(discardHint(item(), travaNoCard)).toContain('sem bloqueio');
  });
});

// ---------------------------------------------------------------------------
// Print 25 — a trava sem dizer de qual item ela e
// ---------------------------------------------------------------------------

describe('lockView — a trava diz de QUE ela e, nao so desde quando', () => {
  function cardComTrava(subject: { entity: string; id: string }) {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Fila de importação trava sem sinal', createdAt: '2026-08-04T12:00:00.000Z' }),
      evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar o estado da fila observável' }),
      evt('work_item.created', {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: 'pln-1',
        itemType: 'issue',
        title: 'Expor o estado da fila no endpoint de saúde',
        createdBySkill: true,
        createdAt: '2026-08-04T12:00:00.000Z',
      }),
      evt('work_item.created', {
        id: 'wi-2',
        discoveryId: 'dsc-1',
        planId: 'pln-1',
        itemType: 'spec',
        title: 'Desenhar o painel que consome o estado',
        createdBySkill: true,
        createdAt: '2026-08-04T12:00:00.000Z',
      }),
      evt('lock.acquired', { subject, phase: 'implementar', holderKind: 'skill', acquiredAt: '2026-08-04T12:00:00.000Z' }),
    ]);
    return cardView(snapshot, 'dsc-1')!;
  }

  it('print 25: com dois itens na tela, a trava nomeia o item que ela prende', () => {
    const view = lockView(cardComTrava({ entity: 'work_item', id: 'wi-1' }))!;
    expect(view.line).toContain('Expor o estado da fila no endpoint de saúde');
    expect(view.line).not.toContain('Desenhar o painel');
  });

  it('trava do card se diz do card — nao vira "um item" generico', () => {
    const view = lockView(cardComTrava({ entity: 'discovery', id: 'dsc-1' }))!;
    expect(view.line).toContain('o card');
  });

  it('a frase continua dizendo fase, dono e hora — nomear o assunto nao troca uma informacao por outra', () => {
    const view = lockView(cardComTrava({ entity: 'work_item', id: 'wi-1' }))!;
    expect(view.line).toContain('implementar');
    expect(view.line).toContain('uma skill');
    expect(view.line).toContain('04/08');
  });
});

// ---------------------------------------------------------------------------
// Print 29 — "fase preparada" para uma fase que a skill ja assumiu
// ---------------------------------------------------------------------------

describe('dispatchHint — a palavra acompanha o estado da trava', () => {
  function cardComTrava(options: { subject: { entity: string; id: string }; holderKind: 'app' | 'skill' }) {
    const eventos: StoreEvent[] = [
      evt('discovery.created', { id: 'dsc-1', title: 'Fila de importação trava sem sinal', createdAt: '2026-08-04T12:00:00.000Z' }),
      evt('work_item.created', {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: null,
        itemType: 'issue',
        title: 'Expor o estado da fila no endpoint de saúde',
        createdBySkill: true,
        createdAt: '2026-08-04T12:00:00.000Z',
      }),
      evt('lock.acquired', {
        subject: options.subject,
        phase: 'implementar',
        holderKind: options.holderKind,
        acquiredAt: '2026-08-04T12:00:00.000Z',
      }),
    ];
    return cardView(reduceEvents(eventos), 'dsc-1')!;
  }

  it('sem trava, a frase explica o que o Preparar faz', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: '2026-08-04T12:00:00.000Z' }),
    ]);
    const hint = dispatchHint(cardView(snapshot, 'dsc-1')!);
    expect(hint).toContain('inbox');
    expect(hint).not.toContain('Libere');
  });

  it('print 29: fase que a skill ja assumiu NAO se chama "preparada"', () => {
    const hint = dispatchHint(cardComTrava({ subject: { entity: 'work_item', id: 'wi-1' }, holderKind: 'skill' }));
    expect(hint).not.toContain('preparada');
    expect(hint).toContain('em andamento');
  });

  it('print 29: trava de ITEM nao se anuncia como trava "neste card"', () => {
    const hint = dispatchHint(cardComTrava({ subject: { entity: 'work_item', id: 'wi-1' }, holderKind: 'skill' }));
    expect(hint).toContain('Expor o estado da fila no endpoint de saúde');
    expect(hint).not.toContain('neste card');
  });

  it('fase preparada pelo app e que ninguem assumiu continua se chamando preparada', () => {
    const hint = dispatchHint(cardComTrava({ subject: { entity: 'discovery', id: 'dsc-1' }, holderKind: 'app' }));
    expect(hint).toContain('preparada');
  });

  it('em qualquer trava, a frase diz a saida — trava sem saida foi o defeito de 03/08', () => {
    const daSkill = dispatchHint(cardComTrava({ subject: { entity: 'work_item', id: 'wi-1' }, holderKind: 'skill' }));
    const doApp = dispatchHint(cardComTrava({ subject: { entity: 'discovery', id: 'dsc-1' }, holderKind: 'app' }));
    expect(daSkill).toContain('Libere');
    expect(doApp).toContain('Libere');
  });
});
