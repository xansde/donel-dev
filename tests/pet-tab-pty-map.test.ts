// T006/T040 (015-jobu-pet) - tab <-> PTY mapping, the `pet:tabs` payload and the `chat:focus-state` one
// (C2). The renderer's tab id is `tab-N`, never the ptyId (R4); the core, the chat and the main only know ptyIds.
import { describe, expect, it } from 'vitest';
import { buildChatFocusState, buildPetTabsPayload, tabPtyMap } from '../src/shared/pet/tabPtyMap';

interface TestTab {
  readonly id: string;
  readonly sessionType: 'claude' | 'shell';
  readonly accountLoginId?: string;
  readonly name: string;
}

const claudeTab = (id: string, over: Partial<TestTab> = {}): TestTab => ({ id, sessionType: 'claude', name: `fallback-${id}`, ...over });
const shellTab = (id: string): TestTab => ({ id, sessionType: 'shell', name: `shell-${id}` });

const ptys = (table: Record<string, string | null | undefined>) => (tabId: string) => table[tabId];

describe('tabPtyMap', () => {
  it('gives tab.id -> ptyId and the reverse', () => {
    const map = tabPtyMap([claudeTab('tab-1'), claudeTab('tab-2')], ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-b' }));
    expect(map.ptyIdOf('tab-1')).toBe('pty-a');
    expect(map.ptyIdOf('tab-2')).toBe('pty-b');
    expect(map.tabIdOf('pty-a')).toBe('tab-1');
    expect(map.tabIdOf('pty-b')).toBe('tab-2');
    expect([...map.tabToPty.entries()]).toEqual([['tab-1', 'pty-a'], ['tab-2', 'pty-b']]);
    expect([...map.ptyToTab.entries()]).toEqual([['pty-a', 'tab-1'], ['pty-b', 'tab-2']]);
  });

  it('leaves out a tab that has no PTY (undefined, null or empty)', () => {
    const map = tabPtyMap(
      [claudeTab('tab-1'), claudeTab('tab-2'), claudeTab('tab-3'), claudeTab('tab-4')],
      ptys({ 'tab-1': 'pty-a', 'tab-2': undefined, 'tab-3': null, 'tab-4': '' }),
    );
    expect([...map.tabToPty.keys()]).toEqual(['tab-1']);
    expect(map.ptyIdOf('tab-2')).toBeNull();
    expect(map.ptyIdOf('tab-3')).toBeNull();
    expect(map.ptyIdOf('tab-4')).toBeNull();
  });

  it('answers null for ids it does not know', () => {
    const map = tabPtyMap([claudeTab('tab-1')], ptys({ 'tab-1': 'pty-a' }));
    expect(map.ptyIdOf('tab-9')).toBeNull();
    expect(map.tabIdOf('pty-zzz')).toBeNull();
  });

  it('follows "Retomar": the same tab gets a new ptyId and the old one stops resolving', () => {
    const tabs = [claudeTab('tab-1')];
    const before = tabPtyMap(tabs, ptys({ 'tab-1': 'pty-old' }));
    const after = tabPtyMap(tabs, ptys({ 'tab-1': 'pty-new' }));
    expect(before.tabIdOf('pty-old')).toBe('tab-1');
    expect(after.ptyIdOf('tab-1')).toBe('pty-new');
    expect(after.tabIdOf('pty-new')).toBe('tab-1');
    expect(after.tabIdOf('pty-old')).toBeNull();
  });

  it('is rebuilt from scratch on every call (no hidden state between calls)', () => {
    tabPtyMap([claudeTab('tab-1')], ptys({ 'tab-1': 'pty-a' }));
    const second = tabPtyMap([claudeTab('tab-2')], ptys({ 'tab-2': 'pty-b' }));
    expect(second.tabIdOf('pty-a')).toBeNull();
    expect(second.ptyIdOf('tab-1')).toBeNull();
  });
});

describe('buildPetTabsPayload', () => {
  const names = (tab: TestTab): string => `nome de ${tab.id}`;

  it('lists only claude tabs that have a PTY, in tab order, with the resolved name', () => {
    const tabs = [claudeTab('tab-1'), shellTab('tab-2'), claudeTab('tab-3'), claudeTab('tab-4')];
    const payload = buildPetTabsPayload(tabs, ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-s', 'tab-3': null, 'tab-4': 'pty-d' }), names, 'tab-1');
    expect(payload.sessions).toEqual([
      { ptyId: 'pty-a', name: 'nome de tab-1' },
      { ptyId: 'pty-d', name: 'nome de tab-4' },
    ]);
  });

  it('uses the resolved (displayed) name, not the tab fallback name', () => {
    const payload = buildPetTabsPayload([claudeTab('tab-1', { name: 'fallback' })], ptys({ 'tab-1': 'pty-a' }), () => 'Nome dado pelo dono', 'tab-1');
    expect(payload.sessions[0]?.name).toBe('Nome dado pelo dono');
  });

  it('leaves out an isolated-login tab: it is not a work session and has no semaphore', () => {
    const tabs = [claudeTab('tab-1', { accountLoginId: 'login-1' }), claudeTab('tab-2')];
    const payload = buildPetTabsPayload(tabs, ptys({ 'tab-1': 'pty-login', 'tab-2': 'pty-b' }), names, 'tab-2');
    expect(payload.sessions.map((s) => s.ptyId)).toEqual(['pty-b']);
  });

  it('activePtyId is the ptyId of the active tab when it is listed', () => {
    const tabs = [claudeTab('tab-1'), claudeTab('tab-2')];
    const payload = buildPetTabsPayload(tabs, ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-b' }), names, 'tab-2');
    expect(payload.activePtyId).toBe('pty-b');
  });

  it('activePtyId is null when no tab is active (empty id), the id is unknown, or the active tab is not listed', () => {
    const tabs = [claudeTab('tab-1'), shellTab('tab-2'), claudeTab('tab-3')];
    const table = { 'tab-1': 'pty-a', 'tab-2': 'pty-s', 'tab-3': null };
    expect(buildPetTabsPayload(tabs, ptys(table), names, '').activePtyId).toBeNull();
    expect(buildPetTabsPayload(tabs, ptys(table), names, 'tab-99').activePtyId).toBeNull();
    // shell tab active: a plain terminal is never a watched session, so nothing counts as seen
    expect(buildPetTabsPayload(tabs, ptys(table), names, 'tab-2').activePtyId).toBeNull();
    // claude tab active but without a PTY yet
    expect(buildPetTabsPayload(tabs, ptys(table), names, 'tab-3').activePtyId).toBeNull();
  });

  it('with no tabs at all, sends an empty list', () => {
    expect(buildPetTabsPayload([], ptys({}), names, '')).toEqual({ activePtyId: null, sessions: [] });
  });

  it('a resumed tab shows up with its new ptyId', () => {
    const tabs = [claudeTab('tab-1')];
    const before = buildPetTabsPayload(tabs, ptys({ 'tab-1': 'pty-old' }), names, 'tab-1');
    const after = buildPetTabsPayload(tabs, ptys({ 'tab-1': 'pty-new' }), names, 'tab-1');
    expect(before.sessions).toEqual([{ ptyId: 'pty-old', name: 'nome de tab-1' }]);
    expect(after.sessions).toEqual([{ ptyId: 'pty-new', name: 'nome de tab-1' }]);
    expect(after.activePtyId).toBe('pty-new');
  });

  it('is plain JSON (the renderer dedupes by JSON.stringify) and carries nothing but ptyId and name', () => {
    const payload = buildPetTabsPayload([claudeTab('tab-1')], ptys({ 'tab-1': 'pty-a' }), names, 'tab-1');
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(Object.keys(payload).sort()).toEqual(['activePtyId', 'sessions']);
    expect(Object.keys(payload.sessions[0] ?? {}).sort()).toEqual(['name', 'ptyId']);
  });
});

describe('buildChatFocusState (C2): `chat:focus-state` speaks in ptyIds, as the contract says', () => {
  const names = (tab: TestTab): string => `nome de ${tab.id}`;

  it('keys the names by ptyId, not by tab id: the main looks a notification title up by ptyId', () => {
    const tabs = [claudeTab('tab-1'), claudeTab('tab-2')];
    const state = buildChatFocusState(tabs, ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-b' }), names, 'tab-1');
    expect(state.tabNames).toEqual({ 'pty-a': 'nome de tab-1', 'pty-b': 'nome de tab-2' });
    expect(Object.keys(state.tabNames)).not.toContain('tab-1');
  });

  it('the active tab is reported by its ptyId, the one the main compares with the PTY of the pending', () => {
    const tabs = [claudeTab('tab-1'), claudeTab('tab-2')];
    const table = { 'tab-1': 'pty-a', 'tab-2': 'pty-b' };
    expect(buildChatFocusState(tabs, ptys(table), names, 'tab-2').activePtyId).toBe('pty-b');
    expect(buildChatFocusState(tabs, ptys(table), names, 'tab-1').activePtyId).toBe('pty-a');
  });

  it('no active tab (empty id), an unknown one, or one with no PTY yet: null', () => {
    const tabs = [claudeTab('tab-1'), claudeTab('tab-2')];
    const table = { 'tab-1': 'pty-a', 'tab-2': null };
    expect(buildChatFocusState(tabs, ptys(table), names, '').activePtyId).toBeNull();
    expect(buildChatFocusState(tabs, ptys(table), names, 'tab-99').activePtyId).toBeNull();
    expect(buildChatFocusState(tabs, ptys(table), names, 'tab-2').activePtyId).toBeNull();
  });

  it('a tab without a PTY has no name to give', () => {
    const state = buildChatFocusState([claudeTab('tab-1'), claudeTab('tab-2')], ptys({ 'tab-1': 'pty-a', 'tab-2': undefined }), names, 'tab-1');
    expect(Object.keys(state.tabNames)).toEqual(['pty-a']);
  });

  it('a terminal in front is reported too: it is some PTY that is not the session of the pending, so the notification is raised', () => {
    const tabs = [claudeTab('tab-1'), shellTab('tab-2')];
    const state = buildChatFocusState(tabs, ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-s' }), names, 'tab-2');
    expect(state.activePtyId).toBe('pty-s');
    expect(state.activePtyId).not.toBe('pty-a');
  });

  it('a resumed tab speaks with its new ptyId, and the old one is no longer a name', () => {
    const tabs = [claudeTab('tab-1')];
    const before = buildChatFocusState(tabs, ptys({ 'tab-1': 'pty-old' }), names, 'tab-1');
    const after = buildChatFocusState(tabs, ptys({ 'tab-1': 'pty-new' }), names, 'tab-1');
    expect(before.tabNames).toEqual({ 'pty-old': 'nome de tab-1' });
    expect(after.tabNames).toEqual({ 'pty-new': 'nome de tab-1' });
    expect(after.activePtyId).toBe('pty-new');
  });

  it('with no tabs, nothing to say', () => {
    expect(buildChatFocusState([], ptys({}), names, '')).toEqual({ activePtyId: null, tabNames: {} });
  });

  it('is plain JSON: it crosses the IPC as it is', () => {
    const state = buildChatFocusState([claudeTab('tab-1')], ptys({ 'tab-1': 'pty-a' }), names, 'tab-1');
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('the ptyId of `chat:focus-pending` and of `app:activate-session` finds the tab, not the other way round (C2)', () => {
  it('the main sends a ptyId; the tab to activate is the tab.id the map gives for it', () => {
    const map = tabPtyMap([claudeTab('tab-1'), claudeTab('tab-2')], ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-b' }));
    expect(map.tabIdOf('pty-b')).toBe('tab-2'); // before the fix the renderer used 'pty-b' itself as the tab id, which is no tab
    expect(map.tabIdOf('pty-b')).not.toBe('pty-b');
  });

  it('a ptyId whose tab was closed on the way finds nothing, and nothing is activated', () => {
    const map = tabPtyMap([claudeTab('tab-1')], ptys({ 'tab-1': 'pty-a' }));
    expect(map.tabIdOf('pty-closed')).toBeNull();
  });

  it('a tab whose process ended still answers to its last ptyId when the map is built from the ptyIds the renderer kept: "encerrou" leads to that tab', () => {
    // `chatPtyIds` keeps the LAST ptyId of every tab (the conversation stays readable after the exit); the map for activation uses all of them.
    const map = tabPtyMap([claudeTab('tab-1'), claudeTab('tab-2')], ptys({ 'tab-1': 'pty-a', 'tab-2': 'pty-ended' }));
    expect(map.tabIdOf('pty-ended')).toBe('tab-2');
  });
});
