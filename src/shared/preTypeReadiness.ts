import type { SemaphoreState } from './index';
import { isTrustDialogVisible } from './trustDialog';

// T312/T319 (003-modo-dev, Batch B) — QUANDO é seguro pré-digitar (CA-3/CA-16).
// Decisão pura, sem I/O: quem lê o buffer do xterm e o semáforo é o App.tsx.
//
// ACHADO DA IMPLEMENTAÇÃO (medido no código, 27/07) — o `plan.md` previa um
// único sinal: "espera o semáforo entrar em 'waiting' pela primeira vez depois
// do `create`". Ele NÃO existe para uma sessão recém-criada: o semáforo só
// muda de estado por evento de hook, e `hooks-settings.ts`
// (`SEMAPHORE_HOOK_EVENTS`) não registra `SessionStart` — o único evento que
// leva a `'waiting'` é o `Stop`, que fecha um TURNO. Uma sessão nova nasce em
// `'working'` (`SessionSemaphoreManager.registerSession` emite o estado
// inicial) e só chega a `'waiting'` depois do PRIMEIRO turno. Esperar por ele
// deixaria o gesto central do CA-3 sem nunca disparar. O mesmo já está
// documentado em `App.tsx` ("hooks-settings.ts não cobre SessionStart").
//
// Correção adotada, sem delay fixo (que o plano descartou com razão): DOIS
// sinais, ambos orientados a evento e já usados neste repo —
//  1. semáforo em `'waiting'` (o sinal do plano; é o que vale para o SEGUNDO
//     passo do CA-16, onde de fato existe um turno terminando);
//  2. o REPL do CLI já desenhado no buffer JÁ RENDERIZADO do xterm — mesma
//     fonte (e mesmo motivo) de `hasLiveInjectionConfirmation`/
//     `isTrustDialogVisible`. O marcador é o banner do CLI, o mesmo que o
//     smoke permanente `tests/smoke-dev/dev-mode.spec.ts` usa como pré-
//     condição antes de digitar e obter eco: ele espera uma linha com
//     "claude code" e só então digita.
//
// E um sinal NEGATIVO em qualquer caso: com o diálogo de confiança de pasta
// na tela, o CLI ainda não armou o leitor de stdin — pré-digitar ali cairia
// DENTRO da pergunta. Nunca escrever nesse estado.

/** Banner do REPL do CLI — ver comentário de topo (mesma pré-condição do smoke permanente do Modo Dev). */
export const CLI_READY_MARKER = 'claude code';

export interface PreTypeReadinessInput {
  /** Primeiro passo da sequência (CA-16 pode ter dois). */
  readonly isFirstStep: boolean;
  readonly semaphore: { readonly state: SemaphoreState; readonly stateEnteredAt: number } | undefined;
  /** Epoch ms em que o passo ANTERIOR foi escrito no PTY (0 no primeiro passo). */
  readonly armedAt: number;
  /** Cauda do buffer já renderizado do xterm (`TerminalPaneHandle.getRenderedLines`). */
  readonly renderedLines: readonly string[];
}

/** `true` quando o REPL já desenhou o banner do CLI — sinal de "subiu e aceita input". */
export function hasClaudeReadyMarker(lines: readonly string[]): boolean {
  return lines.some((line) => line.toLowerCase().includes(CLI_READY_MARKER));
}

/**
 * CA-3/CA-16 — decide se o próximo comando da sequência pode ser ESCRITO
 * (nunca enviado) agora.
 *
 * - Diálogo de confiança visível: **nunca** (o stdin ainda não é o prompt).
 * - Primeiro passo: semáforo em `'waiting'` **ou** banner do CLI presente.
 * - Passos seguintes (CA-16): só um `'waiting'` NOVO — entrado depois do
 *   passo anterior ter sido escrito — libera o próximo. É isso que garante
 *   "dois Enters humanos distintos, nunca um só para os dois comandos".
 */
export function isReadyToPreType(input: PreTypeReadinessInput): boolean {
  if (isTrustDialogVisible(input.renderedLines)) return false;

  const waiting = input.semaphore?.state === 'waiting';

  if (!input.isFirstStep) {
    return waiting && (input.semaphore?.stateEnteredAt ?? 0) > input.armedAt;
  }

  return waiting || hasClaudeReadyMarker(input.renderedLines);
}
