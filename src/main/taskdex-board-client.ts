import { join } from 'node:path';
import type { DevModeBoardConfig } from '../shared/devMode';
import { DISPATCHABLE_COLUMNS, type DispatchableColumn } from '../shared/columnEligibility';

// T309 (003-modo-dev, Batch A) — cliente de leitura do board (CA-1/CA-2):
// porta de entrada da Zona 1 de UM board único configurado
// (`DevModeBoardConfig`). `TaskdexBoardReader` é o contrato injetável;
// `createSystemTaskdexBoardReader` (mais abaixo, T324/reintegrado em 29/07 —
// era o transporte real que faltava desde então) é a implementação de
// sistema, com credencial dedicada e lista fechada de tools de leitura
// (CA-11).
//
// 009-modo-dev-v3, lote 5 (CA-2) — a porta de entrada deixou de ficar restrita
// às 3 colunas da v2 (Backlog/Discovery/Plano): "um card em Implementar é
// justamente o que pode rodar a fase seguinte". `EntryColumn` agora é
// `'backlog'` + as colunas disparáveis do CA-1 (`DISPATCHABLE_COLUMNS`, fonte
// única em `columnEligibility.ts` — nenhuma segunda lista a manter em sincronia).
// Concluído e Validação com Cliente continuam FORA: nada dispara a partir
// delas (CA-1), e nada aqui duplica a elegibilidade — este arquivo só decide
// QUEM aparece na lista, `columnEligibility.ts` decide o QUE cada um dispara.

/** Colunas da porta de entrada (CA-1/CA-2) — cards de outras colunas (Concluído, Validação com Cliente, coluna desconhecida) não aparecem. */
export type EntryColumn = 'backlog' | DispatchableColumn;

const ENTRY_COLUMNS: readonly EntryColumn[] = ['backlog', ...DISPATCHABLE_COLUMNS];

function isEntryColumn(column: string): column is EntryColumn {
  return (ENTRY_COLUMNS as readonly string[]).includes(column);
}

/** Shape cru devolvido pelo board (nome da coluna como string livre — validado por `isEntryColumn`). */
export interface TaskdexBoardCard {
  readonly cardId: string;
  readonly column: string;
  readonly title: string;
}

export interface EntryColumnCard {
  readonly cardId: string;
  readonly column: EntryColumn;
  readonly title: string;
}

/** Injetável (mesmo espírito de `ConfigIoDeps`/`EsteiraReaderIoDeps`) — a implementação de sistema é `createSystemTaskdexBoardReader`, mais abaixo. */
export interface TaskdexBoardReader {
  fetchBoardCards(boardConfig: DevModeBoardConfig): Promise<readonly TaskdexBoardCard[]>;
}

/**
 * CA-1/CA-2 — lista só os cards das colunas de entrada (`ENTRY_COLUMNS`) de
 * UM board configurado. `boardConfig` ausente é a porta de entrada desligada
 * (não erro): nem chama o `reader`. Card de coluna desconhecida (inclusive
 * Concluído e Validação com Cliente) é ignorado, nunca lança.
 */
export async function listEntryColumnCards(
  boardConfig: DevModeBoardConfig | null,
  reader: TaskdexBoardReader,
): Promise<readonly EntryColumnCard[]> {
  if (!boardConfig) return [];

  const cards = await reader.fetchBoardCards(boardConfig);
  return cards
    .filter((card): card is TaskdexBoardCard & { column: EntryColumn } => isEntryColumn(card.column))
    .map((card) => ({ cardId: card.cardId, column: card.column, title: card.title }));
}

// ---------------------------------------------------------------------------
// T311 (Batch B) — o leitor de FIXTURE, usado pelo roteiro de teste manual e
// pelos smokes ("board mockado", tasks.md T322): aponta `DONEL_DEVMODE_BOARD_FIXTURE`
// para um arquivo JSON, sem chamada de rede nem token. Continua tendo
// precedência sobre o board real (`resolveBoardReader`, mais abaixo) mesmo
// depois de `createSystemTaskdexBoardReader` existir — nenhum teste deve
// falar com o board de verdade.
// ---------------------------------------------------------------------------

/** Nome da variável de ambiente que aponta o board mockado do smoke (nunca usada em produção). */
export const BOARD_FIXTURE_ENV_VAR = 'DONEL_DEVMODE_BOARD_FIXTURE';

/** `null` = ausente/ilegível (mesmo contrato de `EsteiraReaderIoDeps.readFileText`). */
export type ReadFileText = (path: string) => string | null;

function toBoardCard(raw: unknown): TaskdexBoardCard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<TaskdexBoardCard>;
  if (typeof candidate.cardId !== 'string' || !candidate.cardId) return null;
  if (typeof candidate.column !== 'string' || !candidate.column) return null;
  return { cardId: candidate.cardId, column: candidate.column, title: typeof candidate.title === 'string' ? candidate.title : '' };
}

/** Leitor de fixture: aceita `[...]` ou `{ cards: [...] }`. Nunca lança — arquivo ausente/corrompido vira `[]`. */
export function createFixtureTaskdexBoardReader(fixturePath: string, readFileText: ReadFileText): TaskdexBoardReader {
  return {
    fetchBoardCards: async (): Promise<readonly TaskdexBoardCard[]> => {
      const text = readFileText(fixturePath);
      if (text === null) return [];

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return [];
      }

      const rawCards = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { cards?: unknown }).cards)
          ? ((parsed as { cards: unknown[] }).cards)
          : [];

      return rawCards.map(toBoardCard).filter((card): card is TaskdexBoardCard => card !== null);
    },
  };
}

/** Reader vazio — sem fixture e sem credencial (`callTool`): a porta de entrada existe, mas não tem fonte para quem não configurou nada. */
const EMPTY_BOARD_READER: TaskdexBoardReader = { fetchBoardCards: async () => [] };

/**
 * Escolhe a fonte da porta de entrada, nesta ordem:
 *   1. **fixture** (`DONEL_DEVMODE_BOARD_FIXTURE`) — o roteiro de teste manual
 *      e os smokes nunca devem falar com o board de verdade;
 *   2. **board real**, quando o usuário tem credencial (`callTool`);
 *   3. **vazio** — quem não configurou nada segue exatamente como antes.
 */
export function resolveBoardReader(
  env: Record<string, string | undefined>,
  readFileText: ReadFileText,
  callTool?: CallBoardReadTool | null,
): TaskdexBoardReader {
  const fixturePath = env[BOARD_FIXTURE_ENV_VAR];
  if (fixturePath) return createFixtureTaskdexBoardReader(fixturePath, readFileText);
  if (callTool) return createSystemTaskdexBoardReader(callTool);
  return EMPTY_BOARD_READER;
}

// ---------------------------------------------------------------------------
// T324 (003-modo-dev, Batch C) — cliente de leitura REAL do board (CA-11):
// credencial de serviço DEDICADA (fora do repo, mesmo padrão de
// `~/.claude/esteira-config/` — nunca em log nem versionada), restrita a uma
// LISTA FECHADA de tools de leitura. A lista é o próprio TIPO do parâmetro
// (`BoardReadTool`, união de literais) — não uma allowlist checada em
// runtime: chamar com uma tool fora da união falha em `npm run typecheck`,
// nunca em produção. Nenhuma tool de escrita entra neste arquivo (garantia
// estrutural, CA-11).
// ---------------------------------------------------------------------------

/**
 * Lista fechada de tools de leitura do MCP TaskDex usadas pelo espelho
 * (CA-11/CA-12). Cresce por PR (mais um literal na união), nunca por
 * allowlist de runtime que alguém possa esquecer de checar. `get_task_details`
 * devolve, num payload só, os fatos do CA-12 do card; `list_tasks_by_team` é
 * a fonte da porta de entrada (CA-1). Nenhuma tool de escrita é representável
 * aqui — a garantia é o TIPO, checada em `npm run typecheck`.
 */
export type BoardReadTool = 'get_task_details' | 'list_tasks_by_team' | 'list_labels' | 'search_tasks';

/**
 * Assinatura restrita ao `BoardReadTool` — nem o fake de teste nem a
 * implementação real aceitam `string` solto. Os `params` usam o vocabulário
 * do APP (`cardId`, `teamId`, `workspaceId`); traduzir para os nomes da API é
 * responsabilidade do transporte (`taskdex-mcp-transport.ts`), não daqui.
 */
export type CallBoardReadTool = (
  tool: BoardReadTool,
  params: Readonly<Record<string, string | readonly string[]>>,
) => Promise<unknown>;

/**
 * Credencial de cada usuário (decisão de 2026-07-28: "cada um deverá ter as
 * suas configurações") — carregada de fora do repo, nunca versionada, nunca
 * logada. `workspaceId`/`teamId` são opcionais: quando presentes, dizem QUAL
 * board aquela pessoa vê, sem depender de nenhuma tela de configuração.
 */
export interface TaskdexServiceCredential {
  readonly token: string;
  readonly baseUrl: string;
  readonly workspaceId?: string;
  readonly teamId?: string;
}

/** O board declarado na credencial do usuário — `null` quando ela só traz auth. */
export function boardConfigFromCredential(credential: TaskdexServiceCredential | null): DevModeBoardConfig | null {
  if (!credential?.workspaceId || !credential.teamId) return null;
  return { workspaceId: credential.workspaceId, teamId: credential.teamId };
}

/** Os 4 fatos do CA-12 já mapeados, mais o título cru (usado pela conferência `[Mx]` do CA-14 em `boardAnnotation.ts`). */
export interface BoardFacts {
  readonly column: string;
  readonly title: string;
  /** `esteira:em-andamento:<fase>` do board, já sem o prefixo — `null` = sem trava (CA-13/D1). */
  readonly lockedPhase: string | null;
  /** Subconjunto presente entre `esteira:escalado`/`esteira:precisa-atencao` (CA-12). */
  readonly attentionLabels: readonly string[];
  readonly prUrl: string | null;
  readonly prApproved: boolean;
}

export interface BoardFactsReader {
  fetchBoardFacts(cardId: string): Promise<BoardFacts | null>;
}

const LOCK_LABEL_PREFIX = 'esteira:em-andamento:';
const ATTENTION_LABELS = ['esteira:escalado', 'esteira:precisa-atencao'] as const;

function lockedPhaseFromLabels(labels: readonly string[]): string | null {
  const lockLabel = labels.find((label) => label.startsWith(LOCK_LABEL_PREFIX));
  return lockLabel ? lockLabel.slice(LOCK_LABEL_PREFIX.length) : null;
}

function attentionLabelsFrom(labels: readonly string[]): readonly string[] {
  return ATTENTION_LABELS.filter((known) => labels.includes(known));
}

/**
 * Nome de coluna do board → chave interna do app. O board real devolve
 * "Backlog"/"Discovery"/"Plano"/"Concluído" (capitalizado e acentuado), e o
 * app compara com `'backlog' | 'discovery' | 'plano'` e com as fases da
 * Esteira. Sem essa normalização, TODO card real cairia fora do filtro do
 * CA-1 e a porta de entrada mostraria uma lista vazia com o board cheio.
 */
export function normalizeColumnName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Coluna vem como `{name}` no payload real e como string na fixture — os dois formatos entram. */
function columnNameFrom(value: unknown): string | null {
  if (typeof value === 'string' && value) return normalizeColumnName(value);
  if (typeof value === 'object' && value !== null) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string' && name) return normalizeColumnName(name);
  }
  return null;
}

/**
 * PR do card. Formato real: `prLinks: [{prUrl, prStatus}]` (uma lista, do
 * TaskDex). Formato da fixture/T324: `pullRequest: {url, approved}`.
 * **`merged` NÃO é tratado como aprovado** — o gate de Done pede aprovação
 * registrada, e inferir isso de "mergeado" seria afirmar um fato que o board
 * não deu.
 */
function pullRequestFrom(raw: { pullRequest?: unknown; prLinks?: unknown }): { url: string | null; approved: boolean } {
  const legacy = raw.pullRequest as { url?: unknown; approved?: unknown } | null | undefined;
  if (legacy && typeof legacy === 'object') {
    const url = typeof legacy.url === 'string' && legacy.url ? legacy.url : null;
    return { url, approved: typeof legacy.approved === 'boolean' && legacy.approved };
  }

  const links = Array.isArray(raw.prLinks) ? raw.prLinks : [];
  const link = links.find(
    (entry): entry is { prUrl?: unknown; prStatus?: unknown } => typeof entry === 'object' && entry !== null,
  );
  if (!link) return { url: null, approved: false };

  const url = typeof link.prUrl === 'string' && link.prUrl ? link.prUrl : null;
  const status = typeof link.prStatus === 'string' ? link.prStatus.toLowerCase() : '';
  return { url, approved: status === 'approved' };
}

/**
 * Shape cru da resposta de `get_task_details` — validado campo a campo, nunca
 * lançado (degrada para `null`).
 *
 * **Sobre `labels`:** nenhuma tool de leitura do TaskDex expõe as labels do
 * card hoje (medido contra o servidor em 28/07 — o payload real nem traz a
 * chave). Sem fonte, `lockedPhase` fica `null` e `attentionLabels` fica
 * vazio: o espelho mostra menos, e não inventa uma trava que não viu. O
 * formato com `labels` continua sendo lido porque a fixture o usa.
 */
function toBoardFacts(raw: unknown): BoardFacts | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { column?: unknown; title?: unknown; labels?: unknown; prLinks?: unknown; pullRequest?: unknown };

  const column = columnNameFrom(candidate.column);
  if (!column) return null;

  const labels = Array.isArray(candidate.labels) ? candidate.labels.filter((l): l is string => typeof l === 'string') : [];
  const pr = pullRequestFrom(candidate);

  return {
    column,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    lockedPhase: lockedPhaseFromLabels(labels),
    attentionLabels: attentionLabelsFrom(labels),
    prUrl: pr.url,
    prApproved: pr.approved,
  };
}

/** Shape cru de `list_tasks_by_team` — `{tasks: [{id, title, column: {name}}]}`. Item inválido é ignorado, nunca lança. */
function toBoardCardsFromTaskdex(raw: unknown): readonly TaskdexBoardCard[] {
  const tasks = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { tasks?: unknown }).tasks)
      ? (raw as { tasks: unknown[] }).tasks
      : [];

  return tasks
    .map((entry): TaskdexBoardCard | null => {
      if (typeof entry !== 'object' || entry === null) return null;
      const task = entry as { id?: unknown; title?: unknown; column?: unknown };
      if (typeof task.id !== 'string' || !task.id) return null;

      const column = columnNameFrom(task.column);
      if (!column) return null;

      return { cardId: task.id, column, title: typeof task.title === 'string' ? task.title : '' };
    })
    .filter((card): card is TaskdexBoardCard => card !== null);
}

/**
 * Reader de sistema (CA-11) — a chamada de rede/MCP em si é INJETADA
 * (`callTool`), nunca hardcoded aqui: quem monta o `callTool` real (fora do
 * escopo desta task) é quem sabe autenticar com a credencial dedicada. Este
 * módulo não loga nada — nem o payload, nem erro de chamada — então o token
 * nunca pode vazar por aqui (ele nem chega a este arquivo: mora em quem
 * implementa `callTool`).
 */
export function createSystemBoardFactsReader(
  callTool: CallBoardReadTool,
  boardConfig?: DevModeBoardConfig | null,
): BoardFactsReader {
  return {
    fetchBoardFacts: async (cardId: string): Promise<BoardFacts | null> => {
      if (!cardId) return null;
      const params: Record<string, string> = { cardId };
      if (boardConfig?.workspaceId) params.workspaceId = boardConfig.workspaceId;
      const raw = await callTool('get_task_details', params);
      return toBoardFacts(raw);
    },
  };
}

export interface BoardLocksReader {
  /** Uma varredura do board inteiro — nunca por card (o filtro do TaskDex é por etiqueta, não por task). */
  fetchLockedPhases(): Promise<LockedPhasesByCard>;
}

/** Fase travada por card (`cardId` → fase, sem o prefixo `esteira:em-andamento:`). Card ausente = sem trava. */
export type LockedPhasesByCard = Readonly<Record<string, string>>;

/**
 * Sobrepõe a trava lida por ETIQUETA nos fatos lidos card a card — a trava é
 * o único dos 4 fatos do CA-12 que `get_task_details` não devolve. Card sem
 * trava fica exatamente como estava (nunca apaga o que o card já dizia).
 */
export function mergeLockedPhases(
  facts: Readonly<Record<string, BoardFacts>>,
  locks: LockedPhasesByCard,
): Record<string, BoardFacts> {
  const merged: Record<string, BoardFacts> = {};
  for (const [cardId, card] of Object.entries(facts)) {
    const lockedPhase = locks[cardId];
    merged[cardId] = lockedPhase ? { ...card, lockedPhase } : card;
  }
  return merged;
}

/** Sem credencial/board não há varredura possível — "nenhuma trava" é a degradação, igual à falha de rede (C4). */
export const EMPTY_BOARD_LOCKS_READER: BoardLocksReader = { fetchLockedPhases: async () => ({}) };


/** `list_labels` devolve `[{id, name}]`; só interessam as etiquetas de trava, já com a fase extraída. */
function lockLabelsFrom(raw: unknown): readonly { id: string; phase: string }[] {
  const entries = Array.isArray(raw) ? raw : [];
  return entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const label = entry as { id?: unknown; name?: unknown };
    if (typeof label.id !== 'string' || typeof label.name !== 'string') return [];
    if (!label.name.startsWith(LOCK_LABEL_PREFIX)) return [];
    const phase = label.name.slice(LOCK_LABEL_PREFIX.length);
    return phase ? [{ id: label.id, phase }] : [];
  });
}

/** `search_tasks` devolve `{tasks: [{id, …}]}` — aqui só o `id` importa. */
function cardIdsFrom(raw: unknown): readonly string[] {
  const tasks =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { tasks?: unknown }).tasks)
      ? (raw as { tasks: unknown[] }).tasks
      : Array.isArray(raw)
        ? raw
        : [];
  return tasks.flatMap((task) =>
    typeof task === 'object' && task !== null && typeof (task as { id?: unknown }).id === 'string'
      ? [(task as { id: string }).id]
      : [],
  );
}

/**
 * CA-12/D1 — de onde vem "esta fase TRAVOU". A trava é **etiqueta do board**
 * (`esteira:em-andamento:<fase>`), nunca arquivo `.lock`; e `get_task_details`
 * não devolve as labels do card (medido contra o servidor em 28/07 e de novo
 * em 31/07 — o payload não tem a chave). A leitura então é INVERTIDA:
 * `list_labels` acha as etiquetas de trava do board e `search_tasks` filtra
 * quais cards estão em cada uma — uma varredura do board, não N consultas
 * por card.
 *
 * Sem isto, uma fase que rodou e não arquivou aparecia como "não iniciada"
 * (o leitor do modelo antigo exigia o manifesto do `fase_num` para crer que a fase
 * rodou) e o operador perdia o botão de liberar.
 *
 * Falha de rede degrada para "nenhuma trava" (C4): o espelho mostra menos,
 * nunca inventa uma trava que não viu.
 */
export function createSystemBoardLocksReader(
  callTool: CallBoardReadTool,
  boardConfig: DevModeBoardConfig,
): BoardLocksReader {
  return {
    fetchLockedPhases: async (): Promise<LockedPhasesByCard> => {
      try {
        const labels = lockLabelsFrom(
          await callTool('list_labels', { teamId: boardConfig.teamId, workspaceId: boardConfig.workspaceId }),
        );
        if (labels.length === 0) return {};

        const perLabel = await Promise.all(
          labels.map(async (label) => ({
            phase: label.phase,
            // `query` vazia + `labelIds` = "todos os cards com esta etiqueta"
            // (o filtro por etiqueta é o que seleciona; a busca textual não
            // restringe nada quando vazia).
            cardIds: cardIdsFrom(
              await callTool('search_tasks', {
                query: '',
                labelIds: [label.id],
                workspaceId: boardConfig.workspaceId,
              }),
            ),
          })),
        );

        const locked: Record<string, string> = {};
        for (const { phase, cardIds } of perLabel) {
          for (const cardId of cardIds) locked[cardId] = phase;
        }
        return locked;
      } catch {
        return {};
      }
    },
  };
}

/**
 * Porta de entrada com fonte REAL (CA-1) — a contraparte de
 * `createFixtureTaskdexBoardReader`. Falha de rede/protocolo vira lista vazia
 * aqui mesmo: `listEntryColumnCards` roda dentro de um handler IPC, e uma
 * exceção atravessando o canal viraria erro na cara do usuário em vez da
 * degradação combinada (C4). Nada é logado — o token vive no transporte.
 */
export function createSystemTaskdexBoardReader(callTool: CallBoardReadTool): TaskdexBoardReader {
  return {
    fetchBoardCards: async (boardConfig: DevModeBoardConfig): Promise<readonly TaskdexBoardCard[]> => {
      try {
        const raw = await callTool('list_tasks_by_team', {
          teamId: boardConfig.teamId,
          workspaceId: boardConfig.workspaceId,
        });
        return toBoardCardsFromTaskdex(raw);
      } catch {
        return [];
      }
    },
  };
}

// ---------------------------------------------------------------------------
// T327 (003-modo-dev, Batch D) — a FONTE dos 4 fatos que chega até a UI.
//
// Duas fontes, mesma ordem de precedência de `resolveBoardReader`: o mesmo
// arquivo de fixture da porta de entrada (`DONEL_DEVMODE_BOARD_FIXTURE`, com
// uma chave `facts`) tem precedência sobre `createSystemBoardFactsReader`
// (board real via `callTool`). Sem fixture e sem credencial, o espelho fica
// sem fonte — `null` por card, exatamente a mesma degradação de `boardConfig`
// ausente (C4): a árvore continua inteira, só não recebe anotação. Nunca um
// erro na cara do usuário, e **nenhuma escrita** em lugar nenhum (invariante 5).
// ---------------------------------------------------------------------------

/** Leitor de fatos por fixture: reusa `toBoardFacts`, o MESMO mapeamento do reader de sistema — o teste exercita produção, não um atalho. */
export function createFixtureBoardFactsReader(fixturePath: string, readFileText: ReadFileText): BoardFactsReader {
  return {
    fetchBoardFacts: async (cardId: string): Promise<BoardFacts | null> => {
      const text = readFileText(fixturePath);
      if (text === null) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }

      if (typeof parsed !== 'object' || parsed === null) return null;
      const facts = (parsed as { facts?: unknown }).facts;
      if (typeof facts !== 'object' || facts === null) return null;

      return toBoardFacts((facts as Record<string, unknown>)[cardId]);
    },
  };
}

/** Espelho sem fonte — a Fatia 2 sem fixture e sem `callTool` real: nenhum fato, nenhum erro. */
const EMPTY_BOARD_FACTS_READER: BoardFactsReader = { fetchBoardFacts: async () => null };

/** Mesma ordem de precedência de `resolveBoardReader`: fixture → board real do usuário → sem fonte. */
export function resolveBoardFactsReader(
  env: Record<string, string | undefined>,
  readFileText: ReadFileText,
  callTool?: CallBoardReadTool | null,
  boardConfig?: DevModeBoardConfig | null,
): BoardFactsReader {
  const fixturePath = env[BOARD_FIXTURE_ENV_VAR];
  if (fixturePath) return createFixtureBoardFactsReader(fixturePath, readFileText);
  if (callTool) return createSystemBoardFactsReader(callTool, boardConfig);
  return EMPTY_BOARD_FACTS_READER;
}

/**
 * CA-12 — os fatos dos cards do discovery EM FOCO, e só deles: a consulta é
 * card a card, a partir da lista que o renderer manda, nunca uma varredura do
 * board. Card sem fato (ou consulta que falha) simplesmente não entra no mapa
 * — o espelho degrada por omissão, nunca lança nem loga (o token vive em quem
 * implementa `callTool`, e nada aqui escreve em log).
 */
export async function readBoardFactsFor(
  cardIds: readonly string[],
  reader: BoardFactsReader,
): Promise<Record<string, BoardFacts>> {
  const unique = [...new Set(cardIds.map((cardId) => cardId.trim()).filter((cardId) => cardId.length > 0))];
  const facts: Record<string, BoardFacts> = {};

  for (const cardId of unique) {
    try {
      const card = await reader.fetchBoardFacts(cardId);
      if (card) facts[cardId] = card;
    } catch {
      // Board indisponível para ESTE card: some do mapa. Um espelho que
      // derruba a árvore quando a rede oscila seria pior que um sem anotação.
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Credencial de serviço dedicada — fora do repo, nunca versionada, nunca logada.
// ---------------------------------------------------------------------------

export interface TaskdexCredentialIoDeps {
  readonly readFileText: ReadFileText;
  readonly homedir: () => string;
}

/** Mesmo diretório de `~/.claude/esteira-config/` (spec.md) — arquivo dedicado deste app, nunca commitado. */
export function taskdexCredentialPath(homedirFn: () => string): string {
  return join(homedirFn(), '.claude', 'esteira-config', 'donel-board-credential.json');
}

function toCredential(raw: unknown): TaskdexServiceCredential | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<TaskdexServiceCredential>;
  if (typeof candidate.token !== 'string' || !candidate.token) return null;
  if (typeof candidate.baseUrl !== 'string' || !candidate.baseUrl) return null;

  // `workspaceId`/`teamId` são opcionais: sem eles a credencial autentica mas
  // não diz QUAL board — o app cai no `boardConfig` do próprio config.json.
  const workspaceId = typeof candidate.workspaceId === 'string' && candidate.workspaceId ? candidate.workspaceId : undefined;
  const teamId = typeof candidate.teamId === 'string' && candidate.teamId ? candidate.teamId : undefined;

  return {
    token: candidate.token,
    baseUrl: candidate.baseUrl,
    ...(workspaceId ? { workspaceId } : {}),
    ...(teamId ? { teamId } : {}),
  };
}

/**
 * `null` = ausente/ilegível/incompleta — o espelho fica sem fonte de fatos
 * (mesma degradação de `boardConfig` ausente, C4): nunca lança, e nunca loga
 * o conteúdo do arquivo (só campos booleanos de sucesso/falha em quem chama).
 */
export function loadTaskdexServiceCredential(io: TaskdexCredentialIoDeps): TaskdexServiceCredential | null {
  const text = io.readFileText(taskdexCredentialPath(io.homedir));
  if (text === null) return null;

  try {
    return toCredential(JSON.parse(text));
  } catch {
    return null;
  }
}
