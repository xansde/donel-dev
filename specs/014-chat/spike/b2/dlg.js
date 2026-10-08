// usage: node dlg.js <logname> <label-substring>...  -> prints rows of the dialog region (from the first heavy-bar row) of matching snapshots
const t = require('fs').readFileSync(require('path').join(__dirname, 'logs', process.argv[2] + '.txt'), 'utf8').split(/\n(?==== \[)/);
const want = process.argv.slice(3);
for (const blk of t) {
  const lines = blk.split('\n');
  const head = lines[0];
  if (!want.some((w) => head.includes(w))) continue;
  const rows = lines.slice(1).filter((l) => /\|/.test(l));
  let start = rows.findIndex((l) => /\|\s*▔{6,}/.test(l));
  if (start < 0) start = Math.max(0, rows.length - 10);
  console.log(head.slice(0, 110));
  console.log(rows.slice(start).filter((l) => /\|\s*\S/.test(l)).map((l) => l.replace(/▔{6,}/g, '▔▔▔').replace(/─{10,}/g, '───').slice(0, 150)).join('\n'));
  console.log();
}
