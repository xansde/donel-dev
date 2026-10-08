// T022 (014-chat) - active chain of the transcript tree,
// contracts/conversation-rows.md §3.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BackwardChain,
  buildActiveChain,
  ForwardChain,
  messageIdOf,
  toolResultIdOf,
  toolUseIdsOf,
  type ChainLine,
} from '../src/shared/chat/activeChain';
import type { LineRef } from '../src/shared/chat/rows';
import { classifyLine } from '../src/shared/chat/transcriptEntry';

const FIXTURES = join(__dirname, 'fixtures', 'chat');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let counter = 0;

/** Builds a classified entry; `offset` follows creation order (file order). */
function line(obj: Record<string, unknown>): ChainLine {
  counter += 1;
  const raw = JSON.stringify({ timestamp: '2026-10-01T12:00:00.000Z', isSidechain: false, ...obj });
  const ref: LineRef = { path: 'mem', offset: counter * 1000, length: raw.length };
  const e = classifyLine(raw, ref);
  if (e === null || (e.k !== 'node' && e.k !== 'unknown')) throw new Error(`not a chain line: ${raw}`);
  return e;
}

const user = (uuid: string, parentUuid: string | null, extra: Record<string, unknown> = {}): ChainLine =>
  line({ type: 'user', uuid, parentUuid, message: { role: 'user', content: 'x' }, ...extra });

const asst = (uuid: string, parentUuid: string | null, mid: string, block: unknown = { type: 'text', text: 't' }): ChainLine =>
  line({ type: 'assistant', uuid, parentUuid, message: { id: mid, role: 'assistant', content: [block] } });

const toolUse = (uuid: string, parentUuid: string | null, mid: string, id: string): ChainLine =>
  asst(uuid, parentUuid, mid, { type: 'tool_use', id, name: 'Read', input: {} });

const result = (uuid: string, parentUuid: string | null, id: string): ChainLine =>
  line({ type: 'user', uuid, parentUuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

const att = (uuid: string, parentUuid: string | null, type = 'hook_system_message'): ChainLine =>
  line({ type: 'attachment', uuid, parentUuid, attachment: { type } });

const uuids = (lines: readonly ChainLine[]): string[] => lines.map((l) => (l.k === 'node' || l.k === 'unknown' ? (l.uuid as string) : ''));

function loadFixture(name: string): ChainLine[] {
  const buf = readFileSync(join(FIXTURES, name));
  const out: ChainLine[] = [];
  let offset = 0;
  for (const part of buf.toString('latin1').split('\n')) {
    const length = Buffer.byteLength(part, 'latin1');
    if (part !== '') {
      const e = classifyLine(Buffer.from(part, 'latin1').toString('utf8'), { path: name, offset, length });
      if (e && (e.k === 'node' || e.k === 'unknown')) out.push(e);
    }
    offset += length + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// accessors
// ---------------------------------------------------------------------------

describe('line accessors', () => {
  it('reads message.id, tool_use ids and the tool_result id', () => {
    const tu = toolUse('a', null, 'm1', 'toolu_1');
    expect(messageIdOf(tu)).toBe('m1');
    expect(toolUseIdsOf(tu)).toEqual(['toolu_1']);
    expect(toolResultIdOf(tu)).toBeNull();
    const r = result('b', 'a', 'toolu_1');
    expect(toolResultIdOf(r)).toBe('toolu_1');
    expect(messageIdOf(r)).toBeNull();
    expect(toolUseIdsOf(user('c', null))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3.1-3.3 whole-file build
// ---------------------------------------------------------------------------

describe('buildActiveChain - leaf selection', () => {
  it('picks the LAST user/assistant/system node in file order, not "any leaf"', () => {
    const lines = [user('1', null), asst('2', '1', 'm'), att('3', '2'), user('4', '2'), asst('5', '4', 'm2')];
    // '3' is a side leaf, '5' is the last real node
    expect(buildActiveChain(lines).leafUuid).toBe('5');
  });

  it('ignores attachment nodes when picking the leaf', () => {
    const lines = [user('1', null), asst('2', '1', 'm'), att('3', '2')];
    expect(buildActiveChain(lines).leafUuid).toBe('2');
  });

  it('returns an empty chain for no nodes', () => {
    expect(buildActiveChain([])).toEqual({ leafUuid: null, chainUuids: [], compactions: [], lines: [] });
  });

  it('does not use timestamps for ordering', () => {
    const a = line({ type: 'user', uuid: '1', parentUuid: null, timestamp: '2026-10-01T12:10:00.000Z', message: { role: 'user', content: 'a' } });
    const b = line({ type: 'assistant', uuid: '2', parentUuid: '1', timestamp: '2026-10-01T12:00:00.000Z', message: { id: 'm', content: [] } });
    expect(buildActiveChain([a, b]).chainUuids).toEqual(['1', '2']);
  });
});

describe('buildActiveChain - climbing by parentUuid', () => {
  it('returns root-to-leaf order and drops abandoned branches (rewind)', () => {
    const lines = [
      user('p1', null), asst('a1', 'p1', 'm1'),
      user('p2', 'a1'), asst('a2', 'p2', 'm2'), // abandoned
      user('p3', 'a1'), asst('a3', 'p3', 'm3'), // after rewind to a1
    ];
    const c = buildActiveChain(lines);
    expect(c.chainUuids).toEqual(['p1', 'a1', 'p3', 'a3']);
    expect(uuids(c.lines)).toEqual(['p1', 'a1', 'p3', 'a3']);
  });

  it('passes through attachment nodes that sit on the parent path', () => {
    const lines = [user('1', null), att('2', '1'), asst('3', '2', 'm')];
    expect(buildActiveChain(lines).chainUuids).toEqual(['1', '2', '3']);
  });

  it('treats an unresolved parent as the root', () => {
    const lines = [user('1', 'ghost'), asst('2', '1', 'm')];
    expect(buildActiveChain(lines).chainUuids).toEqual(['1', '2']);
  });

  it('survives a parent cycle without looping forever', () => {
    const lines = [user('1', '2'), asst('2', '1', 'm')];
    expect(buildActiveChain(lines).chainUuids.length).toBeLessThanOrEqual(2);
  });

  it('keeps unrecognised top-level lines that sit on the path (chain not broken)', () => {
    const lines = [user('1', null), line({ type: 'future', uuid: '2', parentUuid: '1' }), asst('3', '2', 'm')];
    expect(buildActiveChain(lines).chainUuids).toEqual(['1', '2', '3']);
  });
});

describe('buildActiveChain - noise attachments are link-only', () => {
  it('passes through a noise attachment that sits mid-chain but never lists it', () => {
    const lines = [user('1', null), att('n', '1', 'hook_success'), asst('2', 'n', 'm')];
    const c = buildActiveChain(lines);
    expect(c.chainUuids).toEqual(['1', 'n', '2']);
    expect(uuids(c.lines)).toEqual(['1', '2']);
  });

  it('does not list trailing noise attachments', () => {
    const lines = [user('1', null), asst('2', '1', 'm'), att('n', '2', 'hook_success')];
    expect(uuids(buildActiveChain(lines).lines)).toEqual(['1', '2']);
  });
});

describe('buildActiveChain - compaction jump', () => {
  it('jumps parentUuid:null + logicalParentUuid and records the compaction', () => {
    const lines = [
      user('1', null), asst('2', '1', 'm'),
      line({ type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, logicalParentUuid: '2' }),
      user('s', 'b', { isCompactSummary: true }),
      user('3', 's'), asst('4', '3', 'm2'),
    ];
    const c = buildActiveChain(lines);
    expect(c.chainUuids).toEqual(['1', '2', 'b', 's', '3', '4']);
    expect(c.compactions).toEqual([{ uuid: 'b', logicalParentUuid: '2' }]);
  });

  it('ends at the boundary when the logical parent is not loaded', () => {
    const lines = [
      line({ type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, logicalParentUuid: 'gone' }),
      user('3', 'b'),
    ];
    const c = buildActiveChain(lines);
    expect(c.chainUuids).toEqual(['b', '3']);
    expect(c.compactions).toEqual([{ uuid: 'b', logicalParentUuid: 'gone' }]);
  });
});

describe('buildActiveChain - completing the chain', () => {
  it('adds off-chain lines that share a message.id with a chain line', () => {
    // A (block 0) is on the chain; B (block 1) is a sibling leaf of the same API response
    const lines = [user('p', null), toolUse('A', 'p', 'M', 'toolu_a'), toolUse('B', 'A', 'M', 'toolu_b'), result('rB', 'B', 'toolu_b')];
    // swap so that the chain goes through a different sibling: leaf = rA
    const rA = result('rA', 'A', 'toolu_a');
    const c = buildActiveChain([...lines, rA]);
    expect(c.leafUuid).toBe('rA');
    expect(c.chainUuids).toEqual(['p', 'A', 'rA']);
    // B joins by message.id, rB joins by tool_use_id
    expect(new Set(uuids(c.lines))).toEqual(new Set(['p', 'A', 'rA', 'B', 'rB']));
  });

  it('pins an off-chain tool_result to its tool_use (placed right after the action)', () => {
    const lines = [
      user('p', null), toolUse('A', 'p', 'M', 'toolu_a'), toolUse('B', 'A', 'M', 'toolu_b'),
      result('rA', 'A', 'toolu_a'), // side leaf (parent A, but chain continues from B)
      result('rB', 'B', 'toolu_b'), asst('F', 'rB', 'M2'),
    ];
    const c = buildActiveChain(lines);
    expect(c.chainUuids).toEqual(['p', 'A', 'B', 'rB', 'F']);
    const order = uuids(c.lines);
    expect(order).toContain('rA');
    expect(order.indexOf('rA')).toBe(order.indexOf('A') + 1);
  });

  it('does not add off-chain results whose tool_use is not on the chain', () => {
    const lines = [user('p', null), asst('x', 'p', 'M1'), result('r', 'x', 'toolu_other'), user('q', 'x'), asst('y', 'q', 'M2')];
    const c = buildActiveChain(lines);
    expect(uuids(c.lines)).not.toContain('r');
  });

  it('does not add off-chain lines of an abandoned branch', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), user('p2', 'a'), asst('a2', 'p2', 'M2'), user('p3', 'a'), asst('a3', 'p3', 'M3')];
    expect(new Set(uuids(buildActiveChain(lines).lines))).toEqual(new Set(['p', 'a', 'p3', 'a3']));
  });

  it('includes attachments chained after the leaf (trailing), not side hook leaves', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), att('t1', 'a', 'queued_command'), att('t2', 't1'), att('side', 'p')];
    const c = buildActiveChain(lines);
    expect(c.chainUuids).toEqual(['p', 'a']);
    expect(uuids(c.lines)).toEqual(['p', 'a', 't1', 't2']);
  });
});

describe('buildActiveChain - over the fixtures', () => {
  it('tree-rewind: keeps round 1 and the rewritten round, drops the abandoned one', () => {
    const lines = loadFixture('tree-rewind.jsonl');
    const c = buildActiveChain(lines);
    const texts = c.lines.map((l) => JSON.stringify((l as { data: unknown }).data));
    const blob = texts.join('\n');
    expect(blob).toContain('funcao C');
    expect(blob).toContain('Funcao C escrita');
    expect(blob).toContain('funcao A');
    expect(blob).not.toContain('funcao B');
    expect(blob).not.toContain('Funcao B escrita');
  });

  it('tree-parallel: the first parallel result is pinned to its action', () => {
    const lines = loadFixture('tree-parallel.jsonl');
    const c = buildActiveChain(lines);
    const ids = c.lines.map((l) => toolResultIdOf(l)).filter((x): x is string => x !== null);
    expect(new Set(ids)).toEqual(new Set(['toolu_pa', 'toolu_pb']));
    // the PreToolUse hook attachment is a side leaf and must not show up
    expect(c.lines.some((l) => l.k === 'node' && l.role === 'attachment')).toBe(false);
  });

  it('queue-compact: crosses the compaction and reports it', () => {
    const lines = loadFixture('queue-compact.jsonl');
    const c = buildActiveChain(lines);
    expect(c.compactions).toHaveLength(1);
    const blob = c.lines.map((l) => JSON.stringify((l as { data: unknown }).data)).join('\n');
    expect(blob).toContain('Inicie o build do atlas');
    expect(blob).toContain('Continue de onde parou');
  });
});

// ---------------------------------------------------------------------------
// §3.4 backward pagination
// ---------------------------------------------------------------------------

function runBackward(all: readonly ChainLine[]): { uuids: string[]; chain: BackwardChain } {
  const b = new BackwardChain();
  const got: ChainLine[] = [];
  for (const l of [...all].reverse()) {
    const v = b.push(l);
    if (v.kind === 'chain') got.push(l, ...v.released);
    else if (v.kind === 'extra') got.push(l);
  }
  // noise nodes are link-only: they advance the chain but never reach the adapter as rows
  return { uuids: uuids(got.filter((l) => !(l.k === 'node' && l.noise === true))), chain: b };
}

describe('BackwardChain - expectedParent', () => {
  it('starts at the last user/assistant/system node and follows parentUuid', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), user('p2', 'a'), asst('a2', 'p2', 'M2')];
    const b = new BackwardChain();
    expect(b.push(lines[3])).toMatchObject({ kind: 'chain' });
    expect(b.leafUuid).toBe('a2');
    expect(b.expectedParent).toBe('p2');
    expect(b.push(lines[2])).toMatchObject({ kind: 'chain' });
    expect(b.expectedParent).toBe('a');
  });

  it('skips lines whose uuid is not the expected parent (abandoned branch)', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), user('x', 'a'), asst('xa', 'x', 'M2'), user('p3', 'a'), asst('a3', 'p3', 'M3')];
    const { uuids: got } = runBackward(lines);
    expect(got).toEqual(['a3', 'p3', 'a', 'p']);
  });

  it('skips attachments after the leaf only when they do not hang from it; returns the ones that do', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), att('t1', 'a', 'queued_command'), att('side', 'p')];
    const b = new BackwardChain();
    expect(b.push(lines[3])).toEqual({ kind: 'skip' });
    expect(b.push(lines[2])).toEqual({ kind: 'skip' });
    const v = b.push(lines[1]);
    expect(v).toMatchObject({ kind: 'chain' });
    expect(uuids((v as unknown as { released: ChainLine[] }).released)).toEqual(['t1']);
  });

  it('follows the compaction jump and reports it', () => {
    const lines = [
      user('1', null), asst('2', '1', 'm'),
      line({ type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, logicalParentUuid: '2' }),
      user('3', 'b'),
    ];
    const b = new BackwardChain();
    b.push(lines[3]);
    const v = b.push(lines[2]);
    expect(v).toMatchObject({ kind: 'chain', compaction: { uuid: 'b', logicalParentUuid: '2' } });
    expect(b.expectedParent).toBe('2');
    expect(b.rootReached).toBe(false);
  });

  it('marks rootReached when the chain parent is null (or unresolved at the start of the file)', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1')];
    const { chain } = runBackward(lines);
    expect(chain.rootReached).toBe(true);
    expect(chain.expectedParent).toBeNull();
  });

  it('follows a chain that passes through a noise attachment', () => {
    const lines = [user('1', null), att('n', '1', 'hook_success'), asst('2', 'n', 'm')];
    const { uuids: got, chain } = runBackward(lines);
    expect(got).toEqual(['2', '1']);
    expect(chain.rootReached).toBe(true);
  });

  it('can resume from a saved cursor (leaf + expectedParent)', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), user('p2', 'a'), asst('a2', 'p2', 'M2')];
    const first = new BackwardChain();
    first.push(lines[3]);
    first.push(lines[2]);
    const second = new BackwardChain({ leafUuid: first.leafUuid, expectedParent: first.expectedParent });
    expect(second.push(lines[1])).toMatchObject({ kind: 'chain' });
    expect(second.push(lines[0])).toMatchObject({ kind: 'chain' });
    expect(second.rootReached).toBe(true);
  });
});

describe('BackwardChain - hanging results and message.id completion', () => {
  it('holds a tool_result seen before its tool_use and releases it when the action appears', () => {
    const lines = [user('p', null), toolUse('A', 'p', 'M', 'toolu_a'), toolUse('B', 'A', 'M', 'toolu_b'), result('rA', 'A', 'toolu_a'), result('rB', 'B', 'toolu_b'), asst('F', 'rB', 'M2')];
    const b = new BackwardChain();
    expect(b.push(lines[5])).toMatchObject({ kind: 'chain' });
    expect(b.push(lines[4])).toMatchObject({ kind: 'chain' });
    expect(b.push(lines[3])).toEqual({ kind: 'held' }); // rA: parent A is not expected (expected is B)
    expect(b.push(lines[2])).toMatchObject({ kind: 'chain', released: [] }); // B
    const v = b.push(lines[1]); // A releases rA
    expect(v).toMatchObject({ kind: 'chain' });
    expect(uuids((v as unknown as { released: ChainLine[] }).released)).toEqual(['rA']);
  });

  it('joins off-chain lines of the same message.id read after the chain line', () => {
    // chain: p -> A(M) -> rA ; B(M) is a sibling leaf BEFORE A in the file? (adjacent in 96%): B after A here
    const lines = [user('p', null), toolUse('A', 'p', 'M', 'toolu_a'), toolUse('B', 'A', 'M', 'toolu_b'), result('rA', 'A', 'toolu_a')];
    const { uuids: got } = runBackward(lines);
    expect(new Set(got)).toEqual(new Set(['rA', 'A', 'B', 'p']));
  });

  it('joins a same-message line seen AFTER its chain sibling (file order: extra first)', () => {
    const extra = asst('X', 'p', 'M', { type: 'thinking', thinking: '' });
    const lines = [user('p', null), extra, asst('A', 'p', 'M'), user('q', 'A'), asst('F', 'q', 'M2')];
    const { uuids: got } = runBackward(lines);
    expect(new Set(got)).toEqual(new Set(['F', 'q', 'A', 'X', 'p']));
  });

  it('drops held lines that never find their owner', () => {
    const lines = [user('p', null), asst('a', 'p', 'M1'), result('r', 'a', 'toolu_orphan'), user('q', 'a'), asst('F', 'q', 'M2')];
    const { uuids: got } = runBackward(lines);
    expect(got).not.toContain('r');
  });

  it('bounds the held buffer', () => {
    const b = new BackwardChain();
    b.push(asst('leaf', 'x', 'ML'));
    for (let i = 0; i < 2000; i += 1) b.push(result(`r${i}`, `o${i}`, `toolu_${i}`));
    expect(b.heldCount).toBeLessThanOrEqual(500);
  });
});

describe('BackwardChain over fixtures equals the whole-file chain', () => {
  const files = ['basic-round.jsonl', 'tool-results.jsonl', 'commands.jsonl', 'interrupt.jsonl', 'queue-compact.jsonl', 'tree-rewind.jsonl', 'tree-parallel.jsonl', 'errors-noise.jsonl', 'sess-subagent.jsonl'];
  for (const f of files) {
    it(`${f}`, () => {
      const lines = loadFixture(f);
      const whole = new Set(uuids(buildActiveChain(lines).lines));
      const { uuids: back } = runBackward(lines);
      expect(new Set(back)).toEqual(whole);
      expect(back.length).toBe(new Set(back).size);
    });
  }
});

// ---------------------------------------------------------------------------
// §3.5 forward following and rewind
// ---------------------------------------------------------------------------

describe('ForwardChain', () => {
  it('extends when the new node hangs from the current leaf', () => {
    const f = new ForwardChain();
    expect(f.push(user('1', null))).toMatchObject({ kind: 'extend', leaf: true });
    expect(f.push(asst('2', '1', 'm'))).toMatchObject({ kind: 'extend', leaf: true });
    expect(f.leafUuid).toBe('2');
    expect(f.chainUuids()).toEqual(['1', '2']);
  });

  it('treats attachments chained after the leaf as extensions that are not leaves', () => {
    const f = new ForwardChain();
    f.push(user('1', null));
    f.push(asst('2', '1', 'm'));
    expect(f.push(att('3', '2', 'queued_command'))).toEqual({ kind: 'extend', leaf: false });
    expect(f.leafUuid).toBe('2');
    // the next real line hangs from the attachment: still an extension, not a rewind
    expect(f.push(asst('4', '3', 'm2'))).toMatchObject({ kind: 'extend', leaf: true });
    expect(f.chainUuids()).toEqual(['1', '2', '3', '4']);
  });

  it('follows a chain through a noise attachment', () => {
    const f = new ForwardChain();
    f.push(user('1', null));
    expect(f.push(att('n', '1', 'hook_success'))).toEqual({ kind: 'extend', leaf: false });
    expect(f.push(asst('2', 'n', 'm'))).toMatchObject({ kind: 'extend', leaf: true });
    expect(f.chainUuids()).toEqual(['1', 'n', '2']);
  });

  it('classifies side leaves of hooks as side', () => {
    const f = new ForwardChain();
    f.push(user('1', null));
    f.push(toolUse('2', '1', 'm', 'toolu_a'));
    expect(f.push(att('h', '1'))).toMatchObject({ kind: 'side' });
    expect(f.leafUuid).toBe('2');
  });

  it('a parallel tool_result that hangs from an older action is side, not a rewind', () => {
    const f = new ForwardChain();
    f.push(user('p', null));
    f.push(toolUse('A', 'p', 'M', 'toolu_a'));
    f.push(toolUse('B', 'A', 'M', 'toolu_b'));
    f.push(result('rB', 'B', 'toolu_b'));
    expect(f.push(result('rA', 'A', 'toolu_a'))).toMatchObject({ kind: 'side', reason: 'tool-result' });
    expect(f.leafUuid).toBe('rB');
  });

  it('a late same-message block is completion (side), not a rewind', () => {
    const f = new ForwardChain();
    f.push(user('p', null));
    f.push(asst('A', 'p', 'M'));
    f.push(user('q', 'A'));
    expect(f.push(asst('X', 'A', 'M'))).toMatchObject({ kind: 'side', reason: 'completion' });
    expect(f.leafUuid).toBe('q');
  });

  it('detects rewind: a new user line hanging from an old node', () => {
    const f = new ForwardChain();
    f.push(user('p1', null));
    f.push(asst('a1', 'p1', 'M1'));
    f.push(user('p2', 'a1'));
    f.push(asst('a2', 'p2', 'M2'));
    const v = f.push(user('p3', 'a1'));
    expect(v).toEqual({ kind: 'rewind', forkParentUuid: 'a1', previousLeafUuid: 'a2' });
    expect(f.leafUuid).toBe('p3');
    expect(f.chainUuids()).toEqual(['p1', 'a1', 'p3']);
    expect(f.push(asst('a3', 'p3', 'M3'))).toMatchObject({ kind: 'extend' });
    expect(f.chainUuids()).toEqual(['p1', 'a1', 'p3', 'a3']);
  });

  it('takes a compaction boundary as an extension that reports the jump', () => {
    const f = new ForwardChain();
    f.push(user('1', null));
    f.push(asst('2', '1', 'm'));
    const b = line({ type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, logicalParentUuid: '2' });
    expect(f.push(b)).toEqual({ kind: 'extend', leaf: true, compaction: { uuid: 'b', logicalParentUuid: '2' } });
    expect(f.push(user('3', 'b'))).toMatchObject({ kind: 'extend' });
    expect(f.chainUuids()).toEqual(['1', '2', 'b', '3']);
  });

  it('can start from a mid-file cursor (leaf known, nothing indexed)', () => {
    const f = new ForwardChain({ leafUuid: 'old' });
    expect(f.push(user('n', 'old'))).toMatchObject({ kind: 'extend', leaf: true });
  });

  it('replaying a fixture forward yields the same chain as the whole-file build', () => {
    for (const name of ['basic-round.jsonl', 'tool-results.jsonl', 'commands.jsonl', 'interrupt.jsonl', 'queue-compact.jsonl', 'tree-parallel.jsonl', 'sess-subagent.jsonl']) {
      const lines = loadFixture(name);
      const f = new ForwardChain();
      for (const l of lines) f.push(l);
      expect(f.chainUuids(), name).toEqual(buildActiveChain(lines).chainUuids);
    }
  });

  it('replaying tree-rewind forward reports exactly one rewind and ends on the same chain', () => {
    const lines = loadFixture('tree-rewind.jsonl');
    const f = new ForwardChain();
    const rewinds = lines.map((l) => f.push(l)).filter((v) => v.kind === 'rewind');
    expect(rewinds).toHaveLength(1);
    expect(f.chainUuids()).toEqual(buildActiveChain(lines).chainUuids);
  });
});
