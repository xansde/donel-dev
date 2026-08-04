// Spec 010 / batch B6 — o gesto "Preparar", inteiro, num lugar só.
//
// Ele existia dentro do `EsteiraScreen` (B1/B2). O mapa passou a oferecer o
// mesmo gesto ("⌁ Preparar", na trilha), e duas orquestrações da mesma sequência
// divergem no primeiro conserto — só que aqui divergir significa uma tela
// abrindo sessão no repo que a outra recusa, que é literalmente a evidência 2
// da spec.
//
// A sequência é sempre esta, e nesta ordem:
//   1. resolver o cwd do ASSUNTO (D-6: alvo explícito, zero palpite);
//   2. disparar (grava o `run-input.json`, trava o card, registra a sessão);
//   3. abrir a aba com o comando ESCRITO — nunca enviado (invariante 2);
//   4. dizer o que aconteceu, com a frase da camada pura.
//
// Só o passo 3 é encanamento; ele chega por `deps.openSession`, para este
// módulo continuar testável sem Electron.

import type { DispatchIpcInput, EsteiraDispatchDto, EsteiraSnapshotDto } from '../../../shared/esteira/ipc';
import {
  dispatchRefusedMessage,
  esteiraPhaseCommand,
  esteiraTabName,
  lockStateOf,
  preparedMessage,
  resolveSessionCwd,
  type EsteiraSessionRequest,
  type KnownProject,
  type SessionOpenOutcome,
} from './esteiraSession';
import { formatTimestamp, type CardView, type DispatchTargetView } from './esteiraView';

export interface PreparePhaseDeps {
  readonly dispatch: (input: DispatchIpcInput) => Promise<EsteiraDispatchDto>;
  /** Abre a aba de terminal da fase. Quem faz PTY e pré-digitação é o App. */
  readonly openSession: (request: EsteiraSessionRequest) => void;
}

export interface PreparePhaseInput {
  readonly card: CardView;
  readonly phase: string;
  /** O assunto do disparo, já resolvido por `dispatchView` (B2). */
  readonly target: DispatchTargetView;
  readonly projects: readonly KnownProject[];
}

export interface PreparePhaseResult {
  readonly ok: boolean;
  /** O que dizer na tela. Nunca vazio: disparo mudo é o que a spec 010 extingue. */
  readonly message: string;
  readonly state: EsteiraSnapshotDto;
}

export async function preparePhase(input: PreparePhaseInput, deps: PreparePhaseDeps): Promise<PreparePhaseResult> {
  const { card, phase, target, projects } = input;

  // O cwd é resolvido ANTES do disparo: ele viaja dentro do `run-input.json` (a
  // skill precisa saber onde trabalhar) e é onde a aba abre. E é o do ASSUNTO
  // (B2), não o do card: a fase de um item roda no repo do item, ou no herdado.
  const resolved = resolveSessionCwd(target.targetRepo, projects);

  const dispatched = await deps.dispatch({
    phase,
    discoveryId: target.discoveryId,
    planId: target.planId,
    workItemId: target.workItemId,
    workspace:
      target.targetRepo === null
        ? null
        : {
            target_repo: target.targetRepo,
            repo_path: resolved.ok ? resolved.cwd : null,
            worktree_path: null,
            branch: null,
          },
    continuesSessionId: null,
    handoffReason: null,
  });

  if (dispatched.ok) {
    let outcome: SessionOpenOutcome;
    if (resolved.ok) {
      const tabName = esteiraTabName(phase, card.discovery.title);
      deps.openSession({
        sessionId: dispatched.sessionId,
        phase,
        cwd: resolved.cwd,
        tabName,
        command: esteiraPhaseCommand(phase, dispatched.inputPath),
      });
      outcome = { opened: true, tabName };
    } else {
      // Preparou e não abriu: a fase continua preparada e a tela diz o motivo,
      // em vez de fingir que abriu. Travar o card e ficar calada seria pior.
      outcome = { opened: false, reason: resolved.reason };
    }

    return {
      ok: true,
      state: dispatched.state,
      message: preparedMessage({ phase, targetRepo: target.targetRepo, inputPath: dispatched.inputPath, outcome }),
    };
  }

  if (dispatched.reason === 'locked') {
    return {
      ok: false,
      state: dispatched.state,
      // A frase sai da camada pura, com a MESMA palavra do bloco da trava:
      // escrita à parte, ela dizia "preparada" para um card cujo bloco dizia
      // "Em andamento" — o erro nº 1 de `erros-conhecidos.md`.
      message: dispatchRefusedMessage(
        lockStateOf(dispatched.lock.holderKind, dispatched.lock.cliSessionId !== null),
        dispatched.lock.phase,
        formatTimestamp(dispatched.lock.acquiredAt),
      ),
    };
  }

  if (dispatched.reason === 'invalid-target') {
    return {
      ok: false,
      state: dispatched.state,
      message: `Não dá para disparar: ${dispatched.issues.map((issue) => issue.code).join(', ')}.`,
    };
  }

  return { ok: false, state: dispatched.state, message: 'Não deu para disparar: o histórico não aceita escrita agora.' };
}
