// T089 (014-chat) - the "texto colado - N linhas" chips of the composer (design T06-F). Click opens the full text
// in a read-only `Modal` (mono) to check it; the X drops the paste. On send the text goes back into the message.

import { Button, Modal } from '@donel-dev/design-system';
import { File as FileIcon, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { pasteLabel, type DraftPaste } from './pastedText';
import styles from './PastedTexts.module.css';

export interface PastedTextsProps {
  pastes: readonly DraftPaste[];
  onRemove: (id: string) => void;
}

export function PastedTexts({ pastes, onRemove }: PastedTextsProps): React.JSX.Element | null {
  const [viewingId, setViewingId] = useState<string | null>(null);
  if (pastes.length === 0) return null;
  const viewing = pastes.find((paste) => paste.id === viewingId) ?? null;
  // The Modal closes on Esc through a document listener; mark the event as handled so the chat view does not
  // also read that Esc as "stop the Claude" (D-C24: React events bubble through the portal to the view).
  const markEscHandled = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') event.preventDefault();
  };
  return (
    <>
      <ul className={styles.list} data-testid="chat-pasted-texts" aria-label="Textos colados">
        {pastes.map((paste) => (
          <li key={paste.id} className={styles.chip} data-testid="chat-pasted-text">
            <FileIcon size={16} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
            <button
              type="button"
              className={styles.open}
              aria-label={`Abrir o texto colado de ${paste.lines} linhas para conferir`}
              data-testid="chat-pasted-text-open"
              onClick={() => setViewingId(paste.id)}
            >
              <span className={styles.title}>{pasteLabel(paste)}</span>
              <span className={styles.sub}>abre para conferir</span>
            </button>
            <button
              type="button"
              className={styles.remove}
              aria-label="Remover o texto colado"
              title="Remover"
              data-testid="chat-pasted-text-remove"
              onClick={() => onRemove(paste.id)}
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div onKeyDown={markEscHandled}>
        <Modal
          open={viewing !== null}
          onClose={() => setViewingId(null)}
          title={viewing === null ? '' : pasteLabel(viewing)}
          className={styles.dialog}
          actions={
            <Button variant="secondary" onClick={() => setViewingId(null)}>
              Fechar
            </Button>
          }
        >
          <pre className={styles.text} data-testid="chat-pasted-text-body" tabIndex={0}>
            {viewing?.text}
          </pre>
        </Modal>
      </div>
    </>
  );
}
