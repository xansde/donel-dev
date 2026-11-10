import { describe, expect, it } from 'vitest';
import { browserFullscreenKey, nextBrowserFullscreen } from '../src/shared/browser/fullscreen';

// Navegador em tela cheia: the panel takes the whole window and comes back. F11 toggles it from anywhere, the page
// included; Esc only leaves it from the panel's own chrome, so the page keeps its Esc and the chat's Esc (Parar)
// never fires on the way out.

const key = { key: 'F11', repeat: false, defaultPrevented: false, fullscreen: false, focus: 'panel' as const };

describe('keys of the browser full screen', () => {
  it('F11 toggles it from the panel, the app or the page itself', () => {
    expect(browserFullscreenKey(key)).toBe('toggle');
    expect(browserFullscreenKey({ ...key, fullscreen: true, focus: 'app' })).toBe('toggle');
    expect(browserFullscreenKey({ ...key, focus: 'page' })).toBe('toggle');
  });

  it('Esc leaves it only from the panel chrome, never from a field, the page or outside the panel', () => {
    const esc = { ...key, key: 'Escape', fullscreen: true };
    expect(browserFullscreenKey(esc)).toBe('exit');
    expect(browserFullscreenKey({ ...esc, focus: 'field' })).toBeNull();
    expect(browserFullscreenKey({ ...esc, focus: 'page' })).toBeNull();
    expect(browserFullscreenKey({ ...esc, focus: 'app' })).toBeNull();
    expect(browserFullscreenKey({ ...esc, fullscreen: false })).toBeNull();
  });

  it('ignores a held key and a key someone else already took', () => {
    expect(browserFullscreenKey({ ...key, repeat: true })).toBeNull();
    expect(browserFullscreenKey({ ...key, defaultPrevented: true })).toBeNull();
  });
});

describe('state of the browser full screen', () => {
  it('only a open panel goes full screen, and closing the panel leaves it', () => {
    expect(nextBrowserFullscreen({ open: false, fullscreen: false }, 'toggle')).toBe(false);
    expect(nextBrowserFullscreen({ open: true, fullscreen: false }, 'toggle')).toBe(true);
    expect(nextBrowserFullscreen({ open: true, fullscreen: true }, 'toggle')).toBe(false);
    expect(nextBrowserFullscreen({ open: true, fullscreen: true }, 'exit')).toBe(false);
    expect(nextBrowserFullscreen({ open: false, fullscreen: true }, 'toggle')).toBe(false);
  });
});
