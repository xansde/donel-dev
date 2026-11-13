// T009 — Semáforo de sessões (FR-010): máquina de estados PURA (sem I/O),
// mapeando os eventos validados no spike (specs/001-mvp/spike-t002-resultado.md
// "Decisão de arquitetura para T009") para os 4 estados vindos dos hooks:
// trabalhando / aguardando resposta / permissão pendente / encerrada.
//
// "Falha/quota esgotada" (5º estado do FR-010/ui-spec) NÃO nasce aqui — é
// derivado fora deste módulo, a partir do exit code do processo PTY
// (PtyManager.onExit), pela camada de integração (session-semaphore-manager.ts).
// Este módulo só conhece o que os hooks contam.
//
// Addendum T009 (specs/001-mvp/spike-t002-resultado.md, seção "Addendum T009
// — Notification em TTY real") confirmou que `Notification` DISPARA de
// verdade dentro de um PTY real (node-pty/ConPTY) com `notification_type:
// "permission_prompt"` — por isso `onNotification` é o sinal PRIMÁRIO de
// `permission` aqui. `applyPermissionHeuristic` continua existindo como
// fallback defensivo (o próprio spike recomenda registrar `Notification`
// "por segurança — custo zero se nunca disparar", e a heurística cobre o
// caso hipotético de uma versão do CLI ou um hook drop em que ela não
// dispare).

import { openPermissionAt } from '../shared/cliInputBox';

export type SemaphoreState = 'working' | 'waiting' | 'permission' | 'done';

export interface SemaphoreMachineState {
  readonly state: SemaphoreState;
  /**
   * Epoch ms do `PreToolUse` mais recente ainda sem `PostToolUse`/`Stop`
   * correspondente — input da heurística de fallback (spike:
   * `markPending`/`clearPending`). `null` = nada pendente.
   */
  readonly pendingToolSince: number | null;
  /**
   * Epoch ms de quando o `state` atual começou a valer — usado pro contador
   * "há Xmin" (ui-spec §3) e pro desempate de FR-010/CA-6 ("entre 2+ sessões
   * com permissão pendente simultaneamente, a mais antiga aparece primeiro").
   * Só é atualizado quando `state` MUDA de valor, não a cada evento.
   */
  readonly stateEnteredAt: number;
  /**
   * #109 — `true` só quando o `waiting` atual veio de um `Stop` cujo payload ainda listava subagente
   * em segundo plano vivo (`background_tasks`): o CLI parou o turno, mas vai acordar a sessão quando
   * o subagente terminar. A aba segue `waiting` (o dono pode digitar); quem AVISA o dono (o Jobu)
   * lê isto para não anunciar "terminou" a cada subagente. Ausente/`false` = espera de verdade.
   */
  readonly awaitingBackgroundAgents?: boolean;
  /**
   * t-45e87762 — tool calls still running, by origin (`''` = the main thread, otherwise the sub-agent's `agent_id`).
   * Calls of the Agent tool are not counted: they wait for a sub-agent, they never ask the owner themselves.
   */
  readonly openCalls?: Readonly<Record<string, number>>;
  /**
   * t-45e87762 — while `permission`: who may be asking (the origins with calls running when the dialog came up) and
   * how many of their calls were running then. The dialog belongs to one of them; it is answered when an asker
   * moves on (a new call) or when every call open at that moment has finished. A call from anyone else (a sibling
   * sub-agent, a background job) says nothing about the dialog. Empty = unknown asker: any move of the session ends it.
   */
  readonly askers?: Readonly<Record<string, number>>;
}

export const INITIAL_SEMAPHORE_STATE: SemaphoreMachineState = {
  state: 'working',
  pendingToolSince: null,
  stateEnteredAt: 0,
};

/** The Agent tool (`Task` in older CLIs) waits for a sub-agent: it is never the call that asks. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);

function originOf(agentId: string | undefined): string {
  return agentId ?? '';
}

function countsCall(toolName: string | undefined): boolean {
  return toolName === undefined || !SUBAGENT_TOOLS.has(toolName);
}

function withOpenCalls(current: SemaphoreMachineState, origin: string, delta: number): Readonly<Record<string, number>> {
  const open = { ...(current.openCalls ?? {}) };
  const next = Math.max(0, (open[origin] ?? 0) + delta);
  if (next === 0) delete open[origin];
  else open[origin] = next;
  return open;
}

/** Leaves `permission` for `working`, keeping the running calls (the askers go with the dialog). */
function answered(at: number, openCalls: Readonly<Record<string, number>>): SemaphoreMachineState {
  return { state: 'working', pendingToolSince: null, stateEnteredAt: at, openCalls };
}

/** `permission` with the askers taken from the calls running now. */
function asking(current: SemaphoreMachineState, at: number): SemaphoreMachineState {
  return { state: 'permission', pendingToolSince: null, stateEnteredAt: at, openCalls: current.openCalls ?? {}, askers: { ...(current.openCalls ?? {}) } };
}

export type SemaphoreEvent =
  | { readonly type: 'userPromptSubmit'; readonly at: number }
  /**
   * `agentId`: the call came from that sub-agent (the payload's `agent_id`); absent = the main thread. `toolName`:
   * the payload's `tool_name`. Together they say whose dialog a call can answer (t-45e87762).
   */
  | { readonly type: 'preToolUse'; readonly at: number; readonly agentId?: string; readonly toolName?: string }
  | { readonly type: 'postToolUse'; readonly at: number; readonly agentId?: string; readonly toolName?: string }
  /** `backgroundAgents`: subagentes em segundo plano ainda vivos no fim do turno (`countBackgroundSubagents`); ausente = 0. */
  | { readonly type: 'stop'; readonly at: number; readonly backgroundAgents?: number }
  | { readonly type: 'notification'; readonly at: number }
  /**
   * t-1293c818 (item 5) — the session is at its prompt with no turn running: a `SessionStart` that is not a new
   * session nor a compaction (`resume`, `clear`, `fork`), or the remote place itself reading the pane idle with the
   * turn closed. Unlike `stop` it ends no turn (nothing to announce): it only says where the session already is.
   */
  | { readonly type: 'atPrompt'; readonly at: number }
  /** `reason` do hook `SessionEnd`: `clear`/`resume` trocam a conversa da aba, não a encerram (FR-033, T014). */
  | { readonly type: 'sessionEnd'; readonly at: number; readonly reason?: string | null }
  /** Evento do SO via `PtyManager.onExit` — nunca vem de um hook. Tem
   * PRIORIDADE sobre `sessionEnd` (spike: kill forçado não dispara
   * `SessionEnd`, então este é o único sinal confiável pra "encerrada" em
   * qualquer cenário). */
  | { readonly type: 'processExit'; readonly at: number };

function transition(state: SemaphoreState, at: number, current: SemaphoreMachineState): SemaphoreMachineState {
  if (state === current.state) return current;
  return { state, pendingToolSince: null, stateEnteredAt: at, ...(current.openCalls !== undefined ? { openCalls: current.openCalls } : {}) };
}

/** Reducer puro: `(estado atual, evento) => novo estado`. Terminal em `done` — nenhum evento tira uma sessão encerrada desse estado (uma sessão "reaberta" nasce como uma máquina nova). */
export function reduceSemaphoreState(current: SemaphoreMachineState, event: SemaphoreEvent): SemaphoreMachineState {
  if (current.state === 'done') return current;

  switch (event.type) {
    case 'sessionEnd':
      // FR-033 — `/clear` e `/resume` emitem SessionEnd do id velho e, logo depois,
      // SessionStart do novo: a aba segue viva, então isto não é fim.
      if (event.reason === 'clear' || event.reason === 'resume') return current;
      return transition('done', event.at, current);

    case 'processExit':
      return transition('done', event.at, current);

    case 'userPromptSubmit': {
      // A new prompt: the main thread starts from nothing (sub-agents in the background keep their calls).
      const openCalls = withOpenCalls(current, '', -Infinity);
      if (current.state === 'working') return { ...current, openCalls };
      return { state: 'working', pendingToolSince: null, stateEnteredAt: event.at, openCalls };
    }

    case 'preToolUse': {
      const origin = originOf(event.agentId);
      const counted = countsCall(event.toolName);
      const openCalls = counted ? withOpenCalls(current, origin, 1) : (current.openCalls ?? {});
      if (current.state === 'permission') {
        // t-45e87762 — a new call from someone who may be asking means the dialog was answered (an agent issues no
        // new call while one of its own waits). From anyone else (a sibling sub-agent) it says nothing.
        const askers = current.askers ?? {};
        if (Object.keys(askers).length > 0 && !(origin in askers)) return { ...current, openCalls };
        return { ...answered(event.at, openCalls), pendingToolSince: event.at };
      }
      const base = transition('working', event.at, current);
      // Refresca a marca de "chamada de ferramenta pendente" a cada
      // PreToolUse (spike: `markPending` roda em toda chamada), mesmo quando
      // o estado em si já era 'working' e `transition` não mudou nada.
      return { ...base, state: 'working', pendingToolSince: event.at, openCalls };
    }

    case 'postToolUse': {
      // `clearPending` do spike — a ferramenta respondeu, não há mais nada
      // pendente pra heurística observar (fica em 'working' até o próximo
      // `Stop`).
      const origin = originOf(event.agentId);
      const counted = countsCall(event.toolName);
      const openCalls = counted ? withOpenCalls(current, origin, -1) : (current.openCalls ?? {});
      if (current.state === 'permission') {
        // t-45e87762 — the asked tool ran, so the dialog was answered. Which call is the asked one is not known: the
        // dialog ends when one asker has finished every call it had open at that moment (a sibling of a parallel batch
        // finishing first leaves the ask on screen). Without askers, the first finished call of the main thread ends it.
        const askers = current.askers ?? {};
        if (Object.keys(askers).length === 0) return origin === '' ? answered(event.at, openCalls) : { ...current, openCalls };
        if (!counted || !(origin in askers)) return { ...current, openCalls };
        const left = { ...askers };
        left[origin] = (left[origin] ?? 0) - 1;
        if (left[origin]! <= 0) return answered(event.at, openCalls);
        return { ...current, openCalls, askers: left };
      }
      const cleared = current.pendingToolSince === null ? current : { ...current, pendingToolSince: null };
      return counted ? { ...cleared, openCalls } : cleared;
    }

    case 'stop': {
      // Turno concluído — sempre volta pra 'waiting', mesmo vindo de
      // 'permission' (ex.: o usuário respondeu a aprovação e o turno fechou).
      // The main thread ended its turn: none of its calls is running (sub-agents in the background keep theirs).
      const ended: SemaphoreMachineState = { ...current, openCalls: withOpenCalls(current, '', -Infinity) };
      const next = current.state === 'waiting' ? ended : { ...transition('waiting', event.at, current), openCalls: ended.openCalls };
      // #109 — com subagente em segundo plano vivo a espera é provisória (ver o campo). O estado da
      // aba não muda; só a marca, que o próximo `Stop` sem subagente vivo apaga.
      const awaiting = (event.backgroundAgents ?? 0) > 0;
      if ((next.awaitingBackgroundAgents ?? false) === awaiting) return next;
      return { ...next, awaitingBackgroundAgents: awaiting };
    }

    case 'atPrompt': {
      // The main thread runs nothing at the prompt (sub-agents in the background keep their calls).
      const openCalls = withOpenCalls(current, '', -Infinity);
      if (current.state === 'waiting') return { ...current, openCalls };
      return { state: 'waiting', pendingToolSince: null, stateEnteredAt: event.at, openCalls };
    }

    case 'notification':
      // Sinal primário e confiável (addendum T009) de permissão pendente.
      if (current.state === 'permission') return current;
      return asking(current, event.at);

    default:
      return current;
  }
}

/** Status de tarefa que já não está em voo — defesa: o CLI só lista as em voo (running/pending). */
const FINISHED_TASK_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled']);

/**
 * #109 — quantos subagentes em segundo plano seguem vivos no fim do turno, lido de
 * `background_tasks` do payload do `Stop` (CLI 2.1.3xx: "lets hooks distinguish 'session is done'
 * from 'session is paused waiting for background work to wake it'"). Conta só `type: 'subagent'`:
 * um shell ou monitor em segundo plano (um servidor de dev, um watch) pode viver para sempre e não
 * pode calar o aviso. Sem o campo (CLI antigo) = 0, o comportamento de antes.
 */
export function countBackgroundSubagents(payload: Record<string, unknown>): number {
  const tasks = payload.background_tasks;
  if (!Array.isArray(tasks)) return 0;
  let count = 0;
  for (const task of tasks) {
    if (typeof task !== 'object' || task === null) continue;
    const { type, status } = task as Record<string, unknown>;
    if (type !== 'subagent') continue;
    if (typeof status === 'string' && FINISHED_TASK_STATUSES.has(status)) continue;
    count += 1;
  }
  return count;
}

/**
 * Fallback heurístico (spike §"Fallback heurístico para permissão pendente"):
 * só promove pra `permission` quando os DOIS sinais concordam — `PreToolUse`
 * pendente há mais que `timeoutMs` E o ring buffer da sessão bate com um
 * padrão conhecido de prompt de permissão. Não-op fora do estado `working`
 * ou sem chamada pendente (evita reagir a uma ferramenta genuinamente lenta,
 * ex. download/build, quando o outro sinal não a confirma como bloqueio de
 * permissão).
 */
export function applyPermissionHeuristic(
  current: SemaphoreMachineState,
  now: number,
  timeoutMs: number,
  recentLines: readonly string[],
  matchesPermissionPrompt: (recentLines: readonly string[]) => boolean = defaultMatchesPermissionPrompt
): SemaphoreMachineState {
  if (current.state !== 'working' || current.pendingToolSince === null) return current;
  if (now - current.pendingToolSince <= timeoutMs) return current;
  if (!matchesPermissionPrompt(recentLines)) return current;
  return asking(current, now);
}

/**
 * Padrões observados no addendum T009 (real PTY, texto em inglês do prompt
 * interativo: "Bash requires confirmation for this command. ... Do you want
 * to proceed? ❯ 1. Yes 2. No") + variações pt-BR caso o CLI localize, mais o
 * texto de auto-negação do modo headless documentado no spike original
 * ("Preciso de sua permissão..."). Últimas ~10 linhas ANSI-stripadas é a
 * janela recomendada pelo spike — quem monta `recentLines` é o chamador
 * (via `PtyManager.getPreview`).
 */
// Os padrões em si vivem em `shared/cliInputBox.ts` desde 13/08
// (wi-esteira4-enter-confirmado): o auto-start da esteira precisa do MESMO
// veto para nunca escrever `\r` sobre um prompt de permissão, e um fato só
// mora num lugar só. Comportamento aqui inalterado — só a origem da lista.
// Revisor, #406: só o diálogo que é o ÚLTIMO bloco do texto recente. O padrão frouxo achava um diálogo já respondido
// acima da saída da ferramenta e marcava "permissão" a cada ferramenta longa ("precisa do dono" repetido ao Líder).
// Um falso negativo aqui custa pouco: o `Notification` do CLI é o sinal primário.
export function defaultMatchesPermissionPrompt(recentLines: readonly string[]): boolean {
  return openPermissionAt(recentLines) !== null;
}
