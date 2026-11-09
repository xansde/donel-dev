// F3 do plano `docs/planos/ledger-bom.md`: importa um ledger.json v4 para o diário do livro, só lendo, e confere
// que a projeção devolve as mesmas tarefas, uma a uma. Grava só numa pasta temporária nova (apagada no fim, salvo
// `--manter`); o arquivo de entrada é só lido, e o script mostra o sha256 dele antes e depois.
//
//   npx vite-node scripts/livro-importar-v4.ts -- <ledger.json> [--manter]
//
// Use sempre uma CÓPIA do ledger do dono (ex.: ~/seazone/_scratch/ledger-copia-2026-11-07.json).

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, readJournal, serializeJournal } from '../src/shared/livro/formato';
import { compareLedgers, importV4Journal } from '../src/shared/livro/importar-v4';
import { projectJournal } from '../src/shared/livro/projecao';
import { isNewerLedger, parseLedgerDoc } from '../src/shared/ledger/contract';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const input = args.find((arg) => !arg.startsWith('--'));
const keep = args.includes('--manter');
if (!input) {
  console.error('uso: npx vite-node scripts/livro-importar-v4.ts -- <ledger.json> [--manter]');
  process.exit(2);
}

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = sha(input);
const raw = JSON.parse(readFileSync(input, 'utf8')) as { tasks?: Record<string, unknown> };
if (isNewerLedger(raw)) {
  console.error('o ledger é de uma versão mais nova que a v4: não importo.');
  process.exit(2);
}
const original = parseLedgerDoc(raw);
const rawTasks = Object.keys(raw.tasks ?? {}).length;
const total = Object.keys(original.tasks).length;

const dir = mkdtempSync(join(tmpdir(), 'livro-v4-'));
const file = join(dir, 'lancamentos.jsonl');
try {
  writeFileSync(file, serializeJournal(importV4Journal(original)));
  const read = readJournal(readFileSync(file, 'utf8'));
  const projection = projectJournal(read.lines);
  const refused = projection.steps.filter((step) => step.status !== 'aplicado');
  const differences = compareLedgers(original, projection.doc);
  // Stricter: the projected task against the task as it is in the file, byte for byte in canonical JSON.
  const rawDifferences = Object.entries(raw.tasks ?? {})
    .filter(([id, task]) => !projection.doc.tasks[id] || canonicalJson({ id, ...(task as object) }) !== canonicalJson(projection.doc.tasks[id]))
    .map(([id]) => id);
  const equal = Object.keys(original.tasks).filter((id) => !differences.some((difference) => difference.task === id)).length;

  console.log(`ledger lido:          ${input}`);
  console.log(`tarefas no arquivo:   ${rawTasks} (lidas pelo parse v4: ${total})`);
  console.log(`eventos → lançamentos: ${read.lines.length}`);
  console.log(`diário (temporário):  ${file}`);
  console.log(`conferência do diário: ${read.problems.length} problema(s)`);
  for (const problem of read.problems) console.log(`  seq ${problem.seq}: ${problem.reason}`);
  console.log(`lançamentos não aplicados: ${refused.length}`);
  for (const step of refused) console.log(`  seq ${step.seq}: ${step.status} — ${step.reason ?? ''}`);
  console.log(`tarefas iguais:       ${equal}/${total}`);
  console.log(`diferenças:           ${JSON.stringify(differences)}`);
  console.log(`diferenças contra o arquivo cru: ${JSON.stringify(rawDifferences)}`);
  const after = sha(input);
  console.log(`sha256 do ledger antes:  ${before}`);
  console.log(`sha256 do ledger depois: ${after} (${after === before ? 'igual' : 'MUDOU'})`);
  process.exitCode = read.problems.length || refused.length || differences.length || rawDifferences.length || after !== before ? 1 : 0;
} finally {
  if (keep) console.log(`pasta mantida: ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
