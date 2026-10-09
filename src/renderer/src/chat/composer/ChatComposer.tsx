// 014-chat (T067/T069) - the composer of the chat view: a design-system `TextArea` inside `Composer`.
// Enter sends, Shift+Enter breaks the line; the draft lives per tab in memory (`tabSend.ts`); ArrowUp walks
// back through the prompts of the conversation. While the Claude works, "Enviar" is a SplitButton: click =
// queue, menu = "Interromper e mandar agora" (`interrupt-first`). The unsent text left in the terminal box
// shows up as a `Banner·waiting` above the field (T065). Images (T088): Ctrl+V / drop / the paperclip save the
// picture through the main (`chat:save-image`) and show a removable thumbnail above the text; a non-image file
// from the paperclip or a drop becomes an `@` mention in the text. The draft keeps the images too.
// T087: `/` at the start of the message and `@path` open a menu above the box (`CommandMenu`): arrows move, Tab
// and Enter pick, Esc closes (`/mod` + Enter completes to `/model `; with the token already whole, Enter sends).
// T089: a paste of more than 20 lines or 2.000 characters becomes a "texto colado" chip (`PastedTexts`) that goes
// back into the message in full on send; a message starting with `!` (or `/login`, `/logout`) shows a seal.
// CLI shortcuts (`cliShortcuts.ts`): most are written to the terminal as the CLI would get them; Alt+P and a bare
// `/model` open a model picker in this same menu (the CLI's own picker only exists in the terminal), Ctrl+O
// toggles the work folds and Ctrl+Enter is "Interromper e mandar agora".

import { AnnotationTag, Banner, Button, Composer, Kbd, TextArea, listboxOptionId } from '@donel-dev/design-system';
import { Paperclip, SquareTerminal } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { ACCOUNT_COMMAND_WARNING, filterCatalog, inspectTypedCommand } from '../../../../shared/chat/commandCatalog';
import type { CommandEntry } from '../../../../shared/chat/ipc';
import {
  buildPromptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryPosition,
} from '../../../../shared/chat/t3/promptHistory';
import { resolveComposerMenuActiveItemId } from '../../../../shared/chat/t3/composerMenuHighlight';
import { detectComposerTrigger } from '../../../../shared/chat/t3/composerTrigger';
import {
  dismissTrigger,
  initialTriggerState,
  resetTrigger,
  setTrigger,
  type ComposerTriggerState,
} from '../../../../shared/chat/t3/composerTriggerState';
import type { ConversationRow } from '../../../../shared/chat/rows';
import type { SendDriver, SendItemView } from '../sendDriver';
import { getChatStore } from '../ChatStore';
import { shortcutFor } from '../cliShortcuts';
import type { ModelAlias } from '../../../../shared/commandBuilder';
import { forwardShortcut, permissionModeLabel, useScreenPermissionMode, type ModeTerminal } from '../cycleMode';
import { Attachments } from './Attachments';
import { appendMention, canSend, imageTypeOf, mentionFor, sendRequestOf, type DraftImage } from './attachmentsModel';
import { CommandMenu, rowIdsOf, type MenuRows } from './CommandMenu';
import { MODEL_CHOICES, insertionFor, isBareModelCommand, isTokenComplete, menuKeyAction, modelCommandText, modelMenuKeyAction, stepHighlight } from './composerMenu';
import { PastedTexts } from './PastedTexts';
import { isLargePaste, makePaste } from './pastedText';
import {
  getDraft,
  getDraftImages,
  getDraftPastes,
  setDraft,
  setDraftImages,
  setDraftPastes,
  subscribeDraft,
  subscribeDraftImages,
  subscribeDraftPastes,
} from './tabSend';
import styles from './ChatComposer.module.css';

export interface ChatComposerProps {
  tabId: string;
  /** PTY of the tab: images are saved against its conversation. `null` before the first spawn. */
  ptyId?: string | null;
  /** Folder of the tab: a file inside it is mentioned as `@relative`. */
  cwd?: string;
  /** The tab's terminal: Shift+Tab is written to it and the permission mode is read from its screen. `null` before it mounts. */
  terminal?: ModeTerminal | null;
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
  /** Ctrl+O: toggles every work fold of the timeline. */
  onToggleFolds?: () => void;
}

export interface PlanAdjustMode {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

const isComposing = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.nativeEvent.isComposing || event.keyCode === 229;

/** Rows the `/` menu shows at most (the rest is reached by typing more). */
const SLASH_MENU_LIMIT = 6;
/** Rows the `@` menu asks the main for. */
const PATH_MENU_LIMIT = 8;
/** Wait after the last keystroke before asking the main for files. */
const FILES_DEBOUNCE_MS = 80;

const LEFTOVER_PREVIEW = 80;
const preview = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LEFTOVER_PREVIEW ? `${flat.slice(0, LEFTOVER_PREVIEW)}…` : flat;
};

function ChatComposerMain({ tabId, ptyId = null, cwd, terminal = null, driver, rows, working, active, items, onOpenTerminal, onToggleFolds }: ChatComposerProps): React.JSX.Element {
  const draft = useSyncExternalStore(
    useCallback((cb) => subscribeDraft(tabId, cb), [tabId]),
    () => getDraft(tabId),
  );
  const images = useSyncExternalStore(
    useCallback((cb) => subscribeDraftImages(tabId, cb), [tabId]),
    () => getDraftImages(tabId),
  );
  const pastes = useSyncExternalStore(
    useCallback((cb) => subscribeDraftPastes(tabId, cb), [tabId]),
    () => getDraftPastes(tabId),
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyPosition = useRef<PromptHistoryPosition | null>(null);
  const pendingCaret = useRef<{ value: string; cursor: number } | null>(null);

  // --- menus `/` and `@` (T087)
  const [trigState, setTrigState] = useState<ComposerTriggerState>(() => initialTriggerState());
  const [highlight, setHighlight] = useState<{ id: string | null; key: string | null }>({ id: null, key: null });
  const [catalog, setCatalog] = useState<readonly CommandEntry[]>([]);
  const [fileResults, setFileResults] = useState<{ readonly query: string; readonly paths: readonly string[] }>({ query: '', paths: [] });
  const [modelMenu, setModelMenu] = useState(false);
  const listId = useId();
  const trigger = trigState.trigger;
  const slashOpen = trigger?.kind === 'slash-command';
  const pathQuery = trigger?.kind === 'path' ? trigger.query : null;

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

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    const el = areaRef.current;
    if (pending === null || el === null || el.value !== pending.value) return;
    pendingCaret.current = null;
    el.setSelectionRange(pending.cursor, pending.cursor);
  });

  // The catalog is read when the tab appears and again each time the `/` menu opens (the main caches by folder).
  useEffect(() => {
    if (ptyId === null) return undefined;
    let live = true;
    void getChatStore()
      .catalog(ptyId)
      .then((entries) => {
        if (live) setCatalog(entries);
      });
    return () => {
      live = false;
    };
  }, [ptyId, slashOpen]);

  // Custom commands/skills win over a native command of the same name (decides `skill` vs `native` on send).
  const customNames = useMemo(() => new Set(catalog.filter((entry) => entry.source !== 'builtin').map((entry) => entry.name)), [catalog]);
  const customRef = useRef(customNames);
  customRef.current = customNames;

  useEffect(() => {
    if (ptyId === null || pathQuery === null) {
      setFileResults({ query: '', paths: [] });
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      void getChatStore()
        .files(ptyId, pathQuery, PATH_MENU_LIMIT)
        .then((paths) => {
          if (live) setFileResults({ query: pathQuery, paths });
        });
    }, FILES_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ptyId, pathQuery]);

  const menuRows = useMemo<MenuRows | null>(() => {
    if (modelMenu) return { kind: 'model', models: MODEL_CHOICES };
    if (trigger === null) return null;
    if (trigger.kind === 'slash-command') return { kind: 'slash', entries: filterCatalog(catalog, trigger.query, SLASH_MENU_LIMIT), total: catalog.length };
    // Results of a SHORTER query are kept while the next ones load (typing narrows, so they are still a fair
    // superset); results of any other query are not shown: Tab must never pick a row of a stale search.
    const fresh = trigger.query.startsWith(fileResults.query);
    return { kind: 'path', paths: fresh ? fileResults.paths : [] };
  }, [modelMenu, trigger, catalog, fileResults]);
  const menuIds = useMemo(() => (menuRows === null ? [] : rowIdsOf(menuRows)), [menuRows]);
  const searchKey = modelMenu ? 'model:' : trigger === null ? null : `${trigger.kind}:${trigger.query}`;
  const activeId = resolveComposerMenuActiveItemId({
    items: menuIds.map((id) => ({ id })),
    highlightedItemId: highlight.id,
    currentSearchKey: searchKey,
    highlightedSearchKey: highlight.key,
  });
  const menuOpen = menuRows !== null && menuIds.length > 0;

  const syncTrigger = useCallback((text: string, caret: number) => {
    const candidate = detectComposerTrigger(text, caret);
    setTrigState((state) => setTrigger(state, candidate));
  }, []);

  const onChange = useCallback(
    (value: string, event: { target: HTMLTextAreaElement }) => {
      setDraft(tabId, value);
      setModelMenu(false);
      syncTrigger(value, event.target.selectionStart);
    },
    [tabId, syncTrigger],
  );

  /** A pick of the model menu: `/model <alias>` leaves through the ordinary send path (card, "entrou"). */
  const chooseModel = useCallback(
    (alias: ModelAlias) => {
      setModelMenu(false);
      driver.enqueue(sendRequestOf(modelCommandText(alias), [], 'normal', { customCommands: customRef.current }));
    },
    [driver],
  );

  /** Puts the picked row where the trigger was (`/name ` or `@path `) and the caret right after it. */
  const pick = useCallback(
    (id: string) => {
      if (menuRows?.kind === 'model') {
        const alias = menuRows.models.find((m) => m === id);
        if (alias !== undefined) chooseModel(alias);
        return;
      }
      if (trigger === null || menuRows === null) return;
      const text = getDraft(tabId);
      let inserted: { text: string; cursor: number } | null = null;
      if (menuRows.kind === 'slash') {
        const entry = menuRows.entries.find((e) => e.name === id);
        if (entry !== undefined) inserted = insertionFor(text, trigger, { kind: 'command', entry });
      } else if (menuRows.paths.includes(id)) {
        inserted = insertionFor(text, trigger, { kind: 'file', path: id });
      }
      if (inserted === null) return;
      const result = inserted;
      setDraft(tabId, result.text);
      setTrigState((state) => resetTrigger(state, null));
      // The caret is placed in a layout effect (below), before the next keystroke: a frame later it would land
      // in the middle of what the owner already typed after the Tab.
      pendingCaret.current = { value: result.text, cursor: result.cursor };
    },
    [tabId, trigger, menuRows, chooseModel],
  );

  const submit = useCallback(
    (mode: 'normal' | 'interrupt-first') => {
      const text = getDraft(tabId);
      const attached = getDraftImages(tabId);
      const pasted = getDraftPastes(tabId);
      if (!canSend(text, attached, pasted)) return;
      // A bare `/model` would open the CLI picker, which only exists in the terminal: the chat's own opens instead.
      if (attached.length === 0 && pasted.length === 0 && isBareModelCommand(text)) {
        setDraft(tabId, '');
        setTrigState(initialTriggerState());
        setModelMenu(true);
        return;
      }
      historyPosition.current = null;
      setDraft(tabId, '');
      setDraftImages(tabId, []);
      setDraftPastes(tabId, []);
      setImageError(null);
      setTrigState(initialTriggerState());
      driver.enqueue(sendRequestOf(text, attached, mode, { pastes: pasted, customCommands: customRef.current }));
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

  const removePaste = useCallback(
    (id: string) => {
      setDraftPastes(
        tabId,
        getDraftPastes(tabId).filter((paste) => paste.id !== id),
      );
      areaRef.current?.focus();
    },
    [tabId],
  );

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const data = event.clipboardData;
    // A paste too big for the box becomes a chip (FR-016); it goes back into the message on send.
    const pastedText = data.getData('text/plain');
    if (isLargePaste(pastedText)) {
      event.preventDefault();
      const kept = getDraftPastes(tabId);
      setDraftPastes(tabId, [...kept, makePaste(`paste-${Date.now()}-${kept.length}`, pastedText)]);
      return;
    }
    const files = [...data.files].filter((file) => imageTypeOf(file) !== null);
    // Text wins when the clipboard has both (a spreadsheet copies its cells AND a picture of them).
    if (files.length === 0 || pastedText !== '') return;
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

  const mode = useScreenPermissionMode(terminal);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isComposing(event)) return;
    // Menu open: arrows move, Tab picks, Esc closes (marked handled so it does not reach the Parar of the view).
    // Enter picks the highlighted row too, unless the token already is that row (then it sends).
    const tokenComplete = !modelMenu && trigger !== null && isTokenComplete(trigger.query, activeId);
    const menuAction = menuOpen ? (modelMenu ? modelMenuKeyAction(event, menuIds.length) : menuKeyAction(event, menuIds.length, tokenComplete)) : null;
    if (menuAction !== null) {
      event.preventDefault();
      if (menuAction === 'close') {
        if (modelMenu) setModelMenu(false);
        else setTrigState((state) => dismissTrigger(state, state.trigger));
      }
      else if (menuAction === 'choose') {
        if (activeId !== null) pick(activeId);
      } else setHighlight({ id: stepHighlight(menuIds, activeId, menuAction), key: searchKey });
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      submit('normal');
      return;
    }
    // CLI shortcuts (Shift+Tab cycles the permission mode, Alt+O fast mode...): written to the terminal instead of
    // doing what the browser would. The native ones have a chat answer (picker, folds, send now).
    const shortcut = shortcutFor(event);
    if (shortcut !== null) {
      event.preventDefault();
      if (shortcut.kind === 'forward') forwardShortcut(terminal, shortcut.bytes);
      else if (shortcut.action === 'modelPicker') setModelMenu(true);
      else if (shortcut.action === 'toggleFolds') onToggleFolds?.();
      else submit(working ? 'interrupt-first' : 'normal');
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
      setTrigState(initialTriggerState());
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
  // FR-018: a message starting with `!` runs in the shell; `/login` and `/logout` change the account behind the app.
  const shellSeal = draft.trimStart().startsWith('!');
  const accountSeal = !shellSeal && inspectTypedCommand(draft, customNames).accountWarning;

  return (
    <div className={styles.wrap} data-testid="chat-composer" onDragOver={onDragOver} onDrop={onDrop}>
      <div className={styles.stack}>
        {menuOpen && menuRows !== null ? (
          <div className={styles.menu}>
            <CommandMenu
              rows={menuRows}
              query={trigger?.query ?? ''}
              activeId={activeId}
              listId={listId}
              onActiveChange={(id) => setHighlight({ id, key: searchKey })}
              onSelect={pick}
            />
          </div>
        ) : null}
        <Composer
          working={working}
          sendDisabled={!canSend(draft, images, pastes)}
          onSend={() => submit('normal')}
          onInterruptAndSend={() => submit('interrupt-first')}
          banner={banner}
          leading={paperclip}
          footerHint={
            <>
              <Kbd>Enter</Kbd> envia (com o menu aberto, escolhe) · <Kbd>Shift+Enter</Kbd> quebra linha · <Kbd>Shift+Tab</Kbd>{' '}
              <span data-testid="chat-composer-mode">{mode === null ? 'alterna o modo' : `modo: ${permissionModeLabel(mode)}`}</span> · <Kbd>Alt+P</Kbd> modelo
            </>
          }
          fluid
        >
          {/* Thumbnails and pasted-text chips sit above the text, inside the box (design T06 "Anexos"). */}
          <Attachments images={images} onRemove={removeImage} />
          <PastedTexts pastes={pastes} onRemove={removePaste} />
          {shellSeal || accountSeal ? (
            <div className={styles.seals}>
              <AnnotationTag tone="warn">
                <span className={styles.seal} data-testid={shellSeal ? 'chat-composer-seal-shell' : 'chat-composer-seal-account'}>
                  <SquareTerminal size={12} strokeWidth={2} aria-hidden="true" />
                  {shellSeal ? 'vai rodar como comando de shell' : ACCOUNT_COMMAND_WARNING}
                </span>
              </AnnotationTag>
            </div>
          ) : null}
          <TextArea
            ref={areaRef}
            appearance="bare"
            aria-label="Mensagem para o Claude"
            placeholder="Escreva para o Claude"
            value={draft}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onSelect={(event) => syncTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
            onPaste={onPaste}
            aria-autocomplete="list"
            aria-controls={menuOpen ? listId : undefined}
            aria-activedescendant={menuOpen && activeId !== null ? listboxOptionId(listId, Math.max(0, menuIds.indexOf(activeId))) : undefined}
            mono={mono}
            maxRows={10}
            data-testid="chat-composer-input"
          />
        </Composer>
      </div>
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
