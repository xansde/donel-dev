import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@donel-dev/design-system';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { parseClaudeNotFound } from '../../shared';
import type { PtyExitInfo, SemaphoreStateInfo } from '../../shared';
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
  /** Ação real de fechar a aba na barra de abas (T010): App.tsx remove a aba do array (unmount cuida do teardown do PTY). */
  onCloseTab?: () => void;
  /**
   * T009 — semáforo de sessões (FR-010). TerminalPane é quem conhece o
   * `ptyId` de verdade (nasce da resposta de `pty.create`, nunca sobe pro
   * App.tsx) — por isso é ele quem assina `semaphore.onUpdate` e "levanta" o
   * estado pro pai (sidebar/tab bar, ui-spec §2/§3) via este callback, em vez
   * do App.tsx tentar re-derivar o ptyId por fora.
   */
  onStateChange?: (info: SemaphoreStateInfo) => void;
  /**
   * T010 — FR-006: "fechar aba com sessão ativa (processo vivo) pede
   * confirmação". App.tsx só sabe se HÁ um processo vivo através deste sinal
   * (funciona tanto para sessão claude quanto para terminal livre — o
   * semáforo, ao contrário, só existe para 'claude'). `true` só quando
   * `status.kind === 'running'`.
   */
  onAliveChange?: (alive: boolean) => void;
}

/**
 * T011 (FR-011) — handle imperativo exposto via `ref`: quem chama decide
 * SE deve injetar (gate de estado ocioso, `canInjectLiveCommand` em
 * `shared/liveSessionInjection.ts`, aplicado em App.tsx/SessionDetails);
 * este componente só é "a boca pro stdin", igual ao próprio `term.onData`
 * (teclado real) já é — o `ptyId` continua nunca subindo pro App.tsx
 * (comentário de `onStateChange` acima), só o efeito de escrever nele.
 */
/**
 * Últimas linhas do buffer JÁ RENDERIZADO pelo xterm — generoso o bastante
 * (200, bem mais que uma tela de terminal normal) pra sobreviver a um
 * diálogo interativo do CLI (ex.: "Switch model?") sem perder a linha de
 * confirmação, sem varrer o scrollback inteiro (5000 linhas, `scrollback`
 * abaixo) a cada checagem.
 */
const RENDERED_TAIL_LINES = 200;

export interface TerminalPaneHandle {
  /** Escreve `command` no stdin do PTY desta aba. Devolve `false` (no-op) sem processo vivo — quem chama decide o que fazer com isso (ex.: degradação FR-011 "reiniciar com a flag"). */
  injectCommand: (command: string) => boolean;
  /**
   * T013 (correção herdada) — últimas ~200 linhas do buffer JÁ RENDERIZADO
   * do xterm (`term.buffer.active`). Duas alternativas foram tentadas e
   * DESCARTADAS rodando contra o CLI real (não fixture) antes desta —
   * detalhes em shared/liveSessionInjection.ts: (1) o ring buffer do main
   * process (`window.donel.pty.getPreview`) só fecha linha em `\n`/`\r\n`
   * real; (2) acumular o BYTE STREAM bruto (ANSI stripado) também falhou —
   * o achado foi que um redraw incremental (interface tipo Ink) pode
   * compor o texto final combinando um write NOVO com conteúdo que já
   * estava na grade do terminal, então "Set model to Sonnet 5" nunca
   * aparece como substring contígua no stream bruto, só no resultado JÁ
   * EMULADO pelo parser do xterm. Por isso a fonte tem que ser o buffer
   * renderizado — e pra não perder um frame TRANSIENTE (a confirmação
   * também some rápido, sobrescrita pelo próximo redraw), quem chama isso
   * faz via `onRenderedUpdate` (evento, não poll) logo abaixo, nunca
   * `setInterval`. `[]` sem terminal montado.
   */
  getRenderedLines: () => string[];
  /**
   * T013 (correção herdada) — notifica `listener` toda vez que um chunk de
   * output do PTY terminou de ser processado pelo parser do xterm (usa o
   * callback de conclusão do `term.write`, não um `setInterval` — só assim
   * garante ver um frame TRANSIENTE antes do próximo redraw sobrescrever
   * por cima; ver comentário de `getRenderedLines`). Retorna função de
   * unsubscribe.
   */
  onRenderedUpdate: (listener: () => void) => () => void;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { sessionType = 'shell', cwd, args, onCloseTab, onStateChange, onAliveChange },
  ref
): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const unsubscribeDataRef = useRef<(() => void) | null>(null);
  const unsubscribeExitRef = useRef<(() => void) | null>(null);
  const unsubscribeSemaphoreRef = useRef<(() => void) | null>(null);
  const disposedRef = useRef(false);
  // T013 (correção herdada) — assinantes de `onRenderedUpdate`, notificados a
  // cada chunk de PTY já processado pelo parser do xterm (ver comentário do
  // handle acima pro porquê de ser evento, não poll).
  const renderListenersRef = useRef(new Set<() => void>());
  const [status, setStatus] = useState<PaneStatus>({ kind: 'connecting' });

  // Ref pra sempre chamar a versão mais recente do callback sem precisar
  // re-assinar `semaphore.onUpdate` a cada render (o pai passa uma arrow
  // function nova a cada vez — o mesmo problema que `cwd`/`args` já evitam
  // ao serem lidos só no spawn inicial, ver eslint-disable mais abaixo).
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onAliveChangeRef = useRef(onAliveChange);
  onAliveChangeRef.current = onAliveChange;

  // T010 — reporta pro pai sempre que a "vivacidade" do processo muda (não
  // a cada render, só quando `status.kind` de fato transiciona) — é o sinal
  // que o App.tsx usa pra decidir se o "Fechar aba" da barra de abas precisa
  // de confirmação (FR-006). Roda para 'shell' e 'claude' igualmente.
  useEffect(() => {
    onAliveChangeRef.current?.(status.kind === 'running');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind]);

  // T011 (FR-011) — `injectCommand` lê `ptyIdRef` no momento da CHAMADA (não
  // captura o valor no momento em que o handle foi criado), por isso não
  // precisa de dependências: mesmo padrão de `term.onData` (linha ~161
  // abaixo), que também lê `ptyIdRef.current` "ao vivo" a cada tecla.
  useImperativeHandle(
    ref,
    () => ({
      injectCommand: (command: string): boolean => {
        if (!ptyIdRef.current) return false;
        window.donel.pty.input(ptyIdRef.current, command);
        return true;
      },
      getRenderedLines: (): string[] => {
        const term = termRef.current;
        if (!term) return [];
        const buffer = term.buffer.active;
        const start = Math.max(0, buffer.length - RENDERED_TAIL_LINES);
        const lines: string[] = [];
        for (let i = start; i < buffer.length; i += 1) {
          const line = buffer.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        return lines;
      },
      onRenderedUpdate: (listener: () => void): (() => void) => {
        renderListenersRef.current.add(listener);
        return () => {
          renderListenersRef.current.delete(listener);
        };
      },
    }),
    []
  );

  const teardownPty = useCallback(() => {
    unsubscribeDataRef.current?.();
    unsubscribeExitRef.current?.();
    unsubscribeSemaphoreRef.current?.();
    unsubscribeDataRef.current = null;
    unsubscribeExitRef.current = null;
    unsubscribeSemaphoreRef.current = null;
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
          // T013 (correção herdada) — o 2º argumento de `write` é o callback
          // de CONCLUSÃO do parser (documentado no xterm.js): só dispara
          // `onRenderedUpdate` depois que ESTE chunk já virou estado real do
          // buffer (`term.buffer.active`), nunca antes — é o que garante
          // ver um frame de confirmação transiente ANTES do próximo redraw
          // sobrescrever por cima (ver comentário do handle acima).
          term.write(data, () => {
            renderListenersRef.current.forEach((listener) => listener());
          });
        });
        unsubscribeExitRef.current = window.donel.pty.onExit(result.ptyId, (info) => {
          ptyIdRef.current = null;
          setStatus({ kind: 'ended', info });
        });
        // Sessão de terminal livre (FR-008) nunca é registrada no semáforo
        // pelo main process — sem sessionType 'claude', simplesmente não
        // chega update nenhum aqui (nada a filtrar deste lado).
        unsubscribeSemaphoreRef.current = window.donel.semaphore.onUpdate(result.ptyId, (info) => {
          onStateChangeRef.current?.(info);
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
});
