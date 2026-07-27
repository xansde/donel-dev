import { buildClaudeArgs } from '../../../shared/commandBuilder';
import type { ArchivedPhaseSession, EsteiraPhase, PhaseDefault } from '../../../shared/devMode';
import { resolveCommandText } from '../../../shared/devModeDefaults';
import type { PhaseStatus } from '../../../shared/phaseState';

// T312/T313/T318/T319 (003-modo-dev, Batch B) — NÚCLEO PURO do gesto central
// (CA-3/CA-4/CA-9/CA-16). Este arquivo não conhece Electron, PTY nem React:
// ele só decide (a) que tipo de sessão a fase abre e (b) QUAL sequência de
// texto será pré-digitada. Quem escreve no PTY é o App.tsx, pelo canal já
// existente `window.donel.pty.input` (achado 8) — sempre SEM `\r`.
//
// **Invariante 2 (CA-3):** nenhuma string produzida aqui contém `\r`/`\n`.
// O Enter é sempre gesto humano; é por isso que a sequência do CA-16 é uma
// LISTA de passos liberados um a um (`createPrimeSequencer`), nunca uma
// string única com dois comandos.

/** Skill real da Esteira usada para destravar uma fase (CA-16) — o `{card_id}` é o mesmo placeholder da tabela do CA-4. */
export const LIBERAR_COMMAND_TEMPLATE = '/esteira-liberar {card_id}';

export type PhaseOpenDecision =
  /** Fase normal (`opensOwnSession: true`): PTY novo com o argv da tabela CA-4. */
  | { readonly kind: 'create'; readonly cwd: string; readonly args: readonly string[] }
  /** Fase `concluir` (C6): pré-digita na aba EM FOCO, nunca cria PTY. */
  | { readonly kind: 'use-focused' }
  /** CA-9: fase concluída com `session-id` arquivado — retomada para consulta. */
  | { readonly kind: 'resume'; readonly sessionId: string; readonly cwd: string; readonly args: readonly string[] }
  /** C4: discovery antigo sem `session-id` arquivado — o clique abre o artefato, não uma sessão. */
  | { readonly kind: 'open-artifact'; readonly path: string };

export interface DecidePhaseOpenInput {
  readonly phase: EsteiraPhase;
  readonly defaults: PhaseDefault;
  readonly status: PhaseStatus;
  readonly archivedSession: ArchivedPhaseSession | null;
  readonly repoPath: string;
  /** D3 — worktree declarada no frontmatter do `ctx.md` daquela fase; `null` cai no `repoPath`. */
  readonly worktreePath: string | null;
  /** Artefato a abrir na degradação do C4 (`result.json`, ou `ctx.md` quando não há manifesto). */
  readonly artifactPath: string | null;
}

/**
 * CA-3/CA-4/CA-9/C4/C6 — a decisão inteira do que o clique numa fase abre.
 * Ordem de precedência: a exceção do `concluir` vence tudo (é propriedade da
 * FASE, não do estado); depois o estado `done` decide entre retomar e abrir
 * artefato; qualquer outro estado abre sessão nova.
 */
export function decidePhaseOpen(input: DecidePhaseOpenInput): PhaseOpenDecision {
  if (!input.defaults.opensOwnSession) return { kind: 'use-focused' };

  const cwd = input.worktreePath ?? input.repoPath;

  if (input.status === 'done') {
    if (input.archivedSession) {
      const sessionId = input.archivedSession.sessionId;
      // Retomada é CONSULTA (CA-9): só `-r <id>`. Não reimpõe modelo/esforço —
      // trocar o modelo de uma sessão arquivada não é o que "voltar à etapa" quer dizer.
      return { kind: 'resume', sessionId, cwd, args: buildClaudeArgs({ continuation: { type: 'resume', sessionId } }) };
    }
    if (input.artifactPath) return { kind: 'open-artifact', path: input.artifactPath };
  }

  return { kind: 'create', cwd, args: buildClaudeArgs({ model: input.defaults.model, effort: input.defaults.effort }) };
}

export interface ResolveCommandSequenceInput {
  readonly status: PhaseStatus;
  readonly defaults: PhaseDefault;
  readonly cardId: string;
}

/**
 * CA-16 — a sequência de comandos a pré-digitar, um por Enter humano:
 * - **travada** → `['/esteira-liberar <card>', '<comando da fase>']` (dois
 *   Enters distintos; o segundo só é liberado depois do primeiro terminar).
 * - **falhou** / não iniciada / em execução → `['<comando da fase>']`.
 * - **concluída** → `[]` (retomar é consulta, não re-disparo).
 */
export function resolveCommandSequence(input: ResolveCommandSequenceInput): readonly string[] {
  if (input.status === 'done') return [];

  const phaseCommand = resolveCommandText(input.defaults, input.cardId);
  if (input.status === 'stuck') {
    return [LIBERAR_COMMAND_TEMPLATE.replace('{card_id}', input.cardId), phaseCommand];
  }
  return [phaseCommand];
}

export interface PrimeSequencer {
  /** `true` quando não há mais nada a pré-digitar. */
  readonly done: boolean;
  /** Libera o PRÓXIMO comando (ou `null` se acabou). Quem chama só o faz depois do sinal de "pronto para receber input". */
  next(): string | null;
}

/**
 * Máquina mínima que garante o "cada comando com seu próprio Enter" do
 * CA-16: os passos saem um a um, nunca concatenados, e o chamador é quem
 * decide quando o próximo pode sair (sinal de prontidão da sessão).
 */
export function createPrimeSequencer(commands: readonly string[]): PrimeSequencer {
  let index = 0;
  return {
    get done(): boolean {
      return index >= commands.length;
    },
    next(): string | null {
      if (index >= commands.length) return null;
      const command = commands[index];
      index += 1;
      return command;
    },
  };
}
