import { describe, expect, it } from 'vitest';
import { isValidCopyTranscriptForResumeIpcInput, planTranscriptCopy, slugifyProjectPathForTranscript } from '../src/shared/transcriptCopy';

// Lote 8 (009-modo-dev-v3), CA-24 — "Reiniciar sessão" retoma na CONTA
// SELECIONADA, copiando o transcript pro perfil dela quando a sessão rodou
// em outro perfil (achado 14 da spec: o `.jsonl` mora dentro do
// `CLAUDE_CONFIG_DIR` do perfil dono). Módulo PURO: decide O QUE fazer, sem
// tocar fs — o main (`src/main/transcript-copy.ts`) executa.

describe('slugifyProjectPathForTranscript', () => {
  it('troca todo caractere não-alfanumérico por "-", um por um (mesma regra de session-indexer.ts slugifyProjectPath)', () => {
    expect(slugifyProjectPathForTranscript('C:\\Users\\x\\seazone\\donel-dev')).toBe('C--Users-x-seazone-donel-dev');
  });
});

describe('planTranscriptCopy', () => {
  const BASE = { sessionId: 'sess-1', projectPath: 'C:\\proj', sourceProfileSlug: 'tech-1', targetProfileSlug: 'tech-2' };

  it('mesma conta (source === target) → same-profile, resume direto, sem cópia', () => {
    expect(planTranscriptCopy({ ...BASE, targetProfileSlug: 'tech-1' })).toEqual({ kind: 'same-profile' });
  });

  it('contas diferentes → copy-required, com o nome do arquivo e o slug do projeto resolvidos', () => {
    const plan = planTranscriptCopy(BASE);
    expect(plan).toEqual({
      kind: 'copy-required',
      sessionFileName: 'sess-1.jsonl',
      projectSlug: 'C--proj',
      sourceProfileSlug: 'tech-1',
      targetProfileSlug: 'tech-2',
    });
  });

  it('sessionId vazio → same-profile (payload inválido nunca decide copiar, degradação por omissão)', () => {
    expect(planTranscriptCopy({ ...BASE, sessionId: '' })).toEqual({ kind: 'same-profile' });
  });

  it('projectPath vazio → same-profile (sem projeto não há onde copiar de/para)', () => {
    expect(planTranscriptCopy({ ...BASE, projectPath: '' })).toEqual({ kind: 'same-profile' });
  });

  it('sourceProfileSlug/targetProfileSlug vazios → same-profile', () => {
    expect(planTranscriptCopy({ ...BASE, sourceProfileSlug: '' })).toEqual({ kind: 'same-profile' });
    expect(planTranscriptCopy({ ...BASE, targetProfileSlug: '' })).toEqual({ kind: 'same-profile' });
  });
});

describe('isValidCopyTranscriptForResumeIpcInput', () => {
  const VALID = { sessionId: 'sess-1', projectPath: 'C:\\proj', sourceProfileSlug: 'tech-1', targetProfileSlug: 'tech-2' };

  it('payload completo e com strings não-vazias → válido', () => {
    expect(isValidCopyTranscriptForResumeIpcInput(VALID)).toBe(true);
  });

  it('null/objeto vazio/tipo errado → inválido', () => {
    expect(isValidCopyTranscriptForResumeIpcInput(null)).toBe(false);
    expect(isValidCopyTranscriptForResumeIpcInput({})).toBe(false);
    expect(isValidCopyTranscriptForResumeIpcInput('sess-1')).toBe(false);
  });

  it('qualquer campo obrigatório vazio/ausente → inválido', () => {
    expect(isValidCopyTranscriptForResumeIpcInput({ ...VALID, sessionId: '' })).toBe(false);
    expect(isValidCopyTranscriptForResumeIpcInput({ ...VALID, projectPath: undefined })).toBe(false);
    expect(isValidCopyTranscriptForResumeIpcInput({ ...VALID, sourceProfileSlug: '' })).toBe(false);
    expect(isValidCopyTranscriptForResumeIpcInput({ ...VALID, targetProfileSlug: '' })).toBe(false);
  });
});
