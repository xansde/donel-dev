// `npm run verify:rapido` — the verify of the "Dev rápido" chair (t-7c942870, dono 19/11: "não precisa 50 minutos de
// teste. 2 minutos de teste pra todo seu código já é mais do que o suficiente").
//
// The full `npm run verify` takes ~1 min on an idle VPS (logs of 12–19/11: tsc ~15 s, vitest ~30 s, build ~15 s); the
// long waits came from the machine-wide queue (`~/.donel/verify.lock`), not from the suite. So this one:
//   - does not take `verify.lock` (the limitador hook still guards the machine);
//   - typechecks everything (cheap, and it catches what a related-only run misses);
//   - runs only the tests related to what changed (`vitest related`) plus the changed test files themselves; a change
//     to the test setup (package.json, vitest/ts config, lockfile) runs the whole suite;
//   - builds (the smoke: the build caught the broken CSS of 05/11) only when the change touches what is built.
// It prints the time of each step and the total, and says so loudly above 120 s (it does not fail on time: a loaded
// machine is not a broken change).
//
// Base: `origin/staging` (or `DONEL_BASE`). Usage: `npm run verify:rapido`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BUDGET_S = 120;
const base = process.env.DONEL_BASE || 'origin/staging';
const started = Date.now();

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').map((line) => line.trim()).filter(Boolean);
}

function run(label, command, args) {
  const t0 = Date.now();
  console.log(`\n[verify:rapido] ${label}: ${command} ${args.join(' ')}`);
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

run('design-system', 'npm', ['run', 'build', '-w', '@donel-dev/design-system', '--silent']);
run('tipos', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']);

if (changed.some((file) => WHOLE_SUITE.test(file))) {
  run('testes (suíte inteira: mudou a configuração dos testes)', 'npx', ['vitest', 'run']);
} else {
  const sources = changed.filter((file) => isCode(file) && !isTest(file) && existsSync(file));
  const tests = changed.filter((file) => isTest(file) && existsSync(file));
  if (sources.length === 0 && tests.length === 0) console.log('\n[verify:rapido] testes: nada de código mudou');
  else {
    if (sources.length) run('testes ligados ao que mudou', 'npx', ['vitest', 'related', '--run', '--passWithNoTests', ...sources]);
    if (tests.length) run('testes mudados', 'npx', ['vitest', 'run', ...tests]);
  }
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
