// T087 (014-chat) - the `/` and `@` menus of the composer: a design-system `Listbox` that floats above the box
// (design T06-D / T06-E). `/` lists skills and commands (name, description, origin chip); `@` lists project
// files. The box keeps the keyboard focus and drives the menu (`ChatComposer`); this file only draws the rows.

import { Listbox, type ListboxItem } from '@donel-dev/design-system';
import { File as FileIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CommandEntry } from '../../../../shared/chat/ipc';
import { SCOPE_BADGE, matchRange } from './composerMenu';

export type MenuRows =
  | { readonly kind: 'slash'; readonly entries: readonly CommandEntry[]; readonly total: number }
  | { readonly kind: 'path'; readonly paths: readonly string[] };

export interface CommandMenuProps {
  rows: MenuRows;
  query: string;
  activeId: string | null;
  listId: string;
  onActiveChange: (id: string) => void;
  onSelect: (id: string) => void;
}

/** Row ids: the command name / the relative path (unique inside one menu). */
export const rowIdsOf = (rows: MenuRows): string[] => (rows.kind === 'slash' ? rows.entries.map((e) => e.name) : [...rows.paths]);

/** `value` with the part matching `query` in the accent colour (design: the typed prefix is highlighted). */
function marked(value: string, query: string, prefix = ''): ReactNode {
  const range = matchRange(value, query);
  if (range === null) return `${prefix}${value}`;
  const [from, to] = range;
  const typed = from === 0 ? `${prefix}${value.slice(from, to)}` : value.slice(from, to);
  return (
    <>
      {from === 0 ? null : `${prefix}${value.slice(0, from)}`}
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{typed}</span>
      {value.slice(to)}
    </>
  );
}

export function CommandMenu({ rows, query, activeId, listId, onActiveChange, onSelect }: CommandMenuProps): React.JSX.Element {
  const items: ListboxItem[] =
    rows.kind === 'slash'
      ? rows.entries.map((entry) => ({
          id: entry.name,
          primary: marked(entry.name, query.replace(/^\/+/, ''), '/'),
          secondary: entry.description,
          badge: SCOPE_BADGE[entry.scope],
        }))
      : rows.paths.map((path) => ({
          id: path,
          leading: <FileIcon size={16} strokeWidth={1.75} aria-hidden="true" />,
          primary: marked(path, query),
        }));
  const meta = rows.kind === 'slash' ? `${items.length} de ${rows.total} · /${query}` : `${items.length} · @${query}`;
  const title = rows.kind === 'slash' ? 'Skills e comandos' : 'Arquivos do projeto';
  return (
    <div data-testid={rows.kind === 'slash' ? 'chat-menu-slash' : 'chat-menu-path'}>
      <Listbox
        id={listId}
        label={title}
        title={title}
        meta={meta}
        items={items}
        activeId={activeId}
        onActiveChange={onActiveChange}
        onSelect={onSelect}
        primaryWidth={rows.kind === 'slash' ? 150 : undefined}
        footer={
          <>
            <span>↑ ↓ navegam</span>
            <span>{rows.kind === 'slash' ? 'Tab escolhe' : 'Tab insere a menção'}</span>
            <span>Enter envia o que está escrito</span>
            <span>Esc fecha</span>
          </>
        }
      />
    </div>
  );
}
