// The navigation guard of the windows that expose `window.donel`: only the page itself passes, new windows never do.
import { describe, expect, it } from 'vitest';
import { guardNavigation, isSameDocument } from '../src/main/navigation-guard';

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
