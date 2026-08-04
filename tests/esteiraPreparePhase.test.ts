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
    expect(request.command).toBe('/esteira-discovery --input "C:/inbox/run-1.json"');
    expect(request.command).not.toMatch(/[\r\n]/);
    expect(result.message).toContain('O Enter é seu');
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
