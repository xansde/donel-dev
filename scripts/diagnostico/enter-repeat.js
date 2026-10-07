// O atraso NAO explicou (50 nao, 150 sim, 400 nao, 1000 nao). Aqui a pergunta
// e outra: com o MESMO atraso, o resultado se repete? Se variar, a causa e
// estado do CLI, nao tempo.
const fs = require('fs');
const pty = require('C:/Users/xansd/seazone/donel-dev/node_modules/node-pty');

const OUT = 'repeat-result.txt';
const EXE = 'C:/Users/xansd/.local/bin/claude.exe';
const DELAY = 150;      // o unico que submeteu na sonda anterior
const REPS = 6;
const TEXT = '/help';

const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
const strip = (s) => s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
const SUBMITTED = ['usagemodes', 'availablecommands', 'learnmoreat', 'slashcommands', 'commonusage'];
const READY = ['bypasspermissions', 'forshortcuts', 'welcometoclaudecode', 'tryedit'];
const hasAny = (t, ns) => ns.some((n) => squash(t).includes(n));
const log = (s) => fs.appendFileSync(OUT, s + '\n');

function run(i) {
  return new Promise((resolve) => {
    const p = pty.spawn(EXE, [], {
      name: 'xterm-256color', cols: 120, rows: 40,
      cwd: 'C:/Users/xansd/seazone/donel-dev', env: process.env,
    });
    let boot = '', after = '', phase = 'boot', readyAt = 0;
    const t0 = Date.now();
    const finish = (v) => { if (phase === 'done') return; phase = 'done'; try { p.kill(); } catch {} resolve({ i, v, readyAt }); };
    const bootTimer = setTimeout(() => finish('TIMEOUT_BOOT'), 45000);
    p.onData((d) => {
      if (phase === 'boot') {
        boot += d;
        if (!hasAny(strip(boot), READY)) return;
        phase = 'sent';
        readyAt = Date.now() - t0;
        clearTimeout(bootTimer);
        setTimeout(() => {
          p.write(TEXT);
          setTimeout(() => {
            p.write('\r');
            setTimeout(() => finish(hasAny(strip(after), SUBMITTED) ? 'SUBMETEU' : 'NAO'), 6000);
          }, DELAY);
        }, 1500);
      } else after += d;
    });
    p.onExit(() => finish(phase === 'boot' ? 'SAIU_NO_BOOT' : 'SAIU'));
  });
}

(async () => {
  fs.writeFileSync(OUT, '');
  const out = [];
  for (let i = 1; i <= REPS; i += 1) {
    const r = await run(i);
    out.push(r.v);
    log(`rep ${i}/${REPS}  delay=${DELAY}ms  boot=${r.readyAt}ms  ->  ${r.v}`);
  }
  const ok = out.filter((v) => v === 'SUBMETEU').length;
  log(`RESUMO: ${ok}/${REPS} submeteram com delay=${DELAY}ms`);
  log('FIM');
  process.exit(0);
})();
