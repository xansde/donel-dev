// Novidades da versão — abre sozinho na primeira abertura depois de uma
// atualização que trouxe notas novas, e não volta até a próxima.

import { Button, Modal } from '@donel-dev/design-system';
import { useState } from 'react';
import { PATCH_NOTES } from './notes';
import { formatNoteDate, latestNoteDate, unseenNotes } from './patchNotesModel';
import styles from './PatchNotes.module.css';

const LAST_SEEN_KEY = 'donel.patchNotes.lastSeen';

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(date: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, date);
  } catch {
    // Sem storage a janela volta na próxima abertura; nada quebra.
  }
}

export function PatchNotes(): React.JSX.Element | null {
  const [days] = useState(() => unseenNotes(PATCH_NOTES, readLastSeen()));
  const [open, setOpen] = useState(days.length > 0);

  if (days.length === 0) return null;

  const close = (): void => {
    const latest = latestNoteDate(PATCH_NOTES);
    if (latest !== null) writeLastSeen(latest);
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={close} title="O que mudou no Donel Dev" className={styles.dialog}>
      <div className={styles.body} data-testid="patch-notes">
        <p className={styles.intro}>Novidades desde a última vez que você abriu.</p>
        <div className={styles.scroll}>
          {days.map((day) => (
            <section key={day.date} className={styles.day}>
              <h3 className={styles.date}>{formatNoteDate(day.date)}</h3>
              <ul className={styles.list}>
                {day.items.map((item) => (
                  <li key={item.title} className={styles.item}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    <span className={styles.itemText}>{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className={styles.footer}>
          <Button variant="primary" onClick={close}>
            Entendi
          </Button>
        </div>
      </div>
    </Modal>
  );
}
