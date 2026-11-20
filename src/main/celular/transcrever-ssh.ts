// t-0eb91241 — um transcritor só, na VPS. O Pedir por voz que o app do PC atende (com o Oráculo no PC) também vai ao
// transcritor residente da VPS, o mesmo do daemon do Oráculo e do áudio do chat do app. Ele só escuta em
// 127.0.0.1:8179 lá, então o PC chega por ssh: o áudio entra pelo stdin de um `curl` na VPS e o JSON volta pelo stdout.
// O OpenWhispr do PC (:8178) saiu da inicialização em 16/11. A VPS é a primeira dos lugares remotos cujo transcritor
// responde à /saude; ela fica guardada até falhar.

import type { ChildProcess } from 'node:child_process';
import { TranscribeError, type Transcribe } from './transcrever';

/** The health check, run on each remote place until one answers. */
export const VPS_HEALTH_COMMAND = 'curl -sS --max-time 5 http://127.0.0.1:8179/saude';
/**
 * The transcription, fixed: the audio comes on stdin (never in the command), and the last line is the HTTP status.
 * curl gives up at 570 s, before the PC's 600 (`VPS_TRANSCRIBE_TIMEOUT_MS`), so a slow transcription comes back as
 * "tempo" (curl's exit 28), not as a connection that fell; it tells the transcriber the PC waits 600 s.
 */
export const VPS_TRANSCRIBE_COMMAND =
  "curl -sS --max-time 570 -H 'X-Donel-Paciencia-S: 600' -w '\\n%{http_code}' -F 'file=@-;filename=pedido.wav;type=audio/wav' -F response_format=json -F language=pt http://127.0.0.1:8179/inference";
/** curl's "operation timed out". */
const CURL_TIMEOUT = 28;

const DOWN = 'O transcritor da VPS não respondeu. O áudio ficou guardado; tente de novo em um minuto ou escreva o pedido.';
const HEALTH_TIMEOUT_MS = 15_000;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly failed: boolean;
}

function run(child: ChildProcess, input: Uint8Array | null, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    let stdout = '';
    let timedOut = false;
    let settled = false;
    const finish = (result: Omit<Run, 'stdout' | 'timedOut'>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish({ code: null, failed: true });
    }, timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.resume();
    child.on('error', () => finish({ code: null, failed: true }));
    child.on('close', (code: number | null) => finish({ code, failed: false }));
    child.stdin?.on('error', () => undefined);
    if (input) child.stdin?.end(Buffer.from(input));
    else child.stdin?.end();
  });
}

export function sshVpsTranscriber(deps: {
  readonly remotes: () => readonly { readonly sshTarget: string }[];
  readonly command: (sshTarget: string) => (command: string) => ChildProcess;
  readonly timeoutMs: number;
}): Transcribe {
  let found: string | null = null;
  let foundAmong = '';

  async function place(): Promise<string> {
    const remotes = deps.remotes();
    // A change in the list of places (one added, one removed) looks for the transcriber again.
    const among = remotes.map((remote) => remote.sshTarget).join('\n');
    if (found && among === foundAmong) return found;
    found = null;
    foundAmong = among;
    for (const remote of remotes) {
      const health = await run(deps.command(remote.sshTarget)(VPS_HEALTH_COMMAND), null, HEALTH_TIMEOUT_MS);
      if (health.code === 0 && /"ok"\s*:\s*true/.test(health.stdout)) return (found = remote.sshTarget);
    }
    throw new TranscribeError('conexao', DOWN);
  }

  return async (audio) => {
    const target = await place();
    const result = await run(deps.command(target)(VPS_TRANSCRIBE_COMMAND), audio, deps.timeoutMs);
    if (result.timedOut || result.code === CURL_TIMEOUT) throw new TranscribeError('tempo', 'A transcrição demorou demais. O áudio ficou guardado; escreva o pedido.');
    if (result.failed || result.code !== 0) {
      // ssh or curl did not get through: look for the transcriber again on the next audio.
      found = null;
      throw new TranscribeError('conexao', DOWN);
    }
    const lines = result.stdout.trimEnd().split('\n');
    const status = Number(lines.pop());
    if (status !== 200) throw new TranscribeError('recusou', `O transcritor recusou o áudio (${Number.isFinite(status) ? status : 'sem status'}).`);
    let body: { text?: unknown } | null = null;
    try {
      body = JSON.parse(lines.join('\n')) as { text?: unknown };
    } catch {
      body = null;
    }
    if (!body || typeof body.text !== 'string') throw new TranscribeError('sem-texto', 'O transcritor não devolveu texto.');
    return body.text.replace(/\s+/g, ' ').trim();
  };
}
