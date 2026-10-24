// 014-chat (T088) - removable thumbnails of the images in the composer, above the text (design T06, "Anexos").
// The picture comes from the `donel-asset:` attachment protocol (the main serves the file it wrote itself).

import { X } from 'lucide-react';
import { buildAttachmentAssetUrl } from '../../../../shared/chat/assetUrl';
import { imageLabels, type DraftImage } from './attachmentsModel';
import styles from './Attachments.module.css';

export interface AttachmentsProps {
  images: readonly DraftImage[];
  onRemove: (id: string) => void;
}

/** `<root>/<sessionId>/<file>` -> the asset URL the <img> loads. */
export function thumbnailUrl(image: DraftImage): string {
  const parts = image.path.split(/[\\/]/);
  const fileName = parts[parts.length - 1] ?? '';
  const sessionId = parts[parts.length - 2] ?? '';
  return buildAttachmentAssetUrl(sessionId, fileName);
}

export function Attachments({ images, onRemove }: AttachmentsProps): React.JSX.Element | null {
  if (images.length === 0) return null;
  const labels = imageLabels(images);
  return (
    <ul className={styles.list} data-testid="chat-attachments" aria-label="Imagens anexadas">
      {images.map((image, index) => (
        <li key={image.id} className={styles.item} data-testid="chat-attachment">
          <div className={styles.thumb}>
            <img className={styles.img} src={thumbnailUrl(image)} alt={labels[index]} draggable={false} />
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remover ${labels[index]}`}
              title="Remover"
              onClick={() => onRemove(image.id)}
            >
              <X size={10} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
          <span className={styles.label}>{labels[index]}</span>
        </li>
      ))}
    </ul>
  );
}
