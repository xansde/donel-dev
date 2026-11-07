import { describe, expect, it } from 'vitest';
import { addScopeMcp, chairSheet, setScopeAll, setScopeItem } from '../src/shared/chair-sheet';
import { sanitizeRole, type SessionRole } from '../src/shared/roles';

// Cadeiras, fatia 3 — the chair screen saves into the role (`<userData>/papeis/<id>.md`). What could break without the
// owner noticing is the scope written to that file: turning one item off must never drop the others, the app's own
// MCP never leaves, and what is saved must read back the same.

const inventory = { skillNames: ['deepdive', 'eval', 'rigs'], pluginIds: ['dev@seazone-skills', 'esteira@seazone-skills'] };
const role: SessionRole = { id: 'atlas', name: 'Atlas', color: 'implementar', guidance: 'Faz a mudança pedida.' };
/** What the store writes and reads back. */
const saved = (value: SessionRole): SessionRole => sanitizeRole(value)!;

describe('saving a chair into its role', () => {
  it('turning one skill off when the role kept them all keeps every other skill, and leaves the other axes alone', () => {
    const edited = saved(setScopeItem(role, 'skills', 'eval', false, inventory));
    expect(edited.scope?.skills).toEqual(['deepdive', 'rigs']);
    expect(edited.scope?.plugins).toBeUndefined();
    expect(edited.scope?.mcps).toBeUndefined();
    expect(chairSheet(edited, inventory).skills.items.filter((item) => item.on).map((item) => item.name)).toEqual(['deepdive', 'rigs']);
  });

  it('a plugin kept by its short name turns off and on by its full id', () => {
    const withShort: SessionRole = { ...role, scope: { plugins: ['dev'] } };
    const off = saved(setScopeItem(withShort, 'plugins', 'dev@seazone-skills', false, inventory));
    expect(off.scope?.plugins).toEqual([]);
    const on = saved(setScopeItem(off, 'plugins', 'esteira@seazone-skills', true, inventory));
    expect(on.scope?.plugins).toEqual(['esteira@seazone-skills']);
  });

  it('the app MCP never leaves; named MCPs come and go; with every MCP of the user kept, a name is never added', () => {
    const named: SessionRole = { ...role, scope: { mcps: ['github', 'kb'] } };
    expect(setScopeItem(named, 'mcps', 'donel', false, inventory)).toBe(named);
    const less = saved(setScopeItem(named, 'mcps', 'github', false, inventory));
    expect(less.scope?.mcps).toEqual(['kb']);
    expect(saved(addScopeMcp(less, 'nekt')).scope?.mcps).toEqual(['kb', 'nekt']);
    expect(addScopeMcp(role, 'nekt')).toBe(role);
    expect(setScopeItem(role, 'mcps', 'github', false, inventory)).toBe(role);
  });

  it('"usar todos" writes the axis back as everything, and the guidance survives the round trip', () => {
    const narrowed = setScopeItem({ ...role, guidance: 'Linha 1\n\nLinha 2' }, 'skills', 'eval', false, inventory);
    const all = saved(setScopeAll(narrowed, 'skills'));
    expect(all.scope?.skills).toBe('*');
    expect(all.guidance).toBe('Linha 1\n\nLinha 2');
  });
});
