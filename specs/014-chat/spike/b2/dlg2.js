// usage: node dlg2.js <logname> <label-substring>...  -> compact: title rows + last row of dialog region
const t = require('fs').readFileSync(require('path').join(__dirname, 'logs', process.argv[2] + '.txt'), 'utf8').split(/\n(?==== \[)/);
const want = process.argv.slice(3);
for (const blk of t) {
  const lines = blk.split('\n');
  const head = lines[0];
  if (!want.some((w) => head.includes(w))) continue;
  const rows = lines.slice(1).filter((l) => /\|/.test(l)).map((l) => l.replace(/^\s*\d+\|/, ''));
  let start = rows.findIndex((l) => /^\s*▔{6,}/.test(l));
  const dialog = start >= 0;
  if (start < 0) start = Math.max(0, rows.length - 8);
  const reg = rows.slice(start).filter((l) => l.trim()).map((l) => l.replace(/▔{6,}/g, '▔▔▔').replace(/─{10,}/g, '───').trim());
  console.log('## ' + head.replace(/=== \[\w+ \+(\d+)ms\] /, '').replace(/\s+\(cursor.*/, '') + (dialog ? '  [DIALOG]' : '  [no dialog bar]'));
  console.log('   first: ' + reg.slice(0, 3).map((x) => x.slice(0, 100)).join('  //  '));
  console.log('   last : ' + reg[reg.length - 1].slice(0, 140));
}
