// Novidades da versão — abre sozinho na primeira abertura depois de uma
// atualização que trouxe notas novas, e não volta até a próxima. O botão
// Novidades no rodapé reabre as mais recentes a qualquer hora.

import { Button, Modal } from '@donel-dev/design-system';
import { useState } from 'react';
import { PATCH_NOTES } from './notes';
import { formatNoteDate, latestNoteDate, recentNotes, unseenNotes } from './patchNotesModel';
import styles from './PatchNotes.module.css';

const LAST_SEEN_KEY = 'donel.patchNotes.lastSeen';
/** Quantos dias o botão Novidades reabre. */
const REOPEN_DAYS = 10;

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

export function PatchNotes(): React.JSX.Element {
  const [days, setDays] = useState(() => unseenNotes(PATCH_NOTES, readLastSeen()));
  const [open, setOpen] = useState(days.length > 0);
  const [reopened, setReopened] = useState(false);

  const reopen = (): void => {
    setDays(recentNotes(PATCH_NOTES, REOPEN_DAYS));
    setReopened(true);
    setOpen(true);
  };

  const close = (): void => {
    const latest = latestNoteDate(PATCH_NOTES);
    if (latest !== null) writeLastSeen(latest);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={reopen}
        title="Ver o que mudou nas últimas versões"
        data-testid="patch-notes-open"
      >
        Novidades
      </button>
      <Modal open={open} onClose={close} title="O que mudou no Donel Dev" className={styles.dialog}>
        <div className={styles.body} data-testid="patch-notes">
          <p className={styles.intro}>
            {reopened ? 'As novidades das últimas versões.' : 'Novidades desde a última vez que você abriu.'}
          </p>
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
    </>
  );
}
