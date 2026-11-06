// Serviço da VPS — canal local entre o processo do systemd e os comandos do
// dono (`donel-servico contas ...`). Socket Unix em `~/.donel/servico.sock`,
// numa pasta 0700: só o usuário do serviço fala com ele. Uma linha JSON de
// pedido, uma linha JSON de resposta. Nenhum pedido nem resposta carrega par
// de credencial (os comandos levam pasta, rótulo e id).

import { createConnection, createServer, type Server } from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';

export interface SocketRequest {
  readonly cmd: string;
  readonly args: readonly string[];
}

export type SocketHandler = (request: SocketRequest) => Promise<unknown>;

const MAX_REQUEST_BYTES = 64 * 1024;

export function listenOnSocket(socketPath: string, handler: SocketHandler): Promise<Server> {
  if (existsSync(socketPath)) unlinkSync(socketPath);
  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, reason: 'pedido-grande-demais' })}\n`);
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = '';
      let request: SocketRequest;
      try {
        const parsed = JSON.parse(line) as Partial<SocketRequest>;
        if (typeof parsed.cmd !== 'string' || !Array.isArray(parsed.args) || !parsed.args.every((arg) => typeof arg === 'string')) throw new Error('bad');
        request = { cmd: parsed.cmd, args: parsed.args };
      } catch {
        socket.end(`${JSON.stringify({ ok: false, reason: 'pedido-invalido' })}\n`);
        return;
      }
      handler(request)
        .then((result) => socket.end(`${JSON.stringify(result)}\n`))
        .catch(() => socket.end(`${JSON.stringify({ ok: false, reason: 'erro-interno' })}\n`));
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      try {
        chmodSync(socketPath, 0o600);
      } catch {
        // a pasta 0700 já protege
      }
      resolve(server);
    });
  });
}

export function sendToSocket(socketPath: string, request: SocketRequest, timeoutMs = 120_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('o serviço não respondeu a tempo'));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.trim()) as unknown);
      } catch {
        reject(new Error('resposta ilegível do serviço'));
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
