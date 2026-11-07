// `npm run verify` sob a trava da máquina (t-b3b26e60). Dono/Líder, 07/11: a VPS pessoal entrou em thrashing com
// vários verify/build ao mesmo tempo; regra: um verify por vez por máquina.
//
// A trava é `flock` em `~/.donel/verify.lock`, o mesmo arquivo e o mesmo formato que as sessões já usam à mão
// (`flock ~/.donel/verify.lock npm run verify`): quem chama assim já segura a trava, e este script não a pede de
// novo (pedir de novo travaria para sempre, porque o flock de fora não solta enquanto este roda). Sem `flock`
// (Windows, macOS) o verify roda direto, como antes.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STEPS = 'npm run typecheck && npm test && npm run build';
const LOCK = join(homedir(), '.donel', 'verify.lock');

/** Some ancestor is `flock … verify.lock …`: the lock is already held for this verify. */
function underOuterLock() {
  let pid = process.ppid;
  for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      if (cmdline.some((part) => /(^|\/)flock$/.test(part)) && cmdline.some((part) => part.endsWith('verify.lock'))) return true;
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      pid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    } catch {
      return false;
    }
  }
  return false;
}

function hasFlock() {
  return process.platform !== 'win32' && spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;
}

let result;
if (hasFlock() && !underOuterLock()) {
  mkdirSync(join(homedir(), '.donel'), { recursive: true });
  if (spawnSync('flock', ['-n', LOCK, 'true'], { stdio: 'ignore' }).status !== 0) {
    console.log(`[verify] outro verify roda nesta máquina; esperando a vez (${LOCK})…`);
  }
  result = spawnSync('flock', [LOCK, 'sh', '-c', STEPS], { stdio: 'inherit' });
} else {
  result = spawnSync(STEPS, { shell: true, stdio: 'inherit' });
}
process.exit(result.status ?? 1);
