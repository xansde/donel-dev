import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSUMED_PATHS, FACT_TYPES, PHASES_REQUIRING_PASSED_VERIFICATION, REQUIRED_FACTS_ANY_SUCCESS, REQUIRED_FACTS_BY_PHASE, REQUIRED_FACTS_BY_PHASE_WHEN_DONE, parseEsteiraResultText } from '../src/shared/esteira/contract/resultContract';
import { createSchemaWalker, type JsonNode } from './helpers/contractSchemaPaths';
import { PRODUCED_PATHS, buildRunInput, parseRunInput, parseRunInputText } from '../src/shared/esteira/contract/runInput';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

describe('Cobertura do contrato de resultado (schema x parser x corpus)', () => {
  // Spec 010 (D-10) — TESTE DE CONTRATO, lado APP.
  //
  // Este e o mecanismo que impede um campo de existir de um so lado. O bug de
  // 03/08 (evidencia 1 da spec) foi exatamente isso: o app lia
  // `outputs.plan_cards[]`, campo que a skill 2.1.0 nunca gravou, e traduziu a
  // ausencia em "fase nao realizada". Nenhum dos dois lados estava errado
  // sozinho — o que faltava era um lugar onde os dois fossem confrontados.
  //
  // Sao tres amarras sobre o MESMO arquivo canonico
  // (`docs/esteira-dev/contract/v1/esteira-result.schema.json`):
  //
  //   1. schema x parser  — o conjunto de campos declarados no schema e o
  //      conjunto que o app promete ler (CONSUMED_PATHS) tem que ser IGUAL.
  //      Campo lido e nao declarado reprova; campo declarado e nao lido tambem.
  //   2. schema x corpus  — todo campo declarado aparece com valor NAO-NULO em
  //      pelo menos um exemplo do golden corpus. Campo que ninguem nunca
  //      preencheu e campo que ninguem nunca vai gravar.
  //   3. corpus x parser  — todo exemplo do corpus e aceito pelo parser.
  //
  // O lado da skill (fork `esteira-donel-3.0.0`) roda o espelho disto: le o mesmo
  // schema, valida o que grava contra ele, e confronta os campos que ESCREVE com
  // os campos declarados. O corpus e o mesmo arquivo, copiado com hash conferido.
  // Desenho completo em `specs/010-esteira-donel/passo-zero.md`.

  const CONTRACT_DIR = fileURLToPath(new URL('../docs/esteira-dev/contract/v1/', import.meta.url));
  const SCHEMA_PATH = `${CONTRACT_DIR}esteira-result.schema.json`;
  const EXAMPLES_DIR = `${CONTRACT_DIR}examples/`;

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonNode;

  // O walker mora em `tests/helpers/contractSchemaPaths.ts` desde que a IDA
  // (`run-input.json`) ganhou o mesmo teste: uma copia por contrato seriam duas
  // chances de o mecanismo divergir do que ele protege.
  const { schemaPaths, collectValuePaths } = createSchemaWalker(schema);

  const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.json'));
  const examples = exampleFiles.map((name) => ({ name, text: readFileSync(`${EXAMPLES_DIR}${name}`, 'utf8') }));

  describe('contrato result.json — schema x parser', () => {
    it('o schema declara pelo menos o envelope e os fatos (guarda contra walker quebrado)', () => {
      expect(schemaPaths.size).toBeGreaterThan(50);
      expect(schemaPaths.has('run.status')).toBe(true);
      expect(schemaPaths.has('facts[work_item.recorded].item_type')).toBe(true);
    });

    it('todo campo declarado no schema e lido pelo app', () => {
      const consumed = new Set(CONSUMED_PATHS);
      const declaredButNotConsumed = [...schemaPaths].filter((path) => !consumed.has(path)).sort();
      expect(declaredButNotConsumed).toEqual([]);
    });

    it('todo campo lido pelo app esta declarado no schema', () => {
      const consumedButNotDeclared = CONSUMED_PATHS.filter((path) => !schemaPaths.has(path)).sort();
      expect(consumedButNotDeclared).toEqual([]);
    });

    it('CONSUMED_PATHS nao tem duplicata', () => {
      expect(new Set(CONSUMED_PATHS).size).toBe(CONSUMED_PATHS.length);
    });
  });

  // Spec 010 (B7) — a quarta amarra: `x-required-facts` e DADO COMPARTILHADO.
  //
  // A tabela do schema diz o que cada fase promete gravar. A skill le o arquivo
  // direto (Python); o app carrega uma copia LITERAL, pelo mesmo motivo de
  // `CONSUMED_PATHS` — o parser e puro e nao le disco. Este teste e o que impede
  // as duas de se afastarem: promessa que so um lado conhece e exatamente o
  // desencontro que a spec 010 existe para acabar.
  describe('contrato result.json — x-required-facts dos dois lados', () => {
    const table = schema['x-required-facts'] as {
      'any-phase-success': string[];
      'by-phase': Record<string, string[]>;
      'by-phase-when-done': Record<string, string[]>;
      'done-requires-passed-verification': string[];
    };

    it('a tabela do PRODUTO nomeia as fases do ciclo completo', () => {
      expect(Object.keys(table['by-phase-when-done']).sort()).toEqual([
        'concluir',
        'documentar',
        'implementar',
        'plano',
        'validar',
      ]);
    });

    it('o que o app exige em todo run bem-sucedido e o que o schema promete', () => {
      expect([...REQUIRED_FACTS_ANY_SUCCESS].sort()).toEqual([...table['any-phase-success']].sort());
    });

    it('o que o app exige POR FASE, em qualquer desfecho, e exatamente a tabela do schema', () => {
      const fromApp = Object.fromEntries(Object.entries(REQUIRED_FACTS_BY_PHASE).map(([phase, facts]) => [phase, [...facts].sort()]));
      const fromSchema = Object.fromEntries(Object.entries(table['by-phase']).map(([phase, facts]) => [phase, [...facts].sort()]));
      expect(fromApp).toEqual(fromSchema);
    });

    // A3 — a tabela do produto e a que olha o desfecho. Ela precisa vir do schema
    // pelo mesmo motivo das outras: promessa que so um lado conhece e o
    // desencontro que a spec 010 existe para acabar.
    it('o que o app exige de quem declara CONCLUIDO e exatamente a tabela do schema', () => {
      const fromApp = Object.fromEntries(
        Object.entries(REQUIRED_FACTS_BY_PHASE_WHEN_DONE).map(([phase, facts]) => [phase, [...facts].sort()]),
      );
      const fromSchema = Object.fromEntries(Object.entries(table['by-phase-when-done']).map(([phase, facts]) => [phase, [...facts].sort()]));
      expect(fromApp).toEqual(fromSchema);
    });

    it('nenhuma fase e cobrada nas duas tabelas — o mesmo fato exigido duas vezes vira mensagem duplicada', () => {
      const emAmbas = Object.keys(table['by-phase']).filter((phase) => phase in table['by-phase-when-done']);
      expect(emAmbas).toEqual([]);
    });

    it('a regra do desfecho verificado tambem vem da tabela, nao do codigo', () => {
      expect([...PHASES_REQUIRING_PASSED_VERIFICATION].sort()).toEqual([...table['done-requires-passed-verification']].sort());
    });

    it('todo fato exigido pela tabela existe como tipo de fato', () => {
      const required = new Set([
        ...table['any-phase-success'],
        ...Object.values(table['by-phase']).flat(),
        ...Object.values(table['by-phase-when-done']).flat(),
      ]);
      expect([...required].filter((type) => !(FACT_TYPES as readonly string[]).includes(type))).toEqual([]);
    });
  });

  describe('contrato result.json — schema x golden corpus', () => {
    it('o corpus existe', () => {
      expect(examples.length).toBeGreaterThan(0);
    });

    it('todo campo declarado aparece com valor nao-nulo em algum exemplo', () => {
      const covered = new Set<string>();
      for (const example of examples) {
        collectValuePaths(JSON.parse(example.text) as JsonNode, '', covered);
      }
      const uncovered = [...schemaPaths].filter((path) => !covered.has(path)).sort();
      expect(uncovered).toEqual([]);
    });

    it('todo tipo de fato aparece em algum exemplo', () => {
      const seen = new Set<string>();
      for (const example of examples) {
        const doc = JSON.parse(example.text) as { facts: { type: string }[] };
        for (const fact of doc.facts) seen.add(fact.type);
      }
      const missing = FACT_TYPES.filter((type) => !seen.has(type)).sort();
      expect(missing).toEqual([]);
    });
  });

  describe('contrato result.json — corpus x parser', () => {
    it.each(exampleFiles)('%s e aceito pelo parser', (name) => {
      const example = examples.find((entry) => entry.name === name);
      const parsed = parseEsteiraResultText(example!.text);
      if (!parsed.ok) {
        throw new Error(`${name} recusado: ${JSON.stringify(parsed.issues, null, 2)}`);
      }
      expect(parsed.ok).toBe(true);
    });
  });
});

describe('Contrato do run-input (schema x produtor x parser)', () => {
  // Spec 010 (D-10) — TESTE DE CONTRATO da IDA (`run-input.json`), lado APP.
  //
  // Espelho do teste do `result.json`, com os papeis TROCADOS: aqui o app e quem
  // PRODUZ, entao a lista que ele publica e `PRODUCED_PATHS`. As amarras:
  //
  //   1. schema x produtor — o conjunto declarado no schema e o conjunto que o
  //      app promete gravar tem que ser IGUAL, nas duas direcoes.
  //   2. schema x corpus   — todo campo declarado aparece com valor NAO-NULO em
  //      pelo menos um exemplo.
  //   3. corpus x parser   — todo exemplo e aceito pelo validador (que e o
  //      espelho do que a skill fara ao receber o arquivo).
  //   4. produtor x parser — o ciclo FECHADO: o que `buildRunInput` monta a
  //      partir de um store real passa pelo parser. E o unico teste que prova que
  //      as duas metades falam a mesma lingua antes de o fork existir.

  const CONTRACT_DIR = fileURLToPath(new URL('../docs/esteira-dev/contract/v1/', import.meta.url));
  const SCHEMA_PATH = `${CONTRACT_DIR}esteira-run-input.schema.json`;
  const EXAMPLES_DIR = `${CONTRACT_DIR}input-examples/`;

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonNode;
  const { schemaPaths, collectValuePaths } = createSchemaWalker(schema);

  const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.json'));
  const examples = exampleFiles.map((name) => ({ name, text: readFileSync(`${EXAMPLES_DIR}${name}`, 'utf8') }));

  describe('contrato run-input.json — schema x produtor', () => {
    it('o schema declara o envelope inteiro (guarda contra walker quebrado)', () => {
      expect(schemaPaths.size).toBeGreaterThan(25);
      expect(schemaPaths.has('outbox.result_path')).toBe(true);
      expect(schemaPaths.has('context.work_item.item_type')).toBe(true);
    });

    it('todo campo declarado no schema e gravado pelo app', () => {
      const produced = new Set(PRODUCED_PATHS);
      expect([...schemaPaths].filter((path) => !produced.has(path)).sort()).toEqual([]);
    });

    it('todo campo gravado pelo app esta declarado no schema', () => {
      expect(PRODUCED_PATHS.filter((path) => !schemaPaths.has(path)).sort()).toEqual([]);
    });

    it('PRODUCED_PATHS nao tem duplicata', () => {
      expect(new Set(PRODUCED_PATHS).size).toBe(PRODUCED_PATHS.length);
    });
  });

  describe('contrato run-input.json — schema x corpus', () => {
    it('o corpus existe', () => {
      expect(examples.length).toBeGreaterThan(0);
    });

    it('todo campo declarado aparece com valor nao-nulo em algum exemplo', () => {
      const covered = new Set<string>();
      for (const example of examples) collectValuePaths(JSON.parse(example.text) as JsonNode, '', covered);
      expect([...schemaPaths].filter((path) => !covered.has(path)).sort()).toEqual([]);
    });
  });

  describe('contrato run-input.json — corpus x parser', () => {
    it.each(exampleFiles)('%s e aceito pelo parser', (name) => {
      const parsed = parseRunInputText(examples.find((entry) => entry.name === name)!.text);
      if (!parsed.ok) throw new Error(`${name} recusado: ${JSON.stringify(parsed.issues, null, 2)}`);
      expect(parsed.ok).toBe(true);
    });
  });

  describe('parseRunInput — o mesmo rigor da volta', () => {
    const valid = () => JSON.parse(examples.find((entry) => entry.name.startsWith('plano'))!.text) as Record<string, unknown>;

    it('campo desconhecido e ERRO — e assim que "campo de um lado so" aparece na hora', () => {
      const doc = valid();
      (doc.run as Record<string, unknown>).prioridade = 'alta';
      const parsed = parseRunInput(doc);

      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.issues.some((issue) => issue.code === 'unknown_field' && issue.path === 'run.prioridade')).toBe(true);
    });

    it('major desconhecido e recusado, nunca adivinhado', () => {
      const doc = { ...valid(), contract_version: '2.0.0' };
      const parsed = parseRunInput(doc);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.some((issue) => issue.code === 'unsupported_major')).toBe(true);
    });

    it('kind errado e recusado — arquivo alheio na pasta nao vira disparo', () => {
      const parsed = parseRunInput({ ...valid(), kind: 'esteira.result' });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.some((issue) => issue.code === 'wrong_kind')).toBe(true);
    });

    it('sem outbox nao ha para onde devolver: recusa', () => {
      const doc = valid();
      delete doc.outbox;
      const parsed = parseRunInput(doc);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.some((issue) => issue.path === 'outbox')).toBe(true);
    });

    it('item do tipo issue sem repo alvo NAO dispara (D-6)', () => {
      const doc = JSON.parse(examples.find((entry) => entry.name.startsWith('implementar'))!.text) as Record<string, unknown>;
      doc.workspace = null;
      const parsed = parseRunInput(doc);

      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.some((issue) => issue.code === 'issue_without_target_repo')).toBe(true);
    });

    it('JSON quebrado vira issue, nunca excecao', () => {
      expect(() => parseRunInputText('{ nao json')).not.toThrow();
      expect(parseRunInputText('{ nao json').ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // O ciclo fechado: store → buildRunInput → parseRunInput
  // ---------------------------------------------------------------------------

  let seq = 0;
  function evt(type: string, payload: Record<string, unknown>): StoreEvent {
    seq += 1;
    return { seq, event_id: `evt-${seq}`, at: '2026-08-03T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
  }

  function storeWithCard() {
    return reduceEvents([
      evt('discovery.created', {
        id: 'dsc-1',
        title: 'Fila trava sem sinal',
        problem: 'Lotes grandes ficam pendentes sem erro.',
        tracker: { provider: 'taskdex', cardId: 'card-4711' },
        targetRepo: 'atlas',
        scopeRepos: ['atlas', 'beacon'],
        createdAt: '2026-08-03T12:00:00.000Z',
      }),
      evt('phase.completed', {
        subject: { entity: 'discovery', id: 'dsc-1' },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano proposto.',
        at: '2026-08-03T12:41:07.000Z',
        runId: 'run-1',
      }),
      evt('note.added', { subject: { entity: 'discovery', id: 'dsc-1' }, text: 'Duas hipoteses descartadas.', at: '2026-08-03T12:41:07.000Z' }),
      evt('plan.created', { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar a fila observavel', summary: 'Instrumentar antes de mexer.' }),
      evt('work_item.created', {
        id: 'wi-1',
        discoveryId: 'dsc-1',
        planId: 'pln-1',
        itemType: 'issue',
        title: 'Expor estado da fila',
        targetRepo: 'atlas',
        scopeRepos: [],
        state: 'open',
        createdBySkill: true,
        createdAt: '2026-08-03T17:38:12.000Z',
      }),
      evt('phase.failed', {
        subject: { entity: 'work_item', id: 'wi-1' },
        phase: 'implementar',
        failure: { code: 'worktree-dirty', message: 'Worktree tinha alteracoes nao commitadas.' },
        at: '2026-08-04T11:06:31.000Z',
        runId: 'run-2',
      }),
    ]);
  }

  describe('buildRunInput — o que o app entrega', () => {
    const base = {
      runId: 'run-2026-08-04-1130',
      phase: 'implementar',
      requestedAt: '2026-08-04T14:30:00.000Z',
      discoveryId: 'dsc-1',
      resultPath: 'C:/Users/dev/.claude/esteira-donel/outbox/run-2026-08-04-1130.json',
    };

    it('o documento produzido passa pelo parser — as duas metades falam a mesma lingua', () => {
      const built = buildRunInput(storeWithCard(), {
        ...base,
        planId: 'pln-1',
        workItemId: 'wi-1',
        workspace: { target_repo: 'atlas', repo_path: 'C:/code/atlas', worktree_path: null, branch: 'feat/fila' },
      });

      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const parsed = parseRunInput(JSON.parse(JSON.stringify(built.input)));
      if (!parsed.ok) throw new Error(`produzido e recusado pelo parser: ${JSON.stringify(parsed.issues, null, 2)}`);
      expect(parsed.ok).toBe(true);
    });

    it('leva o historico do card, inclusive a tentativa que FALHOU', () => {
      const built = buildRunInput(storeWithCard(), {
        ...base,
        planId: 'pln-1',
        workItemId: 'wi-1',
        workspace: { target_repo: 'atlas', repo_path: null, worktree_path: null, branch: null },
      });

      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const history = built.input.context.history;
      expect(history.find((entry) => entry.phase === 'discovery')?.outcome).toBe('done');
      // A tentativa falha vai junto: sem ela, a skill repetiria o mesmo erro
      // achando que e a primeira vez.
      expect(history.find((entry) => entry.phase === 'implementar')?.failure?.code).toBe('worktree-dirty');
      expect(built.input.context.notes).toHaveLength(1);
    });

    it('a macro etapa vai CALCULADA pelo app (D-13), nunca em branco', () => {
      const built = buildRunInput(storeWithCard(), { ...base, phase: 'plano', planId: 'pln-1' });
      // `execution`, nao `planned`: este card tem uma fase `implementar` que foi
      // disparada sobre o item e FALHOU. "Planejado" significa "plano existe,
      // nenhum item comecou" — dize-lo aqui seria afirmar que ninguem tocou num
      // trabalho que o proprio card mostra tendo falhado. Falhar nao e nao ter
      // comecado (achado do roteiro `ciclo-completo-de-item`, 04/08/2026).
      expect(built.ok && built.input.context.derived_stage).toBe('execution');
    });

    it('item do tipo issue sem alvo NAO dispara — nada de cair no projeto em foco', () => {
      const built = buildRunInput(storeWithCard(), { ...base, planId: 'pln-1', workItemId: 'wi-1', workspace: null });

      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.issues[0].code).toBe('issue_without_target_repo');
    });

    it('assunto que nao esta no store nao vira disparo com contexto pela metade', () => {
      const built = buildRunInput(storeWithCard(), { ...base, discoveryId: 'dsc-inexistente' });
      expect(built.ok).toBe(false);
      if (!built.ok) expect(built.issues[0].path).toBe('subject.discovery_id');
    });

    it('discovery sozinho (sem plano, sem item, sem repo) e um disparo legitimo', () => {
      const built = buildRunInput(storeWithCard(), { ...base, phase: 'discovery' });

      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.input.workspace).toBeNull();
      expect(built.input.context.plan).toBeNull();
      expect(built.input.context.work_item).toBeNull();
      expect(parseRunInput(JSON.parse(JSON.stringify(built.input))).ok).toBe(true);
    });
  });
});
