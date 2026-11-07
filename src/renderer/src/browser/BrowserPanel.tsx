import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@donel-dev/design-system';
import { browserStore, usePtyBrowser } from './browserStore';
import { isViewportCovered } from './coverage';
import { agentAskedHelpLine } from '../../../shared/browser/ipc';
import { browserFullscreenKey } from '../../../shared/browser/fullscreen';
import type { BrowserFullscreenKeyFocus } from '../../../shared/browser/fullscreen';
import type { DomainMode } from '../../../shared/browser/guardrails';
import styles from './BrowserPanel.module.css';

// Navegador interno — the panel at the side of a session tab (docs/design/navegador-interno.md).
//
// The page itself is a `WebContentsView` owned by the main; this component draws the chrome around it (address
// bar, back/forward/reload) and an empty `viewport` box whose rect is sent to the main every frame it changes.
// While the tab is hidden, the panel closed, or something of the app covers the viewport, the view is hidden
// (`setBounds(null)`) and a print of the page takes its place.

const COVER_CHECK_EVERY_MS = 120;
/** Footer lines visible at once (the store keeps more; the newest stay). */
const LOG_LINES_SHOWN = 4;

export interface BrowserPanelProps {
  readonly ptyId: string;
  /** The tab is the active one (the view is only placed for the visible tab). */
  readonly active: boolean;
}

export function BrowserPanel({ ptyId, active }: BrowserPanelProps) {
  const browser = usePtyBrowser(ptyId);
  const panelRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** The domain rule being edited; `null` = showing what is in force. */
  const [domainDraft, setDomainDraft] = useState<{ readonly mode: DomainMode; readonly typed: string } | null>(null);
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

  // Navegador em tela cheia: F11 toggles it while this panel is the one on screen, Esc leaves it from the panel's
  // chrome (shared/browser/fullscreen.ts). Capture phase: the window's own F11 (the menu's full screen) never runs.
  const fullscreen = showing && browser.fullscreen;
  useEffect(() => {
    if (!showing) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const panel = panelRef.current;
      const target = event.target instanceof Element ? event.target : null;
      let focus: BrowserFullscreenKeyFocus = 'app';
      if (panel && target && panel.contains(target)) {
        focus = target.closest('input, textarea, select, [contenteditable="true"]') ? 'field' : 'panel';
      }
      const action = browserFullscreenKey({
        key: event.key,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        fullscreen: browserStore.get(ptyId).fullscreen,
        focus,
      });
      if (!action) return;
      event.preventDefault();
      browserStore.fullscreen(ptyId, action);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [showing, ptyId]);

  // Entering it, the focus goes to the panel: Esc then leaves the full screen and never reaches the chat (Parar).
  useEffect(() => {
    const panel = panelRef.current;
    if (fullscreen && panel && !panel.contains(document.activeElement)) panel.focus();
  }, [fullscreen]);

  if (!browser.open) return null;

  const state = browser.state;
  const ownerDriving = browser.control?.owner === 'human';
  const shownAddress = address ?? (state && state.url !== 'about:blank' ? state.url : '');

  const tabs = state?.tabs ?? [];
  const uploadDirs = browser.rules?.uploadDirs ?? [];
  const uploadGrants = browser.rules?.uploadGrants ?? [];
  const boardName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

  const domainMode = domainDraft?.mode ?? browser.rules?.domainMode ?? 'all';
  const domainsTyped = domainDraft?.typed ?? (browser.rules?.domains ?? []).join(', ');

  const applyDomains = (): void => {
    setError(null);
    void window.donel.browser.setDomains(ptyId, domainMode, domainMode === 'all' ? '' : domainsTyped).then((result) => {
      if (result.ok) setDomainDraft(null);
      else if (result.reason) setError(result.reason);
    });
  };

  const chooseUploadDir = (): void => {
    setError(null);
    void window.donel.browser.chooseUploadDir(ptyId).then((result) => {
      if (!result.ok && result.reason) setError(result.reason);
    });
  };

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
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={[styles.panel, ownerDriving ? styles.panelOwner : '', fullscreen ? styles.panelFullscreen : ''].filter(Boolean).join(' ')}
      data-testid="browser-panel"
      data-owner={browser.control?.owner ?? 'agent'}
      data-fullscreen={fullscreen ? 'true' : 'false'}
      aria-label="Navegador"
    >
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
        {ownerDriving ? null : (
          <Button
            type="button"
            variant="ghost"
            title="Assumir o navegador: o agente espera até você devolver"
            data-testid="browser-take-over"
            onClick={() => browserStore.takeOver(ptyId)}
          >
            Assumir
          </Button>
        )}
        <Button
          type="button"
          variant={rulesOpen ? 'secondary' : 'ghost'}
          aria-pressed={rulesOpen}
          title="O que o agente pode fazer neste navegador"
          data-testid="browser-rules-toggle"
          onClick={() => setRulesOpen(!rulesOpen)}
        >
          Regras
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-pressed={fullscreen}
          title={fullscreen ? 'Sair da tela cheia (F11 ou Esc)' : 'Tela cheia: o navegador ocupa a janela inteira (F11)'}
          data-testid="browser-fullscreen"
          onClick={() => browserStore.fullscreen(ptyId, 'toggle')}
        >
          {fullscreen ? '⤡' : '⤢'}
        </Button>
        <Button type="button" variant="ghost" aria-label="Fechar navegador" title="Fechar navegador" onClick={() => browserStore.setOpen(ptyId, false)}>
          ×
        </Button>
      </form>
      {tabs.length > 1 ? (
        <div className={styles.tabs} role="tablist" aria-label="Abas do navegador" data-testid="browser-tabs">
          {tabs.map((tab) => (
            <div key={tab.id} className={tab.active ? `${styles.tab} ${styles.tabActive}` : styles.tab}>
              <button type="button" role="tab" aria-selected={tab.active} className={styles.tabTitle} title={tab.url} onClick={() => window.donel.browser.tab(ptyId, 'switch', tab.id)}>
                {tab.title || tab.url}
              </button>
              <button type="button" className={styles.tabClose} aria-label={`Fechar a aba ${tab.title || tab.url}`} onClick={() => window.donel.browser.tab(ptyId, 'close', tab.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {rulesOpen ? (
        <div className={styles.rules} data-testid="browser-rules">
          <div className={styles.rulesRow}>
            <span className={styles.rulesLabel}>O agente navega em</span>
            <select
              className={styles.rulesInput}
              aria-label="Onde o agente pode navegar"
              data-testid="browser-domain-mode"
              value={domainMode}
              onChange={(event) => setDomainDraft({ mode: event.target.value as DomainMode, typed: domainsTyped })}
            >
              <option value="all">qualquer site</option>
              <option value="only">só nestes domínios</option>
              <option value="except">qualquer site, menos estes</option>
            </select>
            {domainMode === 'all' ? null : (
              <input
                className={`${styles.rulesInput} ${styles.rulesDomains}`}
                aria-label="Domínios, separados por vírgula"
                placeholder="exemplo.com, outro.com.br"
                spellCheck={false}
                data-testid="browser-domain-list"
                value={domainsTyped}
                onChange={(event) => setDomainDraft({ mode: domainMode, typed: event.target.value })}
              />
            )}
            {domainDraft ? (
              <Button type="button" variant="secondary" data-testid="browser-domain-apply" onClick={applyDomains}>
                Aplicar
              </Button>
            ) : null}
          </div>
          <div className={styles.rulesRow}>
            <span className={styles.rulesLabel}>Envio de arquivos</span>
            {uploadDirs.length === 0 && uploadGrants.length === 0 ? <span className={styles.rulesValue}>só os anexos do chat; as outras pastas, o Líder do quadro libera</span> : null}
            <Button type="button" variant="ghost" data-testid="browser-upload-choose" onClick={chooseUploadDir}>
              Autorizar pasta
            </Button>
          </div>
          {uploadDirs.map((folder) => (
            <div key={folder} className={styles.rulesRow} data-testid="browser-upload-folder">
              <span className={styles.rulesLabel} />
              <span className={styles.rulesValue} title={folder}>
                {folder}
              </span>
              <Button type="button" variant="ghost" onClick={() => window.donel.browser.removeUploadDir(ptyId, folder)}>
                Remover
              </Button>
            </div>
          ))}
          {uploadGrants.map((grant) => (
            <div key={`${grant.board}\n${grant.folder}`} className={styles.rulesRow} data-testid="browser-upload-grant">
              <span className={styles.rulesLabel} />
              <span className={styles.rulesValue} title={`${grant.folder}\nQuadro: ${grant.board}`}>
                {grant.folder} · liberada por {grant.by} em {new Date(grant.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}, para {boardName(grant.board)}
              </span>
              <Button type="button" variant="ghost" onClick={() => window.donel.browser.removeUploadDir(ptyId, grant.folder)}>
                Remover
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {ownerDriving ? (
        <div className={styles.ownerBar} role="status" data-testid="browser-owner-bar">
          <span className={styles.ownerText}>
            {browser.control?.requestedByAgent && browser.control.reason ? agentAskedHelpLine(browser.control.reason) : 'Você está no controle'}
          </span>
          {browser.control?.requestedByAgent && uploadDirs.length === 0 ? (
            <Button type="button" variant="ghost" data-testid="browser-owner-upload-choose" onClick={chooseUploadDir}>
              Autorizar pasta de envio
            </Button>
          ) : null}
          <Button type="button" variant="secondary" data-testid="browser-hand-back" onClick={() => browserStore.handBack(ptyId)}>
            Devolver ao agente
          </Button>
        </div>
      ) : null}
      <div ref={viewportRef} className={styles.viewport} data-testid="browser-viewport" data-covered={covered ? 'true' : 'false'}>
        {covered && snapshot ? <img className={styles.snapshot} src={snapshot} alt="" /> : null}
      </div>
      {browser.log.length > 0 ? (
        <ol className={styles.log} aria-label="O que o agente fez no navegador" data-testid="browser-log">
          {browser.log.slice(-LOG_LINES_SHOWN).map((entry) => (
            <li key={`${entry.at}-${entry.text}`} className={styles.logLine} title={new Date(entry.at).toLocaleTimeString('pt-BR')}>
              {entry.text}
            </li>
          ))}
        </ol>
      ) : null}
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
      title={
        browser.open
          ? 'Fechar o navegador desta sessão'
          : browser.unseen > 0
            ? `O agente usou o navegador (${browser.unseen} ${browser.unseen === 1 ? 'registro novo' : 'registros novos'})`
            : 'Abrir o navegador desta sessão (o agente também consegue usar)'
      }
      onClick={() => browserStore.toggle(ptyId)}
    >
      Navegador
      {!browser.open && browser.unseen > 0 ? (
        <span className={styles.badge} data-testid="browser-unseen">
          {browser.unseen > 99 ? '99+' : browser.unseen}
        </span>
      ) : null}
    </Button>
  );
}
