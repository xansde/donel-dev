import { describe, expect, it } from 'vitest';
import { parseSeedDocument, SEED_DOCUMENT_EXAMPLE, seedToEvents } from '../src/shared/esteira/store/seed';

// Spec 010 (D-2) — o SEED. O store nasce limpo de proposito: nada de importacao
// de legado. Mas trabalho em curso existe, e sem este caminho a unica saida
// seria escrever JSON na mao dentro do `events.jsonl` — exatamente o que o
// formato foi desenhado para evitar.
//
// O que este teste amarra:
//
// 1. O documento e LIDO com o mesmo rigor dos contratos: campo desconhecido e
//    erro, com caminho. "Sem edicao manual as cegas" e isto — o app diz o que
//    esta errado, em vez de aceitar e mentir depois.
// 2. Seed e AFIRMACAO, nao fato observado: os eventos saem sem `createdBySkill`
//    e a proveniencia vai no `source` do evento (a marca que a tela mostra).
// 3. D-6 sobrevive ao seed: `issue` sem repo alvo nao entra, nem herdando.

function parse(document: unknown): ReturnType<typeof parseSeedDocument> {
  return parseSeedDocument(typeof document === 'string' ? document : JSON.stringify(document));
}

const AT = '2026-08-04T15:00:00.000Z';

function ids(): (prefix: string) => string {
  let seq = 0;
  return (prefix: string) => {
    seq += 1;
    return `${prefix}-${seq}`;
  };
}

const COMPLETO = {
  discovery: {
    title: 'Fila de importacao trava sem sinal',
    problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
    target_repo: 'donel-dev',
    scope_repos: ['donel-dev'],
  },
  phases: [{ phase: 'discovery', outcome: 'done', summary: 'Um plano proposto.' }],
  plans: [{ ref: 'p1', title: 'Tornar o estado da fila observavel' }],
  items: [
    { title: 'Instrumentar o consumidor', type: 'issue', state: 'in-progress', plan: 'p1' },
    { title: 'Medir o custo do log', type: 'spike', state: 'open', plan: 'p1' },
  ],
};

describe('parseSeedDocument — o rigor de leitura', () => {
  it('le o documento completo e resolve os refs', () => {
    const result = parse(COMPLETO);
    if (!result.ok) throw new Error(`esperava ok: ${JSON.stringify(result.issues)}`);

    expect(result.seed.discovery.title).toBe('Fila de importacao trava sem sinal');
    expect(result.seed.plans).toHaveLength(1);
    expect(result.seed.items).toHaveLength(2);
    expect(result.seed.items[0].state).toBe('in-progress');
    expect(result.seed.phases[0]).toEqual({ phase: 'discovery', outcome: 'done', summary: 'Um plano proposto.' });
  });

  it('o exemplo que o app oferece e valido — o botao nao pode entregar um documento que o parser recusa', () => {
    expect(parseSeedDocument(SEED_DOCUMENT_EXAMPLE).ok).toBe(true);
  });

  it('JSON quebrado vira erro com codigo, nunca excecao', () => {
    const result = parseSeedDocument('{ isto nao e json');
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues[0].code).toBe('invalid_json');
  });

  it('documento vazio ou que nao e objeto e recusado', () => {
    expect(parseSeedDocument('   ').ok).toBe(false);
    const lista = parseSeedDocument('[]');
    if (lista.ok) throw new Error('esperava recusa');
    expect(lista.issues[0].code).toBe('not_an_object');
  });

  it('titulo do discovery e obrigatorio, com caminho', () => {
    const result = parse({ discovery: { problem: 'x' } });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_field', path: 'discovery.title' }));
  });

  it('campo desconhecido e ERRO, nao ruido ignorado', () => {
    const result = parse({ ...COMPLETO, discovery: { ...COMPLETO.discovery, fanout_cards: ['card-1'] } });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'unknown_field', path: 'discovery.fanout_cards' }));
  });

  it('tipo e estado do item saem do enum — nada de estado inventado', () => {
    const result = parse({ ...COMPLETO, items: [{ title: 'x', type: 'epico', state: 'quase', plan: 'p1' }] });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'not_in_enum', path: 'items[0].type' }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'not_in_enum', path: 'items[0].state' }));
  });

  it('item que aponta para um plano nao declarado e recusado — ref orfa vira item sem plano calado', () => {
    const result = parse({ ...COMPLETO, items: [{ title: 'x', type: 'spike', state: 'open', plan: 'p9' }] });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_required_fact', path: 'items[0].plan' }));
  });

  it('dois planos com o mesmo ref sao recusados — ref ambiguo amarraria o item no plano errado', () => {
    const result = parse({ ...COMPLETO, plans: [{ ref: 'p1', title: 'A' }, { ref: 'p1', title: 'B' }] });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'bad_format', path: 'plans[1].ref' }));
  });

  it('D-6 sobrevive ao seed: issue sem repo alvo nao entra', () => {
    const result = parse({
      discovery: { title: 'Sem repo' },
      items: [{ title: 'Corrigir x', type: 'issue', state: 'open' }],
    });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'issue_without_target_repo', path: 'items[0].target_repo' }));
  });

  it('o item HERDA o repo do discovery (D-6) — e ai a issue passa', () => {
    const result = parse({
      discovery: { title: 'Com repo', target_repo: 'donel-dev' },
      items: [{ title: 'Corrigir x', type: 'issue', state: 'open' }],
    });
    if (!result.ok) throw new Error(`esperava ok: ${JSON.stringify(result.issues)}`);
    expect(result.seed.items[0].targetRepo).toBe('donel-dev');
  });

  it('a fase segue o padrao de nome e o desfecho segue o enum', () => {
    const result = parse({ discovery: { title: 'x' }, phases: [{ phase: 'Discovery!', outcome: 'quase' }] });
    if (result.ok) throw new Error('esperava recusa');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'bad_format', path: 'phases[0].phase' }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'not_in_enum', path: 'phases[0].outcome' }));
  });
});

describe('seedToEvents — a afirmacao vira fato local', () => {
  const seeded = (): ReturnType<typeof seedToEvents> => {
    const parsed = parse(COMPLETO);
    if (!parsed.ok) throw new Error('fixture invalida');
    return seedToEvents(parsed.seed, { at: AT, newId: ids() });
  };

  it('produz o discovery, os planos, os itens e as fases declaradas', () => {
    const plano = seeded();
    const tipos = plano.events.map((event) => event.type);

    expect(tipos).toEqual([
      'discovery.created',
      'plan.created',
      'relation.added',
      'work_item.created',
      'work_item.created',
      'phase.completed',
    ]);
    expect(plano.discoveryId).toBe('dsc-1');
    expect(plano.planIds).toEqual(['pln-2']);
    expect(plano.workItemIds).toEqual(['wki-3', 'wki-4']);
  });

  it('o item nasce ligado ao plano e com o estado afirmado', () => {
    const item = seeded().events.find((event) => event.type === 'work_item.created');
    expect(item?.payload).toMatchObject({ planId: 'pln-2', state: 'in-progress', itemType: 'issue', targetRepo: 'donel-dev' });
  });

  it('item semeado NAO diz que nasceu pela skill — seed e afirmacao humana (D-16 nao muda)', () => {
    for (const event of seeded().events.filter((entry) => entry.type === 'work_item.created')) {
      expect(event.payload.createdBySkill).toBe(false);
    }
  });

  it('a fase afirmada vira phase.completed — e por ela que a etapa derivada avanca', () => {
    const fase = seeded().events.find((event) => event.type === 'phase.completed');
    expect(fase?.payload).toMatchObject({ phase: 'discovery', outcome: 'done', subject: { entity: 'discovery', id: 'dsc-1' } });
  });

  it('nenhum evento de seed carrega dedupe_key — semear duas vezes sao dois gestos, nao um repetido', () => {
    expect(seeded().events.every((event) => event.dedupe_key === null)).toBe(true);
  });

  it('todos os eventos carregam a hora do gesto', () => {
    expect(seeded().events.every((event) => event.at === AT)).toBe(true);
  });
});
