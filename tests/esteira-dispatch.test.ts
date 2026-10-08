import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ESTEIRA_INBOX_DIR_ENV_VAR, dispatchPhase, esteiraInboxDir, reconcileOrphanedSessions, releaseLock } from '../src/main/esteira-dispatch';
import { openEsteiraStore, type EsteiraStore } from '../src/main/esteira-store';
import { parseRunInputText } from '../src/shared/esteira/contract/runInput';
import type { EventDraft } from '../src/shared/esteira/ingest/resultToEvents';
import { orphanedSessionCandidates } from '../src/shared/esteira/store/reconcile';
import { emptySnapshot } from '../src/shared/esteira/store/reducer';
import type { SessionSnapshot, StoreSnapshot } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (D-6, D-11) — o DISPARO de fase. Tres promessas:
//
// 1. **Alvo explicito** — item do tipo `issue` sem repo NAO dispara. Nada de
//    cair no "projeto em foco" (evidencia 2 da spec).
// 2. **A trava e FATO no log** (D-11), com dono, hora e sessao: nunca arquivo
//    `.lock` orfao, nunca so etiqueta remota. Ela aparece no card e libera num
//    gesto — `releaseLock`, que e um evento como qualquer outro.
// 3. **A skill recebe um documento tipado**, nao um markdown de texto livre: o
//    `run-input.json` gravado aqui passa pelo mesmo parser que a skill usa.

let dir: string;
let inbox: string;
let store: EsteiraStore;
let idSeq = 0;

function seed(store: EsteiraStore): void {
  const drafts: EventDraft[] = [
    {
      type: 'discovery.created',
      at: '2026-08-03T12:00:00.000Z',
      dedupe_key: null,
      payload: {
        id: 'dsc-1',
        title: 'Fila trava sem sinal',
        problem: null,
        tracker: null,
        targetRepo: 'atlas',
        scopeRepos: [],
        createdAt: '2026-08-03T12:00:00.000Z',
      },
    },
    {
      type: 'plan.created',
      at: '2026-08-03T13:00:00.000Z',
      dedupe_key: null,
      payload: { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar a fila observavel', summary: null },
    },
    {
      type: 'work_item.created',
      at: '2026-08-03T13:10:00.000Z',
      dedupe_key: null,
      payload: {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: 'pln-1',
        itemType: 'issue',
        title: 'Expor estado da fila',
        targetRepo: 'atlas',
        scopeRepos: [],
        state: 'open',
        createdBySkill: true,
        createdAt: '2026-08-03T13:10:00.000Z',
      },
    },
  ];
  store.append(drafts);
}

beforeEach(() => {
  idSeq = 0;
  dir = mkdtempSync(join(tmpdir(), 'donel-esteira-dispatch-'));
  inbox = join(dir, 'inbox');
  store = openEsteiraStore({ dir: join(dir, 'store'), channel: 'alfa', now: () => '2026-08-03T12:00:00.000Z' });
  seed(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function dispatch(overrides: Record<string, unknown> = {}) {
  return dispatchPhase(store, {
    phase: 'discovery',
    discoveryId: 'dsc-1',
    inboxDir: inbox,
    outboxDir: join(dir, 'outbox'),
    now: () => '2026-08-04T14:30:00.000Z',
    newId: (prefix: string) => {
      idSeq += 1;
      return `${prefix}-${idSeq}`;
    },
    ...overrides,
  });
}

describe('esteiraInboxDir', () => {
  it('e irmao do outbox, no home local — nunca no OneDrive', () => {
    expect(esteiraInboxDir({}, () => 'C:\\Users\\x')).toBe(join('C:\\Users\\x', '.claude', 'esteira-donel', 'inbox'));
  });

  it('aceita override de ambiente', () => {
    expect(esteiraInboxDir({ [ESTEIRA_INBOX_DIR_ENV_VAR]: 'C:\\tmp\\in' }, () => 'C:\\Users\\x')).toBe('C:\\tmp\\in');
  });
});

describe('dispatchPhase — o que vai para a skill', () => {
  it('grava o run-input.json no inbox, e ele passa pelo parser da skill', () => {
    const result = dispatch();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(result.inputPath)).toBe(true);

    const parsed = parseRunInputText(readFileSync(result.inputPath, 'utf8'));
    if (!parsed.ok) throw new Error(`o app gravou algo que a skill recusaria: ${JSON.stringify(parsed.issues, null, 2)}`);
    expect(parsed.input.run.run_id).toBe(result.runId);
    // O app diz ONDE quer a resposta: a skill nao precisa saber do canal nem do userData.
    expect(parsed.input.outbox.result_path).toBe(result.resultPath);
  });

  it('o nome do arquivo carrega o run_id — ida e volta se reconhecem pelo mesmo id', () => {
    const result = dispatch();
    expect(result.ok && result.inputPath.endsWith(`${result.runId}.json`)).toBe(true);
    expect(result.ok && result.resultPath.endsWith(`${result.runId}.json`)).toBe(true);
  });

  it('registra phase.started e a sessao amarrada a item+fase (P-6)', () => {
    const result = dispatch();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = store.snapshot();
    expect(snapshot.phases.some((phase) => phase.phase === 'discovery' && phase.startedAt !== null)).toBe(true);
    const session = snapshot.sessions.find((entry) => entry.id === result.sessionId);
    expect(session?.phase).toBe('discovery');
    expect(session?.subject).toEqual({ entity: 'discovery', id: 'dsc-1' });
  });

  it('handoff dentro da mesma fase encadeia a sessao anterior, com motivo', () => {
    const first = dispatch();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');

    const second = dispatch({
      continuesSessionId: first.sessionId,
      handoffReason: 'Orcamento de contexto',
      now: () => '2026-08-04T15:01:00.000Z',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const session = store.snapshot().sessions.find((entry) => entry.id === second.sessionId);
    expect(session?.continuesSessionId).toBe(first.sessionId);
    expect(session?.handoffReason).toBe('Orcamento de contexto');
  });
});

describe('dispatchPhase — a trava (D-11)', () => {
  it('a trava entra no log com dono, hora e sessao — visivel no card', () => {
    const result = dispatch();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lock = store.snapshot().locks[0];
    expect(lock.subject).toEqual({ entity: 'discovery', id: 'dsc-1' });
    expect(lock.phase).toBe('discovery');
    expect(lock.holderKind).toBe('app');
    expect(lock.acquiredAt).toBe('2026-08-04T14:30:00.000Z');
    // Nunca um arquivo `.lock` solto: o unico artefato em disco e o run-input.
    expect(existsSync(join(inbox, 'dsc-1.lock'))).toBe(false);
  });

  it('segundo disparo do mesmo assunto e RECUSADO enquanto a trava existir', () => {
    expect(dispatch().ok).toBe(true);

    const second = dispatch({ phase: 'plano', planId: 'pln-1' });
    expect(second).toMatchObject({ ok: false, reason: 'locked' });
    if (second.ok || second.reason !== 'locked') return;
    expect(second.lock.phase).toBe('discovery');
  });

  it('recusa por trava nao grava input nenhum no inbox', () => {
    dispatch();
    const before = readFileSync(join(inbox, 'run-1.json'), 'utf8');

    dispatch({ phase: 'plano', planId: 'pln-1' });

    expect(readFileSync(join(inbox, 'run-1.json'), 'utf8')).toBe(before);
    expect(existsSync(join(inbox, 'run-3.json'))).toBe(false);
  });

  it('liberar a trava e um gesto — um evento, e o disparo volta a funcionar', () => {
    dispatch();
    const released = releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');

    expect(released.ok).toBe(true);
    expect(store.snapshot().locks).toHaveLength(0);
    expect(dispatch({ phase: 'plano', planId: 'pln-1' }).ok).toBe(true);
  });

  it('itens diferentes do mesmo plano rodam em paralelo — a trava e do assunto, nao do card inteiro', () => {
    store.append([
      {
        type: 'work_item.created',
        at: '2026-08-03T13:11:00.000Z',
        dedupe_key: null,
        payload: {
          id: 'wi-2',
          discoveryId: 'dsc-1',
          planId: 'pln-1',
          itemType: 'spec',
          title: 'Contrato da fila',
          targetRepo: null,
          scopeRepos: [],
          state: 'open',
          createdBySkill: true,
          createdAt: '2026-08-03T13:11:00.000Z',
        },
      },
    ]);

    const first = dispatch({
      phase: 'implementar',
      planId: 'pln-1',
      workItemId: 'wi-1',
      workspace: { target_repo: 'atlas', repo_path: null, worktree_path: null, branch: null },
    });
    const second = dispatch({ phase: 'implementar', planId: 'pln-1', workItemId: 'wi-2' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe('dispatchPhase — A1: redisparo de fase DONE exige confirmacao', () => {
  function markDone(phase: string, outcome: 'done' | 'abandoned' | 'inconclusive' = 'done'): void {
    store.append([
      {
        type: 'phase.completed',
        at: '2026-08-04T15:00:00.000Z',
        dedupe_key: null,
        payload: { subject: { entity: 'discovery', id: 'dsc-1' }, phase, outcome, at: '2026-08-04T15:00:00.000Z' },
      },
    ]);
  }

  it('fase concluida sobre o MESMO assunto e RECUSADA sem confirmacao', () => {
    markDone('discovery');
    const result = dispatch();
    expect(result).toMatchObject({ ok: false, reason: 'phase-done' });
    if (result.ok || result.reason !== 'phase-done') return;
    expect(result.phase.phase).toBe('discovery');
    expect(result.phase.outcome).toBe('done');
    // Nenhum efeito colateral: nem trava nova, nem arquivo.
    expect(store.snapshot().locks).toHaveLength(0);
  });

  it('abandoned e inconclusive TAMBEM contam como concluida — as tres tem completedAt', () => {
    markDone('discovery', 'abandoned');
    expect(dispatch()).toMatchObject({ ok: false, reason: 'phase-done' });
  });

  it('confirmReopen:true redispara normalmente', () => {
    markDone('discovery');
    const result = dispatch({ confirmReopen: true });
    expect(result.ok).toBe(true);
  });

  it('fase done de um assunto NAO trava o redisparo de outro assunto (so o assunto exato conta)', () => {
    markDone('discovery');
    // A fase "plano" nunca rodou — nao e o MESMO par (assunto, fase) que concluiu.
    const result = dispatch({ phase: 'plano', planId: 'pln-1' });
    expect(result.ok).toBe(true);
  });

  it('fase apenas INICIADA (nao concluida) redispara sem confirmacao — o guard e so para o que ja terminou', () => {
    store.append([
      {
        type: 'phase.started',
        at: '2026-08-04T15:00:00.000Z',
        dedupe_key: null,
        payload: { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', at: '2026-08-04T15:00:00.000Z', runId: 'run-x' },
      },
    ]);
    expect(dispatch().ok).toBe(true);
  });

  // Nota (nao e teste, e verificacao estrutural): "/resume ou retomar nunca
  // gera run novo" — confirmado por leitura de `App.tsx`
  // (`handleResumeSession`/`handleForkSession`, T013): os dois montam argv
  // `-r <session-id>` via CommandBuilder e chamam `addTab` direto, sem NUNCA
  // tocar `window.donel.esteira.dispatch`. Nao ha caminho de codigo de
  // Retomar/Fork ate `dispatchPhase` — o guard `phase-done` acima e o que
  // resta a proteger: um redisparo EXPLICITO (clique em "Preparar" de novo)
  // sobre uma fase que ja terminou.
});

describe('dispatchPhase — A8/A20: trava por RECURSO DE ESCRITA', () => {
  it('mesmo repo, sem worktree isolada dos dois lados: o SEGUNDO assunto (irmao) e recusado por resource-busy', () => {
    store.append([
      {
        type: 'work_item.created',
        at: '2026-08-03T13:11:00.000Z',
        dedupe_key: null,
        payload: {
          id: 'wi-2',
          discoveryId: 'dsc-1',
          planId: 'pln-1',
          itemType: 'spec',
          title: 'Contrato da fila',
          targetRepo: 'atlas',
          scopeRepos: [],
          state: 'open',
          createdBySkill: true,
          createdAt: '2026-08-03T13:11:00.000Z',
        },
      },
    ]);

    const first = dispatch({
      phase: 'implementar',
      planId: 'pln-1',
      workItemId: 'wi-1',
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null },
    });
    expect(first.ok).toBe(true);

    // wi-2 e IRMAO de wi-1 (mesmo plano, assunto diferente) — a trava por
    // ASSUNTO (D-11) nao veria problema nenhum aqui. E exatamente o buraco
    // que A8/A20 fecha: mesmo repo, nenhum lado prova isolamento por worktree.
    const second = dispatch({
      phase: 'implementar',
      planId: 'pln-1',
      workItemId: 'wi-2',
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null },
    });
    expect(second).toMatchObject({ ok: false, reason: 'resource-busy' });
    if (second.ok || second.reason !== 'resource-busy') return;
    expect(second.lock.subject).toEqual({ entity: 'work_item', id: 'wi-1' });
  });

  it('mesmo repo, worktrees isoladas e DISTINTAS: os dois assuntos irmaos rodam em paralelo — D-5/D-7 preservado', () => {
    store.append([
      {
        type: 'work_item.created',
        at: '2026-08-03T13:11:00.000Z',
        dedupe_key: null,
        payload: {
          id: 'wi-2',
          discoveryId: 'dsc-1',
          planId: 'pln-1',
          itemType: 'spec',
          title: 'Contrato da fila',
          targetRepo: 'atlas',
          scopeRepos: [],
          state: 'open',
          createdBySkill: true,
          createdAt: '2026-08-03T13:11:00.000Z',
        },
      },
    ]);

    const first = dispatch({
      phase: 'implementar',
      planId: 'pln-1',
      workItemId: 'wi-1',
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: 'C:/dev/atlas-wt/wi-1', branch: 'feat/wi-1' },
    });
    const second = dispatch({
      phase: 'implementar',
      planId: 'pln-1',
      workItemId: 'wi-2',
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: 'C:/dev/atlas-wt/wi-2', branch: 'feat/wi-2' },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('repos diferentes nunca conflitam por recurso', () => {
    // Discovery SEPARADO: a cadeia de assunto do segundo disparo (D-11) nao
    // pode tocar a do primeiro, senao o teste exerceria a trava por assunto
    // (ja coberta acima) em vez da trava por recurso, que e o que interessa
    // aqui.
    store.append([
      {
        type: 'discovery.created',
        at: '2026-08-03T12:00:00.000Z',
        dedupe_key: null,
        payload: {
          id: 'dsc-2',
          title: 'Outro card',
          problem: null,
          tracker: null,
          targetRepo: 'beacon',
          scopeRepos: [],
          createdAt: '2026-08-03T12:00:00.000Z',
        },
      },
    ]);

    const first = dispatch({ workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null } });
    const second = dispatch({
      discoveryId: 'dsc-2',
      workspace: { target_repo: 'beacon', repo_path: 'C:/dev/beacon', worktree_path: null, branch: null },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('a trava de recurso cai junto quando a fase conclui — libera o proximo pedido do mesmo repo', () => {
    const first = dispatch({ workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    store.append([
      {
        type: 'phase.completed',
        at: '2026-08-04T15:00:00.000Z',
        dedupe_key: null,
        payload: { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: '2026-08-04T15:00:00.000Z' },
      },
    ]);

    const second = dispatch({
      phase: 'plano',
      planId: 'pln-1',
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null },
    });
    expect(second.ok).toBe(true);
  });

  it('fase sem workspace nenhum nunca ocupa nem disputa recurso', () => {
    const first = dispatch();
    expect(first.ok).toBe(true);
    releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');

    const second = dispatch({ phase: 'plano', planId: 'pln-1' });
    expect(second.ok).toBe(true);
  });
});

describe('dispatchPhase — B3: segunda sessao VIVA no mesmo item+fase e recusada', () => {
  it('trava liberada a mao (releaseLock) sem a sessao terminar: o redisparo e recusado por session-active, nao aceito por engano', () => {
    const first = dispatch();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Cenario nomeado: alguem libera a trava manualmente (gesto "Liberar
    // trava") sem que a sessao (aba) tenha de fato terminado — a aba da
    // PRIMEIRA sessao continua aberta.
    releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');
    expect(store.snapshot().locks).toHaveLength(0);

    const second = dispatch({ now: () => '2026-08-04T15:05:00.000Z' });
    expect(second).toMatchObject({ ok: false, reason: 'session-active' });
    if (second.ok || second.reason !== 'session-active') return;
    expect(second.session.id).toBe(first.sessionId);
    expect(second.session.endedAt).toBeNull();
  });

  it('sessao ASSUMIDA (claimed) e depois encerrada (session.ended): o redisparo volta a funcionar', () => {
    const first = dispatch();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');
    store.append([
      { type: 'session.ended', at: '2026-08-04T15:01:00.000Z', dedupe_key: null, payload: { id: first.sessionId, at: '2026-08-04T15:01:00.000Z', reason: 'tab-closed' } },
    ]);

    const second = dispatch({ now: () => '2026-08-04T15:05:00.000Z' });
    expect(second.ok).toBe(true);
  });

  it('handoff [P-6] EXPLICITO (continuesSessionId aponta pra sessao viva) NAO e bloqueado — e a MESMA cadeia, nao uma concorrente', () => {
    const first = dispatch();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // A trava cai (o gesto de handoff libera), mas a sessao NAO recebeu
    // `endedAt` ainda — exatamente o estado em que um handoff real dispara o
    // proximo elo da cadeia.
    releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');

    const second = dispatch({
      continuesSessionId: first.sessionId,
      handoffReason: 'Orcamento de contexto',
      now: () => '2026-08-04T15:01:00.000Z',
    });
    expect(second.ok).toBe(true);
  });

  it('mas SEM declarar continuesSessionId, a mesma sessao viva bloqueia o redisparo — a excecao e so pra quem se declara continuacao', () => {
    const first = dispatch();
    expect(first.ok).toBe(true);
    releaseLock(store, { entity: 'discovery', id: 'dsc-1' }, 'discovery', () => '2026-08-04T15:00:00.000Z');

    const second = dispatch({ now: () => '2026-08-04T15:01:00.000Z' });
    expect(second).toMatchObject({ ok: false, reason: 'session-active' });
  });

  it('sessao viva de OUTRO assunto (irmao) nao bloqueia — o par (assunto, fase) e exato', () => {
    const first = dispatch({ phase: 'plano', planId: 'pln-1' });
    expect(first.ok).toBe(true);
    releaseLock(store, { entity: 'plan', id: 'pln-1' }, 'plano', () => '2026-08-04T15:00:00.000Z');

    // discovery:dsc-1 e um assunto DIFERENTE de plan:pln-1 — a sessao viva
    // acima e do plano, nao do discovery; o par (assunto, fase) nao repete.
    const second = dispatch({ phase: 'discovery', now: () => '2026-08-04T15:05:00.000Z' });
    expect(second.ok).toBe(true);
  });
});

describe('dispatchPhase — A21: model/effort como decisao registrada explicitamente', () => {
  it('sem model/effort: a sessao registra modelEffortAssumed=false (nada foi assumido)', () => {
    const result = dispatch();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = store.snapshot().sessions.find((entry) => entry.id === result.sessionId);
    expect(session?.model).toBeNull();
    expect(session?.modelEffortAssumed).toBe(false);
  });

  it('model/effort CONFIRMADOS explicitamente: modelEffortAssumed=false', () => {
    const result = dispatch({ model: 'sonnet', effort: 'high', modelEffortAssumed: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = store.snapshot().sessions.find((entry) => entry.id === result.sessionId);
    expect(session?.model).toBe('sonnet');
    expect(session?.modelEffortAssumed).toBe(false);
  });

  it('model/effort aplicados por DEFAULT sem confirmacao: modelEffortAssumed=true, de forma explicita no registro (P33)', () => {
    const result = dispatch({ model: 'opus', effort: 'high', modelEffortAssumed: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = store.snapshot().sessions.find((entry) => entry.id === result.sessionId);
    expect(session?.model).toBe('opus');
    expect(session?.modelEffortAssumed).toBe(true);
  });
});

describe('dispatchPhase — alvo explicito (D-6)', () => {
  it('item do tipo issue sem repo NAO dispara, e diz por que', () => {
    const result = dispatch({ phase: 'implementar', planId: 'pln-1', workItemId: 'wi-1' });

    expect(result).toMatchObject({ ok: false, reason: 'invalid-target' });
    if (result.ok || result.reason !== 'invalid-target') return;
    expect(result.issues.some((issue) => issue.code === 'issue_without_target_repo')).toBe(true);
    // E nao deixa lixo: nem trava, nem arquivo.
    expect(store.snapshot().locks).toHaveLength(0);
    expect(existsSync(inbox) && readFileSync(join(inbox, 'run-1.json'), 'utf8')).toBeFalsy();
  });

  it('assunto fora do store nao dispara', () => {
    expect(dispatch({ discoveryId: 'dsc-fantasma' })).toMatchObject({ ok: false, reason: 'invalid-target' });
  });
});

// A7 — reconciliacao MANIFESTO-SEM-RESULT: a fase que morreu entre o
// `run-input.json` (o manifesto, no inbox) e o `result.json` esperado no
// outbox. Hoje so um humano notava, olhando o card preso para sempre.
describe('reconcileOrphanedSessions — a fase que morreu sem devolver nada (A7)', () => {
  it('sessao sem result no disco e encerrada, com motivo, e a trava cai junto', () => {
    const dispatched = dispatch();
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;

    const result = reconcileOrphanedSessions(store, { resultExists: () => false, now: () => '2026-08-05T09:00:00.000Z' });

    expect(result.reconciled).toBe(1);
    const session = store.snapshot().sessions.find((entry) => entry.id === dispatched.sessionId);
    expect(session?.endedAt).toBe('2026-08-05T09:00:00.000Z');
    expect(session?.endReason).toContain('result.json');
    expect(store.snapshot().locks).toHaveLength(0);
  });

  it('sessao cujo result JA existe no disco nao e mexida — a proxima varredura decide', () => {
    const dispatched = dispatch();
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;

    const result = reconcileOrphanedSessions(store, { resultExists: (path) => path === dispatched.resultPath });

    expect(result.reconciled).toBe(0);
    const session = store.snapshot().sessions.find((entry) => entry.id === dispatched.sessionId);
    expect(session?.endedAt).toBeNull();
    expect(store.snapshot().locks).toHaveLength(1);
  });

  it('sessao ja encerrada (fase concluida normalmente) nao e candidata — chamar de novo nao faz nada', () => {
    const dispatched = dispatch();
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;

    store.append([
      { type: 'phase.completed', at: '2026-08-05T09:00:00.000Z', dedupe_key: null, payload: { subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', at: '2026-08-05T09:00:00.000Z' } },
    ]);

    const result = reconcileOrphanedSessions(store, { resultExists: () => false });
    expect(result.reconciled).toBe(0);
  });

  it('sem sessao aberta nenhuma, nao faz nada', () => {
    expect(reconcileOrphanedSessions(store, { resultExists: () => false })).toEqual({ reconciled: 0 });
  });
});

describe('orphanedSessionCandidates (store/reconcile)', () => {
  // A7 — a parte PURA da reconciliação manifesto-sem-result: SÓ decide quais
  // sessões são candidatas a "a fase morreu entre o manifesto e o result do
  // outbox". O lado que pergunta ao disco (`main/esteira-dispatch.ts`) é quem
  // decide o que fazer com cada candidata.

  function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
    return {
      id: 'ses-1',
      cliSessionId: null,
      subject: { entity: 'discovery', id: 'dsc-1' },
      phase: 'discovery',
      continuesSessionId: null,
      handoffReason: null,
      cwd: null,
      model: null,
      effort: null,
      modelEffortAssumed: false,
      startedAt: '2026-08-05T12:00:00.000Z',
      endedAt: null,
      endReason: null,
      inputPath: 'C:/inbox/run-1.json',
      resultPath: 'C:/outbox/run-1.json',
      claimed: false,
      ...overrides,
    };
  }

  function snapshotWith(sessions: readonly SessionSnapshot[]): StoreSnapshot {
    return { ...emptySnapshot(), sessions };
  }

  describe('orphanedSessionCandidates', () => {
    it('sessao aberta com resultPath e candidata', () => {
      const candidates = orphanedSessionCandidates(snapshotWith([session()]));
      expect(candidates.map((entry) => entry.id)).toEqual(['ses-1']);
    });

    it('sessao ja encerrada NAO e candidata — ela ja tem desfecho', () => {
      const candidates = orphanedSessionCandidates(snapshotWith([session({ endedAt: '2026-08-05T13:00:00.000Z' })]));
      expect(candidates).toHaveLength(0);
    });

    it('sessao sem resultPath NAO e candidata — nao ha "manifesto sem result" para checar', () => {
      const candidates = orphanedSessionCandidates(snapshotWith([session({ resultPath: null })]));
      expect(candidates).toHaveLength(0);
    });

    it('sessao HANDED-OFF (encerrada com sucessora) nao e candidata; a sucessora e', () => {
      const anterior = session({ id: 'ses-1', endedAt: '2026-08-05T12:30:00.000Z', handoffReason: 'orcamento de contexto' });
      const sucessora = session({ id: 'ses-2', continuesSessionId: 'ses-1', resultPath: 'C:/outbox/run-2.json' });
      const candidates = orphanedSessionCandidates(snapshotWith([anterior, sucessora]));
      expect(candidates.map((entry) => entry.id)).toEqual(['ses-2']);
    });

    it('lista vazia sem sessoes', () => {
      expect(orphanedSessionCandidates(emptySnapshot())).toEqual([]);
    });
  });
});
