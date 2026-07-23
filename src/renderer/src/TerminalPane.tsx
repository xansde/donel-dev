import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import styles from './TerminalPane.module.css';

// T004 — 1 aba de terminal livre (FR-008), spawna powershell.exe -NoLogo via
// PtyManager (main process). Abas múltiplas / ciclo de vida de UI (fechar,
// reabrir, "sessão encerrada") chegam em T005/T010; aqui o terminal só existe
// enquanto o componente está montado.

// Tema casado com a paleta dark (ui-spec §1) — cursor na cor `accent`.
const XTERM_THEME = {
  background: '#0e1116',
  foreground: '#d7dde5',
  cursor: '#4c9cf0',
  cursorAccent: '#0e1116',
  selectionBackground: '#28303b',
};

export function TerminalPane(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    let disposed = false;
    let ptyId: string | null = null;
    let unsubscribeData: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;

    void window.donel.pty
      .create({ cols: term.cols, rows: term.rows })
      .then((result) => {
        if (disposed) {
          window.donel.pty.kill(result.ptyId);
          return;
        }
        ptyId = result.ptyId;

        unsubscribeData = window.donel.pty.onData(ptyId, (data) => {
          term.write(data);
        });
        unsubscribeExit = window.donel.pty.onExit(ptyId, () => {
          term.write('\r\n[90m[sessão encerrada][0m\r\n');
        });

        term.onData((data) => {
          if (ptyId) window.donel.pty.input(ptyId, data);
        });
      })
      .catch((error: unknown) => {
        term.write(`\r\n[31mFalha ao iniciar o terminal: ${String(error)}[0m\r\n`);
      });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyId) window.donel.pty.resize(ptyId, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      unsubscribeData?.();
      unsubscribeExit?.();
      if (ptyId) window.donel.pty.kill(ptyId);
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className={styles.container} data-testid="terminal-pane" />;
}
