import type { DevModeBoardConfig } from '../shared/devMode';

// T309 (003-modo-dev, Batch A) — cliente MÍNIMO de leitura do board (CA-1/
// CA-2): porta de entrada da Zona 1, restrita às colunas Backlog/Discovery/
// Plano de UM board único configurado (`DevModeBoardConfig`).
//
// **Escopo estritamente Fatia 1** — nenhuma outra tool de leitura entra
// aqui; a lista fechada de tools do CA-11 (com token dedicado, superfície de
// rede nova) é Fatia 2 e chega em T324, que ESTENDE este arquivo com a
// implementação de sistema real. Por isso `TaskdexBoardReader` é só um
// contrato injetável aqui — sem `createSystemTaskdexBoardReader` ainda: essa
// é justamente a peça que T324 adiciona (credencial dedicada, C5).

/** Colunas restritas da porta de entrada (CA-1) — cards de outras colunas, inclusive concluídos, não aparecem. */
export type EntryColumn = 'backlog' | 'discovery' | 'plano';

const ENTRY_COLUMNS: readonly EntryColumn[] = ['backlog', 'discovery', 'plano'];

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

/** Injetável (mesmo espírito de `ConfigIoDeps`/`EsteiraReaderIoDeps`) — a implementação de sistema chega em T324 (Fatia 2). */
export interface TaskdexBoardReader {
  fetchBoardCards(boardConfig: DevModeBoardConfig): Promise<readonly TaskdexBoardCard[]>;
}

/**
 * CA-1/CA-2 — lista só os cards das 3 colunas de entrada de UM board
 * configurado. `boardConfig` ausente é a porta de entrada desligada (não
 * erro): nem chama o `reader`. Card de coluna desconhecida é ignorado, nunca
 * lança.
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
// T311 (Batch B) — de onde os cards vêm ENQUANTO a Fatia 2 não chega.
//
// O cliente de sistema real (rede + credencial dedicada + lista fechada de
// tools, CA-11) é a T324, da Fatia 2. Até lá a porta de entrada nasce
// DESLIGADA em produção — lista vazia, nunca um erro na cara do usuário
// (mesma degradação do `boardConfig` ausente logo acima). O único jeito de
// alimentá-la nesta fatia é apontar `DONEL_DEVMODE_BOARD_FIXTURE` para um
// arquivo JSON, que é o que o smoke roteirizado da Fatia 1 faz ("board
// mockado", tasks.md T322) — nenhuma chamada de rede, nenhum token.
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

/** Reader vazio — a Fatia 1 sem fixture: a porta de entrada existe, só não tem fonte ainda (T324). */
const EMPTY_BOARD_READER: TaskdexBoardReader = { fetchBoardCards: async () => [] };

/** Escolhe o leitor a usar a partir do ambiente do processo (main). Sem fixture = leitor vazio. */
export function resolveBoardReader(env: Record<string, string | undefined>, readFileText: ReadFileText): TaskdexBoardReader {
  const fixturePath = env[BOARD_FIXTURE_ENV_VAR];
  if (!fixturePath) return EMPTY_BOARD_READER;
  return createFixtureTaskdexBoardReader(fixturePath, readFileText);
}
