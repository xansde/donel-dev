import { describe, expect, it } from 'vitest';
import { buildLauncherArgs } from '../src/renderer/src/launchArgsForProvider';

// T1316 (011-contas-e-provedores, etapa 3, C18/D7) — montador de argv extraído
// do App.tsx (função pura): com provider classe A, --model/--effort são
// OMITIDOS (o modelo vem do env da entrada); -n/--permission-mode seguem
// preservados. Sem provider, argv é BYTE A BYTE o de hoje (regressão) —
// `buildClaudeArgs` (commandBuilder.ts) continua intocado, só é chamado com
// menos opções quando há provider.

describe('buildLauncherArgs (puro)', () => {
  it('sem provider: argv idêntico ao de hoje (model/effort/permissionMode/nome, regressão byte a byte)', () => {
    const args = buildLauncherArgs({ providerId: undefined, model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: 'radar' });
    expect(args).toEqual(['--model', 'fable', '--effort', 'high', '--permission-mode', 'acceptEdits', '-n', 'radar']);
  });

  it('com provider classe A: --model e --effort são omitidos', () => {
    const args = buildLauncherArgs({ providerId: 'openrouter-a1', model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: 'radar' });
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--effort');
  });

  it('com provider: -n e --permission-mode continuam preservados', () => {
    const args = buildLauncherArgs({ providerId: 'openrouter-a1', model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: 'radar' });
    expect(args).toEqual(['--permission-mode', 'acceptEdits', '-n', 'radar']);
  });

  it('com provider e sem sessionName: argv só com --permission-mode', () => {
    const args = buildLauncherArgs({ providerId: 'openrouter-a1', model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: '' });
    expect(args).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('isolar em worktree: --worktree <nome> no fim, com ou sem provider (worktree não depende da conta)', () => {
    expect(
      buildLauncherArgs({ providerId: undefined, model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: 'radar', worktree: 'radar-1030-1752' }),
    ).toEqual(['--model', 'fable', '--effort', 'high', '--permission-mode', 'acceptEdits', '-n', 'radar', '--worktree', 'radar-1030-1752']);
    expect(
      buildLauncherArgs({ providerId: 'openrouter-a1', model: 'fable', effort: 'high', permissionMode: 'acceptEdits', sessionName: '', worktree: 'sessao-1030-1752' }),
    ).toEqual(['--permission-mode', 'acceptEdits', '--worktree', 'sessao-1030-1752']);
  });

  it('sem provider e sem sessionName: comportamento de hoje preservado', () => {
    const args = buildLauncherArgs({ providerId: undefined, model: 'opus', effort: 'low', permissionMode: 'manual', sessionName: '' });
    expect(args).toEqual(['--model', 'opus', '--effort', 'low', '--permission-mode', 'manual']);
  });
});
