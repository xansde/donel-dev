import { AnnotationTag, OwnerMessage } from '@donel-dev/design-system';
import type { OwnerMessageProps } from '@donel-dev/design-system';
import { memo } from 'react';
import type { UserRow } from '../../../../shared/chat/rows';
import { formatClock, isCommandText, stripImageMarkers } from './format';
import styles from './rows.module.css';

/** Image block of a user message (`RowAttachment` of kind `image`). */
export type UserImageAttachment = Extract<UserRow['attachments'][number], { kind: 'image' }>;

export interface UserMessageProps {
  row: UserRow;
  /** `donel-asset:` URL of an image block (T046). */
  assetUrl: (attachment: UserImageAttachment) => string;
  /** Live send state, only for messages the chat itself sent in this use of the tab (D-C11). */
  sendState?: OwnerMessageProps['sendState'];
  queuedReason?: string;
  failedReason?: string;
  onRetry?: () => void;
  onDiscard?: () => void;
}

const DEFAULT_QUEUED_REASON = 'entra na próxima pausa do Claude';

/**
 * Message of the owner (T052): `OwnerMessage`, mono when it starts with `/` or
 * `!`, with image thumbnails (`donel-asset:`) and `@` mentions inside the card.
 */
function UserMessageImpl({ row, assetUrl, sendState, queuedReason, failedReason, onRetry, onDiscard }: UserMessageProps) {
  const images = row.attachments.filter((a): a is UserImageAttachment => a.kind === 'image');
  const mentions = row.attachments.filter((a): a is Extract<UserRow['attachments'][number], { kind: 'mention' }> => a.kind === 'mention');

  const typed = row.text !== '' ? row.text : row.command ? `/${row.command.name} ${row.command.args}`.trim() : '';
  const text = images.length > 0 ? stripImageMarkers(typed) : typed;
  const mono = row.command !== undefined || isCommandText(text);
  const state = sendState ?? (row.queued ? 'queued' : 'history');

  const attachments =
    images.length + mentions.length > 0 ? (
      <>
        {images.length > 0 ? (
          <div className={styles.thumbs}>
            {images.map((image, index) => (
              <img
                key={`${image.ref.offset}:${image.blockIndex}`}
                className={styles.thumb}
                src={assetUrl(image)}
                alt={`imagem ${index + 1}`}
                loading="lazy"
              />
            ))}
          </div>
        ) : null}
        {mentions.length > 0 ? (
          <div className={styles.thumbs}>
            {mentions.map((mention) => (
              <AnnotationTag key={mention.path} tone="muted">
                <span className={styles.mention} title={mention.path}>
                  @{mention.path}
                </span>
              </AnnotationTag>
            ))}
          </div>
        ) : null}
      </>
    ) : undefined;

  return (
    <OwnerMessage
      time={formatClock(row.at)}
      sendState={state}
      queuedReason={state === 'queued' ? (queuedReason ?? DEFAULT_QUEUED_REASON) : undefined}
      failedReason={failedReason}
      onRetry={onRetry}
      onDiscard={onDiscard}
      mono={mono}
      attachments={attachments}
    >
      {text}
    </OwnerMessage>
  );
}

export const UserMessage = memo(UserMessageImpl);
