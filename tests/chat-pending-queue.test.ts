import { describe, expect, it } from 'vitest';
import {
  closePending,
  pendingFromRequest,
  pendingQueueView,
  permissionDiff,
  toHookDecision,
} from '../src/shared/chat/pendingQueue';
import type { Pending } from '../src/shared/chat/rows';

const base = { toolUseId: null, arrivedAt: '2026-10-08T10:00:00.000Z', scope: 'main' as const };

function perm(toolName: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}): Pending {
  return pendingFromRequest({
    id: 'p1',
    payload: { tool_name: toolName, tool_input: toolInput, ...extra },
    ...base,
  });
}

describe('pendingFromRequest', () => {
  it('builds a permission pending in state open', () => {
    const p = perm('Bash', { command: 'npm test' }, { agent_id: 'ag1' });
    expect(p.kind).toBe('permission');
    expect(p.state).toBe('open');
    expect(p.match).toEqual({ agentId: 'ag1', toolName: 'Bash', toolInput: { command: 'npm test' } });
    expect(p.payload).toMatchObject({ toolName: 'Bash', toolInput: { command: 'npm test' } });
  });

  it('keeps permission suggestions and fills the diff for Edit', () => {
    const p = perm(
      'Edit',
      { file_path: 'a.ts', old_string: 'a\nb', new_string: 'c' },
      { permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] },
    );
    if (p.kind !== 'permission') throw new Error('kind');
    expect(p.payload.diff).toBe('-a\n-b\n+c');
    expect(p.payload.permissionSuggestions).toHaveLength(1);
  });

  it('maps AskUserQuestion to a question pending', () => {
    const questions = [{ question: 'Q?', options: [{ label: 'A' }] }];
    const p = perm('AskUserQuestion', { questions });
    expect(p.kind).toBe('question');
    if (p.kind === 'question') expect(p.payload.questions).toEqual(questions);
  });

  it('maps ExitPlanMode to a plan pending', () => {
    const p = perm('ExitPlanMode', { plan: '# Plano' });
    expect(p.kind).toBe('plan');
    if (p.kind === 'plan') expect(p.payload.markdown).toBe('# Plano');
  });

  it('carries toolUseId, arrivedAt and scope', () => {
    const scope = { agentId: 'ag', description: 'revisor' };
    const p = pendingFromRequest({
      id: 'x',
      payload: { tool_name: 'Bash', tool_input: {} },
      toolUseId: 'tu1',
      arrivedAt: '2026-10-08T10:00:00.000Z',
      scope,
    });
    expect(p.toolUseId).toBe('tu1');
    expect(p.scope).toEqual(scope);
    expect(p.arrivedAt).toBe('2026-10-08T10:00:00.000Z');
  });
});

describe('permissionDiff', () => {
  it('renders Edit lines as - and +', () => {
    expect(permissionDiff('Edit', { old_string: 'x', new_string: 'y\nz' })).toBe('-x\n+y\n+z');
  });
  it('renders MultiEdit edits in order', () => {
    expect(
      permissionDiff('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }),
    ).toBe('-a\n+b\n-c\n+d');
  });
  it('renders Write as all +', () => {
    expect(permissionDiff('Write', { content: 'l1\nl2' })).toBe('+l1\n+l2');
  });
  it('returns undefined for other tools', () => {
    expect(permissionDiff('Bash', { command: 'ls' })).toBeUndefined();
  });
});

describe('toHookDecision', () => {
  it('allow', () => {
    expect(toHookDecision(perm('Bash', { command: 'ls' }), { kind: 'allow' })).toEqual({ behavior: 'allow' });
  });

  it('allow-always keeps addRules suggestions, forcing localSettings and dropping the rest', () => {
    const p = perm('Bash', { command: 'npm install x' }, {
      permission_suggestions: [
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm install:*' }], behavior: 'allow', destination: 'session' },
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
        { type: 'addDirectories', directories: ['/x'], destination: 'session' },
      ],
    });
    expect(toHookDecision(p, { kind: 'allow-always' })).toEqual({
      behavior: 'allow',
      updatedPermissions: [
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm install:*' }], behavior: 'allow', destination: 'localSettings' },
      ],
    });
  });

  it('allow-always without addRules falls back to the tool name', () => {
    expect(toHookDecision(perm('Edit', { file_path: 'a' }), { kind: 'allow-always' })).toEqual({
      behavior: 'allow',
      updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'localSettings' }],
    });
  });

  it('deny uses the reason or the default message', () => {
    const p = perm('Bash', { command: 'ls' });
    expect(toHookDecision(p, { kind: 'deny', reason: '  não  ' })).toEqual({ behavior: 'deny', message: 'não' });
    expect(toHookDecision(p, { kind: 'deny' })).toEqual({ behavior: 'deny', message: 'Negado pelo dono no Donel.' });
    expect(toHookDecision(p, { kind: 'deny', reason: '   ' })).toEqual({ behavior: 'deny', message: 'Negado pelo dono no Donel.' });
  });

  it('answers echo tool_input with answers', () => {
    const questions = [{ question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }];
    const p = perm('AskUserQuestion', { questions });
    expect(toHookDecision(p, { kind: 'answers', answers: { 'Q?': 'A, B' } })).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Q?': 'A, B' } },
    });
  });

  it('answers with annotations: notes go in updatedInput.annotations, keyed by question text', () => {
    const questions = [{ question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }];
    const p = perm('AskUserQuestion', { questions });
    expect(
      toHookDecision(p, { kind: 'answers', answers: { 'Q?': 'A' }, annotations: { 'Q?': { notes: 'só em dev' } } }),
    ).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Q?': 'A' }, annotations: { 'Q?': { notes: 'só em dev' } } },
    });
  });

  it('answers with empty annotations keep the payload as before (no annotations key)', () => {
    const questions = [{ question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }];
    const p = perm('AskUserQuestion', { questions });
    const decision = toHookDecision(p, { kind: 'answers', answers: { 'Q?': 'A' }, annotations: {} });
    expect(decision).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Q?': 'A' } } });
    expect(Object.keys(decision.updatedInput as object)).not.toContain('annotations');
  });

  it('plan-approve echoes the whole tool_input', () => {
    const p = perm('ExitPlanMode', { plan: '# P', extra: 1 });
    expect(toHookDecision(p, { kind: 'plan-approve' })).toEqual({
      behavior: 'allow',
      updatedInput: { plan: '# P', extra: 1 },
    });
  });

  it('plan-adjust denies with the text', () => {
    expect(toHookDecision(perm('ExitPlanMode', { plan: 'p' }), { kind: 'plan-adjust', text: 'mude X' })).toEqual({
      behavior: 'deny',
      message: 'mude X',
    });
  });

  it('interrupt', () => {
    expect(toHookDecision(perm('Bash', {}), { kind: 'interrupt' })).toEqual({ behavior: 'deny', interrupt: true });
  });

  it('throws on invalid combinations', () => {
    expect(() => toHookDecision(perm('Bash', {}), { kind: 'answers', answers: {} })).toThrow();
    expect(() => toHookDecision(perm('Bash', {}), { kind: 'plan-approve' })).toThrow();
    expect(() => toHookDecision(perm('Bash', {}), { kind: 'plan-adjust', text: 'x' })).toThrow();
    expect(() => toHookDecision(perm('AskUserQuestion', { questions: [] }), { kind: 'allow-always' })).toThrow();
  });
});

describe('pendingQueueView', () => {
  const at = (id: string, arrivedAt: string) => ({ ...perm('Bash', {}), id, arrivedAt }) as Pending;

  it('empty queue', () => {
    expect(pendingQueueView([])).toEqual({ head: null, waiting: 0 });
  });
  it('head is the earliest open; ties keep input order', () => {
    const list = [at('c', '2026-10-08T10:00:02Z'), at('a', '2026-10-08T10:00:01Z'), at('b', '2026-10-08T10:00:01Z')];
    const v = pendingQueueView(list);
    expect(v.head?.id).toBe('a');
    expect(v.waiting).toBe(2);
  });
  it('ignores non-open pendings', () => {
    const closed = closePending(at('a', '2026-10-08T10:00:00Z'), 'answered');
    const v = pendingQueueView([closed, at('b', '2026-10-08T10:00:05Z')]);
    expect(v.head?.id).toBe('b');
    expect(v.waiting).toBe(0);
  });
});

describe('closePending', () => {
  it('closes an open pending', () => {
    expect(closePending(perm('Bash', {}), 'expired').state).toBe('expired');
  });
  it('leaves a closed pending unchanged', () => {
    const answered = closePending(perm('Bash', {}), 'answered');
    expect(closePending(answered, 'cancelled')).toBe(answered);
  });
});
