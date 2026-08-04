import { describe, expect, it } from 'vitest';
import { planTranscriptConsolidation } from '../src/main/accounts/migration/transcript-consolidation';

// T1206 (011-contas-e-provedores, etapa 2) — transcript-consolidation.ts é
// PURO (recebe realpath já resolvidos + lista de arquivos .jsonl e devolve o
// plano; D11/C26). O executor de disco (T1207/IPC) é injetável, fora daqui.

describe('planTranscriptConsolidation (puro)', () => {
  it('realpath igual (junction) ⇒ already-consolidated, zero operações', () => {
    const plan = planTranscriptConsolidation({
      profileProjectsRealpath: 'C:\\home\\.claude\\projects',
      globalProjectsRealpath: 'C:\\home\\.claude\\projects',
      profileJsonlFiles: ['session-a.jsonl'],
      globalProjectsPath: 'C:\\home\\.claude\\projects',
      profileProjectsPath: 'C:\\home\\.claude-profiles\\acc-1\\projects',
      existingGlobalFiles: [],
    });
    expect(plan.kind).toBe('already-consolidated');
    if (plan.kind === 'already-consolidated') expect(plan.reason).toBe('same-realpath');
  });

  it('diretório real distinto ⇒ uma operação por .jsonl com id de sessão preservado', () => {
    const plan = planTranscriptConsolidation({
      profileProjectsRealpath: 'C:\\home\\.claude-profiles\\acc-1\\projects',
      globalProjectsRealpath: 'C:\\home\\.claude\\projects',
      profileJsonlFiles: ['session-a.jsonl', 'session-b.jsonl'],
      globalProjectsPath: 'C:\\home\\.claude\\projects',
      profileProjectsPath: 'C:\\home\\.claude-profiles\\acc-1\\projects',
      existingGlobalFiles: [],
    });
    expect(plan.kind).toBe('copy');
    if (plan.kind !== 'copy') throw new Error('expected copy');
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]?.sourcePath).toContain('session-a.jsonl');
    expect(plan.operations[0]?.targetPath).toContain('session-a.jsonl');
    expect(plan.operations[0]?.mode).toBe('copy');
  });

  it('destino já existente ⇒ skip-existing, nunca sobrescreve', () => {
    const plan = planTranscriptConsolidation({
      profileProjectsRealpath: 'C:\\home\\.claude-profiles\\acc-1\\projects',
      globalProjectsRealpath: 'C:\\home\\.claude\\projects',
      profileJsonlFiles: ['session-a.jsonl'],
      globalProjectsPath: 'C:\\home\\.claude\\projects',
      profileProjectsPath: 'C:\\home\\.claude-profiles\\acc-1\\projects',
      existingGlobalFiles: ['session-a.jsonl'],
    });
    expect(plan.kind).toBe('copy');
    if (plan.kind !== 'copy') throw new Error('expected copy');
    expect(plan.operations[0]?.mode).toBe('skip-existing');
  });

  it('projects ausente (realpath nulo) ⇒ nothing-to-copy', () => {
    const plan = planTranscriptConsolidation({
      profileProjectsRealpath: null,
      globalProjectsRealpath: 'C:\\home\\.claude\\projects',
      profileJsonlFiles: [],
      globalProjectsPath: 'C:\\home\\.claude\\projects',
      profileProjectsPath: 'C:\\home\\.claude-profiles\\acc-1\\projects',
      existingGlobalFiles: [],
    });
    expect(plan.kind).toBe('nothing-to-copy');
    if (plan.kind === 'nothing-to-copy') expect(plan.reason).toBe('missing');
  });
});
