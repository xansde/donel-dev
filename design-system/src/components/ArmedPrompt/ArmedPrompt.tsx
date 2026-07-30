import { CornerDownLeft, X } from 'lucide-react';
import type { AnnotationTone } from '../AnnotationTag';
import styles from './ArmedPrompt.module.css';

export interface ArmedPromptWarning {
  text: string;
  /** Default `lock` — a maioria dos avisos aqui é fase travada (CA-5, CA-16). */
  tone?: AnnotationTone;
}

export interface ArmedPromptProps {
  /** O comando pré-digitado, exatamente como foi escrito no PTY (CA-3). Nunca enviado por esta peça. */
  command: string;
  /** Aviso opcional (fase travada/falhou, CA-5) — só informativo, não bloqueia. */
  warning?: ArmedPromptWarning;
  /**
   * Descarta o comando armado. É a ÚNICA ação exposta pelo tipo — não existe
   * `onEnter`/`onSubmit`: disparar o comando é estruturalmente impossível a
   * partir desta peça (CA-3, invariante 2).
   */
  onDismiss: () => void;
  className?: string;
}

/**
 * O gesto central do CA-3: comando escrito e **não enviado**, com a tecla
 * `Enter` desenhada explicitamente como tecla (não texto solto) e uma ação
 * de descartar. Nem `TerminalTab` nem `Button` expressam "armado, aguardando
 * o humano".
 *
 * FIX (rodada de feedback 30/07, item 3) — "essa dica não é necessária. Só
 * ocupa espaço desnecessário": a barra perdeu o texto explicativo
 * ("Comando preparado — nada foi enviado" e o `hint` livre, ex. "o Enter é
 * seu") — o comando já mostra o que vai rodar, e a tecla Enter desenhada já
 * comunica "isto não foi enviado ainda" sem precisar de legenda. Sobra só
 * Enter + descartar; a reclamação era do PADRÃO (todo consumidor do
 * componente), não de uma instância — o `hint` saiu do tipo, não só do uso.
 */
export function ArmedPrompt({ command, warning, onDismiss, className }: ArmedPromptProps) {
  const warningTone = warning?.tone ?? 'lock';

  return (
    <div className={[styles.armed, className].filter(Boolean).join(' ')}>
      <div className={styles.bar}>
        <span className={styles.enterKey} aria-hidden="true">
          <CornerDownLeft size={11} strokeWidth={2} />
          Enter
        </span>
        <button type="button" className={styles.dismiss} onClick={onDismiss}>
          <X size={11} strokeWidth={2} aria-hidden="true" />
          descartar
        </button>
      </div>
      {warning ? (
        <div className={[styles.warning, styles[`tone-${warningTone}`]].join(' ')}>{warning.text}</div>
      ) : null}
      <div className={styles.command}>{command}</div>
    </div>
  );
}
