import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Onda 1, item `wi-esteira4-pacote-portatil` — a INVERSAO da fonte do
// contrato: o schema passa a morar em `docs/esteira-dev/contract/v1/`, e o
// app le de la (nunca o contrario). O defeito que isto fecha e o D-3 da spec
// 010: duas copias do mesmo contrato coexistindo "por compatibilidade" foi
// exatamente o que produziu o desencontro de campo entre app e skill em
// 03/08.
//
// Este teste NASCE ANTES da inversao (TDD): a primeira rodada dele falha
// porque o schema ainda esta em `src/shared/esteira/contract/v1/`. Depois do
// `git mv`, ele vira a rede que impede a copia de voltar — em qualquer PR
// futuro, um `esteira-result.schema.json` (ou `esteira-run-input.schema.json`)
// fora de `docs/esteira-dev/contract/v1/` reprova a suite na hora, em vez de
// esperar alguem notar a olho.

const REPO_ROOT = join(__dirname, '..');
const EXPECTED_DIR = join(REPO_ROOT, 'docs', 'esteira-dev', 'contract', 'v1');

// Diretorios que nunca guardam fonte: build, dependencia, cache. Pular estes
// evita I/O caro por nada — `node_modules` aqui e uma junction para a
// instalacao do repo principal (ver CLAUDE.md do repo), e varre-la inteira
// seria lento de verdade sem nunca achar o alvo.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  '.vite',
  'coverage',
  'test-results',
  '__pycache__',
  '.tutorial-shots',
  '.e2e-visual',
]);

function findFilesNamed(root: string, targetName: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (entry === targetName) {
        found.push(full);
      }
    }
  }
  return found;
}

describe('pacote portatil — o contrato mora em UM lugar so', () => {
  it('esteira-result.schema.json existe em exatamente um lugar: docs/esteira-dev/contract/v1/', () => {
    const hits = findFilesNamed(REPO_ROOT, 'esteira-result.schema.json');
    expect(hits).toEqual([join(EXPECTED_DIR, 'esteira-result.schema.json')]);
  });

  it('esteira-run-input.schema.json existe em exatamente um lugar: docs/esteira-dev/contract/v1/', () => {
    const hits = findFilesNamed(REPO_ROOT, 'esteira-run-input.schema.json');
    expect(hits).toEqual([join(EXPECTED_DIR, 'esteira-run-input.schema.json')]);
  });
});
