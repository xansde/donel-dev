import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  declaredFactsFromRawText,
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
      // A18 — discovery concluida fecha com o que alguem disse. Sem isto o
      // documento nao passa, e e para nao passar mesmo: fase que nao perguntou
      // nada nao fecha.
      {
        type: 'gate.confirmed',
        subject: { entity: 'discovery', id: 'dsc-1' },
        condition: 'o problema e esse mesmo',
        confirmed_by: 'dono do repo',
        confirmed_at: null,
      },
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
    expect(parsed.result.facts).toHaveLength(3);
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
    expect(parsed.issues[0].path).toBe('facts[3].type');
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

// Spec 010 (B7) — `x-required-facts` das fases restantes, cobrado no LADO APP.
//
// A tabela mora no schema e vale para os dois lados: a skill falha se nao
// gravar, o app falha se nao exigir. Sem a metade daqui, uma fase poderia
// prometer no schema e o app aceitar o documento calado — que e a mesma
// omissao de 03/08, so que combinada por escrito.
describe('parseEsteiraResult — o que cada fase promete declarar (D-4)', () => {
  function resultForPhase(phase: string, facts: unknown[], status = 'success'): Record<string, unknown> {
    const doc = validResult();
    const run = doc.run as Record<string, unknown>;
    run.phase = phase;
    run.status = status;
    if (status !== 'success') run.failure = { code: 'worktree-dirty', message: 'Havia alteracoes nao commitadas.' };
    doc.subject = { discovery_id: 'dsc-1', plan_id: 'pln-1', work_item_id: 'wi-1' };
    doc.facts = facts;
    return doc;
  }

  const completed = (phase: string, outcome = 'done'): Record<string, unknown> => ({
    type: 'phase.completed',
    subject: { entity: 'work_item', id: 'wi-1' },
    phase,
    outcome,
    summary: null,
  });

  const verification = (kind: string, state: string, ref: string | null = null): Record<string, unknown> => ({
    type: 'verification.recorded',
    subject: { entity: 'work_item', id: 'wi-1' },
    verification_kind: kind,
    state,
    ref,
  });

  const artifact = (): Record<string, unknown> => ({
    type: 'artifact.recorded',
    owner: { entity: 'work_item', id: 'wi-1' },
    artifact_kind: 'adr',
    location: 'repo',
    repo: 'atlas',
    path: 'docs/adr/0007-fila.md',
  });

  it('implementar sem verificacao declarada e recusado', () => {
    expect(codesOf(resultForPhase('implementar', [completed('implementar')]))).toContain('missing_required_fact');
  });

  it('implementar com o check que ela escreveu e aceito', () => {
    const doc = resultForPhase('implementar', [verification('check', 'passed', 'npm test'), completed('implementar')]);
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('validar sem verificacao declarada e recusado — rodar a verificacao E validar', () => {
    expect(codesOf(resultForPhase('validar', [completed('validar')]))).toContain('missing_required_fact');
  });

  it('documentar sem artefato apontado e recusado — documento sem endereco nao e documento', () => {
    expect(codesOf(resultForPhase('documentar', [completed('documentar')]))).toContain('missing_required_fact');
  });

  it('documentar com o ponteiro do documento e aceito', () => {
    expect(parseEsteiraResult(resultForPhase('documentar', [artifact(), completed('documentar')])).ok).toBe(true);
  });

  it('concluir sem verificacao declarada e recusado', () => {
    expect(codesOf(resultForPhase('concluir', [completed('concluir')]))).toContain('missing_required_fact');
  });

  it('concluir "done" com verificacao ainda pendente e recusado — concluido sem evidencia e afirmar o que nao se leu', () => {
    const doc = resultForPhase('concluir', [
      verification('pull-request', 'pending', 'https://github.com/exemplo/atlas/pull/128'),
      completed('concluir'),
    ]);
    expect(codesOf(doc)).toContain('done_without_passed_verification');
  });

  it('concluir "done" com verificacao que passou e aceito', () => {
    const doc = resultForPhase('concluir', [
      verification('pull-request', 'passed', 'https://github.com/exemplo/atlas/pull/128'),
      completed('concluir'),
    ]);
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('concluir ABANDONADO com verificacao que falhou e aceito — "nao deu certo" e desfecho', () => {
    const doc = resultForPhase('concluir', [
      verification('conclusion', 'failed', 'Caminho descartado: o provedor nao expoe o dado.'),
      completed('concluir', 'abandoned'),
    ]);
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('run que FALHOU nao e cobrado pela tabela — o que ela cobra e promessa cumprida, nao promessa feita', () => {
    const doc = resultForPhase('implementar', [{ type: 'note.recorded', subject: { entity: 'work_item', id: 'wi-1' }, text: 'Abortou.' }], 'failed');
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('fase que a tabela nao nomeia so precisa de phase.completed — `run.phase` continua livre (P-4)', () => {
    expect(parseEsteiraResult(resultForPhase('explorar', [completed('explorar')])).ok).toBe(true);
  });

  // A3 — a tabela passa a olhar o DESFECHO, nao so o `status`. O que se cobra e
  // o produto da fase, e fase que nao chegou ao produto nao tem produto para
  // mostrar: um run de implementar que parou num gate teve que declarar uma
  // verificacao `pending` so para caber no contrato. Declarar verificacao que
  // nao houve para escapar da regra e a inverdade de 03/08 pela porta do gate.
  describe('A3 — o que se cobra depende do desfecho', () => {
    it('implementar INCONCLUSIVO nao precisa declarar verificacao', () => {
      expect(parseEsteiraResult(resultForPhase('implementar', [completed('implementar', 'inconclusive')])).ok).toBe(true);
    });

    it('validar ABANDONADO nao precisa declarar verificacao', () => {
      expect(parseEsteiraResult(resultForPhase('validar', [completed('validar', 'abandoned')])).ok).toBe(true);
    });

    it('documentar INCONCLUSIVO nao precisa apontar artefato', () => {
      expect(parseEsteiraResult(resultForPhase('documentar', [completed('documentar', 'inconclusive')])).ok).toBe(true);
    });

    it('implementar CONCLUIDO continua exigindo a verificacao — o desfecho bom e o que tem produto', () => {
      expect(codesOf(resultForPhase('implementar', [completed('implementar')]))).toContain('missing_required_fact');
    });

    it('plano CONCLUIDO sem nenhum item declarado e recusado — plano que nao propoe nada nao e plano', () => {
      expect(codesOf(resultForPhase('plano', [completed('plano')]))).toContain('missing_required_fact');
    });

    it('plano CONCLUIDO com um item declarado e aceito', () => {
      const item = {
        type: 'work_item.recorded',
        work_item_id: 'wi-1',
        plan_id: 'pln-1',
        item_type: 'spike',
        title: 'Medir onde o lote para',
        target_repo: null,
        scope_repos: [],
      };
      // A decisao vem junto porque A18 tambem cobra o plano concluido.
      const decisao = {
        type: 'decision.recorded',
        subject: { entity: 'plan', id: 'pln-1' },
        decision: 'medir antes de mexer',
        confirmed_by: 'dono do repo',
        rationale: null,
      };
      expect(parseEsteiraResult(resultForPhase('plano', [item, decisao, completed('plano')])).ok).toBe(true);
    });

    it('plano ABANDONADO nao precisa de item — desistir de planejar e um desfecho', () => {
      expect(parseEsteiraResult(resultForPhase('plano', [completed('plano', 'abandoned')])).ok).toBe(true);
    });

    it('a discovery continua declarando a si mesma em QUALQUER desfecho — a entidade e o assunto do run', () => {
      const doc = resultForPhase('discovery', [
        { type: 'phase.completed', subject: { entity: 'discovery', id: 'dsc-1' }, phase: 'discovery', outcome: 'abandoned', summary: null },
      ]);
      expect(codesOf(doc)).toContain('missing_required_fact');
    });
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

// A5 — o CUSTO de um documento recusado: o que ELE declararia, se entrasse.
// Le o texto CRU porque o parser ja pode ter recusado o documento inteiro por
// causa de UM campo — a pergunta aqui e outra.
describe('declaredFactsFromRawText', () => {
  it('extrai discovery/plan/work_item pelo campo de identidade certo de cada um', () => {
    const doc = validResult();
    (doc.facts as unknown[]).push(
      { type: 'plan.recorded', plan_id: 'pln-1', discovery_id: 'dsc-1', title: 'Plano', summary: null },
      { type: 'work_item.recorded', work_item_id: 'wi-1', plan_id: 'pln-1', item_type: 'issue', title: 'Item', target_repo: 'x', scope_repos: [] },
    );

    const declared = declaredFactsFromRawText(JSON.stringify(doc));

    expect(declared).toContainEqual({ factType: 'discovery.recorded', entity: 'discovery', id: 'dsc-1', title: 'Titulo' });
    expect(declared).toContainEqual({ factType: 'plan.recorded', entity: 'plan', id: 'pln-1', title: 'Plano' });
    expect(declared).toContainEqual({ factType: 'work_item.recorded', entity: 'work_item', id: 'wi-1', title: 'Item' });
  });

  it('fato que nao cria entidade propria (relacao, gate...) aparece so com o factType', () => {
    const doc = validResult();
    const declared = declaredFactsFromRawText(JSON.stringify(doc));
    const gate = declared.find((fact) => fact.factType === 'gate.confirmed');
    expect(gate).toEqual({ factType: 'gate.confirmed', entity: null, id: null, title: null });
  });

  it('funciona mesmo quando o resto do documento e invalido — a pergunta nao e "isto passa?"', () => {
    // work_item_id teria que casar com ID_PATTERN para o PARSER aceitar, mas
    // esta funcao nao valida — so extrai o que esta escrito, best-effort.
    const declared = declaredFactsFromRawText(
      JSON.stringify({ facts: [{ type: 'work_item.recorded', work_item_id: 'wi um espaço não permitido', title: 'X' }] }),
    );
    expect(declared).toEqual([{ factType: 'work_item.recorded', entity: 'work_item', id: 'wi um espaço não permitido', title: 'X' }]);
  });

  it('JSON invalido devolve lista vazia, nunca lanca', () => {
    expect(declaredFactsFromRawText('{ nao json')).toEqual([]);
  });

  it('documento sem facts (ou facts que nao e array) devolve lista vazia', () => {
    expect(declaredFactsFromRawText('{}')).toEqual([]);
    expect(declaredFactsFromRawText('{"facts": "nao e lista"}')).toEqual([]);
  });

  it('fato sem o campo de identidade esperado devolve id null — nunca inventa', () => {
    const declared = declaredFactsFromRawText(JSON.stringify({ facts: [{ type: 'work_item.recorded', title: 'Sem id' }] }));
    expect(declared).toEqual([{ factType: 'work_item.recorded', entity: 'work_item', id: null, title: 'Sem id' }]);
  });

  it('entrada que nao e objeto (array no lugar de fato) e ignorada, nao derruba os demais', () => {
    const declared = declaredFactsFromRawText(JSON.stringify({ facts: [['nao', 'e', 'objeto'], { type: 'plan.recorded', plan_id: 'pln-1' }] }));
    expect(declared).toEqual([{ factType: 'plan.recorded', entity: 'plan', id: 'pln-1', title: null }]);
  });
});
