// T083 (014-chat) - menu `/` catalog: union of the three sources (native list, disk, transcript `skill_listing`),
// `/login` and `/logout` out of the menu with an account warning when typed, `opensScreen`, `mtime` signature.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_COMMAND_WARNING,
  NATIVE_COMMANDS,
  NATIVE_COMMAND_NAMES,
  buildCatalog,
  catalogChanged,
  catalogSignature,
  filterCatalog,
  inspectTypedCommand,
  parseFrontmatter,
  parseSkillListing,
  type DiskCommand,
} from '../src/shared/chat/commandCatalog';

const disk = (over: Partial<DiskCommand> & { name: string }): DiskCommand => ({
  description: '',
  source: 'skill',
  scope: 'user',
  ...over,
});

describe('buildCatalog', () => {
  it('unites native, disk and skill_listing entries without duplicates', () => {
    const catalog = buildCatalog({
      disk: [disk({ name: 'deploy', description: 'Deploy it', source: 'command' })],
      listing: [{ name: 'deploy', description: 'Deploy it' }, { name: 'tdd', description: 'Test first' }],
    });
    const names = catalog.map((e) => e.name);
    expect(names).toContain('model');
    expect(names.filter((n) => n === 'deploy')).toHaveLength(1);
    expect(catalog.find((e) => e.name === 'deploy')).toMatchObject({ source: 'command', scope: 'user' });
    expect(catalog.find((e) => e.name === 'tdd')).toMatchObject({ source: 'skill', description: 'Test first' });
  });

  it('keeps entries that exist only on disk', () => {
    const catalog = buildCatalog({ disk: [disk({ name: 'private-skill', description: 'x' })], listing: [] });
    expect(catalog.find((e) => e.name === 'private-skill')).toBeDefined();
  });

  it('marks namespaced listing entries as plugin and keeps the disk origin when both know the name', () => {
    const catalog = buildCatalog({
      disk: [disk({ name: 'hookify:list', source: 'plugin', scope: 'plugin', description: 'disk text' })],
      listing: [{ name: 'hookify:list', description: 'listing text' }, { name: 'supabase:supabase', description: 's' }],
    });
    expect(catalog.find((e) => e.name === 'hookify:list')).toMatchObject({ source: 'plugin', scope: 'plugin' });
    expect(catalog.find((e) => e.name === 'supabase:supabase')).toMatchObject({ source: 'plugin', scope: 'plugin' });
  });

  it('lets a custom command win over a native name, like the send machine does', () => {
    const catalog = buildCatalog({ disk: [disk({ name: 'review', description: 'mine' })], listing: [] });
    const entries = catalog.filter((e) => e.name === 'review');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: 'skill', opensScreen: false, description: 'mine' });
  });

  it('prefers project over user scope for the same name', () => {
    const catalog = buildCatalog({
      disk: [disk({ name: 'x', scope: 'user', description: 'u' }), disk({ name: 'x', scope: 'project', description: 'p' })],
      listing: [],
    });
    expect(catalog.filter((e) => e.name === 'x')).toEqual([expect.objectContaining({ scope: 'project', description: 'p' })]);
  });

  it('leaves /login and /logout out of the menu', () => {
    const names = buildCatalog({ disk: [], listing: [] }).map((e) => e.name);
    expect(names).not.toContain('login');
    expect(names).not.toContain('logout');
  });

  it('marks screen-opening natives', () => {
    const catalog = buildCatalog({ disk: [], listing: [] });
    expect(catalog.find((e) => e.name === 'config')?.opensScreen).toBe(true);
    expect(catalog.find((e) => e.name === 'model')?.opensScreen).toBe(true);
    expect(catalog.find((e) => e.name === 'cost')?.opensScreen).toBe(false);
    expect(catalog.find((e) => e.name === 'clear')?.aliases).toContain('new');
  });

  it('sorts natives first, then the rest by name', () => {
    const catalog = buildCatalog({ disk: [disk({ name: 'aaa' })], listing: [] });
    expect(catalog[0]!.source).toBe('builtin');
    expect(catalog[catalog.length - 1]!.name).toBe('aaa');
  });
});

describe('inspectTypedCommand', () => {
  it('flags /login and /logout with the account warning', () => {
    expect(inspectTypedCommand('/login')).toMatchObject({ name: 'login', accountWarning: true });
    expect(inspectTypedCommand('/LOGOUT now')).toMatchObject({ name: 'LOGOUT', accountWarning: true });
    expect(ACCOUNT_COMMAND_WARNING).toMatch(/Contas/);
  });

  it('does not flag when a custom command owns the name', () => {
    expect(inspectTypedCommand('/login', new Set(['login'])).accountWarning).toBe(false);
  });

  it('reports opensScreen for the bare form only when the command takes arguments inline', () => {
    expect(inspectTypedCommand('/model').opensScreen).toBe(true);
    expect(inspectTypedCommand('/model opus').opensScreen).toBe(false);
    expect(inspectTypedCommand('/config').opensScreen).toBe(true);
    expect(inspectTypedCommand('/config foo').opensScreen).toBe(true);
    expect(inspectTypedCommand('/cost').opensScreen).toBe(false);
  });

  it('resolves aliases and ignores non-commands', () => {
    expect(inspectTypedCommand('/settings')).toMatchObject({ known: true, opensScreen: true });
    expect(inspectTypedCommand('/nope')).toMatchObject({ known: false, opensScreen: false, accountWarning: false });
    expect(inspectTypedCommand('hello')).toMatchObject({ name: '', known: false });
  });

  it('exposes every native name and alias', () => {
    expect(NATIVE_COMMAND_NAMES.has('settings')).toBe(true);
    expect(NATIVE_COMMAND_NAMES.has('compact')).toBe(true);
    expect(NATIVE_COMMANDS.every((c) => c.description !== '')).toBe(true);
  });
});

describe('parseSkillListing', () => {
  it('reads one "- name: description" line per skill, with plugin names and wrapped lines', () => {
    const content = ['- tdd: Test-driven development.', '- supabase:supabase: Use for Supabase.', '  more text', '- bare'].join('\n');
    expect(parseSkillListing(content)).toEqual([
      { name: 'tdd', description: 'Test-driven development.' },
      { name: 'supabase:supabase', description: 'Use for Supabase. more text' },
      { name: 'bare', description: '' },
    ]);
  });

  it('ignores non-string and empty content', () => {
    expect(parseSkillListing(undefined)).toEqual([]);
    expect(parseSkillListing('')).toEqual([]);
  });
});

describe('parseFrontmatter', () => {
  it('reads name and description, plain or quoted', () => {
    expect(parseFrontmatter('---\nname: foo\ndescription: "Does foo: well"\nother: 1\n---\nbody')).toEqual({ name: 'foo', description: 'Does foo: well' });
  });

  it('reads folded and literal block scalars', () => {
    const text = '---\nname: foo\ndescription: >-\n  first line\n  second line\n---\n';
    expect(parseFrontmatter(text).description).toBe('first line second line');
    expect(parseFrontmatter('---\ndescription: |\n  a\n  b\n---\n').description).toBe('a\nb');
  });

  it('returns nothing without a frontmatter block and tolerates CRLF', () => {
    expect(parseFrontmatter('# title\nname: x')).toEqual({});
    expect(parseFrontmatter('---\r\nname: x\r\n---\r\n')).toEqual({ name: 'x' });
  });
});

describe('mtime signature', () => {
  const a = [{ path: '/a', mtimeMs: 1, size: 3 }, { path: '/b', mtimeMs: 2, size: 4 }];
  it('is stable for the same stamps in any order', () => {
    expect(catalogSignature(a)).toBe(catalogSignature([...a].reverse()));
    expect(catalogChanged(catalogSignature(a), catalogSignature(a))).toBe(false);
  });
  it('changes on mtime, size, add and remove', () => {
    const base = catalogSignature(a);
    expect(catalogChanged(base, catalogSignature([{ ...a[0]!, mtimeMs: 9 }, a[1]!]))).toBe(true);
    expect(catalogChanged(base, catalogSignature([{ ...a[0]!, size: 9 }, a[1]!]))).toBe(true);
    expect(catalogChanged(base, catalogSignature([a[0]!]))).toBe(true);
    expect(catalogChanged(base, catalogSignature([...a, { path: '/c', mtimeMs: 1, size: 1 }]))).toBe(true);
    expect(catalogChanged(null, base)).toBe(true);
  });
});

describe('filterCatalog', () => {
  const catalog = buildCatalog({ disk: [disk({ name: 'deploy-prod', description: 'Ship it' })], listing: [] });
  it('returns everything for an empty query, natives first', () => {
    expect(filterCatalog(catalog, '', 500)).toHaveLength(catalog.length);
  });
  it('ranks name prefix first, matches aliases and descriptions', () => {
    expect(filterCatalog(catalog, 'mod', 5)[0]!.name).toBe('model');
    expect(filterCatalog(catalog, 'settings', 5).map((e) => e.name)).toContain('config');
    expect(filterCatalog(catalog, 'ship', 5).map((e) => e.name)).toContain('deploy-prod');
  });
  it('respects the limit', () => {
    expect(filterCatalog(catalog, '', 3)).toHaveLength(3);
  });
});
