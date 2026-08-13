// Mede a partir de qual atraso entre "texto" e "\r" o REPL do claude submete.
// /help e comando LOCAL do CLI: nao gasta turno de API.
const fs = require('fs');
const pty = require('C:/Users/xansd/seazone/donel-dev/node_modules/node-pty');

const OUT = 'probe-result.txt';
const EXE = 'C:/Users/xansd/.local/bin/claude.exe';
const DELAYS = [50, 150, 400, 1000, 2000];
const TEXT = '/help';
// ConPTY nao escreve espaco: emite "avanca cursor" (ESC[nC). Ao tirar as
// sequencias ANSI o espaco vai junto, entao TODA comparacao aqui e feita sem
// espaco nenhum, dos dois lados. (O app nao sofre disso porque le o buffer JA
// RENDERIZADO do xterm — ver T013 em TerminalPane.tsx.)
const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
const SUBMITTED = ['usagemodes', 'availablecommands', 'learnmoreat', 'slashcommands', 'commonusage'];
const READY = ['bypasspermissions', 'forshortcuts', 'welcometoclaudecode', 'tryedit'];

const strip = (s) => s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
const log = (s) => fs.appendFileSync(OUT, s + '\n');

const hasAny = (text, needles) => needles.some((n) => squash(text).includes(n));
const isReady = (t) => hasAny(t, READY);

function run(delay) {
  return new Promise((resolve) => {
    const p = pty.spawn(EXE, [], {
      name: 'xterm-256color', cols: 120, rows: 40,
      cwd: 'C:/Users/xansd/seazone/donel-dev', env: process.env,
    });
    let boot = '';
    let after = '';
    let phase = 'boot';
    const finish = (verdict, extra) => {
      if (phase === 'done') return;
      phase = 'done';
      try { p.kill(); } catch {}
      resolve({ delay, verdict, extra });
    };
    const bootTimer = setTimeout(() => finish('TIMEOUT_BOOT', strip(boot).slice(-600)), 45000);
    p.onData((d) => {
      if (phase === 'boot') {
        boot += d;
        if (!isReady(strip(boot))) return;
        phase = 'sent';
        clearTimeout(bootTimer);
        setTimeout(() => {
          p.write(TEXT);
          setTimeout(() => {
            p.write('\r');
            setTimeout(() => finish(hasAny(strip(after), SUBMITTED) ? 'SUBMETEU' : 'NAO_SUBMETEU', strip(after).slice(-300)), 6000);
          }, delay);
        }, 1500); // deixa o boot assentar antes de escrever
      } else {
        after += d;
      }
    });
    p.onExit(() => finish(phase === 'boot' ? 'SAIU_NO_BOOT' : 'SAIU', strip(boot).slice(-400)));
  });
}

(async () => {
  fs.writeFileSync(OUT, '');
  for (const d of DELAYS) {
    const r = await run(d);
    log(`delay=${String(r.delay).padStart(5)}ms  ->  ${r.verdict}`);
    if (r.verdict !== 'SUBMETEU' && r.verdict !== 'NAO_SUBMETEU') log(`    trecho: ${JSON.stringify(r.extra || '').slice(0, 500)}`);
  }
  log('FIM');
  process.exit(0);
})();
