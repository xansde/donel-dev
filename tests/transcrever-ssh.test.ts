import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { TranscribeError } from '../src/main/celular/transcrever';
import { sshVpsTranscriber, VPS_TRANSCRIBE_COMMAND, VPS_HEALTH_COMMAND } from '../src/main/celular/transcrever-ssh';

// t-0eb91241 (devolução do Revisor): um transcritor só. O Pedir por voz que o app do PC atende (Oráculo no PC) também
// vai ao transcritor da VPS, por ssh (ele só escuta em 127.0.0.1:8179 lá), e não ao OpenWhispr do PC, que saiu da
// inicialização em 16/11. Caminho: o WAV entra inteiro no stdin do ssh; volta: o texto chega ao pedido.

interface Place {
  readonly saude: string;
  readonly inferencia?: { readonly stdout: string; readonly code: number };
}

/** A fake `ssh <target> <command>`: answers by target and command; keeps what each got on stdin. */
function fakeSsh(places: Record<string, Place>) {
  const calls: Array<{ target: string; command: string; stdin: Buffer }> = [];
  const command = (target: string) => (cmd: string): ChildProcess => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const chunks: Buffer[] = [];
    const call = { target, command: cmd, stdin: Buffer.alloc(0) };
    calls.push(call);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(child, {
      stdout,
      stderr,
      kill: () => true,
      stdin: new Writable({
        write(chunk: Buffer, _enc, done) {
          chunks.push(chunk);
          done();
        },
        final(done) {
          call.stdin = Buffer.concat(chunks);
          done();
        },
      }),
    });
    setTimeout(() => {
      const place = places[target];
      if (!place) {
        stderr.end('ssh: connect to host: Connection timed out');
        stdout.end();
        child.emit('close', 255);
        return;
      }
      const answer = cmd === VPS_HEALTH_COMMAND ? { stdout: place.saude, code: 0 } : (place.inferencia ?? { stdout: '', code: 7 });
      stdout.end(answer.stdout);
      stderr.end();
      child.emit('close', answer.code);
    }, 5);
    return child;
  };
  return { command, calls };
}

const REMOTES = [
  { id: 'homolog', label: 'Homologações', sshTarget: 'root@homolog' },
  { id: 'vps', label: 'VPS pessoal', sshTarget: 'eu@vps' },
];

describe('o Pedir do PC transcreve no transcritor da VPS, por ssh', () => {
  it('acha a VPS que tem o transcritor, manda o WAV inteiro pelo stdin e o texto volta', async () => {
    const ssh = fakeSsh({
      'root@homolog': { saude: '' },
      'eu@vps': { saude: '{"ok": true, "modelo": "small"}', inferencia: { stdout: '{"text": "  Abre a tarefa do celular. "}\n200', code: 0 } },
    });
    const transcribe = sshVpsTranscriber({ remotes: () => REMOTES, command: ssh.command, timeoutMs: 1_000 });
    const audio = new Uint8Array([82, 73, 70, 70, 0, 255, 10, 13, 1, 2, 3]);
    expect(await transcribe(audio)).toBe('Abre a tarefa do celular.');
    const sent = ssh.calls.find((call) => call.command === VPS_TRANSCRIBE_COMMAND)!;
    expect(sent.target).toBe('eu@vps');
    expect([...sent.stdin]).toEqual([...audio]);
    // The place found stays: the next audio goes straight there, with no new health check.
    await transcribe(audio);
    expect(ssh.calls.filter((call) => call.command === VPS_HEALTH_COMMAND)).toHaveLength(2);
  });

  it('o comando remoto é fixo: só o loopback da VPS, nada vindo do áudio ou do nome do arquivo', () => {
    expect(VPS_TRANSCRIBE_COMMAND).toContain('http://127.0.0.1:8179/inference');
    expect(VPS_TRANSCRIBE_COMMAND).toContain('file=@-');
    expect(VPS_HEALTH_COMMAND).toContain('http://127.0.0.1:8179/saude');
  });

  it('nenhuma VPS com o transcritor: falha de conexão que diz "transcritor da VPS", nunca OpenWhispr', async () => {
    const ssh = fakeSsh({ 'root@homolog': { saude: '' } });
    const transcribe = sshVpsTranscriber({ remotes: () => REMOTES, command: ssh.command, timeoutMs: 1_000 });
    const failure = await transcribe(new Uint8Array([1])).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TranscribeError);
    expect((failure as TranscribeError).kind).toBe('conexao');
    expect((failure as TranscribeError).message).toContain('transcritor da VPS');
    expect((failure as TranscribeError).message).not.toContain('OpenWhispr');
  });

  it('o transcritor recusa (503) ou responde sem texto: o pedido falha sem inventar texto', async () => {
    for (const inferencia of [{ stdout: '{"error": "ocupado"}\n503', code: 0 }, { stdout: '{"nada": 1}\n200', code: 0 }]) {
      const ssh = fakeSsh({ 'eu@vps': { saude: '{"ok": true}', inferencia } });
      const transcribe = sshVpsTranscriber({ remotes: () => REMOTES, command: ssh.command, timeoutMs: 1_000 });
      const failure = await transcribe(new Uint8Array([1])).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(TranscribeError);
      expect(['recusou', 'sem-texto']).toContain((failure as TranscribeError).kind);
    }
  });
});
