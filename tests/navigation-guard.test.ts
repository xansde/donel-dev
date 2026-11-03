// The navigation guard of the windows that expose `window.donel`: only the page itself passes, new windows never do.
import { describe, expect, it } from 'vitest';
import { guardBrowserPanelNavigation, guardNavigation, isSameDocument } from '../src/main/navigation-guard';
import { isAllowedPanelUrl } from '../src/shared/browser/url';

describe('isSameDocument', () => {
  it('the same page, with or without a fragment, is the same document', () => {
    expect(isSameDocument('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    expect(isSameDocument('http://localhost:5173/#pet', 'http://localhost:5173/')).toBe(true);
    expect(isSameDocument('file:///app/index.html#pet', 'file:///app/index.html')).toBe(true);
  });

  it('another page, another origin or another query is not', () => {
    expect(isSameDocument('https://example.com/', 'http://localhost:5173/')).toBe(false);
    expect(isSameDocument('http://localhost:5173/other', 'http://localhost:5173/')).toBe(false);
    expect(isSameDocument('http://localhost:5173/?a=1', 'http://localhost:5173/')).toBe(false);
  });
});

describe('guardNavigation', () => {
  function fakeContents(current: string) {
    const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    let openHandler: (() => { action: string }) | null = null;
    const contents = {
      getURL: () => current,
      on: (channel: string, listener: (event: { preventDefault(): void }, url: string) => void) => {
        listeners.set(channel, listener);
        return contents;
      },
      setWindowOpenHandler: (handler: () => { action: string }) => {
        openHandler = handler;
      },
    };
    return { contents: contents as unknown as Parameters<typeof guardNavigation>[0], listeners, open: () => openHandler?.() };
  }

  it('prevents a navigation and a redirect to another page, and lets the page itself through', () => {
    const { contents, listeners } = fakeContents('file:///app/index.html#pet');
    guardNavigation(contents);
    for (const channel of ['will-navigate', 'will-redirect']) {
      let prevented = 0;
      listeners.get(channel)?.({ preventDefault: () => (prevented += 1) }, 'https://example.com/');
      expect(prevented).toBe(1);
      listeners.get(channel)?.({ preventDefault: () => (prevented += 1) }, 'file:///app/index.html');
      expect(prevented).toBe(1); // a reload of the same page is not prevented
    }
  });

  it('always denies new windows', () => {
    const { contents, open } = fakeContents('file:///app/index.html');
    guardNavigation(contents);
    expect(open()).toEqual({ action: 'deny' });
  });
});

describe('guardBrowserPanelNavigation (named exception: the internal browser views)', () => {
  function fakePanel() {
    const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    let openHandler: ((details: { url: string }) => { action: string }) | null = null;
    const contents = {
      on: (channel: string, listener: (event: { preventDefault(): void }, url: string) => void) => {
        listeners.set(channel, listener);
        return contents;
      },
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => {
        openHandler = handler;
      },
    };
    const opened: string[] = [];
    const blocked: string[] = [];
    guardBrowserPanelNavigation(contents as unknown as Parameters<typeof guardBrowserPanelNavigation>[0], {
      isAllowed: isAllowedPanelUrl,
      openInPanel: (url) => opened.push(url),
      onBlocked: (url) => blocked.push(url),
    });
    const fire = (channel: string, url: string): boolean => {
      let prevented = false;
      listeners.get(channel)?.({ preventDefault: () => (prevented = true) }, url);
      return prevented;
    };
    return { fire, open: (url: string) => openHandler?.({ url }), opened, blocked };
  }

  it('lets http and https navigations through and blocks file:// and other schemes', () => {
    const panel = fakePanel();
    for (const channel of ['will-navigate', 'will-redirect']) {
      expect(panel.fire(channel, 'https://example.com/login')).toBe(false);
      expect(panel.fire(channel, 'http://localhost:5173/')).toBe(false);
      expect(panel.fire(channel, 'file:///C:/Users/x/secret.txt')).toBe(true);
      expect(panel.fire(channel, 'javascript:alert(1)')).toBe(true);
      expect(panel.fire(channel, 'chrome://settings')).toBe(true);
    }
    expect(panel.blocked).toHaveLength(6);
  });

  it('sends an allowed popup into the panel and never opens a new window', () => {
    const panel = fakePanel();
    expect(panel.open('https://example.com/popup')).toEqual({ action: 'deny' });
    expect(panel.open('file:///C:/x')).toEqual({ action: 'deny' });
    expect(panel.opened).toEqual(['https://example.com/popup']);
    expect(panel.blocked).toEqual(['file:///C:/x']);
  });

  it('refuses <webview> inside a panel page', () => {
    const panel = fakePanel();
    expect(panel.fire('will-attach-webview', '')).toBe(true);
  });
});
