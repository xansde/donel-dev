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
  noRepoPreparedMessage,
  phaseDoneRefusedMessage,
  preparedMessage,
  repoRefusalMessage,
  resolveSessionCwd,
  resourceBusyRefusedMessage,
  sessionActiveRefusedMessage,
  type EsteiraSessionRequest,
  type KnownProject,
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
  /** O estado depois do gesto — `null` quando o gesto foi recusado sem tocar no histórico. */
  readonly state: EsteiraSnapshotDto | null;
}

export async function preparePhase(input: PreparePhaseInput, deps: PreparePhaseDeps): Promise<PreparePhaseResult> {
  const { card, phase, target, projects } = input;

  // O cwd é resolvido ANTES do disparo: ele viaja dentro do `run-input.json` (a
  // skill precisa saber onde trabalhar) e é onde a aba abre. E é o do ASSUNTO
  // (B2), não o do card: a fase de um item roda no repo do item, ou no herdado.
  const resolved = resolveSessionCwd(target.targetRepo, projects);

  // Emenda de 06/08 — o repo IMPOSSÍVEL encerra o gesto aqui, antes de qualquer
  // escrita.
  //
  // Até então a ordem era a inversa: despachar (gravando o `run-input.json` e
  // travando o card) e só depois olhar o resultado da resolução. O comentário
  // que defendia isso dizia "travar o card e ficar calada seria pior" — e está
  // certo sobre o silêncio, mas a escolha não era entre travar e calar. Um card
  // travado por um trabalho que nunca começou é sujeira que exige um gesto de
  // "Liberar trava" para desfazer, e foi exatamente o que o dogfooding produziu:
  // o card "Diário de Obra" preso desde 06/08 11:42, com contexto em disco que
  // ninguém podia usar, porque o repo declarado (`"spotsys e api-spotsys"`) não
  // existia como pasta nenhuma.
  //
  // **Só `unknown-repo` recusa** — e a distinção é de propósito. Card SEM repo é
  // uma declaração legítima da spec ("discovery investiga um problema, não um
  // repositório", `workspace` pode ser `null`): ele segue disparando, o contexto
  // vai para o inbox e o operador roda a skill onde fizer sentido. Card com repo
  // que não existe é ERRO de declaração, e erro não merece resíduo.
  if (!resolved.ok && resolved.reason === 'unknown-repo') {
    // `state: null` é literal: nada foi escrito, então não há estado novo para a
    // tela aplicar. É diferente de devolver o snapshot antigo — este `null` é o
    // que garante, no tipo, que a recusa não passou perto do histórico.
    return { ok: false, state: null, message: repoRefusalMessage(phase, target.targetRepo, 'unknown-repo') };
  }

  const dispatched = await deps.dispatch({
    phase,
    discoveryId: target.discoveryId,
    planId: target.planId,
    workItemId: target.workItemId,
    workspace:
      target.targetRepo === null
        ? null
        : { target_repo: target.targetRepo, repo_path: resolved.ok ? resolved.cwd : null, worktree_path: null, branch: null },
    continuesSessionId: null,
    handoffReason: null,
  });

  if (dispatched.ok) {
    // Sem cwd não há aba: só resta o contexto em disco, e a frase diz isso.
    if (!resolved.ok) {
      return { ok: true, state: dispatched.state, message: noRepoPreparedMessage(phase, dispatched.inputPath) };
    }

    const tabName = esteiraTabName(phase, card.discovery.title);
    deps.openSession({
      sessionId: dispatched.sessionId,
      phase,
      cwd: resolved.cwd,
      tabName,
      command: esteiraPhaseCommand(phase, dispatched.inputPath),
    });

    return { ok: true, state: dispatched.state, message: preparedMessage({ phase, tabName }) };
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

  if (dispatched.reason === 'resource-busy') {
    // A8/A20 — o repo (às vezes a branch) que esta fase tocaria já está
    // ocupado por OUTRO assunto (irmão): a trava por assunto (`locked`,
    // acima) nunca veria isto — é o buraco que a trava de recurso fecha.
    const resource = dispatched.lock.resource;
    return {
      ok: false,
      state: dispatched.state,
      message: resourceBusyRefusedMessage(
        resource?.targetRepo ?? target.targetRepo ?? 'este repositório',
        resource?.branch ?? null,
        dispatched.lock.phase,
        formatTimestamp(dispatched.lock.acquiredAt),
      ),
    };
  }

  if (dispatched.reason === 'session-active') {
    // B3 — a trava (`locked`, acima) já teria pego o caso comum; isto é a
    // rede de segurança para quando ela caiu por outro caminho e a sessão
    // anterior nunca terminou.
    return {
      ok: false,
      state: dispatched.state,
      message: sessionActiveRefusedMessage(dispatched.session.phase, formatTimestamp(dispatched.session.startedAt)),
    };
  }

  if (dispatched.reason === 'phase-done') {
    // A1 — a fase já concluiu sobre este MESMO assunto; redisparar exige
    // `confirmReopen: true` explícito (o gesto de reabrir é do B1, fora deste
    // batch — aqui só a recusa e a razão, para quem chamar decidir o que
    // oferecer em cima dela).
    return {
      ok: false,
      state: dispatched.state,
      message: phaseDoneRefusedMessage(
        dispatched.phase.phase,
        dispatched.phase.outcome,
        formatTimestamp(dispatched.phase.completedAt ?? dispatched.phase.startedAt),
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
