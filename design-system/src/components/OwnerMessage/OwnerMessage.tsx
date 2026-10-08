import { ChevronRight, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import styles from './OwnerMessage.module.css';

/**
 * Estado de envio da mensagem (014-chat, decisão E / D-C11):
 * - `history`: veio do histórico — só a hora;
 * - `sending`: "enviando…" (ponto piscando);
 * - `queued`: "na fila" + a causa em `queuedReason` (D-C10);
 * - `sent`: "hh:mm · ✓ entrou" (só o que o chat enviou neste uso da aba);
 * - `failed`: "✕ não foi · <motivo> · ↻ tentar de novo".
 */
export type OwnerMessageSendState = 'history' | 'sending' | 'queued' | 'sent' | 'failed';

export interface OwnerMessageProps {
  /** Texto (ou nós) da mensagem. Quebras de linha são preservadas. */
  children: ReactNode;
  /** Hora já formatada ("14:02"). */
  time?: string;
  sendState?: OwnerMessageSendState;
  /** Causa do "na fila": "entra na próxima pausa do Claude", etc. */
  queuedReason?: string;
  /** Motivo do "não foi": "o Claude não ficou pronto", etc. */
  failedReason?: string;
  /** Sem `onRetry` o "tentar de novo" não aparece. */
  onRetry?: () => void;
  /** Mensagem que começa com `/` ou `!` vai em mono (D-C11). */
  mono?: boolean;
  /** Miniaturas e fichas de anexo, abaixo do texto (FR-005). */
  attachments?: ReactNode;
  /**
   * `task` = cartão "Tarefa recebida do Claude principal" do painel do
   * subagente: sem o marcador `>`, com a legenda acima e sem meta de envio.
   */
  variant?: 'message' | 'task';
  /** Legenda do `task`. */
  taskLabel?: string;
  className?: string;
}

/**
 * Mensagem do dono — o único cartão preenchido da transcrição (014-chat,
 * decisão A): fundo `--bg-panel`, filete, raio 6, marcador `>` em `--accent`.
 * A meta (hora + estado de envio) fica à direita, em mono de 11 px.
 */
export function OwnerMessage({
  children,
  time,
  sendState = 'history',
  queuedReason,
  failedReason,
  onRetry,
  mono = false,
  attachments,
  variant = 'message',
  taskLabel = 'Tarefa recebida do Claude principal',
  className,
}: OwnerMessageProps) {
  const isTask = variant === 'task';
  const cardClass = [
    styles.card,
    sendState === 'queued' && !isTask ? styles.queued : '',
    sendState === 'failed' && !isTask ? styles.failed : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClass}>
      {isTask ? null : (
        <ChevronRight className={styles.marker} size={14} strokeWidth={2.25} role="img" aria-label="Você" />
      )}
      <div className={styles.body}>
        {isTask ? <div className={styles.taskLabel}>{taskLabel}</div> : null}
        <div className={[styles.text, mono ? styles.mono : ''].filter(Boolean).join(' ')}>{children}</div>
        {attachments ? <div className={styles.attachments}>{attachments}</div> : null}
        {isTask ? null : (
          <div className={styles.meta}>
            {sendState === 'sending' ? (
              <>
                <span className={styles.blink} aria-hidden="true" />
                <span>enviando…</span>
              </>
            ) : null}
            {sendState === 'queued' ? (
              <>
                {time ? <span className={styles.time}>{time}</span> : null}
                <span className={styles.queuedTag}>na fila</span>
                {queuedReason ? <span>{queuedReason}</span> : null}
              </>
            ) : null}
            {sendState === 'failed' ? (
              <>
                <span className={styles.failedText}>✕ não foi</span>
                {failedReason ? <span>· {failedReason}</span> : null}
                {onRetry ? (
                  <Button
                    variant="link"
                    onClick={onRetry}
                    iconLeft={<RotateCcw size={12} strokeWidth={2} aria-hidden="true" />}
                  >
                    tentar de novo
                  </Button>
                ) : null}
              </>
            ) : null}
            {sendState === 'sent' ? (
              <>
                {time ? <span className={styles.time}>{time}</span> : null}
                {time ? <span aria-hidden="true">·</span> : null}
                <span className={styles.entered}>✓ entrou</span>
              </>
            ) : null}
            {sendState === 'history' && time ? <span className={styles.time}>{time}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
