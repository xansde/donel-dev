// Navegador interno — the script every page of the panel runs before its own (docs/design/navegador-interno.md, D15).
//
// It is a session preload (`ses.registerPreloadScript`) that only calls `contextBridge.executeInMainWorld`: it
// exposes nothing to the page and never talks to the app, so the page stays as cut off from the app as without it.
// `pageGuard` is serialized into that preload: it must stay self-contained (no import, no outer binding).

/** Runs in the page's main world, before the page's scripts. */
function pageGuard(): void {
  const page = globalThis as unknown as {
    PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> };
    CredentialsContainer?: { prototype: Record<string, unknown> };
    chrome?: Record<string, unknown>;
    navigator: { userActivation?: { isActive: boolean } };
  };

  // 1. Passkeys only by the owner's hand. On Windows the Chromium of Electron answers a WebAuthn request with the
  //    system dialog "Escolher uma chave de acesso", and a login page asks on load (conditional mediation, the
  //    passkey autofill) and asks again every few seconds: the dialog kept popping up by itself, even with the panel
  //    hidden. Conditional requests now stay pending (as in a browser without passkey autofill) and any other
  //    WebAuthn request needs a click or key press of the owner on the page (transient user activation).
  const pkc = page.PublicKeyCredential;
  if (pkc && typeof pkc.isConditionalMediationAvailable === 'function') {
    pkc.isConditionalMediationAvailable = new Proxy(pkc.isConditionalMediationAvailable, { apply: () => Promise.resolve(false) });
  }
  const credentials = page.CredentialsContainer?.prototype;
  if (credentials) {
    for (const name of ['get', 'create']) {
      const original = credentials[name];
      if (typeof original !== 'function') continue;
      credentials[name] = new Proxy(original, {
        apply(target, thisArg, args: unknown[]) {
          const options = args[0] as { publicKey?: unknown; mediation?: string; signal?: AbortSignal } | undefined;
          if (options && typeof options === 'object' && 'publicKey' in options) {
            const signal = options.signal;
            if (options.mediation === 'conditional') {
              return new Promise((_resolve, reject) => {
                if (!signal) return;
                if (signal.aborted) reject(signal.reason);
                else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              });
            }
            if (!page.navigator.userActivation?.isActive) {
              return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
            }
          }
          return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
        },
      });
    }
  }

  // 2. Google refuses to sign in ("Esse navegador ou app pode não ser seguro") when `window.chrome` lacks the members
  //    every Chrome has: with the user agent already clean (`cleanUserAgent`), these three were the whole difference
  //    (tested 06/11 with Electron 43). They are inert stand-ins with Chrome's shape.
  const chrome = page.chrome ?? (page.chrome = {});
  if (!chrome.app) {
    chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run',
    };
  }
  if (!chrome.csi) {
    chrome.csi = () => ({ startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 });
  }
  if (!chrome.loadTimes) {
    chrome.loadTimes = () => {
      const now = Date.now() / 1000;
      return {
        requestTime: now,
        startLoadTime: now,
        commitLoadTime: now,
        finishDocumentLoadTime: 0,
        finishLoadTime: 0,
        firstPaintTime: 0,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      };
    };
  }
}

/** Source of the session preload file. */
export const PAGE_GUARD_PRELOAD = `require('electron').contextBridge.executeInMainWorld({ func: ${pageGuard.toString()} });\n`;
