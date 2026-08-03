import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  parseEsteiraResult,
  parseEsteiraResultText,
  type ContractIssueCode,
} from '../src/shared/esteira/contract/resultContract';

// Spec 010 (D-10) — o lado APP do contrato. A regra de ouro testada aqui:
// nenhum desvio pode virar silencio. Documento fora do contrato SEMPRE devolve
// issue com codigo e caminho, para o card mostrar "erro de ingestao" em vez de
// "fase nao realizada" (a inverdade que originou a spec).

function validResult(): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    kind: 'esteira.result',
    run: {
      run_id: 'run-1',
      phase: 'discovery',
      status: 'success',
      started_at: '2026-08-03T12:00:00.000Z',
      finished_at: '2026-08-03T12:30:00.000Z',
      failure: null,
    },
    actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
    subject: { discovery_id: 'dsc-1', plan_id: null, work_item_id: null },
    workspace: null,
    facts: [
      { type: 'discovery.recorded', discovery_id: 'dsc-1', title: 'Titulo', problem: null, tracker: null, target_repo: null, scope_repos: [] },
      { type: 'phase.completed', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', summary: null },
    ],
  };
}

function codesOf(input: unknown): ContractIssueCode[] {
  const parsed = parseEsteiraResult(input);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.code);
}

describe('parseEsteiraResult — caminho feliz', () => {
  it('aceita um result completo e devolve os fatos tipados', () => {
    const parsed = parseEsteiraResult(validResult());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.run.phase).toBe('discovery');
    expect(parsed.result.facts).toHaveLength(2);
    expect(parsed.result.facts[0].type).toBe('discovery.recorded');
  });

  it('workspace ausente e valido — discovery pode nascer sem repo', () => {
    const doc = validResult();
    delete doc.workspace;
    const parsed = parseEsteiraResult(doc);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.result.workspace).toBeNull();
  });
});

describe('parseEsteiraResult — envelope', () => {
  it('recusa documento que nao e objeto', () => {
    expect(codesOf(['nao', 'e', 'objeto'])).toEqual(['not_an_object']);
    expect(codesOf(null)).toEqual(['not_an_object']);
  });

  it('recusa kind diferente de esteira.result', () => {
    const doc = { ...validResult(), kind: 'outra.coisa' };
    expect(codesOf(doc)).toContain('wrong_kind');
  });

  it('recusa major de contrato que o app nao implementa', () => {
    const doc = { ...validResult(), contract_version: '2.0.0' };
    expect(codesOf(doc)).toContain('unsupported_major');
  });

  it('aceita minor a frente dentro do mesmo major', () => {
    const doc = { ...validResult(), contract_version: '1.9.3' };
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('recusa campo desconhecido no envelope', () => {
    const doc = { ...validResult(), outputs: { plan_cards: [] } };
    const parsed = parseEsteiraResult(doc);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({ code: 'unknown_field', path: 'outputs', message: 'unknown field "outputs"' });
  });

  it('recusa timestamp fora de ISO-UTC', () => {
    const doc = validResult();
    (doc.run as Record<string, unknown>).started_at = '03/08/2026 12:00';
    expect(codesOf(doc)).toContain('bad_format');
  });
});

describe('parseEsteiraResult — desfecho legivel', () => {
  it('status failed sem failure e recusado', () => {
    const doc = validResult();
    (doc.run as Record<string, unknown>).status = 'failed';
    expect(codesOf(doc)).toContain('failure_missing');
  });

  it('status success com failure preenchido e recusado', () => {
    const doc = validResult();
    (doc.run as Record<string, unknown>).failure = { code: 'x', message: 'y' };
    expect(codesOf(doc)).toContain('failure_unexpected');
  });

  it('status failed com failure e aceito, sem exigir phase.completed', () => {
    const doc = validResult();
    (doc.run as Record<string, unknown>).status = 'aborted';
    (doc.run as Record<string, unknown>).failure = { code: 'interrupted', message: 'Sessao encerrada pelo usuario.' };
    doc.facts = [{ type: 'lock.released', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery' }];
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });
});

describe('parseEsteiraResult — fatos obrigatorios', () => {
  it('run bem-sucedido sem phase.completed e recusado', () => {
    const doc = validResult();
    doc.facts = [{ type: 'discovery.recorded', discovery_id: 'dsc-1', title: 'T', problem: null, tracker: null, target_repo: null, scope_repos: [] }];
    expect(codesOf(doc)).toContain('missing_required_fact');
  });

  it('discovery bem-sucedido sem discovery.recorded e recusado', () => {
    const doc = validResult();
    doc.facts = [{ type: 'phase.completed', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'done', summary: null }];
    expect(codesOf(doc)).toContain('missing_required_fact');
  });

  it('lista de fatos vazia e recusada', () => {
    const doc = { ...validResult(), facts: [] };
    expect(codesOf(doc)).toContain('empty_facts');
  });
});

describe('parseEsteiraResult — fatos', () => {
  it('recusa tipo de fato desconhecido, apontando o indice', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({ type: 'plan_cards.recorded' });
    const parsed = parseEsteiraResult(doc);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0].code).toBe('unknown_fact_type');
    expect(parsed.issues[0].path).toBe('facts[2].type');
  });

  it('recusa campo desconhecido DENTRO de um fato', () => {
    const doc = validResult();
    (doc.facts as Record<string, unknown>[])[0].marco_id = 'm-1';
    const parsed = parseEsteiraResult(doc);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((issue) => issue.code === 'unknown_field' && issue.path === 'facts[0].marco_id')).toBe(true);
  });

  it('issue sem target_repo e recusada — sem repo, nao dispara', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({
      type: 'work_item.recorded',
      work_item_id: 'wi-1',
      plan_id: null,
      item_type: 'issue',
      title: 'Alguma issue',
      target_repo: null,
      scope_repos: [],
    });
    expect(codesOf(doc)).toContain('issue_without_target_repo');
  });

  it('item que nao e issue pode nascer sem repo alvo', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({
      type: 'work_item.recorded',
      work_item_id: 'wi-1',
      plan_id: null,
      item_type: 'process-map',
      title: 'Como a triagem funciona hoje',
      target_repo: null,
      scope_repos: [],
    });
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('recusa item_type fora do enum de D-4 (teste/CI nao sao tipos)', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({
      type: 'work_item.recorded',
      work_item_id: 'wi-1',
      plan_id: null,
      item_type: 'test',
      title: 'Escrever teste',
      target_repo: 'atlas',
      scope_repos: [],
    });
    expect(codesOf(doc)).toContain('not_in_enum');
  });

  it('artifact em repo sem informar o repo e recusado', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({
      type: 'artifact.recorded',
      owner: { entity: 'discovery', id: 'dsc-1' },
      artifact_kind: 'spec',
      location: 'repo',
      repo: null,
      path: 'specs/x/spec.md',
    });
    expect(codesOf(doc)).toContain('artifact_repo_mismatch');
  });

  it('artifact em disco carregando repo e recusado', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({
      type: 'artifact.recorded',
      owner: { entity: 'discovery', id: 'dsc-1' },
      artifact_kind: 'prototype',
      location: 'disk',
      repo: 'atlas',
      path: 'C:/tmp/proto',
    });
    expect(codesOf(doc)).toContain('artifact_repo_mismatch');
  });

  it('relacao com entidade fora do enum e recusada', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push({
      type: 'relation.recorded',
      relation: 'originated',
      from: { entity: 'card', id: 'c-1' },
      to: { entity: 'plan', id: 'pln-1' },
    });
    expect(codesOf(doc)).toContain('not_in_enum');
  });

  it('aceita as tres relacoes de primeira classe', () => {
    for (const relation of ['originated', 'flows_into', 'ships_with']) {
      const doc = validResult();
      (doc.facts as unknown[]).push({
        type: 'relation.recorded',
        relation,
        from: { entity: 'discovery', id: 'dsc-1' },
        to: { entity: 'plan', id: 'pln-1' },
      });
      expect(parseEsteiraResult(doc).ok).toBe(true);
    }
  });
});

describe('parseEsteiraResultText', () => {
  it('JSON invalido vira issue, nunca excecao', () => {
    const parsed = parseEsteiraResultText('{ "contract_version": ');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0].code).toBe('invalid_json');
  });

  it('texto vazio vira issue', () => {
    expect(parseEsteiraResultText('').ok).toBe(false);
  });

  it('nunca lanca, seja qual for a entrada', () => {
    const inputs: unknown[] = [undefined, null, 0, '', [], {}, { facts: 'nao e lista' }, { run: 42 }, new Date()];
    for (const input of inputs) {
      expect(() => parseEsteiraResult(input)).not.toThrow();
    }
  });
});
