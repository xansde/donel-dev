import { describe, expect, it } from 'vitest';
import { cardContent, cardView, dispatchView, itemRepoOf } from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { CardView } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010, batch B2 — achado da CAPTURA e2e, não do teste.
//
// O print 16 do roteiro `disparo-por-assunto` mostrou a MESMA tela dizendo duas
// coisas incompatíveis sobre o MESMO item, com quatro linhas de distância:
//
//   Planos e itens …  "Medir onde o lote para · spike · open · sem repo alvo"
//   Repo alvo:        "donel-dev — repo herdado do card"
//
// A herança de repo existia só na view do DISPARO; a lista de itens era montada
// à mão no JSX e não sabia dela. É o erro conhecido nº 1 outra vez — a correção
// parou na frase onde o defeito apareceu em vez de descer até a função que
// produz o texto. Daí este arquivo: as duas frases nascem da MESMA função.
//
// Junto vieram dois defeitos que o mesmo print revelou:
//   - o título contava "1 plano(s)" e a lista não mostrava plano nenhum;
//   - o item travado não se distinguia do livre na lista, enquanto a razão do
//     bloqueio mandava "libere a trava" sem dizer qual.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at: '2026-08-04T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

const nasceCard = (targetRepo: string | null = 'atlas'): StoreEvent =>
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

const trava = (subject: Record<string, unknown>, phase: string): StoreEvent =>
  evt('lock.acquired', { subject, phase, holderKind: 'app', acquiredAt: '2026-08-04T12:30:00.000Z' });

function card(events: readonly StoreEvent[]): CardView {
  const view = cardView(reduceEvents(events), 'dsc-1');
  if (view === null) throw new Error('fixture sem card');
  return view;
}

function linhaDoItem(view: CardView, titulo: string): string {
  const line = cardContent(view).lines.find((entry) => entry.text.startsWith(titulo));
  if (line === undefined) throw new Error(`a lista não tem o item ${titulo}`);
  return line.text;
}

describe('a lista de itens e o disparo dizem a MESMA coisa sobre o repo', () => {
  it('item sem repo próprio: a lista diz que herdou do card, não "sem repo alvo"', () => {
    const view = card([nasceCard('atlas'), nascePlano(), nasceItem({ itemType: 'spike', targetRepo: null, title: 'Medir onde o lote para' })]);

    const linha = linhaDoItem(view, 'Medir onde o lote para');
    expect(linha).toContain('atlas');
    expect(linha).toContain('herdado do card');
    // A frase do print 16, que dizia o contrário do disparo logo abaixo.
    expect(linha).not.toContain('sem repo alvo');
  });

  it('a lista e a linha do disparo concordam sobre o mesmo item', () => {
    const view = card([nasceCard('atlas'), nascePlano(), nasceItem({ itemType: 'spike', targetRepo: null, title: 'Medir onde o lote para' })]);
    const alvo = dispatchView(view, { phase: 'implementar', targetKey: 'work_item:wi-1' }).target;

    expect(alvo?.targetRepo).toBe('atlas');
    expect(alvo?.repoNote).toBe('repo herdado do card');
    expect(linhaDoItem(view, 'Medir onde o lote para')).toContain(alvo?.targetRepo ?? '<sem repo>');
  });

  it('item com repo próprio não ganha sufixo de herança', () => {
    const linha = linhaDoItem(card([nasceCard('atlas'), nascePlano(), nasceItem()]), 'Instrumentar o consumo');

    expect(linha).toContain('atlas');
    expect(linha).not.toContain('herdado');
  });

  it('sem repo no item E sem repo no card, a lista diz "sem repo alvo" — e é verdade', () => {
    const view = card([nasceCard(null), nascePlano(), nasceItem({ itemType: 'spike', targetRepo: null })]);

    expect(linhaDoItem(view, 'Instrumentar o consumo')).toContain('sem repo alvo');
    expect(itemRepoOf(view.items[0], view.discovery)).toEqual({ repo: null, inherited: false });
  });
});

describe('o que o título conta, a lista mostra', () => {
  it('o plano contado aparece nomeado na lista', () => {
    const conteudo = cardContent(card([nasceCard(), nascePlano()]));

    expect(conteudo.title).toContain('1 plano');
    expect(conteudo.lines.map((line) => line.text)).toContain('Plano — Tornar a fila observável');
  });

  it('plano e item aparecem juntos, plano primeiro', () => {
    const conteudo = cardContent(card([nasceCard(), nascePlano(), nasceItem()]));

    expect(conteudo.lines).toHaveLength(2);
    expect(conteudo.lines[0]?.kind).toBe('plan');
    expect(conteudo.lines[1]?.kind).toBe('item');
  });

  it('o plural é português: 1 plano, 1 item — nunca "item(ns)"', () => {
    const um = cardContent(card([nasceCard(), nascePlano(), nasceItem()]));
    expect(um.title).toBe('Planos e itens (1 plano, 1 item)');

    const dois = cardContent(card([nasceCard(), nascePlano(), nasceItem(), nasceItem({ id: 'wi-2', title: 'Outro' })]));
    expect(dois.title).toBe('Planos e itens (1 plano, 2 itens)');

    const nenhum = cardContent(card([nasceCard()]));
    expect(nenhum.title).toBe('Planos e itens (nenhum plano, nenhum item)');
  });

  it('card vazio continua com o desfecho escrito, não com uma lista muda', () => {
    const conteudo = cardContent(card([nasceCard()]));

    expect(conteudo.lines).toHaveLength(0);
    expect(conteudo.note).toContain('desfecho');
  });

  it('plano sem item diz que o item ainda não veio — sem apagar o plano da lista', () => {
    const conteudo = cardContent(card([nasceCard(), nascePlano()]));

    expect(conteudo.lines).toHaveLength(1);
    expect(conteudo.note).toContain('item');
  });
});

describe('o item travado se distingue do livre — na lista, não só no bloco da trava', () => {
  it('a linha do item travado nomeia a fase que o travou', () => {
    const view = card([
      nasceCard(),
      nascePlano(),
      nasceItem(),
      nasceItem({ id: 'wi-2', title: 'O irmão' }),
      trava({ entity: 'work_item', id: 'wi-1' }, 'implementar'),
    ]);

    expect(linhaDoItem(view, 'Instrumentar o consumo')).toContain('implementar');
    expect(linhaDoItem(view, 'Instrumentar o consumo')).toContain('travad');
  });

  it('o irmão do item travado continua sem marca — a trava não vale para ele', () => {
    const view = card([
      nasceCard(),
      nascePlano(),
      nasceItem(),
      nasceItem({ id: 'wi-2', title: 'O irmão' }),
      trava({ entity: 'work_item', id: 'wi-1' }, 'implementar'),
    ]);

    expect(linhaDoItem(view, 'O irmão')).not.toContain('travad');
  });

  it('trava no discovery não pinta os itens de travados — quem está travado é o card', () => {
    const view = card([nasceCard(), nascePlano(), nasceItem(), trava({ entity: 'discovery', id: 'dsc-1' }, 'discovery')]);

    expect(linhaDoItem(view, 'Instrumentar o consumo')).not.toContain('travad');
  });
});
