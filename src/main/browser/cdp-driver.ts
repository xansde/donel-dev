import type { WebContents } from 'electron';
import { buildAxSnapshot, offscreenSummary, type AxFrame, type AxNodeLike, type AxRef } from '../../shared/browser/axTree';
import { parseKeyCombo } from '../../shared/browser/keys';
import { domToMarkdown, type DomFrame, type DomNodeLike } from '../../shared/browser/markdown';
import type { ScrollDirection } from '../../shared/browser/mcp';
import { SNAPSHOT_COMPUTED_STYLES, SnapshotPlacements, layoutPresence, type DomSnapshotLike, type SnapshotFrameContext } from '../../shared/browser/visibility';

// Navegador integrado — the agent's hands on ONE panel page, by CDP of that page only (docs/design/navegador-interno.md, D8).
//
// `webContents.debugger` attaches the DevTools protocol to this `WebContents` alone. NEVER
// `--remote-debugging-port`: a port would expose every renderer of the app, `window.donel` included.
//
// V2 (03/11): iframes of another origin run in another renderer process and have their own CDP target. The
// driver turns on `Target.setAutoAttach` (flatten) once, keeps one session per such frame, and reads/acts on
// them by `sessionId` (idea from browser-use's `browser/session.py` + `dom/service.py`, MIT). The page itself is
// the session `''`.
//
// The `[N]` numbers of the last `read()` point at DOM nodes (`backendDOMNodeId` + the frame's session). A
// main-frame navigation makes all of them stale at once; a node that left the DOM makes its own number stale.
// Both answer with the same message, asking for a new read.

export const STALE_REFS_MESSAGE = 'Os números da última leitura venceram (a página mudou). Chame navegador_ler de novo.';

const CDP_VERSION = '1.3';
const SETTLE_AFTER_ACTION_MS = 250;
const MAX_LOAD_WAIT_MS = 15_000;
const TEXT_POLL_MS = 250;
const COMMAND_TIMEOUT_MS = 20_000;
/** After turning auto-attach on, the targets that already exist announce themselves; this gives them the time. */
const AUTO_ATTACH_SETTLE_MS = 200;
/** Frames of another origin read per page (an ad-heavy page can have dozens). */
const MAX_REMOTE_FRAMES = 12;
/** Options listed by `navegador_opcoes`. */
const MAX_OPTIONS = 200;
/** Time a custom list takes to open after the click. */
const LIST_OPEN_MS = 300;
/** CDP errors that mean "this node is not in the page any more". */
const GONE_NODE = /No node with given id|Could not find node|Node is detached|Cannot find context|does not belong to the document|Could not compute (content )?(box model|quads)|does not have a layout object|Session with given id not found|No session with given id/i;

interface Quad {
  readonly quads: number[][];
}

interface LayoutMetrics {
  readonly cssVisualViewport?: { readonly clientWidth: number; readonly clientHeight: number };
  readonly cssLayoutViewport?: { readonly clientWidth: number; readonly clientHeight: number };
  readonly layoutViewport?: { readonly clientWidth: number; readonly clientHeight: number };
}

interface FrameTreeNode {
  readonly frame: { readonly id: string; readonly url?: string };
  readonly childFrames?: readonly FrameTreeNode[];
}

/** One iframe of another origin, attached by `Target.setAutoAttach`. */
interface RemoteFrame {
  readonly sessionId: string;
  /** For an iframe target, the target id is the frame id. */
  readonly targetId: string;
  /** Session where its frame element lives (`''` = the page). */
  readonly parent: string;
}

/** One option of a list, as the page shows it. */
export interface ListOption {
  readonly text: string;
  readonly value: string;
  readonly selected: boolean;
  readonly disabled: boolean;
}

/** `closed`: a list that opens on click and is still closed; `none`: the element is not a list. */
export interface ListRead {
  readonly kind: 'select' | 'aria' | 'closed' | 'none';
  readonly options: readonly ListOption[];
  /** How many options the list really has (`options` stops at `MAX_OPTIONS`). */
  readonly total: number;
}

export interface PageRead {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface PageExtract {
  readonly url: string;
  readonly title: string;
  readonly markdown: string;
  readonly total: number;
  readonly nextStart: number | null;
}

// Page-side helpers. They run in the page with `Runtime.callFunctionOn`, with arguments passed as values, never
// spliced into the source. Options read from a real `<select>` or from an accessible list; the list of options of
// browser-use (`default_action_watchdog.py`, MIT) follows `aria-controls` the same way.

const LIST_SOURCE = `
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();
  const ariaBox = (el) => {
    const root = el.getRootNode();
    const owned = (el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '').split(/\\s+/)[0];
    const byId = owned ? (root.getElementById ? root.getElementById(owned) : null) || document.getElementById(owned) : null;
    if (byId) return byId;
    if (el.getAttribute('role') === 'listbox') return el;
    return el.querySelector('[role=listbox]');
  };
  const ariaItems = (el) => {
    const box = ariaBox(el);
    return box ? Array.from(box.querySelectorAll('[role=option],[role=menuitem],[role=menuitemradio]')) : [];
  };
  const opensOnClick = (el) => el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup') || el.getAttribute('aria-expanded') === 'false';
  const rendered = (el) => el.getClientRects().length > 0;
  const pick = (items, wanted) => {
    const norm = (text) => clean(text).toLowerCase();
    const target = norm(wanted);
    const exact = items.find((item) => norm(item.text) === target || (item.value && norm(item.value) === target));
    if (exact) return exact;
    const partial = items.filter((item) => norm(item.text).includes(target));
    return partial.length === 1 ? partial[0] : null;
  };
`;

const READ_LIST = `function (limit) {${LIST_SOURCE}
  if (this.tagName === 'SELECT') {
    const all = Array.from(this.options);
    return { kind: 'select', total: all.length, options: all.slice(0, limit).map((o) => ({ text: clean(o.text), value: o.value, selected: o.selected, disabled: o.disabled })) };
  }
  const items = ariaItems(this);
  if (items.length === 0) return { kind: opensOnClick(this) ? 'closed' : 'none', total: 0, options: [] };
  return {
    // The options of a closed list are often in the DOM already, hidden: readable, but not clickable yet.
    kind: rendered(items[0]) || !opensOnClick(this) ? 'aria' : 'closed',
    total: items.length,
    options: items.slice(0, limit).map((o) => ({
      text: clean(o.textContent),
      value: o.getAttribute('data-value') || '',
      selected: o.getAttribute('aria-selected') === 'true' || o.getAttribute('aria-checked') === 'true',
      disabled: o.getAttribute('aria-disabled') === 'true',
    })),
  };
}`;

const SELECT_NATIVE = `function (wanted) {${LIST_SOURCE}
  if (this.tagName !== 'SELECT') return { handled: false };
  const items = Array.from(this.options).map((o, index) => ({ text: o.text, value: o.value, index, disabled: o.disabled }));
  const choice = pick(items, wanted);
  if (!choice) return { handled: true, ok: false };
  if (choice.disabled) return { handled: true, ok: false, disabled: clean(choice.text) };
  this.selectedIndex = choice.index;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { handled: true, ok: true, chosen: clean(choice.text) };
}`;

const FIND_ARIA_OPTION = `function (wanted) {${LIST_SOURCE}
  const items = ariaItems(this).filter(rendered).map((el) => ({ el, text: el.textContent, value: el.getAttribute('data-value') || '' }));
  const choice = pick(items, wanted);
  return choice ? choice.el : null;
}`;

const FIND_FILE_INPUT = `function () {
  const isFile = (el) => el && el.tagName === 'INPUT' && el.type === 'file';
  if (isFile(this)) return this;
  if (this.tagName === 'LABEL' && isFile(this.control)) return this.control;
  const inner = this.querySelector ? this.querySelector('input[type=file]') : null;
  if (inner) return inner;
  for (let up = this.parentElement, i = 0; up && i < 6; up = up.parentElement, i += 1) {
    const near = up.querySelector('input[type=file]');
    if (near) return near;
  }
  const all = this.ownerDocument.querySelectorAll('input[type=file]');
  return all.length === 1 ? all[0] : null;
}`;

/** Scrolls to the first rendered occurrence of the text, in this document, its open shadow roots and same-process frames. */
const FIND_TEXT = `function (needle) {
  const norm = (text) => (text || '').replace(/\\s+/g, ' ').toLowerCase();
  const wanted = norm(needle).trim();
  const shown = (el) => {
    if (!el || el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const roots = [];
  const collect = (root) => {
    roots.push(root);
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) collect(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try {
          if (el.contentDocument) collect(el.contentDocument);
        } catch {}
      }
    });
  };
  collect(document);
  const go = (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return true;
  };
  for (const root of roots) {
    const walker = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (norm(node.nodeValue).includes(wanted) && shown(node.parentElement)) return go(node.parentElement);
    }
  }
  // The text may be split among inline elements: the deepest element of the first occurrence.
  for (const root of roots) {
    const body = root.body || root;
    if (root.body && !norm(root.body.innerText).includes(wanted)) continue;
    let best = null;
    for (const el of body.querySelectorAll('*')) {
      if (!norm(el.textContent).includes(wanted) || !shown(el)) continue;
      if (best && !best.contains(el)) break;
      best = el;
    }
    if (best) return go(best);
  }
  return false;
}`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flattenFrames(node: FrameTreeNode, out: string[] = []): string[] {
  out.push(node.frame.id);
  for (const child of node.childFrames ?? []) flattenFrames(child, out);
  return out;
}

export class CdpDriver {
  private attached = false;
  private refs: ReadonlyMap<number, AxRef> = new Map();
  /** Bumped at every main-frame navigation; the refs are valid only for the epoch they were read in. */
  private epoch = 0;
  private refsEpoch = -1;
  private readonly remote = new Map<string, RemoteFrame>();

  constructor(readonly contents: WebContents) {
    contents.on('did-navigate', () => {
      this.epoch += 1;
    });
    contents.debugger.on('detach', () => {
      this.attached = false;
      this.remote.clear();
    });
    contents.debugger.on('message', (_event, method: string, params: Record<string, unknown>, sessionId: string) => {
      if (method === 'Target.attachedToTarget') {
        const info = params.targetInfo as { targetId?: string; type?: string } | undefined;
        const child = params.sessionId;
        if (info?.type !== 'iframe' || typeof child !== 'string' || typeof info.targetId !== 'string') return;
        this.remote.set(child, { sessionId: child, targetId: info.targetId, parent: sessionId ?? '' });
        // Frames inside that frame, of yet another origin.
        void this.command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, child).catch(() => undefined);
      } else if (method === 'Target.detachedFromTarget') {
        if (typeof params.sessionId === 'string') this.remote.delete(params.sessionId);
      }
    });
  }

  /**
   * Reads what is on screen as the numbered accessibility tree (every frame, shadow DOM included); what is
   * scrolled away or covered is counted, not listed. The numbers replace those of the previous read.
   */
  async read(maxChars?: number): Promise<PageRead> {
    const frames = await this.collectAxFrames();
    const placements = await this.collectPlacements();
    const top = frames.get('') ?? { key: '', nodes: [] };
    const snapshot = buildAxSnapshot(top, {
      maxChars,
      childFrame: (frameKey, iframeBackendNodeId) => frames.get(`${frameKey}|${iframeBackendNodeId}`) ?? null,
      placement: (frameKey, backendNodeId) => placements.get(frameKey)?.placementOf(backendNodeId)?.placement,
    });
    this.refs = snapshot.refs;
    this.refsEpoch = this.epoch;
    const summary = offscreenSummary(snapshot.offscreen);
    return {
      url: this.contents.getURL(),
      title: this.contents.getTitle(),
      text: summary ? `${snapshot.text}\n\n${summary}` : snapshot.text,
      truncated: snapshot.truncated,
    };
  }

  /** The whole page (every frame) as Markdown, from `startAt` on, cut at `maxChars`. */
  async extract(maxChars: number, startAt: number): Promise<PageExtract> {
    const { root } = await this.send<{ root: DomNodeLike }>('DOM.getDocument', { depth: -1, pierce: true });
    const presence = new Map<string, (id: number) => boolean | undefined>();
    const documents = new Map<string, DomFrame>();
    const sessions = ['', ...this.remoteSessions()];
    await Promise.all(
      sessions.map(async (session) => {
        try {
          const snapshot = await this.send<DomSnapshotLike>('DOMSnapshot.captureSnapshot', { computedStyles: [] }, session);
          presence.set(session, layoutPresence(snapshot));
        } catch {
          // without layout data every text counts as rendered
        }
        if (session === '') return;
        const frame = this.remote.get(session);
        if (!frame) return;
        try {
          const doc = await this.send<{ root: DomNodeLike }>('DOM.getDocument', { depth: -1, pierce: true }, session);
          documents.set(frame.targetId, { key: session, root: doc.root });
        } catch {
          // the frame left meanwhile
        }
      }),
    );
    const result = domToMarkdown(root, {
      maxChars,
      startAt,
      isRendered: (frameKey, backendNodeId) => presence.get(frameKey)?.(backendNodeId),
      childDocument: (frameId) => documents.get(frameId) ?? null,
    });
    return { url: this.contents.getURL(), title: this.contents.getTitle(), ...result };
  }

  /** Clicks the center of element `[n]` (scrolled into view first) with a real mouse event. */
  async click(n: number): Promise<AxRef> {
    const ref = this.ref(n);
    await this.onNode(() => this.clickNode(ref));
    await this.settle();
    return ref;
  }

  /** The options of list `[n]`. A list that opens on click and is closed gets one click to open. */
  async options(n: number): Promise<{ ref: AxRef; list: ListRead }> {
    const ref = this.ref(n);
    const list = await this.onNode(async () => {
      const first = await this.callOnNode<ListRead>(ref, READ_LIST, [MAX_OPTIONS]);
      if (first.kind !== 'closed') return first;
      await this.clickNode(ref);
      await delay(LIST_OPEN_MS);
      return this.callOnNode<ListRead>(ref, READ_LIST, [MAX_OPTIONS]);
    });
    return { ref, list };
  }

  /** Chooses `wanted` (text or value) in list `[n]`: a real `<select>` by its index, an accessible list by a click. */
  async select(n: number, wanted: string): Promise<{ ref: AxRef; chosen: string }> {
    const ref = this.ref(n);
    const chosen = await this.onNode(async () => {
      const native = await this.callOnNode<{ handled: boolean; ok?: boolean; chosen?: string; disabled?: string }>(ref, SELECT_NATIVE, [wanted]);
      if (native.handled) {
        if (native.disabled) throw new Error(`A opção "${native.disabled}" está desativada.`);
        if (!native.ok) throw new Error(`Não achei a opção "${wanted}" em [${n}]. Veja as opções com navegador_opcoes.`);
        return native.chosen ?? wanted;
      }
      let option = await this.elementFrom(ref, FIND_ARIA_OPTION, [wanted]);
      if (option === null) {
        await this.clickNode(ref);
        await delay(LIST_OPEN_MS);
        option = await this.elementFrom(ref, FIND_ARIA_OPTION, [wanted]);
      }
      if (option === null) throw new Error(`Não achei a opção "${wanted}" em [${n}]. Veja as opções com navegador_opcoes.`);
      await this.clickNode({ frame: ref.frame, backendNodeId: option });
      return wanted;
    });
    await this.settle();
    return { ref, chosen };
  }

  /** Scrolls to the first rendered occurrence of `text`, the page first, then each remote frame. `false` = not found. */
  async findText(text: string): Promise<boolean> {
    for (const session of ['', ...this.remoteSessions()]) {
      try {
        const { result: document } = await this.send<{ result: { objectId?: string } }>('Runtime.evaluate', { expression: 'document' }, session);
        if (!document.objectId) continue;
        const { result } = await this.send<{ result: { value?: unknown } }>(
          'Runtime.callFunctionOn',
          { objectId: document.objectId, functionDeclaration: FIND_TEXT, arguments: [{ value: text }], returnByValue: true, silent: true },
          session,
        );
        await this.send('Runtime.releaseObject', { objectId: document.objectId }, session).catch(() => undefined);
        if (result.value !== true) continue;
        await this.revealFrame(session);
        await delay(SETTLE_AFTER_ACTION_MS);
        return true;
      } catch {
        // this frame left meanwhile: look at the others
      }
    }
    return false;
  }

  /** Puts `filePath` (already checked by the caller) in the file field of `[n]`, or in the one tied to it. */
  async upload(n: number, filePath: string): Promise<AxRef> {
    const ref = this.ref(n);
    await this.onNode(async () => {
      const input = await this.elementFrom(ref, FIND_FILE_INPUT);
      if (input === null) throw new Error(`[${n}] não é um campo de arquivo e não achei um ligado a ele.`);
      await this.send('DOM.setFileInputFiles', { files: [filePath], backendNodeId: input }, ref.frame);
    });
    await this.settle();
    return ref;
  }

  /** Focuses field `[n]`, selects what is in it and types `text` over it. */
  async type(n: number, text: string): Promise<AxRef> {
    const ref = this.ref(n);
    await this.onNode(async () => {
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref.backendNodeId }, ref.frame);
      await this.send('DOM.focus', { backendNodeId: ref.backendNodeId }, ref.frame);
      await this.callOnNode(
        ref,
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
    this.remote.clear();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Reading

  private remoteSessions(): string[] {
    return [...this.remote.keys()].slice(0, MAX_REMOTE_FRAMES);
  }

  /**
   * The accessibility tree of every frame, keyed for the tree builder: `''` = the page's main frame; a child
   * frame under `<session of its frame element>|<backendNodeId of that element>`, with `key` = its own session.
   */
  private async collectAxFrames(): Promise<Map<string, AxFrame>> {
    const out = new Map<string, AxFrame>();
    const remoteIds = new Set([...this.remote.values()].map((frame) => frame.targetId));

    const fromSession = async (session: string, ownerKey: string | null): Promise<void> => {
      let tree: FrameTreeNode;
      try {
        tree = (await this.send<{ frameTree: FrameTreeNode }>('Page.getFrameTree', undefined, session)).frameTree;
      } catch {
        return;
      }
      const [rootId, ...childIds] = flattenFrames(tree);
      const rootNodes = await this.send<{ nodes: AxNodeLike[] }>('Accessibility.getFullAXTree', { frameId: rootId }, session).catch(() => null);
      if (rootNodes) out.set(ownerKey ?? '', { key: session, nodes: rootNodes.nodes });
      // Frames of the same process: their tree is asked by frame id, their element found in this same session.
      await Promise.all(
        childIds
          .filter((frameId) => !remoteIds.has(frameId))
          .map(async (frameId) => {
            try {
              const [{ nodes }, owner] = await Promise.all([
                this.send<{ nodes: AxNodeLike[] }>('Accessibility.getFullAXTree', { frameId }, session),
                this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId }, session),
              ]);
              out.set(`${session}|${owner.backendNodeId}`, { key: session, nodes });
            } catch {
              // detached meanwhile (ads do this)
            }
          }),
      );
    };

    await fromSession('', null);
    await Promise.all(
      this.remoteSessions().map(async (session) => {
        const frame = this.remote.get(session);
        if (!frame) return;
        try {
          const owner = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: frame.targetId }, frame.parent);
          await fromSession(session, `${frame.parent}|${owner.backendNodeId}`);
        } catch {
          // the frame left meanwhile
        }
      }),
    );
    return out;
  }

  /** Where every element is, per session: the page first, then each remote frame inside its frame element. */
  private async collectPlacements(): Promise<Map<string, SnapshotPlacements>> {
    const out = new Map<string, SnapshotPlacements>();
    const capture = (session: string): Promise<DomSnapshotLike | null> =>
      this.send<DomSnapshotLike>('DOMSnapshot.captureSnapshot', { computedStyles: [...SNAPSHOT_COMPUTED_STYLES], includePaintOrder: true, includeDOMRects: true }, session).catch(
        () => null,
      );
    let rootContext: SnapshotFrameContext;
    try {
      const metrics = await this.send<LayoutMetrics>('Page.getLayoutMetrics');
      const css = metrics.cssLayoutViewport ?? metrics.cssVisualViewport ?? { clientWidth: 1280, clientHeight: 800 };
      const device = metrics.layoutViewport ?? css;
      const scale = css.clientWidth > 0 ? device.clientWidth / css.clientWidth : 1;
      rootContext = { scale: scale > 0 ? scale : 1, origin: { x: 0, y: 0 }, clip: { x: 0, y: 0, width: css.clientWidth, height: css.clientHeight } };
    } catch {
      return out;
    }
    const main = await capture('');
    if (!main) return out;
    out.set('', new SnapshotPlacements(main, rootContext));

    // Parents before children: a frame's context comes from its frame element in the parent's snapshot.
    const pending = this.remoteSessions().map((session) => this.remote.get(session)).filter((frame): frame is RemoteFrame => frame !== undefined);
    const snapshots = new Map<string, DomSnapshotLike | null>(await Promise.all(pending.map(async (frame) => [frame.sessionId, await capture(frame.sessionId)] as const)));
    for (let round = 0; round < 4 && pending.length > 0; round += 1) {
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const frame = pending[i];
        const parent = out.get(frame.parent);
        if (!parent) continue;
        pending.splice(i, 1);
        const snapshot = snapshots.get(frame.sessionId);
        if (!snapshot) continue;
        try {
          const owner = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: frame.targetId }, frame.parent);
          const context = parent.frameContextOf(owner.backendNodeId);
          if (context) out.set(frame.sessionId, new SnapshotPlacements(snapshot, context));
        } catch {
          // the frame left meanwhile
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Acting

  private async clickNode(ref: Pick<AxRef, 'frame' | 'backendNodeId'>): Promise<void> {
    await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref.backendNodeId }, ref.frame);
    const point = await this.centerOf(ref);
    if (!point) {
      // No box (zero-size or display: contents): a DOM click is the next best thing.
      await this.callOnNode(ref, 'function () { this.click(); }');
      return;
    }
    const { x, y } = point;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  /** Scrolls the frame elements of a remote frame into view, innermost first. */
  private async revealFrame(session: string): Promise<void> {
    let current = this.remote.get(session);
    for (let depth = 0; current && depth < 8; depth += 1) {
      const owner = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: current.targetId }, current.parent);
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: owner.backendNodeId }, current.parent);
      current = current.parent === '' ? undefined : this.remote.get(current.parent);
    }
  }

  /** Center of the element in CSS pixels of the page's viewport (a remote frame adds its frame element's offset). */
  private async centerOf(ref: Pick<AxRef, 'frame' | 'backendNodeId'>): Promise<{ x: number; y: number } | null> {
    const { quads } = await this.send<Quad>('DOM.getContentQuads', { backendNodeId: ref.backendNodeId }, ref.frame);
    const quad = quads.find((candidate) => candidate.length >= 8);
    if (!quad) return null;
    const offset = await this.frameOffset(ref.frame);
    return { x: offset.x + (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: offset.y + (quad[1] + quad[3] + quad[5] + quad[7]) / 4 };
  }

  /** Where the viewport of a remote frame starts inside the page's viewport (its frame elements' content boxes). */
  private async frameOffset(session: string): Promise<{ x: number; y: number }> {
    let x = 0;
    let y = 0;
    let current = this.remote.get(session);
    for (let depth = 0; current && depth < 8; depth += 1) {
      const owner = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: current.targetId }, current.parent);
      const { model } = await this.send<{ model: { content: number[] } }>('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }, current.parent);
      x += model.content[0];
      y += model.content[1];
      current = current.parent === '' ? undefined : this.remote.get(current.parent);
    }
    return { x, y };
  }

  private ref(n: number): AxRef {
    if (this.refsEpoch < 0) throw new Error('Ainda não há leitura desta página. Chame navegador_ler primeiro.');
    if (this.refsEpoch !== this.epoch) throw new Error(STALE_REFS_MESSAGE);
    const ref = this.refs.get(n);
    if (!ref) throw new Error(`Não há elemento [${n}] na última leitura. Chame navegador_ler de novo.`);
    if (ref.frame !== '' && !this.remote.has(ref.frame)) throw new Error(STALE_REFS_MESSAGE);
    return ref;
  }

  /** Runs CDP work on a node, turning "the node is gone" into the stale-refs message. */
  private async onNode<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (GONE_NODE.test(message)) throw new Error(STALE_REFS_MESSAGE);
      throw error;
    }
  }

  private async callOnNode<T = unknown>(ref: Pick<AxRef, 'frame' | 'backendNodeId'>, functionDeclaration: string, args: readonly unknown[] = []): Promise<T> {
    const { object } = await this.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId: ref.backendNodeId }, ref.frame);
    if (!object.objectId) throw new Error(STALE_REFS_MESSAGE);
    try {
      const { result } = await this.send<{ result: { value?: unknown } }>(
        'Runtime.callFunctionOn',
        { objectId: object.objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, silent: true },
        ref.frame,
      );
      return result.value as T;
    } finally {
      await this.send('Runtime.releaseObject', { objectId: object.objectId }, ref.frame).catch(() => undefined);
    }
  }

  /** Runs a page-side function on a node and answers the `backendNodeId` of the element it returns (`null` = none). */
  private async elementFrom(ref: Pick<AxRef, 'frame' | 'backendNodeId'>, functionDeclaration: string, args: readonly unknown[] = []): Promise<number | null> {
    const { object } = await this.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId: ref.backendNodeId }, ref.frame);
    if (!object.objectId) throw new Error(STALE_REFS_MESSAGE);
    let found: string | undefined;
    try {
      const { result } = await this.send<{ result: { objectId?: string; subtype?: string } }>(
        'Runtime.callFunctionOn',
        { objectId: object.objectId, functionDeclaration, arguments: args.map((value) => ({ value })), silent: true },
        ref.frame,
      );
      if (result.subtype !== 'node' || !result.objectId) return null;
      found = result.objectId;
      const { node } = await this.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId: found }, ref.frame);
      return node.backendNodeId;
    } finally {
      await this.send('Runtime.releaseObject', { objectId: object.objectId }, ref.frame).catch(() => undefined);
      if (found) await this.send('Runtime.releaseObject', { objectId: found }, ref.frame).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // CDP

  private async send<T = unknown>(method: string, params?: Record<string, unknown>, session = ''): Promise<T> {
    if (this.contents.isDestroyed()) throw new Error('O navegador desta sessão foi fechado.');
    if (!this.attached) {
      if (!this.contents.debugger.isAttached()) this.contents.debugger.attach(CDP_VERSION);
      this.attached = true;
      // The panel is often hidden or the window unfocused while the agent drives: without focus emulation the
      // page has no focused frame, and typing (`Input.insertText`) goes nowhere.
      await this.command('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
      await this.command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
      await delay(AUTO_ATTACH_SETTLE_MS);
    }
    return this.command<T>(method, params, session);
  }

  /** One CDP command with a ceiling: a stuck renderer must not hang the agent's tool forever. */
  private async command<T>(method: string, params?: Record<string, unknown>, session = ''): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        (session === '' ? this.contents.debugger.sendCommand(method, params) : this.contents.debugger.sendCommand(method, params, session)) as Promise<T>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`A página não respondeu (${method}).`)), COMMAND_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
