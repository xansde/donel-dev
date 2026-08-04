import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSUMED_PATHS, parseEsteiraResult } from '../src/shared/esteira/contract/resultContract';
import { PRODUCED_PATHS } from '../src/shared/esteira/contract/runInput';
import { createSchemaWalker, type JsonNode } from './helpers/contractSchemaPaths';

// Spec 010 (D-10) — TESTE DE CONTRATO, lado SKILL: o ESPELHO.
//
// O teste do lado app confronta schema × o que o app lê. Este confronta schema
// × o que a skill ESCREVE — e roda o emissor Python de verdade
// (`skills/esteira-donel-3.0.0/tools/esteira_contract.py`), não uma imitação
// dele em TypeScript. É o fecho do mecanismo: com os dois lados amarrados ao
// MESMO arquivo canônico, um campo não consegue mais existir de um lado só.
//
// Foi a falta exata disto que produziu o bug de 03/08: o app lia
// `outputs.plan_cards[]`, a skill 2.1.0 nunca gravava, e nenhum teste olhava
// os dois ao mesmo tempo.
//
// O fork mora DENTRO do donel-dev (decisão de 03/08), então ele lê o schema
// original — não há cópia para divergir, e por isso não há hash a conferir.
// Se um dia o fork sair daqui, o `sincronizar-contrato.ps1` e o hash voltam,
// como o passo zero desenhou.

const CONTRACT_DIR = fileURLToPath(new URL('../src/shared/esteira/contract/v1/', import.meta.url));
const SKILL_TOOLS_DIR = fileURLToPath(new URL('../skills/esteira-donel-3.0.0/tools/', import.meta.url));

const resultSchema = JSON.parse(readFileSync(`${CONTRACT_DIR}esteira-result.schema.json`, 'utf8')) as JsonNode;
const inputSchema = JSON.parse(readFileSync(`${CONTRACT_DIR}esteira-run-input.schema.json`, 'utf8')) as JsonNode;

const resultPaths = createSchemaWalker(resultSchema).schemaPaths;
const inputPaths = createSchemaWalker(inputSchema).schemaPaths;

/** Roda um trecho de Python com o emissor da skill importado e devolve o JSON impresso. */
function runPython(code: string): unknown {
  const output = execFileSync('python', ['-c', code], {
    encoding: 'utf8',
    cwd: SKILL_TOOLS_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  return JSON.parse(output);
}

const PRELUDE = "import sys, json; sys.path.insert(0, '.'); import esteira_contract as c\n";

function skillPaths(): { emitted: string[]; consumed: string[] } {
  return runPython(`${PRELUDE}print(json.dumps({"emitted": list(c.EMITTED_PATHS), "consumed": list(c.CONSUMED_PATHS)}))`) as {
    emitted: string[];
    consumed: string[];
  };
}

describe('espelho — schema x o que a skill ESCREVE', () => {
  it('todo campo do schema do result.json é escrito pela skill', () => {
    const emitted = new Set(skillPaths().emitted);
    expect([...resultPaths].filter((path) => !emitted.has(path)).sort()).toEqual([]);
  });

  it('todo campo que a skill escreve está declarado no schema', () => {
    expect(skillPaths().emitted.filter((path) => !resultPaths.has(path)).sort()).toEqual([]);
  });

  it('os dois lados leem/escrevem o MESMO conjunto — é isto que impede campo de um lado só', () => {
    // O que o app lê tem que ser exatamente o que a skill escreve.
    expect(skillPaths().emitted.slice().sort()).toEqual([...CONSUMED_PATHS].sort());
  });
});

describe('espelho — schema x o que a skill LÊ (a ida)', () => {
  it('todo campo do run-input.json é lido pela skill', () => {
    const consumed = new Set(skillPaths().consumed);
    expect([...inputPaths].filter((path) => !consumed.has(path)).sort()).toEqual([]);
  });

  it('o que a skill lê é exatamente o que o app grava', () => {
    expect(skillPaths().consumed.slice().sort()).toEqual([...PRODUCED_PATHS].sort());
  });
});

describe('espelho — o documento produzido pela skill passa no parser do app', () => {
  it('discovery concluído com plano', () => {
    const document = runPython(
      `${PRELUDE}` +
        `facts = [\n` +
        `  c.discovery_recorded('dsc-1', 'Fila trava sem sinal', problem='Lotes pendentes sem erro.', tracker={'provider':'taskdex','card_id':'card-1'}, target_repo='atlas', scope_repos=['atlas']),\n` +
        `  c.plan_recorded('pln-1', 'dsc-1', 'Tornar observavel', summary='Instrumentar antes de mexer.'),\n` +
        `  c.relation_recorded('originated', {'entity':'discovery','id':'dsc-1'}, {'entity':'plan','id':'pln-1'}),\n` +
        `  c.note_recorded({'entity':'discovery','id':'dsc-1'}, 'Duas hipoteses descartadas.'),\n` +
        `  c.phase_completed({'entity':'discovery','id':'dsc-1'}, 'discovery', 'done', summary='Um plano proposto.'),\n` +
        `]\n` +
        `print(json.dumps(c.build_result(run_id='run-1', phase='discovery', status='success', started_at='2026-08-04T12:00:00.000Z', finished_at='2026-08-04T12:30:00.000Z', discovery_id='dsc-1', facts=facts, workspace={'target_repo':'atlas','repo_path':'C:/code/atlas'})))`,
    );

    const parsed = parseEsteiraResult(document);
    if (!parsed.ok) throw new Error(`a skill produziu algo que o app recusa: ${JSON.stringify(parsed.issues, null, 2)}`);
    expect(parsed.result.facts).toHaveLength(5);
  });

  it('fase que falhou: o app aceita, e a falha vem legível', () => {
    const document = runPython(
      `${PRELUDE}` +
        `facts = [c.note_recorded({'entity':'work_item','id':'wi-1'}, 'Nada foi escrito no repo.'), c.lock_released({'entity':'work_item','id':'wi-1'}, 'implementar')]\n` +
        `print(json.dumps(c.build_result(run_id='run-2', phase='implementar', status='failed', started_at='2026-08-04T12:00:00.000Z', finished_at='2026-08-04T12:06:00.000Z', discovery_id='dsc-1', work_item_id='wi-1', facts=facts, failure={'code':'worktree-dirty','message':'Havia alteracoes nao commitadas.'})))`,
    );

    const parsed = parseEsteiraResult(document);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.run.failure?.code).toBe('worktree-dirty');
  });
});

describe('espelho — a skill recusa gravar o que o app recusaria ler', () => {
  function expectPythonError(code: string): string {
    try {
      execFileSync('python', ['-c', `${PRELUDE}${code}`], { encoding: 'utf8', cwd: SKILL_TOOLS_DIR, stdio: 'pipe' });
    } catch (error) {
      return String((error as { stderr?: string }).stderr ?? '');
    }
    throw new Error('esperava ContractError, e o emissor aceitou');
  }

  it('x-required-facts: fase discovery concluída sem discovery.recorded é recusada na emissão', () => {
    const stderr = expectPythonError(
      `c.build_result(run_id='run-3', phase='discovery', status='success', started_at='2026-08-04T12:00:00.000Z', finished_at='2026-08-04T12:30:00.000Z', discovery_id='dsc-1', facts=[c.phase_completed({'entity':'discovery','id':'dsc-1'}, 'discovery', 'done')])`,
    );
    expect(stderr).toContain('discovery.recorded');
  });

  it('run bem-sucedido sem phase.completed é recusado', () => {
    const stderr = expectPythonError(
      `c.build_result(run_id='run-4', phase='plano', status='success', started_at='2026-08-04T12:00:00.000Z', finished_at='2026-08-04T12:30:00.000Z', discovery_id='dsc-1', facts=[c.plan_recorded('pln-1','dsc-1','Plano')])`,
    );
    expect(stderr).toContain('phase.completed');
  });

  it('D-6: item do tipo issue sem repo alvo não é sequer emitido', () => {
    const stderr = expectPythonError(`c.work_item_recorded('wi-1', 'issue', 'Titulo')`);
    expect(stderr).toContain('target_repo');
  });

  it('status != success sem failure é recusado — "falhou, não sei por quê" não passa', () => {
    const stderr = expectPythonError(
      `c.build_result(run_id='run-5', phase='implementar', status='failed', started_at='2026-08-04T12:00:00.000Z', finished_at='2026-08-04T12:06:00.000Z', discovery_id='dsc-1', facts=[c.note_recorded({'entity':'discovery','id':'dsc-1'}, 'x')])`,
    );
    expect(stderr).toContain('failure');
  });

  // O padrão do contrato é `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`: ele ACEITA
  // underscore (o handoff da fase 1 dizia o contrário — este teste é quem
  // desmentiu). O que ele recusa é id que não começa por alfanumérico, com
  // espaço, ou vazio — coisas que quebrariam nome de arquivo e de branch.
  it('id que não começa por alfanumérico é recusado', () => {
    const stderr = expectPythonError(`c.discovery_recorded('-dsc-1', 'Titulo')`);
    expect(stderr).toContain('padrao de id');
  });

  it('id com espaço é recusado', () => {
    const stderr = expectPythonError(`c.discovery_recorded('dsc 1', 'Titulo')`);
    expect(stderr).toContain('padrao de id');
  });
});
