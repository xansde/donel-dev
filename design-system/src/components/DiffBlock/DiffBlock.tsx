import { clipLines, DETAIL_MAX_LINES } from '../../lib/clipLines';
import { Button } from '../Button';
import styles from './DiffBlock.module.css';

export type DiffLineKind = 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /**
   * Número da linha no arquivo. Ausente na pendência de permissão: ali o app só
   * tem `old_string`/`new_string`, sem recalcular diff (D-C14).
   */
  number?: number;
}

export interface DiffBlockProps {
  lines: readonly DiffLine[];
  /** Caminho no cabeçalho (mono). */
  path?: string;
  /** Texto do hunk à direita: "@@ −18,9 +18,18 @@". */
  hunk?: string;
  /** Corte padrão: 40 linhas (D-C7). */
  maxLines?: number;
  /** `true` mostra tudo, sem rodapé de corte (depois do "ver tudo"). */
  showAll?: boolean;
  /** Sem `onViewAll` o "ver tudo" não aparece. */
  onViewAll?: () => void;
  /**
   * Altura máxima com rolagem própria (px) — o diff do painel de permissão rola
   * por dentro em vez de cortar.
   */
  maxHeight?: number;
  className?: string;
}

/**
 * Diff com gutter e faixas ± (014-chat, extensão 5): `+` em `--zone-ok` e `−` em
 * coral FIXO (D-C26), faixas a 12%. Cabeçalho de 24 px, rodapé de 22 px com
 * "… mais N linhas alteradas · ver tudo".
 */
export function DiffBlock({
  lines,
  path,
  hunk,
  maxLines = DETAIL_MAX_LINES,
  showAll = false,
  onViewAll,
  maxHeight,
  className,
}: DiffBlockProps) {
  const { visible, hidden } = showAll ? { visible: [...lines], hidden: 0 } : clipLines(lines, maxLines);
  const hasNumbers = visible.some((line) => line.number !== undefined);

  return (
    <div className={[styles.block, className].filter(Boolean).join(' ')}>
      {path || hunk ? (
        <div className={styles.header}>
          {path ? <span className={styles.meta}>{path}</span> : null}
          <span className={styles.spacer} />
          {hunk ? <span className={styles.meta}>{hunk}</span> : null}
        </div>
      ) : null}
      <div className={styles.body} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
        {visible.map((line, index) => (
          <div key={index} className={[styles.line, styles[line.kind]].join(' ')}>
            {hasNumbers ? <span className={styles.number}>{line.number ?? ''}</span> : null}
            <span className={styles.sign} aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
            </span>
            <span className={styles.text}>{line.text}</span>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <div className={styles.footer}>
          <span className={styles.mono}>
            … mais {hidden} {hidden === 1 ? 'linha alterada' : 'linhas alteradas'}
          </span>
          <span className={styles.spacer} />
          {onViewAll ? (
            <Button variant="link" onClick={onViewAll}>
              ver tudo
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
