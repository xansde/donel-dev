import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A14 — a política de review ESTRUTURADA do repo-alvo. O CLAUDE.md continua
// existindo como EXPLICAÇÃO; a fonte que a fase Concluir lê é
// `.esteira/review-policy.json` (via `tools/review_policy.py` da skill), nunca
// uma string que o payload afirma. O parser TypeScript deste formato foi
// removido por não ter consumidor em `src/`: sobra o teste do ARQUIVO.

// O arquivo DESTE repo: mantenedor único, 1 revisor para qualquer risco,
// inclusive sensível — fixado pelo dono em 04/08 (ver CLAUDE.md).
describe('.esteira/review-policy.json — a política deste repo', () => {
  it('existe, tem só os campos do formato, e reflete a política fixada pelo dono (1 revisor, qualquer risco)', () => {
    const path = join(__dirname, '..', '.esteira', 'review-policy.json');
    const policy = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    expect(Object.keys(policy).sort()).toEqual(['note', 'required_reviewers', 'schema_version']);
    expect(policy.schema_version).toBe('1.0.0');
    expect(policy.required_reviewers).toEqual({ trivial: 1, sensivel: 1 });
  });
});
