// Log-only hook: appends {ts, startedAt, event, in} to $HOOK_LOG (JSONL). Never decides anything.
const fs = require('fs');
const path = require('path');
const ts = Date.now();
const startedAt = ts - Math.round(process.uptime() * 1000); // ~ when the hook process was spawned
let d = '';
process.stdin.on('data', (c) => (d += c)).on('end', () => {
  let j;
  try { j = JSON.parse(d); } catch (e) { j = { _raw: d.slice(0, 300) }; }
  const L = process.env.HOOK_LOG || path.join(__dirname, 'hooklog.jsonl');
  try {
    fs.appendFileSync(L, JSON.stringify({ ts, startedAt, event: j.hook_event_name, in: j }) + '\n');
  } catch (e) { /* ignore */ }
  process.exit(0);
});
