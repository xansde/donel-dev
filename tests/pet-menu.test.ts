// T047 (015-jobu-pet, US5, R13/FR-026/FR-027/FR-033/FR-035) - the right-click menu of the Jobu as DATA. The
// labels and the order live here, pure, so they are tested without Electron: the main only turns the entries
// into a native menu (src/main/pet/pet-menu.ts) and hands the chosen action back to the service.
import { describe, expect, it } from 'vitest';
import { buildPetMenu, type PetMenuAction, type PetMenuContext, type PetMenuEntry } from '../src/shared/pet/menu';
import { PET_SIZE_PRESETS } from '../src/shared/pet/placement';

const base: PetMenuContext = { silenced: false, captureReleased: false, size: 140, sweeping: false };

const labelsOf = (entries: readonly PetMenuEntry[]): string[] => entries.map((entry) => (entry.type === 'separator' ? '---' : entry.label));
const itemFor = (entries: readonly PetMenuEntry[], label: string): Extract<PetMenuEntry, { type: 'item' }> => {
  const found = entries.find((entry) => entry.type === 'item' && entry.label === label);
  if (found === undefined || found.type !== 'item') throw new Error(`no item "${label}" in ${JSON.stringify(labelsOf(entries))}`);
  return found;
};
const sizeSubmenu = (entries: readonly PetMenuEntry[]): Extract<PetMenuEntry, { type: 'submenu' }> => {
  const found = entries.find((entry) => entry.type === 'submenu');
  if (found === undefined || found.type !== 'submenu') throw new Error('no submenu');
  return found;
};

describe('the order of the menu', () => {
  it('silence, capture, size, a separator, then "Voltar ao canto" and "Esconder"', () => {
    expect(labelsOf(buildPetMenu(base))).toEqual(['Silenciar por 1 hora', 'Liberar print por 1 minuto', 'Fazer faxina', 'Tamanho', '---', 'Voltar ao canto', 'Esconder']);
  });

  it('the shape is the same in every state: only the two toggles change their words', () => {
    const everything = buildPetMenu({ silenced: true, captureReleased: true, size: 200, sweeping: false });
    expect(labelsOf(everything)).toEqual(['Retomar avisos', 'Bloquear print agora', 'Fazer faxina', 'Tamanho', '---', 'Voltar ao canto', 'Esconder']);
  });
});

describe('silence (FR-026, FR-027)', () => {
  it('not silenced: "Silenciar por 1 hora", which silences', () => {
    expect(itemFor(buildPetMenu(base), 'Silenciar por 1 hora').action).toEqual({ kind: 'silence' });
  });

  it('silenced: "Retomar avisos", which resumes, and the offer to silence is gone', () => {
    const entries = buildPetMenu({ ...base, silenced: true });
    expect(itemFor(entries, 'Retomar avisos').action).toEqual({ kind: 'resume' });
    expect(labelsOf(entries)).not.toContain('Silenciar por 1 hora');
  });
});

describe('the screen capture (FR-035)', () => {
  it('protected: "Liberar print por 1 minuto", which releases it', () => {
    expect(itemFor(buildPetMenu(base), 'Liberar print por 1 minuto').action).toEqual({ kind: 'releaseCapture' });
  });

  it('released: the same place says "Bloquear print agora", which blocks it', () => {
    const entries = buildPetMenu({ ...base, captureReleased: true });
    expect(itemFor(entries, 'Bloquear print agora').action).toEqual({ kind: 'blockCapture' });
    expect(labelsOf(entries)).not.toContain('Liberar print por 1 minuto');
  });
});

describe('size (FR-033): the submenu "Tamanho"', () => {
  it('has the four presets in order, each one choosing its own size', () => {
    const { items } = sizeSubmenu(buildPetMenu(base));
    expect(items.map((item) => item.label)).toEqual(['Pequeno', 'Médio', 'Grande', 'Muito grande']);
    expect(items.map((item) => item.action)).toEqual([
      { kind: 'size', size: 100 },
      { kind: 'size', size: 140 },
      { kind: 'size', size: 200 },
      { kind: 'size', size: 260 },
    ]);
  });

  it('is made from the same presets as the rest of the pet: one table', () => {
    const { items } = sizeSubmenu(buildPetMenu(base));
    expect(items.map((item) => ({ label: item.label, size: item.action.kind === 'size' ? item.action.size : null }))).toEqual(PET_SIZE_PRESETS.map(({ label, size }) => ({ label, size })));
  });

  it.each([100, 140, 200, 260])('marks the current preset (%d) and only it', (size) => {
    const { items } = sizeSubmenu(buildPetMenu({ ...base, size }));
    expect(items.filter((item) => item.checked)).toHaveLength(1);
    expect(items.find((item) => item.checked)?.action).toEqual({ kind: 'size', size });
  });

  it('marks nothing when the size came from Ctrl + wheel and is no preset', () => {
    for (const size of [80, 90, 150, 210, 320]) {
      expect(sizeSubmenu(buildPetMenu({ ...base, size })).items.some((item) => item.checked)).toBe(false);
    }
  });
});

describe('"Voltar ao canto" and "Esconder"', () => {
  it('go home and hide, always on offer', () => {
    for (const context of [base, { silenced: true, captureReleased: true, size: 260, sweeping: false }]) {
      const entries = buildPetMenu(context);
      expect(itemFor(entries, 'Voltar ao canto').action).toEqual({ kind: 'home' });
      expect(itemFor(entries, 'Esconder').action).toEqual({ kind: 'hide' });
    }
  });
});

describe('the model is plain data', () => {
  it('survives a JSON round trip, so a test (or the main) can read it from anywhere', () => {
    const entries = buildPetMenu({ silenced: true, captureReleased: false, size: 200, sweeping: false });
    expect(JSON.parse(JSON.stringify(entries))).toEqual(entries);
  });

  it('every action of every entry is one of the known kinds', () => {
    const kinds = new Set<PetMenuAction['kind']>(['silence', 'resume', 'releaseCapture', 'blockCapture', 'sweep', 'size', 'home', 'hide']);
    const collect = (entries: readonly PetMenuEntry[]): PetMenuAction[] =>
      entries.flatMap((entry) => (entry.type === 'item' ? [entry.action] : entry.type === 'submenu' ? entry.items.map((item) => item.action) : []));
    for (const context of [base, { silenced: true, captureReleased: true, size: 80, sweeping: false }]) {
      for (const action of collect(buildPetMenu(context))) expect(kinds.has(action.kind)).toBe(true);
    }
  });

  it('building twice gives equal, independent models', () => {
    const first = buildPetMenu(base);
    const second = buildPetMenu(base);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
