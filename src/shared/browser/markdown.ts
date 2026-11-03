// Navegador integrado — the page as readable Markdown (`navegador_extrair`, V2, docs/design/navegador-interno.md).
// Pure, no I/O.
//
// Input: the DOM of CDP `DOM.getDocument({ depth: -1, pierce: true })` (shadow roots and same-process iframes come
// inside it), the documents of iframes of another origin (read in their own CDP session) and which text nodes have a
// layout box (from `DOMSnapshot.captureSnapshot`: text inside `display: none` has none). Output: Markdown that keeps
// headings, paragraphs, lists, tables, links and code, cut at a block boundary when it passes the budget.
//
// Idea from browser-use (MIT, github.com/browser-use/browser-use): `dom/markdown_extractor.py` (serialize the pierced
// tree, shadow DOM and iframes included, then drop SPA state blobs and extra blank lines). Written here without
// `markdownify` and without an HTML string in between: the tree is walked straight to Markdown.

/** The subset of a CDP `DOM.Node` this module reads. */
export interface DomNodeLike {
  readonly backendNodeId?: number;
  readonly nodeType: number;
  readonly nodeName: string;
  readonly localName?: string;
  readonly nodeValue?: string;
  readonly children?: readonly DomNodeLike[];
  readonly attributes?: readonly string[];
  readonly shadowRoots?: readonly DomNodeLike[];
  readonly shadowRootType?: string;
  readonly contentDocument?: DomNodeLike;
  readonly frameId?: string;
  readonly documentURL?: string;
  readonly baseURL?: string;
}

/** A document read in another CDP session (iframe of another origin). */
export interface DomFrame {
  readonly key: string;
  readonly root: DomNodeLike;
}

export interface MarkdownOptions {
  /** Character budget of the returned Markdown (default 40 000). */
  readonly maxChars?: number;
  /** Skip this many characters of the full Markdown first (to read on after a cut). */
  readonly startAt?: number;
  /** `false` when the text node has no layout box (hidden by CSS); `undefined` = unknown, kept. */
  isRendered?(frameKey: string, backendNodeId: number): boolean | undefined;
  /** The document of the iframe element with this `frameId` when it lives in another CDP session. */
  childDocument?(frameId: string): DomFrame | null;
}

export interface MarkdownResult {
  readonly markdown: string;
  /** Length of the whole Markdown of the page. */
  readonly total: number;
  /** Where the next `startAt` should begin when the result was cut (`null` = nothing left). */
  readonly nextStart: number | null;
}

const ELEMENT = 1;
const TEXT = 3;
const DOCUMENT = 9;
const FRAGMENT = 11;
const DEFAULT_MAX_CHARS = 40_000;
const MAX_DEPTH = 300;

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'svg', 'canvas', 'object', 'embed', 'audio', 'video', 'map', 'datalist', 'option', 'optgroup', 'select', 'textarea']);
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'iframe', 'frame', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section',
  'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'caption',
]);

function attr(node: DomNodeLike, name: string): string | undefined {
  const list = node.attributes;
  if (!list) return undefined;
  for (let i = 0; i + 1 < list.length; i += 2) if (list[i].toLowerCase() === name) return list[i + 1];
  return undefined;
}

/**
 * The shadow tree a page author attached. The browser's own (`user-agent`) shadow trees are never read: the one of
 * an `<input>` holds what is typed in it, a password included.
 */
function authorShadow(node: DomNodeLike): DomNodeLike | undefined {
  return node.shadowRoots?.find((root) => root.shadowRootType !== 'user-agent' && (root.children?.length ?? 0) > 0);
}

/** Inline controls: their text (a button's label) goes inline, never their insides. */
const INLINE_CONTROLS = new Set(['input', 'button', 'img', 'br']);

function tagOf(node: DomNodeLike): string {
  return (node.localName || node.nodeName || '').toLowerCase();
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Absolute http(s)/mailto URL, or null (javascript:, data:, empty...). */
function linkTarget(href: string | undefined, base: string): string | null {
  if (!href || href.trim() === '' || href.startsWith('#')) return null;
  try {
    const url = new URL(href.trim(), base || undefined);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A long line that parses as JSON is SPA state, not content (browser-use `_preprocess_markdown_content`). */
function isJsonBlob(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length <= 100 || (trimmed[0] !== '{' && trimmed[0] !== '[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

interface Walk {
  readonly frame: string;
  readonly base: string;
  /** Shadow hosts being rendered, innermost last (a `<slot>` shows the light children of the last one). */
  readonly hosts: readonly DomNodeLike[];
  readonly depth: number;
}

/** Converts the pierced DOM of the page to Markdown. */
export function domToMarkdown(document: DomNodeLike, options: MarkdownOptions = {}): MarkdownResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const seenFrames = new Set<string>();

  const rendered = (walk: Walk, node: DomNodeLike): boolean =>
    node.backendNodeId === undefined || options.isRendered?.(walk.frame, node.backendNodeId) !== false;

  const hiddenElement = (node: DomNodeLike): boolean => {
    const tag = tagOf(node);
    if (SKIPPED.has(tag)) return true;
    if (attr(node, 'hidden') !== undefined) return true;
    if (tag === 'input' && attr(node, 'type')?.toLowerCase() === 'hidden') return true;
    if (tag === 'dialog' && attr(node, 'open') === undefined) return true;
    return false;
  };

  /** The nodes an element shows: its shadow tree when it has one, its light children otherwise; a slot shows the host's. */
  const shownChildren = (node: DomNodeLike, walk: Walk): { nodes: readonly DomNodeLike[]; walk: Walk } => {
    const next: Walk = { ...walk, depth: walk.depth + 1 };
    if (node.nodeType === ELEMENT && tagOf(node) === 'slot') {
      const host = walk.hosts[walk.hosts.length - 1];
      if (host) {
        const name = attr(node, 'name') ?? '';
        const assigned = (host.children ?? []).filter((child) => (child.nodeType === ELEMENT ? (attr(child, 'slot') ?? '') : '') === name);
        if (assigned.length > 0) return { nodes: assigned, walk: { ...next, hosts: walk.hosts.slice(0, -1) } };
      }
      return { nodes: node.children ?? [], walk: next };
    }
    const shadow = authorShadow(node);
    if (shadow) return { nodes: shadow.children ?? [], walk: { ...next, hosts: [...walk.hosts, node] } };
    if (node.contentDocument) {
      const doc = node.contentDocument;
      return { nodes: doc.children ?? [], walk: { ...next, base: doc.baseURL || doc.documentURL || walk.base } };
    }
    if (node.frameId && !seenFrames.has(node.frameId)) {
      const child = options.childDocument?.(node.frameId);
      if (child) {
        seenFrames.add(node.frameId);
        return { nodes: child.root.children ?? [], walk: { frame: child.key, base: child.root.baseURL || child.root.documentURL || walk.base, hosts: [], depth: walk.depth + 1 } };
      }
    }
    return { nodes: node.children ?? [], walk: next };
  };

  const inline = (node: DomNodeLike, walk: Walk): string => {
    if (walk.depth > MAX_DEPTH) return '';
    if (node.nodeType === TEXT) return rendered(walk, node) ? collapse(node.nodeValue ?? '') : '';
    if (node.nodeType !== ELEMENT && node.nodeType !== DOCUMENT && node.nodeType !== FRAGMENT) return '';
    if (node.nodeType === ELEMENT && hiddenElement(node)) return '';
    const tag = tagOf(node);
    if (tag === 'br') return ' ';
    if (tag === 'img') {
      const alt = collapse(attr(node, 'alt') ?? '').trim();
      return alt ? `![${alt}]` : '';
    }
    if (tag === 'input') {
      const type = (attr(node, 'type') ?? 'text').toLowerCase();
      return type === 'submit' || type === 'button' || type === 'reset' ? collapse(attr(node, 'value') ?? '') : '';
    }
    const shown = shownChildren(node, walk);
    const parts = shown.nodes.map((child) => {
      const text = inline(child, shown.walk);
      return child.nodeType === ELEMENT && BLOCK.has(tagOf(child)) ? ` ${text} ` : text;
    });
    const text = collapse(parts.join(''));
    if (text.trim() === '') return text.length > 0 ? ' ' : '';
    switch (tag) {
      case 'button':
        return ` ${text.trim()} `;
      case 'a': {
        const href = linkTarget(attr(node, 'href'), walk.base);
        const label = text.trim();
        return href ? ` [${label.replace(/[[\]]/g, '')}](${href}) ` : text;
      }
      case 'strong':
      case 'b':
        return ` **${text.trim()}** `;
      case 'em':
      case 'i':
        return ` *${text.trim()}* `;
      case 'code':
      case 'kbd':
      case 'samp':
        return ` \`${text.trim().replace(/`/g, "'")}\` `;
      default:
        return text;
    }
  };

  const tidy = (text: string): string => collapse(text).replace(/\s+([.,;:!?])/g, '$1').trim();

  const blocks = (node: DomNodeLike, walk: Walk, out: string[]): void => {
    if (walk.depth > MAX_DEPTH) return;
    if (node.nodeType === TEXT) {
      const text = rendered(walk, node) ? tidy(node.nodeValue ?? '') : '';
      if (text) out.push(text);
      return;
    }
    if (node.nodeType !== ELEMENT && node.nodeType !== DOCUMENT && node.nodeType !== FRAGMENT) return;
    if (node.nodeType === ELEMENT && hiddenElement(node)) return;
    const tag = tagOf(node);

    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const text = tidy(inline(node, walk));
      if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
      return;
    }
    switch (tag) {
      case 'p':
      case 'figcaption':
      case 'caption':
      case 'summary':
      case 'dt': {
        const text = tidy(inline(node, walk));
        if (text) out.push(tag === 'dt' ? `**${text}**` : text);
        return;
      }
      case 'hr':
        out.push('---');
        return;
      case 'pre': {
        const text = textContent(node, walk).replace(/^\n+|\s+$/g, '');
        if (text) out.push(`\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\``);
        return;
      }
      case 'ul':
      case 'ol':
      case 'menu': {
        const lines = list(node, walk, 0);
        if (lines.length > 0) out.push(lines.join('\n'));
        return;
      }
      case 'table': {
        const table = tableOf(node, walk);
        if (table) out.push(table);
        return;
      }
      case 'blockquote': {
        const inner: string[] = [];
        children(node, walk, inner);
        if (inner.length > 0) out.push(inner.join('\n\n').split('\n').map((line) => `> ${line}`).join('\n'));
        return;
      }
      default:
        children(node, walk, out);
    }
  };

  /** Children of a block: runs of inline content become one paragraph each, blocks go through `blocks`. */
  const children = (node: DomNodeLike, walk: Walk, out: string[]): void => {
    const shown = shownChildren(node, walk);
    let paragraph = '';
    const flush = (): void => {
      const text = tidy(paragraph);
      if (text) out.push(text);
      paragraph = '';
    };
    for (const child of shown.nodes) {
      const isBlock =
        child.nodeType === ELEMENT
          ? !INLINE_CONTROLS.has(tagOf(child)) && (BLOCK.has(tagOf(child)) || authorShadow(child) !== undefined || child.contentDocument !== undefined || child.frameId !== undefined)
          : child.nodeType !== TEXT;
      if (isBlock) {
        flush();
        blocks(child, shown.walk, out);
      } else {
        paragraph += inline(child, shown.walk);
      }
    }
    flush();
  };

  const textContent = (node: DomNodeLike, walk: Walk): string => {
    if (node.nodeType === TEXT) return rendered(walk, node) ? (node.nodeValue ?? '') : '';
    if (node.nodeType === ELEMENT && hiddenElement(node)) return '';
    if (node.nodeType === ELEMENT && tagOf(node) === 'br') return '\n';
    const shown = shownChildren(node, walk);
    return shown.nodes.map((child) => textContent(child, shown.walk)).join('');
  };

  const list = (node: DomNodeLike, walk: Walk, level: number): string[] => {
    const ordered = tagOf(node) === 'ol';
    const lines: string[] = [];
    let count = 0;
    const shown = shownChildren(node, walk);
    for (const item of shown.nodes) {
      if (item.nodeType !== ELEMENT || hiddenElement(item)) continue;
      if (tagOf(item) !== 'li') {
        // A wrapper inside the list (frameworks do this): its items count as ours.
        if (tagOf(item) === 'ul' || tagOf(item) === 'ol') lines.push(...list(item, shown.walk, level + 1));
        continue;
      }
      count += 1;
      const itemShown = shownChildren(item, shown.walk);
      let text = '';
      const nested: string[] = [];
      for (const child of itemShown.nodes) {
        const tag = child.nodeType === ELEMENT ? tagOf(child) : '';
        if (tag === 'ul' || tag === 'ol') nested.push(...list(child, itemShown.walk, level + 1));
        else text += child.nodeType === ELEMENT && BLOCK.has(tag) ? ` ${inline(child, itemShown.walk)} ` : inline(child, itemShown.walk);
      }
      const clean = tidy(text);
      if (clean || nested.length > 0) lines.push(`${'  '.repeat(level)}${ordered ? `${count}.` : '-'} ${clean}`);
      lines.push(...nested);
    }
    return lines;
  };

  const tableOf = (table: DomNodeLike, walk: Walk): string | null => {
    const rows: string[][] = [];
    const collect = (node: DomNodeLike, w: Walk): void => {
      const shown = shownChildren(node, w);
      for (const child of shown.nodes) {
        if (child.nodeType !== ELEMENT || hiddenElement(child)) continue;
        const tag = tagOf(child);
        if (tag === 'tr') {
          const cellsShown = shownChildren(child, shown.walk);
          const cells = cellsShown.nodes
            .filter((cell) => cell.nodeType === ELEMENT && (tagOf(cell) === 'td' || tagOf(cell) === 'th'))
            .map((cell) => tidy(inline(cell, cellsShown.walk)).replace(/\|/g, '\\|'));
          if (cells.length > 0) rows.push(cells);
        } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
          collect(child, shown.walk);
        }
      }
    };
    collect(table, walk);
    if (rows.length === 0) return null;
    const width = Math.max(...rows.map((row) => row.length));
    const pad = (row: string[]): string[] => [...row, ...Array<string>(width - row.length).fill('')];
    const line = (row: string[]): string => `| ${pad(row).join(' | ')} |`;
    return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
  };

  const out: string[] = [];
  blocks(document, { frame: '', base: document.baseURL || document.documentURL || '', hosts: [], depth: 0 }, out);

  const cleaned = out
    .map((block) => block.split('\n').filter((line) => !isJsonBlob(line)).join('\n').trim())
    .filter((block) => block !== '');
  // Same block twice in a row (a heading repeated by a sticky header) is noise.
  const deduped = cleaned.filter((block, i) => block !== cleaned[i - 1]);
  const full = deduped.join('\n\n');

  const start = Math.max(0, Math.min(options.startAt ?? 0, full.length));
  const rest = full.slice(start);
  if (rest.length <= maxChars) return { markdown: rest, total: full.length, nextStart: null };
  // Cut at the end of a block (a blank line) when there is one in the last fifth of the budget.
  let cut = rest.lastIndexOf('\n\n', maxChars);
  if (cut < maxChars * 0.8) cut = maxChars;
  return { markdown: rest.slice(0, cut), total: full.length, nextStart: start + cut };
}
