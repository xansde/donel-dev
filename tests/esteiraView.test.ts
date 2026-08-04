import { describe, expect, it } from 'vitest';
import {
  cardView,
  ingestErrorLine,
  lockView,
  MIRROR_PENDING_HINT,
  mirrorLines,
  phaseLine,
  phaseLines,
  signalViews,
  stageView,
} from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { DiscoverySnapshot, PhaseRunSnapshot, StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 — o que a TELA diz. Este teste existe por um motivo só: a spec
// inteira nasceu de uma tela que afirmava "fase não realizada" quando o que
// tinha acontecido era "não consegui ler o arquivo". Aqui as duas frases são
// verificadas como coisas distintas.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>): StoreEvent {
  seq += 1;
  return { seq, event_id: `evt-${seq}`, at: '2026-08-03T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

function phase(overrides: Partial<PhaseRunSnapshot>): PhaseRunSnapshot {
  return {
    subject: { entity: 'discovery', id: 'dsc-1' },
    phase: 'discovery',
    startedAt: null,
    completedAt: null,
    outcome: null,
    summary: null,
    failure: null,
    lastRunId: null,
    ...overrides,
  };
}

describe('phaseLine — três estados, três frases', () => {
  it('fase concluída diz que concluiu', () => {
    expect(phaseLine(phase({ completedAt: '2026-08-03T12:41:07.000Z', outcome: 'done' }))).toBe('discovery — concluída');
  });

  it('fase que FALHOU diz que falhou, com o código — nunca "não realizada"', () => {
    const line = phaseLine(phase({ phase: 'implementar', failure: { code: 'worktree-dirty', message: 'x' } }));
    expect(line).toBe('implementar — falhou: worktree-dirty');
    expect(line).not.toContain('não realizada');
  });

  it('fase só iniciada diz que está em andamento', () => {
    expect(phaseLine(phase({ startedAt: '2026-08-03T12:00:00.000Z' }))).toBe('discovery — em andamento');
  });

  it('abandonada e inconclusiva tem palavra propria', () => {
    expect(phaseLine(phase({ completedAt: 'x', outcome: 'abandoned' }))).toContain('abandonada');
    expect(phaseLine(phase({ completedAt: 'x', outcome: 'inconclusive' }))).toContain('sem conclusão');
  });
});

describe('sinais do card', () => {
  const discovery = (signals: DiscoverySnapshot['stageSignals']): DiscoverySnapshot => ({
    id: 'dsc-1',
    title: 'Card',
    problem: null,
    tracker: null,
    targetRepo: null,
    scopeRepos: [],
    createdAt: '2026-08-03T12:00:00.000Z',
    derivedStage: 'discovery',
    stageSignals: signals,
    stageOverride: null,
  });

  it('"discovery concluído sem plano" é dito como o desfecho que é, sem tom de erro', () => {
    const [view] = signalViews(discovery(['completed-without-plan']));
    expect(view.label).toBe('sem plano registrado');
    expect(view.tone).toBe('neutral');
    expect(view.title).toContain('não é fase pendente');
  });

  it('falha de leitura aparece como ERRO, e a frase separa "não li" de "não aconteceu"', () => {
    const [view] = signalViews(discovery(['ingest-error']));
    expect(view.label).toBe('não consegui ler');
    expect(view.tone).toBe('error');
    expect(view.title).toContain('não foi perdido');
  });
});

describe('stageView — o override nunca engana quem lê', () => {
  const base: DiscoverySnapshot = {
    id: 'dsc-1',
    title: 'Card',
    problem: null,
    tracker: null,
    targetRepo: null,
    scopeRepos: [],
    createdAt: '2026-08-03T12:00:00.000Z',
    derivedStage: 'discovery',
    stageSignals: [],
    stageOverride: null,
  };

  it('sem override, mostra a etapa derivada', () => {
    expect(stageView(base)).toMatchObject({ shown: 'Discovery', overridden: false });
  });

  it('com override, mostra o ajuste E a derivada ao lado, dizendo quem ajustou', () => {
    const view = stageView({ ...base, stageOverride: { value: 'done', by: 'alexandre', at: 'x', reason: 'entregue fora do app' } });
    expect(view.shown).toBe('Concluído');
    expect(view.derived).toBe('Discovery');
    expect(view.overridden).toBe(true);
    expect(view.overrideNote).toContain('alexandre');
  });
});

describe('cardView — a tela é projeção, não cálculo', () => {
  it('junta plano, itens, fases, notas e trava do card', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: '2026-08-03T12:00:00.000Z' }),
      evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Plano' }),
      evt('work_item.created', {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: 'pln-1',
        itemType: 'issue',
        title: 'Item',
        targetRepo: 'atlas',
        state: 'open',
        createdAt: '2026-08-03T12:00:00.000Z',
      }),
      evt('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: 'x' }),
      evt('note.added', { subject: { entity: 'work_item', id: 'wi-1' }, text: 'nota do item', at: 'x' }),
      evt('lock.acquired', { subject: { entity: 'work_item', id: 'wi-1' }, phase: 'implementar', holderKind: 'app', acquiredAt: 'x' }),
    ]);

    const view = cardView(snapshot, 'dsc-1');
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.planCount).toBe(1);
    expect(view.items).toHaveLength(1);
    expect(view.phases).toHaveLength(1);
    expect(view.notes).toHaveLength(1);
    expect(view.lock?.phase).toBe('implementar');
  });

  it('o erro de ingestão do card vem junto — a tela não teria como escondê-lo', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: '2026-08-03T12:00:00.000Z' }),
      evt('ingest.failed', {
        resultPath: 'C:/outbox/run-9.json',
        at: 'x',
        subject: { entity: 'discovery', id: 'dsc-1' },
        issues: [{ code: 'unknown_field', path: 'facts[0].fanout', message: 'x' }],
      }),
    ]);

    const view = cardView(snapshot, 'dsc-1');
    expect(view?.ingestErrors).toHaveLength(1);
    expect(view?.signals.some((signal) => signal.tone === 'error')).toBe(true);
    expect(ingestErrorLine(view!.ingestErrors[0])).toBe('unknown_field em facts[0].fanout');
  });

  it('card que não existe devolve null — a tela não inventa card', () => {
    expect(cardView(reduceEvents([]), 'dsc-fantasma')).toBeNull();
  });
});

describe('lockView — a tela não promete o que não cumpre', () => {
  function cardWithLock(claimed: boolean, holderKind: 'app' | 'skill' = 'app') {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: '2026-08-03T12:00:00.000Z' }),
      evt('lock.acquired', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        holderKind,
        acquiredAt: '2026-08-03T12:00:00.000Z',
      }),
      evt('session.started', {
        id: 'ses-1',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        startedAt: '2026-08-03T12:00:00.000Z',
        inputPath: 'C:/inbox/run-1.json',
        resultPath: 'C:/outbox/run-1.json',
        ...(claimed ? { cliSessionId: 'cli-1' } : {}),
      }),
    ]);
    return cardView(snapshot, 'dsc-1')!;
  }

  it('fase preparada e sem ninguém a assumindo NÃO se chama "em andamento"', () => {
    const view = lockView(cardWithLock(false))!;
    expect(view.title).toBe('Preparada — ninguém assumiu ainda');
    expect(view.line).toContain('Nada está rodando');
    expect(view.title).not.toContain('Em andamento');
  });

  it('e diz o próximo passo, com o caminho do contexto que o app deixou', () => {
    const view = lockView(cardWithLock(false))!;
    expect(view.nextStep?.command).toContain('read_input.py');
    expect(view.nextStep?.command).toContain('C:/inbox/run-1.json');
  });

  it('quando alguém assumiu de verdade, aí sim é "em andamento" — e sem próximo passo', () => {
    const view = lockView(cardWithLock(true))!;
    expect(view.title).toBe('Em andamento');
    expect(view.nextStep).toBeNull();
  });

  it('trava posta pela própria skill já é trabalho acontecendo', () => {
    expect(lockView(cardWithLock(false, 'skill'))!.title).toBe('Em andamento');
  });

  it('card sem trava não tem bloco nenhum', () => {
    const snapshot = reduceEvents([evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' })]);
    expect(lockView(cardView(snapshot, 'dsc-1')!)).toBeNull();
  });
});

describe('phaseLines — "disparar" não é "começar", nem na lista de fases', () => {
  it('fase disparada e não assumida diz que ninguém assumiu', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: 'x' }),
      evt('session.started', { id: 'ses-1', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', startedAt: 'x' }),
    ]);
    const [line] = phaseLines(cardView(snapshot, 'dsc-1')!);
    expect(line.text).toBe('discovery — preparada, ninguém assumiu');
  });

  it('assumida pela skill vira "em andamento"', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: 'x' }),
      evt('session.started', { id: 'ses-1', cliSessionId: 'cli-1', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', startedAt: 'x' }),
    ]);
    expect(phaseLines(cardView(snapshot, 'dsc-1')!)[0].text).toBe('discovery — em andamento');
  });

  it('fase concluída não depende de sessão nenhuma', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: 'x' }),
    ]);
    expect(phaseLines(cardView(snapshot, 'dsc-1')!)[0].text).toBe('discovery — concluída');
  });

  it('fase que falhou traz o motivo junto', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.failed', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        failure: { code: 'worktree-dirty', message: 'Havia alterações não commitadas.' },
        at: 'x',
      }),
    ]);
    const [line] = phaseLines(cardView(snapshot, 'dsc-1')!);
    expect(line.failed).toBe(true);
    expect(line.detail).toBe('Havia alterações não commitadas.');
  });
});

describe('espelho pendente — o card diz o que o board não recebeu (D-12)', () => {
  function cardComFila(operation: string, payload: Record<string, unknown>, falha: string | null = null) {
    const subject = { entity: 'discovery', id: 'dsc-1' };
    const events = [
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x', tracker: { provider: 'taskdex', cardId: 'card-4711' } }),
      evt('mirror.queued', { subject, operation, payload, queuedAt: '2026-08-03T12:00:00.000Z' }),
    ];
    if (falha !== null) events.push(evt('mirror.failed', { subject, operation, error: falha }));
    return cardView(reduceEvents(events), 'dsc-1')!;
  }

  it('a fila do card chega até a tela', () => {
    expect(cardComFila('column', { column: 'Plano' }).mirrorQueue).toHaveLength(1);
  });

  it('cada operação tem frase própria, em português', () => {
    expect(mirrorLines(cardComFila('column', { column: 'Plano' }))[0].text).toBe('mover o card para "Plano"');
    expect(mirrorLines(cardComFila('label', { labels: ['esteira:em-andamento:plano'] }))[0].text).toBe(
      'aplicar a etiqueta "esteira:em-andamento:plano"',
    );
    expect(mirrorLines(cardComFila('label', { labels: [] }))[0].text).toBe('remover as etiquetas de fase');
    expect(mirrorLines(cardComFila('comment:run-1', { text: 'x', phase: 'discovery' }))[0].text).toBe(
      'comentar a conclusão da fase discovery',
    );
  });

  it('operação que o app não sabe espelhar diz isso — nunca finge que mandou', () => {
    expect(mirrorLines(cardComFila('publicar-card', {}))[0].text).toContain('não sei espelhar');
  });

  it('o MOTIVO da falha aparece, com quantas vezes já tentou', () => {
    const [line] = mirrorLines(cardComFila('column', { column: 'Plano' }, 'sem rede'));
    expect(line.detail).toBe('1 tentativa — sem rede');
  });

  it('enfileirado e ainda não tentado diz exatamente isso', () => {
    expect(mirrorLines(cardComFila('column', { column: 'Plano' }))[0].detail).toBe('ainda não tentou');
  });

  it('o card avisa que o local NÃO depende do espelho', () => {
    expect(MIRROR_PENDING_HINT).toContain('local');
    expect(cardComFila('column', { column: 'Plano' }).signals.some((signal) => signal.label === 'espelho pendente')).toBe(true);
  });
});
