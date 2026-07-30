import { AnnotationTag, Button, Modal, SegmentedControl, Select, TextInput } from '@donel-dev/design-system';
import { useMemo, useState } from 'react';
import type { EntryColumn, EntryColumnCard, ProjectInfo } from '../../../shared';
import type { DiscoveryTree } from '../../../main/discovery-tree';
import type { DevModeDiscoveries } from '../../../shared/devMode';
import { isCardLinked } from './devModeSelection';
import styles from './DevModeEntry.module.css';

// T311 (003-modo-dev, Batch B) — porta de entrada (CA-1/CA-2).
//
// 009-modo-dev-v3, lote 5 — forma trocada de painel sempre visível para
// MODAL "Trocar…" (`design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html`,
// linhas 397-431: overlay 620px, filtro + SegmentedControl na mesma linha,
// lista rolável, nota de rodapé). Quem controla abrir/fechar é `App.tsx`
// (CA-2: card já vinculado traz o discovery ao foco, nunca cria outro — o
// fechamento em si não é forma do mockup, é comportamento decidido aqui).
//
// Só compõe peças do design system (CA-25): `Modal`, `TextInput` (filtro),
// `SegmentedControl` (coluna), `Select` (repo do discovery novo),
// `AnnotationTag` (coluna do card + "já vinculado") e `Button`. Nenhuma peça
// nova — extensões do design system são o lote 6.
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

type ColumnFilter = EntryColumn | 'todas';

export interface DevModeEntryProps {
  /** Controla o overlay (CA-2/D-V3-adjacent — a forma é modal, não painel embutido). */
  open: boolean;
  onClose: () => void;
  cards: readonly EntryColumnCard[];
  discoveries: DevModeDiscoveries;
  trees: readonly DiscoveryTree[];
  projects: readonly ProjectInfo[];
  /** Repo pré-selecionado para um discovery novo (herda a seleção da sidebar, mesmo espírito do Launcher). */
  defaultRepoPath?: string;
  /** Card já vinculado → foca o discovery; card sem vínculo → cria (com o repo escolhido). Quem decide é `resolveEntrySelection` (puro). */
  onSelectCard: (cardId: string, repoPath: string) => void;
  loading: boolean;
}

export function DevModeEntry({
  open,
  onClose,
  cards,
  discoveries,
  trees,
  projects,
  defaultRepoPath,
  onSelectCard,
  loading,
}: DevModeEntryProps): React.JSX.Element | null {
  const [filter, setFilter] = useState('');
  const [column, setColumn] = useState<ColumnFilter>('todas');
  const [repoPath, setRepoPath] = useState(defaultRepoPath ?? projects[0]?.path ?? '');

  const visibleCards = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return cards.filter((card) => {
      if (column !== 'todas' && card.column !== column) return false;
      if (!needle) return true;
      return `${card.cardId} ${card.title}`.toLowerCase().includes(needle);
    });
  }, [cards, column, filter]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Abrir ou trocar discovery" className={styles.dialog}>
      <section className={styles.entry} aria-label="Porta de entrada do Modo Dev" data-testid="devmode-entry">
        <p className={styles.hint}>
          Board único · colunas Backlog, Discovery, Plano, Implementar, Validar e Documentar. Cards concluídos não
          aparecem.
        </p>

        <div className={styles.filterRow}>
          <TextInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtrar por id ou título…"
            aria-label="Filtrar cards"
            className={styles.filterInput}
          />
          <SegmentedControl
            className={styles.columnFilter}
            value={column}
            onChange={(next) => setColumn(next as ColumnFilter)}
            options={[
              { value: 'todas', label: 'Todas' },
              { value: 'backlog', label: COLUMN_LABEL.backlog },
              { value: 'discovery', label: COLUMN_LABEL.discovery },
              { value: 'plano', label: COLUMN_LABEL.plano },
              { value: 'implementar', label: COLUMN_LABEL.implementar },
              { value: 'validar', label: COLUMN_LABEL.validar },
              { value: 'documentar', label: COLUMN_LABEL.documentar },
            ]}
            ariaLabel="Filtrar por coluna"
          />
        </div>

        <Select
          label="Repo do discovery novo"
          value={repoPath}
          onChange={setRepoPath}
          options={projects.map((project) => ({ value: project.path, label: project.name }))}
          placeholder="Selecione um projeto"
        />

        <ul className={styles.list} data-testid="devmode-entry-list">
          {loading ? <li className={styles.empty}>Carregando…</li> : null}
          {!loading && visibleCards.length === 0 ? (
            <li className={styles.empty} data-testid="devmode-entry-empty">
              Nenhum card nas colunas de entrada.
            </li>
          ) : null}
          {visibleCards.map((card) => {
            const linked = isCardLinked(card.cardId, discoveries, trees);
            return (
              <li key={card.cardId} className={styles.row} data-testid={`devmode-entry-card-${card.cardId}`}>
                <Button
                  variant="secondary"
                  onClick={() => onSelectCard(card.cardId, repoPath)}
                  className={styles.rowButton}
                  disabled={!linked && !repoPath}
                  title={card.cardId}
                >
                  {/* Item 10 (rodada de forma fix/009-board-real-e-modal) — título à
                      esquerda, id em mono à direita COM gap (antes vinham
                      grudados: "…(discovery)SZI-900"). */}
                  <span className={styles.cardTitleRow}>
                    <span className={styles.cardTitle}>{card.title}</span>
                    <span className={styles.cardId}>{card.cardId}</span>
                  </span>
                </Button>
                <div className={styles.rowTags}>
                  <AnnotationTag tone="muted">{COLUMN_LABEL[card.column]}</AnnotationTag>
                  {/* CA-2 — "vinculado é foco, não criação": a marca é do card, o
                      comportamento do clique é decidido por `resolveEntrySelection`. */}
                  {linked ? (
                    <AnnotationTag tone="accent">
                      <span data-testid={`devmode-entry-linked-${card.cardId}`}>discovery aberto</span>
                    </AnnotationTag>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <p className={styles.footerNote}>
          Card já vinculado traz o discovery existente para o foco — nunca cria outro. Card de Plano abre o discovery
          pai.
        </p>
      </section>
    </Modal>
  );
}
