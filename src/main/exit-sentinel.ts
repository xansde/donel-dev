// Sentinela de saída (t-d4f5879c, 17/11) — how the main process ended, and what around it looked like a killer.
// At 06:22 of 17/11 the app on the owner's PC was ended from outside (third time): no quit path ran, no dump, no
// Application Error, and Windows keeps no record of who called TerminateProcess unless process auditing is on
// (auditpol, needs admin). The run trail (run-trail.ts) proves THAT the run ended without quitting; this says HOW,
// from the exit code:
//   0 quit · 1 taskkill /F, Task Manager or a node `process.kill` · 2 a second copy of the app found this one hung
//   with no visible window and ended it (Chromium ProcessSingleton, RESULT_CODE_HUNG) · -1 PowerShell Stop-Process ·
//   0xC000013A console closed · 0xC0000000+ and 0x80000003 a crash.
// A small PowerShell waits on the main and, when it ends, writes `<userData>/main-exit-<pid>-<start>.json` (one file
// per run, so a late record is never overwritten by the next run's): first the exit code alone, then again with the
// processes started in the two minutes before the end that are STILL ALIVE when it looks (`aliveAfterExit`). A
// short-lived killer (taskkill.exe, the host of a Stop-Process) is usually gone by then: only its long-lived parent
// may show. Catching the killer itself needs process-creation auditing or ETW, both admin-only; a 1 s WMI poll was
// tried and caught taskkill 2 times in 5, at a constant WMI cost, so it was left out.
// The full command line never reaches the disk (t-c1b710c2): masking a whole line either leaves a password readable
// or erases who did the kill. Of each candidate to killer only the EVIDENCE is kept — the kill commands it carries
// (taskkill, Stop-Process, kill/pkill, process.kill, os.kill, wmic … delete, Invoke-CimMethod Terminate, .Kill()),
// the scripts it runs, also inside a -EncodedCommand, and whether it names the main's pid. A kill command is rebuilt
// from the parts a rule lists (verb, pids, names, switches): a value nobody listed, like taskkill's /P or what a
// $(…) computes, is never copied. The pieces then go through the masks the whole line had before, as a second layer.
// It is started through a hop that leaves at once, so it is not a descendant of the main and a `taskkill /T` on the
// main does not take it along.

import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets } from '../shared/ledger/secret-scan';

export type ExitCause = 'quit' | 'killed' | 'killed-as-hung-by-second-copy' | 'stop-process' | 'console-closed' | 'crash' | 'other';

export function classifyExitCode(code: number): ExitCause {
  const unsigned = code >>> 0;
  if (unsigned === 0) return 'quit';
  if (unsigned === 1) return 'killed';
  if (unsigned === 2) return 'killed-as-hung-by-second-copy';
  if (unsigned === 0xffffffff) return 'stop-process';
  if (unsigned === 0xc000013a) return 'console-closed';
  if (unsigned >= 0xc0000000 || unsigned === 0x80000003) return 'crash';
  return 'other';
}

// The pieces of the rules below. Every regex is read the same by .NET `[regex]` and JS (flag `i`): ASCII classes,
// bounded lengths, no `\b`/`\d`/`\w` (Unicode-aware in .NET) and `\s` spelled out (`portable`): a long line costs a
// linear pass per rule.
/** -Id 6700, -Id:6700 */
const SEP = String.raw`(?:\s*:\s*|\s+)`;
/** -Id 6700 and also an argument list: '/PID', '6700' (python's subprocess, Start-Process -ArgumentList, execFile) */
const SEP_LIST = String.raw`(?:\s*:\s*|\s+|['"]\s*,\s*(?=['"]))`;
const NUMS = String.raw`[0-9]{1,10}(?:\s*,\s*[0-9]{1,10}){0,7}`;
/** A variable's name ($p, $pid, $_.ProcessId), never what it holds; `$env:X` is not one. */
const VAR = String.raw`\$[A-Za-z_][A-Za-z0-9_]{0,40}(?:\.[A-Za-z_][A-Za-z0-9_]{0,40})?(?=[\s"',]|$)`;
/** What a token may be followed by: a separator, a quote, a list comma or the end of the command. */
const AFTER = String.raw`(?=[\s"',]|$)`;
/**
 * A name that can be quoted (also with \" or \\\" from nested shells): a process, an image, a filter, a WQL `like`
 * with % and _.
 */
const QCHARS = String.raw`A-Za-z0-9_ .*%\\/:-`;
const QUOTED = String.raw`\\{0,3}"[${QCHARS}]{1,80}\\{0,3}"|\\{0,3}'[${QCHARS}]{1,80}\\{0,3}'`;
const VALUE = String.raw`(?:${QUOTED}|[A-Za-z0-9_.*\\/:][A-Za-z0-9_.*\\/:-]{0,79}${AFTER})`;
const VALUES = String.raw`${VALUE}(?:\s*,\s*${VALUE}){0,7}`;
const FLAG_AT = String.raw`(?<=[\s"'])`;
const WORD_START = String.raw`(?<![A-Za-z0-9_.-])`;
const WORD_END = String.raw`(?![A-Za-z0-9_-])`;
/**
 * The rest of one command: it stops where another command, a subexpression, a block or a comment begins, and, when it
 * runs past 200 characters, at the last whitespace before that, so a token is never kept cut in half.
 */
const REST = String.raw`(?:(?!\$\()[^&|;<>(){}#\x60\r\n]){0,200}(?=[&|;<>(){}#\x60\r\n]|\$\(|\s|$)`;
/** Stop-Process / Get-Process / PowerShell's kill: -Id, -Name, -InputObject and the switches. */
const PS_PROCESS_PARAMS = [
  String.raw`${FLAG_AT}-(?:id|i)${SEP}(?:${NUMS}${AFTER}|${VAR})`,
  String.raw`${FLAG_AT}-(?:processname|name|nam|na|n|pn)${SEP}${VALUES}`,
  String.raw`${FLAG_AT}-inputobject${SEP}${VAR}`,
  String.raw`${FLAG_AT}-(?:id|name|inputobject|force|passthru|whatif|confirm)${WORD_END}`,
].join('|');
/** One word of a pkill/pgrep pattern: no digit, no `=`, no `@`, not an option, so an argument is never one. */
const PATTERN_WORD = String.raw`[A-Za-z_.*/:][A-Za-z_.*\\/:-]{0,60}(?<!\\)(?=[\s"'\\]|$)`;
const SCRIPT_EXT = '(?:ps1|psm1|sh|bash|js|mjs|cjs|ts|py|cmd|bat|vbs)';
/** No URL and no user:password@ anywhere in the token a script path is taken from. */
const NO_CREDENTIAL_URL = String.raw`(?![^\s"'|&;<>()]{0,200}?(?:://|:[^\\/\s"'@]{0,100}@))`;
/** The file and at most two folders above it. */
const LAST_SEGMENTS = String.raw`(?:[^\\/]{1,80}[\\/]){0,2}[^\\/]{1,80}$`;

/**
 * What says who ended a process. `find` is one command in a command line; when the rule has `keep`, the evidence is
 * only the parts of that command `keep` matches (joined by a space): the verb, the pids, the names, the switches. A
 * value nobody listed — a password, a token, what a subexpression computes — is never copied, so nothing has to be
 * found and masked afterwards. A rule without `keep` already matches only listed characters.
 */
export interface KillRule {
  readonly find: string;
  readonly keep?: string;
}

const RULES: readonly KillRule[] = [
  // taskkill /PID 6700 /T /F, /IM x, /FI "…", /S host, and the '/IM', 'x' of an argument list; /U and /P never
  {
    find: String.raw`${WORD_START}taskkill(?:\.exe)?${WORD_END}${REST}`,
    keep: String.raw`^taskkill(?:\.exe)?|${FLAG_AT}[/-]{1,2}(?:pid${SEP_LIST}['"]?(?:[0-9]{1,10}|%%?[A-Za-z]|\$[A-Za-z_][A-Za-z0-9_]{0,40})${AFTER}|im${SEP_LIST}${VALUE}|fi${SEP_LIST}\\{0,3}["']?(?:IMAGENAME|PID|STATUS|USERNAME|SERVICES|MODULES|WINDOWTITLE|SESSIONNAME|SESSION)\s+(?:eq|ne|gt|lt|ge|le)\s+(?:[0-9]{1,10}|${PATTERN_WORD}(?: ${PATTERN_WORD}){0,3})|s${SEP}[A-Za-z0-9._-]{1,63}${AFTER}|[ft]${AFTER})`,
  },
  {
    find: String.raw`${WORD_START}(?:Stop-Process|spps)${WORD_END}${REST}`,
    keep: String.raw`^(?:Stop-Process|spps)(?:\s+(?:${NUMS}${AFTER}|${VAR}))?|${PS_PROCESS_PARAMS}`,
  },
  {
    find: String.raw`${WORD_START}(?:Get-Process|gps)${WORD_END}${REST}`,
    keep: String.raw`^(?:Get-Process|gps)(?:\s+${VALUES})?|${PS_PROCESS_PARAMS}`,
  },
  // kill -9 6700, kill -s KILL %1, kill $pid, PowerShell's kill -Id 6700 and `… | kill`: only the run of signals and
  // pids right after the verb, so a number given to another option is never one; not the /kill of a URL
  {
    find: String.raw`(?<![A-Za-z0-9_.\\/:-])kill(?=[\s"'|;)}]|$)${REST}`,
    keep: String.raw`^kill(?:\s+(?:-(?:processname|name|nam|na|n|pn)${SEP}${VALUES}|-(?:id|i)${SEP}(?:${NUMS}${AFTER}|${VAR})|-(?:s|signal)\s+[A-Za-z0-9]{1,10}${AFTER}|-(?:[0-9]{1,2}|[A-Za-z]{1,12})${AFTER}|%?${NUMS}${AFTER}|${VAR}))*`,
  },
  // pkill -f "Donel Dev", killall electron, and the pgrep/pidof that finds the pid for a kill: the switches and the
  // first words of the pattern, up to the first argument of the program it names
  {
    find: String.raw`${WORD_START}(?:pkill|killall|pgrep|pidof)(?=\s)${REST}`,
    keep: String.raw`^(?:pkill|killall|pgrep|pidof)|${FLAG_AT}--?[A-Za-z][A-Za-z-]{0,20}(?=[\s"',=]|$)|(?<=^(?:pkill|killall|pgrep|pidof)(?:\s+--?[A-Za-z][A-Za-z-]{0,20})*\s+\\{0,3}["']?)${PATTERN_WORD}(?: ${PATTERN_WORD}){0,3}`,
  },
  // process.kill(6700), process.kill(Number(process.argv[1])): names and brackets only, never a string
  { find: String.raw`(?<![A-Za-z0-9_])process\.kill\((?:\s*[A-Za-z0-9_.$()[\]]{1,60}\s*(?:,\s*['"]?[A-Za-z0-9_]{1,20}['"]?\s*)?\))?` },
  { find: String.raw`(?<![A-Za-z0-9_])os\.kill\((?:\s*[A-Za-z0-9_.]{1,40}\s*(?:,\s*[A-Za-z0-9_.]{1,30}\s*)?\))?` },
  { find: String.raw`(?<![A-Za-z0-9_])psutil\.Process\((?:\s*[A-Za-z0-9_.]{0,40}\s*\))?(?:\.(?:kill|terminate)\(\))?` },
  { find: String.raw`(?<![A-Za-z0-9_])GetProcessById\(\s*[A-Za-z0-9_$.]{1,40}\s*\)(?:\.Kill\(\))?` },
  { find: String.raw`(?<![A-Za-z0-9_])GetProcessesByName\(\s*(?:${QUOTED})\s*\)` },
  { find: String.raw`[A-Za-z0-9_$.\]]{0,60}\.(?:Kill|Terminate)\(\)` },
  { find: String.raw`(?<![A-Za-z0-9_-])(?:%|ForEach-Object)\s+(?:-MemberName\s+)?(?:Kill|Terminate)(?![A-Za-z0-9_])` },
  // the node packages that kill a process tree or a port
  { find: String.raw`(?<![A-Za-z0-9_-])(?:tree-kill|fkill(?:-cli)?|kill-port)(?![A-Za-z0-9_-])(?:['"]?\)?\(?\s*[0-9]{1,10})?` },
  // Where-Object { $_.Name -like 'Donel*' }, ? Path -like '*Donel*': the filter that picks what a pipeline stops
  {
    find: String.raw`(?<![A-Za-z0-9_])(?:\$_\.)?(?:Name|ProcessName|Path|MainWindowTitle|Id)\s+-i?(?:like|eq|match)\s+(?:${QUOTED}|[A-Za-z0-9_.*-]{1,80}${AFTER})`,
  },
  // wmic /node:pc process where "name='x'" delete, … where processid=6700 call terminate; /user and /password never
  {
    find: String.raw`${WORD_START}wmic(?:\.exe)?${WORD_END}[^&|;<>\r\n]{0,200}?(?:delete|terminate)`,
    keep: String.raw`^wmic(?:\.exe)?|(?<=[\s"'(])(?:process|where|delete|call|terminate)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?:processid|parentprocessid|handle)\s*=\s*['"]?[0-9]{1,10}|(?<![A-Za-z0-9_])(?:name|caption)\s*(?:=|like)\s*(?:${QUOTED})|(?<=\s)/node:[A-Za-z0-9._-]{1,63}`,
  },
  // a script run by the process: the file and at most two folders above it, never its arguments nor a URL. A quoted
  // path that starts like one (C:\, \\srv, /, ./, ~) may have spaces, but not a space before an option or another path.
  {
    find: String.raw`(?<=["'])${NO_CREDENTIAL_URL}(?:[A-Za-z]:[\\/]|\\\\|\.{0,2}[\\/]|~[\\/])(?:(?!\s+(?:[-/.~\\]|[A-Za-z]:))[^"'|&;<>\r\n]){0,200}\.${SCRIPT_EXT}(?=["'])`,
    keep: LAST_SEGMENTS,
  },
  {
    find: String.raw`(?<![^\s"'=(,])${NO_CREDENTIAL_URL}[^\s"'|&;<>()=,]{1,200}\.${SCRIPT_EXT}(?![A-Za-z0-9])`,
    keep: LAST_SEGMENTS,
  },
  // Invoke-CimMethod -MethodName Terminate, Get-CimInstance Win32_Process -Filter "ProcessId=6700" | Remove-CimInstance
  {
    find: String.raw`${WORD_START}(?:Invoke-CimMethod|Invoke-WmiMethod|Get-CimInstance|Get-WmiObject|Remove-CimInstance|Remove-WmiObject|icim|iwmi|gcim|gwmi|rcim|rwmi)${WORD_END}${REST}`,
    keep: String.raw`^[A-Za-z-]{4,20}|(?<![A-Za-z0-9_])(?:Terminate|Win32_Process)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?:ParentProcessId|ProcessId|Handle)\s*=\s*['"]?[0-9]{1,10}|(?<![A-Za-z0-9_])(?:Name|Caption)\s*(?:=|like)\s*(?:${QUOTED})`,
  },
  // an agent's PowerShell tool: its command lives in an environment variable, out of reach, but the tool is known
  { find: String.raw`CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT` },
];

const WHITESPACE = ' \\t\\n\\v\\f\\r\\u00a0';

/**
 * The regex with `\s`/`\S` spelled out as one fixed set: .NET and JS disagree on what else is whitespace (U+0085,
 * U+FEFF), and the disk must say what the tests saw.
 */
function portable(source: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[++i];
      if (next === 's') out += inClass ? WHITESPACE : `[${WHITESPACE}]`;
      else if (next === 'S' && !inClass) out += `[^${WHITESPACE}]`;
      else if (next === 'S') throw new Error('portable: \\S inside a class');
      else out += ch + next;
      continue;
    }
    if (ch === '[' && !inClass) inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    out += ch;
  }
  return out;
}

export const KILL_RULES: readonly KillRule[] = RULES.map((rule) => ({ find: portable(rule.find), keep: rule.keep && portable(rule.keep) }));

/** `encodedcommand` and every prefix of it, as PowerShell accepts them (-e, -en, -enc, … -EncodedCommand). */
const ENCODED_FLAG = [...'encodedcommand'].reverse().reduce((rest, ch) => (rest ? `${ch}(?:${rest})?` : ch), '');

/**
 * The base64 of a `powershell -EncodedCommand` in any of its spellings (-ec, -e, -enc, --EncodedCommand, /enc, and
 * the `'-EncodedCommand','…'` of a Start-Process), decoded and searched like the line itself.
 */
export const ENCODED_COMMAND_PATTERN = portable(
  String.raw`(?:^|[\s"',])(?:--?|/)(?:ec|${ENCODED_FLAG})['"]?(?:\s*[,:]\s*|\s+)['"]?([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])`,
);
/** At most this many base64 blocks are decoded per command line, a decoded one included. */
export const ENCODED_MAX = 4;

/** At most this many pieces of evidence per process, each cut to EVIDENCE_PIECE_MAX characters. */
export const EVIDENCE_MAX = 8;
export const EVIDENCE_PIECE_MAX = 200;
/** The command line is cut to this before the search. */
export const COMMAND_LINE_CUT = 8192;

const SECRET_WORD = '(?:password|passwd|pass|pwd|pw|secret|token|apikey|api-key|key|auth|credential|otp)';

/**
 * Masks for a piece of evidence, applied by the PowerShell (`-replace`) and here (flag `gi`). A second layer: a piece
 * is made of listed parts only, but a quoted name (a `pkill -f "…"` pattern) or a folder can still carry a secret.
 * They are the masks the whole command line had before (#461), so the disk never masks less than it did.
 */
const MASKS: ReadonlyArray<{ readonly source: string; readonly to: string }> = [
  // scheme://user:password@host
  { source: String.raw`(://[^/\s:@"']+:)[^@\s"']+@`, to: '$1***@' },
  // user:password@host with no scheme before it (scp, a URL cut by a script path)
  { source: String.raw`([^\s/\\:@"']+:)[^@\s/\\"']+@`, to: '$1***@' },
  // Authorization: Bearer <token> / Basic <base64>
  { source: String.raw`((?:bearer|basic)\s+)[^\s"']+`, to: '$1***' },
  // curl -u user:password, -u "user:password", -uuser:password, --user=user:password
  { source: String.raw`((?:^|\s)(?:-u|--user)(?:=|\s*)["']?[^\s:"']+:)[^\s"']+`, to: '$1***' },
  // PGPASSWORD=x, $env:TOKEN='x', --password=x, password: x
  { source: String.raw`((?:\$env:)?[A-Za-z0-9_.-]*${SECRET_WORD}[A-Za-z0-9_.-]*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&|;"']+)`, to: '$1***' },
  // --password x, -Password x, --client-secret x, -Credential x (a following switch is not a value)
  { source: String.raw`((?:^|\s)--?[A-Za-z0-9_-]*${SECRET_WORD}[A-Za-z0-9_-]*\s+)("[^"]*"|'[^']*'|[^\s-]\S*)`, to: '$1***' },
  // -Pat x, -Pin x: an option in -p… with its value apart (before the next mask, which would take "at" for the value)
  { source: String.raw`((?:^|\s)-p(?!(?:id|assthru|n|rocessname)(?![A-Za-z0-9_]))[A-Za-z]{1,20}\s+)("[^"]*"|'[^']*'|[^\s-]\S*)`, to: '$1***' },
  // -pSenha, -p Senha (mysql, sshpass, taskkill -p); the switches a kill rule keeps (-pid, -PassThru, -pn) are not one
  { source: String.raw`((?:^|\s)-p(?!(?:id|assthru|n|rocessname)(?![A-Za-z0-9_]))\s*)("[^"]*"|'[^']*'|[^\s-]\S*)`, to: '$1***' },
  // taskkill /P x, //P x (Git Bash), /p:x, wmic /password:x
  { source: String.raw`((?:^|[\s"'])/{1,2}(?:p|pw|pwd|pass|password)(?:[:=]|\s+))("[^"]*"|'[^']*'|\S+)`, to: '$1***' },
  // AWS access key ids
  { source: String.raw`(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])`, to: '***' },
  // a long run of token-like characters with a digit and a letter (keys, tokens, base64); a long plain name stays
  { source: String.raw`(?<![A-Za-z0-9_+=-])(?=[A-Za-z_+=-]*[0-9])(?=[0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{24,}`, to: '***' },
];

export const EVIDENCE_MASKS = MASKS.map((mask) => ({ source: portable(mask.source), to: mask.to }));

/** What the PowerShell does to a piece of evidence before the disk: masked whole, then cut. */
export function maskEvidence(text: string): string {
  let out = text;
  for (const mask of EVIDENCE_MASKS) out = out.replace(new RegExp(mask.source, 'gi'), mask.to);
  return out.length > EVIDENCE_PIECE_MAX ? out.slice(0, EVIDENCE_PIECE_MAX) : out;
}

/** The Claude Code Bash tool writes each ' inside its eval '…' as '\"'\"' (or '"'"'): read back as one quote. */
export const SHELL_QUOTE_ESCAPES: readonly string[] = [`'\\"'\\"'`, `'"'"'`];

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export interface KillEvidence {
  readonly evidence: readonly string[];
  /** The command line names the main's pid as a whole number. */
  readonly mentionsMain: boolean;
}

/** `[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(b64))`: a lone byte or surrogate becomes U+FFFD. */
function decodeUtf16Base64(b64: string): string {
  const bytes = Buffer.from(b64, 'base64');
  const odd = bytes.length % 2 === 1;
  const text = bytes.subarray(0, bytes.length - (odd ? 1 : 0)).toString('utf16le') + (odd ? '\ufffd' : '');
  return text.replace(LONE_SURROGATE, '\ufffd');
}

/** What the PowerShell records of a candidate's command line; mirrors Get-KillEvidence, which the tests run. */
export function extractKillEvidence(commandLine: string, mainPid: number): KillEvidence {
  const line = commandLine.length > COMMAND_LINE_CUT ? commandLine.slice(0, COMMAND_LINE_CUT) : commandLine;
  const texts = [line];
  let decodes = 0;
  for (let i = 0; i < texts.length; i++) {
    for (const match of texts[i].matchAll(new RegExp(ENCODED_COMMAND_PATTERN, 'gi'))) {
      if (decodes >= ENCODED_MAX) break;
      // .NET's FromBase64String refuses a length that is not a multiple of 4; Node would decode it anyway
      if (match[1].length % 4 !== 0) continue;
      decodes++;
      const decoded = decodeUtf16Base64(match[1]);
      if (decoded) texts.push(decoded);
    }
  }
  const found: string[] = [];
  for (const raw of texts) {
    const text = SHELL_QUOTE_ESCAPES.reduce((t, escape) => t.split(escape).join("'"), raw);
    for (const rule of KILL_RULES) {
      for (const match of text.matchAll(new RegExp(rule.find, 'gi'))) {
        const piece = rule.keep ? [...match[0].matchAll(new RegExp(rule.keep, 'gi'))].map((part) => part[0]).join(' ') : match[0];
        if (piece) found.push(piece);
      }
    }
  }
  // a lone surrogate (also one the cut split) reaches the disk as U+FFFD, through ConvertTo-Json and UTF-8
  const evidence = [...new Set(found)].slice(0, EVIDENCE_MAX).map((piece) => maskEvidence(piece).replace(LONE_SURROGATE, '�'));
  const mentionsMain = texts.some((text) => new RegExp(`(?<![0-9])${Math.trunc(mainPid)}(?![0-9])`).test(text));
  return { evidence, mentionsMain };
}

/** What reaches the log: the evidence masks again, then the ledger's maskSecrets. */
export function maskForLog(text: string): string {
  return maskSecrets(maskEvidence(text)).text;
}

/** Image names whose command line may say who ended the main; any other process keeps only its name. */
export const KILLER_CANDIDATES = '^(taskkill|wmic|powershell|pwsh|cmd|wscript|cscript|node|electron|bash|sh|pythonw?[0-9.]*|pyw?|Donel Dev.*)\\.exe$';

export interface ExitSentinelOptions {
  readonly pid: number;
  /** When the main started (epoch ms): the sentinel only waits on the process that has this start. */
  readonly startedAtMs: number;
  /** `exitRecordPath(userData, run)`. */
  readonly recordPath: string;
}

/** How far the start time read by Windows may be from ours and still be the same process. */
const SAME_PROCESS_TOLERANCE_SECONDS = 10;
/** The processes started this long before the end go in the record. */
const RECENT_WINDOW_SECONDS = 120;
const RECENT_MAX = 40;

/** A PowerShell single-quoted string: every quote PowerShell closes one with (' ‘ ’ ‚ ‛) is doubled. */
function psQuote(text: string): string {
  return `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

function encode(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** The PowerShell function that mirrors extractKillEvidence + maskEvidence (`Get-KillEvidence $commandLine`). */
export function evidenceFunctionScript(mainPid: number): string {
  const finds = KILL_RULES.map((rule) => psQuote(rule.find)).join(', ');
  const keeps = KILL_RULES.map((rule) => psQuote(rule.keep ?? '')).join(', ');
  const masks = EVIDENCE_MASKS.map((mask) => ` -replace ${psQuote(mask.source)}, '${mask.to}'`).join('');
  return [
    'function Get-KillEvidence([string]$cl) {',
    `  if ($cl.Length -gt ${COMMAND_LINE_CUT}) { $cl = $cl.Substring(0, ${COMMAND_LINE_CUT}) }`,
    '  $texts = New-Object System.Collections.Generic.List[string]',
    '  $texts.Add($cl)',
    '  $decodes = 0',
    `  for ($i = 0; $i -lt $texts.Count; $i++) { foreach ($m in [regex]::Matches($texts[$i], ${psQuote(ENCODED_COMMAND_PATTERN)}, 'IgnoreCase')) {` +
      ` if ($decodes -ge ${ENCODED_MAX}) { break }; $b = $m.Groups[1].Value; if ($b.Length % 4 -ne 0) { continue }; $decodes++;` +
      ' try { $dec = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b)); if ($dec) { $texts.Add($dec) } } catch {} } }',
    // compiled once: a pipeline per match costs seconds on a long line (red-team of #465)
    `  $finds = @(foreach ($f in @(${finds})) { [regex]::new($f, [Text.RegularExpressions.RegexOptions]::IgnoreCase) })`,
    `  $keeps = @(${keeps})`,
    `  $keepRx = @(foreach ($k in $keeps) { [regex]::new($k, [Text.RegularExpressions.RegexOptions]::IgnoreCase) })`,
    `  $escapes = @(${SHELL_QUOTE_ESCAPES.map(psQuote).join(', ')})`,
    '  $found = New-Object System.Collections.Generic.List[string]',
    "  foreach ($raw in $texts) { $t = $raw; foreach ($e in $escapes) { $t = $t.Replace($e, \"'\") }; for ($r = 0; $r -lt $finds.Count; $r++) { foreach ($m in $finds[$r].Matches($t)) {" +
      " $piece = $m.Value; if ($keeps[$r]) { $piece = @(foreach ($k in $keepRx[$r].Matches($piece)) { $k.Value }) -join ' ' };" +
      ' if ($piece -and -not $found.Contains($piece)) { $found.Add($piece) } } } }',
    `  $evidence = @($found | Select-Object -First ${EVIDENCE_MAX} | ForEach-Object { $s = $_${masks}; if ($s.Length -gt ${EVIDENCE_PIECE_MAX}) { $s = $s.Substring(0, ${EVIDENCE_PIECE_MAX}) }; $s })`,
    `  $mentions = [bool]($texts | Where-Object { $_ -match '(?<![0-9])${Math.trunc(mainPid)}(?![0-9])' })`,
    '  return @{ evidence = $evidence; mentionsMain = $mentions }',
    '}',
  ].join('\n');
}

export function buildExitSentinelCommand(options: ExitSentinelOptions): { file: string; args: string[] } {
  const pid = Math.trunc(options.pid);
  const startedAt = Math.trunc(options.startedAtMs);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
    throw new Error('sentinela de saída: pid ou início inválido');
  }
  const target = psQuote(options.recordPath);
  const temp = psQuote(`${options.recordPath}.tmp`);
  const save = [
    '$json = ConvertTo-Json -InputObject $record -Depth 5 -Compress',
    `[IO.File]::WriteAllText(${temp}, $json, (New-Object Text.UTF8Encoding $false))`,
    `Move-Item -LiteralPath ${temp} -Destination ${target} -Force`,
  ];
  const inner = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$p = Get-Process -Id ${pid}`,
    'if (-not $p) { exit 0 }',
    `$expected = [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime`,
    `if ([math]::Abs(($p.StartTime.ToUniversalTime() - $expected).TotalSeconds) -gt ${SAME_PROCESS_TOLERANCE_SECONDS}) { exit 0 }`,
    // The handle must be open before the end, or the exit code is gone with the process.
    '$null = $p.Handle',
    '$p.WaitForExit()',
    '$code = $p.ExitCode',
    // The exit code reaches the disk first: the process query below may be slow or hang with WMI.
    `$record = [ordered]@{ pid = ${pid}; startedAtMs = ${startedAt}; exitCode = $code; endedAt = (Get-Date).ToUniversalTime().ToString('o'); aliveAfterExit = @() }`,
    ...save,
    evidenceFunctionScript(pid),
    // only processes started before the end: a quick reopen's own children must not take the places
    '$end = Get-Date',
    `$since = $end.AddSeconds(-${RECENT_WINDOW_SECONDS})`,
    '$record.aliveAfterExit = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $since -and $_.CreationDate -le $end } | Sort-Object CreationDate |' +
      ` Select-Object -Last ${RECENT_MAX} | ForEach-Object {` +
      // only a candidate to killer (or a child of the main) is searched; the command line itself is never written
      ` $ev = @{ evidence = @(); mentionsMain = $false }; if ($_.Name -match ${psQuote(KILLER_CANDIDATES)} -or $_.ParentProcessId -eq ${pid}) { $ev = Get-KillEvidence ([string]$_.CommandLine) };` +
      " [ordered]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name;" +
      " startedAt = $_.CreationDate.ToUniversalTime().ToString('o'); evidence = @($ev.evidence); mentionsMain = $ev.mentionsMain } })",
    // the next boot may have read (and removed) the first write already: then it was told, and is not written again
    `if (-not (Test-Path -LiteralPath ${target})) { exit 0 }`,
    ...save,
  ].join('\n');
  const hop =
    "Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive'," +
    `'-ExecutionPolicy','Bypass','-EncodedCommand','${encode(inner)}'`;
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(hop)],
  };
}

export interface AliveProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly startedAt: string;
  /** What in its command line looked like a kill (masked); empty for a process that is not a candidate. */
  readonly evidence: readonly string[];
  readonly mentionsMain: boolean;
}

export interface ExitRecord {
  readonly pid: number;
  readonly startedAtMs: number;
  readonly exitCode: number;
  readonly cause: ExitCause;
  readonly endedAt: string;
  /** Processes started in the 2 min before the end and still alive after it (not the short-lived killer itself). */
  readonly aliveAfterExit: readonly AliveProcess[];
}

interface RunId {
  readonly pid: number;
  readonly startedAtMs: number;
}

const RECORD_NAME = /^main-exit-(\d+)-(\d+)\.json(\.tmp)?$/;

/** `<dir>/main-exit-<pid>-<start>.json`: one record per run. */
export function exitRecordPath(dir: string, run: RunId): string {
  return join(dir, `main-exit-${Math.trunc(run.pid)}-${Math.trunc(run.startedAtMs)}.json`);
}

/**
 * The record at `path` when it belongs to `run` (any run when omitted), removed once read; `null` when there is none
 * yet, it is unreadable, its exit code was not read, or it is another run's (left in place). Never throws.
 */
export function takeExitRecord(path: string, run?: RunId): ExitRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  if (typeof v.pid !== 'number' || typeof v.startedAtMs !== 'number' || typeof v.exitCode !== 'number') return null;
  if (run && (v.pid !== run.pid || v.startedAtMs !== run.startedAtMs)) return null;
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
  const alive = (Array.isArray(v.aliveAfterExit) ? (v.aliveAfterExit as Partial<AliveProcess>[]) : []).map((p) => ({
    pid: Number(p?.pid),
    ppid: Number(p?.ppid),
    name: String(p?.name ?? ''),
    startedAt: String(p?.startedAt ?? ''),
    evidence: (Array.isArray(p?.evidence) ? p.evidence : []).slice(0, EVIDENCE_MAX).map((piece) => maskForLog(String(piece))),
    mentionsMain: p?.mentionsMain === true,
  }));
  return {
    pid: v.pid,
    startedAtMs: v.startedAtMs,
    exitCode: v.exitCode,
    cause: classifyExitCode(v.exitCode),
    endedAt: typeof v.endedAt === 'string' ? v.endedAt : '',
    aliveAfterExit: alive,
  };
}

/**
 * Every record in `dir` except the one of `keep` (the previous run, read on its own), each removed once read. A file
 * that is not a valid record is removed too, so they never pile up. Never throws.
 */
export function takeStrayExitRecords(dir: string, keep: RunId | null): ExitRecord[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const records: ExitRecord[] = [];
  for (const name of names) {
    const match = RECORD_NAME.exec(name);
    if (!match) continue;
    if (keep && Number(match[1]) === keep.pid && Number(match[2]) === keep.startedAtMs) continue;
    const path = join(dir, name);
    // a `.tmp` left by a sentinel that stopped between the write and the move is only cleared
    const record = match[3] ? null : takeExitRecord(path);
    if (record) records.push(record);
    else {
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    }
  }
  return records;
}
