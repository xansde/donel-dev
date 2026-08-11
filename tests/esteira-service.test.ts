import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEsteiraService, type EsteiraService } from '../src/main/esteira-service';
import { createFakeBoardAdapter } from '../src/main/esteira-mirror';
import {
  isValidClaimSessionIpcInput,
  isValidCreateDiscoveryIpcInput,
  isValidDispatchIpcInput,
  isValidEndSessionIpcInput,
  isValidReleaseLockIpcInput,
  isValidSeedIpcInput,
} from '../src/shared/esteira/ipc';

// Spec 010 — o servico que liga o store ao app: boot, varredura do outbox,
// watcher e os gestos que a tela dispara. O que se prova aqui:
//
// - o que a skill devolveu APARECE, e o que ela devolveu quebrado aparece como
//   ERRO (nunca como ausencia);
// - o gesto do app (criar discovery, disparar, liberar trava) muda o snapshot
//   e avisa quem esta olhando;
// - store incompativel nao trava o app: ele mostra o estado e recusa escrever.

const EXAMPLES_DIR = join(__dirname, '..', 'docs', 'esteira-dev', 'contract', 'v1', 'examples');

let root: string;
let service: EsteiraService;

function open(overrides: Record<string, unknown> = {}): EsteiraService {
  let seq = 0;
  return createEsteiraService({
    storeDir: join(root, 'store'),
    inboxDir: join(root, 'inbox'),
    outboxDir: join(root, 'outbox'),
    channel: 'alfa',
    now: () => '2026-08-04T14:30:00.000Z',
    newId: (prefix: string) => {
      seq += 1;
      return `${prefix}-${seq}`;
    },
    ...overrides,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'donel-esteira-service-'));
  mkdirSync(join(root, 'outbox'), { recursive: true });
  service = open();
});

afterEach(() => {
  service.dispose();
  rmSync(root, { recursive: true, force: true });
});

function putResult(name: string, as = `${name}.json`): void {
  copyFileSync(join(EXAMPLES_DIR, `${name}.json`), join(root, 'outbox', as));
}

describe('boot', () => {
  it('abre o store limpo e diz onde tudo mora', () => {
    const state = service.snapshotDto();

    expect(state.compatibility).toBe('read-write');
    expect(state.snapshot.discoveries).toHaveLength(0);
    expect(state.storeDir).toBe(join(root, 'store'));
    expect(state.outboxDir).toBe(join(root, 'outbox'));
  });

  it('ingere o que ja estava no outbox — trabalho feito com o app fechado nao se perde', () => {
    putResult('discovery-com-tracker');
    const booted = open();

    expect(booted.snapshotDto().snapshot.discoveries).toHaveLength(1);
    booted.dispose();
  });

  // A7 — reconciliacao manifesto-sem-result: sessao que sobrou aberta de uma
  // execucao ANTERIOR (nunca chamamos endSession — "o app fechou") aparece
  // interrompida no PROXIMO boot, sem que ninguem precise notar sozinho.
  it('A7: sessao orfa de uma execucao anterior vira interrompida no proximo boot, com a trava liberada', () => {
    const created = service.createDiscovery({ title: 'Card', problem: null, targetRepo: 'atlas', scopeRepos: [], tracker: null });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: null,
      continuesSessionId: null,
      handoffReason: null,
    });
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;
    expect(service.snapshotDto().snapshot.locks).toHaveLength(1);

    // Nunca chamamos endSession: e exatamente o que "o app fechou sem ninguem
    // fechar a aba" significa. O boot SEGUINTE, no mesmo storeDir, e quem tem
    // que notar sozinho.
    const reopened = open();
    const snapshot = reopened.snapshotDto().snapshot;
    const session = snapshot.sessions.find((entry) => entry.id === dispatched.sessionId);

    expect(session?.endedAt).not.toBeNull();
    expect(session?.endReason).toContain('result.json');
    expect(snapshot.locks).toHaveLength(0);
    const phase = snapshot.phases.find((entry) => entry.subject.id === created.discoveryId);
    // A fase nao vira "concluida": ela so deixou de estar presa em silencio.
    expect(phase?.completedAt).toBeNull();
    reopened.dispose();
  });

  it('A7: sessao cujo result JA chegou ao outbox e ingerida normalmente no proximo boot, nao "interrompida"', () => {
    const created = service.createDiscovery({ title: 'Card', problem: null, targetRepo: 'atlas', scopeRepos: [], tracker: null });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: null,
      continuesSessionId: null,
      handoffReason: null,
    });
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;

    // A skill terminou de verdade e deixou o result.json — so ninguem
    // reabriu o app para ingeri-lo ainda. Documento MINIMO, com o mesmo
    // discoveryId do disparo — nao o exemplo do corpus (ele traz outro id).
    const doc = {
      contract_version: '1.0.0',
      kind: 'esteira.result',
      run: { run_id: dispatched.runId, phase: 'discovery', status: 'success', started_at: '2026-08-04T14:30:00.000Z', finished_at: '2026-08-04T14:35:00.000Z', failure: null },
      actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
      subject: { discovery_id: created.discoveryId, plan_id: null, work_item_id: null },
      workspace: null,
      facts: [
        { type: 'discovery.recorded', discovery_id: created.discoveryId, title: 'Card', problem: null, tracker: null, target_repo: null, scope_repos: [] },
        { type: 'gate.confirmed', subject: { entity: 'discovery', id: created.discoveryId }, condition: 'x', confirmed_by: 'dono', confirmed_at: null },
        { type: 'phase.completed', subject: { entity: 'discovery', id: created.discoveryId }, phase: 'discovery', outcome: 'done', summary: null },
      ],
    };
    writeFileSync(dispatched.resultPath, JSON.stringify(doc), 'utf8');

    const reopened = open();
    const snapshot = reopened.snapshotDto().snapshot;
    const phase = snapshot.phases.find((entry) => entry.subject.id === created.discoveryId);

    expect(phase?.completedAt).not.toBeNull();
    const session = snapshot.sessions.find((entry) => entry.id === dispatched.sessionId);
    expect(session?.endReason).toBeNull(); // encerrada pela CONCLUSAO da fase, nao pela reconciliacao
    reopened.dispose();
  });

  // A6 — revalida os erros pendentes na abertura: arquivo consertado ou
  // removido nao deveria continuar acusando defeito para sempre.
  it('A6: erro cujo arquivo sumiu do outbox sai da lista no proximo boot', () => {
    const path = join(root, 'outbox', 'run-quebrado.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    // F26 — o fixture tem finished_at ANTES do HISTORIC_CONTRACT_CUTOFF; este
    // teste quer um documento invalido de HOJE, sem relacao com a anistia do
    // outbox historico, entao pula o timestamp para depois do corte.
    doc.run.started_at = '2026-08-06T09:00:00.000Z';
    doc.run.finished_at = '2026-08-06T09:41:07.000Z';
    doc.facts[0].fanout_cards = ['x'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    service.scanOutbox();
    expect(service.snapshotDto().snapshot.ingestErrors).toHaveLength(1);

    unlinkSync(path);
    const reopened = open();

    expect(reopened.snapshotDto().snapshot.ingestErrors).toHaveLength(0);
    expect(reopened.snapshotDto().snapshot.ingestRecoveries).toHaveLength(1);
    reopened.dispose();
  });

  it('A6: erro cujo arquivo foi CONSERTADO no outbox sai da lista no proximo boot', () => {
    const path = join(root, 'outbox', 'run-quebrado.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    // F26 — ver comentario no teste irmao acima.
    doc.run.started_at = '2026-08-06T09:00:00.000Z';
    doc.run.finished_at = '2026-08-06T09:41:07.000Z';
    doc.facts[0].fanout_cards = ['x'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    service.scanOutbox();
    expect(service.snapshotDto().snapshot.ingestErrors).toHaveLength(1);

    delete doc.facts[0].fanout_cards;
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    const reopened = open();

    expect(reopened.snapshotDto().snapshot.ingestErrors).toHaveLength(0);
    expect(reopened.snapshotDto().snapshot.discoveries).toHaveLength(1);
    reopened.dispose();
  });
});

describe('varredura do outbox', () => {
  it('o result.json da skill aparece no snapshot', () => {
    putResult('discovery-com-tracker');
    const state = service.scanOutbox();

    expect(state.snapshot.discoveries[0].title).toBe('Fila de importacao trava sem sinal');
    expect(state.rejectedOnLastScan).toBe(0);
  });

  // Achado do print 07 do roteiro `espelho-pendente`: a tela dizia "Nada novo
  // no outbox." enquanto o card mudava de etapa embaixo da frase. A varredura
  // sabia o que tinha ingerido; o DTO nao carregava.
  it('a varredura conta o que INGERIU, nao so o que recusou', () => {
    putResult('discovery-com-tracker');

    const state = service.scanOutbox();

    expect(state.ingestedOnLastScan).toBe(1);
    expect(state.unreadableOnLastScan).toBe(0);
  });

  it('reler o mesmo arquivo nao conta como novidade — nada mudou', () => {
    putResult('discovery-com-tracker');
    service.scanOutbox();

    const again = service.scanOutbox();

    expect(again.ingestedOnLastScan).toBe(0);
  });

  it('documento fora do contrato vira erro VISIVEL, e o card ganha o sinal', () => {
    writeFileSync(join(root, 'outbox', 'quebrado.json'), '{"kind":"esteira.result","contract_version":"1.0.0"}', 'utf8');
    putResult('discovery-com-tracker');

    const state = service.scanOutbox();

    expect(state.rejectedOnLastScan).toBe(1);
    expect(state.snapshot.ingestErrors).toHaveLength(1);
    // O caminho feliz do outro arquivo nao foi prejudicado.
    expect(state.snapshot.discoveries).toHaveLength(1);
  });

  it('avisa quem esta olhando quando algo entrou', () => {
    const listener = vi.fn();
    service.startWatching(listener);
    putResult('discovery-com-tracker');

    service.scanOutbox();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].snapshot.discoveries).toHaveLength(1);
  });

  it('varredura sem novidade nao avisa ninguem', () => {
    const listener = vi.fn();
    putResult('discovery-com-tracker');
    service.scanOutbox();
    service.startWatching(listener);

    service.scanOutbox();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('gestos do app', () => {
  it('criar discovery: o APP gera o id, e o card aparece na hora', () => {
    const created = service.createDiscovery({
      title: 'Esteira do Donel nao mostra o que foi feito',
      problem: 'O mapa afirma "nao realizada" quando o que houve foi falha de leitura.',
      targetRepo: 'donel-dev',
      scopeRepos: [],
      tracker: null,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.discoveryId).toMatch(/^dsc-/);
    const discovery = created.state.snapshot.discoveries[0];
    expect(discovery.title).toBe('Esteira do Donel nao mostra o que foi feito');
    // Card recem-criado: etapa discovery, sem sinal de plano faltando.
    expect(discovery.derivedStage).toBe('discovery');
    expect(discovery.stageSignals).toEqual([]);
  });

  it('o id gerado respeita o padrao do contrato', () => {
    const created = service.createDiscovery({ title: 'Card novo', problem: null, targetRepo: null, scopeRepos: [], tracker: null });
    expect(created.ok && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(created.discoveryId)).toBe(true);
  });

  // Achado do dogfooding de 06/08 — o card so podia declarar repo ao nascer, e
  // num campo de texto livre. Um card com alvo `"spotsys e api-spotsys"` (uma
  // frase, nao uma pasta) nao dispara e nao tinha gesto que o consertasse.
  describe('corrigir alvo e escopo de um card que ja existe (D-6)', () => {
    function cardDeObras(): string {
      const created = service.createDiscovery({
        title: 'Diario de Obra',
        problem: null,
        targetRepo: 'spotsys e api-spotsys',
        scopeRepos: [],
        tracker: null,
      });
      if (!created.ok) throw new Error('setup falhou');
      return created.discoveryId;
    }

    it('troca a ancora e passa a declarar o escopo multi-repo', () => {
      const id = cardDeObras();
      const gesto = service.setDiscoveryRepos({ discoveryId: id, targetRepo: 'api-spotsys', scopeRepos: ['api-spotsys', 'spotsys'] });

      expect(gesto.ok).toBe(true);
      const card = gesto.state.snapshot.discoveries.find((entry) => entry.id === id)!;
      expect(card.targetRepo).toBe('api-spotsys');
      expect(card.scopeRepos).toEqual(['api-spotsys', 'spotsys']);
      // A correcao nao pode levar junto nada mais do card.
      expect(card.title).toBe('Diario de Obra');
      expect(card.derivedStage).toBe('discovery');
    });

    it('aceita voltar a ficar sem repo — discovery investiga problema, nao repositorio', () => {
      const id = cardDeObras();
      const gesto = service.setDiscoveryRepos({ discoveryId: id, targetRepo: null, scopeRepos: [] });
      expect(gesto.ok).toBe(true);
      const card = gesto.state.snapshot.discoveries.find((entry) => entry.id === id)!;
      expect(card.targetRepo).toBeNull();
      expect(card.scopeRepos).toEqual([]);
    });

    it('apara o que chega e descarta entrada vazia, em vez de gravar lixo', () => {
      const id = cardDeObras();
      const gesto = service.setDiscoveryRepos({ discoveryId: id, targetRepo: '  api-spotsys  ', scopeRepos: ['  spotsys ', '   '] });
      expect(gesto.ok).toBe(true);
      const card = gesto.state.snapshot.discoveries.find((entry) => entry.id === id)!;
      expect(card.targetRepo).toBe('api-spotsys');
      expect(card.scopeRepos).toEqual(['spotsys']);
    });

    it('card que nao existe: recusa com a razao, sem inventar entidade', () => {
      const gesto = service.setDiscoveryRepos({ discoveryId: 'dsc-nao-existe', targetRepo: 'donel-dev', scopeRepos: [] });
      expect(gesto.ok).toBe(false);
      if (gesto.ok) return;
      expect(gesto.reason).toBe('unknown-subject');
    });
  });

  it('disparar uma fase trava o card e deixa o run-input pronto para a skill', () => {
    const created = service.createDiscovery({ title: 'Card novo', problem: null, targetRepo: 'donel-dev', scopeRepos: [], tracker: null });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'donel-dev', repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });

    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;
    expect(dispatched.state.snapshot.locks).toHaveLength(1);
    expect(dispatched.inputPath.startsWith(join(root, 'inbox'))).toBe(true);
    expect(dispatched.resultPath.startsWith(join(root, 'outbox'))).toBe(true);
  });

  it('a trava aparece e some por gesto — nunca fica orfa', () => {
    const created = service.createDiscovery({ title: 'Card novo', problem: null, targetRepo: null, scopeRepos: [], tracker: null });
    if (!created.ok) return;
    service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: null,
      continuesSessionId: null,
      handoffReason: null,
    });

    const after = service.releaseLock({ subject: { entity: 'discovery', id: created.discoveryId }, phase: 'discovery' });
    expect(after.snapshot.locks).toHaveLength(0);
  });

  it('todo gesto avisa quem esta olhando', () => {
    const listener = vi.fn();
    service.startWatching(listener);

    const created = service.createDiscovery({ title: 'Card novo', problem: null, targetRepo: null, scopeRepos: [], tracker: null });
    if (!created.ok) return;
    service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: null,
      continuesSessionId: null,
      handoffReason: null,
    });

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

// Batch B1 — o ciclo de vida da sessao que o "Preparar" abre. Dois fatos, e os
// dois existem para que a tela pare de mentir num sentido ou no outro:
// assumir a sessao e o que autoriza dizer "em andamento"; fechar a aba sem
// concluir NAO pode deixar o card preso.
describe('a sessao que o disparo abre', () => {
  function cardDisparado(): { discoveryId: string; sessionId: string } {
    const created = service.createDiscovery({ title: 'Card novo', problem: null, targetRepo: 'donel-dev', scopeRepos: [], tracker: null });
    if (!created.ok) throw new Error('createDiscovery falhou');
    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'donel-dev', repo_path: 'C:/dev/donel-dev', worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    if (!dispatched.ok) throw new Error('dispatch falhou');
    return { discoveryId: created.discoveryId, sessionId: dispatched.sessionId };
  }

  it('a sessao recem-disparada NAO esta assumida — disparar nao e comecar', () => {
    const { sessionId } = cardDisparado();
    const session = service.snapshotDto().snapshot.sessions.find((entry) => entry.id === sessionId);
    expect(session?.claimed).toBe(false);
  });

  it('a aba abriu: o id do CLI vira dono da sessao e da trava', () => {
    const { sessionId } = cardDisparado();
    const state = service.claimSession({ sessionId, cliSessionId: 'cli-abc' });

    expect(state.snapshot.sessions.find((entry) => entry.id === sessionId)?.claimed).toBe(true);
    expect(state.snapshot.locks[0].cliSessionId).toBe('cli-abc');
  });

  it('assumir a mesma sessao duas vezes com o mesmo id nao vira fato novo', () => {
    const { sessionId } = cardDisparado();
    service.claimSession({ sessionId, cliSessionId: 'cli-abc' });
    const listener = vi.fn();
    service.startWatching(listener);

    service.claimSession({ sessionId, cliSessionId: 'cli-abc' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('fechar a aba sem concluir encerra a sessao E solta a trava — o card nao fica preso', () => {
    const { sessionId } = cardDisparado();
    service.claimSession({ sessionId, cliSessionId: 'cli-abc' });

    const state = service.endSession({ sessionId, reason: 'tab-closed' });

    expect(state.snapshot.sessions.find((entry) => entry.id === sessionId)?.endedAt).not.toBeNull();
    expect(state.snapshot.locks).toHaveLength(0);
  });

  it('a fase interrompida continua VISIVEL — encerrar a sessao nao apaga que ela comecou', () => {
    const { sessionId } = cardDisparado();
    const state = service.endSession({ sessionId, reason: 'tab-closed' });

    const phase = state.snapshot.phases[0];
    expect(phase.startedAt).not.toBeNull();
    // Nao concluiu e nao falhou: a fase ficou pelo meio, e e isso que a tela diz.
    expect(phase.completedAt).toBeNull();
    expect(phase.failure).toBeNull();
  });

  it('encerrar uma sessao que ja acabou nao grava nada', () => {
    const { sessionId } = cardDisparado();
    service.endSession({ sessionId, reason: 'tab-closed' });
    const listener = vi.fn();
    service.startWatching(listener);

    service.endSession({ sessionId, reason: 'tab-closed' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('sessao desconhecida nao muta nada', () => {
    const listener = vi.fn();
    service.startWatching(listener);

    service.claimSession({ sessionId: 'ses-fantasma', cliSessionId: 'cli-abc' });
    service.endSession({ sessionId: 'ses-fantasma', reason: null });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('espelho no tracker (D-12) — cortesia que nunca vira bloqueio', () => {
  const MIRROR_CONFIG = {
    enabled: true,
    provider: 'taskdex',
    columnByStage: { discovery: 'Discovery', planned: 'Plano' },
    phaseLabelPrefix: 'esteira:em-andamento:',
    maxAttempts: 3,
  } as const;

  function comEspelho(controlPath: string): EsteiraService {
    return open({
      mirror: {
        config: MIRROR_CONFIG,
        adapter: createFakeBoardAdapter({ provider: 'taskdex', controlPath }),
      },
    });
  }

  function controle(mode: 'ok' | 'fail', error = 'o board nao respondeu'): string {
    const controlPath = join(root, 'mirror-fake.json');
    writeFileSync(controlPath, JSON.stringify({ mode, error }), 'utf8');
    return controlPath;
  }

  it('board caido NAO impede o trabalho local — o card entra, a fila e que fica pendente', async () => {
    const espelhado = comEspelho(controle('fail', 'sem rede'));
    putResult('discovery-com-tracker');

    const state = espelhado.scanOutbox();
    // O trabalho local aconteceu ANTES de qualquer conversa com o board.
    expect(state.snapshot.discoveries[0].title).toBe('Fila de importacao trava sem sinal');

    await espelhado.drainMirror();
    const depois = espelhado.snapshotDto().snapshot;
    expect(depois.discoveries[0].title).toBe('Fila de importacao trava sem sinal');
    expect(depois.mirrorQueue.length).toBeGreaterThan(0);
    expect(depois.mirrorQueue[0].lastError).toBe('sem rede');
    // E o card DIZ que ha espelho pendente, em vez de esconder.
    expect(depois.discoveries[0].stageSignals).toContain('mirror-pending');
    espelhado.dispose();
  });

  it('o gesto local nao ESPERA o board — adapter que nunca responde nao segura o disparo', () => {
    const travado = open({
      mirror: {
        config: MIRROR_CONFIG,
        adapter: {
          provider: 'taskdex',
          applyLabel: () => new Promise<never>(() => {}),
          comment: () => new Promise<never>(() => {}),
          moveColumn: () => new Promise<never>(() => {}),
        },
      },
    });
    putResult('discovery-com-tracker');
    travado.scanOutbox();

    const dispatched = travado.dispatch({
      phase: 'plano',
      discoveryId: 'dsc-2026-08-03-a',
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'atlas', repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });

    expect(dispatched.ok).toBe(true);
    expect(dispatched.state.snapshot.locks).toHaveLength(1);
    travado.dispose();
  });

  it('o board volta: a fila drena no gesto de reenvio e o sinal some', async () => {
    const controlPath = controle('fail');
    const espelhado = comEspelho(controlPath);
    putResult('discovery-com-tracker');
    espelhado.scanOutbox();
    await espelhado.drainMirror();
    expect(espelhado.snapshotDto().snapshot.mirrorQueue.length).toBeGreaterThan(0);

    writeFileSync(controlPath, JSON.stringify({ mode: 'ok' }), 'utf8');
    const state = await espelhado.retryMirror();

    expect(state.snapshot.mirrorQueue).toHaveLength(0);
    expect(state.snapshot.discoveries[0].stageSignals).not.toContain('mirror-pending');
    // O que o board passou a refletir fica registrado — nao volta para a fila.
    expect(state.snapshot.mirrorSynced.length).toBeGreaterThan(0);
    espelhado.dispose();
  });

  it('sem adapter plugado, nada e enfileirado — fila que ninguem drena seria pendencia eterna', () => {
    putResult('discovery-com-tracker');
    const state = service.scanOutbox();

    expect(state.snapshot.mirrorQueue).toHaveLength(0);
    expect(state.snapshot.discoveries[0].stageSignals).not.toContain('mirror-pending');
  });

  it('card sem tracker nao gera espelho nenhum', async () => {
    const espelhado = comEspelho(controle('ok'));
    espelhado.createDiscovery({ title: 'Card local', problem: null, targetRepo: null, scopeRepos: [], tracker: null });

    await espelhado.drainMirror();

    expect(espelhado.snapshotDto().snapshot.mirrorQueue).toHaveLength(0);
    expect(espelhado.snapshotDto().snapshot.mirrorSynced).toHaveLength(0);
    espelhado.dispose();
  });

  // Este caso so existe DEPOIS do merge de B3 com B5, e e a costura entre os
  // dois: os gestos locais do B3 (estado do item, override de etapa) sao
  // exatamente os que MOVEM a macro etapa, e mover a macro etapa e o que o
  // espelho reflete em coluna (D-12). Cada batch estava certo sozinho e a
  // ligacao nao existia em nenhum dos dois — o gesto mudava a etapa aqui e o
  // board nunca ficava sabendo, sem nada na tela denunciando.
  it('gesto local que move a macro etapa enfileira a coluna nova (B3 x B5)', async () => {
    const espelhado = comEspelho(controle('fail', 'sem rede'));
    putResult('discovery-com-tracker');
    espelhado.scanOutbox();
    await espelhado.drainMirror();

    const antes = espelhado.snapshotDto().snapshot;
    expect(antes.discoveries[0].derivedStage).toBe('planned');
    expect(antes.mirrorQueue.find((entry) => entry.operation === 'column')?.payload.column).toBe('Plano');

    // O humano puxa o card de volta a mao (D-13). Nenhum gesto do B3 chamava o
    // espelho: sem a costura, a fila continuaria pedindo a coluna ANTIGA.
    const forcado = espelhado.setStageOverride({ discoveryId: antes.discoveries[0].id, value: 'discovery', reason: null });
    expect(forcado.ok).toBe(true);

    const depois = espelhado.snapshotDto().snapshot;
    expect(depois.discoveries[0].stageOverride?.value).toBe('discovery');
    expect(depois.mirrorQueue.find((entry) => entry.operation === 'column')?.payload.column).toBe('Discovery');
    // E o card continua dizendo que o board esta atrasado, em vez de esconder.
    expect(depois.discoveries[0].stageSignals).toContain('mirror-pending');
    espelhado.dispose();
  });
});

describe('store que nao aceita escrita', () => {
  it('o app mostra o estado e RECUSA o gesto, em vez de falhar calado', () => {
    mkdirSync(join(root, 'store2'), { recursive: true });
    writeFileSync(
      join(root, 'store2', 'events.jsonl'),
      `${JSON.stringify({ kind: 'esteira.store.header', schema_version: '9.0.0', created_at: '2026-08-04T14:30:00.000Z', created_by_channel: 'beta' })}\n`,
      'utf8',
    );

    const readOnly = open({ storeDir: join(root, 'store2') });
    expect(readOnly.snapshotDto().compatibility).toBe('read-only');

    const created = readOnly.createDiscovery({ title: 'Card novo', problem: null, targetRepo: null, scopeRepos: [], tracker: null });
    expect(created).toMatchObject({ ok: false, reason: 'store-refused' });
    readOnly.dispose();
  });
});

describe('validacao de payload do IPC (o main so muta depois de validar)', () => {
  it('createDiscovery exige titulo', () => {
    expect(isValidCreateDiscoveryIpcInput({ title: 'ok', problem: null, targetRepo: null, scopeRepos: [], tracker: null })).toBe(true);
    expect(isValidCreateDiscoveryIpcInput({ title: '   ', scopeRepos: [] })).toBe(false);
    expect(isValidCreateDiscoveryIpcInput(null)).toBe(false);
  });

  it('dispatch exige fase e discovery, e workspace com repo quando existe', () => {
    expect(isValidDispatchIpcInput({ phase: 'discovery', discoveryId: 'dsc-1', planId: null, workItemId: null, workspace: null })).toBe(true);
    expect(isValidDispatchIpcInput({ phase: '', discoveryId: 'dsc-1' })).toBe(false);
    expect(isValidDispatchIpcInput({ phase: 'plano', discoveryId: 'dsc-1', workspace: { repo_path: 'x' } })).toBe(false);
  });

  it('claimSession/endSession exigem uma sessao de verdade', () => {
    expect(isValidClaimSessionIpcInput({ sessionId: 'ses-1', cliSessionId: 'cli-1' })).toBe(true);
    expect(isValidClaimSessionIpcInput({ sessionId: 'ses-1', cliSessionId: '' })).toBe(false);
    expect(isValidClaimSessionIpcInput({ cliSessionId: 'cli-1' })).toBe(false);
    expect(isValidEndSessionIpcInput({ sessionId: 'ses-1', reason: 'tab-closed' })).toBe(true);
    expect(isValidEndSessionIpcInput({ sessionId: 'ses-1', reason: null })).toBe(true);
    expect(isValidEndSessionIpcInput({ sessionId: '  ' })).toBe(false);
  });

  it('releaseLock exige um assunto de verdade', () => {
    expect(isValidReleaseLockIpcInput({ subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery' })).toBe(true);
    expect(isValidReleaseLockIpcInput({ subject: { entity: 'card', id: 'x' }, phase: 'discovery' })).toBe(false);
    expect(isValidReleaseLockIpcInput({ phase: 'discovery' })).toBe(false);
  });
});

describe('semear trabalho em curso (D-2)', () => {
  const DOCUMENTO = JSON.stringify({
    discovery: { title: 'Trabalho que ja existia', target_repo: 'donel-dev' },
    phases: [{ phase: 'discovery', outcome: 'done' }],
    plans: [{ ref: 'p1', title: 'O plano que ja existe' }],
    items: [
      { title: 'Item em curso', type: 'issue', state: 'in-progress', plan: 'p1' },
      { title: 'Item que nao comecou', type: 'spike', state: 'open', plan: 'p1' },
    ],
  });

  it('planta o card, o plano e os itens, e a etapa sai DERIVADA dos fatos semeados', () => {
    const result = service.seed({ document: DOCUMENTO });
    if (!result.ok) throw new Error(`esperava ok: ${JSON.stringify(result)}`);

    const snapshot = result.state.snapshot;
    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.workItems).toHaveLength(2);
    // Nenhuma etapa digitada: item em curso ⇒ Execução, pela mesma tabela de sempre.
    expect(snapshot.discoveries[0].derivedStage).toBe('execution');
    expect(snapshot.discoveries[0].seeded).toBe(true);
  });

  it('os eventos vao para o log com source.kind = "seed" — a proveniencia fica no disco, nao so na tela', () => {
    const result = service.seed({ document: DOCUMENTO });
    expect(result.ok).toBe(true);

    const linhas = readFileSync(join(root, 'store', 'events.jsonl'), 'utf8').trim().split('\n').slice(1);
    const eventos = linhas.map((linha) => JSON.parse(linha));
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos.every((evento) => evento.source.kind === 'seed')).toBe(true);
    expect(eventos.map((evento) => evento.type)).toContain('discovery.created');
  });

  it('documento fora do formato NAO escreve nada e devolve o motivo com caminho', () => {
    const result = service.seed({ document: JSON.stringify({ discovery: { problem: 'sem titulo' } }) });
    if (result.ok) throw new Error('esperava recusa');

    if (result.reason !== 'invalid-seed') throw new Error(`esperava invalid-seed, veio ${result.reason}`);
    expect(result.issues).toContainEqual(expect.objectContaining({ path: 'discovery.title' }));
    expect(result.state.snapshot.discoveries).toHaveLength(0);
  });

  it('disparar uma fase em cima do card semeado funciona igual', () => {
    const seeded = service.seed({ document: DOCUMENTO });
    if (!seeded.ok) throw new Error('seed falhou');

    const dispatched = service.dispatch({
      phase: 'plano',
      discoveryId: seeded.discoveryId,
      planId: seeded.planIds[0],
      workItemId: null,
      workspace: { target_repo: 'donel-dev', repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });

    expect(dispatched.ok).toBe(true);
    expect(dispatched.state.snapshot.locks).toHaveLength(1);
  });

  it('store que nao aceita escrita recusa o seed, sem escrever nada', () => {
    mkdirSync(join(root, 'store3'), { recursive: true });
    writeFileSync(
      join(root, 'store3', 'events.jsonl'),
      `${JSON.stringify({ kind: 'esteira.store.header', schema_version: '9.0.0', created_at: '2026-08-04T14:30:00.000Z', created_by_channel: 'beta' })}\n`,
      'utf8',
    );
    const readOnly = open({ storeDir: join(root, 'store3') });

    expect(readOnly.seed({ document: DOCUMENTO })).toMatchObject({ ok: false, reason: 'store-refused' });
    readOnly.dispose();
  });

  it('o canal valida o payload antes de o main mutar qualquer coisa', () => {
    expect(isValidSeedIpcInput({ document: '{}' })).toBe(true);
    expect(isValidSeedIpcInput({ document: '   ' })).toBe(false);
    expect(isValidSeedIpcInput({})).toBe(false);
    expect(isValidSeedIpcInput(null)).toBe(false);
  });
});
