// Item 18 (PDA mindscape-openrig) — the conversation with the Jobu as Líder, in its own floating window.
//
// The form chosen on 03/11 (docs/prototipos/mindscape-openrig/decisao.md): a comic bubble coming out of the Jobu with
// his last line in focus (written letter by letter), the pose following the subject (surprised when the owner is
// needed, reading while working, laughing when it went well), one-click answers, the history folded under ≡ and a
// "você:" field. The conversation is the Líder tab's own (chat of the 014, read through a store of THIS window);
// what the owner writes goes to the main window, which sends it through the tab's send machine.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiderState } from '../../../shared/lider/ipc';
import type { ConversationRow } from '../../../shared/chat/rows';
import { ChatStore } from '../chat/ChatStore';
import { Markdown } from '../chat/markdown';
import { PendingPanel } from '../chat/pending/PendingPanel';
import { useChatSession } from '../chat/useChatSession';
import laughing from '../pet/assets/poses/laughing.png';
import neutral from '../pet/assets/poses/neutral.png';
import reading from '../pet/assets/poses/reading.png';
import sad from '../pet/assets/poses/sad.png';
import surprised from '../pet/assets/poses/surprised.png';
import talking from '../pet/assets/poses/talking.png';
import styles from './LiderApp.module.css';

/** One line of the conversation as the bubble tells it: the owner's message or one whole answer of the Líder. */
interface Line {
  readonly id: string;
  readonly who: 'voce' | 'lider';
  readonly text: string;
}

function linesOf(rows: readonly ConversationRow[]): Line[] {
  const lines: Line[] = [];
  for (const row of rows) {
    if (row.kind === 'user') {
      if (row.text.trim()) lines.push({ id: row.id, who: 'voce', text: row.text });
      continue;
    }
    if (row.kind !== 'assistant') continue;
    const last = lines[lines.length - 1];
    // Consecutive text blocks of the Líder are one answer.
    if (last !== undefined && last.who === 'lider') lines[lines.length - 1] = { ...last, text: `${last.text}\n\n${row.markdown}` };
    else lines.push({ id: row.id, who: 'lider', text: row.markdown });
  }
  return lines;
}

/** Writes `text` letter by letter when it changes (a new answer), quickly, and all at once after ~1.5 s. */
function useTypewriter(key: string | null, text: string): string {
  const [shown, setShown] = useState(text);
  const lastKey = useRef<string | null>(key);
  useEffect(() => {
    if (key === lastKey.current) {
      setShown(text);
      return undefined;
    }
    lastKey.current = key;
    const step = Math.max(3, Math.ceil(text.length / 100));
    let at = 0;
    setShown('');
    const timer = setInterval(() => {
      at += step;
      setShown(text.slice(0, at));
      if (at >= text.length) clearInterval(timer);
    }, 15);
    return () => clearInterval(timer);
  }, [key, text]);
  return shown;
}

const QUICK_REPLIES = ['Segue', 'Como está o time?', 'O que precisa de mim?'];

export function LiderApp(): React.JSX.Element {
  const [state, setState] = useState<LiderState | null>(null);
  const store = useMemo(() => new ChatStore(window.donel.chat), []);
  const session = useChatSession(state?.ptyId ?? null, store);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = window.donel.lider.onState(setState);
    void window.donel.lider.getState().then((first) => setState((current) => current ?? first));
    return off;
  }, []);
  // No `store.dispose()` on unmount: the window closing is what ends this store, and the main lets go of every
  // conversation a destroyed window held (chat-ipc.ts). Disposing here would break the StrictMode remount.

  const lines = useMemo(() => linesOf(session.rows), [session.rows]);
  const lastLider = [...lines].reverse().find((line) => line.who === 'lider') ?? null;
  const typed = useTypewriter(lastLider?.id ?? null, lastLider?.text ?? '');
  const pendings = session.live?.pendings ?? [];
  const status = session.live?.status ?? null;
  const needsYou = pendings.length > 0 || status === 'waiting-you' || status === 'terminal-needed';
  const working = status === 'working' || status === 'starting';

  const pose = error !== null ? sad : needsYou ? surprised : working ? reading : lastLider !== null ? (status === 'idle' ? laughing : talking) : neutral;

  useEffect(() => {
    if (historyOpen) historyEnd.current?.scrollIntoView({ block: 'end' });
  }, [historyOpen, lines.length]);

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await window.donel.lider.send({ text: trimmed });
      if (result.ok) setDraft((current) => (current.trim() === trimmed ? '' : current));
      else setError(result.reason);
    } catch {
      setError('Não consegui entregar ao Donel.');
    } finally {
      setSending(false);
    }
  };

  const project = state?.projectName ?? null;
  const onTop = state?.alwaysOnTop ?? false;

  return (
    <div className={styles.root} data-urgent={needsYou ? 'true' : 'false'}>
      <header className={styles.header}>
        <div className={styles.title}>
          <strong>Jobu · Líder</strong>
          <span className={styles.project}>{project ?? 'sem projeto'}</span>
        </div>
        <div className={styles.tools}>
          <button type="button" className={styles.tool} aria-pressed={historyOpen} title="Histórico da conversa" onClick={() => setHistoryOpen((open) => !open)}>
            ≡
          </button>
          <button type="button" className={styles.tool} aria-pressed={onTop} title={onTop ? 'Deixar de ficar por cima' : 'Sempre por cima'} onClick={() => window.donel.lider.setOnTop(!onTop)}>
            {onTop ? '📌' : '📍'}
          </button>
          <button type="button" className={styles.tool} disabled={state?.tabId == null} title="Abrir a aba do Líder no Donel" onClick={() => window.donel.lider.showTab()}>
            ↗
          </button>
        </div>
      </header>

      {historyOpen ? (
        <div className={styles.history} data-testid="lider-history">
          {lines.length === 0 ? <p className={styles.muted}>Nada conversado ainda.</p> : null}
          {lines.map((line) => (
            <div key={line.id} className={line.who === 'voce' ? styles.histYou : styles.histLider}>
              <span className={styles.who}>{line.who === 'voce' ? 'você' : 'Líder'}</span>
              {line.who === 'lider' ? <Markdown source={line.text} onOpenExternal={(url) => void store.openExternal(url)} /> : <p className={styles.plain}>{line.text}</p>}
            </div>
          ))}
          <div ref={historyEnd} />
        </div>
      ) : (
        <div className={styles.stage}>
          <div className={styles.bubble} data-testid="lider-bubble">
            {state === null ? (
              <p className={styles.muted}>Abrindo…</p>
            ) : state.projectPath === null ? (
              <p>Escolha um projeto na barra lateral do Donel e eu cuido do time dele.</p>
            ) : lastLider === null ? (
              <p>
                {state.ptyId === null ? `Me diga o que fazer em ${project ?? 'este projeto'}. Eu abro o time e te aviso do que precisar.` : working ? 'Pensando…' : 'Pronto. O que fazemos?'}
                {!state.roleAvailable && state.ptyId === null ? <span className={styles.muted}> (O papel Líder ainda não existe nesta máquina: a sessão abre sem papel.)</span> : null}
              </p>
            ) : (
              <Markdown source={typed} onOpenExternal={(url) => void store.openExternal(url)} />
            )}
            {working ? <p className={styles.working}>trabalhando…</p> : null}
          </div>
          <img className={styles.jobu} src={pose} alt="" draggable={false} />
        </div>
      )}

      {state?.ptyId ? (
        <div className={styles.pendings}>
          <PendingPanel
            ptyId={state.ptyId}
            pendings={pendings}
            adjustingPlanId={null}
            onAnswer={(pendingId, answer) => void session.answer(pendingId, answer)}
            onAdjustStart={() => window.donel.lider.showTab()}
            onOpenExternal={(url) => void store.openExternal(url)}
          />
        </div>
      ) : null}

      <div className={styles.quick}>
        {QUICK_REPLIES.map((reply) => (
          <button key={reply} type="button" className={styles.quickButton} disabled={sending || state?.projectPath == null} onClick={() => void send(reply)}>
            {reply}
          </button>
        ))}
      </div>

      {error !== null ? <p className={styles.error}>{error}</p> : null}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label className={styles.you} htmlFor="lider-input">
          você:
        </label>
        <textarea
          id="lider-input"
          className={styles.input}
          value={draft}
          rows={2}
          placeholder={state?.projectPath ? 'Escreva para o Líder (Enter envia, Shift+Enter quebra a linha)' : 'Escolha um projeto no Donel'}
          disabled={state?.projectPath == null}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <button type="submit" className={styles.sendButton} disabled={sending || !draft.trim() || state?.projectPath == null}>
          {sending ? '…' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
