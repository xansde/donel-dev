// Item 18 (PDA mindscape-openrig) — the conversation with the Jobu as Líder, as a comic bubble that comes out of the Jobu.
//
// The form chosen on 03/11 (docs/prototipos/mindscape-openrig/decisao.md): the Líder's last line in focus (written letter
// by letter), the history folded under ≡, one-click answers, a "você:" field, and a red edge when something waits for the
// owner. Who waits for him shows inside the bubble, each with a button to its tab: the click on the Jobu always opens
// the bubble. The conversation is the Líder tab's own (chat of the 014, read in THIS window); what the owner writes goes
// to the main window, which sends it through the tab's send machine. The bubble lives in the pet window, which grows
// upwards to hold it (`view.talk` is its height) and moves with the Jobu when he is dragged.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationRow } from '../../../shared/chat/rows';
import type { LiderState } from '../../../shared/lider/ipc';
import type { PetView } from '../../../shared/pet/types';
import { Markdown } from '../chat/markdown';
import { PendingPanel } from '../chat/pending/PendingPanel';
import { useChatSession } from '../chat/useChatSession';
import styles from './LiderTalk.module.css';

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

/** Writes `text` letter by letter when it changes (a new answer), quickly, all of it in about 1.5 s. */
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

/** The pose of the Jobu while he talks: surprised when the owner is needed, reading while the Líder works, laughing when it went well. */
export type TalkPose = 'surprised' | 'reading' | 'laughing' | 'talking' | 'sad' | 'neutral';

export interface LiderTalkProps {
  readonly view: PetView;
  readonly onClose: () => void;
  /** The pose the Jobu takes for what is being said. */
  readonly onPose: (pose: TalkPose) => void;
}

export function LiderTalk({ view, onClose, onPose }: LiderTalkProps): React.JSX.Element {
  const [state, setState] = useState<LiderState | null>(null);
  const session = useChatSession(state?.ptyId ?? null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const off = window.donel.lider.onState(setState);
    void window.donel.lider.getState().then((first) => {
      if (first !== null) setState((current) => current ?? first);
    });
    return off;
  }, []);

  // The window takes the keyboard when the bubble opens: the field is ready to type in.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc closes the bubble, like a click on the Jobu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const lines = useMemo(() => linesOf(session.rows), [session.rows]);
  const lastLider = [...lines].reverse().find((line) => line.who === 'lider') ?? null;
  const typed = useTypewriter(lastLider?.id ?? null, lastLider?.text ?? '');
  const pendings = session.live?.pendings ?? [];
  const status = session.live?.status ?? null;
  const liderNeedsYou = pendings.length > 0 || status === 'waiting-you' || status === 'terminal-needed';
  const urgent = liderNeedsYou || view.waiting.length > 0;
  const working = status === 'working' || status === 'starting';

  const pose: TalkPose = error !== null ? 'sad' : urgent ? 'surprised' : working ? 'reading' : lastLider !== null ? (status === 'idle' ? 'laughing' : 'talking') : 'neutral';
  useEffect(() => onPose(pose), [onPose, pose]);

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
  const noProject = state !== null && state.projectPath === null;

  return (
    <div
      className={styles.talk}
      data-hit
      data-testid="pet-talk"
      data-align={view.align}
      data-urgent={urgent ? 'true' : 'false'}
      role="dialog"
      aria-label="Conversa com o Líder"
      style={{ height: view.talk }}
    >
      <div className={styles.top}>
        <span className={styles.title}>
          Líder{project ? <span className={styles.project}> · {project}</span> : null}
        </span>
        <button type="button" className={styles.tool} aria-pressed={historyOpen} title="Histórico da conversa" onClick={() => setHistoryOpen((open) => !open)}>
          ≡
        </button>
        <button type="button" className={styles.tool} disabled={state?.tabId == null} title="Abrir a aba do Líder no Donel" onClick={() => window.donel.lider.showTab()}>
          ↗
        </button>
        <button type="button" className={styles.tool} title="Fechar (Esc)" data-testid="pet-talk-close" onClick={onClose}>
          ✕
        </button>
      </div>

      {historyOpen ? (
        <div className={styles.body} data-testid="pet-talk-history">
          {lines.length === 0 ? <p className={styles.muted}>Nada conversado ainda.</p> : null}
          {lines.map((line) => (
            <div key={line.id} className={line.who === 'voce' ? styles.histYou : styles.histLider}>
              <span className={styles.who}>{line.who === 'voce' ? 'você' : 'Líder'}</span>
              {line.who === 'lider' ? <Markdown source={line.text} onOpenExternal={(url) => void session.openExternal(url)} /> : <p className={styles.plain}>{line.text}</p>}
            </div>
          ))}
          <div ref={historyEnd} />
        </div>
      ) : (
        <div className={styles.body} data-testid="pet-talk-last">
          {state === null ? (
            <p className={styles.muted}>Um instante…</p>
          ) : noProject ? (
            <p>Abra um projeto no Donel e eu cuido do time dele.</p>
          ) : lastLider === null ? (
            <p>
              {state.ptyId === null ? `Me diga o que fazer em ${project ?? 'este projeto'}. Eu monto o time e te aviso do que precisar.` : working ? 'Pensando…' : 'Pronto. O que fazemos?'}
              {!state.roleAvailable && state.ptyId === null ? <span className={styles.muted}> (O papel Líder não existe nesta máquina: a sessão abre sem papel.)</span> : null}
            </p>
          ) : (
            <Markdown source={typed} onOpenExternal={(url) => void session.openExternal(url)} />
          )}
          {working ? <p className={styles.working}>trabalhando…</p> : null}
        </div>
      )}

      {view.waiting.length > 0 ? (
        <div className={styles.waiting} data-testid="pet-talk-waiting">
          <span className={styles.waitingTitle}>Esperando você</span>
          {view.waiting.map((entry) => (
            <button key={entry.ptyId} type="button" className={styles.waitingItem} title={`Ir para ${entry.name}`} onClick={() => window.donel.pet.open({ kind: 'session', ptyId: entry.ptyId })}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.waitingName}>{entry.name}</span>
              <span className={styles.waitingAge}>{entry.waitingLabel}</span>
              <span className={styles.go} aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {state?.ptyId && pendings.length > 0 ? (
        <div className={styles.pendings}>
          <PendingPanel
            ptyId={state.ptyId}
            pendings={pendings}
            adjustingPlanId={null}
            onAnswer={(pendingId, answer) => void session.answer(pendingId, answer)}
            onAdjustStart={() => window.donel.lider.showTab()}
            onOpenExternal={(url) => void session.openExternal(url)}
          />
        </div>
      ) : null}

      <div className={styles.quick}>
        {QUICK_REPLIES.map((reply) => (
          <button key={reply} type="button" className={styles.quickButton} disabled={sending || noProject || state === null} onClick={() => void send(reply)}>
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
        <label className={styles.you} htmlFor="pet-talk-input">
          você:
        </label>
        <textarea
          ref={inputRef}
          id="pet-talk-input"
          data-testid="pet-talk-input"
          className={styles.input}
          value={draft}
          rows={2}
          placeholder={noProject ? 'Abra um projeto no Donel' : 'Enter envia, Shift+Enter quebra a linha'}
          disabled={noProject}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
      </form>
    </div>
  );
}
