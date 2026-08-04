import { describe, expect, it } from 'vitest';
import {
  cardView,
  ingestErrorLine,
  cardContent,
  lockView,
  MIRROR_PENDING_HINT,
  mirrorLines,
  phaseLine,
  phaseLines,
  provenanceMark,
  scanMessage,
  SEEDED_CARD_NOTE,
  seedIssueLine,
  seedIssuesShown,
  seededSummary,
  signalViews,
  stageView,
  verificationLines,
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
    seeded: false,
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

  it('fase só declarada iniciada (sem sessão do app) diz que está em andamento', () => {
    expect(phaseLine(phase({ startedAt: '2026-08-03T12:00:00.000Z' }))).toBe('discovery — em andamento');
  });

  it('sessão aberta pelo app tem palavra PRÓPRIA: a aba existe, o Enter pode não ter acontecido', () => {
    const line = phaseLine(phase({ startedAt: '2026-08-03T12:00:00.000Z' }), 'claimed');
    expect(line).toBe('discovery — sessão aberta');
    expect(line).not.toContain('em andamento');
  });

  it('fase cuja sessão acabou sem concluir diz que foi INTERROMPIDA — nunca "em andamento"', () => {
    const line = phaseLine(phase({ startedAt: '2026-08-03T12:00:00.000Z' }), 'interrupted');
    expect(line).toBe('discovery — interrompida: a sessão terminou sem concluir');
    expect(line).not.toContain('em andamento');
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
    seeded: false,
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
    seeded: false,
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
    expect(view.plans).toHaveLength(1);
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

  it('e diz o próximo passo, com o MESMO comando que a aba receberia', () => {
    const view = lockView(cardWithLock(false))!;
    // Uma função só produz o comando (`esteiraPhaseCommand`) — se aqui fosse
    // outro texto, a correção de um dos dois envelheceria calada.
    expect(view.nextStep?.command).toBe('/esteira-discovery --input "C:/inbox/run-1.json"');
  });

  it('sessão aberta pelo app NÃO se chama "em andamento": abrir a aba não é apertar o Enter', () => {
    // O print 07 do roteiro `disparo-abre-sessao` dizia "Em andamento" enquanto
    // o print 10, da MESMA rodada, mostrava o comando parado no prompt. O app
    // sabe que a aba abriu; ele não sabe se alguém enviou o comando — e a tela
    // não pode afirmar o que o app não sabe.
    const view = lockView(cardWithLock(true))!;
    expect(view.state).toBe('session-open');
    expect(view.title).toBe('Sessão aberta');
    expect(view.title).not.toContain('andamento');
    expect(view.nextStep).toBeNull();
  });

  it('e a linha admite o limite do que o app sabe, em vez de prometer trabalho acontecendo', () => {
    expect(lockView(cardWithLock(true))!.line).toContain('o app não sabe se você já o enviou');
  });

  it('assumida: a linha nomeia a SESSÃO que segura a trava — dono, hora e sessão (D-11)', () => {
    const view = lockView(cardWithLock(true))!;
    expect(view.line).toContain('cli-1');
  });

  it('trava posta pela própria skill já é trabalho acontecendo', () => {
    const view = lockView(cardWithLock(false, 'skill'))!;
    expect(view.state).toBe('running');
    expect(view.title).toBe('Em andamento');
  });

  it('preparada tem estado próprio — os três nunca compartilham palavra', () => {
    expect(lockView(cardWithLock(false))!.state).toBe('prepared');
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

  it('sessão do CLI assumiu: a linha diz "sessão aberta", não "em andamento"', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: 'x' }),
      evt('session.started', { id: 'ses-1', cliSessionId: 'cli-1', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', startedAt: 'x' }),
    ]);
    expect(phaseLines(cardView(snapshot, 'dsc-1')!)[0].text).toBe('discovery — sessão aberta');
  });

  it('as duas frases do MESMO estado saem da mesma decisão — o bloco e a lista nunca divergem', () => {
    // O defeito de 03/08 foi corrigido no bloco e reapareceu na lista. Este
    // teste amarra os dois: o estado da trava é um só, e as duas frases dele
    // são derivadas dele, não escritas em dois lugares.
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('lock.acquired', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', holderKind: 'app', acquiredAt: 'x' }),
      evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: 'x' }),
      evt('session.started', { id: 'ses-1', cliSessionId: 'cli-1', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', startedAt: 'x' }),
    ]);
    const card = cardView(snapshot, 'dsc-1')!;
    expect(lockView(card)!.state).toBe('session-open');
    expect(phaseLines(card)[0].text).toContain('sessão aberta');
    expect(phaseLines(card)[0].text).not.toContain('em andamento');
  });

  it('fase declarada pela skill, sem sessão do app, continua "em andamento" — é o que a skill afirmou', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: 'x' }),
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

  it('sessão encerrada sem a fase concluir: a fase fica INTERROMPIDA, não "em andamento"', () => {
    // O caso do batch B1: a aba foi fechada na mão. Sem esta regra, a lista de
    // fases voltava a dizer "em andamento" — que é o mesmo defeito de 03/08
    // reaparecendo por outra porta (nenhuma sessão aberta = ninguém para
    // desmentir a frase otimista).
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('phase.started', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: 'x' }),
      evt('session.started', { id: 'ses-1', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', startedAt: 'x' }),
      evt('session.claimed', { id: 'ses-1', cliSessionId: 'cli-1', at: 'x' }),
      evt('session.ended', { id: 'ses-1', at: 'x', reason: 'tab-closed' }),
    ]);
    expect(phaseLines(cardView(snapshot, 'dsc-1')!)[0].text).toBe('discovery — interrompida: a sessão terminou sem concluir');
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

// ---------------------------------------------------------------------------
// A frase da varredura. Achada num print do roteiro `espelho-pendente`: a
// barra dizia "Nada novo no outbox." no MESMO instante em que a fase virava
// "concluída", a etapa ia para Planejado e um plano aparecia na tela. A frase
// só sabia de arquivo RECUSADO; ingerido e ilegível não tinham palavra.
// ---------------------------------------------------------------------------
describe('o que a varredura do outbox diz ter acontecido', () => {
  it('varredura sem nada novo diz isso, e só isso', () => {
    expect(scanMessage({ ingestedOnLastScan: 0, rejectedOnLastScan: 0, unreadableOnLastScan: 0 })).toBe(
      'Nada novo no outbox.',
    );
  });

  it('resultado ingerido NAO pode ser anunciado como "nada novo" — o card acabou de mudar', () => {
    const frase = scanMessage({ ingestedOnLastScan: 1, rejectedOnLastScan: 0, unreadableOnLastScan: 0 });

    expect(frase).not.toContain('Nada novo');
    expect(frase).toContain('1 resultado(s)');
  });

  it('arquivo fora do contrato continua tendo a frase que manda olhar o card', () => {
    expect(scanMessage({ ingestedOnLastScan: 0, rejectedOnLastScan: 2, unreadableOnLastScan: 0 })).toContain(
      '2 arquivo(s) fora do contrato',
    );
  });

  it('"nao consegui ler" tem palavra propria — nunca vira ausencia silenciosa', () => {
    const frase = scanMessage({ ingestedOnLastScan: 0, rejectedOnLastScan: 0, unreadableOnLastScan: 1 });

    expect(frase).not.toContain('Nada novo');
    expect(frase).toContain('não consegui ler');
  });

  it('as tres coisas na mesma varredura aparecem todas — nenhuma esconde a outra', () => {
    const frase = scanMessage({ ingestedOnLastScan: 3, rejectedOnLastScan: 1, unreadableOnLastScan: 1 });

    expect(frase).toContain('3 resultado(s)');
    expect(frase).toContain('fora do contrato');
    expect(frase).toContain('não consegui ler');
  });
});

// ---------------------------------------------------------------------------
// D-2 — o que foi SEMEADO x o que veio declarado por skill
// ---------------------------------------------------------------------------

describe('a tela distingue afirmação de fato observado', () => {
  /** Um evento com `source: { kind: 'seed' }` — o gesto humano de plantar. */
  function semeado(type: string, payload: Record<string, unknown>): StoreEvent {
    return { ...evt(type, payload), source: { kind: 'seed' } };
  }

  const cardSemeado = (): ReturnType<typeof cardView> =>
    cardView(
      reduceEvents([
        semeado('discovery.created', { id: 'dsc-1', title: 'Trabalho que já existia', createdAt: 'x' }),
        semeado('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: 'x' }),
        semeado('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Plano' }),
        semeado('work_item.created', {
          id: 'wi-1',
          discoveryId: 'dsc-1',
          planId: 'pln-1',
          itemType: 'issue',
          title: 'Item em curso',
          targetRepo: 'atlas',
          state: 'in-progress',
        }),
      ]),
      'dsc-1',
    );

  it('o card semeado ganha marca própria, e ela diz que ninguém observou aquilo', () => {
    const card = cardSemeado()!;
    const mark = provenanceMark(card.discovery.seeded);
    expect(mark?.label).toBe('semeado');
    expect(mark?.title).toContain('afirm');
    expect(mark?.title.toLowerCase()).toContain('nenhuma skill');
  });

  it('card declarado por skill não ganha marca nenhuma — a ausência é o default', () => {
    const snapshot = reduceEvents([evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' })]);
    expect(provenanceMark(cardView(snapshot, 'dsc-1')!.discovery.seeded)).toBeNull();
  });

  // Costura B2×B4: as linhas nascem em `cardContent` (a fonte única do bloco,
  // que o B2 criou) e carregam a marca de proveniência que o B4 trouxe —
  // `itemLines`/`planLines` do B4 eram uma segunda solução do mesmo problema.
  it('a linha do item semeado carrega a marca, sem perder o que ela já dizia', () => {
    const [linha] = cardContent(cardSemeado()!).lines.filter((line) => line.kind === 'item');
    expect(linha.text).toContain('Item em curso');
    expect(linha.mark?.label).toBe('semeado');
  });

  it('o plano semeado é NOMEADO, não só contado — senão a marca dele não existe em lugar nenhum', () => {
    const [linha] = cardContent(cardSemeado()!).lines.filter((line) => line.kind === 'plan');
    expect(linha.text).toContain('Plano');
    expect(linha.mark?.label).toBe('semeado');
  });

  it('a fase semeada não é apresentada como fase observada', () => {
    const [linha] = phaseLines(cardSemeado()!);
    expect(linha.text).toBe('discovery — concluída');
    expect(linha.mark?.label).toBe('semeado');
  });

  it('a fase que de fato rodou depois do seed perde a marca', () => {
    const card = cardView(
      reduceEvents([
        semeado('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
        semeado('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: 'x' }),
        evt('phase.completed', { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: 'x' }),
      ]),
      'dsc-1',
    )!;
    expect(phaseLines(card)[0].mark).toBeNull();
    // O card, esse, continua tendo nascido de uma afirmação.
    expect(provenanceMark(card.discovery.seeded)).not.toBeNull();
  });

  it('a nota do card semeado explica o que a marca significa, sem prometer o que não houve', () => {
    expect(SEEDED_CARD_NOTE).toContain('semeado');
    expect(SEEDED_CARD_NOTE).not.toContain('não realizada');
  });
});

describe('erro de seed — o documento é recusado com o motivo, em português', () => {
  it('traduz o código do contrato e mostra o caminho do campo', () => {
    expect(seedIssueLine({ code: 'missing_field', path: 'discovery.title', message: 'x' })).toBe('campo obrigatório ausente — discovery.title');
    expect(seedIssueLine({ code: 'unknown_field', path: 'discovery.fanout', message: 'x' })).toContain('campo que o seed não conhece');
    expect(seedIssueLine({ code: 'issue_without_target_repo', path: 'items[0].target_repo', message: 'x' })).toContain('repo alvo');
  });

  it('JSON quebrado não vira caminho vazio pendurado', () => {
    expect(seedIssueLine({ code: 'invalid_json', path: '', message: 'x' })).toBe('o documento não é JSON válido');
  });

  it('o resumo do que foi plantado conta o que entrou e lembra que é afirmação', () => {
    expect(seededSummary({ plans: 1, items: 2 })).toBe(
      'Semeado: 1 card, 1 plano e 2 itens. Isso é afirmação sua, não fato observado — a tela marca cada um como semeado.',
    );
    expect(seededSummary({ plans: 0, items: 0 })).toContain('nenhum plano e nenhum item');
  });

  // O print do passo 9 do roteiro `seed-discovery` mostrou a lista de recusas
  // sobrevivendo à correção do documento: a tela acusava "campo obrigatório
  // ausente — discovery.title" com o `title` escrito logo acima.
  it('a recusa vale para o documento que a produziu — e some quando ele muda', () => {
    const refusal = {
      document: '{ "discovery": { "titulo": "x" } }',
      issues: [{ code: 'unknown_field' as const, path: 'discovery.titulo', message: 'x' }],
    };
    expect(seedIssuesShown(refusal, '{ "discovery": { "titulo": "x" } }')).toHaveLength(1);
    expect(seedIssuesShown(refusal, '{ "discovery": { "title": "x" } }')).toHaveLength(0);
    // Espaço em volta não é edição: o app manda o documento aparado.
    expect(seedIssuesShown(refusal, '  { "discovery": { "titulo": "x" } }\n')).toHaveLength(1);
    expect(seedIssuesShown(null, 'qualquer coisa')).toHaveLength(0);
  });
});

describe('o bloco de planos e itens conta o que mostra', () => {
  it('o título usa plural de gente, e não "1 plano(s), 2 item(ns)"', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Plano' }),
      evt('work_item.created', { id: 'wi-1', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'issue', title: 'A', targetRepo: 'atlas', state: 'open' }),
      evt('work_item.created', { id: 'wi-2', discoveryId: 'dsc-1', planId: 'pln-1', itemType: 'spike', title: 'B', targetRepo: 'atlas', state: 'open' }),
    ]);
    expect(cardContent(cardView(snapshot, 'dsc-1')!).title).toBe('Planos e itens (1 plano, 2 itens)');
  });

  it('sem plano nenhum, o título diz isso — ausência declarada, não contagem zero', () => {
    const snapshot = reduceEvents([evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' })]);
    const conteudo = cardContent(cardView(snapshot, 'dsc-1')!);
    expect(conteudo.title).toBe('Planos e itens (nenhum plano, nenhum item)');
    expect(conteudo.lines).toHaveLength(0);
  });

  it('o plano registrado aparece com o resumo dele, e não só com o título', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar observável', summary: 'Medir antes de mexer.' }),
    ]);
    const [linha] = cardContent(cardView(snapshot, 'dsc-1')!).lines;
    expect(linha.text).toContain('Tornar observável');
    expect(linha.text).toContain('Medir antes de mexer.');
  });
});

// Spec 010 (B7) — a EVIDÊNCIA na tela. `verifications` entrava no snapshot e
// não saía em lugar nenhum: o PR do item, o check que rodou e a resposta do
// spike ficavam num campo que ninguém lia. Ler um fato e não mostrá-lo não é
// mentira, mas é a mesma perda — a fase declara D-4 e o card não conta.
describe('verificationLines — como cada evidência de D-4 é dita', () => {
  function cardWith(verifications: readonly { kind: string; state: string; ref?: string | null }[]) {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('work_item.created', {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: null,
        itemType: 'issue',
        title: 'Item',
        targetRepo: 'atlas',
        state: 'open',
        createdAt: 'x',
      }),
      ...verifications.map((entry) =>
        evt('verification.updated', {
          subject: { entity: 'work_item', id: 'wi-1' },
          verificationKind: entry.kind,
          state: entry.state,
          ref: entry.ref ?? null,
          recordedAt: 'x',
        }),
      ),
    ]);
    return cardView(snapshot, 'dsc-1')!;
  }

  it('PR aberto e ainda não verificado não se chama "verificado"', () => {
    const [line] = verificationLines(cardWith([{ kind: 'pull-request', state: 'pending', ref: 'https://exemplo/pr/128' }]));
    expect(line.text).toBe('PR aberto, ainda não verificado');
    expect(line.detail).toBe('https://exemplo/pr/128');
    expect(line.failed).toBe(false);
  });

  it('verificação que falhou aparece como falha, com o nome do check', () => {
    const [line] = verificationLines(cardWith([{ kind: 'check', state: 'failed', ref: 'npm test' }]));
    expect(line.text).toBe('verificação falhou');
    expect(line.failed).toBe(true);
    expect(line.detail).toBe('npm test');
  });

  it('a conclusão de um spike é conclusão registrada — não PR pela metade', () => {
    const [line] = verificationLines(cardWith([{ kind: 'conclusion', state: 'passed', ref: 'Não dá: o provedor não expõe o dado.' }]));
    expect(line.text).toBe('conclusão registrada');
    expect(line.detail).toBe('Não dá: o provedor não expõe o dado.');
  });

  it('resposta negativa registrada também é desfecho, e diz isso', () => {
    const [line] = verificationLines(cardWith([{ kind: 'conclusion', state: 'failed', ref: 'Caminho descartado.' }]));
    expect(line.text).toBe('conclusão registrada: não deu certo');
  });

  it('revisão aceita e revisão que pediu mudança têm frases diferentes', () => {
    const lines = verificationLines(
      cardWith([
        { kind: 'review', state: 'passed', ref: 'revisor A' },
        { kind: 'review', state: 'failed', ref: 'revisor B' },
      ]),
    );
    expect(lines.map((line) => line.text)).toEqual(['revisão aceita', 'revisão pediu mudança']);
  });

  it('a MESMA verificação declarada de novo atualiza o estado, não empilha uma segunda', () => {
    // Chave natural no reducer = assunto + tipo + ref. É o que faz a fase
    // Concluir poder dizer "o PR de ontem agora está mergeado" sem o card
    // mostrar dois PRs — e sem a tela ter que escolher qual acreditar.
    const lines = verificationLines(
      cardWith([
        { kind: 'pull-request', state: 'pending', ref: 'https://exemplo/pr/128' },
        { kind: 'pull-request', state: 'passed', ref: 'https://exemplo/pr/128' },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('PR mergeado e verificado');
  });

  it('verificação sem ref não mostra detalhe nenhum — a tela não preenche buraco', () => {
    const [line] = verificationLines(cardWith([{ kind: 'review', state: 'pending' }]));
    expect(line.text).toBe('revisão pendente');
    expect(line.detail).toBeNull();
  });

  it('card sem verificação nenhuma não inventa linha', () => {
    expect(verificationLines(cardWith([]))).toHaveLength(0);
  });

  it('verificação de outro card não vaza para este', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('discovery.created', { id: 'dsc-2', title: 'Outro', createdAt: 'x' }),
      evt('verification.updated', {
        subject: { entity: 'discovery', id: 'dsc-2' },
        verificationKind: 'check',
        state: 'passed',
        ref: 'npm test',
        recordedAt: 'x',
      }),
    ]);
    expect(verificationLines(cardView(snapshot, 'dsc-1')!)).toHaveLength(0);
    expect(verificationLines(cardView(snapshot, 'dsc-2')!)).toHaveLength(1);
  });
});

// Spec 010 (B7) — o estado do item, em português. A tela imprimia `item.state`
// cru: "open", "in-progress". Vocabulário de estado montado no JSX é
// exatamente como a palavra errada reapareceu duas vezes em 03/08 — ele nasce
// aqui, numa função só, ou nasce errado em três lugares.
//
// Costura B3×B7 do merge: a função que produz a linha é `itemLine` (B3), via
// `cardContent` — a `itemLines` que o B7 escreveu era a segunda redação da
// mesma frase e saiu. As asserções são as mesmas.
describe('a linha do item dita em português (via cardContent)', () => {
  function itemLines(card: NonNullable<ReturnType<typeof cardView>>) {
    return cardContent(card).lines.filter((line) => line.kind === 'item');
  }

  function cardWithItem(state: string, targetRepo: string | null = 'atlas') {
    const snapshot = reduceEvents([
      evt('discovery.created', { id: 'dsc-1', title: 'Card', createdAt: 'x' }),
      evt('work_item.created', {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: 'pln-1',
        itemType: 'issue',
        title: 'Expor estado da fila',
        targetRepo,
        state,
        createdAt: 'x',
      }),
    ]);
    return cardView(snapshot, 'dsc-1')!;
  }

  it('item recém-declarado pela skill está aberto, não "open"', () => {
    const [line] = itemLines(cardWithItem('open'));
    expect(line.text).toBe('Expor estado da fila · issue · aberto · atlas');
  });

  it('item em curso diz "em curso"', () => {
    expect(itemLines(cardWithItem('in-progress'))[0].text).toContain('em curso');
  });

  it('concluído e abandonado têm palavra própria', () => {
    expect(itemLines(cardWithItem('done'))[0].text).toContain('concluído');
    expect(itemLines(cardWithItem('abandoned'))[0].text).toContain('abandonado');
  });

  it('item sem repo alvo diz que não tem — silêncio aqui viraria "esqueci de olhar"', () => {
    expect(itemLines(cardWithItem('open', null))[0].text).toContain('sem repo alvo');
  });

  it('nenhuma linha carrega vocabulário do modelo interno', () => {
    for (const state of ['open', 'in-progress', 'done', 'abandoned']) {
      expect(itemLines(cardWithItem(state))[0].text).not.toContain(state);
    }
  });
});
