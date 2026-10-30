import { describe, expect, it } from 'vitest';
import {
  applyPermissionHeuristic,
  countBackgroundSubagents,
  defaultMatchesPermissionPrompt,
  INITIAL_SEMAPHORE_STATE,
  reduceSemaphoreState,
  type SemaphoreMachineState,
} from '../src/main/semaphore-state-machine';

// T009 — TDD da máquina de estados pura (FR-010). Transições conforme
// specs/001-mvp/spike-t002-resultado.md ("Decisão de arquitetura para T009")
// + addendum (Notification confirmada em PTY real).

describe('reduceSemaphoreState', () => {
  it('começa em working (INITIAL_SEMAPHORE_STATE)', () => {
    expect(INITIAL_SEMAPHORE_STATE.state).toBe('working');
    expect(INITIAL_SEMAPHORE_STATE.pendingToolSince).toBeNull();
  });

  it('userPromptSubmit -> working', () => {
    const after = reduceSemaphoreState({ state: 'waiting', pendingToolSince: null, stateEnteredAt: 0 }, { type: 'userPromptSubmit', at: 100 });
    expect(after.state).toBe('working');
    expect(after.stateEnteredAt).toBe(100);
  });

  it('preToolUse mantém working e registra pendingToolSince', () => {
    const after = reduceSemaphoreState(INITIAL_SEMAPHORE_STATE, { type: 'preToolUse', at: 50 });
    expect(after.state).toBe('working');
    expect(after.pendingToolSince).toBe(50);
  });

  it('preToolUse refresca pendingToolSince a cada chamada, sem alterar stateEnteredAt de working', () => {
    const workingSince10: SemaphoreMachineState = { state: 'working', pendingToolSince: null, stateEnteredAt: 10 };
    const afterFirst = reduceSemaphoreState(workingSince10, { type: 'preToolUse', at: 20 });
    const afterSecond = reduceSemaphoreState(afterFirst, { type: 'preToolUse', at: 35 });

    expect(afterSecond.state).toBe('working');
    expect(afterSecond.pendingToolSince).toBe(35);
    expect(afterSecond.stateEnteredAt).toBe(10); // não mudou — ainda é o mesmo "working" de antes
  });

  it('postToolUse limpa pendingToolSince (clearPending do spike) sem mudar o estado', () => {
    const pending: SemaphoreMachineState = { state: 'working', pendingToolSince: 42, stateEnteredAt: 0 };
    const after = reduceSemaphoreState(pending, { type: 'postToolUse', at: 99 });

    expect(after.state).toBe('working');
    expect(after.pendingToolSince).toBeNull();
  });

  it('stop -> waiting, mesmo com pendingToolSince setado', () => {
    const pending: SemaphoreMachineState = { state: 'working', pendingToolSince: 42, stateEnteredAt: 0 };
    const after = reduceSemaphoreState(pending, { type: 'stop', at: 100 });

    expect(after.state).toBe('waiting');
    expect(after.pendingToolSince).toBeNull();
    expect(after.stateEnteredAt).toBe(100);
  });

  it('notification -> permission (sinal primário confirmado no addendum T009)', () => {
    const after = reduceSemaphoreState(INITIAL_SEMAPHORE_STATE, { type: 'notification', at: 77 });
    expect(after.state).toBe('permission');
    expect(after.stateEnteredAt).toBe(77);
  });

  it('stop a partir de permission volta pra waiting (turno concluído após aprovação)', () => {
    const pending: SemaphoreMachineState = { state: 'permission', pendingToolSince: null, stateEnteredAt: 10 };
    const after = reduceSemaphoreState(pending, { type: 'stop', at: 200 });

    expect(after.state).toBe('waiting');
    expect(after.stateEnteredAt).toBe(200);
  });

  it('sessionEnd -> done a partir de qualquer estado', () => {
    for (const state of ['working', 'waiting', 'permission'] as const) {
      const after = reduceSemaphoreState({ state, pendingToolSince: null, stateEnteredAt: 0 }, { type: 'sessionEnd', at: 5 });
      expect(after.state).toBe('done');
    }
  });

  it('sessionEnd com reason clear/resume NÃO leva a done (FR-033): a aba continua, só a conversa trocou', () => {
    for (const reason of ['clear', 'resume']) {
      for (const state of ['working', 'waiting', 'permission'] as const) {
        const current: SemaphoreMachineState = { state, pendingToolSince: null, stateEnteredAt: 3 };
        expect(reduceSemaphoreState(current, { type: 'sessionEnd', at: 5, reason })).toBe(current);
      }
    }
  });

  it('sessionEnd com outro reason (ou sem reason) segue levando a done', () => {
    for (const reason of ['logout', 'prompt_input_exit', 'other', null, undefined]) {
      const after = reduceSemaphoreState({ state: 'waiting', pendingToolSince: null, stateEnteredAt: 0 }, { type: 'sessionEnd', at: 5, reason });
      expect(after.state).toBe('done');
    }
  });

  it('processExit -> done, tem prioridade e nunca depende de sessionEnd (kill forçado do spike)', () => {
    const permission: SemaphoreMachineState = { state: 'permission', pendingToolSince: null, stateEnteredAt: 10 };
    const after = reduceSemaphoreState(permission, { type: 'processExit', at: 15 });

    expect(after.state).toBe('done');
    expect(after.stateEnteredAt).toBe(15);
  });

  it('done é terminal — nenhum evento tira a sessão desse estado', () => {
    const done: SemaphoreMachineState = { state: 'done', pendingToolSince: null, stateEnteredAt: 10 };

    for (const event of [
      { type: 'userPromptSubmit', at: 20 },
      { type: 'preToolUse', at: 20 },
      { type: 'notification', at: 20 },
      { type: 'stop', at: 20 },
    ] as const) {
      expect(reduceSemaphoreState(done, event)).toBe(done); // mesma referência — no-op real
    }
  });
});

describe('applyPermissionHeuristic', () => {
  const MATCH = () => true;
  const NO_MATCH = () => false;

  it('não-op fora do estado working', () => {
    const waiting: SemaphoreMachineState = { state: 'waiting', pendingToolSince: null, stateEnteredAt: 0 };
    expect(applyPermissionHeuristic(waiting, 10_000, 2500, [], MATCH)).toBe(waiting);
  });

  it('não-op sem pendingToolSince (nenhuma ferramenta em curso)', () => {
    const working: SemaphoreMachineState = { state: 'working', pendingToolSince: null, stateEnteredAt: 0 };
    expect(applyPermissionHeuristic(working, 10_000, 2500, [], MATCH)).toBe(working);
  });

  it('não-op quando o timeout ainda não estourou, mesmo com o padrão batendo', () => {
    const pending: SemaphoreMachineState = { state: 'working', pendingToolSince: 1000, stateEnteredAt: 0 };
    // now - pendingToolSince = 2000ms < timeout de 2500ms
    expect(applyPermissionHeuristic(pending, 3000, 2500, [], MATCH)).toBe(pending);
  });

  it('não-op quando o timeout estourou mas o ring buffer NÃO bate com um prompt de permissão (evita falso positivo de ferramenta lenta)', () => {
    const pending: SemaphoreMachineState = { state: 'working', pendingToolSince: 1000, stateEnteredAt: 0 };
    expect(applyPermissionHeuristic(pending, 5000, 2500, ['baixando dependências...'], NO_MATCH)).toBe(pending);
  });

  it('promove pra permission quando os DOIS sinais concordam (timeout estourado + regex bate)', () => {
    const pending: SemaphoreMachineState = { state: 'working', pendingToolSince: 1000, stateEnteredAt: 0 };
    const after = applyPermissionHeuristic(pending, 5000, 2500, ['Do you want to proceed?'], MATCH);

    expect(after.state).toBe('permission');
    expect(after.stateEnteredAt).toBe(5000);
    expect(after.pendingToolSince).toBeNull();
  });
});

describe('defaultMatchesPermissionPrompt', () => {
  it('reconhece o texto real observado no addendum T009 (PTY real, prompt interativo em inglês)', () => {
    expect(defaultMatchesPermissionPrompt(['Bash requires confirmation for this command.', 'Do you want to proceed? 1. Yes 2. No'])).toBe(true);
  });

  it('reconhece o texto de auto-negação headless do spike original ("Preciso de sua permissão")', () => {
    expect(defaultMatchesPermissionPrompt(['Preciso de sua permissão para usar o Bash.'])).toBe(true);
  });

  it('não reconhece output arbitrário sem relação com permissão', () => {
    expect(defaultMatchesPermissionPrompt(['Compilando...', 'npm run build', '3 arquivos alterados'])).toBe(false);
  });
});

// #109 — o Jobu avisava a cada subagente em segundo plano que terminava: cada um acorda a sessão
// principal, que faz um turno curto e dá outro `Stop`. O próprio CLI diz no payload do `Stop`
// (`background_tasks`) se a sessão "terminou" ou "parou esperando o trabalho em segundo plano
// acordá-la". O semáforo da aba segue igual (`waiting`); a máquina só marca a espera como
// provisória, para quem avisa o dono (o Jobu) calar até o turno que fecha sem subagente vivo.
describe('fim de turno com subagentes em segundo plano (#109)', () => {
  const working: SemaphoreMachineState = { state: 'working', pendingToolSince: null, stateEnteredAt: 0 };

  it('Stop com subagente vivo vai pra waiting (aba igual) e marca a espera como provisória', () => {
    const after = reduceSemaphoreState(working, { type: 'stop', at: 10, backgroundAgents: 2 });
    expect(after.state).toBe('waiting');
    expect(after.stateEnteredAt).toBe(10);
    expect(after.awaitingBackgroundAgents).toBe(true);
  });

  it('Stop sem subagente vivo (ou sem a informação, CLI antigo) é fim de verdade', () => {
    expect(reduceSemaphoreState(working, { type: 'stop', at: 10, backgroundAgents: 0 }).awaitingBackgroundAgents).toBeFalsy();
    expect(reduceSemaphoreState(working, { type: 'stop', at: 10 }).awaitingBackgroundAgents).toBeFalsy();
  });

  it('o Stop seguinte sem subagente vivo encerra a espera provisória, mesmo sem passar por working', () => {
    const provisional = reduceSemaphoreState(working, { type: 'stop', at: 10, backgroundAgents: 1 });
    const after = reduceSemaphoreState(provisional, { type: 'stop', at: 20, backgroundAgents: 0 });
    expect(after.state).toBe('waiting');
    expect(after.stateEnteredAt).toBe(10); // o estado da aba não mudou
    expect(after.awaitingBackgroundAgents).toBeFalsy();
  });

  it('Stop repetido com subagente vivo devolve o mesmo estado (sem emissão nova à toa)', () => {
    const provisional = reduceSemaphoreState(working, { type: 'stop', at: 10, backgroundAgents: 2 });
    expect(reduceSemaphoreState(provisional, { type: 'stop', at: 20, backgroundAgents: 1 })).toBe(provisional);
  });

  it('qualquer saída de waiting (ferramenta, prompt, permissão) desfaz a marca', () => {
    const provisional = reduceSemaphoreState(working, { type: 'stop', at: 10, backgroundAgents: 1 });
    expect(reduceSemaphoreState(provisional, { type: 'preToolUse', at: 20 }).awaitingBackgroundAgents).toBeFalsy();
    expect(reduceSemaphoreState(provisional, { type: 'userPromptSubmit', at: 20 }).awaitingBackgroundAgents).toBeFalsy();
    expect(reduceSemaphoreState(provisional, { type: 'notification', at: 20 }).awaitingBackgroundAgents).toBeFalsy();
  });
});

describe('countBackgroundSubagents (payload do Stop)', () => {
  it('conta só os subagentes em voo de `background_tasks`', () => {
    const payload = {
      background_tasks: [
        { id: 'a1', type: 'subagent', status: 'running', description: 'revisar' },
        { id: 'a2', type: 'subagent', status: 'pending', description: 'testar' },
        { id: 'b1', type: 'shell', status: 'running', description: 'npm run dev' },
        { id: 'm1', type: 'monitor', status: 'running', description: 'watch' },
      ],
    };
    expect(countBackgroundSubagents(payload)).toBe(2);
  });

  it('um shell ou monitor em segundo plano (ex. servidor de dev) não segura o aviso', () => {
    expect(countBackgroundSubagents({ background_tasks: [{ id: 'b1', type: 'shell', status: 'running' }] })).toBe(0);
  });

  it('subagente já encerrado na lista não conta', () => {
    expect(countBackgroundSubagents({ background_tasks: [{ id: 'a1', type: 'subagent', status: 'completed' }] })).toBe(0);
  });

  it('sem o campo, com lixo ou lista vazia: zero', () => {
    expect(countBackgroundSubagents({})).toBe(0);
    expect(countBackgroundSubagents({ background_tasks: [] })).toBe(0);
    expect(countBackgroundSubagents({ background_tasks: 'x' })).toBe(0);
    expect(countBackgroundSubagents({ background_tasks: [null, 3, { type: 7 }] })).toBe(0);
  });
});
