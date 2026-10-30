import { describe, expect, it } from 'vitest';
import { buildClaudeArgs } from '../src/shared/commandBuilder';
import { cliWorktreeBranch, isSafeWorktreeName, slugifyWorktreeName, worktreeNameFor, worktreeNameFromArgs } from '../src/shared/sessionWorktree';

// "Isolar em worktree" — o nome que o app dá à worktree do CLI e a leitura dele de volta do argv.
const AT = new Date(2026, 9, 30, 17, 52, 41); // 30/10 17:52 (hora local)

describe('worktreeNameFor', () => {
  it('slug do nome da sessão + MMDD-HHmm local', () => {
    expect(worktreeNameFor('radar', AT)).toBe('radar-1030-1752');
  });

  it('sem nome da sessão: "sessao" + data', () => {
    expect(worktreeNameFor('', AT)).toBe('sessao-1030-1752');
    expect(worktreeNameFor('   ', AT)).toBe('sessao-1030-1752');
    expect(worktreeNameFor('!!!', AT)).toBe('sessao-1030-1752');
  });

  it('acentos, espaços e símbolos viram um slug ASCII curto', () => {
    expect(worktreeNameFor('Revisão do PR #12 — ação', AT)).toBe('revisao-do-pr-12-acao-1030-1752');
    expect(slugifyWorktreeName('a'.repeat(40))).toHaveLength(24);
    expect(slugifyWorktreeName('abc def ghi jkl mno pqr- stu')).not.toMatch(/-$/);
  });

  it('nome já em uso (outra aba aberta) ganha -2, -3: o CLI reabriria a mesma worktree', () => {
    expect(worktreeNameFor('radar', AT, ['radar-1030-1752'])).toBe('radar-1030-1752-2');
    expect(worktreeNameFor('radar', AT, ['radar-1030-1752', 'radar-1030-1752-2'])).toBe('radar-1030-1752-3');
  });

  it('o resultado é sempre um nome seguro', () => {
    for (const name of ['radar', '', 'Ação/../../x', '-n', 'ÇÃO']) {
      expect(isSafeWorktreeName(worktreeNameFor(name, AT))).toBe(true);
    }
  });
});

describe('isSafeWorktreeName', () => {
  it('recusa o que poderia sair de .claude/worktrees ou virar flag', () => {
    expect(isSafeWorktreeName('../x')).toBe(false);
    expect(isSafeWorktreeName('-rf')).toBe(false);
    expect(isSafeWorktreeName('a/b')).toBe(false);
    expect(isSafeWorktreeName('A')).toBe(false);
    expect(isSafeWorktreeName('')).toBe(false);
    expect(isSafeWorktreeName('radar-1030-1752')).toBe(true);
  });
});

describe('worktreeNameFromArgs', () => {
  it('lê de volta o nome do argv montado pelo CommandBuilder', () => {
    expect(worktreeNameFromArgs(buildClaudeArgs({ model: 'fable', sessionName: 'radar', worktree: 'radar-1030-1752' }))).toBe('radar-1030-1752');
  });

  it('aceita --worktree=<nome> e -w <nome>', () => {
    expect(worktreeNameFromArgs(['--worktree=abc'])).toBe('abc');
    expect(worktreeNameFromArgs(['-w', 'abc'])).toBe('abc');
  });

  it('sem a flag, sem valor ou com flag no lugar do valor: null', () => {
    expect(worktreeNameFromArgs(undefined)).toBeNull();
    expect(worktreeNameFromArgs(['--model', 'fable'])).toBeNull();
    expect(worktreeNameFromArgs(['--worktree'])).toBeNull();
    expect(worktreeNameFromArgs(['--worktree', '--chrome'])).toBeNull();
    expect(worktreeNameFromArgs(['--worktree='])).toBeNull();
  });
});

describe('cliWorktreeBranch', () => {
  it('é a branch que o CLI cria', () => {
    expect(cliWorktreeBranch('radar-1030-1752')).toBe('worktree-radar-1030-1752');
  });
});
