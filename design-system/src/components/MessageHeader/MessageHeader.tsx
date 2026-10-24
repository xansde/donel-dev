import { Check, Copy } from 'lucide-react';
import { Button } from '../Button';
import styles from './MessageHeader.module.css';

export interface MessageHeaderProps {
  /** Legenda em caixa alta: "Claude" na conversa, "Subagente" no painel lateral. */
  label?: string;
  /** Hora já formatada ("14:05"). */
  time?: string;
  /** Sem `onCopy` o botão "copiar resposta" não aparece. */
  onCopy?: () => void;
  /** Rótulo do botão quando ocioso. */
  copyLabel?: string;
  /** Rótulo depois de copiar — quem controla o estado é o contêiner. */
  copiedLabel?: string;
  copied?: boolean;
  className?: string;
}

/**
 * Legenda de uma resposta (014-chat, extensão 1): "CLAUDE · hh:mm" à esquerda e
 * "copiar resposta" (ghost) na ponta. O DS não copia nada — `onCopy` é do
 * renderer (markdownClipboard).
 */
export function MessageHeader({
  label = 'Claude',
  time,
  onCopy,
  copyLabel = 'Copiar resposta',
  copiedLabel = 'Copiado',
  copied = false,
  className,
}: MessageHeaderProps) {
  return (
    <div className={[styles.header, className].filter(Boolean).join(' ')}>
      <span className={styles.label}>{label}</span>
      {time ? <span className={styles.time}>{time}</span> : null}
      <span className={styles.spacer} />
      {onCopy ? (
        <Button
          variant="ghost"
          onClick={onCopy}
          iconLeft={
            copied ? (
              <Check size={14} strokeWidth={2} className={styles.copiedIcon} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
            )
          }
        >
          {copied ? copiedLabel : copyLabel}
        </Button>
      ) : null}
    </div>
  );
}
