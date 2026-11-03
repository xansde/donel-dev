import type { WebContents } from 'electron';
import { buildAxSnapshot, type AxNodeLike, type AxRef } from '../../shared/browser/axTree';
import { parseKeyCombo } from '../../shared/browser/keys';
import type { ScrollDirection } from '../../shared/browser/mcp';

// Navegador integrado — the agent's hands on ONE panel page, by CDP of that page only (docs/design/navegador-interno.md, D8).
//
// `webContents.debugger` attaches the DevTools protocol to this `WebContents` alone. NEVER
// `--remote-debugging-port`: a port would expose every renderer of the app, `window.donel` included.
//
// The `[N]` numbers of the last `read()` point at DOM nodes (`backendDOMNodeId`). A main-frame navigation
// makes all of them stale at once; a node that left the DOM makes its own number stale. Both answer with the
// same message, asking for a new read.

export const STALE_REFS_MESSAGE = 'Os números da última leitura venceram (a página mudou). Chame navegador_ler de novo.';

const CDP_VERSION = '1.3';
const SETTLE_AFTER_ACTION_MS = 250;
const MAX_LOAD_WAIT_MS = 15_000;
const TEXT_POLL_MS = 250;
const COMMAND_TIMEOUT_MS = 20_000;
/** CDP errors that mean "this node is not in the page any more". */
const GONE_NODE = /No node with given id|Could not find node|Node is detached|Cannot find context|does not belong to the document|Could not compute (content )?(box model|quads)/i;

interface Quad {
  readonly quads: number[][];
}

interface LayoutMetrics {
  readonly cssVisualViewport?: { readonly clientWidth: number; readonly clientHeight: number };
  readonly cssLayoutViewport?: { readonly clientWidth: number; readonly clientHeight: number };
}

export interface PageRead {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly truncated: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CdpDriver {
  private attached = false;
  private refs: ReadonlyMap<number, AxRef> = new Map();
  /** Bumped at every main-frame navigation; the refs are valid only for the epoch they were read in. */
  private epoch = 0;
  private refsEpoch = -1;

  constructor(readonly contents: WebContents) {
    contents.on('did-navigate', () => {
      this.epoch += 1;
    });
    contents.debugger.on('detach', () => {
      this.attached = false;
    });
  }

  /** Reads the page as the numbered accessibility tree; the numbers replace those of the previous read. */
  async read(maxChars?: number): Promise<PageRead> {
    const { nodes } = await this.send<{ nodes: AxNodeLike[] }>('Accessibility.getFullAXTree');
    const snapshot = buildAxSnapshot(nodes, { maxChars });
    this.refs = snapshot.refs;
    this.refsEpoch = this.epoch;
    return { url: this.contents.getURL(), title: this.contents.getTitle(), text: snapshot.text, truncated: snapshot.truncated };
  }

  /** Clicks the center of element `[n]` (scrolled into view first) with a real mouse event. */
  async click(n: number): Promise<AxRef> {
    const ref = this.ref(n);
    await this.onNode(async () => {
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref.backendNodeId });
      const { quads } = await this.send<Quad>('DOM.getContentQuads', { backendNodeId: ref.backendNodeId });
      const quad = quads.find((candidate) => candidate.length >= 8);
      if (!quad) {
        // No box (zero-size or display: contents): a DOM click is the next best thing.
        await this.callOnNode(ref.backendNodeId, 'function () { this.click(); }');
        return;
      }
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    });
    await this.settle();
    return ref;
  }

  /** Focuses field `[n]`, selects what is in it and types `text` over it. */
  async type(n: number, text: string): Promise<AxRef> {
    const ref = this.ref(n);
    await this.onNode(async () => {
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref.backendNodeId });
      await this.send('DOM.focus', { backendNodeId: ref.backendNodeId });
      await this.callOnNode(
        ref.backendNodeId,
        "function () { if (typeof this.select === 'function') { this.select(); } else if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }",
      );
    });
    if (text === '') await this.pressKey('Backspace');
    else await this.send('Input.insertText', { text });
    await this.settle();
    return ref;
  }

  /** Presses a key combo (`Enter`, `Ctrl+A`...) on whatever has focus. Throws with a pt-BR reason on a bad combo. */
  async pressKey(combo: string): Promise<void> {
    const parsed = parseKeyCombo(combo);
    if (!parsed.ok) throw new Error(parsed.reason);
    for (const event of parsed.events) await this.send('Input.dispatchKeyEvent', { ...event });
    await this.settle();
  }

  /** Scrolls almost one screen with a mouse wheel at the middle of the viewport. */
  async scroll(direction: ScrollDirection): Promise<void> {
    const metrics = await this.send<LayoutMetrics>('Page.getLayoutMetrics');
    const viewport = metrics.cssVisualViewport ?? metrics.cssLayoutViewport ?? { clientWidth: 1280, clientHeight: 800 };
    const x = viewport.clientWidth / 2;
    const y = viewport.clientHeight / 2;
    const stepY = Math.round(viewport.clientHeight * 0.8);
    const stepX = Math.round(viewport.clientWidth * 0.8);
    const deltaY = direction === 'baixo' ? stepY : direction === 'cima' ? -stepY : 0;
    const deltaX = direction === 'direita' ? stepX : direction === 'esquerda' ? -stepX : 0;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
    await delay(SETTLE_AFTER_ACTION_MS);
  }

  /** `true` as soon as `text` shows in the page's visible text; `false` after `timeoutMs`. */
  async waitForText(text: string, timeoutMs: number): Promise<boolean> {
    const expression = `(() => { const body = document.body; return body ? body.innerText.includes(${JSON.stringify(text)}) : false; })()`;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const { result } = await this.send<{ result: { value?: unknown } }>('Runtime.evaluate', { expression, returnByValue: true });
        if (result.value === true) return true;
      } catch {
        // the page is between two documents: try again
      }
      if (Date.now() >= deadline) return false;
      await delay(TEXT_POLL_MS);
    }
  }

  /** Waits for the page to stop loading if the last action started a load (or the timeout). */
  async settle(): Promise<void> {
    await delay(SETTLE_AFTER_ACTION_MS);
    if (this.contents.isDestroyed() || !this.contents.isLoading()) return;
    const contents = this.contents;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        contents.removeListener('did-stop-loading', done);
        contents.removeListener('destroyed', done);
        resolve();
      };
      const timer = setTimeout(done, MAX_LOAD_WAIT_MS);
      contents.once('did-stop-loading', done);
      contents.once('destroyed', done);
    });
  }

  detach(): void {
    if (!this.attached) return;
    try {
      this.contents.debugger.detach();
    } catch {
      // the page is already gone
    }
    this.attached = false;
  }

  private ref(n: number): AxRef {
    if (this.refsEpoch < 0) throw new Error('Ainda não há leitura desta página. Chame navegador_ler primeiro.');
    if (this.refsEpoch !== this.epoch) throw new Error(STALE_REFS_MESSAGE);
    const ref = this.refs.get(n);
    if (!ref) throw new Error(`Não há elemento [${n}] na última leitura. Chame navegador_ler de novo.`);
    return ref;
  }

  /** Runs CDP work on a node, turning "the node is gone" into the stale-refs message. */
  private async onNode(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (GONE_NODE.test(message)) throw new Error(STALE_REFS_MESSAGE);
      throw error;
    }
  }

  private async callOnNode(backendNodeId: number, functionDeclaration: string): Promise<void> {
    const { object } = await this.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId });
    if (!object.objectId) throw new Error(STALE_REFS_MESSAGE);
    try {
      await this.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, silent: true });
    } finally {
      await this.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined);
    }
  }

  private async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.contents.isDestroyed()) throw new Error('O navegador desta sessão foi fechado.');
    if (!this.attached) {
      if (!this.contents.debugger.isAttached()) this.contents.debugger.attach(CDP_VERSION);
      this.attached = true;
      // The panel is often hidden or the window unfocused while the agent drives: without focus emulation the
      // page has no focused frame, and typing (`Input.insertText`) goes nowhere.
      await this.command('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
    }
    return this.command<T>(method, params);
  }

  /** One CDP command with a ceiling: a stuck renderer must not hang the agent's tool forever. */
  private async command<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.contents.debugger.sendCommand(method, params) as Promise<T>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`A página não respondeu (${method}).`)), COMMAND_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
