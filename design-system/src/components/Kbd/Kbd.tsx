import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

export interface KbdProps {
  /** A tecla ou o atalho: "Esc", "Enter", "Ctrl+`". */
  children: ReactNode;
  /** Explica o atalho no tooltip nativo (o design usa `title`, sem balão). */
  title?: string;
  className?: string;
}

/**
 * Chip de tecla (014-chat, extensão 13) — 8+ usos idênticos nos quadros do chat
 * (Esc ao lado do Parar, Enter, Ctrl+`). Só apresentação.
 */
export function Kbd({ children, title, className }: KbdProps) {
  return (
    <kbd className={[styles.kbd, className].filter(Boolean).join(' ')} title={title}>
      {children}
    </kbd>
  );
}
