// One-time setup: settings file with log-only hooks + test assets. Idempotent.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = __dirname;
const R = ROOT.replace(/\\/g, '/');

// ---- settings with log-only hooks (mirrors the events the app registers + SessionStart) ----
const cmd = `node "${R}/hook-ts.js"`;
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'SessionEnd', 'PreCompact'];
const hooks = {};
for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd, timeout: 30 }] }];
fs.writeFileSync(path.join(ROOT, 'settings-hook.json'), JSON.stringify({ hooks }, null, 2));

// ---- settings with NO hooks at all (control) ----
fs.writeFileSync(path.join(ROOT, 'settings-none.json'), JSON.stringify({}, null, 2));

// ---- dirs ----
for (const d of ['cwd', 'logs', 'assets', 'scen']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });

// ---- project files for autocomplete tests (inside cwd) ----
const C = path.join(ROOT, 'cwd');
const w = (rel, txt) => { const p = path.join(C, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };
w('notes/alpha.txt', 'alpha\n');
w('notes/alphabet.md', 'alphabet\n');
w('notes/beta.txt', 'beta\n');
w('src/app.ts', 'export const a = 1;\n');
w('src/apple.ts', 'export const b = 2;\n');
// two project commands where one name is a prefix of the other
w('.claude/commands/spike-help.md', '---\ndescription: spike short command\n---\nReply with exactly the single token HELP-SHORT and nothing else. Args: $ARGUMENTS\n');
w('.claude/commands/spike-helper.md', '---\ndescription: spike long command\n---\nReply with exactly the single token HELP-LONG and nothing else. Args: $ARGUMENTS\n');
// a project skill
w('.claude/skills/spike-skill/SKILL.md', '---\nname: spike-skill\ndescription: Spike skill used only to test slash autocomplete. Never use automatically.\ndisable-model-invocation: true\n---\nReply with exactly the single token SKILL-RAN and nothing else. Args: $ARGUMENTS\n');

// ---- tiny PNG (32x32 solid red) ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const red = png(32, 32, [220, 20, 20]);
fs.writeFileSync(path.join(ROOT, 'assets', 'red.png'), red);
fs.writeFileSync(path.join(ROOT, 'assets', 'red square.png'), red);
fs.writeFileSync(path.join(C, 'assets-red.png'), red); // inside the project cwd (relative @mention)
console.log('setup ok', ROOT, 'png bytes', red.length);
