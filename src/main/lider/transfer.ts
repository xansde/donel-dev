// Líder único na VPS — the conversation of the Líder travels as a file stream over ssh, never embedded in a script
// (a 19 MB transcript in a heredoc took 27 s to build on the main thread and 460 s for `bash` to read). Both ways are
// checked by size and sha256 on the other side before the copy counts; a copy that does not check out leaves
// nothing behind. docs/planos/lider-na-vps.md.

import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, rmSync, statSync } from 'node:fs';
import { shQuote } from '../remote-session';

/** Runs one shell command line on the place (production: `ssh <target> <command>`); stdin and stdout are piped. */
export type RemoteCommand = (command: string) => ChildProcess;

export type SendTranscriptResult = { readonly ok: true; readonly outcome: 'carried' | 'kept' } | { readonly ok: false; readonly reason: string };
export type FetchTranscriptResult = { readonly ok: true; readonly size: number } | { readonly ok: false; readonly reason: string };

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Time for a copy of `bytes`: generous (a slow link), the failure is harmless (the Líder stays where it is). */
function timeoutFor(bytes: number): number {
  return 30_000 + Math.ceil(bytes / 100_000) * 1000;
}

/** The lines that find the transcript of `sid` for the project folder, as the CLI names it (`$T`). */
function transcriptPathLines(homeRelativeDir: string, sid: string): string[] {
  if (!SESSION_ID_PATTERN.test(sid)) throw new Error('Id de sessão inválido para lugar remoto.');
  return [
    `D=$(cd "$HOME"/${shQuote(homeRelativeDir)} 2>/dev/null && pwd) || { echo "DONEL_ERR A pasta do Líder não existe no lugar remoto."; exit 3; }`,
    'SLUG=$(printf %s "$D" | sed "s/[^a-zA-Z0-9]/-/g")',
    'P="$HOME/.claude/projects/$SLUG"',
    `T="$P/${sid}.jsonl"`,
  ];
}

function hashOf(path: string, bytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    if (bytes === 0) {
      resolve(hash.digest('hex'));
      return;
    }
    createReadStream(path, { start: 0, end: bytes - 1 })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Runs `command`, feeding stdin from `input` (or nothing) and handing raw stdout to `onStdout` (or collecting it). */
function runCommand(
  run: RemoteCommand,
  command: string,
  timeoutMs: number,
  io: { readonly input?: NodeJS.ReadableStream; readonly onStdout?: (chunk: Buffer) => void } = {},
): Promise<Ran> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = run(command);
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    const finish = (code: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (io.onStdout) io.onStdout(chunk);
      else stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4096);
    });
    child.on('error', (error) => {
      stderr = stderr || error.message;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    // The other side may stop reading (an error there): that is its answer, not a crash here.
    child.stdin?.on('error', () => undefined);
    if (io.input) {
      io.input.on('error', () => child.kill());
      io.input.pipe(child.stdin!);
    } else {
      child.stdin?.end();
    }
  });
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return (lines[lines.length - 1] ?? '').slice(0, 300);
}

function failure(ran: Ran, what: string): string {
  const err = ran.stdout.split(/\r?\n/).find((line) => line.startsWith('DONEL_ERR'));
  if (err) return err.slice('DONEL_ERR'.length).trim();
  if (ran.timedOut) return `${what} demorou demais.`;
  const said = lastLine(ran.stderr);
  return said ? `${what} falhou (${said}).` : `${what} falhou.`;
}

/**
 * Ida — copies the local transcript `sourcePath` to the CLI's transcript of `sid` on the place. Before it, the old
 * Líder of the same conversation that may still run there (a way back that could not end it) is ended: the new one
 * must never attach to it. Only a larger copy replaces the one there, which stays as `.bak-<time>`.
 */
export async function sendTranscriptToRemote(run: RemoteCommand, homeRelativeDir: string, sid: string, sourcePath: string): Promise<SendTranscriptResult> {
  let size: number;
  try {
    size = statSync(sourcePath).size;
  } catch {
    return { ok: false, reason: 'a conversa não está neste computador.' };
  }
  const sha = await hashOf(sourcePath, size);
  const script = [
    'set -u',
    ...transcriptPathLines(homeRelativeDir, sid),
    `tmux -L donel kill-session -t ${shQuote(`donel-${sid}`)} >/dev/null 2>&1 || true`,
    'mkdir -p "$P" || exit 4',
    'cat > "$T.chegando" || { rm -f "$T.chegando"; exit 4; }',
    'N=$(wc -c < "$T.chegando" | tr -d " ")',
    'H=$(sha256sum "$T.chegando" | cut -d " " -f 1)',
    `if [ "$N" != ${size} ] || [ "$H" != ${sha} ]; then rm -f "$T.chegando"; echo "DONEL_BAD $N"; exit 5; fi`,
    `if [ -f "$T" ] && [ "$(wc -c < "$T" | tr -d " ")" -ge ${size} ]; then rm -f "$T.chegando"; echo DONEL_KEPT; exit 0; fi`,
    'if [ -f "$T" ]; then mv "$T" "$T.bak-$(date +%s)"; fi',
    'mv "$T.chegando" "$T" && echo DONEL_CARRIED',
  ].join('\n');
  const input = size > 0 ? createReadStream(sourcePath, { start: 0, end: size - 1 }) : undefined;
  const ran = await runCommand(run, `bash -c ${shQuote(script)}`, timeoutFor(size), input ? { input } : {});
  const lines = ran.stdout.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes('DONEL_CARRIED')) return { ok: true, outcome: 'carried' };
  if (lines.includes('DONEL_KEPT')) return { ok: true, outcome: 'kept' };
  if (lines.some((line) => line.startsWith('DONEL_BAD'))) return { ok: false, reason: 'a conversa chegou diferente do que saiu daqui.' };
  return { ok: false, reason: failure(ran, 'A cópia da conversa') };
}

/**
 * Volta — downloads the CLI's transcript of `sid` from the place into `destPath` (a new file), checked by size and
 * sha256 against the place. `size` 0 = there is none there (nothing written). A failure removes what came.
 */
export async function fetchTranscriptFromRemote(run: RemoteCommand, homeRelativeDir: string, sid: string, destPath: string): Promise<FetchTranscriptResult> {
  const info = await runCommand(
    run,
    `bash -c ${shQuote(
      [
        'set -u',
        ...transcriptPathLines(homeRelativeDir, sid),
        'if [ ! -f "$T" ]; then echo DONEL_NONE; exit 0; fi',
        'N=$(wc -c < "$T" | tr -d " ")',
        'H=$(head -c "$N" "$T" | sha256sum | cut -d " " -f 1)',
        'echo "DONEL_FILE $N $H"',
      ].join('\n'),
    )}`,
    20_000,
  );
  const lines = info.stdout.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes('DONEL_NONE')) return { ok: true, size: 0 };
  const fileLine = lines.find((line) => /^DONEL_FILE \d+ [0-9a-f]{64}$/.test(line));
  if (!fileLine) return { ok: false, reason: failure(info, 'Ler a conversa no lugar remoto') };
  const [, sizeText, expectedSha] = fileLine.split(' ');
  const size = Number(sizeText);

  const out = createWriteStream(destPath);
  let writeFailed = false;
  out.on('error', () => {
    writeFailed = true;
  });
  const hash = createHash('sha256');
  let received = 0;
  const ran = await runCommand(
    run,
    `bash -c ${shQuote([...transcriptPathLines(homeRelativeDir, sid), `head -c ${size} "$T"`].join('\n'))}`,
    timeoutFor(size),
    {
      onStdout: (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        out.write(chunk);
      },
    },
  );
  await new Promise<void>((resolve) => out.end(resolve));
  if (!writeFailed && ran.code === 0 && received === size && hash.digest('hex') === expectedSha) return { ok: true, size };
  rmSync(destPath, { force: true });
  return { ok: false, reason: received !== size || ran.code !== 0 ? failure(ran, 'Trazer a conversa do lugar remoto') : 'a conversa chegou diferente da que está lá.' };
}
