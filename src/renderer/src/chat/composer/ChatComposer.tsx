// 014-chat (T067/T069) - the composer of the chat view: a design-system `TextArea` inside `Composer`.
// Enter sends, Shift+Enter breaks the line; the draft lives per tab in memory (`tabSend.ts`); ArrowUp walks
// back through the prompts of the conversation. While the Claude works, "Enviar" is a SplitButton: click =
// queue, menu = "Interromper e mandar agora" (`interrupt-first`). The unsent text left in the terminal box
// shows up as a `Banner·waiting` above the field (T065).

import { Banner, Button, Composer, Kbd, TextArea } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import {
  buildPromptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryPosition,
} from '../../../../shared/chat/t3/promptHistory';
import type { ConversationRow } from '../../../../shared/chat/rows';
import type { SendDriver, SendItemView } from '../sendDriver';
import { getDraft, setDraft, subscribeDraft } from './tabSend';
import styles from './ChatComposer.module.css';

export interface ChatComposerProps {
  tabId: string;
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
  /** Plan adjustment mode (T078): the box becomes the adjustment field; the ordinary draft is kept aside. */
  adjust?: PlanAdjustMode | null;
}

export interface PlanAdjustMode {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

const isComposing = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.nativeEvent.isComposing || event.keyCode === 229;

const LEFTOVER_PREVIEW = 80;
const preview = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LEFTOVER_PREVIEW ? `${flat.slice(0, LEFTOVER_PREVIEW)}…` : flat;
};

function ChatComposerMain({ tabId, driver, rows, working, active, items, onOpenTerminal }: ChatComposerProps): React.JSX.Element {
  const draft = useSyncExternalStore(
    useCallback((cb) => subscribeDraft(tabId, cb), [tabId]),
    () => getDraft(tabId),
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);
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
      if (text.trim() === '') return;
      historyPosition.current = null;
      setDraft(tabId, '');
      driver.enqueue({ text, mode });
    },
    [tabId, driver],
  );

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
    ) : undefined;

  const mono = draft.startsWith('/') || draft.startsWith('!');

  return (
    <div className={styles.wrap} data-testid="chat-composer">
      <Composer
        working={working}
        sendDisabled={draft.trim() === ''}
        onSend={() => submit('normal')}
        onInterruptAndSend={() => submit('interrupt-first')}
        banner={banner}
        footerHint
        fluid
      >
        <TextArea
          ref={areaRef}
          appearance="bare"
          aria-label="Mensagem para o Claude"
          placeholder="Escreva para o Claude"
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          mono={mono}
          maxRows={10}
          data-testid="chat-composer-input"
        />
      </Composer>
    </div>
  );
}

/**
 * T05: while a plan waits for adjustment the box turns into its field - accent border, "Ajuste no plano" tag,
 * "Enviar ajuste" / "Cancelar". Enter sends, Shift+Enter breaks the line, Esc cancels (D-C24, case 2). The
 * ordinary draft lives in tabSend.ts and is untouched; it is back when the field closes. No sending state: the
 * mode closes as soon as the text leaves.
 */
function PlanAdjustBox({ adjust }: { adjust: PlanAdjustMode }): React.JSX.Element {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    areaRef.current?.focus();
  }, []);
  const submit = (): void => {
    const value = text.trim();
    if (value !== '') adjust.onSubmit(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isComposing(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      adjust.onCancel();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className={styles.wrap} data-testid="chat-composer" data-mode="adjust">
      <Composer
        adjust
        sendLabel="Enviar ajuste"
        sendDisabled={text.trim() === ''}
        onSend={submit}
        fluid
        footerHint={
          <>
            <Button variant="ghost" onClick={adjust.onCancel} data-testid="pending-plan-adjust-cancel">
              Cancelar
            </Button>
            O Claude refaz o plano. Nada é editado antes da sua aprovação. · <Kbd>Esc</Kbd> cancela · <Kbd>Enter</Kbd> envia ·{' '}
            <Kbd>Shift+Enter</Kbd> quebra a linha
          </>
        }
      >
        <TextArea
          ref={areaRef}
          appearance="bare"
          aria-label="O que mudar no plano"
          placeholder="O que mudar no plano"
          value={text}
          onChange={setText}
          onKeyDown={onKeyDown}
          minRows={3}
          maxRows={10}
          data-testid="pending-plan-adjust-input"
        />
      </Composer>
    </div>
  );
}

export function ChatComposer(props: ChatComposerProps): React.JSX.Element {
  if (props.adjust) return <PlanAdjustBox adjust={props.adjust} />;
  return <ChatComposerMain {...props} />;
}
