// T054/T055 (014-chat) - the conversation column: rounds of rows, the Focus
// Mode fold bars, the "novas mensagens" pill and the scroll behaviour (R19).
// Every rule about WHEN to follow / show the pill / load older lives in
// `scrollController.ts` and `timelineModel.ts` (pure, tested); this component
// only measures the DOM and applies what they decide.

import { AnnotationTag, WorkFold } from '@donel-dev/design-system';
import { ArrowDown, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConversationRow } from '../../../shared/chat/rows';
import { renderRow, type RowRenderContext } from './renderRow';
import {
  INITIAL_SCROLL_STATE,
  classifyRowsChange,
  onRowsChange,
  onUserScroll,
  preservedScrollTop,
  restoreScrollTop,
  shouldLoadOlder,
  snapshotView,
  type ScrollMetrics,
  type ScrollState,
  type ViewSnapshot,
} from './scrollController';
import styles from './Timeline.module.css';
import { buildTimeline, formatElapsed, type TimelineItem } from './timelineModel';
import type { ChatSession } from './useChatSession';

export interface TimelineProps {
  /** Rows to show (ChatView may withhold the leading "conversa nova" notice while it is pinned on top). */
  rows: readonly ConversationRow[];
  session: Pick<ChatSession, 'status' | 'cursor' | 'loadingOlder' | 'live' | 'conversationVersion' | 'error' | 'loadOlder'>;
  focusMode: boolean;
  /** The tab is the active one AND on the chat view (the scroller has layout). */
  active: boolean;
  ctx: RowRenderContext;
}

type FoldItem = Extract<TimelineItem, { kind: 'fold' }>;

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function FoldBar({
  item,
  onToggle,
  ctx,
}: {
  item: FoldItem;
  onToggle: (key: string) => void;
  ctx: RowRenderContext;
}): React.JSX.Element {
  const live = item.endedAt === null;
  const now = useNow(live);
  const started = Date.parse(item.startedAt);
  const ended = live ? now : Date.parse(item.endedAt!);
  const elapsed = Number.isFinite(started) && Number.isFinite(ended) ? formatElapsed(ended - started) : undefined;
  return (
    <WorkFold
      state={item.state}
      label={item.label}
      elapsed={elapsed}
      badge={item.hasQuestion ? <AnnotationTag tone="warn">tem pergunta aqui</AnnotationTag> : undefined}
      expanded={item.expanded}
      onToggle={() => onToggle(item.key)}
    >
      {item.expanded ? (
        <div className={styles.foldRows}>
          {item.rows.map((row) => (
            <div key={row.id} className={styles.row}>
              {renderRow(row, ctx)}
            </div>
          ))}
        </div>
      ) : null}
    </WorkFold>
  );
}

const measure = (el: HTMLElement): ScrollMetrics => ({
  scrollTop: el.scrollTop,
  clientHeight: el.clientHeight,
  scrollHeight: el.scrollHeight,
});

export function Timeline({ rows, session, focusMode, active, ctx }: TimelineProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollState = useRef<ScrollState>(INITIAL_SCROLL_STATE);
  const lastMetrics = useRef<ScrollMetrics>({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 });
  const snapshot = useRef<ViewSnapshot | null>(null);
  const prevIds = useRef<string[]>([]);
  const [pill, setPill] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const setScrollState = useCallback((next: ScrollState): void => {
    scrollState.current = next;
    setPill(next.pill);
  }, []);

  const remember = useCallback((el: HTMLElement): void => {
    if (el.clientHeight === 0) return; // hidden (display: none) - keep the last real measure
    lastMetrics.current = measure(el);
    snapshot.current = snapshotView(scrollState.current, lastMetrics.current);
  }, []);

  // A switch of conversation (`/clear`, `/resume`, fork) forgets which folds were open.
  useEffect(() => {
    setExpanded(new Set());
  }, [session.conversationVersion]);

  const rounds = useMemo(
    () => buildTimeline(rows, { focusMode, live: session.live, expanded }),
    [rows, focusMode, session.live, expanded],
  );

  // Rows changed: decide follow / pill / preserve (before paint, so nothing jumps).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const ids = rows.map((r) => r.id);
    const change = classifyRowsChange(prevIds.current, ids);
    prevIds.current = ids;
    if (!el) return;
    const kind = change.kind === 'none' ? 'update' : change.kind;
    const { state, action } = onRowsChange(scrollState.current, { kind, added: change.added });
    if (action.kind === 'scroll-to-end') {
      el.scrollTop = el.scrollHeight;
    } else if (action.kind === 'preserve' && el.clientHeight > 0) {
      el.scrollTop = preservedScrollTop(lastMetrics.current.scrollTop, lastMetrics.current.scrollHeight, el.scrollHeight);
    }
    setScrollState(state);
    remember(el);
  }, [rows, remember, setScrollState]);

  // The view came back (tab activated / toggled to Chat): restore where the reader was.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!active || !el || el.clientHeight === 0) return;
    const saved = snapshot.current;
    if (saved === null) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = restoreScrollTop(saved, measure(el));
      setScrollState({ following: saved.following, pill: saved.pill });
    }
    remember(el);
  }, [active, remember, setScrollState]);

  // Content or viewport resized (images, a fold opened, window resize): keep following the end.
  useEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === 0) return;
      if (scrollState.current.following) el.scrollTop = el.scrollHeight;
      remember(el);
    });
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
  }, [remember]);

  // Near the top (or content shorter than the viewport) with older history left: load it.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!active || !el || el.clientHeight === 0) return;
    if (shouldLoadOlder(measure(el), session)) void session.loadOlder();
  }, [active, rows.length, session.status, session.cursor, session.loadingOlder, session]);

  const handleScroll = useCallback((): void => {
    const el = scrollerRef.current;
    if (!el || el.clientHeight === 0) return;
    const m = measure(el);
    setScrollState(onUserScroll(scrollState.current, m));
    remember(el);
    if (shouldLoadOlder(m, session)) void session.loadOlder();
  }, [remember, session, setScrollState]);

  const jumpToEnd = useCallback((): void => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setScrollState(INITIAL_SCROLL_STATE);
    remember(el);
  }, [remember, setScrollState]);

  const toggleFold = useCallback((key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const empty = rows.length === 0;
  return (
    <div className={styles.root}>
      <div
        ref={scrollerRef}
        className={styles.scroller}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversa"
        data-testid="chat-timeline"
      >
        <div ref={contentRef} className={styles.content}>
          {empty ? (
            <div className={styles.empty} data-testid="chat-empty">
              {session.status === 'error' ? (
                <span>Não consegui carregar a conversa{session.error ? `: ${session.error}` : '.'}</span>
              ) : session.status === 'ready' ? (
                <>
                  <span className={styles.emptyTitle}>Nada aqui ainda.</span>
                  <span className={styles.emptyHint}>O nome, o semáforo e o contexto da aba já acompanham a conversa.</span>
                </>
              ) : (
                <span>Carregando a conversa…</span>
              )}
            </div>
          ) : null}
          {rounds.map((round, index) => (
            <section
              key={round.key}
              className={[styles.round, index < rounds.length - 1 ? styles.roundDeferred : ''].filter(Boolean).join(' ')}
              data-turn-id={round.turnId ?? undefined}
            >
              {round.items.map((item) =>
                item.kind === 'row' ? (
                  <div key={item.key} className={styles.row}>
                    {renderRow(item.row, ctx)}
                  </div>
                ) : (
                  <FoldBar key={item.key} item={item} onToggle={toggleFold} ctx={ctx} />
                ),
              )}
            </section>
          ))}
        </div>
      </div>
      {session.loadingOlder ? (
        <div className={styles.loadingOlder} data-testid="chat-loading-older">
          <LoaderCircle className={styles.spin} size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>carregando mensagens anteriores…</span>
        </div>
      ) : null}
      {pill ? (
        <div className={styles.pillHost}>
          <button type="button" className={styles.pill} onClick={jumpToEnd} data-testid="chat-new-messages-pill">
            novas mensagens
            <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
