import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUIRED_REVIEWERS,
  parseReviewPolicyText,
  requiredReviewersFor,
  REVIEW_POLICY_FILE,
} from '../src/shared/esteira/contract/reviewPolicy';

// A14 — a política de review ESTRUTURADA do repo-alvo. O CLAUDE.md continua
// existindo como EXPLICAÇÃO; a fonte que o gate/skill de Concluir lê é
// `.esteira/review-policy.json`, nunca uma string que o payload afirma.

describe('parseReviewPolicyText', () => {
  it('lê um documento válido', () => {
    const parsed = parseReviewPolicyText(
      JSON.stringify({ schema_version: '1.0.0', required_reviewers: { trivial: 1, sensivel: 1 }, note: 'mantenedor único' }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.policy.requiredReviewers).toEqual({ trivial: 1, sensivel: 1 });
    expect(parsed.policy.note).toBe('mantenedor único');
  });

  it('note é opcional — ausência não é erro', () => {
    const parsed = parseReviewPolicyText(JSON.stringify({ schema_version: '1.0.0', required_reviewers: { trivial: 1, sensivel: 2 } }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.policy.note).toBeNull();
  });

  it('JSON inválido vira issue, nunca exceção', () => {
    const parsed = parseReviewPolicyText('{ nao json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0].code).toBe('invalid_json');
  });

  it('campo desconhecido é ERRO — nunca ruído ignorado', () => {
    const parsed = parseReviewPolicyText(
      JSON.stringify({ schema_version: '1.0.0', required_reviewers: { trivial: 1, sensivel: 2 }, campo_de_um_lado_so: true }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.some((issue) => issue.code === 'unknown_field')).toBe(true);
  });

  it('risco desconhecido dentro de required_reviewers também é erro', () => {
    const parsed = parseReviewPolicyText(JSON.stringify({ schema_version: '1.0.0', required_reviewers: { trivial: 1, sensivel: 2, urgente: 3 } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.some((issue) => issue.path === 'required_reviewers.urgente')).toBe(true);
  });

  it('required_reviewers ausente, ou com valor não-inteiro/negativo, é erro', () => {
    expect(parseReviewPolicyText(JSON.stringify({ schema_version: '1.0.0' })).ok).toBe(false);
    expect(parseReviewPolicyText(JSON.stringify({ schema_version: '1.0.0', required_reviewers: { trivial: 1.5, sensivel: 2 } })).ok).toBe(false);
    expect(parseReviewPolicyText(JSON.stringify({ schema_version: '1.0.0', required_reviewers: { trivial: -1, sensivel: 2 } })).ok).toBe(false);
  });

  it('nunca lança, seja qual for a entrada', () => {
    const inputs: unknown[] = [undefined, null, 0, '', [], {}, { required_reviewers: 'nao objeto' }];
    for (const input of inputs) {
      expect(() => parseReviewPolicyText(typeof input === 'string' ? input : JSON.stringify(input))).not.toThrow();
    }
  });
});

describe('requiredReviewersFor — a régua DE AGORA', () => {
  it('sem política (repo sem arquivo), cai no default da esteira', () => {
    expect(requiredReviewersFor(null, 'trivial')).toBe(DEFAULT_REQUIRED_REVIEWERS.trivial);
    expect(requiredReviewersFor(null, 'sensivel')).toBe(DEFAULT_REQUIRED_REVIEWERS.sensivel);
  });

  it('com política própria, usa a DO REPO — mesmo quando é mais branda que o default', () => {
    const policy = { schemaVersion: '1.0.0', requiredReviewers: { trivial: 1, sensivel: 1 }, note: 'mantenedor único' };
    expect(requiredReviewersFor(policy, 'sensivel')).toBe(1);
  });
});

// O arquivo DESTE repo: mantenedor único, 1 revisor para qualquer risco,
// inclusive sensível — fixado pelo dono em 04/08 (ver CLAUDE.md).
describe('.esteira/review-policy.json — a política deste repo', () => {
  it('existe, é válido, e reflete a política fixada pelo dono (1 revisor, qualquer risco)', () => {
    const path = join(__dirname, '..', REVIEW_POLICY_FILE);
    const parsed = parseReviewPolicyText(readFileSync(path, 'utf8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.policy.requiredReviewers).toEqual({ trivial: 1, sensivel: 1 });
  });
});
