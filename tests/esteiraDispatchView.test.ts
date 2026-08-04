import { describe, expect, it } from 'vitest';
import { cardView, dispatchView } from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { CardView } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010, batch B2 — "só oferecer disparo que o modelo comporta".
//
// O achado do primeiro uso real: dava para disparar a fase "Plano" num card sem
// plano nenhum, e o `run-input.json` saía com `plan_id: null`. A tela oferecia
// um caminho que o modelo não comporta — e o clique só falhava depois.
//
// Este teste cobra as três coisas que o batch existe para garantir:
//
//   1. fase que exige plano fica DESABILITADA, com a razão ESCRITA;
//   2. dá para escolher o ASSUNTO do disparo (discovery, plano ou item);
//   3. D-6 é cobrado ANTES do clique: item `issue` sem repo alvo não dispara,
//      e a tela diz por quê.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at: '2026-08-04T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

const nasceCard = (targetRepo: string | null = null): StoreEvent =>
  evt('discovery.created', { id: 'dsc-1', title: 'Fila trava sem sinal', targetRepo, createdAt: '2026-08-04T12:00:00.000Z' });

const nascePlano = (): StoreEvent => evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar a fila observável' });

function nasceItem(overrides: Record<string, unknown> = {}): StoreEvent {
  return evt('work_item.created', {
    id: 'wi-1',
    discoveryId: 'dsc-1',
    planId: 'pln-1',
    itemType: 'issue',
    title: 'Instrumentar o consumo',
    targetRepo: 'atlas',
    state: 'open',
    createdBySkill: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  });
}

function card(events: readonly StoreEvent[]): CardView {
  const view = cardView(reduceEvents(events), 'dsc-1');
  if (view === null) throw new Error('fixture sem card');
  return view;
}

/** A fase pelo nome, do jeito que a tela a lê. */
function fase(view: ReturnType<typeof dispatchView>, phase: string) {
  const found = view.phases.find((entry) => entry.phase === phase);
  if (found === undefined) throw new Error(`a tela não oferece a fase ${phase}`);
  return found;
}

describe('fase que o card não comporta fica desabilitada, com a razão escrita', () => {
  it('sem plano, a fase Plano não é oferecida para clique — e diz por quê', () => {
    const view = dispatchView(card([nasceCard()]), { phase: 'plano', targetKey: null });
    const plano = fase(view, 'plano');

    expect(plano.enabled).toBe(false);
    expect(plano.reason).toContain('plano');
    expect(view.canDispatch).toBe(false);
    expect(view.blocked).toBe(plano.reason);
  });

  it('depois que a skill declara um plano, a fase Plano habilita', () => {
    const view = dispatchView(card([nasceCard(), nascePlano()]), { phase: 'plano', targetKey: null });

    expect(fase(view, 'plano').enabled).toBe(true);
    expect(fase(view, 'plano').reason).toBeNull();
    expect(view.canDispatch).toBe(true);
    expect(view.blocked).toBeNull();
  });

  it('sem item, as fases de item ficam desabilitadas — e a razão nomeia D-16', () => {
    const view = dispatchView(card([nasceCard(), nascePlano()]), { phase: 'implementar', targetKey: null });

    expect(fase(view, 'implementar').enabled).toBe(false);
    expect(fase(view, 'validar').enabled).toBe(false);
    expect(fase(view, 'implementar').reason).toContain('skill');
  });

  it('a fase Discovery está sempre disponível — o card É o discovery', () => {
    expect(fase(dispatchView(card([nasceCard()]), { phase: 'discovery', targetKey: null }), 'discovery').enabled).toBe(true);
  });

  it('fase fora do catálogo cai na primeira, em vez de a tela travar', () => {
    const view = dispatchView(card([nasceCard()]), { phase: 'fase-que-nao-existe', targetKey: null });
    expect(view.phase.phase).toBe('discovery');
  });
});

describe('o assunto do disparo: discovery, plano ou item', () => {
  it('a fase Discovery roda sobre o próprio card', () => {
    const view = dispatchView(card([nasceCard(), nascePlano(), nasceItem()]), { phase: 'discovery', targetKey: null });

    expect(view.targets).toHaveLength(1);
    expect(view.target?.entity).toBe('discovery');
    expect(view.target?.planId).toBeNull();
    expect(view.target?.workItemId).toBeNull();
  });

  it('a fase Plano roda sobre um PLANO — e é ele que vai no run-input', () => {
    const view = dispatchView(card([nasceCard(), nascePlano()]), { phase: 'plano', targetKey: null });

    expect(view.target?.entity).toBe('plan');
    expect(view.target?.planId).toBe('pln-1');
    expect(view.target?.label).toContain('Tornar a fila observável');
  });

  it('a fase de item roda sobre um ITEM, e leva o plano dele junto', () => {
    const view = dispatchView(card([nasceCard(), nascePlano(), nasceItem()]), { phase: 'implementar', targetKey: null });

    expect(view.target?.entity).toBe('work_item');
    expect(view.target?.workItemId).toBe('wi-1');
    expect(view.target?.planId).toBe('pln-1');
    expect(view.canDispatch).toBe(true);
  });

  it('com dois itens, escolher o assunto escolhe o item — e a escolha vale', () => {
    const view = dispatchView(
      card([nasceCard(), nascePlano(), nasceItem(), nasceItem({ id: 'wi-2', title: 'Segundo item', targetRepo: 'beacon' })]),
      { phase: 'implementar', targetKey: 'work_item:wi-2' },
    );

    expect(view.targets.map((target) => target.workItemId)).toEqual(['wi-1', 'wi-2']);
    expect(view.target?.workItemId).toBe('wi-2');
    expect(view.target?.targetRepo).toBe('beacon');
  });

  it('assunto escolhido que não pertence à fase é ignorado, sem quebrar a tela', () => {
    const view = dispatchView(card([nasceCard(), nascePlano(), nasceItem()]), { phase: 'plano', targetKey: 'work_item:wi-1' });
    expect(view.target?.entity).toBe('plan');
  });
});

describe('D-6 cobrado na tela, antes de o clique falhar', () => {
  it('item issue sem repo alvo não dispara — e a frase diz que o app não escolhe repo por ninguém', () => {
    const view = dispatchView(card([nasceCard(), nascePlano(), nasceItem({ targetRepo: null })]), {
      phase: 'implementar',
      targetKey: null,
    });

    expect(view.canDispatch).toBe(false);
    expect(view.blocked).toContain('repo');
    expect(view.blocked).toContain('issue');
    expect(view.target?.blocked).toBe(view.blocked);
  });

  it('item issue sem repo próprio HERDA o do card — e a tela diz que herdou', () => {
    const view = dispatchView(card([nasceCard('atlas'), nascePlano(), nasceItem({ targetRepo: null })]), {
      phase: 'implementar',
      targetKey: null,
    });

    expect(view.target?.targetRepo).toBe('atlas');
    expect(view.target?.repoNote).toContain('herdado');
    expect(view.canDispatch).toBe(true);
  });

  it('o repo do próprio item vence o do card, e sem nota de herança', () => {
    const view = dispatchView(card([nasceCard('atlas'), nascePlano(), nasceItem({ targetRepo: 'beacon' })]), {
      phase: 'implementar',
      targetKey: null,
    });

    expect(view.target?.targetRepo).toBe('beacon');
    expect(view.target?.repoNote).toBeNull();
  });

  it('spike sem repo dispara: a exigência de repo é do issue, não de todo item', () => {
    const view = dispatchView(card([nasceCard(), nascePlano(), nasceItem({ itemType: 'spike', targetRepo: null })]), {
      phase: 'implementar',
      targetKey: null,
    });

    expect(view.target?.targetRepo).toBeNull();
    expect(view.canDispatch).toBe(true);
  });
});

describe('a trava pesa na cadeia para cima, e só nela', () => {
  const travaEm = (entity: string, id: string, phase: string): StoreEvent =>
    evt('lock.acquired', { subject: { entity, id }, phase, holderKind: 'app', acquiredAt: '2026-08-04T12:30:00.000Z' });

  it('discovery travado impede disparar o item que desce dele', () => {
    const view = dispatchView(
      card([nasceCard(), nascePlano(), nasceItem(), travaEm('discovery', 'dsc-1', 'discovery')]),
      { phase: 'implementar', targetKey: null },
    );

    expect(view.canDispatch).toBe(false);
    expect(view.blocked).toContain('discovery');
    expect(view.blocked).toContain('Libere');
  });

  it('item travado NÃO impede o irmão — dois itens rodam em paralelo', () => {
    const events = [
      nasceCard(),
      nascePlano(),
      nasceItem(),
      nasceItem({ id: 'wi-2', title: 'Segundo item', targetRepo: 'beacon' }),
      travaEm('work_item', 'wi-1', 'implementar'),
    ];

    expect(dispatchView(card(events), { phase: 'implementar', targetKey: 'work_item:wi-1' }).canDispatch).toBe(false);
    expect(dispatchView(card(events), { phase: 'implementar', targetKey: 'work_item:wi-2' }).canDispatch).toBe(true);
  });
});

describe('o invariante: recusar sem dizer por quê é o que a spec proíbe', () => {
  it('toda combinação que não dispara traz uma frase, nunca um silêncio', () => {
    const fixtures: readonly (readonly StoreEvent[])[] = [
      [nasceCard()],
      [nasceCard(), nascePlano()],
      [nasceCard(), nascePlano(), nasceItem({ targetRepo: null })],
      [nasceCard(), nascePlano(), nasceItem(), evt('lock.acquired', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', holderKind: 'app', acquiredAt: 'x' })],
    ];

    for (const events of fixtures) {
      const view = dispatchView(card(events), { phase: 'discovery', targetKey: null });
      for (const phase of view.phases) {
        const under = dispatchView(card(events), { phase: phase.phase, targetKey: null });
        if (under.canDispatch) continue;
        expect(under.blocked, `fase ${phase.phase} recusada sem frase`).toBeTruthy();
        expect(under.blocked!.length).toBeGreaterThan(20);
      }
    }
  });

  it('quando dá para disparar, a tela explica o que o clique faz', () => {
    const view = dispatchView(card([nasceCard()]), { phase: 'discovery', targetKey: null });
    expect(view.canDispatch).toBe(true);
    expect(view.hint).toContain('skill');
  });
});

// Costura do merge da 010 (04/08): as duas fases que fecham o ciclo entraram
// com a skill 3.0 do B7, e o handoff do B2 pediu exatamente isto — uma linha
// por fase no catálogo, com a frase de "por que não dá agora" junto (D-4).
describe('as fases do B7 no catálogo — documentar e concluir', () => {
  it('a tela as oferece, rodando sobre item, na ordem do ciclo', () => {
    const view = dispatchView(card([nasceCard()]), { phase: 'discovery', targetKey: null });
    expect(view.phases.map((entry) => entry.phase)).toEqual([
      'discovery',
      'plano',
      'implementar',
      'validar',
      'documentar',
      'concluir',
    ]);
    expect(fase(view, 'documentar').runsOn).toBe('work_item');
    expect(fase(view, 'concluir').runsOn).toBe('work_item');
  });

  it('sem item, as duas ficam desabilitadas com a razão do ciclo escrita', () => {
    const view = dispatchView(card([nasceCard(), nascePlano()]), { phase: 'documentar', targetKey: null });

    const documentar = fase(view, 'documentar');
    expect(documentar.enabled).toBe(false);
    expect(documentar.reason).toContain('artefato');
    expect(documentar.reason).toContain('D-16');

    const concluir = fase(view, 'concluir');
    expect(concluir.enabled).toBe(false);
    expect(concluir.reason).toContain('verifica');
    expect(concluir.reason).toContain('ciclo');
  });

  it('com um item vivo, as duas habilitam — e o assunto do disparo é o item', () => {
    const view = dispatchView(card([nasceCard(), nascePlano(), nasceItem()]), { phase: 'concluir', targetKey: null });
    expect(fase(view, 'concluir').enabled).toBe(true);
    expect(view.target?.entity).toBe('work_item');
  });
});
