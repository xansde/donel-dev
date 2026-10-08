// 014-chat (T067/T069) - the composer of the chat view: a design-system `TextArea` inside `Composer`.
// Enter sends, Shift+Enter breaks the line; the draft lives per tab in memory (`tabSend.ts`); ArrowUp walks
// back through the prompts of the conversation. While the Claude works, "Enviar" is a SplitButton: click =
// queue, menu = "Interromper e mandar agora" (`interrupt-first`). The unsent text left in the terminal box
// shows up as a `Banner·waiting` above the field (T065). Images (T088): Ctrl+V / drop / the paperclip save the
// picture through the main (`chat:save-image`) and show a removable thumbnail above the text; a non-image file
// from the paperclip or a drop becomes an `@` mention in the text. The draft keeps the images too.

import { Banner, Button, Composer, TextArea } from '@donel-dev/design-system';
import { Paperclip } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import {
  buildPromptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryPosition,
} from '../../../../shared/chat/t3/promptHistory';
import type { ConversationRow } from '../../../../shared/chat/rows';
import type { SendDriver, SendItemView } from '../sendDriver';
import { getChatStore } from '../ChatStore';
import { Attachments } from './Attachments';
import { appendMention, canSend, imageTypeOf, mentionFor, sendRequestOf, type DraftImage } from './attachmentsModel';
import { getDraft, getDraftImages, setDraft, setDraftImages, subscribeDraft, subscribeDraftImages } from './tabSend';
import styles from './ChatComposer.module.css';

export interface ChatComposerProps {
  tabId: string;
  /** PTY of the tab: images are saved against its conversation. `null` before the first spawn. */
  ptyId?: string | null;
  /** Folder of the tab: a file inside it is mentioned as `@relative`. */
  cwd?: string;
  driver: SendDriver;
  /** Rows as the owner sees them (real + local ones): source of the ArrowUp history. */
  rows: readonly ConversationRow[];
  /** The Claude is mid-turn (live status `working`). */
  working: boolean;
  /** The tab is the active one AND its view is the chat: takes the keyboard focus. */
  active: boolean;
  /** Message items of the driver (for the unsent-text banner). */
  items: readonly SendItemView[];
  /** "Abrir terminal" on the unsent-text banner. */
  onOpenTerminal: () => void;
}

const isComposing = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.nativeEvent.isComposing || event.keyCode === 229;

const LEFTOVER_PREVIEW = 80;
const preview = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LEFTOVER_PREVIEW ? `${flat.slice(0, LEFTOVER_PREVIEW)}…` : flat;
};

export function ChatComposer({ tabId, ptyId = null, cwd, driver, rows, working, active, items, onOpenTerminal }: ChatComposerProps): React.JSX.Element {
  const draft = useSyncExternalStore(
    useCallback((cb) => subscribeDraft(tabId, cb), [tabId]),
    () => getDraft(tabId),
  );
  const images = useSyncExternalStore(
    useCallback((cb) => subscribeDraftImages(tabId, cb), [tabId]),
    () => getDraftImages(tabId),
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyPosition = useRef<PromptHistoryPosition | null>(null);

  // The box is focused when the tab opens on (or comes back to) the chat.
  useEffect(() => {
    if (active) areaRef.current?.focus();
  }, [active, tabId]);

  const history = useMemo(
    () =>
      buildPromptHistoryEntries(
        rows.flatMap((row) => {
          if (row.kind !== 'user') return [];
          const text = row.text !== '' ? row.text : row.command ? `/${row.command.name} ${row.command.args}`.trim() : '';
          return [{ id: row.id, role: 'user', text }];
        }),
      ),
    [rows],
  );

  const onChange = useCallback(
    (value: string) => {
      setDraft(tabId, value);
    },
    [tabId],
  );

  const submit = useCallback(
    (mode: 'normal' | 'interrupt-first') => {
      const text = getDraft(tabId);
      const attached = getDraftImages(tabId);
      if (!canSend(text, attached)) return;
      historyPosition.current = null;
      setDraft(tabId, '');
      setDraftImages(tabId, []);
      setImageError(null);
      driver.enqueue(sendRequestOf(text, attached, mode));
    },
    [tabId, driver],
  );

  /** Pasted/dropped/picked files: images are saved by the main; any other file becomes a mention. */
  const addFiles = useCallback(
    async (files: readonly File[], origin: DraftImage['origin']): Promise<void> => {
      const store = getChatStore();
      let failure: string | null = null;
      for (const file of files) {
        const mediaType = imageTypeOf(file);
        if (mediaType !== null) {
          if (ptyId === null) {
            failure = 'A conversa ainda não começou: tente de novo em instantes.';
            continue;
          }
          try {
            const saved = await store.saveImage(ptyId, await file.arrayBuffer(), mediaType);
            const image: DraftImage = {
              id: saved.id,
              path: saved.path,
              mediaType,
              origin,
              ...(origin === 'picked' && file.name !== '' ? { name: file.name } : {}),
            };
            setDraftImages(tabId, [...getDraftImages(tabId), image]);
          } catch (error) {
            failure = error instanceof Error && /\(imagem\)|imagem/.test(error.message) ? error.message.replace(/^.*chat:save-image: /, '') : 'Não foi possível anexar a imagem.';
          }
          continue;
        }
        const path = store.pathForFile(file);
        if (path === '') {
          failure = 'Não foi possível anexar este arquivo.';
          continue;
        }
        setDraft(tabId, appendMention(getDraft(tabId), mentionFor(path, cwd)));
      }
      setImageError(failure);
      if (files.length > 0) areaRef.current?.focus();
    },
    [tabId, ptyId, cwd],
  );

  const removeImage = useCallback(
    (id: string) => {
      setDraftImages(
        tabId,
        getDraftImages(tabId).filter((image) => image.id !== id),
      );
    },
    [tabId],
  );

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const data = event.clipboardData;
    const files = [...data.files].filter((file) => imageTypeOf(file) !== null);
    // Text wins when the clipboard has both (a spreadsheet copies its cells AND a picture of them).
    if (files.length === 0 || data.getData('text/plain') !== '') return;
    event.preventDefault();
    void addFiles(files, 'pasted');
  };

  const hasFiles = (event: DragEvent<HTMLElement>): boolean => [...event.dataTransfer.types].includes('Files');
  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    void addFiles([...event.dataTransfer.files], 'picked');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isComposing(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      submit('normal');
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const area = event.currentTarget;
      if (area.selectionStart !== area.selectionEnd) return;
      const caret = area.selectionStart;
      const result = stepPromptHistory({
        direction: event.key === 'ArrowUp' ? 'backward' : 'forward',
        entries: history,
        position: historyPosition.current,
        currentPrompt: area.value,
        cursorAtTopEdge: !area.value.slice(0, caret).includes('\n'),
        cursorAtBottomEdge: !area.value.slice(caret).includes('\n'),
      });
      if (result === null) return;
      event.preventDefault();
      historyPosition.current = result.position;
      setDraft(tabId, result.prompt);
      requestAnimationFrame(() => {
        const el = areaRef.current;
        if (el) el.setSelectionRange(result.prompt.length, result.prompt.length);
      });
    }
  };

  const paperclip = (
    <>
      <button
        type="button"
        className={styles.clip}
        aria-label="Anexar arquivo ou imagem"
        title="Anexar"
        data-testid="chat-composer-attach"
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        data-testid="chat-composer-file-input"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = '';
          void addFiles(picked, 'picked');
        }}
      />
    </>
  );

  const leftover = items.find((item) => item.leftover !== null);
  const banner =
    leftover !== undefined && leftover.leftover !== null ? (
      <Banner
        tone="waiting"
        variant="compact"
        title={`Há texto não enviado no terminal: «${preview(leftover.leftover.text)}»`}
        actions={
          <>
            {leftover.leftover.canDiscard ? (
              <Button variant="secondary" onClick={() => driver.discardAndSend(leftover.id)}>
                Descartar e enviar
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onOpenTerminal}>
              Abrir terminal
            </Button>
          </>
        }
      />
    ) : imageError !== null ? (
      <Banner tone="waiting" variant="compact" title={imageError} />
    ) : undefined;

  const mono = draft.startsWith('/') || draft.startsWith('!');

  return (
    <div className={styles.wrap} data-testid="chat-composer" onDragOver={onDragOver} onDrop={onDrop}>
      <Composer
        working={working}
        sendDisabled={!canSend(draft, images)}
        onSend={() => submit('normal')}
        onInterruptAndSend={() => submit('interrupt-first')}
        banner={banner}
        leading={paperclip}
        footerHint
        fluid
      >
        {/* Thumbnails sit above the text, inside the box (design T06 "Anexos"). */}
        <Attachments images={images} onRemove={removeImage} />
        <TextArea
          ref={areaRef}
          appearance="bare"
          aria-label="Mensagem para o Claude"
          placeholder="Escreva para o Claude"
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          mono={mono}
          maxRows={10}
          data-testid="chat-composer-input"
        />
      </Composer>
    </div>
  );
}
