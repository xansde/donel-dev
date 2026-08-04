// Spec 010 — a lógica PURA da tela da esteira nova: o que aparece em cada card
// e com que palavra. Fica fora do componente para ser testada sem React — e,
// principalmente, porque é aqui que mora a regra que a spec inteira existe para
// impor:
//
//   **O app nunca afirma o que não leu.**
//
// Um card sem plano diz "sem plano registrado", não "não realizada". Um
// `result.json` que não passou no contrato vira "não consegui ler", com o
// caminho do arquivo e o motivo — nunca ausência silenciosa. As duas frases
// são diferentes porque os dois estados são diferentes; confundi-los foi o bug
// de 03/08.

import { MACRO_STAGE_LABEL } from '../../../shared/esteira/ipc';
import { findBlockingLock, lockChainOf } from '../../../shared/esteira/store/lockChain';
import { dispatchHint, esteiraPhaseCommand, lockStateOf, type LockState } from './esteiraSession';
import type {
  DiscoverySnapshot,
  EntityId,
  IngestErrorSnapshot,
  LockRecord,
  PhaseRunSnapshot,
  PlanSnapshot,
  SessionSnapshot,
  StoreSnapshot,
  WorkItemSnapshot,
} from '../../../shared/esteira/store/storeFormat';

export type SignalTone = 'neutral' | 'attention' | 'error';

export interface SignalView {
  readonly label: string;
  readonly tone: SignalTone;
  readonly title: string;
}

const SIGNAL_VIEW: Readonly<Record<DiscoverySnapshot['stageSignals'][number], SignalView>> = {
  // O card F3 da evidência 1: estado LEGÍTIMO, com nome próprio.
  'completed-without-plan': {
    label: 'sem plano registrado',
    tone: 'neutral',
    title: 'O discovery terminou e nenhum plano foi declarado. É um desfecho possível — não é fase pendente.',
  },
  'orphan-item': {
    label: 'item sem plano',
    tone: 'attention',
    title: 'Há item de trabalho que não pertence a nenhum plano deste card.',
  },
  'ingest-error': {
    label: 'não consegui ler',
    tone: 'error',
    title: 'Um result.json deste card ficou fora do contrato. O que a skill fez não foi perdido — só não foi lido.',
  },
  'mirror-pending': {
    label: 'espelho pendente',
    tone: 'attention',
    title: 'O espelho no board falhou e está na fila. O trabalho local segue normalmente.',
  },
};

export function signalViews(discovery: DiscoverySnapshot): readonly SignalView[] {
  return discovery.stageSignals.map((signal) => SIGNAL_VIEW[signal]);
}

/** Etapa mostrada + se ela é override manual. A derivada NUNCA some da tela (D-13). */
export interface StageView {
  readonly shown: string;
  readonly derived: string;
  readonly overridden: boolean;
  readonly overrideNote: string | null;
}

export function stageView(discovery: DiscoverySnapshot): StageView {
  const derived = MACRO_STAGE_LABEL[discovery.derivedStage];
  const override = discovery.stageOverride;
  if (override === null) return { shown: derived, derived, overridden: false, overrideNote: null };

  return {
    shown: MACRO_STAGE_LABEL[override.value],
    derived,
    overridden: true,
    overrideNote: `ajustado à mão por ${override.by}${override.reason ? ` — ${override.reason}` : ''}`,
  };
}

export interface CardView {
  readonly discovery: DiscoverySnapshot;
  readonly stage: StageView;
  readonly signals: readonly SignalView[];
  readonly plans: readonly PlanSnapshot[];
  readonly planCount: number;
  readonly items: readonly WorkItemSnapshot[];
  readonly phases: readonly PhaseRunSnapshot[];
  /** A primeira trava do card — a que o bloco da trava desenha. */
  readonly lock: LockRecord | null;
  /** TODAS as travas do card: um item travado nao trava o irmao, e a tela precisa saber disso. */
  readonly locks: readonly LockRecord[];
  /** A sessão aberta pelo disparo, quando existe — é dela que saem os caminhos do inbox/outbox. */
  readonly openSession: SessionSnapshot | null;
  /** Todas as sessões do card: é delas que sai o "alguém assumiu?" de cada fase. */
  readonly sessions: readonly SessionSnapshot[];
  readonly ingestErrors: readonly IngestErrorSnapshot[];
  readonly notes: readonly { readonly text: string; readonly at: string }[];
}

/**
 * O que dizer sobre a fase travada. A distinção existe porque **preparar não é
 * começar**: o app separa o contexto e trava o card antes de qualquer sessão
 * existir. Chamar isso de "em andamento" seria a tela prometendo o que não
 * cumpre — o mesmo vício que a spec 010 combate, só que na direção contrária
 * ("não realizada" para o que foi feito).
 *
 * Batch B1 — o "Preparar" passou a abrir a aba, então a passagem de
 * preparada → em andamento tem fato próprio: o `cliSessionId` que o CLI
 * devolve. `nextStep` sobrou para o caso em que a sessão **não pôde** abrir
 * (card sem repo alvo, repo desconhecido): aí a tela diz o que fazer à mão,
 * com o MESMO comando que a aba teria recebido.
 */
export interface LockView {
  /** O fato por trás da frase — a tela nunca deriva a palavra por conta própria. */
  readonly state: LockState;
  readonly title: string;
  readonly line: string;
  /** Preenchido enquanto ninguém assumiu: o que fazer para a fase de fato rodar. */
  readonly nextStep: { readonly explanation: string; readonly command: string } | null;
}

export function lockView(card: CardView): LockView | null {
  const lock = card.lock;
  if (lock === null) return null;

  const holder = lock.holderKind === 'skill' ? 'uma skill' : 'o app';
  const claimed = card.openSession?.claimed ?? false;
  const inputPath = card.openSession?.inputPath ?? null;
  const cliSessionId = card.openSession?.cliSessionId ?? lock.cliSessionId;
  const state = lockStateOf(lock.holderKind, claimed);
  // Dono, hora e sessão (D-11): a trava nomeia quem a segura. Sem o id do
  // CLI (trava posta pela skill), diz quem a pôs — nunca fica anônima.
  const dono = cliSessionId === null ? `por ${holder}` : `na sessão ${cliSessionId}`;
  const desde = `Fase ${lock.phase}, ${dono}, desde ${formatTimestamp(lock.acquiredAt)}.`;

  if (state === 'running') {
    return { state, title: 'Em andamento', line: desde, nextStep: null };
  }

  if (state === 'session-open') {
    // Abrir a aba NÃO é começar a fase. O app escreveu o comando e parou ali —
    // enviar é gesto humano (invariante 2), e o app não tem como saber se você
    // já o fez. Chamar isto de "em andamento" era o defeito de 03/08 pela
    // quarta porta: os prints 07 e 10 do roteiro se desmentiam na mesma rodada.
    return {
      state,
      title: 'Sessão aberta',
      line: `${desde} A aba está aberta com o comando da fase escrito; o app não sabe se você já o enviou.`,
      nextStep: null,
    };
  }

  return {
    state,
    title: 'Preparada — ninguém assumiu ainda',
    line: `O app separou o contexto da fase ${lock.phase} às ${formatTimestamp(lock.acquiredAt)} e travou o card. Nada está rodando: nenhuma sessão assumiu esta fase ainda.`,
    nextStep:
      inputPath === null
        ? null
        : {
            explanation: 'Rode a fase apontando para o contexto que o app deixou:',
            command: esteiraPhaseCommand(lock.phase, inputPath),
          },
  };
}

/** Projeção do snapshot para UM card. A tela não deriva nada além disto. */
export function cardView(snapshot: StoreSnapshot, discoveryId: string): CardView | null {
  const discovery = snapshot.discoveries.find((entry) => entry.id === discoveryId);
  if (discovery === undefined) return null;

  const plans = snapshot.plans.filter((plan) => plan.discoveryId === discovery.id);
  const items = snapshot.workItems.filter((item) => item.discoveryId === discovery.id);
  const owned = new Set<string>([
    `discovery:${discovery.id}`,
    ...plans.map((plan) => `plan:${plan.id}`),
    ...items.map((item) => `work_item:${item.id}`),
  ]);
  const belongs = (subject: { entity: string; id: string }): boolean => owned.has(`${subject.entity}:${subject.id}`);
  const locks = snapshot.locks.filter((lock) => belongs(lock.subject));

  return {
    discovery,
    stage: stageView(discovery),
    signals: signalViews(discovery),
    plans,
    planCount: plans.length,
    items,
    phases: snapshot.phases.filter((phase) => belongs(phase.subject)),
    lock: locks[0] ?? null,
    locks,
    // A última sessão aberta do assunto: é ela que carrega os caminhos do
    // `run-input.json` e do `result.json` desta rodada.
    openSession: [...snapshot.sessions].reverse().find((session) => belongs(session.subject) && session.endedAt === null) ?? null,
    sessions: snapshot.sessions.filter((session) => belongs(session.subject)),
    ingestErrors: snapshot.ingestErrors.filter((error) => error.subject !== null && belongs(error.subject)),
    notes: snapshot.notes.filter((note) => belongs(note.subject)).map((note) => ({ text: note.text, at: note.at })),
  };
}

// ---------------------------------------------------------------------------
// Planos e itens — o conteúdo do card, escrito uma vez só
// ---------------------------------------------------------------------------
//
// Achado da captura e2e do B2 (print 16): a MESMA tela dizia duas coisas
// incompatíveis sobre o MESMO item, com quatro linhas de distância —
//
//   Planos e itens …  "Medir onde o lote para · spike · open · sem repo alvo"
//   Repo alvo:        "donel-dev — repo herdado do card"
//
// A herança de repo existia, mas só dentro do disparo; a lista de itens era
// montada à mão no JSX. É o erro conhecido nº 1 pela terceira vez: a correção
// parou na frase onde o defeito apareceu, em vez de descer até a função que
// produz o texto. Agora as duas frases nascem de `itemRepoOf` — divergir exige
// mudar a função, e a função tem teste.

/** O repo que este item de fato usaria, e de onde ele veio. */
export interface ItemRepoView {
  readonly repo: string | null;
  readonly inherited: boolean;
}

/**
 * D-6 — o alvo de um item: o dele, ou o do card. Nunca o "projeto em foco" da
 * janela, que foi o palpite que abriu uma fase no repositório errado.
 */
export function itemRepoOf(item: WorkItemSnapshot, discovery: DiscoverySnapshot): ItemRepoView {
  if (item.targetRepo !== null) return { repo: item.targetRepo, inherited: false };
  if (discovery.targetRepo !== null) return { repo: discovery.targetRepo, inherited: true };
  return { repo: null, inherited: false };
}

export interface ContentLineView {
  readonly key: string;
  readonly kind: 'plan' | 'item';
  readonly text: string;
}

export interface CardContentView {
  /** O título do bloco, com o que ele conta — e a lista abaixo mostra tudo o que ele contou. */
  readonly title: string;
  readonly lines: readonly ContentLineView[];
  /** O que dizer quando falta algo. `null` quando a lista já diz tudo. */
  readonly note: string | null;
}

/** "1 plano" / "2 itens" / "nenhum item" — plural de gente, não "item(ns)". */
function counted(total: number, singular: string, plural: string): string {
  if (total === 0) return `nenhum ${singular}`;
  return `${total} ${total === 1 ? singular : plural}`;
}

/**
 * Planos e itens do card, cada linha com a palavra certa. O componente imprime
 * o que sai daqui — ele não monta frase nenhuma, porque foi montando frase no
 * JSX que a tela passou a se contradizer.
 */
export function cardContent(card: CardView): CardContentView {
  const title = `Planos e itens (${counted(card.planCount, 'plano', 'planos')}, ${counted(card.items.length, 'item', 'itens')})`;

  const lines: ContentLineView[] = card.plans.map((plan) => ({
    key: `plan:${plan.id}`,
    kind: 'plan' as const,
    text: `Plano — ${plan.title}`,
  }));

  for (const item of card.items) {
    const { repo, inherited } = itemRepoOf(item, card.discovery);
    const repoText = repo === null ? 'sem repo alvo' : inherited ? `${repo} (herdado do card)` : repo;
    // A trava DO item, não a que o bloqueia: um discovery travado impede o
    // disparo do item sem que o item esteja travado, e dizer "travado" ali
    // seria a tela mentindo de novo, agora por excesso.
    const lock = card.locks.find((entry) => entry.subject.entity === 'work_item' && entry.subject.id === item.id) ?? null;
    const lockText = lock === null ? '' : ` · travado pela fase "${lock.phase}" desde ${formatTimestamp(lock.acquiredAt)}`;
    lines.push({
      key: `work_item:${item.id}`,
      kind: 'item',
      text: `${item.title} · ${item.itemType} · ${item.state} · ${repoText}${lockText}`,
    });
  }

  const note =
    card.planCount === 0 && card.items.length === 0
      ? 'Nenhum plano registrado. Se o discovery terminou assim, é um desfecho — não uma pendência.'
      : card.items.length === 0
        ? 'Os planos ainda não declararam nenhum item.'
        : null;

  return { title, lines, note };
}

/**
 * Em que pé está a SESSÃO daquela fase — o que decide entre três frases que
 * descrevem estados diferentes e já foram confundidas duas vezes neste repo.
 */
export type PhasePresence =
  /** Existe sessão viva com id do CLI: a aba abriu. Não diz que o comando foi enviado. */
  | 'claimed'
  /** O app separou o contexto e travou o card; ninguém pegou ainda. */
  | 'prepared'
  /** Batch B1 — havia sessão, ela acabou, e a fase não concluiu nem falhou. */
  | 'interrupted'
  /** Fase iniciada sem sessão do app: quem afirmou o início foi a skill, pelo outbox. */
  | 'declared';

/**
 * A frase de UMA passagem de fase. Cada estado tem palavra própria — e nenhuma
 * delas é "não realizada":
 *
 *  - concluiu      → "concluída", "abandonada", "terminou sem conclusão"
 *  - falhou        → "falhou: <código>" (o desfecho ruim é legível)
 *  - sessão aberta → "sessão aberta" (a aba existe; o Enter é seu)
 *  - só preparada  → "preparada, ninguém assumiu"
 *  - interrompida  → "interrompida: a sessão terminou sem concluir"
 *  - declarada     → "em andamento" (a skill afirmou o início; ela é quem sabe)
 *
 * `presence` existe porque o app registra `phase.started` no DISPARO, e disparar
 * não é começar: o card fica travado esperando alguém rodar a fase. Chamar isso
 * de "em andamento" foi o mesmo erro que o bloco da trava já tinha cometido —
 * ele reapareceu aqui porque a correção de lá não subiu até a raiz.
 *
 * A terceira frase entrou no batch B1, pela MESMA porta: fechada a aba, não
 * sobra sessão aberta para desmentir a frase otimista, e a lista voltaria a
 * dizer "em andamento" para uma fase que ninguém está tocando.
 */
export function phaseLine(phase: PhaseRunSnapshot, presence: PhasePresence = 'declared'): string {
  if (phase.failure !== null) return `${phase.phase} — falhou: ${phase.failure.code}`;
  if (phase.completedAt !== null) {
    const outcome =
      phase.outcome === 'done' ? 'concluída' : phase.outcome === 'abandoned' ? 'abandonada' : 'terminou sem conclusão';
    return `${phase.phase} — ${outcome}`;
  }
  if (phase.startedAt !== null) {
    const word =
      presence === 'claimed'
        ? 'sessão aberta'
        : presence === 'prepared'
          ? 'preparada, ninguém assumiu'
          : presence === 'interrupted'
            ? 'interrompida: a sessão terminou sem concluir'
            : 'em andamento';
    return `${phase.phase} — ${word}`;
  }
  return `${phase.phase} — registrada`;
}

/** As fases do card, cada uma com a frase certa — a tela só imprime o que sai daqui. */
export interface PhaseLineView {
  readonly key: string;
  readonly text: string;
  readonly failed: boolean;
  readonly detail: string | null;
}

export function phaseLines(card: CardView): readonly PhaseLineView[] {
  return card.phases.map((phase) => {
    const doAssunto = card.sessions.filter(
      (entry) =>
        entry.phase === phase.phase && entry.subject.entity === phase.subject.entity && entry.subject.id === phase.subject.id,
    );
    const aberta = doAssunto.find((entry) => entry.endedAt === null);
    // Sessão aberta manda: assumida ou só preparada. Sem sessão aberta, mas com
    // sessão que já existiu, a fase ficou pelo meio — e é isso que a tela diz.
    // Sem sessão nenhuma (fase vinda só da ingestão), a frase não depende disso.
    const presence: PhasePresence =
      aberta !== undefined ? (aberta.claimed ? 'claimed' : 'prepared') : doAssunto.length > 0 ? 'interrupted' : 'declared';
    return {
      key: `${phase.subject.entity}:${phase.subject.id}:${phase.phase}`,
      text: phaseLine(phase, presence),
      failed: phase.failure !== null,
      detail: phase.failure?.message ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Disparo — só oferecer o que o modelo comporta
// ---------------------------------------------------------------------------
//
// Achado do primeiro uso real: dava para disparar a fase "Plano" num card que
// não tinha plano nenhum, e o `run-input.json` saía com `plan_id: null`. A fase
// Plano existe para detalhar um plano; a tela oferecia um caminho que o modelo
// não comporta, e o clique só falhava depois.
//
// A correção tem duas metades, e as duas moram aqui, na camada pura:
//
//  1. a fase que o card não comporta fica DESABILITADA, com a razão ESCRITA —
//     o mesmo padrão que a trava já usa;
//  2. quem dispara escolhe o ASSUNTO (o discovery, um plano ou um item), que é
//     o que destrava as fases de item.
//
// E o D-6 é cobrado ANTES do clique: item `issue` sem repo alvo não dispara, e
// a tela diz por quê em vez de deixar clicar no escuro.

export type DispatchEntity = 'discovery' | 'plan' | 'work_item';

interface PhaseSpec {
  readonly phase: string;
  readonly label: string;
  readonly runsOn: DispatchEntity;
  /** A frase de quando o card ainda não tem o que a fase exige. */
  readonly missing: string;
}

/**
 * O catálogo do que a TELA oferece hoje — **não** o enum do contrato.
 * `run.phase` é string livre de propósito (`[P-4]`: os nomes de fase de cada
 * ciclo só se fecham com uso real na mão), e fechá-lo num enum agora decidiria
 * essa pendência por acidente. Esta tabela diz o que o app propõe e o que cada
 * proposta exige do card; o contrato continua aberto por baixo.
 */
const PHASE_CATALOG: readonly PhaseSpec[] = [
  { phase: 'discovery', label: 'Discovery', runsOn: 'discovery', missing: '' },
  {
    phase: 'plano',
    label: 'Plano',
    runsOn: 'plan',
    missing:
      'Nenhum plano declarado ainda. A fase Plano detalha um plano que já existe — quem declara o primeiro é o Discovery.',
  },
  {
    phase: 'implementar',
    label: 'Implementar',
    runsOn: 'work_item',
    missing:
      'Nenhum item de trabalho ainda. Implementar roda sobre um item, e item nasce pela skill (D-16) — o app não tem formulário de criação.',
  },
  {
    phase: 'validar',
    label: 'Validar',
    runsOn: 'work_item',
    missing:
      'Nenhum item de trabalho ainda. Validar roda sobre um item, e item nasce pela skill (D-16) — o app não tem formulário de criação.',
  },
];

export interface PhaseChoiceView {
  readonly phase: string;
  readonly label: string;
  readonly runsOn: DispatchEntity;
  readonly enabled: boolean;
  /** Por que esta fase não pode rodar neste card agora. `null` quando pode. */
  readonly reason: string | null;
}

export interface DispatchTargetView {
  readonly key: string;
  readonly label: string;
  readonly entity: DispatchEntity;
  readonly discoveryId: string;
  readonly planId: string | null;
  readonly workItemId: string | null;
  /** D-6 — o repo que a sessão usaria. Item sem repo próprio herda o do card, e só o do card. */
  readonly targetRepo: string | null;
  /** De onde o repo veio, quando não é o do próprio assunto. */
  readonly repoNote: string | null;
  /** Por que ESTE assunto não dispara. `null` quando dispara. */
  readonly blocked: string | null;
}

export interface DispatchView {
  readonly phases: readonly PhaseChoiceView[];
  /** A fase escolhida, já resolvida contra o catálogo. */
  readonly phase: PhaseChoiceView;
  /** Os assuntos possíveis para a fase escolhida. */
  readonly targets: readonly DispatchTargetView[];
  readonly target: DispatchTargetView | null;
  readonly canDispatch: boolean;
  /** A razão de não dar para disparar. Sempre preenchida quando `canDispatch` é falso. */
  readonly blocked: string | null;
  /** O que o clique faz — a frase que fica quando não há impedimento. */
  readonly hint: string;
}

export interface DispatchSelection {
  readonly phase: string;
  readonly targetKey: string | null;
}

// A frase de "o que o clique faz" NÃO mora mais aqui. O batch B1 fez o disparo
// abrir a aba, e o texto antigo ("hoje, apontando para o arquivo à mão")
// passou a ser mentira no instante em que os dois batches se encontraram. Ela
// nasce de `dispatchHint`, junto do vocabulário da trava — assim ela usa a
// MESMA palavra do bloco "Preparada / Sessão aberta / Em andamento", que é o
// erro nº 1 de `erros-conhecidos.md` na sua terceira volta.

const LOCK_SCOPE: Readonly<Record<DispatchEntity, string>> = {
  discovery: 'no card',
  plan: 'no plano',
  work_item: 'no item',
};

/** A chave estável de um assunto — é o que a tela guarda entre renderizações. */
function targetKeyOf(subject: EntityId): string {
  return `${subject.entity}:${subject.id}`;
}

function candidatesFor(card: CardView, runsOn: DispatchEntity): readonly DispatchTargetView[] {
  const discoveryId = card.discovery.id;

  if (runsOn === 'discovery') {
    return [
      buildTarget(card, {
        subject: { entity: 'discovery', id: discoveryId },
        label: `O discovery — ${card.discovery.title}`,
        planId: null,
        workItemId: null,
        targetRepo: card.discovery.targetRepo,
        repoNote: null,
        needsRepo: false,
      }),
    ];
  }

  if (runsOn === 'plan') {
    return card.plans.map((plan) =>
      buildTarget(card, {
        subject: { entity: 'plan', id: plan.id },
        label: `Plano — ${plan.title}`,
        planId: plan.id,
        workItemId: null,
        targetRepo: card.discovery.targetRepo,
        repoNote: null,
        needsRepo: false,
      }),
    );
  }

  return card.items.map((item) => {
    // O item HERDA o repo do card quando não declarou o seu (D-6). A resolução
    // é a MESMA que a lista de itens usa (`itemRepoOf`) — quando eram duas, a
    // lista dizia "sem repo alvo" enquanto esta linha dizia "herdado do card",
    // sobre o mesmo item e na mesma tela.
    const { repo, inherited } = itemRepoOf(item, card.discovery);
    return buildTarget(card, {
      subject: { entity: 'work_item', id: item.id },
      label: `${item.itemType} — ${item.title}`,
      planId: item.planId,
      workItemId: item.id,
      targetRepo: repo,
      repoNote: inherited ? 'repo herdado do card' : null,
      needsRepo: item.itemType === 'issue',
    });
  });
}

function buildTarget(
  card: CardView,
  spec: {
    readonly subject: EntityId;
    readonly label: string;
    readonly planId: string | null;
    readonly workItemId: string | null;
    readonly targetRepo: string | null;
    readonly repoNote: string | null;
    readonly needsRepo: boolean;
  },
): DispatchTargetView {
  const chain = lockChainOf(spec.subject, { discoveryId: card.discovery.id, planId: spec.planId });
  const lock = findBlockingLock(card.locks, chain);

  let blocked: string | null = null;
  if (spec.needsRepo && spec.targetRepo === null) {
    blocked =
      'Este item é do tipo issue e não tem repo alvo — nem ele, nem o card. Sem repo a fase não dispara: o app não escolhe um repositório por você.';
  } else if (lock !== null) {
    blocked = `A fase "${lock.phase}" já está travada ${LOCK_SCOPE[lock.subject.entity]}, desde ${formatTimestamp(lock.acquiredAt)}. Libere a trava antes de preparar outra.`;
  }

  return {
    key: targetKeyOf(spec.subject),
    label: spec.label,
    entity: spec.subject.entity,
    discoveryId: card.discovery.id,
    planId: spec.planId,
    workItemId: spec.workItemId,
    targetRepo: spec.targetRepo,
    repoNote: spec.repoNote,
    blocked,
  };
}

/**
 * O que a tela pode oferecer neste card, para esta escolha. Uma função só,
 * porque a decisão é uma só: **o app não oferece o que o modelo não comporta,
 * e não recusa em silêncio.** O componente lê o resultado e desenha; ele não
 * decide quem está habilitado nem escreve razão nenhuma.
 */
export function dispatchView(card: CardView, selection: DispatchSelection): DispatchView {
  const phases: readonly PhaseChoiceView[] = PHASE_CATALOG.map((spec) => {
    const enabled =
      spec.runsOn === 'discovery' ? true : spec.runsOn === 'plan' ? card.plans.length > 0 : card.items.length > 0;
    return { phase: spec.phase, label: spec.label, runsOn: spec.runsOn, enabled, reason: enabled ? null : spec.missing };
  });

  // Fase desconhecida cai na primeira: a tela nunca fica sem estado válido —
  // e a primeira é sempre a que qualquer card comporta.
  const phase = phases.find((entry) => entry.phase === selection.phase) ?? phases[0];
  const targets = candidatesFor(card, phase.runsOn);
  const target = targets.find((entry) => entry.key === selection.targetKey) ?? targets[0] ?? null;

  const blocked = !phase.enabled
    ? phase.reason
    : target === null
      ? 'Não há assunto para esta fase neste card.'
      : target.blocked;

  // O `hint` sai do MESMO vocabulário da trava (B1): sem trava, ele conta que o
  // clique abre a aba com o comando escrito; com trava, ele repete a palavra que
  // o bloco acima já usou. Escrito à parte, ele dizia "preparada" para um card
  // cujo bloco dizia "Em andamento".
  const lockState = card.lock === null ? null : lockStateOf(card.lock.holderKind, card.openSession?.claimed ?? false);

  return {
    phases,
    phase,
    targets,
    target,
    canDispatch: blocked === null,
    blocked,
    hint: dispatchHint(lockState),
  };
}

/** Um erro de ingestão, em português, sem esconder o caminho do arquivo. */
export function ingestErrorLine(error: IngestErrorSnapshot): string {
  const first = error.issues[0];
  const detail = first === undefined ? 'motivo não registrado' : `${first.code}${first.path ? ` em ${first.path}` : ''}`;
  const more = error.issues.length > 1 ? ` (+${error.issues.length - 1})` : '';
  return `${detail}${more}`;
}

export const STORE_COMPATIBILITY_WARNING: Readonly<Record<string, string | null>> = {
  'read-write': null,
  'read-only': 'Este histórico foi escrito por uma versão mais nova do Donel Dev. Dá para ler, mas nada será gravado aqui.',
  'needs-migration': 'Este histórico é de um formato anterior. A escrita só volta depois de uma migração explícita.',
  unreadable: 'Não consegui ler o cabeçalho do histórico. Nada será gravado até isso se resolver.',
};

export function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
