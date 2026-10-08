// T057 (014-chat, FR-034, G5) - "Sessão encerrada (código N)": takes the place
// of the composer. The conversation above stays readable and copyable.

import { Button, StateDot } from '@donel-dev/design-system';
import styles from './SessionEndedBar.module.css';

export interface SessionEndedBarProps {
  /** `null`/`undefined` = the exit code is unknown. */
  exitCode?: number | null;
  /** Resumes the SAME conversation (`TerminalPane.respawn({ resume })`). */
  onResume: () => void;
  onCloseTab: () => void;
}

export function SessionEndedBar({ exitCode, onResume, onCloseTab }: SessionEndedBarProps): React.JSX.Element {
  const known = exitCode !== null && exitCode !== undefined;
  return (
    <div className={styles.bar} role="status" data-testid="chat-session-ended">
      <StateDot state="done" />
      <div className={styles.text}>
        <div className={styles.title}>{known ? `Sessão encerrada (código ${exitCode})` : 'Sessão encerrada'}</div>
        <div className={styles.hint}>A conversa continua aqui para ler e copiar. O rascunho fica guardado até você retomar.</div>
      </div>
      <Button variant="primary" onClick={onResume}>
        Retomar
      </Button>
      <Button variant="secondary" onClick={onCloseTab}>
        Fechar aba
      </Button>
    </div>
  );
}
