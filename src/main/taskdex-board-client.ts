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
