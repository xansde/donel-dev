// Spec 010 / batch B6 — o mapa passa a ler o STORE.
//
// Este módulo é o ADAPTADOR: `StoreSnapshot` → o que o carrossel consome. Ele
// não conhece React, não lê disco e não fala IPC; o componente
// (`DiscoveryMap.tsx`) desenha o que sai daqui e nada além.
//
// A FORMA sobrevive — carrossel de dois eixos, chips de fase, painel de detalhe
// são o design v3, aprovado por handoff. O que muda é o que os nós SIGNIFICAM:
//
//   antes                                     agora
//   discovery → cards de plano → fases (PR)   discovery → planos → ITENS
//   7 fases fixas por card                    fases em aberto [P-4]; o que varia
//                                             é o CICLO DE VIDA do tipo [D-4]
//   tudo termina em PR                        adr/process-map terminam por revisão;
//                                             spike/prototype/eval por RESPOSTA,
//                                             inclusive negativa
//   estado lido do disco, fase a fase         macro etapa DERIVADA do grafo [D-13]
//
// Duas regras de convivência com o que os outros batches entregaram, e as duas
// têm cicatriz no repo:
//
// 1. **Texto de estado é importado, nunca reescrito.** Toda frase vem de
//    `esteiraView.ts`/`esteiraSession.ts`. Reescrever frase aqui é como o mesmo
//    defeito reapareceu noutro bloco depois de "corrigido".
// 2. **O que pode ser disparado quem decide é `dispatchView` (B2).** A trilha
//    pergunta; ela não recalcula. Recalcular faria o carrossel oferecer o que a
//    outra tela recusa — o defeito do B2 pelo avesso, agora em duas telas.

import {
  cardView,
  catalogPhasesFor,
  dispatchView,
  ingestErrorLine,
  isItemClosed,
  itemClosureLine,
  itemMeta,
  liveSessionOf,
  lockView,
  MIRROR_PENDING_HINT,
  MIRROR_PENDING_TITLE,
  mirrorLines,
  phaseLines,
  phaseSessions,
  PHASE_STATE_WORD,
  provenanceMark,
  verificationLines,
  type CardView,
  type LockView,
  type MirrorLineView,
  type PhaseTrailState,
  type SignalTone,
  type VerificationLineView,
} from '../Esteira/esteiraView';
import { resolveResume } from '../Esteira/esteiraSession';
import type { ArtifactPointer, EntityId, StoreSnapshot, WorkItemSnapshot } from '../../../shared/esteira/store/storeFormat';

export type MapLevelKey = 'discovery' | 'planos' | 'itens' | 'preview';
export type MapTone = 'muted' | 'ok' | 'warn' | 'error' | 'lock' | 'accent';

/** Os 5 estados que o glifo do design-system desenha. A palavra é nossa; o glifo é dele. */
export type MapGlyph = 'not-started' | 'running' | 'done' | 'failed' | 'stuck';

/** Estado da fase → glifo. Desfecho é desfecho: abandonada e inconclusiva fecham. */
const GLYPH_BY_STATE: Readonly<Record<PhaseTrailState, MapGlyph>> = {
  concluida: 'done',
  abandonada: 'done',
  inconclusiva: 'done',
  falhou: 'failed',
  'sessao-aberta': 'running',
  'em-andamento': 'running',
  preparada: 'stuck',
  interrompida: 'stuck',
  registrada: 'not-started',
};

/** Fases cujo ciclo já fechou — não são "a próxima" de ninguém. */
const FECHADAS: ReadonlySet<PhaseTrailState> = new Set<PhaseTrailState>(['concluida', 'abandonada', 'inconclusiva']);

export interface MapTag {
  readonly text: string;
  readonly tone: MapTone;
  readonly title: string | null;
}

export interface MapTrailStep {
  readonly key: string;
  readonly phase: string;
  /** A frase inteira da etapa, vinda de `phaseLine` — o componente só imprime. */
  readonly text: string;
  /**
   * C1 — a MESMA informação de `text`, resumida a uma palavra (chip/glifo do
   * design). É o que o card em foco desenha na trilha; `text` desce para
   * tooltip. Nasce de `PHASE_STATE_WORD` (a mesma tabela que já existia),
   * nunca reescrita aqui.
   */
  readonly label: string;
  readonly glyph: MapGlyph;
  /** Só a etapa que vem A SEGUIR ganha o "⌁ Preparar" (mesma regra da trilha do design). */
  readonly isNext: boolean;
  readonly isLast: boolean;
  /** `false` = existe próxima etapa, mas ela não pode rodar agora. A razão vem escrita. */
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly subject: EntityId;
  readonly detail: string | null;
  /**
   * B1 — a sessão que "Retomar" reabriria (`claude -r <cliSessionId>` no
   * `cwd` dela), quando o passo já FECHOU e há uma sessão de CLI completa pra
   * ele. `null` para qualquer passo que não fechou (inclusive "é a próxima")
   * ou cuja fase rodou sem sessão de app (seed, ou skill fora do disparo) —
   * nesses dois casos não há o que reabrir.
   */
  readonly resume: { readonly cliSessionId: string; readonly cwd: string } | null;
}

export interface MapCard {
  readonly key: string;
  readonly kind: 'discovery' | 'plan' | 'item' | 'preview';
  /** `null` só no card fantasma do nível que ainda não existe. */
  readonly subject: EntityId | null;
  readonly icon: string;
  readonly title: string;
  /** A palavra de estado à direita do título: a macro etapa, o estado do item. */
  readonly statusLabel: string;
  readonly metaLine: string | null;
  /**
   * C1 — a MESMA meta, resumida a uma palavra, para o card em espaço mínimo
   * desenhar (o item: o TIPO). `null` quando não há o que encurtar — a meta
   * de discovery/plano já é uma contagem curta, não uma frase. `metaLine`
   * nunca perde a versão inteira: ela é o que o tooltip mostra.
   */
  readonly metaLabel: string | null;
  readonly tags: readonly MapTag[];
  readonly accent: MapTone;
  /** Vazia fora de foco — a trilha vive no card em foco, como no design. */
  readonly trail: readonly MapTrailStep[];
  /** D-4 — como o ciclo deste item terminou. `null` enquanto ele não fechou. */
  readonly closureLine: string | null;
  /** C1 — o mesmo fecho, resumido a um rótulo curto; `null` junto com `closureLine`. */
  readonly closureLabel: string | null;
  readonly footer: string | null;
}

export interface MapLevel {
  readonly key: MapLevelKey;
  readonly label: string;
  readonly tall: boolean;
  readonly focusedCardIndex: number;
  readonly cards: readonly MapCard[];
  /** O nível fantasma nunca recebe foco: ele mostra o caminho adiante, não um nó. */
  readonly focusable: boolean;
}

export interface MapArtifactView {
  readonly key: string;
  readonly icon: string;
  readonly path: string;
  /** Onde ele mora (D-8) — repo com nome, ou disco. */
  readonly note: string;
}

export interface MapIngestErrorView {
  readonly key: string;
  readonly path: string;
  readonly reason: string;
}

export interface MapNoteView {
  readonly key: string;
  readonly about: string;
  readonly text: string;
}

export interface MapDetailView {
  /** C3 — o assunto deste detalhe, cru: é o que `App.tsx` usa pra pedir `tasksArtifactFor` sem duplicar a resolução do nó em foco. */
  readonly subject: EntityId;
  readonly title: string;
  /** O que este nó é: "Discovery", "Plano", "issue · em curso · donel-dev". */
  readonly subtitle: string;
  /** A fase escolhida na trilha, quando há uma. */
  readonly phase: string | null;
  readonly phaseGlyph: MapGlyph | null;
  readonly summary: string;
  readonly closureLine: string | null;
  readonly verifications: readonly VerificationLineView[];
  readonly verificationsTitle: string;
  readonly artifacts: readonly MapArtifactView[];
  readonly notes: readonly MapNoteView[];
  readonly ingestErrors: readonly MapIngestErrorView[];
  readonly ingestErrorNote: string;
  readonly mirror: readonly MirrorLineView[];
  readonly mirrorTitle: string;
  readonly mirrorHint: string;
  readonly lock: LockView | null;
}

export interface MapSelection {
  readonly discoveryId: string | null;
  readonly planId: string | null;
  readonly itemId: string | null;
  /** Nó cujo detalhe está aberto (`entity:id`). `null` = o card em foco. */
  readonly nodeKey: string | null;
  /** Etapa escolhida na trilha daquele nó. `null` = o nó inteiro. */
  readonly phase: string | null;
}

export interface EsteiraMapView {
  readonly levels: readonly MapLevel[];
  readonly focused: {
    readonly discoveryId: string | null;
    readonly planId: string | null;
    readonly itemId: string | null;
  };
  readonly detail: MapDetailView | null;
  readonly breadcrumb: readonly string[];
  /** A frase do vazio. `null` quando há card. */
  readonly empty: string | null;
}

/** O vazio é honesto: o histórico NASCE limpo — nada sumiu, nada foi importado (D-2). */
export const MAP_EMPTY =
  'Nenhum card ainda. O histórico nasce limpo — nada foi importado do modelo antigo.';

export const MAP_EMPTY_NO_STORE = 'Não consegui ler o histórico ainda. Nada foi afirmado sobre ele.';

/** O que o nível seguinte espera — a forma do nível-fantasma do design, com a frase do modelo novo. */
const PREVIEW_HINT = 'nascem do discovery — quem declara o primeiro plano é a skill, nunca o app';

const INGEST_ERROR_NOTE = 'O que a skill fez não se perdeu: o arquivo continua lá, fora do contrato.';

const VERIFICATIONS_TITLE = 'O que dá para conferir';

const SIGNAL_TONE: Readonly<Record<SignalTone, MapTone>> = {
  neutral: 'muted',
  attention: 'warn',
  error: 'error',
};

function entityKey(subject: EntityId): string {
  return `${subject.entity}:${subject.id}`;
}

// F25 (010, D1) — exportada para o mapa de nós: navegar por um nó clicado
// precisa do MESMO `EntityId` que o carrossel já resolve a partir do
// `nodeKey` de `MapSelection`, para alternar a aba da sessão viva
// (`focusLiveSessionOf` em App.tsx) com a mesma semântica de `onFocusDiscovery`
// /`onFocusPlan`/`onFocusItem` — nenhum segundo parser de chave.
export function parseEntityKey(value: string | null): EntityId | null {
  if (value === null) return null;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const entity = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (id.length === 0) return null;
  if (entity !== 'discovery' && entity !== 'plan' && entity !== 'work_item') return null;
  return { entity, id };
}

function contado(total: number, singular: string, plural: string): string {
  return `${total} ${total === 1 ? singular : plural}`;
}

function lockOf(card: CardView, subject: EntityId) {
  return card.locks.find((lock) => lock.subject.entity === subject.entity && lock.subject.id === subject.id) ?? null;
}

/**
 * A trilha de UM assunto: as fases que rodaram nele + a que vem a seguir.
 *
 * Nenhuma fase fixa (`[P-4]`: nome de fase é string livre até o horizontal
 * pequeno). Fase que nunca rodou e que o catálogo não oferece simplesmente não
 * aparece — inventá-la para desenhá-la "não realizada" é a issue #35, que esta
 * spec manda reverter.
 */
/**
 * B1 — a sessão que "Retomar" reabriria para ESTE passo, quando ele fechou.
 * `null` para qualquer passo aberto (não é o que "concluída" significa) e
 * para fechado sem sessão de CLI completa (seed, ou skill fora do disparo —
 * não há aba pra reabrir). A decisão de QUAL sessão (a última da cadeia) é
 * `resolveResume`, importada — nunca recalculada aqui.
 */
function resumeFor(card: CardView, subject: EntityId, phase: string, state: PhaseTrailState): MapTrailStep['resume'] {
  if (!FECHADAS.has(state)) return null;
  const resolution = resolveResume(phaseSessions(card, subject, phase));
  return resolution.ok ? { cliSessionId: resolution.cliSessionId, cwd: resolution.cwd } : null;
}

function trailFor(card: CardView, subject: EntityId, item: WorkItemSnapshot | null): readonly MapTrailStep[] {
  const historia = phaseLines(card, subject).map((line) => ({
    key: line.key,
    phase: line.phase.phase,
    text: line.text,
    // C1 — a mesma tabela que já existia (`PHASE_STATE_WORD`); o passo em
    // foco desenha `label`, o tooltip/detalhe usa `text`.
    label: PHASE_STATE_WORD[line.state],
    glyph: GLYPH_BY_STATE[line.state],
    isNext: false,
    isLast: false,
    enabled: true,
    reason: null as string | null,
    subject,
    detail: line.detail,
    resume: resumeFor(card, subject, line.phase.phase, line.state),
    state: line.state,
  }));

  // D-4 — item fechado não tem "próxima fase": o ciclo dele terminou, e um passo
  // pendente pendurado aqui é exatamente o que fazia um `spike` respondido
  // parecer PR pela metade.
  const fechado = item !== null && isItemClosed(item);
  const candidato = fechado
    ? undefined
    : catalogPhasesFor(subject.entity).find((spec) => {
        const linha = historia.find((step) => step.phase === spec.phase);
        return linha === undefined || !FECHADAS.has(linha.state);
      });

  const steps = historia.map(({ state: _state, ...step }) => step);

  if (candidato !== undefined) {
    // Quem decide se dá para disparar é o B2 — a trilha pergunta, não recalcula.
    const oferta = dispatchView(card, { phase: candidato.phase, targetKey: entityKey(subject) });
    const enabled = oferta.canDispatch && oferta.target?.key === entityKey(subject);
    const reason = enabled ? null : (oferta.target?.blocked ?? oferta.blocked);
    const jaNaTrilha = steps.findIndex((step) => step.phase === candidato.phase);

    if (jaNaTrilha >= 0) {
      steps[jaNaTrilha] = { ...steps[jaNaTrilha], isNext: true, enabled, reason };
    } else {
      steps.push({
        key: `${entityKey(subject)}:${candidato.phase}:proxima`,
        phase: candidato.phase,
        text: `${candidato.phase} — é a próxima`,
        label: 'próxima',
        glyph: 'not-started',
        isNext: true,
        isLast: false,
        enabled,
        reason,
        subject,
        detail: null,
        resume: null,
      });
    }
  }

  return steps.map((step, index) => ({ ...step, isLast: index === steps.length - 1 }));
}

function discoveryCard(card: CardView, focused: boolean): MapCard {
  const subject: EntityId = { entity: 'discovery', id: card.discovery.id };
  const lock = lockOf(card, subject);
  const tags: MapTag[] = card.signals.map((signal) => ({
    text: signal.label,
    tone: SIGNAL_TONE[signal.tone],
    title: signal.title,
  }));

  // D-13 — o ajuste manual nunca esconde o cálculo: a etiqueta carrega a frase
  // inteira, com a etapa calculada dentro dela.
  if (card.stage.overridden && card.stage.overrideLine !== null) {
    tags.push({ text: `ajuste manual · calculada: ${card.stage.derived}`, tone: 'warn', title: card.stage.overrideLine });
  }
  // C1 — o `title` da etiqueta de trava era `null`: a etiqueta cabia, mas o
  // dono/hora/sessão sumiam da tela inteira, em vez de só mudar de camada.
  if (lock !== null) tags.push({ text: `trava: ${lock.phase}`, tone: 'lock', title: lockView(card, lock)?.line ?? null });

  // T-14 do inventário (fechado quando o B4 entrou): sem a marca, o card
  // semeado apareceria no carrossel como fato observado — o mesmo bug que a
  // tela do store corrige, renascendo na tela nova. A palavra vem de
  // `provenanceMark`, nunca é reescrita aqui.
  const seededTag = provenanceMark(card.discovery.seeded);
  if (seededTag !== null) tags.push({ text: seededTag.label, tone: 'muted', title: seededTag.title });

  const meta = [
    card.discovery.targetRepo,
    contado(card.plans.length, 'plano', 'planos'),
    contado(card.items.length, 'item', 'itens'),
  ].filter((part): part is string => part !== null && part.length > 0);

  return {
    key: entityKey(subject),
    kind: 'discovery',
    subject,
    icon: '◈',
    title: card.discovery.title,
    statusLabel: card.stage.shown,
    metaLine: meta.join(' · '),
    // C1 — nada a encurtar aqui: a meta do discovery já é uma contagem curta
    // ("repo · N planos · N itens"), não uma frase para descer a tooltip.
    metaLabel: null,
    tags,
    accent: card.signals.some((signal) => signal.tone === 'error')
      ? 'error'
      : lock !== null
        ? 'lock'
        : card.discovery.derivedStage === 'done'
          ? 'ok'
          : card.discovery.derivedStage === 'execution'
            ? 'accent'
            : 'muted',
    trail: focused ? trailFor(card, subject, null) : [],
    closureLine: null,
    closureLabel: null,
    footer: card.discovery.problem,
  };
}

function planCard(card: CardView, planId: string, focused: boolean): MapCard {
  const plan = card.plans.find((entry) => entry.id === planId)!;
  const subject: EntityId = { entity: 'plan', id: plan.id };
  const lock = lockOf(card, subject);
  const itens = card.items.filter((item) => item.planId === plan.id);
  const fechados = itens.filter((item) => isItemClosed(item)).length;

  const tags: MapTag[] = [];
  // C1 — mesmo conserto do discoveryCard: o title da etiqueta de trava
  // carrega a frase honesta agora, em vez de sumir com dono/hora/sessão.
  if (lock !== null) tags.push({ text: `trava: ${lock.phase}`, tone: 'lock', title: lockView(card, lock)?.line ?? null });
  // T-14 — o plano semeado carrega a mesma marca do card (ver discoveryCard).
  const seededTag = provenanceMark(plan.seeded);
  if (seededTag !== null) tags.push({ text: seededTag.label, tone: 'muted', title: seededTag.title });

  return {
    key: entityKey(subject),
    kind: 'plan',
    subject,
    icon: '▷',
    title: plan.title,
    statusLabel:
      itens.length === 0 ? 'nenhum item ainda' : `${fechados} de ${contado(itens.length, 'item', 'itens')} fechado(s)`,
    metaLine: plan.summary,
    // C1 — mesma razão do discovery: sem frase longa aqui pra encurtar.
    metaLabel: null,
    tags,
    accent: lock !== null ? 'lock' : itens.length > 0 && fechados === itens.length ? 'ok' : 'muted',
    trail: focused ? trailFor(card, subject, null) : [],
    closureLine: null,
    closureLabel: null,
    footer: null,
  };
}

function itemCard(card: CardView, item: WorkItemSnapshot, focused: boolean): MapCard {
  const subject: EntityId = { entity: 'work_item', id: item.id };
  const lock = lockOf(card, subject);
  const tags: MapTag[] = [];

  // D-5 — a forma esperada é a ampulheta, mas ela é convenção, não lei: o item
  // sem plano é SINALIZADO e nunca escondido.
  if (item.planId === null) {
    tags.push({ text: 'sem plano', tone: 'warn', title: 'Este item não pertence a nenhum plano deste card.' });
  }
  // C1 — o `title` da etiqueta de trava vinha `null`: a etiqueta cabia
  // ("trava: implementar"), mas o dono/hora/sessão sumiam da tela inteira, não
  // só encurtavam de camada. `lockView` já monta essa frase — pedida com a
  // trava DESTE item (não `card.lock`, a primeira do card), nunca reescrita.
  if (lock !== null) tags.push({ text: `trava: ${lock.phase}`, tone: 'lock', title: lockView(card, lock)?.line ?? null });

  // T-14 — o item semeado carrega a mesma marca do card (ver discoveryCard).
  const seededTag = provenanceMark(item.seeded);
  if (seededTag !== null) tags.push({ text: seededTag.label, tone: 'muted', title: seededTag.title });

  // D-4 — o fecho do ciclo. `itemClosureLine` já devolve `null` pra item
  // aberto (D-4 original).
  const closure = itemClosureLine(item, card.verifications);

  return {
    key: entityKey(subject),
    kind: 'item',
    subject,
    icon: '⑂',
    title: item.title,
    statusLabel: item.state === 'in-progress' ? 'em curso' : item.state === 'open' ? 'aberto' : item.state === 'done' ? 'concluído' : 'abandonado',
    metaLine: itemMeta(item, card.discovery, lock),
    // C1 — o tipo (uma palavra: "issue", "spike", "adr"...) é o que o card
    // desenha; a frase inteira (tipo · estado · repo · origem · trava)
    // continua em `metaLine`, agora só para tooltip/detalhe.
    metaLabel: item.itemType,
    tags,
    accent: isItemClosed(item) ? 'ok' : lock !== null ? 'lock' : item.state === 'in-progress' ? 'accent' : 'muted',
    trail: focused ? trailFor(card, subject, item) : [],
    closureLine: closure,
    // C1 — a frase INTEIRA de `closureLine` segue existindo, pro tooltip/
    // painel de detalhe; o card em si desenha só este rótulo curto. Antes era
    // a frase inteira, sem tooltip, dita direto no espaço mínimo do card.
    closureLabel: closure === null ? null : 'ver desfecho',
    footer: null,
  };
}

function previewLevel(): MapLevel {
  return {
    key: 'preview',
    label: 'PLANOS',
    tall: false,
    focusedCardIndex: 0,
    focusable: false,
    cards: [
      {
        key: 'preview',
        kind: 'preview',
        subject: null,
        icon: '▷',
        title: 'PLANOS',
        statusLabel: '',
        metaLine: PREVIEW_HINT,
        metaLabel: null,
        tags: [],
        accent: 'muted',
        trail: [],
        closureLine: null,
        closureLabel: null,
        footer: null,
      },
    ],
  };
}

function detailFor(card: CardView, subject: EntityId, phase: string | null): MapDetailView {
  const item = subject.entity === 'work_item' ? (card.items.find((entry) => entry.id === subject.id) ?? null) : null;
  const plan = subject.entity === 'plan' ? (card.plans.find((entry) => entry.id === subject.id) ?? null) : null;
  const trilha = phaseLines(card, subject);
  const daFase = phase === null ? null : (trilha.find((line) => line.phase.phase === phase) ?? null);

  const title = item !== null ? item.title : plan !== null ? plan.title : card.discovery.title;
  const subtitle =
    item !== null
      ? itemMeta(item, card.discovery, lockOf(card, subject))
      : plan !== null
        ? 'Plano'
        : `Discovery · ${card.stage.shown}`;

  // A linha do topo é sempre o QUE o nó é (tipo, estado, repo, origem). O fecho
  // do ciclo tem seção própria logo abaixo: repeti-lo aqui — o que a captura do
  // B6 fotografou no print 19 — imprimia a MESMA frase duas vezes a três linhas
  // de distância e, de quebra, sumia com a meta do item justamente quando ele
  // fecha (o print do spike não dizia mais "spike · concluído · repo · origem").
  const summary =
    daFase !== null
      ? daFase.text
      : item !== null
        ? itemMeta(item, card.discovery, lockOf(card, subject))
        : plan !== null
          ? (plan.summary ?? 'Plano sem resumo declarado.')
          : (card.discovery.problem ?? 'Sem problema declarado — o card só tem o título.');

  return {
    subject,
    title,
    subtitle,
    phase: daFase?.phase.phase ?? null,
    phaseGlyph: daFase === null ? null : GLYPH_BY_STATE[daFase.state],
    summary,
    closureLine: item === null ? null : itemClosureLine(item, card.verifications),
    // D-4 — o PR é só UMA das formas de conferir; check, revisão e conclusão
    // contam igual. O mapa antigo só sabia falar de PR. A frase é a MESMA do
    // painel do store (verificationLines do B7): reescrevê-la aqui foi o que o
    // handoff do B7 pediu para não acontecer.
    verifications: verificationLines(card, subject),
    verificationsTitle: VERIFICATIONS_TITLE,
    artifacts: card.artifacts
      .filter((artifact) => artifact.owner.entity === subject.entity && artifact.owner.id === subject.id)
      .map((artifact) => ({
        key: `${artifact.artifactKind}|${artifact.path}`,
        icon: '◧',
        path: artifact.path,
        note: artifact.location === 'repo' ? `${artifact.artifactKind} · no repo ${artifact.repo ?? '—'}` : `${artifact.artifactKind} · só no disco`,
      })),
    notes: card.notes
      .filter((note) => note.subject.entity === subject.entity && note.subject.id === subject.id)
      .map((note, index) => ({ key: `${note.at}:${index}`, about: note.about, text: note.text })),
    // T-01 do inventário: "não consegui ler" é o ganho da tela nova que este
    // batch preserva — e a inversão exata da issue #35.
    ingestErrors: card.ingestErrors.map((error, index) => ({
      key: `${error.resultPath}:${index}`,
      path: error.resultPath,
      reason: ingestErrorLine(error),
    })),
    ingestErrorNote: INGEST_ERROR_NOTE,
    mirror: mirrorLines(card),
    mirrorTitle: MIRROR_PENDING_TITLE,
    mirrorHint: MIRROR_PENDING_HINT,
    lock: lockView(card),
  };
}

/**
 * O mapa inteiro, a partir do snapshot. `selection` é estado de TELA (o que
 * está em foco em cada eixo); nada aqui é derivado de disco — o snapshot já
 * chega com a macro etapa calculada pelo main (D-13).
 */
export function buildMapView(snapshot: StoreSnapshot | null, selection: MapSelection): EsteiraMapView {
  if (snapshot === null) {
    return { levels: [], focused: { discoveryId: null, planId: null, itemId: null }, detail: null, breadcrumb: [], empty: MAP_EMPTY_NO_STORE };
  }
  if (snapshot.discoveries.length === 0) {
    return { levels: [], focused: { discoveryId: null, planId: null, itemId: null }, detail: null, breadcrumb: [], empty: MAP_EMPTY };
  }

  const discoveryIndex = Math.max(
    0,
    snapshot.discoveries.findIndex((entry) => entry.id === selection.discoveryId),
  );
  const discovery = snapshot.discoveries[discoveryIndex];
  const card = cardView(snapshot, discovery.id);
  if (card === null) {
    return { levels: [], focused: { discoveryId: null, planId: null, itemId: null }, detail: null, breadcrumb: [], empty: MAP_EMPTY };
  }

  const planIndex = Math.max(
    0,
    card.plans.findIndex((plan) => plan.id === selection.planId),
  );
  const plan = card.plans[planIndex] ?? null;

  // Itens do plano em foco MAIS os órfãos: um item sem plano não pode sumir só
  // porque o foco está noutro plano — D-5 manda sinalizar o desvio, não escondê-lo.
  const itens = card.items.filter((item) => (plan !== null && item.planId === plan.id) || item.planId === null);
  const itemIndex = Math.max(
    0,
    itens.findIndex((item) => item.id === selection.itemId),
  );
  const item = itens[itemIndex] ?? null;

  const levels: MapLevel[] = [
    {
      key: 'discovery',
      label: 'Discovery',
      tall: true,
      focusedCardIndex: discoveryIndex,
      focusable: true,
      cards: snapshot.discoveries.map((entry, index) => {
        const view = cardView(snapshot, entry.id);
        return view === null ? null : discoveryCard(view, index === discoveryIndex);
      }).filter((entry): entry is MapCard => entry !== null),
    },
  ];

  if (card.plans.length > 0) {
    levels.push({
      key: 'planos',
      label: 'Planos',
      tall: true,
      focusedCardIndex: planIndex,
      focusable: true,
      cards: card.plans.map((entry, index) => planCard(card, entry.id, index === planIndex)),
    });
  } else {
    levels.push(previewLevel());
  }

  if (itens.length > 0) {
    levels.push({
      key: 'itens',
      label: 'Itens',
      tall: true,
      focusedCardIndex: itemIndex,
      focusable: true,
      cards: itens.map((entry, index) => itemCard(card, entry, index === itemIndex)),
    });
  }

  // O detalhe segue o nó escolhido; sem escolha, o card do discovery em foco —
  // painel vazio com um card na tela seria a tela pedindo um clique para dizer
  // o que ela já sabe.
  const escolhido = parseEntityKey(selection.nodeKey);
  const nodeSubject: EntityId =
    escolhido !== null && subjectExists(card, escolhido) ? escolhido : { entity: 'discovery', id: card.discovery.id };

  return {
    levels,
    focused: { discoveryId: discovery.id, planId: plan?.id ?? null, itemId: item?.id ?? null },
    detail: detailFor(card, nodeSubject, selection.phase),
    breadcrumb: breadcrumbFor(card, nodeSubject),
    empty: null,
  };
}

function subjectExists(card: CardView, subject: EntityId): boolean {
  if (subject.entity === 'discovery') return subject.id === card.discovery.id;
  if (subject.entity === 'plan') return card.plans.some((plan) => plan.id === subject.id);
  return card.items.some((item) => item.id === subject.id);
}

/** Discovery › plano › item — os nós do modelo novo, na ordem em que se navega. */
function breadcrumbFor(card: CardView, subject: EntityId): readonly string[] {
  const trilha = [card.discovery.title];
  if (subject.entity === 'plan') {
    const plan = card.plans.find((entry) => entry.id === subject.id);
    if (plan !== undefined) trilha.push(plan.title);
  }
  if (subject.entity === 'work_item') {
    const item = card.items.find((entry) => entry.id === subject.id);
    if (item !== undefined) {
      const plan = card.plans.find((entry) => entry.id === item.planId);
      if (plan !== undefined) trilha.push(plan.title);
      trilha.push(item.title);
    }
  }
  return trilha;
}

// ---------------------------------------------------------------------------
// B2 — "navegar no mapa alterna para a aba da sessão VIVA do nó". Nó sem
// sessão viva não rouba foco; sessão fechada nunca é alvo (existe o retomar
// explícito do B1 pra isso). O FATO que decide é `SessionSnapshot.endedAt`
// (via `liveSessionOf`, importado); esta função só cruza esse fato com as
// abas abertas — ela não sabe nada de React, `TabState` nem `setActiveTabId`.
// ---------------------------------------------------------------------------

/**
 * O mínimo de uma aba aberta que esta decisão precisa — evita importar
 * `TabState` de `App.tsx`. `undefined` entra ao lado de `null` porque é assim
 * que `TabState.claudeSessionId` chega (aba `shell`, ou `claude` que ainda
 * não teve o id resolvido pelo hook) — os dois significam a mesma coisa aqui:
 * esta aba não é candidata a nenhuma sessão.
 */
export interface LiveSessionTabLookup {
  readonly id: string;
  readonly claudeSessionId?: string | null;
}

/**
 * A aba para onde navegar o mapa até `subject` deveria alternar o foco —
 * `null` quando não há sessão viva OU quando ela não tem aba aberta agora (os
 * dois casos são "não rouba foco", nunca um erro).
 */
export function tabToFocusFor(
  snapshot: StoreSnapshot | null,
  discoveryId: string,
  subject: EntityId,
  tabs: readonly LiveSessionTabLookup[],
): string | null {
  if (snapshot === null) return null;
  const card = cardView(snapshot, discoveryId);
  if (card === null) return null;
  const live = liveSessionOf(card, subject);
  if (live === null || live.cliSessionId === null) return null;
  return tabs.find((tab) => tab.claudeSessionId === live.cliSessionId)?.id ?? null;
}

// ---------------------------------------------------------------------------
// C3 — "o card do item mostra O QUE RODA JUNTO". O contrato não declara
// nenhuma granularidade abaixo do item (nem contagem, nem faixa de task); a
// única fonte real hoje é o `tasks.md` do repo-alvo, quando um artefato
// aponta pra ele (D-8). Esta função só ESCOLHE o artefato — quem lê o disco é
// IPC (main), e quem interpreta o texto é `shared/tasksDoc` (puro, longe do
// componente).
// ---------------------------------------------------------------------------

/**
 * O artefato de `subject` que parece ser a lista de tasks. Sem convenção
 * fixa de `artifactKind` no contrato ainda (achado desta investigação): a
 * heurística aceita tanto `artifactKind === 'tasks'` (quando uma skill vier a
 * declarar isso explicitamente) quanto o caminho terminando em `tasks.md` —
 * hoje, o nome do arquivo é a única convenção que já existe de verdade neste
 * repo (todo `specs/*\/tasks.md` segue o mesmo formato de checklist).
 */
export function tasksArtifactFor(card: CardView, subject: EntityId): ArtifactPointer | null {
  return (
    card.artifacts.find(
      (artifact) =>
        artifact.owner.entity === subject.entity &&
        artifact.owner.id === subject.id &&
        (artifact.artifactKind === 'tasks' || artifact.path.toLowerCase().endsWith('tasks.md')),
    ) ?? null
  );
}

/** A palavra de cada estado de fase, para quem precisa dela fora da frase inteira. */
export { PHASE_STATE_WORD };
