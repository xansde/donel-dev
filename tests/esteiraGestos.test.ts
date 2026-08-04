import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEsteiraService, type EsteiraService } from '../src/main/esteira-service';
import { storeEventsPath } from '../src/main/esteira-store';
import {
  isValidAddNoteIpcInput,
  isValidDiscardWorkItemIpcInput,
  isValidSetStageOverrideIpcInput,
  isValidSetWorkItemStateIpcInput,
} from '../src/shared/esteira/ipc';
import {
  cardView,
  discardedMessage,
  discardHint,
  gestureRefusalMessage,
  itemLine,
  itemStateActions,
  ITEM_STATE_RULE,
  MACRO_STAGE_OPTIONS,
  noteTargetOptions,
  parseNoteTarget,
  stageView,
  WORK_ITEM_STATE_LABEL,
} from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { DiscoverySnapshot, StoreEvent, WorkItemSnapshot } from '../src/shared/esteira/store/storeFormat';

// Spec 010, batch B3 — os gestos que o store ja entendia e ninguem conseguia
// disparar: override de etapa, estado do item (com o RETROCESSO), descarte de
// item nascido pela skill (D-16) e nota amarrada ao card ou ao item.
//
// O que este arquivo existe para impedir:
//
//   - override que ESCONDE o calculo (D-13: o ajuste nunca engana quem le);
//   - etapa que so avanca — a tabela de D-13 preve item reaberto voltando para
//     Execucao, e foi pedido literal de 01/08;
//   - gesto que grava fato sobre entidade que nao existe (o app afirmando o que
//     nao leu, pela porta de tras);
//   - descarte que deixa trava orfa — o modo de falha ja registrado em
//     `erros-conhecidos.md` #2.

// ---------------------------------------------------------------------------
// A camada PURA — e aqui que nasce o texto de estado
// ---------------------------------------------------------------------------

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
    title: 'Instrumentar a fila',
    targetRepo: 'atlas',
    scopeRepos: [],
    state: 'open',
    createdBySkill: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

describe('vocabulario do item — a tela e pt-BR, o dado e ingles', () => {
  it('cada estado tem palavra em portugues', () => {
    expect(WORK_ITEM_STATE_LABEL['open']).toBe('aberto');
    expect(WORK_ITEM_STATE_LABEL['in-progress']).toBe('em curso');
    expect(WORK_ITEM_STATE_LABEL['done']).toBe('concluído');
    expect(WORK_ITEM_STATE_LABEL['abandoned']).toBe('abandonado');
  });

  it('a linha do item nunca imprime o estado cru do dado', () => {
    const line = itemLine(item({ state: 'in-progress' }));
    expect(line).toContain('em curso');
    expect(line).not.toContain('in-progress');
  });

  it('item nascido pela skill diz que nasceu pela skill (D-16)', () => {
    expect(itemLine(item({ createdBySkill: true }))).toContain('criado pela skill');
    expect(itemLine(item({ createdBySkill: false }))).not.toContain('criado pela skill');
  });

  it('item sem repo alvo diz que nao tem — ausencia com nome, nunca em branco', () => {
    expect(itemLine(item({ targetRepo: null }))).toContain('sem repo alvo');
  });
});

describe('itemStateActions — abrir, comecar, concluir, abandonar', () => {
  it('nao oferece o estado em que o item ja esta', () => {
    const alvos = itemStateActions(item({ state: 'open' })).map((action) => action.state);
    expect(alvos).not.toContain('open');
    expect(alvos).toEqual(expect.arrayContaining(['in-progress', 'done', 'abandoned']));
  });

  it('item aberto ganha "Começar"', () => {
    const comecar = itemStateActions(item({ state: 'open' })).find((action) => action.state === 'in-progress');
    expect(comecar?.label).toBe('Começar');
  });

  it('item concluido ganha "Reabrir", e o aviso diz que a etapa pode RETROCEDER', () => {
    const reabrir = itemStateActions(item({ state: 'done' })).find((action) => action.state === 'open');
    expect(reabrir?.label).toBe('Reabrir');
    expect(reabrir?.hint).toContain('retroceder');
  });

  it('abandonar e desfecho, nao pendencia — a frase diz isso', () => {
    const abandonar = itemStateActions(item({ state: 'in-progress' })).find((action) => action.state === 'abandoned');
    expect(abandonar?.hint).toContain('desfecho');
    expect(abandonar?.hint).not.toContain('pendente');
  });
});

describe('stageView — o override mostra o calculo ao lado (D-13)', () => {
  const base: DiscoverySnapshot = {
    id: 'dsc-1',
    title: 'Card',
    problem: null,
    tracker: null,
    targetRepo: null,
    scopeRepos: [],
    createdAt: '2026-08-04T12:00:00.000Z',
    derivedStage: 'discovery',
    stageSignals: [],
    stageOverride: null,
  };

  it('sem ajuste, nao ha frase de ajuste', () => {
    expect(stageView(base).overrideLine).toBeNull();
  });

  it('com ajuste, a frase carrega o valor forcado E o calculado — override que esconde o calculo engana', () => {
    const line = stageView({
      ...base,
      derivedStage: 'discovery',
      stageOverride: { value: 'done', by: 'alexandre', at: '2026-08-04T12:00:00.000Z', reason: 'entregue fora do app' },
    }).overrideLine;

    expect(line).not.toBeNull();
    expect(line).toContain('Concluído');
    expect(line).toContain('Discovery');
    expect(line).toContain('alexandre');
    expect(line).toContain('entregue fora do app');
  });

  it('ajuste sem motivo continua dizendo quem ajustou e qual e a calculada', () => {
    const line = stageView({ ...base, stageOverride: { value: 'planned', by: 'alexandre', at: 'x', reason: null } }).overrideLine;
    expect(line).toContain('Planejado');
    expect(line).toContain('Discovery');
    expect(line).toContain('alexandre');
  });
});

describe('nota amarrada ao card ou ao item', () => {
  const snapshot = reduceEvents([
    evt('discovery.created', { id: 'dsc-1', title: 'Fila trava sem sinal', createdAt: 'x' }),
    evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Plano' }),
    evt('work_item.created', {
      id: 'wi-1',
      discoveryId: 'dsc-1',
      planId: 'pln-1',
      itemType: 'issue',
      title: 'Instrumentar a fila',
      targetRepo: 'atlas',
      state: 'open',
      createdBySkill: true,
      createdAt: 'x',
    }),
    evt('note.added', { subject: { entity: 'discovery', id: 'dsc-1' }, text: 'nota do card', at: 'x' }),
    evt('note.added', { subject: { entity: 'work_item', id: 'wi-1' }, text: 'nota do item', at: 'x' }),
  ]);

  it('o alvo da nota e o card ou um item — e o rotulo diz qual', () => {
    const opcoes = noteTargetOptions(cardView(snapshot, 'dsc-1')!);
    expect(opcoes[0]).toMatchObject({ value: 'discovery:dsc-1' });
    expect(opcoes[0].label).toContain('card');
    expect(opcoes.some((opcao) => opcao.value === 'work_item:wi-1' && opcao.label.includes('Instrumentar a fila'))).toBe(true);
  });

  it('o valor da opcao volta a ser um assunto de verdade', () => {
    expect(parseNoteTarget('work_item:wi-1')).toEqual({ entity: 'work_item', id: 'wi-1' });
    expect(parseNoteTarget('discovery:dsc-1')).toEqual({ entity: 'discovery', id: 'dsc-1' });
    expect(parseNoteTarget('lixo')).toBeNull();
    expect(parseNoteTarget('cartao:1')).toBeNull();
  });

  it('cada nota da tela diz sobre o que ela e', () => {
    const notas = cardView(snapshot, 'dsc-1')!.notes;
    expect(notas.find((nota) => nota.text === 'nota do card')?.about).toContain('card');
    expect(notas.find((nota) => nota.text === 'nota do item')?.about).toContain('Instrumentar a fila');
  });
});

describe('a recusa de um gesto tem palavra propria — recusa calada e o vicio da spec', () => {
  it('cada razao vira uma frase que diz que NADA foi gravado', () => {
    expect(gestureRefusalMessage('store-refused')).toContain('Nada foi gravado');
    expect(gestureRefusalMessage('unknown-subject')).toContain('Nada foi gravado');
    expect(gestureRefusalMessage('invalid-input')).toContain('Nada foi gravado');
  });

  it('o item travado diz o que fazer, nao so que nao deu', () => {
    expect(gestureRefusalMessage('locked')).toContain('Libere a trava');
  });

  it('razao desconhecida ainda produz frase — nunca `undefined` na tela', () => {
    expect(gestureRefusalMessage('coisa-nova')).toContain('recusado');
  });
});

describe('MACRO_STAGE_OPTIONS — a tela nao inventa nome de etapa', () => {
  it('oferece as quatro etapas do modelo, em pt-BR', () => {
    expect(MACRO_STAGE_OPTIONS.map((option) => option.value)).toEqual(['discovery', 'planned', 'execution', 'done']);
    expect(MACRO_STAGE_OPTIONS.map((option) => option.label)).toEqual(['Discovery', 'Planejado', 'Execução', 'Concluído']);
  });
});

describe('depois do descarte, a tela nao finge que o item nunca existiu', () => {
  it('a frase diz que o item saiu do card E que o historico guardou', () => {
    const message = discardedMessage(item({ title: 'Instrumentar a fila' }));
    expect(message).toContain('Instrumentar a fila');
    expect(message).toContain('histórico');
  });
});

describe('a regra dos itens e dita uma vez, onde ela se aplica', () => {
  it('e ela nomeia o retrocesso', () => {
    expect(ITEM_STATE_RULE).toContain('retroced');
  });
});

describe('discardHint — D-16 diz por que o descarte nao tem bloqueio', () => {
  it('item da skill: um gesto, sem bloqueio, com o fato ficando no historico', () => {
    const hint = discardHint(item({ createdBySkill: true }));
    expect(hint).toContain('skill');
    expect(hint).toContain('histórico');
  });

  it('item que nao nasceu pela skill tambem se descarta, com a frase honesta', () => {
    expect(discardHint(item({ createdBySkill: false }))).toContain('histórico');
  });
});

// ---------------------------------------------------------------------------
// Os gestos, ponta a ponta pelo servico
// ---------------------------------------------------------------------------

const EXAMPLES_DIR = join(__dirname, '..', 'src', 'shared', 'esteira', 'contract', 'v1', 'examples');

/** Ids do corpus do contrato — o mesmo dado que a skill 3.0 devolve de verdade. */
const DISCOVERY_ID = 'dsc-2026-08-03-a';
const PLAN_ID = 'pln-2026-08-03-a1';
const ITEM_SPEC = 'wi-2026-08-03-a1-01';
const ITEM_ISSUE_ATLAS = 'wi-2026-08-03-a1-02';
const ITEM_ISSUE_BEACON = 'wi-2026-08-03-a1-03';

let root: string;
let service: EsteiraService;

function open(overrides: Record<string, unknown> = {}): EsteiraService {
  let n = 0;
  return createEsteiraService({
    storeDir: join(root, 'store'),
    inboxDir: join(root, 'inbox'),
    outboxDir: join(root, 'outbox'),
    channel: 'alfa',
    actor: 'alexandre',
    now: () => '2026-08-04T14:30:00.000Z',
    newId: (prefix: string) => {
      n += 1;
      return `${prefix}-${n}`;
    },
    ...overrides,
  });
}

/**
 * Planta o card do corpus: discovery CONCLUIDO, um plano e tres itens abertos.
 * E o unico estado em que a macro etapa sai de `discovery` (D-13) — sem ele,
 * mexer no item nao moveria etapa nenhuma e o teste passaria por acidente.
 */
function plantarCardDoCorpus(): void {
  copyFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), join(root, 'outbox', 'discovery-com-tracker.json'));
  copyFileSync(join(EXAMPLES_DIR, 'plano-com-itens.json'), join(root, 'outbox', 'plano-com-itens.json'));
  service.scanOutbox();
}

function etapa(): string {
  const discovery = service.snapshotDto().snapshot.discoveries.find((entry) => entry.id === DISCOVERY_ID);
  if (discovery === undefined) throw new Error('card sumiu do snapshot');
  return discovery.derivedStage;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'donel-esteira-gestos-'));
  mkdirSync(join(root, 'outbox'), { recursive: true });
  service = open();
});

afterEach(() => {
  service.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('estado do item move a macro etapa — e ela RETROCEDE', () => {
  it('item em curso puxa o card para Execução sozinho', () => {
    plantarCardDoCorpus();
    expect(etapa()).toBe('planned');

    const gesture = service.setWorkItemState({ workItemId: ITEM_SPEC, state: 'in-progress' });

    expect(gesture.ok).toBe(true);
    expect(etapa()).toBe('execution');
  });

  it('todos os itens fechados levam o card a Concluído', () => {
    plantarCardDoCorpus();
    service.setWorkItemState({ workItemId: ITEM_SPEC, state: 'done' });
    service.setWorkItemState({ workItemId: ITEM_ISSUE_ATLAS, state: 'done' });
    service.setWorkItemState({ workItemId: ITEM_ISSUE_BEACON, state: 'abandoned' });

    expect(etapa()).toBe('done');
  });

  it('reabrir um item concluido faz a etapa VOLTAR para Execução', () => {
    plantarCardDoCorpus();
    for (const id of [ITEM_SPEC, ITEM_ISSUE_ATLAS, ITEM_ISSUE_BEACON]) service.setWorkItemState({ workItemId: id, state: 'done' });
    expect(etapa()).toBe('done');

    service.setWorkItemState({ workItemId: ITEM_SPEC, state: 'open' });

    expect(etapa()).toBe('execution');
  });

  it('item que nao existe: o gesto e RECUSADO, e nada e gravado', () => {
    plantarCardDoCorpus();
    const antes = readFileSync(storeEventsPath(join(root, 'store')), 'utf8');

    const gesture = service.setWorkItemState({ workItemId: 'wi-fantasma', state: 'done' });

    expect(gesture).toMatchObject({ ok: false, reason: 'unknown-subject' });
    expect(readFileSync(storeEventsPath(join(root, 'store')), 'utf8')).toBe(antes);
  });
});

describe('override de etapa — marcado, com a derivada intacta (D-13)', () => {
  it('forcar a etapa nao apaga o calculo: o snapshot guarda as duas', () => {
    plantarCardDoCorpus();

    const gesture = service.setStageOverride({ discoveryId: DISCOVERY_ID, value: 'done', reason: 'entregue fora do app' });

    expect(gesture.ok).toBe(true);
    const discovery = service.snapshotDto().snapshot.discoveries[0];
    expect(discovery.stageOverride).toMatchObject({ value: 'done', by: 'alexandre', reason: 'entregue fora do app' });
    expect(discovery.derivedStage).toBe('planned');
  });

  it('limpar o ajuste devolve o card ao calculo, num gesto', () => {
    plantarCardDoCorpus();
    service.setStageOverride({ discoveryId: DISCOVERY_ID, value: 'done', reason: null });

    service.setStageOverride({ discoveryId: DISCOVERY_ID, value: null, reason: null });

    expect(service.snapshotDto().snapshot.discoveries[0].stageOverride).toBeNull();
  });

  it('card que nao existe: recusado, sem gravar fato sobre fantasma', () => {
    const gesture = service.setStageOverride({ discoveryId: 'dsc-fantasma', value: 'done', reason: null });
    expect(gesture).toMatchObject({ ok: false, reason: 'unknown-subject' });
  });
});

describe('descartar item (D-16)', () => {
  it('a entidade sai do snapshot e o EVENTO fica no log', () => {
    plantarCardDoCorpus();

    const gesture = service.discardWorkItem({ workItemId: ITEM_ISSUE_BEACON, reason: 'nasceu duplicado' });

    expect(gesture.ok).toBe(true);
    const ids = service.snapshotDto().snapshot.workItems.map((entry) => entry.id);
    expect(ids).toEqual([ITEM_SPEC, ITEM_ISSUE_ATLAS]);
    expect(readFileSync(storeEventsPath(join(root, 'store')), 'utf8')).toContain('work_item.discarded');
    expect(etapa()).toBe('planned');
  });

  it('item com fase travada NÃO se descarta — descartar deixaria a trava orfa', () => {
    plantarCardDoCorpus();
    const dispatched = service.dispatch({
      phase: 'implementar',
      discoveryId: DISCOVERY_ID,
      planId: PLAN_ID,
      workItemId: ITEM_ISSUE_ATLAS,
      workspace: { target_repo: 'atlas', repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    expect(dispatched.ok).toBe(true);

    const gesture = service.discardWorkItem({ workItemId: ITEM_ISSUE_ATLAS, reason: null });

    expect(gesture).toMatchObject({ ok: false, reason: 'locked' });
    expect(service.snapshotDto().snapshot.workItems.map((entry) => entry.id)).toContain(ITEM_ISSUE_ATLAS);
  });

  it('item que nao existe e recusado', () => {
    plantarCardDoCorpus();
    expect(service.discardWorkItem({ workItemId: 'wi-fantasma', reason: null })).toMatchObject({ ok: false, reason: 'unknown-subject' });
  });
});

describe('nota', () => {
  it('nota no card aparece amarrada ao card', () => {
    plantarCardDoCorpus();

    const gesture = service.addNote({ subject: { entity: 'discovery', id: DISCOVERY_ID }, text: 'Terceira hipótese descartada.' });

    expect(gesture.ok).toBe(true);
    const notas = service.snapshotDto().snapshot.notes;
    expect(notas[notas.length - 1]).toMatchObject({ subject: { entity: 'discovery', id: DISCOVERY_ID }, text: 'Terceira hipótese descartada.' });
  });

  it('nota no item fica amarrada ao item', () => {
    plantarCardDoCorpus();
    service.addNote({ subject: { entity: 'work_item', id: ITEM_SPEC }, text: 'travou no lock do banco' });

    const notas = service.snapshotDto().snapshot.notes;
    expect(notas[notas.length - 1].subject).toEqual({ entity: 'work_item', id: ITEM_SPEC });
  });

  it('nota sobre assunto que nao existe e recusada', () => {
    plantarCardDoCorpus();
    expect(service.addNote({ subject: { entity: 'work_item', id: 'wi-fantasma' }, text: 'x' })).toMatchObject({
      ok: false,
      reason: 'unknown-subject',
    });
  });
});

describe('store que nao aceita escrita recusa TODOS os gestos novos', () => {
  it('nenhum gesto grava, e cada um diz que o historico e que recusou', () => {
    mkdirSync(join(root, 'store2'), { recursive: true });
    writeFileSync(
      storeEventsPath(join(root, 'store2')),
      `${JSON.stringify({ kind: 'esteira.store.header', schema_version: '9.0.0', created_at: '2026-08-04T14:30:00.000Z', created_by_channel: 'beta' })}\n`,
      'utf8',
    );
    const readOnly = open({ storeDir: join(root, 'store2') });
    expect(readOnly.snapshotDto().compatibility).toBe('read-only');

    expect(readOnly.setStageOverride({ discoveryId: DISCOVERY_ID, value: 'done', reason: null })).toMatchObject({ ok: false, reason: 'store-refused' });
    expect(readOnly.setWorkItemState({ workItemId: ITEM_SPEC, state: 'done' })).toMatchObject({ ok: false, reason: 'store-refused' });
    expect(readOnly.discardWorkItem({ workItemId: ITEM_SPEC, reason: null })).toMatchObject({ ok: false, reason: 'store-refused' });
    expect(readOnly.addNote({ subject: { entity: 'discovery', id: DISCOVERY_ID }, text: 'x' })).toMatchObject({ ok: false, reason: 'store-refused' });
    readOnly.dispose();
  });
});

describe('validacao de payload do IPC — o main so muta depois de validar', () => {
  it('override exige um card e uma etapa conhecida (ou null, que e o limpar)', () => {
    expect(isValidSetStageOverrideIpcInput({ discoveryId: 'dsc-1', value: 'done', reason: null })).toBe(true);
    expect(isValidSetStageOverrideIpcInput({ discoveryId: 'dsc-1', value: null, reason: null })).toBe(true);
    expect(isValidSetStageOverrideIpcInput({ discoveryId: 'dsc-1', value: 'entregue', reason: null })).toBe(false);
    expect(isValidSetStageOverrideIpcInput({ value: 'done' })).toBe(false);
  });

  it('estado do item exige um estado do ciclo de vida', () => {
    expect(isValidSetWorkItemStateIpcInput({ workItemId: 'wi-1', state: 'in-progress' })).toBe(true);
    expect(isValidSetWorkItemStateIpcInput({ workItemId: 'wi-1', state: 'quase' })).toBe(false);
    expect(isValidSetWorkItemStateIpcInput({ workItemId: '  ', state: 'done' })).toBe(false);
  });

  it('descarte exige o item', () => {
    expect(isValidDiscardWorkItemIpcInput({ workItemId: 'wi-1', reason: null })).toBe(true);
    expect(isValidDiscardWorkItemIpcInput({ reason: 'x' })).toBe(false);
  });

  it('nota exige assunto de verdade e texto nao vazio', () => {
    expect(isValidAddNoteIpcInput({ subject: { entity: 'discovery', id: 'dsc-1' }, text: 'ok' })).toBe(true);
    expect(isValidAddNoteIpcInput({ subject: { entity: 'discovery', id: 'dsc-1' }, text: '   ' })).toBe(false);
    expect(isValidAddNoteIpcInput({ subject: { entity: 'cartao', id: 'x' }, text: 'ok' })).toBe(false);
  });
});
