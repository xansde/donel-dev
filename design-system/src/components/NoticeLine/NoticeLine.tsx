import type { ReactNode } from 'react';
import styles from './NoticeLine.module.css';

export interface NoticeLineProps {
  /** Ícone de 14 px (o contêiner escolhe: compactação, limite, troca de conta…). */
  icon?: ReactNode;
  children: ReactNode;
  /**
   * G3: aviso só ganha cor quando pede decisão — `warn` (âmbar) no limite da
   * conta, em `api-error` e em `informational` com `level: warning`; o resto
   * fica `muted`.
   */
  tone?: 'muted' | 'warn';
  /** Ação em linha ("abrir", "ver bruto") — use `Button variant="link"`. */
  action?: ReactNode;
  /** Conteúdo aberto abaixo da linha (ex.: bruto do "não reconhecido"). */
  detail?: ReactNode;
  className?: string;
}

/**
 * Aviso de uma linha na conversa (014-chat, G3): ícone de 14 px, texto de
 * 12 px e um filete até a borda. Substitui o `Notice` do contrato.
 */
export function NoticeLine({ icon, children, tone = 'muted', action, detail, className }: NoticeLineProps) {
  return (
    <div className={[styles.wrapper, styles[tone], className].filter(Boolean).join(' ')} role="status">
      <div className={styles.line}>
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className={styles.text}>{children}</span>
        <span className={styles.rule} aria-hidden="true" />
        {action ? <span className={styles.action}>{action}</span> : null}
      </div>
      {detail ? <div className={styles.detail}>{detail}</div> : null}
    </div>
  );
}
