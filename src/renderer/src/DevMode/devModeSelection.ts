import type { DiscoveryTree } from '../../../main/discovery-tree';
import type { CardRepoResolution, EntryColumn } from '../../../shared';
import { eligiblePhaseForColumn } from '../../../shared/columnEligibility';
import type { DevModeDiscoveries, EsteiraPhase } from '../../../shared/devMode';

// T311/T321 (003-modo-dev, Batch B) — decisões PURAS da porta de entrada
// (CA-2) e do encerramento automático (CA-23). Sem React e sem IPC: só o
// cruzamento entre os cards do board, os discoveries abertos (estado próprio,
// CA-21) e as árvores lidas do disco.
//
// CA-14/CA-17 (009-modo-dev-v3) respeitado: o vínculo card-de-plano →
// discovery vem de `plan_cards[]` (disco), NUNCA do prefixo `[Mx]` do título
// do card no board (morto na v3).

export type EntrySelection =
  | { readonly kind: 'focus'; readonly discoveryCardId: string }
  | { readonly kind: 'create'; readonly cardId: string };

export interface EntrySelectionInput {
  readonly cardId: string;
  readonly discoveries: DevModeDiscoveries;
  readonly trees: readonly DiscoveryTree[];
}

/** Um discovery só conta como "aberto" enquanto não encerrou (CA-23). */
function isOpen(discoveries: DevModeDiscoveries, cardId: string): boolean {
  const discovery = discoveries[cardId];
  return !!discovery && discovery.closedAt === null;
}

/** Discovery-pai de um card de PLANO, por `plan_cards[]` do disco — `null` se o card não é card de plano de nenhum discovery aberto. */
function parentDiscoveryOf(cardId: string, discoveries: DevModeDiscoveries, trees: readonly DiscoveryTree[]): string | null {
  for (const tree of trees) {
    if (!isOpen(discoveries, tree.discoveryCardId)) continue;
    if (tree.planCards.some((planCard) => planCard.cardId === cardId)) return tree.discoveryCardId;
  }
  return null;
}

/**
 * CA-2 — "vinculado é foco, não criação": card com discovery aberto traz
 * aquele discovery ao foco; card de **Plano** abre o discovery **pai**; card
 * sem vínculo nenhum vira criação (que dispara o fluxo do CA-3).
 */
export function resolveEntrySelection(input: EntrySelectionInput): EntrySelection {
  if (isOpen(input.discoveries, input.cardId)) return { kind: 'focus', discoveryCardId: input.cardId };

  const parent = parentDiscoveryOf(input.cardId, input.discoveries, input.trees);
  if (parent) return { kind: 'focus', discoveryCardId: parent };

  return { kind: 'create', cardId: input.cardId };
}

/**
 * CA-1 — a **coluna** do card responde qual fase o clique dispara
 * (`Plano→plano`, `Implementar→implementar`, `Validar→validar`,
 * `Documentar→documentar`). Backlog e Discovery começam pelo discovery: num
 * card ainda não trabalhado é a única fase que faz sentido.
 *
 * FIX (e2e 31/07) — sem isto, TODO card sem discovery vinculado virava
 * `/esteira-discovery`: escolher um card que já estava em Validar jogava o
 * operador de volta para o começo da esteira.
 */
export function entryPhaseForColumn(column: EntryColumn): EsteiraPhase {
  // `eligiblePhaseForColumn` é a fonte única do mapa coluna→fase
  // (`columnEligibility.ts`); aqui só se decide o que fazer com o `null` dela:
  // na porta de entrada, coluna que não dispara nada significa "começa pelo
  // discovery" — é o único destino honesto para um card ainda não trabalhado.
  return eligiblePhaseForColumn(column) ?? 'discovery';
}

/** CA-2 — o card vinculado aparece MARCADO na lista de candidatos (card de entrada ou card de plano). */
export function isCardLinked(cardId: string, discoveries: DevModeDiscoveries, trees: readonly DiscoveryTree[]): boolean {
  if (isOpen(discoveries, cardId)) return true;
  return parentDiscoveryOf(cardId, discoveries, trees) !== null;
}

/**
 * FIX (E2E 30/07, achado F8) — o modal "Abrir ou trocar discovery" só
 * listava cards vindos do BOARD (`listEntryColumnCards`). Um discovery já
 * aberto no disco (`~/.claude/esteira-state/<slug>/<card_id>/`) e registrado
 * no estado próprio do app (`config.json` → `discoveries`, CA-21) — como o
 * `SZI-DEMO` do mock, ou qualquer card que o board não trouxe nesta consulta
 * — não aparecia nem MARCADO nem ao menos LISTADO: sem porta de volta depois
 * de trocar o foco. `cardId` já vinculado a um discovery aberto entra na
 * lista mesmo sem card de board — nunca fabrica coluna/título de fonte que
 * não tem (`column: 'discovery'` é o fato mínimo verdadeiro: discovery É
 * sempre a fase que abre um card; título degrada por omissão pro próprio
 * `cardId`, igual `planCardTitle` faz no resto do app quando falta
 * `boardFacts?.title`).
 */
export function localOnlyDiscoveryIds(cards: readonly { readonly cardId: string }[], discoveries: DevModeDiscoveries): readonly string[] {
  const knownIds = new Set(cards.map((card) => card.cardId));
  return Object.keys(discoveries).filter((cardId) => isOpen(discoveries, cardId) && !knownIds.has(cardId));
}

/**
 * CA-23 — discoveries que devem encerrar sozinhos: `allPlanCardsComplete` é
 * fato verificável do disco (gate de `esteira-concluir` de cada card de
 * plano), não opinião do app. Já encerrado nunca reaparece aqui (evita IPC
 * repetido).
 */
export function discoveriesToClose(trees: readonly DiscoveryTree[], discoveries: DevModeDiscoveries): readonly string[] {
  return trees
    .filter((tree) => tree.allPlanCardsComplete && isOpen(discoveries, tree.discoveryCardId))
    .map((tree) => tree.discoveryCardId);
}

/** Issue #38 — "nunca afirmar um repo errado com cara de fato": rótulo honesto para quando o rastro em disco não resolve sozinho. */
export const REPO_LABEL_TBD = 'repo a definir';

/** Um par `path`/`name` já basta pra achar o nome legível de um repo resolvido — `ProjectInfo` inteiro seria mais do que a função precisa. */
export interface RepoNameLookup {
  readonly path: string;
  readonly name: string;
}

/**
 * CA-1/#38 — rótulo de repo de UMA linha da lista, a partir da resolução em
 * lote (`devMode:resolveCardRepos`, rastro em disco — issue #34). Sem
 * resolução ainda (fetch em voo) ou resolução ambígua/desconhecida: nunca um
 * palpite, sempre `REPO_LABEL_TBD` — era exatamente essa mentira ("spotsys"
 * pra um card do `dalton`, só porque os dois compartilham board) que a issue
 * relatou.
 */
export function cardRepoLabel(resolution: CardRepoResolution | undefined, projects: readonly RepoNameLookup[]): string {
  if (!resolution || resolution.kind !== 'resolved') return REPO_LABEL_TBD;
  const project = projects.find((candidate) => candidate.path === resolution.repoPath);
  return project?.name ?? resolution.repoSlug;
}
