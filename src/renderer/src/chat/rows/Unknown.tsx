import { Button, CommandOutput, NoticeLine } from '@donel-dev/design-system';
import { CircleHelp } from 'lucide-react';
import { memo, useState } from 'react';
import type { UnknownRow } from '../../../../shared/chat/rows';
import styles from './rows.module.css';
import { useRowDetail } from './useRowDetail';
import type { RequestRowDetail } from './useRowDetail';

export interface UnknownProps {
  row: UnknownRow;
  /** `chat:row-detail` with part `raw` (JSON truncated at 4 KB by the main process). */
  requestDetail: RequestRowDetail;
}

/**
 * Content the adapter does not know (T052, FR-012, D-C8): "Conteúdo não
 * reconhecido (`progress`) — ver bruto". The raw block opens in the
 * `CommandOutput` frame.
 */
function UnknownImpl({ row, requestDetail }: UnknownProps) {
  const [open, setOpen] = useState(false);
  const { states, load } = useRowDetail(requestDetail, row.id);
  const raw = states.raw;

  const toggle = () => {
    if (!open) load('raw');
    setOpen(!open);
  };

  return (
    <NoticeLine
      icon={<CircleHelp size={14} strokeWidth={1.75} />}
      action={
        <Button variant="link" onClick={toggle} aria-expanded={open}>
          {open ? 'ocultar' : 'ver bruto'}
        </Button>
      }
      detail={
        open ? (
          raw?.status === 'ready' ? (
            <CommandOutput title={`bruto · ${row.typeLabel}`} text={raw.detail.text} showAll />
          ) : raw?.status === 'error' ? (
            <div className={styles.note}>Não foi possível ler o conteúdo bruto.</div>
          ) : (
            <div className={styles.note}>carregando…</div>
          )
        ) : undefined
      }
    >
      Conteúdo não reconhecido (<span className={styles.fileName}>{row.typeLabel}</span>)
    </NoticeLine>
  );
}

export const Unknown = memo(UnknownImpl);
