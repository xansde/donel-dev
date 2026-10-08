import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primário = fundo `accent`, texto `#0E1116`; secundário = borda `border`;
   * ghost = só texto; perigo = texto `#F0684C` (design-system.md §6);
   * link = ação em linha ("ver tudo", "tentar de novo") — texto `accent`, sem
   * caixa, altura do texto (014-chat, D-C27: ação nunca é `<a href>`).
   */
  variant?: ButtonVariant;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** Largura total do container — usado no "▶ Iniciar" do Launcher (Brief 3). */
  fullWidth?: boolean;
}

/** Botão base do sistema. Altura fixa de 30px (design-system.md §6). */
export function Button({
  variant = 'secondary',
  iconLeft,
  iconRight,
  fullWidth = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[styles.button, styles[variant], fullWidth ? styles.fullWidth : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {iconLeft}
      {children ? <span className={styles.label}>{children}</span> : null}
      {iconRight}
    </button>
  );
}
