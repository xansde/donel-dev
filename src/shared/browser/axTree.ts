// Navegador integrado — the numbered accessibility tree the agent reads (`navegador_ler`). Pure, no I/O.
//
// Input: the nodes of CDP `Accessibility.getFullAXTree` of the panel's page. Output: a short indented text
// where every element the agent can act on gets a number `[N]`, plus the map `N -> backendDOMNodeId` the
// driver uses to click/type. The numbers are valid until the next read (docs/design/navegador-interno.md, D10).
//
// What is printed: headings, text, images with a name, landmarks/dialogs (as indentation) and the actionable
// elements. Everything else (generic containers, paragraphs, lists...) is walked through without a line of its
// own. iframes of another origin are not in the tree of the page (V1).

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
  readonly backendNodeId: number;
  readonly role: string;
  readonly name: string;
}

export interface AxSnapshot {
  /** The tree as the agent reads it (one element per line). */
  readonly text: string;
  /** `[N]` -> the element. Only numbers printed in `text` exist here. */
  readonly refs: ReadonlyMap<number, AxRef>;
  /** `true` when the page was longer than the budget and the end was cut. */
  readonly truncated: boolean;
}

export interface AxSnapshotOptions {
  /** Character budget of `text` (default 20 000). */
  readonly maxChars?: number;
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

/** Builds the numbered tree from the nodes of `Accessibility.getFullAXTree`. */
export function buildAxSnapshot(nodes: readonly AxNodeLike[], options: AxSnapshotOptions = {}): AxSnapshot {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const byId = new Map<string, AxNodeLike>();
  for (const node of nodes) byId.set(node.nodeId, node);
  const root = nodes.find((node) => node.parentId === undefined || !byId.has(node.parentId)) ?? nodes[0];

  const lines: string[] = [];
  const refs = new Map<number, AxRef>();
  let used = 0;
  let truncated = false;
  let next = 1;
  const visited = new Set<string>();

  const emit = (depth: number, line: string): boolean => {
    const full = `${'  '.repeat(depth)}${line}`;
    if (used + full.length + 1 > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(full);
    used += full.length + 1;
    return true;
  };

  // Iterative DFS (a page can be deep enough to blow the stack with recursion).
  const stack: { id: string; depth: number; parentName: string }[] = [];
  if (root) stack.push({ id: root.nodeId, depth: 0, parentName: '' });
  while (stack.length > 0 && !truncated) {
    const { id, depth, parentName } = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
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
        if (typeof node.backendDOMNodeId === 'number') {
          const n = next++;
          const extras = [...states(node, role)];
          const value = role === 'link' || role === 'button' ? null : valueText(node);
          if (value) extras.push(value);
          const line = `[${n}] ${role}${name ? ` ${quote(name)}` : ''}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;
          if (!emit(depth, line)) break;
          refs.set(n, { backendNodeId: node.backendDOMNodeId, role, name });
        }
        walkChildren = ACTIONABLE_CONTAINER_ROLES.has(role);
        childDepth = depth + 1;
        childParentName = name;
      } else if (role === 'heading') {
        const level = property(node, 'level');
        if (name && !emit(depth, `heading${typeof level === 'number' ? ` ${level}` : ''} ${quote(name)}`)) break;
        walkChildren = false;
      } else if (TEXT_ROLES.has(role)) {
        if (name && name !== parentName && !emit(depth, quote(name))) break;
        walkChildren = false;
      } else if (IMAGE_ROLES.has(role)) {
        if (name && !emit(depth, `imagem ${quote(name)}`)) break;
        walkChildren = false;
      } else if (LANDMARK_ROLES.has(role)) {
        if (!emit(depth, `${role}${name ? ` ${quote(name)}` : ''}:`)) break;
        childDepth = depth + 1;
        childParentName = name;
      }
    }

    if (walkChildren && node.childIds) {
      for (let i = node.childIds.length - 1; i >= 0; i -= 1) {
        stack.push({ id: node.childIds[i], depth: childDepth, parentName: childParentName });
      }
    }
  }

  if (truncated) lines.push('… (página longa: o resto da árvore foi cortado; use navegador_print para ver a tela)');
  return { text: lines.join('\n'), refs, truncated };
}
