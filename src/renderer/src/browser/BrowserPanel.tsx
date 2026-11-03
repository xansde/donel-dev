import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@donel-dev/design-system';
import { browserStore, usePtyBrowser } from './browserStore';
import { isViewportCovered } from './coverage';
import styles from './BrowserPanel.module.css';

// Navegador interno — the panel at the side of a session tab (docs/design/navegador-interno.md).
//
// The page itself is a `WebContentsView` owned by the main; this component draws the chrome around it (address
// bar, back/forward/reload) and an empty `viewport` box whose rect is sent to the main every frame it changes.
// While the tab is hidden, the panel closed, or something of the app covers the viewport, the view is hidden
// (`setBounds(null)`) and a print of the page takes its place.

const COVER_CHECK_EVERY_MS = 120;

export interface BrowserPanelProps {
  readonly ptyId: string;
  /** The tab is the active one (the view is only placed for the visible tab). */
  readonly active: boolean;
}

export function BrowserPanel({ ptyId, active }: BrowserPanelProps) {
  const browser = usePtyBrowser(ptyId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showing = browser.open && active;

  // Pins the view on the viewport box, following resize, scroll, DPI/zoom and layout shifts: one rect read per
  // frame, one IPC only when it changes.
  useEffect(() => {
    if (!showing) {
      window.donel.browser.setBounds(ptyId, null);
      return undefined;
    }
    let frame = 0;
    let lastKey = '';
    let lastCheck = -Infinity;
    let coveredNow = false;
    const tick = (time: number): void => {
      const element = viewportRef.current;
      if (element) {
        const r = element.getBoundingClientRect();
        const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        if (time - lastCheck >= COVER_CHECK_EVERY_MS) {
          lastCheck = time;
          const next = rect.width >= 2 && rect.height >= 2 && isViewportCovered(element, rect);
          if (next !== coveredNow) {
            coveredNow = next;
            setCovered(next);
          }
        }
        const visible = rect.width >= 2 && rect.height >= 2 && !coveredNow;
        const key = visible ? `${rect.x}|${rect.y}|${rect.width}|${rect.height}` : 'hidden';
        if (key !== lastKey) {
          lastKey = key;
          window.donel.browser.setBounds(ptyId, visible ? rect : null);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.donel.browser.setBounds(ptyId, null);
      setCovered(false);
    };
  }, [showing, ptyId]);

  // Covered: a print in place of the view, so the panel does not go blank under a menu.
  useEffect(() => {
    if (!covered) {
      setSnapshot(null);
      return undefined;
    }
    let alive = true;
    void window.donel.browser.snapshot(ptyId).then((image) => {
      if (alive) setSnapshot(image);
    });
    return () => {
      alive = false;
    };
  }, [covered, ptyId]);

  if (!browser.open) return null;

  const state = browser.state;
  const shownAddress = address ?? (state && state.url !== 'about:blank' ? state.url : '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const typed = shownAddress;
    setError(null);
    void window.donel.browser.navigate(ptyId, typed).then((result) => {
      if (result.ok) setAddress(null);
      else setError(result.reason);
    });
  };

  return (
    <aside className={styles.panel} data-testid="browser-panel" aria-label="Navegador">
      <form className={styles.toolbar} onSubmit={submit}>
        <Button type="button" variant="ghost" aria-label="Voltar" title="Voltar" disabled={!state?.canGoBack} onClick={() => window.donel.browser.history(ptyId, 'back')}>
          ◀
        </Button>
        <Button type="button" variant="ghost" aria-label="Avançar" title="Avançar" disabled={!state?.canGoForward} onClick={() => window.donel.browser.history(ptyId, 'forward')}>
          ▶
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label={state?.loading ? 'Parar' : 'Recarregar'}
          title={state?.loading ? 'Parar' : 'Recarregar'}
          onClick={() => window.donel.browser.history(ptyId, state?.loading ? 'stop' : 'reload')}
        >
          {state?.loading ? '✕' : '⟳'}
        </Button>
        <input
          className={styles.address}
          aria-label="Endereço"
          placeholder="Digite um endereço (http ou https)"
          spellCheck={false}
          value={shownAddress}
          onChange={(event) => setAddress(event.target.value)}
          onBlur={() => setAddress(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setAddress(null);
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        <Button type="button" variant="ghost" aria-label="Fechar navegador" title="Fechar navegador" onClick={() => browserStore.setOpen(ptyId, false)}>
          ×
        </Button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div ref={viewportRef} className={styles.viewport} data-testid="browser-viewport" data-covered={covered ? 'true' : 'false'}>
        {covered && snapshot ? <img className={styles.snapshot} src={snapshot} alt="" /> : null}
      </div>
    </aside>
  );
}

/** "Navegador" in the session header: opens or closes the panel of the active tab. */
export function BrowserToggleButton({ ptyId }: { readonly ptyId: string }) {
  const browser = usePtyBrowser(ptyId);
  return (
    <Button
      variant={browser.open ? 'secondary' : 'ghost'}
      aria-pressed={browser.open}
      data-testid="browser-toggle"
      title={browser.open ? 'Fechar o navegador desta sessão' : 'Abrir o navegador desta sessão (o agente também consegue usar)'}
      onClick={() => browserStore.toggle(ptyId)}
    >
      Navegador
    </Button>
  );
}
