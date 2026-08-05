import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// A12 — `scripts/esteira-check.mjs` roda o PARSER REAL (`parseEsteiraResultText`)
// contra um arquivo do disco. As regras cruzadas do parser (D-4: fase que
// declara o ciclo encerrado exige verificacao "passed") ja tem suite propria
// em `esteiraResultContract.test.ts` — o que este arquivo cobre e a superficie
// do COMANDO: stdout/stderr/exit code, exatamente o que
// `npm run esteira:check -- <arquivo>` expoe. Rodar como subprocesso (nao
// import direto) e proposital: e a unica forma de testar o exit code real e a
// compilacao TS-em-memoria que o script faz sozinho.

const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'esteira-check.mjs');
const EXAMPLES_DIR = join(__dirname, '..', 'src', 'shared', 'esteira', 'contract', 'v1', 'examples');

const VALID_EXAMPLES = [
  'concluir-entrega-verificada',
  'discovery-com-tracker',
  'discovery-sem-repo-nem-tracker',
  'documentar-adr',
  'implementar-falhou',
  'plano-com-itens',
  'spike-inconclusivo',
  'validar-com-pr',
];

function runCheck(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-esteira-check-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function mutateExample(name: string, mutator: (doc: any) => void): string {
  const source = JSON.parse(readFileSync(join(EXAMPLES_DIR, `${name}.json`), 'utf8'));
  mutator(source);
  const target = join(dir, `${name}-mutado.json`);
  writeFileSync(target, JSON.stringify(source, null, 2));
  return target;
}

describe('esteira:check — caminho feliz (corpus)', () => {
  it.each(VALID_EXAMPLES)('aceita %s e sai com codigo 0, resumindo os fatos no stdout', (name) => {
    const { status, stdout, stderr } = runCheck(join(EXAMPLES_DIR, `${name}.json`));
    expect(status).toBe(0);
    expect(stdout).toContain('result valido');
    expect(stdout).toContain('contract_version:');
    expect(stdout).toContain('facts (');
    expect(stderr).toBe('');
  });
});

describe('esteira:check — result invalido', () => {
  it('recusa enum invalido (state fora do enum) com mensagem legivel', () => {
    const path = mutateExample('concluir-entrega-verificada', (doc) => {
      doc.facts[0].state = 'pass';
    });

    const { status, stdout, stderr } = runCheck(path);

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('result invalido');
    expect(stderr).toContain('[not_in_enum]');
    expect(stderr).toContain('facts[0].state');
  });

  it('recusa fase "concluir" com outcome "done" sem verificacao passed (D-4)', () => {
    const path = mutateExample('concluir-entrega-verificada', (doc) => {
      doc.facts = doc.facts.filter((fact: any) => fact.type !== 'verification.recorded');
    });

    const { status, stderr } = runCheck(path);

    expect(status).toBe(1);
    expect(stderr).toContain('[done_without_passed_verification]');
  });

  it('recusa run alterado (campo desconhecido dentro de "run")', () => {
    const path = mutateExample('concluir-entrega-verificada', (doc) => {
      doc.run.duration_ms = 532000;
    });

    const { status, stderr } = runCheck(path);

    expect(status).toBe(1);
    expect(stderr).toContain('[unknown_field]');
    expect(stderr).toContain('run.duration_ms');
  });

  it('JSON malformado vira issue legivel, nunca uma excecao crua', () => {
    const target = join(dir, 'json-invalido.json');
    writeFileSync(target, '{ "contract_version": ');

    const { status, stderr } = runCheck(target);

    expect(status).toBe(1);
    expect(stderr).toContain('[invalid_json]');
  });
});

describe('esteira:check — arquivo inexistente', () => {
  it('sai com codigo 1 e mensagem legivel, sem stack trace', () => {
    const missing = join(dir, 'nao-existe.json');

    const { status, stdout, stderr } = runCheck(missing);

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('arquivo nao encontrado');
    expect(stderr).not.toContain('    at ');
  });
});

describe('esteira:check — uso', () => {
  it('sem argumento imprime a forma de uso e sai com codigo 1', () => {
    const { status, stderr } = runCheck();

    expect(status).toBe(1);
    expect(stderr).toContain('Uso:');
  });
});
