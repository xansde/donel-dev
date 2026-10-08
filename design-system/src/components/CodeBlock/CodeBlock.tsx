import { Check, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './CodeBlock.module.css';

export interface CodeBlockProps {
  /**
   * Rótulo da linguagem no cabeçalho. Sem linguagem na cerca, o rótulo é
   * "texto" (D-C6) — o contêiner decide; aqui é só o valor padrão.
   */
  language?: string;
  /** Caminho opcional: só quando a cerca o traz (D-C6). Nunca inferido. */
  path?: string;
  /** Sem `onCopy` o botão não aparece. Copia o bloco como texto cru (D-C9). */
  onCopy?: () => void;
  copied?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  /**
   * O código. Aceita texto puro ou o conteúdo já realçado (spans do Shiki lendo
   * `--code-*`). Quebras de linha são preservadas.
   */
  children: ReactNode;
  className?: string;
}

/**
 * Casca visual do bloco de código (014-chat, extensão 4): cabeçalho de 30 px com
 * rótulo da linguagem, caminho opcional e "copiar"; corpo em mono de 12,5 px /
 * 18 px. O realce vem de fora — o corpo só define as variáveis `--code-*`.
 */
export function CodeBlock({
  language = 'texto',
  path,
  onCopy,
  copied = false,
  copyLabel = 'Copiar',
  copiedLabel = 'Copiado',
  children,
  className,
}: CodeBlockProps) {
  return (
    <div className={[styles.block, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.meta}>{language}</span>
        {path ? <span className={styles.meta}>· {path}</span> : null}
        <span className={styles.spacer} />
        {onCopy ? (
          <button type="button" className={styles.copy} onClick={onCopy} aria-label="Copiar bloco de código">
            {copied ? (
              <Check className={styles.copied} size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            <span>{copied ? copiedLabel : copyLabel}</span>
          </button>
        ) : null}
      </div>
      <pre className={styles.body}>
        <code>{children}</code>
      </pre>
    </div>
  );
}
