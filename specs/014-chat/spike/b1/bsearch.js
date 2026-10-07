// Fast fixed-string search over the (bun-compiled) claude.exe binary.
// usage: node bsearch.js [--before N] [--after N] [--max N] [--out file] needle1 needle2 ...
// Dedupes identical context windows (the JS can be embedded more than once).
const fs = require('fs');
const BIN = 'C:/Users/xansd/.local/bin/claude.exe';
const args = process.argv.slice(2);
let before = 200, after = 400, max = 8, out = null;
const needles = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--before') before = +args[++i];
  else if (args[i] === '--after') after = +args[++i];
  else if (args[i] === '--max') max = +args[++i];
  else if (args[i] === '--out') out = args[++i];
  else needles.push(args[i]);
}
const buf = fs.readFileSync(BIN);
const chunks = [];
const log = (s) => chunks.push(s);
for (const n of needles) {
  const nb = Buffer.from(n, 'latin1');
  let pos = 0, found = 0, total = 0;
  const seen = new Set();
  log(`\n######## NEEDLE: ${n}`);
  while (true) {
    const i = buf.indexOf(nb, pos);
    if (i < 0) break;
    total++;
    pos = i + nb.length;
    const ctx = buf.slice(Math.max(0, i - before), Math.min(buf.length, i + nb.length + after)).toString('latin1').replace(/[\x00-\x08\x0b-\x1f]/g, '.');
    if (seen.has(ctx)) continue;
    seen.add(ctx);
    if (found < max) {
      found++;
      log(`--- hit @${i}\n${ctx}`);
    }
  }
  log(`#### total raw hits: ${total}, distinct contexts: ${seen.size}`);
}
const text = chunks.join('\n');
if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
