// usage: node show.js <logname> <substring> [more substrings...]   (prints non-empty rows of matching snapshots)
const t = require('fs').readFileSync(require('path').join(__dirname, 'logs', process.argv[2] + '.txt'), 'utf8').split(/\n(?==== \[)/);
const want = process.argv.slice(3);
for (const blk of t) {
  const head = blk.split('\n')[0];
  if (want.length === 0 || want.some((w) => head.includes(w))) {
    const lines = blk.split('\n');
    const ne = lines.filter((l, i) => i === 0 || /\|\s*\S/.test(l));
    console.log(ne.map((l) => l.replace(/─{10,}/g, '────').slice(0, 175)).join('\n'));
    console.log();
  }
}
