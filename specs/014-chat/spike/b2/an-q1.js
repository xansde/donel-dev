// Reads logs/q1*.jsonl and logs/q1b-*.jsonl: per run -> arming (first letter accepted after the lost gap) vs paint vs hook
const fs = require('fs');
const files = fs.readdirSync('logs').filter((f) => /^q1(b)?-.*\.jsonl$/.test(f) && !/hooks/.test(f));
for (const f of files) {
  const base = f.replace('.jsonl', '');
  const l = fs.readFileSync('logs/' + f, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
  const probes = l.filter((e) => e.k === 'in' && e.label === 'probe').map((e) => ({ ch: e.d, t: e.t }));
  if (!probes.length) continue;
  const txt = fs.readFileSync('logs/' + base + '.txt', 'utf8').split(/\n(?==== \[)/).filter((b) => /final/.test(b.split('\n')[0])).pop() || '';
  const rowLine = txt.split('\n').find((x) => /\|❯[  ]/.test(x)) || '';
  const row = rowLine.replace(/^\s*\d+\|❯[  ]/, '');
  const acc = new Set(row.split(''));
  const status = probes.map((p) => ({ ...p, acc: acc.has(p.ch) }));
  const firstLostIdx = status.findIndex((p) => !p.acc);
  const lastLostIdx = status.map((p) => p.acc).lastIndexOf(false);
  const early = firstLostIdx < 0 ? status : status.slice(0, firstLostIdx);
  const lost = firstLostIdx < 0 ? [] : status.slice(firstLostIdx, lastLostIdx + 1);
  const late = lastLostIdx < 0 ? status : status.slice(lastLostIdx + 1);
  const hookLine = fs.existsSync('logs/' + base + '.hooks.jsonl') ? fs.readFileSync('logs/' + base + '.hooks.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).find((h) => h.event === 'SessionStart') : null;
  const spawnT = (l.find((e) => e.k === 'mark' && e.name === 'spawn') || {}).t;
  const outs = l.filter((e) => e.k === 'out');
  const alt = outs.find((e) => e.d.includes('\x1b[?1049h'));
  const banner = outs.find((e) => /v2\.1\.\d+/.test(e.d) && /Claude/.test(e.d));
  const bpOn = outs.filter((e) => e.d.includes('\x1b[?2004h')).map((e) => e.t);
  const bpOff = outs.filter((e) => e.d.includes('\x1b[?2004l')).map((e) => e.t);
  // hook ts is absolute epoch; spawn time of this session = (first line of jsonl has no epoch) -> use hooks relative to session via 'startedAt - t0' stored by driver in hooks()? not available here; estimate via file's 'mark spawn' only.
  console.log(base.padEnd(22) + ' early-ok[' + (early.length ? early[0].t + '..' + early[early.length - 1].t : '-') + 'ms]=' + early.map((p) => p.ch).join('')
    + ' | lost[' + (lost.length ? lost[0].t + '..' + lost[lost.length - 1].t : '-') + 'ms]=' + lost.map((p) => p.ch).join('')
    + ' | armed: first late-ok letter written@' + (late.length ? late[0].t : '-') + 'ms'
    + ' | paint@' + (alt ? alt.t : (banner ? banner.t : '-')) + (alt ? '(alt)' : '(banner)')
    + ' | ?2004h@' + bpOn.join(',') + ' ?2004l@' + bpOff.join(',')
    + (hookLine ? ' | hookStart(abs)=' + hookLine.startedAt : ''));
}
