// First look: trust dialog in a not-yet-trusted cwd (also seeds trust for later runs), boot timeline, raw escape inventory.
module.exports = async (A) => {
  const s = A.start({ name: 's0-boot', cwd: A.dir('cwd') });
  const tl = await s.ready({ timeout: 40000 });
  A.say('timeline', JSON.stringify(tl));
  await A.sleep(1500);
  s.snap('idle-after-boot', { show: 22 });
  A.say('altscreen?', s.isAltScreen());
  const modes = {};
  for (const m of s.raw.matchAll(/\x1b\[\?([0-9;]+)([hl])/g)) { const k = m[1] + m[2]; modes[k] = (modes[k] || 0) + 1; }
  A.say('DEC private modes seen:', JSON.stringify(modes));
  A.say('has ?2004h (bracketed paste):', s.hasRaw('\x1b[?2004h'), ' first at ms:', (s.rawChunks.find((c) => c.d.includes('\x1b[?2004h')) || {}).t);
  const csiOther = new Set();
  for (const m of s.raw.matchAll(/\x1b\[([>=<][0-9;]*[a-zA-Z])/g)) csiOther.add(m[1]);
  A.say('CSI > = < sequences:', [...csiOther].join(' '));
  const osc = new Set();
  for (const m of s.raw.matchAll(/\x1b\](\d+);[^\x07\x1b]{0,40}/g)) osc.add(m[0].slice(2, 30));
  A.say('OSC seen:', [...osc].slice(0, 12).join(' | '));
  A.say('hooks seen:', JSON.stringify(s.hooks().map((h) => ({ e: h.event, startedRel: h.startedAt - s.t0, src: h.in.source, perm: h.in.permission_mode, tp: h.in.transcript_path && h.in.transcript_path.slice(-60) }))));
  A.say('events:', JSON.stringify(s.events.map((e) => e.name + '@' + e.t)));
};
