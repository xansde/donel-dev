// T028 (014-chat) - transcript adapter over the T019 fixtures,
// contracts/conversation-rows.md §1-§9. `adapt` is pure and incremental.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adapt,
  expandGroup,
  initAdapterState,
  viewOf,
  type AdapterState,
  type AdaptResult,
  type SubagentMeta,
} from '../src/shared/chat/adapter';
import type { RowPatch } from '../src/shared/chat/ipc';
import type {
  ActionRow,
  ConversationRow,
  LineRef,
  NoticeRow,
  TranscriptEntry,
} from '../src/shared/chat/rows';
import { classifyLine } from '../src/shared/chat/transcriptEntry';

const FIXTURES = join(__dirname, 'fixtures', 'chat');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Complete lines of a fixture (a trailing piece without `\n` is NOT a line), classified, with real byte offsets. */
function entriesOf(name: string): TranscriptEntry[] {
  const buf = readFileSync(join(FIXTURES, `${name}.jsonl`));
  const out: TranscriptEntry[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== 0x0a) continue;
    const length = i - start;
    const ref: LineRef = { path: `${name}.jsonl`, offset: start, length };
    const e = classifyLine(buf.subarray(start, i).toString('utf8'), ref);
    if (e !== null) out.push(e);
    start = i + 1;
  }
  return out;
}

function chunked<T>(items: readonly T[], sizes: readonly number[]): T[][] {
  const out: T[][] = [];
  let i = 0;
  let k = 0;
  while (i < items.length) {
    const n = Math.max(1, sizes[k % sizes.length]!);
    out.push(items.slice(i, i + n));
    i += n;
    k += 1;
  }
  return out;
}

interface Run {
  state: AdapterState;
  patches: RowPatch[][];
  unknown: string[];
  /** The client-side view rebuilt ONLY from the patches. */
  client: ConversationRow[];
}

function applyPatches(view: ConversationRow[], patches: readonly RowPatch[]): ConversationRow[] {
  let out = view;
  for (const p of patches) {
    if (p.op === 'reset') out = [...p.rows];
    else if (p.op === 'append') out = [...out, ...p.rows];
    else if (p.op === 'prepend') out = [...p.rows, ...out];
    else {
      const byId = new Map(p.rows.map((r) => [r.id, r]));
      out = out.map((r) => byId.get(r.id) ?? r);
    }
  }
  return out;
}

function run(name: string, sizes: readonly number[] = [100000], opts: { cwd?: string } = {}): Run {
  let state = initAdapterState({ cwd: opts.cwd ?? '/work/atlas' });
  const patches: RowPatch[][] = [];
  const unknown: string[] = [];
  let client: ConversationRow[] = [];
  for (const batch of chunked(entriesOf(name), sizes)) {
    const r: AdaptResult = adapt(state, batch);
    state = r.state;
    patches.push([...r.patches]);
    unknown.push(...r.unknownLabels);
    client = applyPatches(client, r.patches);
  }
  return { state, patches, unknown, client };
}

/** FLAT rows (the grouped view is covered by its own tests). */
const rowsOf = (name: string): ConversationRow[] => [...run(name).state.rows];
const kinds = (rows: readonly ConversationRow[]): string[] => rows.map((r) => r.kind);
const ofKind = <K extends ConversationRow['kind']>(rows: readonly ConversationRow[], k: K): Extract<ConversationRow, { kind: K }>[] =>
  rows.filter((r): r is Extract<ConversationRow, { kind: K }> => r.kind === k);
const notices = (rows: readonly ConversationRow[]): NoticeRow[] => ofKind(rows, 'notice');
const action = (rows: readonly ConversationRow[], toolUseId: string): ActionRow => {
  const a = ofKind(rows, 'action').find((r) => r.toolUseId === toolUseId);
  if (a === undefined) throw new Error(`no action ${toolUseId}`);
  return a;
};

function firstPromptId(name: string): string {
  for (const e of entriesOf(name)) if (e.k === 'node' && typeof e.data.promptId === 'string') return e.data.promptId;
  throw new Error('no promptId');
}

const ALL = [
  'basic-round', 'tool-results', 'commands', 'interrupt', 'image-prompt', 'queue-compact', 'tree-rewind',
  'tree-parallel', 'errors-noise', 'sess-subagent', 'edge-big-line', 'edge-incomplete-last',
];

// ---------------------------------------------------------------------------
// rows produced
// ---------------------------------------------------------------------------

describe('adapt - rows of a simple round (basic-round)', () => {
  const rows = rowsOf('basic-round');

  it('produces user, thinking, action and assistant, in chain order', () => {
    expect(kinds(rows)).toEqual(['user', 'thinking', 'action', 'assistant']);
  });

  it('gives every row of the round the prompt turn id and main scope', () => {
    const turnIds = new Set(rows.map((r) => r.turnId));
    expect(turnIds.size).toBe(1);
    expect([...turnIds][0]).toBe(firstPromptId('basic-round'));
    expect(rows.every((r) => r.scope === 'main')).toBe(true);
  });

  it('closes the action with the tool_result and a summary in Portuguese', () => {
    const a = ofKind(rows, 'action')[0]!;
    expect(a.status).toBe('ok');
    expect(a.tool).toBe('Read');
    expect(a.category).toBe('read');
    expect(a.summary.verb).toBe('Leu');
    expect(a.detail).toBeDefined();
    expect(a.id).toBe(a.toolUseId);
  });

  it('keeps ids unique and stable across two independent runs', () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rowsOf('basic-round').map((r) => r.id)).toEqual(ids);
  });

  it('marks the thinking row (hasText false when empty) and the assistant text', () => {
    const t = ofKind(rows, 'thinking')[0]!;
    expect(typeof t.hasText).toBe('boolean');
    expect(ofKind(rows, 'assistant')[0]!.markdown).toContain('beacon');
  });

  it('builds the Turn list: one human turn, closed by turn_duration, finalRowId = the answer', () => {
    const { state } = run('basic-round');
    expect(state.turns).toHaveLength(1);
    const t = state.turns[0]!;
    expect(t.opener).toBe('human');
    expect(t.complete).toBe(true);
    expect(t.rows).toEqual(rows.map((r) => r.id));
    expect(t.finalRowId).toBe(ofKind(rows, 'assistant')[0]!.id);
  });
});

describe('adapt - action results (tool-results)', () => {
  const rows = rowsOf('tool-results');

  it('marks denied and error actions', () => {
    expect(action(rows, 'toolu_t30').status).toBe('denied');
    expect(action(rows, 'toolu_t31').status).toBe('error');
  });

  it('summarises Read with a partial range, Edit and MCP via the shared summary', () => {
    expect(action(rows, 'toolu_t6').summary.stats).toMatch(/linhas 10/);
    expect(action(rows, 'toolu_t12').summary.verb).toBe('Editou');
    const mcp = ofKind(rows, 'action').find((a) => a.category === 'mcp');
    expect(mcp?.summary.verb).toBe('Usou');
  });

  it('creates question, plan, skill and subagent rows from their tools (never plain actions)', () => {
    expect(ofKind(rows, 'question')).toHaveLength(1);
    expect(ofKind(rows, 'plan')).toHaveLength(1);
    expect(ofKind(rows, 'skill').filter((s) => s.how === 'used-by-claude')).toHaveLength(1);
    expect(ofKind(rows, 'subagent').length).toBeGreaterThanOrEqual(1);
    expect(ofKind(rows, 'action').some((a) => a.tool === 'AskUserQuestion' || a.tool === 'ExitPlanMode' || a.tool === 'Skill')).toBe(false);
  });

  it('fills the question answers and the plan outcome from the result', () => {
    const q = ofKind(rows, 'question')[0]!;
    expect(q.questions[0]!.question).toBe('Qual banco?');
    expect(q.questions[0]!.options.map((o) => o.label)).toEqual(['SQLite', 'Postgres']);
    expect(q.answers).toEqual({ 'Qual banco?': 'SQLite' });
    const p = ofKind(rows, 'plan')[0]!;
    expect(p.markdown).toContain('ler');
    expect(p.outcome).toBe('approved');
  });

  it('names the skill used by Claude', () => {
    expect(ofKind(rows, 'skill').find((s) => s.how === 'used-by-claude')!.name).toBe('atlas-notes');
  });

  it('does not keep the heavy tool output in memory (state stays small)', () => {
    const { state } = run('tool-results');
    expect(JSON.stringify(state).length).toBeLessThan(readFileSync(join(FIXTURES, 'tool-results.jsonl')).length * 2);
  });
});

describe('adapt - grouping (view)', () => {
  it('groups consecutive actions into one action-group with a stable id', () => {
    const { state } = run('tool-results');
    const view = viewOf(state);
    const groups = view.filter((r) => r.kind === 'action-group');
    expect(groups.length).toBeGreaterThan(0);
    const g = groups[0]!;
    expect(g.kind === 'action-group' && g.id.startsWith('group:')).toBe(true);
    const kids = expandGroup(state, g.id);
    expect(kids.length).toBeGreaterThanOrEqual(2);
    expect(kids.some((k) => k.kind === 'action')).toBe(true);
    // children are NOT in the view
    for (const k of kids) expect(view.some((r) => r.id === k.id)).toBe(false);
  });

  it('keeps the flat rows in state.rows (the group is a view transform)', () => {
    const { state } = run('tool-results');
    expect(state.rows.some((r) => r.kind === 'action-group')).toBe(false);
    expect(state.rows.filter((r) => r.kind === 'action').length).toBeGreaterThan(5);
  });
});

describe('adapt - commands, skill typed by the owner, shell, local-command (commands)', () => {
  const rows = rowsOf('commands');

  it('turns <command-name> into a user row with command {name,args}', () => {
    const cmd = ofKind(rows, 'user').find((u) => u.command?.name === 'context');
    expect(cmd).toBeDefined();
    expect(cmd!.command!.args).toBe('');
    expect(ofKind(rows, 'user').find((u) => u.command?.name === 'atlas-notes')).toBeDefined();
  });

  it('produces a local-command row with the stdout as output, and never the caveat', () => {
    const lc = ofKind(rows, 'local-command');
    expect(lc).toHaveLength(1);
    expect(lc[0]!.command).toBe('/context');
    expect(lc[0]!.output).toBe('Context: 12k tokens');
    expect(JSON.stringify(rows)).not.toContain('Caveat');
  });

  it('adds a skill row loaded-by-user for a typed skill, and no extra one for the Skill tool body', () => {
    const skills = ofKind(rows, 'skill');
    expect(skills.filter((s) => s.how === 'loaded-by-user').map((s) => s.name)).toEqual(['atlas-notes']);
    expect(skills.filter((s) => s.how === 'used-by-claude')).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Base directory for this skill');
  });

  it('builds the shell row from <bash-input> and completes it with the next stdout line', () => {
    const sh = ofKind(rows, 'shell');
    expect(sh).toHaveLength(1);
    expect(sh[0]!.command).toBe('ls -la');
    expect(sh[0]!.stdout).toContain('README.md');
    expect(sh[0]!.stderr).toBeUndefined();
  });

  it('opens a new turn for each typed command / prompt', () => {
    const { state } = run('commands');
    expect(state.turns.length).toBeGreaterThanOrEqual(3);
  });
});

describe('adapt - interruption (interrupt)', () => {
  const rows = rowsOf('interrupt');

  it('emits an interrupted notice for the marker and for isAbortedMidStream', () => {
    const n = notices(rows).filter((x) => x.notice === 'interrupted');
    expect(n.length).toBe(3);
  });

  it('keeps the aborted assistant text AND the notice', () => {
    expect(ofKind(rows, 'assistant').some((a) => a.markdown.includes('Comecando'))).toBe(true);
  });

  it('marks the action with interrupted result as interrupted', () => {
    expect(ofKind(rows, 'action').some((a) => a.status === 'interrupted')).toBe(true);
  });
});

describe('adapt - image prompt (image-prompt)', () => {
  const rows = rowsOf('image-prompt');

  it('attaches the image as {ref, blockIndex} without the base64, and drops the isMeta note', () => {
    const u = ofKind(rows, 'user')[0]!;
    expect(u.attachments).toHaveLength(1);
    const a = u.attachments[0]!;
    expect(a.kind).toBe('image');
    if (a.kind === 'image') {
      expect(a.blockIndex).toBe(1);
      expect(a.ref.path).toBe('image-prompt.jsonl');
    }
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('iVBOR');
    expect(dump).not.toContain('[Image: source');
    expect(u.text).toContain('[Image #1]');
  });
});

describe('adapt - queue, compact (queue-compact)', () => {
  const rows = rowsOf('queue-compact');

  it('turns a queued prompt into ONE user row (queued) and dedupes it with its twin user line', () => {
    const q = ofKind(rows, 'user').filter((u) => u.text === 'Depois do build, rode os testes.');
    expect(q).toHaveLength(1);
    expect(q[0]!.queued).toBe(true);
  });

  it('keeps a queued prompt that has no twin', () => {
    expect(ofKind(rows, 'user').filter((u) => u.text === 'Sem gemeo na linha user.')).toHaveLength(1);
  });

  it('draws the compact notice with before/after tokens, and drops the summary', () => {
    const c = notices(rows).filter((n) => n.notice === 'compact');
    expect(c).toHaveLength(1);
    expect(c[0]!.params).toMatchObject({ preTokens: 180000, postTokens: 12000 });
    expect(JSON.stringify(rows)).not.toContain('This session is being continued');
  });

  it('crosses the compaction: rows before and after it are all there', () => {
    expect(ofKind(rows, 'user').some((u) => u.text === 'Inicie o build do atlas.')).toBe(true);
    expect(ofKind(rows, 'user').some((u) => u.text === 'Continue de onde parou.')).toBe(true);
  });
});

describe('adapt - tree (tree-rewind, tree-parallel)', () => {
  it('shows only the active branch of a rewind', () => {
    const rows = rowsOf('tree-rewind');
    const text = JSON.stringify(rows);
    expect(ofKind(rows, 'user').length).toBeGreaterThanOrEqual(2);
    // the abandoned prompt of round 2 is not in the active chain
    const abandoned = entriesOf('tree-rewind')
      .filter((e): e is Extract<TranscriptEntry, { k: 'node' }> => e.k === 'node' && e.role === 'user')
      .map((e) => e.uuid);
    expect(abandoned.length).toBeGreaterThan(rows.filter((r) => r.kind === 'user').length);
    expect(text.length).toBeGreaterThan(0);
  });

  it('emits a reset patch when a rewind line arrives after the old leaf was shown', () => {
    const es = entriesOf('tree-rewind');
    let state = initAdapterState({ cwd: '/work/atlas' });
    const ops: string[] = [];
    for (const e of es) {
      const r = adapt(state, [e]);
      state = r.state;
      ops.push(...r.patches.map((p) => p.op));
    }
    expect(ops).toContain('reset');
  });

  it('closes both parallel actions even when the first result is a side leaf', () => {
    const rows = rowsOf('tree-parallel');
    const acts = ofKind(rows, 'action');
    expect(acts).toHaveLength(2);
    expect(acts.every((a) => a.status === 'ok')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// notices, unknown, noise, privacy
// ---------------------------------------------------------------------------

describe('adapt - errors, notices and unknown (errors-noise)', () => {
  const rows = rowsOf('errors-noise');

  it('maps synthetic API errors to api-error and limit notices', () => {
    const kindsSeen = notices(rows).map((n) => n.notice);
    expect(kindsSeen).toContain('api-error');
    expect(kindsSeen).toContain('limit');
  });

  it('maps recognised attachments / system lines to informational notices', () => {
    const info = notices(rows).filter((n) => n.notice === 'informational');
    const texts = JSON.stringify(info.map((n) => n.params));
    expect(texts).toContain('modo plano');
    expect(texts).toContain('a.ts');
    expect(texts).toContain('lint-hook');
    expect(texts).toContain('info-hook');
    expect(texts).toContain('perm-hook');
    expect(texts).toContain('Heads up');
  });

  it('shows stop_hook_summary only when it prevented continuation or has errors', () => {
    const stop = notices(rows).filter((n) => JSON.stringify(n.params).includes('blocked') || JSON.stringify(n.params).includes('boom'));
    expect(stop).toHaveLength(1);
  });

  it('attaches the @mention to the nearest owner message', () => {
    const u = ofKind(rows, 'user').find((x) => x.text === 'Provoque erros no atlas.')!;
    expect(u.attachments.some((a) => a.kind === 'mention')).toBe(true);
  });

  it('turns unrecognised lines into unknown rows with the type label and a LineRef', () => {
    const labels = ofKind(rows, 'unknown').map((u) => u.typeLabel);
    expect(labels).toContain('attachment:future_attachment');
    expect(labels).toContain('system:future_subtype');
    expect(labels).toContain('future_type');
    for (const u of ofKind(rows, 'unknown')) expect(u.raw.length).toBeGreaterThan(0);
  });

  it('turns an invalid JSON line into an unknown row too (never throws)', () => {
    expect(ofKind(rows, 'unknown').some((u) => u.typeLabel.startsWith('invalid'))).toBe(true);
  });

  it('never produces rows for noise attachments, metas or sidechain lines', () => {
    const text = JSON.stringify(rows);
    expect(text).not.toContain('sidechain prompt');
    expect(rows.some((r) => r.kind === 'unknown' && /hook_success|session_context|credential_org|deferred_tools/.test(r.typeLabel))).toBe(false);
  });

  it('reports each new unknown type ONCE for the diagnostics log (no content)', () => {
    const r = run('errors-noise');
    expect(r.unknown).toEqual(expect.arrayContaining(['attachment:future_attachment', 'system:future_subtype', 'future_type']));
    expect(new Set(r.unknown).size).toBe(r.unknown.length);
    expect(JSON.stringify(r.unknown)).not.toContain('payload');
    // feeding the same entries again on the final state reports nothing new
    const again = adapt(r.state, []);
    expect(again.unknownLabels).toEqual([]);
  });

  it('does not report unknown labels again after a rewind-style refold', () => {
    const r = run('errors-noise', [1]);
    expect(new Set(r.unknown).size).toBe(r.unknown.length);
  });

  it('exposes the metadata lines as state, not as rows', () => {
    expect(run('errors-noise').state.meta.permissionMode).toBeDefined();
    expect(run('basic-round').state.meta.title).toBe(run('basic-round').state.meta.title);
  });
});

describe('adapt - privacy (FR-031)', () => {
  const FORBIDDEN = ['fake.user@example.invalid', 'FAKE-ORG-TOKEN-0000', 'acct-fake-0000', 'org-fake-0000', 'max-fake'];

  for (const name of ALL) {
    it(`never lets session_context / credential_org data reach a row, the state or unknown reports (${name})`, () => {
      for (const sizes of [[100000], [1]]) {
        const r = run(name, sizes);
        const dump = JSON.stringify({ rows: r.state.rows, view: viewOf(r.state), state: r.state, unknown: r.unknown, patches: r.patches, client: r.client });
        for (const v of FORBIDDEN) expect(dump).not.toContain(v);
      }
    });
  }

  it('the fixtures really contain the fake values (the test is not vacuous)', () => {
    const raw = readFileSync(join(FIXTURES, 'errors-noise.jsonl'), 'utf8');
    for (const v of FORBIDDEN.slice(0, 4)) expect(raw).toContain(v);
  });
});

// ---------------------------------------------------------------------------
// subagents
// ---------------------------------------------------------------------------

describe('adapt - subagents (sess-subagent)', () => {
  const metas: SubagentMeta[] = [
    JSON.parse(readFileSync(join(FIXTURES, 'sess-subagent', 'subagents', 'agent-vega01.meta.json'), 'utf8')),
    JSON.parse(readFileSync(join(FIXTURES, 'sess-subagent', 'subagents', 'agent-vega02.meta.json'), 'utf8')),
  ].map((m, i) => ({ ...m, agentId: i === 0 ? 'vega01' : 'vega02' }));

  it('creates the row at the tool_use, learns the agentId from the async_launched result', () => {
    const rows = rowsOf('sess-subagent');
    const subs = ofKind(rows, 'subagent');
    expect(subs.map((s) => s.agentId)).toEqual(['vega01', 'vega02']);
    expect(subs[0]!.toolUseId).toBe('toolu_s1');
    expect(subs[0]!.description).toBe('Explore beacon');
    expect(subs[0]!.agentType).toBe('Explore');
  });

  it('finishes the first from the task-notification user line (completed + duration)', () => {
    const subs = ofKind(rowsOf('sess-subagent'), 'subagent');
    expect(subs[0]!.status).toBe('completed');
    expect(subs[0]!.durationMs).toBe(21000);
  });

  it('finishes the second from the queued_command task-notification (failed), without a user row', () => {
    const rows = rowsOf('sess-subagent');
    expect(ofKind(rows, 'subagent')[1]!.status).toBe('failed');
    expect(ofKind(rows, 'user').some((u) => u.text.includes('task-notification'))).toBe(false);
  });

  it('opens a turn with opener "notification" for the user-line notification', () => {
    const { state } = run('sess-subagent');
    expect(state.turns.map((t) => t.opener)).toContain('notification');
  });

  it('links the .meta.json by toolUseId (type, model, background, depth)', () => {
    let state = initAdapterState({ cwd: '/work/atlas' });
    state = adapt(state, entriesOf('sess-subagent'), { subagentMetas: metas }).state;
    const subs = ofKind(viewOf(state), 'subagent');
    expect(subs[0]!.model).toBe('claude-sonnet-5-5');
    expect(subs[0]!.background).toBe(true);
    expect(subs[0]!.depth).toBe(1);
    expect(subs[1]!.agentType).toBe('general-purpose');
  });

  it('applies a meta that arrives AFTER the rows exist, as a replace patch', () => {
    let state = adapt(initAdapterState({ cwd: '/work/atlas' }), entriesOf('sess-subagent')).state;
    const r = adapt(state, [], { subagentMetas: metas });
    state = r.state;
    expect(r.patches.map((p) => p.op)).toEqual(['replace']);
    expect(ofKind(viewOf(state), 'subagent')[0]!.model).toBe('claude-sonnet-5-5');
  });

  it('uses a stable id for the subagent row (does not depend on the agentId arriving later)', () => {
    const es = entriesOf('sess-subagent');
    let state = initAdapterState({ cwd: '/work/atlas' });
    const first = adapt(state, es.slice(0, 2));
    state = first.state;
    const id = ofKind(viewOf(state), 'subagent')[0]!.id;
    state = adapt(state, es.slice(2)).state;
    expect(ofKind(viewOf(state), 'subagent')[0]!.id).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------

describe('adapt - edges', () => {
  it('handles the 1 MB line without keeping its content', () => {
    const { state } = run('edge-big-line');
    expect(JSON.stringify(state).length).toBeLessThan(200_000);
    expect(state.rows.length).toBeGreaterThan(0);
  });

  it('never throws on any fixture, even one line at a time', () => {
    for (const n of ALL) expect(() => run(n, [1])).not.toThrow();
  });

  it('ignores an empty batch (no patches, same rows)', () => {
    const r = run('basic-round');
    const again = adapt(r.state, []);
    expect(again.patches).toEqual([]);
    expect(viewOf(again.state)).toEqual(viewOf(r.state));
  });

  it('is pure: the input state is not mutated', () => {
    const es = entriesOf('tool-results');
    const s1 = adapt(initAdapterState({ cwd: '/work/atlas' }), es.slice(0, 20)).state;
    const frozen = JSON.stringify(s1);
    adapt(s1, es.slice(20));
    expect(JSON.stringify(s1)).toBe(frozen);
  });
});

// ---------------------------------------------------------------------------
// incremental == all at once
// ---------------------------------------------------------------------------

describe('adapt - incremental reading equals reading at once', () => {
  const SIZES = [[1], [2], [3, 1, 5], [7], [2, 9, 1, 1, 4]];

  for (const name of ALL) {
    it(`${name}: same rows for every chunking, and the patches rebuild the same view`, () => {
      const whole = run(name);
      const wholeView = viewOf(whole.state);
      expect(whole.client).toEqual(wholeView);
      for (const sizes of SIZES) {
        const r = run(name, sizes);
        expect(viewOf(r.state), `${name} ${sizes.join(',')}`).toEqual(wholeView);
        expect(r.state.rows).toEqual(whole.state.rows);
        expect(r.state.turns).toEqual(whole.state.turns);
        expect(r.client, `client ${name} ${sizes.join(',')}`).toEqual(wholeView);
      }
    });
  }

  it('survives a JSON round trip of the state between batches', () => {
    for (const name of ALL) {
      const es = entriesOf(name);
      let state = initAdapterState({ cwd: '/work/atlas' });
      for (const batch of chunked(es, [4])) {
        state = JSON.parse(JSON.stringify(adapt(state, batch).state)) as AdapterState;
      }
      expect(viewOf(state), name).toEqual(viewOf(run(name).state));
    }
  });
});

// ---------------------------------------------------------------------------
// patches
// ---------------------------------------------------------------------------

describe('adapt - patches', () => {
  it('appends new rows', () => {
    const es = entriesOf('basic-round');
    const a = adapt(initAdapterState({ cwd: '/work/atlas' }), es.slice(0, 5));
    expect(a.patches.map((p) => p.op)).toEqual(['append']);
    const b = adapt(a.state, es.slice(5));
    expect(b.patches[b.patches.length - 1]!.op).toBe('append');
  });

  it('replaces the action row (same id) when its result arrives', () => {
    const es = entriesOf('basic-round');
    let state = initAdapterState({ cwd: '/work/atlas' });
    let useIdx = es.findIndex((e) => e.k === 'node' && JSON.stringify(e.data).includes('"tool_use"'));
    expect(useIdx).toBeGreaterThan(0);
    state = adapt(state, es.slice(0, useIdx + 1)).state;
    const running = ofKind(viewOf(state), 'action')[0]!;
    expect(running.status).toBe('running');
    const r = adapt(state, es.slice(useIdx + 1, useIdx + 2));
    expect(r.patches).toHaveLength(1);
    expect(r.patches[0]!.op).toBe('replace');
    expect(r.patches[0]!.rows[0]!.id).toBe(running.id);
    expect((r.patches[0]!.rows[0] as ActionRow).status).toBe('ok');
    useIdx = 0;
  });

  it('keeps the group id while the group grows (replace, not a new row)', () => {
    const es = entriesOf('tool-results');
    let state = initAdapterState({ cwd: '/work/atlas' });
    const seen = new Set<string>();
    const groupIds: string[] = [];
    for (const e of es) {
      const r = adapt(state, [e]);
      state = r.state;
      for (const p of r.patches) for (const row of p.rows) {
        if (row.kind === 'action-group') {
          groupIds.push(row.id);
          seen.add(row.id);
        }
      }
    }
    expect(groupIds.length).toBeGreaterThan(seen.size); // the same group id was sent more than once
  });

  it('resets on a rewind, with the whole recalculated view', () => {
    const es = entriesOf('tree-rewind');
    let state = initAdapterState({ cwd: '/work/atlas' });
    let reset: RowPatch | undefined;
    for (const e of es) {
      const r = adapt(state, [e]);
      state = r.state;
      reset = r.patches.find((p) => p.op === 'reset') ?? reset;
    }
    expect(reset).toBeDefined();
    expect(reset!.rows.map((r) => r.id)).toEqual(viewOf(state).map((r) => r.id).slice(0, reset!.rows.length));
  });
});

describe('adapt - backward pagination (prepend)', () => {
  /**
   * Pages of `rounds` rounds from the end (the pager cuts at round openers), each page in reverse file order.
   * A page starts at a human prompt line.
   */
  function pages(name: string, rounds: number): TranscriptEntry[][] {
    const es = entriesOf(name);
    const starts = es.map((e, i) => (e.k === 'node' && e.role === 'user' && e.data.turnOrigin === 'human' && e.data.isMeta !== true ? i : -1)).filter((i) => i >= 0);
    const cuts = starts.filter((_, k) => k % rounds === 0);
    if (cuts[0] !== 0) cuts.unshift(0);
    const out: TranscriptEntry[][] = [];
    for (let k = cuts.length - 1; k >= 0; k -= 1) out.push(es.slice(cuts[k], k === cuts.length - 1 ? es.length : cuts[k + 1]).reverse());
    return out;
  }

  for (const name of ['basic-round', 'commands', 'queue-compact', 'tool-results', 'sess-subagent']) {
    it(`${name}: pages read backwards give the same rows as reading forward`, () => {
      let state = initAdapterState({ cwd: '/work/atlas' });
      let client: ConversationRow[] = [];
      const ops: string[] = [];
      for (const page of pages(name, 2)) {
        const r = adapt(state, page, { direction: 'backward' });
        state = r.state;
        ops.push(...r.patches.map((p) => p.op));
        client = applyPatches(client, r.patches);
      }
      const expected = viewOf(run(name).state);
      expect(client.map((r) => r.id)).toEqual(expected.map((r) => r.id));
      expect(viewOf(state).map((r) => r.id)).toEqual(expected.map((r) => r.id));
      expect(ops[0]).toBe('append');
      expect(ops.slice(1).every((o) => o === 'prepend' || o === 'replace' || o === 'reset')).toBe(true);
    });
  }

  it('prepends older rows without touching the ones already shown', () => {
    const ps = pages('queue-compact', 1);
    const newest = ps[0]!;
    const older = ps[1]!;
    let state = adapt(initAdapterState({ cwd: '/work/atlas' }), newest, { direction: 'backward' }).state;
    const before = viewOf(state).length;
    const r = adapt(state, older, { direction: 'backward' });
    state = r.state;
    expect(r.patches.some((p) => p.op === 'prepend')).toBe(true);
    expect(viewOf(state).length).toBeGreaterThan(before);
    expect(state.backward.rootReached).toBe(false);
  });

  it('then follows forward from the leaf found backwards', () => {
    const es = entriesOf('basic-round');
    const half = Math.floor(es.length / 2);
    const first = adapt(initAdapterState({ cwd: '/work/atlas' }), es.slice(0, half).reverse(), { direction: 'backward' });
    const next = adapt(first.state, es.slice(half));
    const whole = viewOf(run('basic-round').state);
    expect(viewOf(next.state).map((r) => r.id)).toEqual(whole.map((r) => r.id));
  });
});

// ---------------------------------------------------------------------------
// pasted_content unwrapping in the user card (e2e test 3 finding)
// ---------------------------------------------------------------------------

describe('adapt - collapsed paste is unwrapped in the user row', () => {
  const WRAPPED = '<pasted_content id="x">\nteste 3:\nlinha\n</pasted_content id="x">';

  function inlineEntries(lines: readonly object[]): TranscriptEntry[] {
    const out: TranscriptEntry[] = [];
    let offset = 0;
    for (const obj of lines) {
      const raw = JSON.stringify({ sessionId: 's', cwd: '/work/atlas', isSidechain: false, ...obj });
      const e = classifyLine(raw, { path: 'inline.jsonl', offset, length: raw.length });
      if (e !== null) out.push(e);
      offset += raw.length + 1;
    }
    return out;
  }

  const userLine = (uuid: string, parent: string | null, content: string, extra: object = {}) => ({
    parentUuid: parent, type: 'user', message: { role: 'user', content }, promptId: `p-${uuid}`,
    turnOrigin: 'human', promptSource: 'typed', uuid, timestamp: '2026-10-01T12:00:01.000Z', ...extra,
  });

  it('direct prompt: UserRow.text has no tags and no leading blank line', () => {
    const r = adapt(initAdapterState({ cwd: '/work/atlas' }), inlineEntries([userLine('u1', null, WRAPPED)]));
    const users = ofKind(r.state.rows, 'user');
    expect(users).toHaveLength(1);
    expect(users[0]!.text).toBe('teste 3:\nlinha');
  });

  it('queued path: the queued row and its later delivery share one unwrapped row', () => {
    const entries = inlineEntries([
      userLine('u1', null, 'primeiro'),
      {
        parentUuid: 'u1', type: 'attachment', uuid: 'a1', timestamp: '2026-10-01T12:00:02.000Z',
        attachment: { type: 'queued_command', prompt: WRAPPED, commandMode: 'prompt', humanTurn: true },
      },
      userLine('u2', 'a1', WRAPPED, { promptSource: 'queued', timestamp: '2026-10-01T12:00:03.000Z' }),
    ]);
    const r = adapt(initAdapterState({ cwd: '/work/atlas' }), entries);
    const users = ofKind(r.state.rows, 'user');
    expect(users.map((u) => u.text)).toEqual(['primeiro', 'teste 3:\nlinha']);
  });

  it('queued_command com prompt em array (texto + imagem): cria a linha com o texto e as imagens', () => {
    const entries = inlineEntries([
      userLine('u1', null, 'primeiro'),
      {
        parentUuid: 'u1', type: 'attachment', uuid: 'a1', timestamp: '2026-10-01T12:00:02.000Z',
        attachment: {
          type: 'queued_command',
          commandMode: 'prompt',
          humanTurn: true,
          imagePasteIds: [10],
          prompt: [
            { type: 'text', text: '[Image #10]Olha isto' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      },
      userLine('u2', 'a1', '[Image #10]Olha isto', { promptSource: 'queued', timestamp: '2026-10-01T12:00:03.000Z' }),
    ]);
    const r = adapt(initAdapterState({ cwd: '/work/atlas' }), entries);
    const users = ofKind(r.state.rows, 'user');
    expect(users.map((u) => u.text)).toEqual(['primeiro', '[Image #10]Olha isto']);
    expect(users[1]!.attachments).toEqual([expect.objectContaining({ kind: 'image', blockIndex: 1 })]);
    expect(users[1]!.queued).toBe(true);
  });
});
