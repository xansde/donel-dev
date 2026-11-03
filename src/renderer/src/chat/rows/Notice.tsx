import { Button, NoticeLine } from '@donel-dev/design-system';
import {
  ArrowLeftRight,
  FileText,
  Gauge,
  Info,
  MessageSquarePlus,
  RefreshCw,
  Shrink,
  Square,
  TriangleAlert,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import type { NoticeRow } from '../../../../shared/chat/rows';
import { noticeContent } from './format';
import type { NoticeIcon } from './format';
import styles from './rows.module.css';

const ICON: Readonly<Record<NoticeIcon, ReactNode>> = {
  compact: <Shrink size={14} strokeWidth={1.75} />,
  limit: <Gauge size={14} strokeWidth={1.75} />,
  'api-error': <TriangleAlert size={14} strokeWidth={1.75} />,
  interrupted: <Square size={14} strokeWidth={1.75} />,
  'account-switch': <ArrowLeftRight size={14} strokeWidth={1.75} />,
  'conversation-switch': <MessageSquarePlus size={14} strokeWidth={1.75} />,
  informational: <Info size={14} strokeWidth={1.75} />,
  'generated-file': <FileText size={14} strokeWidth={1.75} />,
  'session-renewed': <RefreshCw size={14} strokeWidth={1.75} />,
  'auto-approved': <ShieldCheck size={14} strokeWidth={1.75} />,
};

export interface NoticeProps {
  row: NoticeRow;
  /** `chat:open-generated` — opens a generated document/image with the system app. */
  onOpenGenerated: (path: string) => void;
}

/**
 * Every `NoticeKind` as a `NoticeLine` (T052, critério G3): one line, amber only
 * when it asks for a decision. "Gerou `arquivo` — abrir" carries the action.
 */
function NoticeImpl({ row, onOpenGenerated }: NoticeProps) {
  const content = noticeContent(row.notice, row.params);
  const path = content.filePath;
  return (
    <NoticeLine
      icon={ICON[content.icon]}
      tone={content.tone}
      action={
        path ? (
          <Button variant="link" onClick={() => onOpenGenerated(path)}>
            abrir
          </Button>
        ) : undefined
      }
    >
      {content.text}
      {content.fileName ? (
        <>
          {' '}
          <span className={styles.fileName}>{content.fileName}</span>
        </>
      ) : null}
    </NoticeLine>
  );
}

export const Notice = memo(NoticeImpl);
