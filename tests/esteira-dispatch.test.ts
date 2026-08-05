import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ESTEIRA_INBOX_DIR_ENV_VAR, dispatchPhase, esteiraInboxDir, reconcileOrphanedSessions, releaseLock } from '../src/main/esteira-dispatch';
import { openEsteiraStore, type EsteiraStore } from '../src/main/esteira-store';
import { parseRunInputText } from '../src/shared/esteira/contract/runInput';
import type { EventDraft } from '../src/shared/esteira/ingest/resultToEvents';

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
