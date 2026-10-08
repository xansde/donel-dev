import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A12 — `scripts/esteira-check.mjs` roda o PARSER REAL (`parseEsteiraResultText`)
// contra um arquivo do disco. As regras cruzadas do parser (D-4: fase que
// declara o ciclo encerrado exige verificacao "passed") ja tem suite propria
// em `esteiraResultContract.test.ts` — o que este arquivo cobre e a superficie
// do COMANDO: stdout/stderr/exit code, exatamente o que
// `npm run esteira:check -- <arquivo>` expoe. Rodar como subprocesso (nao
// import direto) e proposital: e a unica forma de testar o exit code real e a
// compilacao TS-em-memoria que o script faz sozinho.

const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'esteira-check.mjs');
const EXAMPLES_DIR = join(__dirname, '..', 'docs', 'esteira-dev', 'contract', 'v1', 'examples');

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

interface CheckRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCheck(...args: string[]): Promise<CheckRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

let dir: string;

function mutateExample(name: string, label: string, mutator: (doc: any) => void): string {
  const source = JSON.parse(readFileSync(join(EXAMPLES_DIR, `${name}.json`), 'utf8'));
  mutator(source);
  const target = join(dir, `${name}-${label}-mutado.json`);
  writeFileSync(target, JSON.stringify(source, null, 2));
  return target;
}

// Cada spawn paga a compilacao TS-em-memoria do script (~350 ms). Os 15 casos
// sao independentes, entao os processos sobem JUNTOS no beforeAll e os `it`
// so leem o resultado — o tempo cai de soma para o do mais lento.
const runs = new Map<string, CheckRun>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'donel-esteira-check-'));

  const jobs = new Map<string, string[]>();
  for (const name of VALID_EXAMPLES) jobs.set(`valid:${name}`, [join(EXAMPLES_DIR, `${name}.json`)]);
  jobs.set('invalid:enum', [
    mutateExample('concluir-entrega-verificada', 'enum', (doc) => {
      doc.facts[0].state = 'pass';
    }),
  ]);
  jobs.set('invalid:d4', [
    mutateExample('concluir-entrega-verificada', 'd4', (doc) => {
      doc.facts = doc.facts.filter((fact: any) => fact.type !== 'verification.recorded');
    }),
  ]);
  jobs.set('invalid:run-alterado', [
    mutateExample('concluir-entrega-verificada', 'run-alterado', (doc) => {
      doc.run.duration_ms = 532000;
    }),
  ]);
  const malformed = join(dir, 'json-invalido.json');
  writeFileSync(malformed, '{ "contract_version": ');
  jobs.set('invalid:json', [malformed]);
  jobs.set('missing', [join(dir, 'nao-existe.json')]);
  jobs.set('usage', []);

  const entries = await Promise.all([...jobs].map(async ([key, args]) => [key, await runCheck(...args)] as const));
  for (const [key, run] of entries) runs.set(key, run);
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runOf(key: string): CheckRun {
  const run = runs.get(key);
  if (run === undefined) throw new Error(`run ${key} nao foi executado`);
  return run;
}

describe('esteira:check — caminho feliz (corpus)', () => {
  it.each(VALID_EXAMPLES)('aceita %s e sai com codigo 0, resumindo os fatos no stdout', (name) => {
    const { status, stdout, stderr } = runOf(`valid:${name}`);
    expect(status).toBe(0);
    expect(stdout).toContain('result valido');
    expect(stdout).toContain('contract_version:');
    expect(stdout).toContain('facts (');
    expect(stderr).toBe('');
  });
});

describe('esteira:check — result invalido', () => {
  it('recusa enum invalido (state fora do enum) com mensagem legivel', () => {
    const { status, stdout, stderr } = runOf('invalid:enum');

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('result invalido');
    expect(stderr).toContain('[not_in_enum]');
    expect(stderr).toContain('facts[0].state');
  });

  it('recusa fase "concluir" com outcome "done" sem verificacao passed (D-4)', () => {
    const { status, stderr } = runOf('invalid:d4');

    expect(status).toBe(1);
    expect(stderr).toContain('[done_without_passed_verification]');
  });

  it('recusa run alterado (campo desconhecido dentro de "run")', () => {
    const { status, stderr } = runOf('invalid:run-alterado');

    expect(status).toBe(1);
    expect(stderr).toContain('[unknown_field]');
    expect(stderr).toContain('run.duration_ms');
  });

  it('JSON malformado vira issue legivel, nunca uma excecao crua', () => {
    const { status, stderr } = runOf('invalid:json');

    expect(status).toBe(1);
    expect(stderr).toContain('[invalid_json]');
  });
});

describe('esteira:check — arquivo inexistente', () => {
  it('sai com codigo 1 e mensagem legivel, sem stack trace', () => {
    const { status, stdout, stderr } = runOf('missing');

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('arquivo nao encontrado');
    expect(stderr).not.toContain('    at ');
  });
});

describe('esteira:check — uso', () => {
  it('sem argumento imprime a forma de uso e sai com codigo 1', () => {
    const { status, stderr } = runOf('usage');

    expect(status).toBe(1);
    expect(stderr).toContain('Uso:');
  });
});
