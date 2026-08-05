import { describe, expect, it, vi } from 'vitest';
import { preparePhase } from '../src/renderer/src/Esteira/preparePhase';
import { cardView, dispatchView } from '../src/renderer/src/Esteira/esteiraView';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { EsteiraDispatchDto, EsteiraSnapshotDto } from '../src/shared/esteira/ipc';
import type { StoreEvent, StoreSnapshot } from '../src/shared/esteira/store/storeFormat';

// Spec 010 / batch B6 — o "Preparar" passou a ter DOIS botões: o do painel do
// store (B1/B2) e o "⌁ Preparar" da trilha do mapa. Duas orquestrações do mesmo
// gesto divergiriam no primeiro conserto — e divergir aqui significa uma tela
// abrindo sessão onde a outra recusa. Por isso a sequência inteira (resolver o
// cwd, disparar, abrir a aba, escrever a frase) mora num lugar só, e é este
// arquivo que a prende.

let seq = 0;
function evt(type: string, payload: Record<string, unknown>): StoreEvent {
  seq += 1;
  return { seq, event_id: `e${seq}`, at: '2026-08-04T09:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

const snapshot: StoreSnapshot = reduceEvents([
  evt('discovery.created', { id: 'dsc-1', title: 'Fila trava sem sinal', targetRepo: 'donel-dev' }),
]);

function estado(withSnapshot: StoreSnapshot = snapshot): EsteiraSnapshotDto {
  return {
    snapshot: withSnapshot,
    compatibility: 'read-write',
    storeDir: 'C:/store',
    inboxDir: 'C:/inbox',
    outboxDir: 'C:/outbox',
    rejectedOnLastScan: 0,
    ingestedOnLastScan: 0,
    unreadableOnLastScan: 0,
  };
}

function alvo() {
  const card = cardView(snapshot, 'dsc-1')!;
  const view = dispatchView(card, { phase: 'discovery', targetKey: null });
  return { card, phase: view.phase.phase, target: view.target! };
}

const OK: EsteiraDispatchDto = {
  ok: true,
  runId: 'run-1',
  sessionId: 'ses-1',
  inputPath: 'C:/inbox/run-1.json',
  resultPath: 'C:/outbox/run-1.json',
  state: estado(),
};

describe('preparePhase', () => {
  it('repo conhecido: dispara, abre a aba com o comando escrito e diz onde ela abriu', async () => {
    const openSession = vi.fn();
    const dispatch = vi.fn().mockResolvedValue(OK);

    const result = await preparePhase(
      { ...alvo(), projects: [{ name: 'donel-dev', path: 'C:/repos/donel-dev' }] },
      { dispatch, openSession },
    );

    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'discovery',
        discoveryId: 'dsc-1',
        workspace: expect.objectContaining({ target_repo: 'donel-dev', repo_path: 'C:/repos/donel-dev' }),
      }),
    );
    const request = openSession.mock.calls[0][0];
    expect(request.cwd).toBe('C:/repos/donel-dev');
    expect(request.sessionId).toBe('ses-1');
    // Invariante 2: o comando é escrito, nunca enviado.
    // A2 — a skill do FORK (sufixo -3), nunca o plugin 2.1.0 sem sufixo.
    expect(request.command).toBe('/esteira-discovery-3 --input "C:/inbox/run-1.json"');
    expect(request.command).not.toMatch(/[\r\n]/);
    // B5 — o Enter deixou de ser gesto humano nesta frase: o app aperta
    // sozinho assim que o terminal aceita entrada (ver esteiraSession.test.ts).
    expect(result.message).toContain('aperta o Enter sozinho');
    expect(result.message).not.toContain('O Enter é seu');
  });

  it('repo que o app não conhece: a fase fica preparada, NENHUMA aba abre, e a razão nomeia o repo', async () => {
    const openSession = vi.fn();
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(OK), openSession });

    expect(openSession).not.toHaveBeenCalled();
    expect(result.message).toContain('não conheço o repo "donel-dev"');
    expect(result.message).toContain('C:/inbox/run-1.json');
  });

  it('card já travado: a recusa usa a MESMA palavra do bloco da trava', async () => {
    const recusa: EsteiraDispatchDto = {
      ok: false,
      reason: 'locked',
      lock: {
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'plano',
        holderKind: 'skill',
        acquiredAt: '2026-08-04T09:30:00.000Z',
        cliSessionId: null,
        mirroredLabel: null,
        resource: null,
      },
      state: estado(),
    };
    const openSession = vi.fn();
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(recusa), openSession });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('em andamento');
    expect(result.message).toContain('plano');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('A8/A20: recurso ocupado por outro assunto — a recusa nomeia o repo e quem segura', async () => {
    const recusa: EsteiraDispatchDto = {
      ok: false,
      reason: 'resource-busy',
      lock: {
        subject: { entity: 'work_item', id: 'wi-2' },
        phase: 'implementar',
        holderKind: 'app',
        acquiredAt: '2026-08-05T09:00:00.000Z',
        cliSessionId: null,
        mirroredLabel: null,
        resource: { targetRepo: 'donel-dev', branch: 'feat/wi-2', treePath: null },
      },
      state: estado(),
    };
    const openSession = vi.fn();
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(recusa), openSession });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('donel-dev');
    expect(result.message).toContain('feat/wi-2');
    expect(result.message).toContain('implementar');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('B3: sessão viva já existente para o mesmo assunto+fase — a recusa não deixa abrir uma segunda', async () => {
    const recusa: EsteiraDispatchDto = {
      ok: false,
      reason: 'session-active',
      session: {
        id: 'ses-1',
        cliSessionId: 'cli-1',
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        continuesSessionId: null,
        handoffReason: null,
        cwd: 'C:/repos/donel-dev',
        model: null,
        effort: null,
        modelEffortAssumed: false,
        startedAt: '2026-08-05T09:00:00.000Z',
        endedAt: null,
        inputPath: 'C:/inbox/run-1.json',
        resultPath: 'C:/outbox/run-1.json',
        claimed: true,
      },
      state: estado(),
    };
    const openSession = vi.fn();
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(recusa), openSession });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('discovery');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('A1: fase já concluída sobre este assunto — a recusa nomeia o desfecho e pede confirmação', async () => {
    const recusa: EsteiraDispatchDto = {
      ok: false,
      reason: 'phase-done',
      phase: {
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        startedAt: '2026-08-04T09:00:00.000Z',
        completedAt: '2026-08-04T09:30:00.000Z',
        outcome: 'done',
        summary: null,
        failure: null,
        lastRunId: 'run-1',
        channel: null,
        risk: null,
        seeded: false,
      },
      state: estado(),
    };
    const openSession = vi.fn();
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(recusa), openSession });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('concluída');
    expect(result.message).toContain('confirme');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('histórico só de leitura: nada é gravado, e a tela diz isso', async () => {
    const recusa: EsteiraDispatchDto = { ok: false, reason: 'store-refused', state: estado() };
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(recusa), openSession: vi.fn() });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('não aceita escrita');
  });

  it('alvo fora do contrato: a razão vem com o código, não um erro genérico', async () => {
    const recusa: EsteiraDispatchDto = {
      ok: false,
      reason: 'invalid-target',
      issues: [{ code: 'issue_without_target_repo', path: 'run.workspace', message: 'x' }],
      state: estado(),
    };
    const result = await preparePhase({ ...alvo(), projects: [] }, { dispatch: vi.fn().mockResolvedValue(recusa), openSession: vi.fn() });
    expect(result.message).toContain('issue_without_target_repo');
  });
});
