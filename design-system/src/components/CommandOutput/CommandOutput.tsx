import { Copy } from 'lucide-react';
import { clipLines, clipOutputText, DETAIL_MAX_BYTES, DETAIL_MAX_LINES, formatHiddenLines } from '../../lib/clipLines';
import { Button } from '../Button';
import styles from './CommandOutput.module.css';

export interface CommandOutputLine {
  text: string;
  /** `error` = coral fixo (falhou); `muted` = apoio. */
  tone?: 'error' | 'muted';
}

export interface CommandOutputProps {
  /** Cabeçalho à esquerda em mono: "$ npm test", "bruto · progress"… */
  title: string;
  /**
   * Saída como texto — cortada em 40 linhas / 8 KB (`conversation-rows.md` §4).
   * Use `lines` quando precisar colorir linhas.
   */
  text?: string;
  lines?: ReadonlyArray<string | CommandOutputLine>;
  maxLines?: number;
  maxBytes?: number;
  /** Código de saída: só passe quando o `tool_result` começa com "Exit code N" (D-C3). */
  exitCode?: number;
  /** `true` mostra tudo, sem rodapé de corte. */
  showAll?: boolean;
  onViewAll?: () => void;
  /** Sem `onCopy` o botão não aparece. */
  onCopy?: () => void;
  className?: string;
}

function normalize(line: string | CommandOutputLine): CommandOutputLine {
  return typeof line === 'string' ? { text: line } : line;
}

/**
 * Moldura da saída de comando (014-chat, extensão 5): cabeçalho de 24 px com o
 * comando, o código de saída e copiar; corpo mono de 12 px; rodapé de 22 px com
 * "… N linhas ocultas · ver tudo". Também serve ao bruto do "não reconhecido" e à
 * lista de arquivos da busca.
 */
export function CommandOutput({
  title,
  text,
  lines,
  maxLines = DETAIL_MAX_LINES,
  maxBytes = DETAIL_MAX_BYTES,
  exitCode,
  showAll = false,
  onViewAll,
  onCopy,
  className,
}: CommandOutputProps) {
  let visible: CommandOutputLine[];
  let hidden = 0;
  if (text !== undefined) {
    if (showAll) {
      visible = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(normalize);
    } else {
      const clipped = clipOutputText(text, maxLines, maxBytes);
      visible = clipped.visible.map(normalize);
      hidden = clipped.hidden;
    }
  } else {
    const source = (lines ?? []).map(normalize);
    if (showAll) {
      visible = source;
    } else {
      const clipped = clipLines(source, maxLines);
      visible = clipped.visible;
      hidden = clipped.hidden;
    }
  }

  return (
    <div className={[styles.block, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.meta}>{title}</span>
        <span className={styles.spacer} />
        {exitCode !== undefined ? (
          <span className={exitCode === 0 ? styles.meta : styles.exitFailed}>saiu com código {exitCode}</span>
        ) : null}
        {onCopy ? (
          <button type="button" className={styles.copy} onClick={onCopy} aria-label="Copiar saída do comando">
            <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={styles.body}>
        {visible.map((line, index) => (
          <div
            key={index}
            className={[styles.line, line.tone === 'error' ? styles.error : '', line.tone === 'muted' ? styles.muted : '']
              .filter(Boolean)
              .join(' ')}
          >
            {line.text}
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <div className={styles.footer}>
          <span className={styles.mono}>{formatHiddenLines(hidden)}</span>
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
