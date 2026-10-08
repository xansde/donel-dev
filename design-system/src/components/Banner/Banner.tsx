import type { ReactNode } from 'react';
import styles from './Banner.module.css';

/** Tons: `permission` (coral), `waiting` (âmbar), `accent` (azul), `muted`. */
export type BannerTone = 'permission' | 'waiting' | 'accent' | 'muted';

/**
 * - `default`: faixa de aviso com título, texto e ações (G4);
 * - `compact`: uma linha só ("Conversa nova — a anterior está em Sessões
 *   anteriores" + "abrir");
 * - `live`: barra de 36 px do pé da conversa ("trabalhando — …",
 *   "Interrompido — …"); o `icon` costuma ser um `StateDot`.
 */
export type BannerVariant = 'default' | 'compact' | 'live';

export interface BannerProps {
  tone?: BannerTone;
  variant?: BannerVariant;
  /** Ícone à esquerda (18 px no `default`, 14 px no `compact`). */
  icon?: ReactNode;
  /** Título em negrito (`default`) ou o texto principal (`compact`/`live`). */
  title?: ReactNode;
  /** Texto de apoio abaixo do título (`default`). */
  children?: ReactNode;
  /** Ações à direita: `Button`, `Kbd`… */
  actions?: ReactNode;
  /**
   * `alert` para o que pede ação agora (terminal precisa de você, sem receber a
   * conversa); `status` (padrão) para o resto.
   */
  role?: 'alert' | 'status';
  className?: string;
}

/**
 * Faixa de aviso (014-chat, extensão 9). Superfície estática: o coral do tom
 * `permission` é fixo — o pulso de "precisa de você" mora no `StateDot` e na
 * aba (D-C26), não aqui.
 */
export function Banner({
  tone = 'muted',
  variant = 'default',
  icon,
  title,
  children,
  actions,
  role = 'status',
  className,
}: BannerProps) {
  return (
    <div
      role={role}
      className={[styles.banner, styles[variant], styles[tone], className].filter(Boolean).join(' ')}
    >
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className={styles.text}>
        {title ? <div className={styles.title}>{title}</div> : null}
        {children ? <div className={styles.description}>{children}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
