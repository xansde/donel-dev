import { describe, expect, it } from 'vitest';
import { addScopeMcp, applyChairEdits, chairSheet, setScopeAll, setScopeItem, type ChairEdit } from '../src/shared/chair-sheet';
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

// Revisor, #286 — achado 1: the chair kept the WHOLE role in its draft, so saving it after a rename in Papéis wrote
// the old name back. The chair keeps only what it changed and lays it over the role saved most recently.
// Achado 2: turning a skill off and on again turned "all" into a fixed list.
describe('the chair edits laid over the role saved most recently', () => {
  it('a rename, a new color and a new engine saved in Papéis survive saving the chair', () => {
    const edits: ChairEdit[] = [
      { kind: 'item', axis: 'skills', name: 'eval', on: false },
      { kind: 'guidance', text: 'Nova orientação.' },
      { kind: 'field', key: 'effort', value: 'high' },
    ];
    const savedInPapeis: SessionRole = { ...role, name: 'Atlas Renomeado', color: 'validar', engine: 'beacon' };
    const result = saved(applyChairEdits(savedInPapeis, edits, inventory));
    expect(result.name).toBe('Atlas Renomeado');
    expect(result.color).toBe('validar');
    expect(result.engine).toBe('beacon');
    expect(result.scope?.skills).toEqual(['deepdive', 'rigs']);
    expect(result.guidance).toBe('Nova orientação.');
    expect(result.effort).toBe('high');
  });

  it('an axis changed in Papéis meanwhile keeps that change; the chair only replays its own toggles', () => {
    const edits: ChairEdit[] = [{ kind: 'item', axis: 'plugins', name: 'dev@seazone-skills', on: false }];
    const savedInPapeis: SessionRole = { ...role, scope: { mcps: ['kb'], plugins: ['dev', 'esteira'] } };
    const result = saved(applyChairEdits(savedInPapeis, edits, inventory));
    expect(result.scope?.mcps).toEqual(['kb']);
    expect(result.scope?.plugins).toEqual(['esteira']);
  });

  it('turning a skill off and on again gives "all" back, not a fixed list', () => {
    const edits: ChairEdit[] = [
      { kind: 'item', axis: 'skills', name: 'eval', on: false },
      { kind: 'item', axis: 'skills', name: 'eval', on: true },
    ];
    expect(saved(applyChairEdits(role, edits, inventory)).scope?.skills).toBe('*');
    const offOn = setScopeItem(setScopeItem(role, 'plugins', 'dev@seazone-skills', false, inventory), 'plugins', 'dev@seazone-skills', true, inventory);
    expect(offOn.scope?.plugins).toBe('*');
  });
});
