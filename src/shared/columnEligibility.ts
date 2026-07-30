import type { EsteiraPhase } from './devMode';

// 009-modo-dev-v3, lote 5 — CA-1: "TaskDex responde 'o que posso disparar
// agora' pela COLUNA do card": Discovery→discovery, Plano→plano,
// Implementar→implementar, Validar→validar, Documentar→documentar. Backlog e
// Concluído não disparam nada. Achado 12 da spec: nenhuma tool de leitura do
// TaskDex expõe labels (o payload real nem traz a chave) — por isso a
// elegibilidade nasce da coluna, nunca de uma etiqueta. Este módulo é PURO
// (sem I/O) e NÃO decide duplo-disparo: esse veto continua em
// `esteira/tools/preflight.py`, do lado da skill — duplicá-lo aqui seria uma
// segunda fonte para o mesmo fato (CA-1 literal, "não duplica o veto").
//
// Coluna fora do mapa (Backlog, Concluído, Validação com Cliente — que o
// CA-1 não lista — ou qualquer string desconhecida) degrada para `null` por
// OMISSÃO: nunca lança, nunca fabrica uma fase.

const COLUMN_PHASE: Readonly<Record<string, EsteiraPhase>> = {
  discovery: 'discovery',
  plano: 'plano',
  implementar: 'implementar',
  validar: 'validar',
  documentar: 'documentar',
};

/**
 * As colunas que disparam alguma fase (CA-1) — fonte única também para a
 * porta de entrada "Trocar…" (CA-2): `taskdex-board-client.ts` soma
 * `'backlog'` a esta lista para formar `EntryColumn`, em vez de duplicar o
 * conjunto de colunas em dois arquivos.
 */
export const DISPATCHABLE_COLUMNS = ['discovery', 'plano', 'implementar', 'validar', 'documentar'] as const;

export type DispatchableColumn = (typeof DISPATCHABLE_COLUMNS)[number];

/** CA-1 — coluna do card → fase disparável, ou `null` (Backlog/Concluído/coluna desconhecida — degradação por omissão, CA-6). */
export function eligiblePhaseForColumn(column: string): EsteiraPhase | null {
  return COLUMN_PHASE[column] ?? null;
}
