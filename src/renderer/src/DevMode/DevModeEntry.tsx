import { Modal, Select, TextInput } from '@donel-dev/design-system';
import { useMemo, useState } from 'react';
import type { EntryColumn, EntryColumnCard, ProjectInfo } from '../../../shared';
import type { DiscoveryTree } from '../../../main/discovery-tree';
import type { DevModeDiscoveries } from '../../../shared/devMode';
import { isCardLinked, localOnlyDiscoveryIds } from './devModeSelection';
import styles from './DevModeEntry.module.css';

// T311 (003-modo-dev, Batch B) — porta de entrada (CA-1/CA-2).
//
// 009-modo-dev-v3, lote 5 — forma de MODAL ("Trocar…"). Quem controla
// abrir/fechar é `App.tsx` (CA-2: card já vinculado traz o discovery ao foco,
// nunca cria outro).
//
// FORMA ENXUTA (31/07, pedido dele: "pode ser MUITO SIMPLES") — a porta tinha
// 7 blocos disputando 620px (hint de 2 linhas, pills de board, filtro,
// SegmentedControl de 7 colunas, campo "repo do discovery novo" com lista,
// a lista de cards e nota de rodapé) e o conteúdo era cortado na borda
// direita. Agora são TRÊS peças: dropdown de board, busca por nome e a lista
// (nome do card · board · etapa). O que saiu e por quê:
//
// - `SegmentedControl` de coluna → a etapa já vem escrita em cada linha; um
//   controle de 260px para filtrar uma lista curta não se paga (era ele que
//   disputava a largura com a busca).
// - Campo "Repo do discovery novo" → o repo agora é o PROJETO DONO DO BOARD
//   escolhido no dropdown (1:1 com `effectiveBoardConfig`). Escolher o board
//   já responde "onde criar"; não há mais um campo permanente para uma
//   pergunta que só existe quando o card ainda não tem discovery.
// - Pills de board → viraram o dropdown pedido.
// - Hint das colunas e nota de rodapé → texto que o operador já não lê
//   (onda 3 do e2e, "o app explica demais").
//
// A LISTA vem inteira do main (`devMode:listEntryCards` → `listEntryColumnCards`,
// que já aplica `EntryColumn` — CA-1/CA-2) — este componente nunca inventa
// card, nunca consulta o board e nunca escreve nele.

const COLUMN_LABEL: Record<EntryColumn, string> = {
  backlog: 'Backlog',
  discovery: 'Discovery',
  plano: 'Plano',
  implementar: 'Implementar',
  validar: 'Validar',
  documentar: 'Documentar',
};

/** Rótulo do board de um card que só existe no disco (achado F8/#18) — não veio de board nenhum. */
const LOCAL_BOARD_LABEL = 'local';

export interface DevModeEntryProps {
  /** Controla o overlay (CA-2 — a forma é modal, não painel embutido). */
  open: boolean;
  onClose: () => void;
  cards: readonly EntryColumnCard[];
  discoveries: DevModeDiscoveries;
  trees: readonly DiscoveryTree[];
  /** Catálogo completo — só para resolver o NOME do board em foco quando ele não está em `boardProjects`. */
  projects: readonly ProjectInfo[];
  /**
   * Card já vinculado → foca o discovery; card sem vínculo → cria no repo do
   * board escolhido. Quem decide focar × criar é `resolveEntrySelection` (puro).
   */
  onSelectCard: (cardId: string, repoPath: string) => void;
  loading: boolean;
  /**
   * Projetos com board PRÓPRIO (`workspaceId`+`teamId` em `repos.json`) — as
   * opções do dropdown. Sem entidade "board" própria no app (só o par opaco
   * workspaceId/teamId), o NOME DO PROJETO é o rótulo legível do board.
   */
  boardProjects: readonly ProjectInfo[];
  /** Board cujos `cards` estão sendo mostrados agora (repoPath do projeto dono). */
  activeBoardRepoPath?: string;
  /** Troca o board em foco — App.tsx reconsulta `listEntryCards` para ele. */
  onSwitchBoard: (repoPath: string) => void;
}

export function DevModeEntry({
  open,
  onClose,
  cards,
  discoveries,
  trees,
  projects,
  onSelectCard,
  loading,
  boardProjects,
  activeBoardRepoPath,
  onSwitchBoard,
}: DevModeEntryProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');

  const activeBoardLabel = projects.find((project) => project.path === activeBoardRepoPath)?.name ?? '';

  /**
   * Opções do dropdown = boards configurados + o board em foco. A união
   * importa porque o board ativo pode ser o do projeto selecionado
   * globalmente, que talvez use o board GLOBAL de fallback (e por isso não
   * entra em `boardProjects`, que só lista board próprio — fix `b247ad6`).
   */
  const boardOptions = useMemo(() => {
    const byPath = new Map(boardProjects.map((project) => [project.path, project.name]));
    if (activeBoardRepoPath && !byPath.has(activeBoardRepoPath)) {
      byPath.set(activeBoardRepoPath, activeBoardLabel || activeBoardRepoPath);
    }
    return [...byPath.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  }, [boardProjects, activeBoardRepoPath, activeBoardLabel]);

  // FIX (E2E 30/07, achado F8) — discoveries abertos no disco que o board não
  // trouxe (ex.: o `SZI-DEMO` do mock) entram na lista mesmo sem card de
  // board — sem título/coluna fabricados, ver `localOnlyDiscoveryIds`.
  const rows = useMemo(() => {
    const localOnly = new Set(localOnlyDiscoveryIds(cards, discoveries));
    const all = [
      ...cards,
      ...[...localOnly].map((cardId) => ({ cardId, column: 'discovery' as const, title: cardId })),
    ];
    const needle = query.trim().toLowerCase();
    return all
      .filter((card) => (needle ? `${card.title} ${card.cardId}`.toLowerCase().includes(needle) : true))
      .map((card) => ({
        ...card,
        boardLabel: localOnly.has(card.cardId) ? LOCAL_BOARD_LABEL : activeBoardLabel,
        linked: isCardLinked(card.cardId, discoveries, trees),
      }));
  }, [cards, discoveries, trees, query, activeBoardLabel]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Abrir discovery" className={styles.dialog}>
      <section className={styles.entry} aria-label="Porta de entrada do Modo Dev" data-testid="devmode-entry">
        <Select
          label="Board"
          value={activeBoardRepoPath ?? ''}
          options={boardOptions}
          onChange={onSwitchBoard}
          placeholder="Sem board configurado"
          className={styles.board}
        />

        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome…"
          aria-label="Buscar card"
        />

        <ul className={styles.list} data-testid="devmode-entry-list">
          {loading ? <li className={styles.empty}>Carregando…</li> : null}
          {!loading && rows.length === 0 ? (
            <li className={styles.empty} data-testid="devmode-entry-empty">
              Nenhum card para abrir.
            </li>
          ) : null}
          {rows.map((card) => (
            <li key={card.cardId} className={styles.row} data-testid={`devmode-entry-card-${card.cardId}`}>
              {/* O repo do discovery novo é o projeto dono do board escolhido:
                  escolher o board já responde "onde criar" (CA-2 — card já
                  vinculado nem chega a usar isso, é só foco). */}
              <button
                type="button"
                className={styles.rowButton}
                onClick={() => onSelectCard(card.cardId, activeBoardRepoPath ?? '')}
                title={card.cardId}
              >
                <span className={styles.rowTitle}>{card.title}</span>
                <span className={styles.rowMeta}>
                  {card.boardLabel ? `${card.boardLabel} · ` : ''}
                  {COLUMN_LABEL[card.column]}
                  {/* CA-2 — "vinculado é foco, não criação": a marca é do card;
                      quem decide o clique é `resolveEntrySelection`. */}
                  {card.linked ? (
                    <>
                      {' · '}
                      <span className={styles.rowOpen} data-testid={`devmode-entry-linked-${card.cardId}`}>
                        aberto
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}
