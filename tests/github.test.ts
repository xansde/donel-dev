import { describe, expect, it } from 'vitest';
import { GITHUB_CHANNELS, isValidGithubReadRequest } from '../src/shared/github';

// CA-3 (009-modo-dev-v3, lote 4) — validação PURA do payload IPC de
// `github:read` (mesmo espírito de `isValidSaveProjectBindingIpcInput`,
// projectBinding.ts): o main nunca confia cegamente no que o renderer manda.

describe('GITHUB_CHANNELS', () => {
  it('nomeia os dois canais', () => {
    expect(GITHUB_CHANNELS.read).toBe('github:read');
    expect(GITHUB_CHANNELS.checkAvailability).toBe('github:checkAvailability');
  });
});

describe('isValidGithubReadRequest', () => {
  it('spec-issue válido', () => {
    expect(isValidGithubReadRequest({ kind: 'spec-issue', repo: 'o/r', number: 1 })).toBe(true);
  });

  it('sub-issues válido', () => {
    expect(isValidGithubReadRequest({ kind: 'sub-issues', repo: 'o/r', number: 1 })).toBe(true);
  });

  it('phase-pull-request válido com number', () => {
    expect(isValidGithubReadRequest({ kind: 'phase-pull-request', repo: 'o/r', number: 1 })).toBe(true);
  });

  it('phase-pull-request válido com head, sem number', () => {
    expect(isValidGithubReadRequest({ kind: 'phase-pull-request', repo: 'o/r', head: 'esteira/algo' })).toBe(true);
  });

  it('phase-pull-request válido sem number nem head (o handler resolve pra null sem spawnar)', () => {
    expect(isValidGithubReadRequest({ kind: 'phase-pull-request', repo: 'o/r' })).toBe(true);
  });

  it('kind desconhecido: false', () => {
    expect(isValidGithubReadRequest({ kind: 'issue-delete', repo: 'o/r', number: 1 })).toBe(false);
  });

  it('repo vazio/ausente: false', () => {
    expect(isValidGithubReadRequest({ kind: 'spec-issue', repo: '', number: 1 })).toBe(false);
    expect(isValidGithubReadRequest({ kind: 'spec-issue', number: 1 })).toBe(false);
  });

  it('spec-issue sem number: false', () => {
    expect(isValidGithubReadRequest({ kind: 'spec-issue', repo: 'o/r' })).toBe(false);
  });

  it('não-objeto/null/undefined: false, nunca lança', () => {
    expect(isValidGithubReadRequest(null)).toBe(false);
    expect(isValidGithubReadRequest(undefined)).toBe(false);
    expect(isValidGithubReadRequest('texto')).toBe(false);
    expect(isValidGithubReadRequest(42)).toBe(false);
  });
});
