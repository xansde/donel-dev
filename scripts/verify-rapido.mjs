// `npm run verify:rapido` — the verify of the "Dev rápido" chair (t-7c942870, dono 19/11: "não precisa 50 minutos de
// teste. 2 minutos de teste pra todo seu código já é mais do que o suficiente").
//
// The full `npm run verify` takes ~1 min on an idle VPS (logs of 12–19/11: tsc ~15 s, vitest ~30 s, build ~15 s); the
// long waits came from the machine-wide queue (`~/.donel/verify.lock`), not from the suite. So this one:
//   - does not take `verify.lock` (the limitador hook still guards the machine);
//   - typechecks everything (cheap, and it catches what a related-only run misses);
//   - runs only the tests that reach what changed through imports (walked here: `vitest related` chokes on the
//     `?raw` import of the phone's page), the tests that name a changed file's path (the ones that read the source)
//     and the changed test files; a change to the test setup (package.json, vitest/ts config, lockfile) runs the
//     whole suite;
//   - builds (the smoke: the build caught the broken CSS of 05/11) only when the change touches what is built.
// It prints the time of each step and the total, and says so loudly above 120 s (it does not fail on time: a loaded
// machine is not a broken change).
//
// Base: `origin/staging` (or `DONEL_BASE`). Usage: `npm run verify:rapido`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

const BUDGET_S = 120;
const base = process.env.DONEL_BASE || 'origin/staging';
const started = Date.now();

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').map((line) => line.trim()).filter(Boolean);
}

function run(label, command, args) {
  const t0 = Date.now();
  const shown = `${command} ${args.join(' ')}`;
  console.log(`\n[verify:rapido] ${label}: ${shown.length > 160 ? `${shown.slice(0, 160)}…` : shown}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`[verify:rapido] ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (result.status !== 0) {
    console.log(`[verify:rapido] FALHOU em ${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    process.exit(result.status ?? 1);
  }
}

const mergeBase = git(['merge-base', base, 'HEAD'])[0];
const changed = [...new Set([...git(['diff', '--name-only', mergeBase]), ...git(['ls-files', '--others', '--exclude-standard'])])];
console.log(`[verify:rapido] base ${base} (${mergeBase.slice(0, 8)}); ${changed.length} arquivo(s) mudado(s)`);

const WHOLE_SUITE = /^(package(-lock)?\.json|vitest\.config\.|tsconfig[^/]*\.json|patches\/)/;
const BUILT = /^(src\/|design-system\/|electron\.vite\.config|oraculo\.vite\.config|board-cron\.vite\.config|package(-lock)?\.json)/;
const isTest = (file) => /^tests\/.*\.test\.(ts|mjs)$/.test(file);
const isCode = (file) => /\.(ts|tsx|mts|mjs|js|css|json)$/.test(file);

/** The test files that reach `sources` through relative imports (any depth) or name one of their paths. */
function testsReaching(sources) {
  const files = git(['ls-files', 'src', 'tests']).filter((file) => /\.(ts|tsx|mts|mjs|js)$/.test(file));
  const known = new Set(git(['ls-files']));
  for (const file of changed) if (existsSync(file)) known.add(file);
  const resolve = (from, spec) => {
    const bare = posix.join(posix.dirname(from), spec.split('?')[0]);
    for (const ext of ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx']) if (known.has(bare + ext)) return bare + ext;
    return null;
  };
  const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  const importers = new Map();
  const texts = new Map();
  for (const file of files) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    texts.set(file, text);
    for (const match of text.matchAll(SPEC)) {
      const target = resolve(file, match[1]);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  const reached = new Set(sources);
  const queue = [...sources];
  while (queue.length) for (const importer of importers.get(queue.shift()) ?? []) if (!reached.has(importer)) (reached.add(importer), queue.push(importer));
  const named = (text) => sources.some((source) => text.includes(source) || text.includes(source.replace(/\.[^.]+$/, '')));
  return files.filter((file) => isTest(file) && (reached.has(file) || named(texts.get(file) ?? '')));
}

run('design-system', 'npm', ['run', 'build', '-w', '@donel-dev/design-system', '--silent']);
run('tipos', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']);

if (changed.some((file) => WHOLE_SUITE.test(file))) {
  run('testes (suíte inteira: mudou a configuração dos testes)', 'npx', ['vitest', 'run']);
} else {
  const sources = changed.filter((file) => isCode(file) && !isTest(file) && existsSync(file));
  const tests = changed.filter((file) => isTest(file) && existsSync(file));
  const selected = [...new Set([...testsReaching(sources), ...tests])];
  if (selected.length === 0) console.log('\n[verify:rapido] testes: nenhum teste chega ao que mudou');
  else run(`testes do que mudou (${selected.length} arquivo(s))`, 'npx', ['vitest', 'run', ...selected]);
}

if (changed.some((file) => BUILT.test(file))) {
  run('build (smoke)', 'npx', ['electron-vite', 'build']);
  run('build do Oráculo', 'npx', ['vite', 'build', '-c', 'oraculo.vite.config.ts', '--logLevel', 'warn']);
  run('build do quadro', 'npx', ['vite', 'build', '-c', 'board-cron.vite.config.ts', '--logLevel', 'warn']);
} else console.log('\n[verify:rapido] build: nada do que é empacotado mudou');

const total = (Date.now() - started) / 1000;
console.log(`\n[verify:rapido] VERDE em ${total.toFixed(1)} s (teto ${BUDGET_S} s)`);
if (total > BUDGET_S) {
  console.log('[verify:rapido] PASSOU DO TETO: verde, mas acima de 2 min; diga no PR e procure o passo lento acima.');
}
