import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@donel-dev/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseClaudeNotFound } from '../../shared';
import type { PtyExitInfo } from '../../shared';
import styles from './TerminalPane.module.css';

// T004 deu a base (xterm + PtyManager). T005 liga a aba a uma sessão claude
// de verdade (FR-006, plan.md ponto 1): resolução do executável no main
// process (CA-5 se não achar), estado "sessão encerrada" no corpo do
// terminal quando o processo `claude` sai sozinho (ações Reabrir/Fechar aba,
// ui-spec §2 "Estados da vista"). Abas múltiplas / fechar de verdade na
// barra de abas chegam em T010 — `onCloseTab` ausente = a própria aba mostra
// um estado neutro de "fechada" em vez de fingir remover a aba da barra.

const XTERM_THEME = {
  background: '#0e1116',
  foreground: '#d7dde5',
  cursor: '#4c9cf0',
  cursorAccent: '#0e1116',
  selectionBackground: '#28303b',
};

type PaneStatus =
  | { kind: 'connecting' }
  | { kind: 'running' }
  | { kind: 'ended'; info: PtyExitInfo }
  | { kind: 'claude-not-found'; expectedPath: string }
  | { kind: 'closed' };

export interface TerminalPaneProps {
  /** 'claude' (T005) = sessão claude direta no PTY; 'shell' = terminal livre (FR-008, default T004). */
  sessionType?: 'shell' | 'claude';
  cwd?: string;
  /** Argv do Launcher (T008 — CommandBuilder, FR-003). Fixo por aba: só lido no spawn/reabertura, nunca muda no meio da sessão viva (isso é FR-011, T011). */
  args?: string[];
  /** Ação real de fechar a aba na barra de abas (T010). Sem isso, "Fechar aba" só mostra o estado neutro local. */
  onCloseTab?: () => void;
}

export function TerminalPane({ sessionType = 'shell', cwd, args, onCloseTab }: TerminalPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const unsubscribeDataRef = useRef<(() => void) | null>(null);
  const unsubscribeExitRef = useRef<(() => void) | null>(null);
  const disposedRef = useRef(false);
  const [status, setStatus] = useState<PaneStatus>({ kind: 'connecting' });

  const teardownPty = useCallback(() => {
    unsubscribeDataRef.current?.();
    unsubscribeExitRef.current?.();
    unsubscribeDataRef.current = null;
    unsubscribeExitRef.current = null;
    if (ptyIdRef.current) {
      window.donel.pty.kill(ptyIdRef.current);
      ptyIdRef.current = null;
    }
  }, []);

  const spawnSession = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    setStatus({ kind: 'connecting' });

    void window.donel.pty
      .create({ cols: term.cols, rows: term.rows, cwd, sessionType, args })
      .then((result) => {
        if (disposedRef.current) {
          window.donel.pty.kill(result.ptyId);
          return;
        }
        ptyIdRef.current = result.ptyId;
        setStatus({ kind: 'running' });

        unsubscribeDataRef.current = window.donel.pty.onData(result.ptyId, (data) => {
          term.write(data);
        });
        unsubscribeExitRef.current = window.donel.pty.onExit(result.ptyId, (info) => {
          ptyIdRef.current = null;
          setStatus({ kind: 'ended', info });
        });
      })
      .catch((error: unknown) => {
        if (disposedRef.current) return;
        const expectedPath = parseClaudeNotFound(error);
        if (expectedPath) {
          setStatus({ kind: 'claude-not-found', expectedPath });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        term.write(`\r\n\x1b[31mFalha ao iniciar o terminal: ${message}\x1b[0m\r\n`);
        setStatus({ kind: 'ended', info: { exitCode: -1 } });
      });
  }, [cwd, sessionType, args]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12.5,
      theme: XTERM_THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;

    term.onData((data) => {
      if (ptyIdRef.current) window.donel.pty.input(ptyIdRef.current, data);
    });

    spawnSession();

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyIdRef.current) window.donel.pty.resize(ptyIdRef.current, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      disposedRef.current = true;
      resizeObserver.disconnect();
      teardownPty();
      term.dispose();
      termRef.current = null;
    };
    // `spawnSession`/`teardownPty` são estáveis por sessão (mount único); recriar a
    // sessão em si é feito via `handleReopen`, não por dependência de efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReopen = useCallback(() => {
    disposedRef.current = false;
    termRef.current?.clear();
    spawnSession();
  }, [spawnSession]);

  const handleCloseTab = useCallback(() => {
    teardownPty();
    if (onCloseTab) {
      onCloseTab();
      return;
    }
    setStatus({ kind: 'closed' });
  }, [onCloseTab, teardownPty]);

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.container} data-testid="terminal-pane" />

      {status.kind === 'claude-not-found' ? (
        <div className={styles.overlay} data-testid="claude-not-found-banner">
          <div className={styles.banner}>
            <p className={styles.bannerTitle}>⚠ Claude Code não encontrado</p>
            <p className={styles.bannerText}>
              Não achamos o <code>claude</code> no PATH nem em{' '}
              <code className={styles.bannerPath}>{status.expectedPath}</code>.
            </p>
            <p className={styles.bannerHint}>Instale o Claude Code CLI ou adicione-o ao PATH e tente novamente.</p>
            <div className={styles.overlayActions}>
              <Button variant="primary" onClick={handleReopen}>
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {status.kind === 'ended' ? (
        <div className={styles.overlay} data-testid="session-ended-overlay">
          <div className={styles.banner}>
            <p className={styles.bannerTitle}>Sessão encerrada</p>
            <p className={styles.bannerText}>
              O processo saiu{status.info.exitCode !== undefined ? ` (código ${status.info.exitCode})` : ''}.
            </p>
            <div className={styles.overlayActions}>
              <Button variant="primary" onClick={handleReopen}>
                Reabrir
              </Button>
              <Button variant="secondary" onClick={handleCloseTab}>
                Fechar aba
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {status.kind === 'closed' ? (
        <div className={styles.overlay} data-testid="tab-closed-placeholder">
          <div className={styles.banner}>
            <p className={styles.bannerText}>Aba fechada.</p>
            <div className={styles.overlayActions}>
              <Button variant="primary" onClick={handleReopen}>
                Nova sessão
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
