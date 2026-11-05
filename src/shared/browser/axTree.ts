// Navegador integrado — the numbered accessibility tree the agent reads (`navegador_ler`). Pure, no I/O.
//
// Input: the nodes of CDP `Accessibility.getFullAXTree` of the panel's page. Output: a short indented text
// where every element the agent can act on gets a number `[N]`, plus the map `N -> backendDOMNodeId` the
// driver uses to click/type. The numbers are valid until the next read (docs/design/navegador-interno.md, D10).
//
// What is printed: headings, text, images with a name, landmarks/dialogs (as indentation) and the actionable
// elements. Everything else (generic containers, paragraphs, lists...) is walked through without a line of its
// own.
//
// V2 (03/11): the tree of every frame is spliced in place of its `Iframe` node (iframes of another origin included,
// read in their own CDP session), and, when a placement oracle is given (shared/browser/visibility.ts), only what is
// on screen gets a line: actionable elements scrolled away are counted ("N acima / N abaixo"), covered ones too.

import type { Placement } from './visibility';

/** The subset of a CDP `Accessibility.AXValue` this module reads. */
export interface AxValueLike {
  readonly type?: string;
  readonly value?: unknown;
}

/** The subset of a CDP `Accessibility.AXNode` this module reads. */
export interface AxNodeLike {
  readonly nodeId: string;
  readonly ignored?: boolean;
  readonly role?: AxValueLike;
  readonly name?: AxValueLike;
  readonly value?: AxValueLike;
  readonly properties?: readonly { readonly name: string; readonly value?: AxValueLike }[];
  readonly parentId?: string;
  readonly childIds?: readonly string[];
  readonly backendDOMNodeId?: number;
}

export interface AxRef {
  /** CDP session of the frame the element lives in (`''` = the page itself). */
  readonly frame: string;
  readonly backendNodeId: number;
  readonly role: string;
  readonly name: string;
}

/** The accessibility tree of one frame. `key` names the CDP session it was read in (`''` = the page). */
export interface AxFrame {
  readonly key: string;
  readonly nodes: readonly AxNodeLike[];
}

export interface OffscreenCounts {
  readonly above: number;
  readonly below: number;
  readonly beside: number;
  readonly covered: number;
}

export interface AxSnapshot {
  /** The tree as the agent reads it (one element per line). */
  readonly text: string;
  /** `[N]` -> the element. Only numbers printed in `text` exist here. */
  readonly refs: ReadonlyMap<number, AxRef>;
  /** `true` when the page was longer than the budget and the end was cut. */
  readonly truncated: boolean;
  /** Actionable elements left out because they are not on screen. */
  readonly offscreen: OffscreenCounts;
}

export interface AxSnapshotOptions {
  /** Character budget of `text` (default 20 000). */
  readonly maxChars?: number;
  /** The frame shown by the iframe element `iframeBackendNodeId` of frame `frameKey`, when it was read. */
  childFrame?(frameKey: string, iframeBackendNodeId: number): AxFrame | null;
  /** Where an element is. Without it (or `undefined` for a node), everything counts as on screen. */
  placement?(frameKey: string, backendNodeId: number): Placement | undefined;
}

/** Roles the agent acts on: each one gets a number. Their children are not walked (their text is their name). */
const ACTIONABLE_LEAF_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'slider',
  'spinbutton',
  'ListBoxOption',
  'MenuListOption',
]);
/** Actionable roles whose children matter (an open combobox lists its options, a tree item holds sub-items). */
const ACTIONABLE_CONTAINER_ROLES = new Set(['combobox', 'treeitem', 'PopUpButton']);
/** Containers that become an indented line of their own (so the agent sees "this button is inside the dialog"). */
const LANDMARK_ROLES = new Set(['dialog', 'alertdialog', 'navigation', 'main', 'banner', 'contentinfo', 'form', 'search', 'complementary', 'region', 'menu', 'menubar', 'listbox', 'tablist', 'tree', 'table', 'alert']);
/** Never printed, never walked. */
const SKIPPED_ROLES = new Set(['InlineTextBox', 'LineBreak']);
const TEXT_ROLES = new Set(['StaticText', 'text']);
const IMAGE_ROLES = new Set(['img', 'image']);

const DEFAULT_MAX_CHARS = 20_000;
const MAX_NAME_CHARS = 160;
const MASK_ONLY = /^[•●*·∙]+$/u;

function stringOf(value: AxValueLike | undefined): string {
  const raw = value?.value;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

function clean(text: string, max = MAX_NAME_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function quote(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`;
}

function property(node: AxNodeLike, name: string): unknown {
  return node.properties?.find((candidate) => candidate.name === name)?.value?.value;
}

/** The state words after an actionable element (pt-BR: the agent repeats them to the owner). */
function states(node: AxNodeLike, role: string): string[] {
  const out: string[] = [];
  if (property(node, 'disabled') === true) out.push('desativado');
  const checked = property(node, 'checked');
  if (checked === 'true' || checked === true) out.push('marcado');
  else if (checked === 'mixed') out.push('parcialmente marcado');
  else if ((role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox') && (checked === 'false' || checked === false)) out.push('desmarcado');
  if (property(node, 'pressed') === 'true' || property(node, 'pressed') === true) out.push('pressionado');
  if (property(node, 'selected') === true) out.push('selecionado');
  const expanded = property(node, 'expanded');
  if (expanded === true) out.push('expandido');
  else if (expanded === false) out.push('recolhido');
  if (property(node, 'required') === true) out.push('obrigatório');
  if (property(node, 'focused') === true) out.push('em foco');
  return out;
}

function valueText(node: AxNodeLike): string | null {
  const value = clean(stringOf(node.value), 200);
  if (value === '') return null;
  // Chromium masks password fields with bullets in the accessibility tree: never echo even the mask.
  if (MASK_ONLY.test(value)) return 'valor: (oculto)';
  return `valor: ${quote(value)}`;
}

interface Line {
  readonly depth: number;
  readonly text: string;
  /** A landmark/iframe header: dropped when nothing was printed inside it. */
  readonly header: boolean;
  readonly ref?: number;
}

interface IndexedFrame {
  readonly key: string;
  /** Unique per frame of one read: AX node ids of two frames of the same process may repeat. */
  readonly uid: number;
  readonly byId: ReadonlyMap<string, AxNodeLike>;
  readonly root: AxNodeLike | undefined;
}

let frameUid = 0;

function indexFrame(frame: AxFrame): IndexedFrame {
  const byId = new Map<string, AxNodeLike>();
  for (const node of frame.nodes) byId.set(node.nodeId, node);
  const root = frame.nodes.find((node) => node.parentId === undefined || !byId.has(node.parentId)) ?? frame.nodes[0];
  frameUid += 1;
  return { key: frame.key, uid: frameUid, byId, root };
}

/** Builds the numbered tree from `Accessibility.getFullAXTree` of the page (and of its frames, via `childFrame`). */
export function buildAxSnapshot(page: AxFrame | readonly AxNodeLike[], options: AxSnapshotOptions = {}): AxSnapshot {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const top = indexFrame(Array.isArray(page) ? { key: '', nodes: page } : (page as AxFrame));

  const lines: Line[] = [];
  const refs = new Map<number, AxRef>();
  const counts = { above: 0, below: 0, beside: 0, covered: 0 };
  let next = 1;
  const visited = new Set<string>();
  const framesSeen = new Set<string>([top.key]);
  const where = (frame: string, backendNodeId: number | undefined): Placement | undefined =>
    backendNodeId === undefined ? undefined : options.placement?.(frame, backendNodeId);
  const onScreen = (placement: Placement | undefined): boolean => placement === undefined || placement === 'visible';

  // Iterative DFS (a page can be deep enough to blow the stack with recursion).
  const stack: { frame: IndexedFrame; id: string; depth: number; parentName: string }[] = [];
  if (top.root) stack.push({ frame: top, id: top.root.nodeId, depth: 0, parentName: '' });
  while (stack.length > 0) {
    const { frame, id, depth, parentName } = stack.pop()!;
    const visitKey = `${frame.uid}\u0000${id}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const node = frame.byId.get(id);
    if (!node) continue;
    const role = stringOf(node.role);
    if (SKIPPED_ROLES.has(role)) continue;
    const name = clean(stringOf(node.name));
    const hidden = property(node, 'hidden') === true;

    let childDepth = depth;
    let childParentName = parentName;
    let walkChildren = !hidden;

    if (!node.ignored && !hidden) {
      if (ACTIONABLE_LEAF_ROLES.has(role) || ACTIONABLE_CONTAINER_ROLES.has(role)) {
        walkChildren = ACTIONABLE_CONTAINER_ROLES.has(role);
        childDepth = depth + 1;
        childParentName = name;
        if (typeof node.backendDOMNodeId === 'number') {
          const placement = where(frame.key, node.backendDOMNodeId);
          if (onScreen(placement)) {
            const n = next++;
            const extras = [...states(node, role)];
            const value = role === 'link' || role === 'button' ? null : valueText(node);
            if (value) extras.push(value);
            lines.push({ depth, header: false, ref: n, text: `[${n}] ${role}${name ? ` ${quote(name)}` : ''}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}` });
            refs.set(n, { frame: frame.key, backendNodeId: node.backendDOMNodeId, role, name });
          } else {
            if (placement === 'above' || placement === 'below' || placement === 'beside' || placement === 'covered') counts[placement] += 1;
            walkChildren = false;
          }
        }
      } else if (role === 'heading') {
        if (name && onScreen(where(frame.key, node.backendDOMNodeId))) {
          const level = property(node, 'level');
          lines.push({ depth, header: false, text: `heading${typeof level === 'number' ? ` ${level}` : ''} ${quote(name)}` });
        }
        walkChildren = false;
      } else if (TEXT_ROLES.has(role)) {
        if (name && name !== parentName && onScreen(where(frame.key, node.backendDOMNodeId))) lines.push({ depth, header: false, text: quote(name) });
        walkChildren = false;
      } else if (IMAGE_ROLES.has(role)) {
        if (name && onScreen(where(frame.key, node.backendDOMNodeId))) lines.push({ depth, header: false, text: `imagem ${quote(name)}` });
        walkChildren = false;
      } else if (role === 'Iframe') {
        // The frame's own tree goes here, one level in; a frame off screen or covered is skipped whole.
        walkChildren = false;
        const placement = where(frame.key, node.backendDOMNodeId);
        const child = typeof node.backendDOMNodeId === 'number' && onScreen(placement) ? options.childFrame?.(frame.key, node.backendDOMNodeId) : null;
        if (child && !framesSeen.has(child.key + '\u0000' + node.backendDOMNodeId)) {
          framesSeen.add(child.key + '\u0000' + node.backendDOMNodeId);
          const indexed = indexFrame(child);
          lines.push({ depth, header: true, text: `iframe${name ? ` ${quote(name)}` : ''}:` });
          if (indexed.root) stack.push({ frame: indexed, id: indexed.root.nodeId, depth: depth + 1, parentName: name });
        }
      } else if (LANDMARK_ROLES.has(role)) {
        lines.push({ depth, header: true, text: `${role}${name ? ` ${quote(name)}` : ''}:` });
        childDepth = depth + 1;
        childParentName = name;
      }
    }

    if (walkChildren && node.childIds) {
      for (let i = node.childIds.length - 1; i >= 0; i -= 1) {
        stack.push({ frame, id: node.childIds[i], depth: childDepth, parentName: childParentName });
      }
    }
  }

  // A header with nothing printed inside it (everything off screen) says nothing: drop it.
  const kept = lines.filter((line, i) => !line.header || hasContentBelow(lines, i));

  const out: string[] = [];
  let used = 0;
  let truncated = false;
  for (const line of kept) {
    const full = `${'  '.repeat(line.depth)}${line.text}`;
    if (used + full.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    out.push(full);
    used += full.length + 1;
  }
  if (truncated) {
    const printed = new Set(kept.slice(0, out.length).map((line) => line.ref).filter((ref): ref is number => ref !== undefined));
    for (const n of [...refs.keys()]) if (!printed.has(n)) refs.delete(n);
    out.push('… (página longa: o resto da leitura foi cortado; use navegador_rolar, navegador_achar_texto ou navegador_extrair)');
  }
  return { text: out.join('\n'), refs, truncated, offscreen: counts };
}

/** `true` when some non-header line sits inside the header at `index`. */
function hasContentBelow(lines: readonly Line[], index: number): boolean {
  const depth = lines[index].depth;
  for (let i = index + 1; i < lines.length && lines[i].depth > depth; i += 1) if (!lines[i].header) return true;
  return false;
}

/** The footer of a read: what was left out because it is not on screen. Empty when nothing was. */
export function offscreenSummary(counts: OffscreenCounts): string {
  const parts: string[] = [];
  if (counts.above > 0) parts.push(`${counts.above} acima`);
  if (counts.below > 0) parts.push(`${counts.below} abaixo`);
  if (counts.beside > 0) parts.push(`${counts.beside} ao lado`);
  const lines: string[] = [];
  if (parts.length > 0) {
    lines.push(`Fora da tela: ${parts.join(', ')} (elementos de ação). Para chegar: navegador_rolar ou navegador_achar_texto; o conteúdo todo: navegador_extrair.`);
  }
  if (counts.covered > 0) {
    lines.push(`${counts.covered} ${counts.covered === 1 ? 'elemento coberto' : 'elementos cobertos'} por outra coisa na tela (aviso, modal ou menu aberto?).`);
  }
  return lines.join('\n');
}
