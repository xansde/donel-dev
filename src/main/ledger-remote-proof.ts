// Cartas forma A, fatia 6 (spec docs/specs/cartas-forma-a.md, A2.2) — a proof file delivered by a session that runs
// on a remote place (the VPS). The path is on the VPS, not on this PC: the main reads it through the place's own ssh
// (the same access as remote-session.ts), checks it there and keeps only the bytes, in `ledger-provas/`.
//
// The path comes from an agent. It is never put into a shell command as text: the remote runs a FIXED script, and
// the path reaches it as `$1`, single-quoted on the ssh command line (`shQuote`). Only an absolute path with a known
// extension; a symbolic link is refused there (`test -L`); the size is read first (`stat -c %s`) and a file over the
// limit is never sent; stdout is cut at the limit anyway.

import { spawn } from 'node:child_process';
import { maxProofBytes, PROOF_FILE_TYPES } from '../shared/ledger/contract';
import { shQuote } from './remote-session';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
const FETCH_TIMEOUT_MS = 60_000;

/** Exit codes of the fixed script. */
const EXIT_LINK = 3;
const EXIT_NOT_FILE = 4;
const EXIT_TOO_BIG = 5;

/** The fixed script: `$1` is the path, `$2` the limit in bytes. Nothing of the agent's text is part of it. */
const SCRIPT = [
  'p="$1"; max="$2"',
  `if [ -L "$p" ]; then exit ${EXIT_LINK}; fi`,
  `if [ ! -f "$p" ]; then exit ${EXIT_NOT_FILE}; fi`,
  's=$(stat -c %s -- "$p") || exit 4',
  `if [ "$s" -gt "$max" ]; then exit ${EXIT_TOO_BIG}; fi`,
  'exec cat -- "$p"',
].join('\n');

export type RemoteProofCheck = { readonly ok: true; readonly ext: string; readonly mediaType: string; readonly maxBytes: number } | { readonly ok: false; readonly error: string };

/** Pure — what may be asked of the VPS at all: an absolute path, no control characters, a known extension. */
export function checkRemoteProofPath(path: string): RemoteProofCheck {
  if (!path.startsWith('/') || /[\0\n\r]/.test(path)) return { ok: false, error: `"${path}": na VPS, use o caminho absoluto do arquivo (começa com /).` };
  const ext = /\.([A-Za-z0-9]{2,5})$/.exec(path)?.[1]?.toLowerCase() ?? '';
  const mediaType = PROOF_FILE_TYPES[ext];
  if (!mediaType) return { ok: false, error: `"${path}": a prova em arquivo é print, vídeo ou protótipo HTML (${Object.keys(PROOF_FILE_TYPES).join(', ')}). Saída de comando vai como texto.` };
  return { ok: true, ext, mediaType, maxBytes: maxProofBytes(mediaType) };
}

/** Pure — the remote command line: the fixed script, then the path and the limit as quoted arguments. */
export function buildRemoteProofCommand(path: string, maxBytes: number): string {
  return `bash -c ${shQuote(SCRIPT)} donel-prova ${shQuote(path)} ${String(Math.floor(maxBytes))}`;
}

export type RemoteProofResult = { readonly ok: true; readonly bytes: Buffer; readonly ext: string; readonly mediaType: string } | { readonly ok: false; readonly error: string };

export interface RemoteProofRunner {
  /** Runs `command` on `sshTarget`; resolves with the exit code and at most `maxBytes + 1` bytes of stdout. */
  (sshTarget: string, command: string, maxBytes: number): Promise<{ readonly code: number | null; readonly stdout: Buffer }>;
}

export const sshRemoteProofRunner: RemoteProofRunner = (sshTarget, command, maxBytes) =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('ssh', [...SSH_OPTIONS, '-T', '--', sshTarget, command], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ code: null, stdout: Buffer.alloc(0) });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), FETCH_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (size > maxBytes) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size > maxBytes) child.kill(); // never more than the limit, whatever the remote does
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stdout: Buffer.concat(chunks) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks) });
    });
  });

/** Reads a proof file of the VPS through the place's ssh. */
export async function fetchRemoteProof(sshTarget: string, path: string, run: RemoteProofRunner = sshRemoteProofRunner): Promise<RemoteProofResult> {
  const check = checkRemoteProofPath(path);
  if (!check.ok) return check;
  const { code, stdout } = await run(sshTarget, buildRemoteProofCommand(path, check.maxBytes), check.maxBytes);
  const mb = check.maxBytes / 1024 / 1024;
  if (code === EXIT_LINK) return { ok: false, error: `"${path}" é um atalho (link simbólico) na VPS; mande o arquivo de verdade.` };
  if (code === EXIT_NOT_FILE) return { ok: false, error: `"${path}" não é um arquivo na VPS (o caminho existe lá?).` };
  if (code === EXIT_TOO_BIG || stdout.length > check.maxBytes) return { ok: false, error: `"${path}" passa de ${mb} MB.` };
  if (code !== 0) return { ok: false, error: `Não consegui ler "${path}" pela conexão com a VPS. Mande a prova como texto ou link.` };
  return { ok: true, bytes: stdout, ext: check.ext, mediaType: check.mediaType };
}
