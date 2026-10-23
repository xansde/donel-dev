// 016-jobu-faxina (T006) - the pet side of "Fazer faxina": the words of the result bubble, the reducer event
// that raises it (even when the owner silenced the notices: it answers a request), the click that opens the
// folder, the validator of that click and the menu entry. Pure, clocked by the test.
import { describe, expect, it } from 'vitest';
import { PET_BUBBLE_MS, sweepBubbleFace } from '../src/shared/pet/bubble';
import { decideBubbleClick } from '../src/shared/pet/click';
import { isValidPetOpenPayload } from '../src/shared/pet/ipc';
import { buildPetMenu } from '../src/shared/pet/menu';
import { createPetState, reducePet } from '../src/shared/pet/petState';
import type { SweepBubbleSummary } from '../src/shared/pet/types';

const MB = 1024 * 1024;
const FOLDER = 'C:\\work\\_archive\\faxina-2026-10-23';

function summary(patch: Partial<SweepBubbleSummary> = {}): SweepBubbleSummary {
  return { failed: false, freedBytes: 0, separatedItems: 0, branchesDeleted: 0, worktreesRemoved: 0, folder: null, ...patch };
}

describe('sweepBubbleFace: what the bubble of the sweep says', () => {
  it('freed space comes first and is the whole line when nothing else happened', () => {
    const face = sweepBubbleFace(summary({ freedBytes: 319 * MB }));
    expect(face.text).toBe('Faxina · 319 MB liberados');
    expect(face.pose).toBe('talking');
  });

  it('adds what was set aside, and a click goes to the folder', () => {
    const face = sweepBubbleFace(summary({ freedBytes: 319 * MB, separatedItems: 34, folder: FOLDER }));
    expect(face.text).toBe('Faxina · 319 MB liberados · 34 separados');
    expect(face.target).toEqual({ kind: 'folder', path: FOLDER });
  });

  it('keeps the line short: at most two facts, in the order freed, separated, branches, worktrees', () => {
    const face = sweepBubbleFace(summary({ freedBytes: 2 * MB, separatedItems: 3, branchesDeleted: 9, worktreesRemoved: 2, folder: FOLDER }));
    expect(face.text).toBe('Faxina · 2,0 MB liberados · 3 separados');
  });

  it('with no freed space and nothing set aside it falls to branches and worktrees', () => {
    expect(sweepBubbleFace(summary({ branchesDeleted: 1, worktreesRemoved: 2, folder: FOLDER })).text).toBe('Faxina · 1 branch · 2 worktrees');
    expect(sweepBubbleFace(summary({ worktreesRemoved: 1 })).text).toBe('Faxina · 1 worktree');
  });

  it('nothing at all: "nada a limpar", the neutral face, and the click goes to the Donel', () => {
    const face = sweepBubbleFace(summary());
    expect(face).toMatchObject({ text: 'Faxina · nada a limpar', pose: 'neutral', target: { kind: 'donel' } });
  });

  it('a failure: "falhou", sad, the Donel as the target even if a folder exists', () => {
    const face = sweepBubbleFace(summary({ failed: true, freedBytes: 5 * MB, folder: FOLDER }));
    expect(face).toMatchObject({ text: 'Faxina · falhou', pose: 'sad', target: { kind: 'donel' } });
  });

  it('a folder with no other fact still opens (the receipt of a branch lives there)', () => {
    const face = sweepBubbleFace(summary({ branchesDeleted: 4, folder: FOLDER }));
    expect(face.target).toEqual({ kind: 'folder', path: FOLDER });
  });
});

describe('the sweepFinished event in the reducer', () => {
  it('raises a bubble with the face of the summary for the usual 6 s', () => {
    const state = reducePet(createPetState(), { type: 'sweepFinished', summary: summary({ freedBytes: 10 * MB, folder: FOLDER }), at: 1000 }, 1000);
    expect(state.bubble).toMatchObject({ text: 'Faxina · 10 MB liberados', until: 1000 + PET_BUBBLE_MS, target: { kind: 'folder', path: FOLDER } });
    expect(state.bubble?.id).toBe(1);
    expect(state.pendingBurst).toEqual([]);
  });

  it('shows even while the notices are silenced: it answers a request of the owner', () => {
    let state = reducePet(createPetState(), { type: 'silence', until: 10 * 60_000 }, 0);
    state = reducePet(state, { type: 'sweepFinished', summary: summary({ freedBytes: MB }), at: 1000 }, 1000);
    expect(state.bubble?.text).toBe('Faxina · 1,0 MB liberados');
  });

  it('but not while an app has the whole screen: the Jobu is hidden then', () => {
    let state = reducePet(createPetState(), { type: 'fullscreen', active: true }, 0);
    state = reducePet(state, { type: 'sweepFinished', summary: summary({ freedBytes: MB }), at: 1000 }, 1000);
    expect(state.bubble).toBeNull();
  });

  it('replaces whatever bubble is up and nothing joins it afterwards', () => {
    let state = reducePet(createPetState(), { type: 'accountSwitched', label: 'Interno 3', at: 0 }, 0);
    state = reducePet(state, { type: 'sweepFinished', summary: summary(), at: 500 }, 500);
    expect(state.bubble).toMatchObject({ id: 2, text: 'Faxina · nada a limpar' });
    expect(state.pendingBurst).toEqual([]);
  });
});

describe('the click on the bubble of the sweep', () => {
  it('a folder bubble goes to its folder', () => {
    const bubble = { id: 1, text: 'x', pose: 'talking' as const, target: { kind: 'folder' as const, path: FOLDER } };
    expect(decideBubbleClick(bubble, [])).toEqual({ kind: 'folder', path: FOLDER });
  });

  it('pet:open accepts a folder target carrying a path, and nothing else of that kind', () => {
    expect(isValidPetOpenPayload({ target: { kind: 'folder', path: FOLDER } })).toBe(true);
    expect(isValidPetOpenPayload({ target: { kind: 'folder' } })).toBe(false);
    expect(isValidPetOpenPayload({ target: { kind: 'folder', path: 3 } })).toBe(false);
  });
});

describe('the menu entry', () => {
  const base = { silenced: false, captureReleased: false, size: 140, sweeping: false };

  it('"Fazer faxina" sits after the capture item, before "Tamanho", and asks for the sweep', () => {
    const entries = buildPetMenu(base);
    const labels = entries.map((entry) => (entry.type === 'separator' ? '---' : entry.label));
    expect(labels.indexOf('Fazer faxina')).toBe(labels.indexOf('Tamanho') - 1);
    const item = entries.find((entry) => entry.type === 'item' && entry.label === 'Fazer faxina');
    expect(item).toMatchObject({ action: { kind: 'sweep' } });
    expect(item).not.toHaveProperty('enabled', false);
  });

  it('while sweeping it says "Faxinando…" and cannot be chosen', () => {
    const entries = buildPetMenu({ ...base, sweeping: true });
    const item = entries.find((entry) => entry.type === 'item' && entry.label === 'Faxinando…');
    expect(item).toMatchObject({ action: { kind: 'sweep' }, enabled: false });
    expect(entries.some((entry) => entry.type === 'item' && entry.label === 'Fazer faxina')).toBe(false);
  });
});
