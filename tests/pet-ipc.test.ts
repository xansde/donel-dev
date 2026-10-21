// T005 (015-jobu-pet) - the channels and the payload validators of contracts/ipc-pet.md. The main
// ignores any payload that fails its validator, so these are the gate of every `pet:*` channel.
import { describe, expect, it } from 'vitest';
import { CONFIG_CHANNELS } from '../src/shared/config';
import {
  PET_CHANNELS,
  PET_MAX_SESSIONS,
  isValidPetContextMenuPayload,
  isValidPetDragPayload,
  isValidPetInteractivePayload,
  isValidPetListOpenPayload,
  isValidPetOpenPayload,
  isValidPetPrefsInput,
  isValidPetResizeStepPayload,
  isValidPetTabsPayload,
} from '../src/shared/pet/ipc';

describe('PET_CHANNELS', () => {
  it('has every channel of the contract, with the names the contract gives', () => {
    expect({ ...PET_CHANNELS }).toEqual({
      tabs: 'pet:tabs',
      setPrefs: 'config:setPetPrefs',
      activateSession: 'app:activate-session',
      prefsChanged: 'pet:prefs-changed',
      view: 'pet:view',
      closeList: 'pet:close-list',
      ready: 'pet:ready',
      interactive: 'pet:interactive',
      click: 'pet:click',
      open: 'pet:open',
      listOpen: 'pet:list-open',
      contextMenu: 'pet:context-menu',
      dragStart: 'pet:drag-start',
      dragMove: 'pet:drag-move',
      dragEnd: 'pet:drag-end',
      resizeStep: 'pet:resize-step',
    });
  });

  it('has no two channels with the same name', () => {
    const values = Object.values(PET_CHANNELS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('shares the config channel with CONFIG_CHANNELS: one source for the string', () => {
    expect(PET_CHANNELS.setPrefs).toBe(CONFIG_CHANNELS.setPetPrefs);
  });

  it('follows the domain:action pattern of the repo', () => {
    for (const channel of Object.values(PET_CHANNELS)) expect(channel).toMatch(/^[a-z]+:[a-zA-Z-]+$/);
  });
});

describe('isValidPetTabsPayload', () => {
  const valid = { activePtyId: 'pty-a', sessions: [{ ptyId: 'pty-a', name: 'atlas' }, { ptyId: 'pty-b', name: 'beacon' }] };

  it('accepts a well formed payload, with or without an active tab, with or without sessions', () => {
    expect(isValidPetTabsPayload(valid)).toBe(true);
    expect(isValidPetTabsPayload({ activePtyId: null, sessions: [] })).toBe(true);
    expect(isValidPetTabsPayload({ activePtyId: null, sessions: valid.sessions })).toBe(true);
  });

  it('does not require the active tab to be among the sessions (a shell tab may be active)', () => {
    expect(isValidPetTabsPayload({ activePtyId: 'pty-zzz', sessions: [] })).toBe(true);
  });

  it('rejects anything that is not an object with the two fields', () => {
    for (const bad of [null, undefined, 'x', 42, true, [], [valid], {}, { activePtyId: null }, { sessions: [] }]) {
      expect(isValidPetTabsPayload(bad)).toBe(false);
    }
  });

  it('rejects a wrong type in any field', () => {
    expect(isValidPetTabsPayload({ ...valid, activePtyId: 7 })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, activePtyId: '' })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: 'x' })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: null })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: [null] })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: [{ ptyId: 'p' }] })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: [{ name: 'n' }] })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: [{ ptyId: '', name: 'n' }] })).toBe(false);
    expect(isValidPetTabsPayload({ ...valid, sessions: [{ ptyId: 'p', name: 3 }] })).toBe(false);
  });

  it('accepts an empty name (a tab can be unnamed) but not a missing one', () => {
    expect(isValidPetTabsPayload({ activePtyId: null, sessions: [{ ptyId: 'p', name: '' }] })).toBe(true);
  });

  it('caps the number of sessions', () => {
    const many = (count: number) => ({ activePtyId: null, sessions: Array.from({ length: count }, (_, i) => ({ ptyId: `p${i}`, name: 'n' })) });
    expect(isValidPetTabsPayload(many(PET_MAX_SESSIONS))).toBe(true);
    expect(isValidPetTabsPayload(many(PET_MAX_SESSIONS + 1))).toBe(false);
  });
});

describe('isValidPetDragPayload', () => {
  it('accepts finite screen coordinates, negative ones included (a monitor to the left)', () => {
    expect(isValidPetDragPayload({ screenX: 10, screenY: 20 })).toBe(true);
    expect(isValidPetDragPayload({ screenX: -1920.5, screenY: 0 })).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      [],
      {},
      { screenX: 1 },
      { screenY: 1 },
      { screenX: '1', screenY: 2 },
      { screenX: Number.NaN, screenY: 2 },
      { screenX: 1, screenY: Number.POSITIVE_INFINITY },
    ]) {
      expect(isValidPetDragPayload(bad)).toBe(false);
    }
  });
});

describe('isValidPetContextMenuPayload (US5): where the owner right-clicked, or nothing', () => {
  it('accepts no payload at all: the menu then opens at the pointer', () => {
    expect(isValidPetContextMenuPayload(undefined)).toBe(true);
  });

  it('accepts finite screen coordinates, like a drag does', () => {
    expect(isValidPetContextMenuPayload({ screenX: 1850, screenY: 990 })).toBe(true);
    expect(isValidPetContextMenuPayload({ screenX: -300.5, screenY: -2 })).toBe(true);
  });

  it('rejects everything else: null is not "no payload", and a half payload is no payload', () => {
    for (const bad of [null, 'x', 7, [], {}, { screenX: 1 }, { screenX: '1', screenY: 2 }, { screenX: Number.NaN, screenY: 2 }, { screenX: 1, screenY: Number.NEGATIVE_INFINITY }]) {
      expect(isValidPetContextMenuPayload(bad)).toBe(false);
    }
  });
});

describe('isValidPetOpenPayload', () => {
  it('accepts a session target with a ptyId and the Donel target', () => {
    expect(isValidPetOpenPayload({ target: { kind: 'session', ptyId: 'pty-a' } })).toBe(true);
    expect(isValidPetOpenPayload({ target: { kind: 'donel' } })).toBe(true);
  });

  it('rejects an unknown kind, a session without ptyId, and a missing or malformed target', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      [],
      {},
      { target: null },
      { target: 'donel' },
      { target: { kind: 'list' } },
      { target: { kind: 'session' } },
      { target: { kind: 'session', ptyId: '' } },
      { target: { kind: 'session', ptyId: 4 } },
      { target: {} },
    ]) {
      expect(isValidPetOpenPayload(bad)).toBe(false);
    }
  });
});

describe('isValidPetResizeStepPayload', () => {
  it('accepts exactly +1 and -1', () => {
    expect(isValidPetResizeStepPayload({ direction: 1 })).toBe(true);
    expect(isValidPetResizeStepPayload({ direction: -1 })).toBe(true);
  });

  it('rejects any other value (a renderer cannot ask for a jump)', () => {
    for (const bad of [null, undefined, [], {}, { direction: 0 }, { direction: 2 }, { direction: -2 }, { direction: '1' }, { direction: Number.NaN }, { direction: 0.5 }]) {
      expect(isValidPetResizeStepPayload(bad)).toBe(false);
    }
  });
});

describe('isValidPetPrefsInput', () => {
  it('accepts a patch with a boolean enabled, or an empty patch (a no-op)', () => {
    expect(isValidPetPrefsInput({ enabled: true })).toBe(true);
    expect(isValidPetPrefsInput({ enabled: false })).toBe(true);
    expect(isValidPetPrefsInput({})).toBe(true);
  });

  it('rejects a non-boolean enabled and anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 5, true, [], [{ enabled: true }], { enabled: 'yes' }, { enabled: 1 }, { enabled: null }]) {
      expect(isValidPetPrefsInput(bad)).toBe(false);
    }
  });

  it('ignores keys it does not own: the renderer cannot set placement or size through this channel', () => {
    // valid shape (the handler only ever reads `enabled`) - the guarantee is in what the handler reads
    expect(isValidPetPrefsInput({ enabled: true, placement: { x: 1, y: 2 }, size: 999 })).toBe(true);
  });
});

describe('isValidPetInteractivePayload / isValidPetListOpenPayload', () => {
  it('need a boolean', () => {
    expect(isValidPetInteractivePayload({ interactive: true })).toBe(true);
    expect(isValidPetInteractivePayload({ interactive: false })).toBe(true);
    expect(isValidPetListOpenPayload({ open: true })).toBe(true);
    expect(isValidPetListOpenPayload({ open: false })).toBe(true);
    for (const bad of [null, undefined, [], {}, { interactive: 1 }, { interactive: 'true' }, { open: 0 }, { open: null }]) {
      expect(isValidPetInteractivePayload(bad)).toBe(false);
      expect(isValidPetListOpenPayload(bad)).toBe(false);
    }
  });
});
