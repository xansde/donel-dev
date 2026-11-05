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

import { hasPermissionPrompt } from '../shared/cliInputBox';

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
}

export const INITIAL_SEMAPHORE_STATE: SemaphoreMachineState = {
  state: 'working',
  pendingToolSince: null,
  stateEnteredAt: 0,
};

export type SemaphoreEvent =
  | { readonly type: 'userPromptSubmit'; readonly at: number }
  /**
   * `fromSubagent`: the call came from a sub-agent (the payload carries `agent_id`). A sub-agent keeps running tools
   * while the main thread holds a dialog, so its calls say nothing about that dialog (t-45e87762).
   */
  | { readonly type: 'preToolUse'; readonly at: number; readonly fromSubagent?: boolean }
  | { readonly type: 'postToolUse'; readonly at: number; readonly fromSubagent?: boolean }
  /** `backgroundAgents`: subagentes em segundo plano ainda vivos no fim do turno (`countBackgroundSubagents`); ausente = 0. */
  | { readonly type: 'stop'; readonly at: number; readonly backgroundAgents?: number }
  | { readonly type: 'notification'; readonly at: number }
  /** `reason` do hook `SessionEnd`: `clear`/`resume` trocam a conversa da aba, não a encerram (FR-033, T014). */
  | { readonly type: 'sessionEnd'; readonly at: number; readonly reason?: string | null }
  /** Evento do SO via `PtyManager.onExit` — nunca vem de um hook. Tem
   * PRIORIDADE sobre `sessionEnd` (spike: kill forçado não dispara
   * `SessionEnd`, então este é o único sinal confiável pra "encerrada" em
   * qualquer cenário). */
  | { readonly type: 'processExit'; readonly at: number };

function transition(state: SemaphoreState, at: number, current: SemaphoreMachineState): SemaphoreMachineState {
  if (state === current.state) return current;
  return { state, pendingToolSince: null, stateEnteredAt: at };
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

    case 'userPromptSubmit':
      return transition('working', event.at, current);

    case 'preToolUse': {
      // t-45e87762 — a sub-agent's call does not answer the main thread's dialog: still waiting for the owner.
      if (current.state === 'permission' && event.fromSubagent === true) return current;
      const base = transition('working', event.at, current);
      // Refresca a marca de "chamada de ferramenta pendente" a cada
      // PreToolUse (spike: `markPending` roda em toda chamada), mesmo quando
      // o estado em si já era 'working' e `transition` não mudou nada.
      return { ...base, state: 'working', pendingToolSince: event.at };
    }

    case 'postToolUse':
      // `clearPending` do spike — a ferramenta respondeu, não há mais nada
      // pendente pra heurística observar (fica em 'working' até o próximo
      // `Stop`).
      // t-45e87762 — a ferramenta rodou, então a permissão já foi respondida: a sessão voltou a trabalhar. Sem
      // isto a aba seguia "esperando você" durante a ferramenta aprovada inteira e o que viesse depois dela, até o
      // próximo `PreToolUse` ou `Stop` (43 vezes no chat-diagnostics.log, até 49 s).
      if (current.state === 'permission' && event.fromSubagent !== true) return transition('working', event.at, current);
      return current.pendingToolSince === null ? current : { ...current, pendingToolSince: null };

    case 'stop': {
      // Turno concluído — sempre volta pra 'waiting', mesmo vindo de
      // 'permission' (ex.: o usuário respondeu a aprovação e o turno fechou).
      const next = transition('waiting', event.at, current);
      // #109 — com subagente em segundo plano vivo a espera é provisória (ver o campo). O estado da
      // aba não muda; só a marca, que o próximo `Stop` sem subagente vivo apaga.
      const awaiting = (event.backgroundAgents ?? 0) > 0;
      if ((next.awaitingBackgroundAgents ?? false) === awaiting) return next;
      return { ...next, awaitingBackgroundAgents: awaiting };
    }

    case 'notification':
      // Sinal primário e confiável (addendum T009) de permissão pendente.
      return transition('permission', event.at, current);

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
  return { state: 'permission', pendingToolSince: null, stateEnteredAt: now };
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
export function defaultMatchesPermissionPrompt(recentLines: readonly string[]): boolean {
  return hasPermissionPrompt(recentLines);
}
