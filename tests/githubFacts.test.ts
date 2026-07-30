import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractSpecIssueRef,
  HOMOLOGADO_LABEL,
  parsePullRequest,
  parsePullRequestList,
  parseSpecIssue,
  parseSubIssues,
  REVERTIDO_CICLO_LABEL,
} from '../src/shared/githubFacts';

// CA-3/CA-5 (009-modo-dev-v3, lote 4) — parser PURO dos payloads crus do `gh`
// CLI (nenhum spawn aqui; ver src/main/github-reader.ts pro I/O). Fixtures em
// tests/fixtures/github/: reais (capturadas rodando `gh` de verdade, só
// leitura, 2026-07-29/30 — ver campo `_captured`) ou sintéticas fiéis ao
// schema documentado (`_synthetic` explica por quê: homologado/revertido-
// ciclo e sub-issues populadas exigiriam escrita real no GitHub, fora de
// escopo). Regra dura (C4/CA-6): campo desconhecido é ignorado, shape
// inesperado degrada pra null/[], nunca lança.

function loadFixture(name: string): unknown {
  const raw = readFileSync(join(__dirname, 'fixtures', 'github', name), 'utf8');
  return JSON.parse(raw);
}

describe('parseSpecIssue', () => {
  it('payload real (gh issue view --json number,title,state,url,labels): mapeia state MAIÚSCULO pro enum minúsculo e extrai nomes de label', () => {
    const facts = parseSpecIssue(loadFixture('issue-view-real.json'));
    expect(facts).toEqual({
      number: 1000,
      title: 'Slow response when system is offline',
      state: 'closed',
      url: 'https://github.com/microsoft/vscode/issues/1000',
      labels: ['bug', 'important'],
    });
  });

  it('state OPEN (não "closed") vira "open"', () => {
    const facts = parseSpecIssue({ number: 1, title: 't', state: 'OPEN', url: 'u', labels: [] });
    expect(facts?.state).toBe('open');
  });

  it('sem number: null (não é uma spec-issue válida)', () => {
    expect(parseSpecIssue({ title: 't', state: 'OPEN' })).toBeNull();
  });

  it('null/undefined/array/string: null, nunca lança', () => {
    expect(parseSpecIssue(null)).toBeNull();
    expect(parseSpecIssue(undefined)).toBeNull();
    expect(parseSpecIssue([])).toBeNull();
    expect(parseSpecIssue('texto')).toBeNull();
  });

  it('campos ausentes (title/url) degradam pra string vazia, nunca undefined/lançamento', () => {
    const facts = parseSpecIssue({ number: 5, state: 'OPEN' });
    expect(facts).toEqual({ number: 5, title: '', state: 'open', url: '', labels: [] });
  });

  it('campo desconhecido no payload é ignorado, não quebra o parse', () => {
    const facts = parseSpecIssue({ number: 5, state: 'OPEN', title: 't', url: 'u', labels: [], nonExistentField: { deep: true } });
    expect(facts).toEqual({ number: 5, title: 't', state: 'open', url: 'u', labels: [] });
  });
});

describe('parseSubIssues', () => {
  it('payload real vazio (gh api .../sub_issues, verificado ao vivo em cli/cli#10000): []', () => {
    const { items } = loadFixture('sub-issues-empty-real.json') as { items: unknown };
    expect(parseSubIssues(items)).toEqual([]);
  });

  it('payload sintético populado: mapeia number/title/state/url e resolve repo por repository_url (campo REST real confirmado)', () => {
    const { items } = loadFixture('sub-issues-populated-synthetic.json') as { items: unknown };
    const facts = parseSubIssues(items);
    expect(facts).toEqual([
      {
        number: 42,
        title: 'Implementar validação de formulário',
        state: 'open',
        repo: 'seazone-tech/spotsys',
        url: 'https://github.com/seazone-tech/spotsys/issues/42',
      },
      {
        number: 7,
        title: 'Corrigir race condition no worker',
        state: 'closed',
        repo: 'seazone-tech/api-spotsys',
        url: 'https://github.com/seazone-tech/api-spotsys/issues/7',
      },
    ]);
  });

  it('resolve repo por repository.full_name quando presente (variante GraphQL-enriquecida, cross-repo)', () => {
    const facts = parseSubIssues([{ number: 1, title: 't', state: 'open', html_url: 'u', repository: { full_name: 'owner/repo-b' } }]);
    expect(facts[0].repo).toBe('owner/repo-b');
  });

  it('sem repository nem repository_url: repo null (nunca fabrica um valor)', () => {
    const facts = parseSubIssues([{ number: 1, title: 't', state: 'open', html_url: 'u' }]);
    expect(facts[0].repo).toBeNull();
  });

  it('item sem number é descartado; itens válidos ao redor sobrevivem', () => {
    const facts = parseSubIssues([{ title: 'sem number' }, { number: 2, title: 'válido', state: 'open', html_url: 'u' }]);
    expect(facts).toHaveLength(1);
    expect(facts[0].number).toBe(2);
  });

  it('não-array (objeto, null, string): [], nunca lança', () => {
    expect(parseSubIssues(null)).toEqual([]);
    expect(parseSubIssues({})).toEqual([]);
    expect(parseSubIssues('texto')).toEqual([]);
  });
});

describe('parsePullRequest / parsePullRequestList', () => {
  it('payload real (gh pr view --json, PR mergeado): merged=true e mergedAt preservado', () => {
    const facts = parsePullRequest(loadFixture('pr-view-real.json'));
    expect(facts).toEqual({
      number: 3,
      url: 'https://github.com/xansde/donel-dev/pull/3',
      state: 'merged',
      merged: true,
      mergedAt: '2026-07-28T16:29:11Z',
      baseRefName: 'staging',
      homologado: false,
      revertidoCiclo: false,
    });
  });

  it('payload real de gh pr list (array) via parsePullRequestList: PR aberto, merged=false', () => {
    const { items } = loadFixture('pr-list-by-head-real.json') as { items: unknown };
    const facts = parsePullRequestList(items);
    expect(facts).toEqual({
      number: 5,
      url: 'https://github.com/xansde/donel-dev/pull/5',
      state: 'open',
      merged: false,
      mergedAt: null,
      baseRefName: 'feature/spec-009-modo-dev-v3',
      homologado: false,
      revertidoCiclo: false,
    });
  });

  it('lista vazia (nenhum PR pro head buscado): null, nunca lança', () => {
    expect(parsePullRequestList([])).toBeNull();
  });

  it('etiqueta homologado (payload sintético, shape real de labels): homologado=true', () => {
    const facts = parsePullRequest(loadFixture('pr-view-homologado-synthetic.json'));
    expect(facts?.homologado).toBe(true);
    expect(facts?.revertidoCiclo).toBe(false);
    expect(facts?.merged).toBe(true);
  });

  it('etiqueta revertido-ciclo (payload sintético): revertidoCiclo=true, PR não mergeado', () => {
    const facts = parsePullRequest(loadFixture('pr-view-revertido-synthetic.json'));
    expect(facts?.revertidoCiclo).toBe(true);
    expect(facts?.homologado).toBe(false);
    expect(facts?.merged).toBe(false);
  });

  it('merged=true também quando state="MERGED" sem mergedAt (defensivo — mergedAt é o sinal preferido, state é o de reserva)', () => {
    const facts = parsePullRequest({ number: 1, url: 'u', state: 'MERGED', labels: [] });
    expect(facts?.merged).toBe(true);
  });

  it('constantes de label batem com o contrato v3 §C (homologado / revertido-ciclo)', () => {
    expect(HOMOLOGADO_LABEL).toBe('homologado');
    expect(REVERTIDO_CICLO_LABEL).toBe('revertido-ciclo');
  });

  it('sem number: null', () => {
    expect(parsePullRequest({ url: 'u', state: 'OPEN' })).toBeNull();
  });

  it('não-objeto: null, nunca lança', () => {
    expect(parsePullRequest(null)).toBeNull();
    expect(parsePullRequest('texto')).toBeNull();
    expect(parsePullRequestList(null)).toBeNull();
    expect(parsePullRequestList('texto')).toBeNull();
  });
});

describe('extractSpecIssueRef (CA-5 — ponte disco → GitHub reader)', () => {
  it('outputs.spec_issue válido (shape do contrato §D.3, plano-result.json): extrai repo+number', () => {
    const outputs = {
      spec_issue: { repo: 'seazone-tech/spotsys', number: 88, id: 12345, node_id: 'I_kw...', url: 'https://github.com/seazone-tech/spotsys/issues/88' },
    };
    expect(extractSpecIssueRef(outputs)).toEqual({ repo: 'seazone-tech/spotsys', number: 88 });
  });

  it('outputs sem spec_issue (fase discovery, ou plano ainda não gravou): null', () => {
    expect(extractSpecIssueRef({})).toBeNull();
    expect(extractSpecIssueRef({ spec_path: 'specs/x/spec.md' })).toBeNull();
  });

  it('spec_issue com repo vazio ou number ausente: null, nunca fabrica ref parcial', () => {
    expect(extractSpecIssueRef({ spec_issue: { repo: '', number: 1 } })).toBeNull();
    expect(extractSpecIssueRef({ spec_issue: { repo: 'o/r' } })).toBeNull();
  });

  it('não-objeto: null, nunca lança', () => {
    expect(extractSpecIssueRef(null)).toBeNull();
    expect(extractSpecIssueRef(undefined)).toBeNull();
    expect(extractSpecIssueRef('texto')).toBeNull();
  });
});
