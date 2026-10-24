import type { ReactNode } from 'react';
import { Button } from '../Button/Button';
import { SplitButton } from '../Button/SplitButton';
import { AnnotationTag } from '../AnnotationTag';
import { Kbd } from '../Kbd';
import styles from './Composer.module.css';

/** Largura máxima da caixa (px), conforme o handoff. */
export const COMPOSER_MAX_WIDTH = 752;

export interface ComposerProps {
  /** A `TextArea` (appearance="bare"). */
  children: ReactNode;
  /** Ação do "Enviar" (ocioso: envia; trabalhando: vai para a fila). */
  onSend: () => void;
  /** "Interromper e mandar agora" — só existe com `working`. */
  onInterruptAndSend?: () => void;
  /** O Claude está trabalhando: "Enviar" vira `SplitButton`. */
  working?: boolean;
  /** Sem nada a enviar (texto vazio, sessão encerrada…). */
  sendDisabled?: boolean;
  /** Rótulo do botão (padrão "Enviar"). */
  sendLabel?: string;
  /** Rótulo do item do menu (padrão "Interromper e mandar agora"). */
  interruptLabel?: string;
  /** Acima da caixa, ex. `Banner·waiting` de "texto não enviado no terminal". */
  banner?: ReactNode;
  /** À esquerda do campo (espaço do anexo — Fase 5; só encaixa o que vier). */
  leading?: ReactNode;
  /**
   * Dica sob a caixa. `true` mostra a padrão ("Enter envia · Shift+Enter
   * quebra linha", com `Kbd`); um nó substitui; `false`/omitido oculta.
   */
  footerHint?: ReactNode | boolean;
  /** Modo ajuste do plano (T05): borda `--accent` + etiqueta. Preparado para a Fase 4. */
  adjust?: boolean;
  adjustLabel?: string;
  /** Fills the container instead of capping at `COMPOSER_MAX_WIDTH` (chat view, full-width column). */
  fluid?: boolean;
  className?: string;
}

function DefaultFooterHint() {
  return (
    <>
      <Kbd>Enter</Kbd> envia · <Kbd>Shift+Enter</Kbd> quebra linha
    </>
  );
}

/**
 * Moldura da caixa de escrever do chat (014-chat, extensão 7): slot do campo,
 * botão de ação à direita e slots de `banner`/`footerHint`. Decisão 5: com o
 * Claude trabalhando, o "Enviar" vira `SplitButton` — clique = fila, menu =
 * "Interromper e mandar agora" (sem atalho novo).
 */
export function Composer({
  children,
  onSend,
  onInterruptAndSend,
  working = false,
  sendDisabled = false,
  sendLabel = 'Enviar',
  interruptLabel = 'Interromper e mandar agora',
  banner,
  leading,
  footerHint,
  adjust = false,
  adjustLabel = 'Ajuste no plano',
  fluid = false,
  className,
}: ComposerProps) {
  const showSplit = working && Boolean(onInterruptAndSend);
  const hint = footerHint === true ? <DefaultFooterHint /> : footerHint || null;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} style={{ maxWidth: fluid ? 'none' : COMPOSER_MAX_WIDTH }}>
      {banner ? <div className={styles.banner}>{banner}</div> : null}
      <div className={[styles.box, adjust ? styles.adjust : ''].filter(Boolean).join(' ')}>
        {adjust ? (
          <div className={styles.adjustTag}>
            <AnnotationTag tone="accent">{adjustLabel}</AnnotationTag>
          </div>
        ) : null}
        <div className={styles.row}>
          {leading ? <div className={styles.leading}>{leading}</div> : null}
          <div className={styles.field}>{children}</div>
          <div className={styles.action}>
            {showSplit ? (
              <SplitButton
                label={sendLabel}
                onClick={onSend}
                disabled={sendDisabled}
                menuPlacement="above"
                items={[{ label: interruptLabel, onSelect: () => onInterruptAndSend?.() }]}
              />
            ) : (
              <Button variant="primary" onClick={onSend} disabled={sendDisabled}>
                {sendLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}
