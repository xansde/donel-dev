// Passo 9 (t-5358d400), PR 3 — the phone's door (47815) when the entregador runs apart. The chat with the Líder único
// (`/api/v2/chat`, `chat/audio` (and its `parte`/`fim`), `chat/arquivo`, `chat/correcao`, `ping`) is answered by the entregador itself, so the owner's words reach
// the Líder and his answer comes back with the registro (donel-oraculo) down. Every other route (cards, decisions,
// tasks he asks for, the PWA, pairing, push) goes byte for byte to the registro's phone server, which listens on 47818
// then: same method, path, headers and body, so the device's signature still checks out there. The app keeps its origin.
//
// The signatures are checked here against `celular.json` read only: that file has one writer, the registro (pairing,
// revoking, `lastSeenAt`). The entregador re-reads it when it changes and never writes it.

import { statSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createCelularAuth, type CelularAuth } from '../main/celular/auth';
import { fromTailnet, mobileRequestListener, type MobileHandler } from '../main/celular/server';
import type { ConfigIoDeps } from '../main/config-store';

/** The registro's phone server with the entregador apart (DONEL_CELULAR_PORT, else this). */
export const CELULAR_REGISTRO_PORT = 47818;
export const registroPhonePort = (env: Readonly<Record<string, string | undefined>> = process.env): number => Number(env.DONEL_CELULAR_PORT) || CELULAR_REGISTRO_PORT;

/**
 * The routes the entregador answers; the rest of the phone's server is the registro's. t-c441e144: the credential box
 * too, because it announces in the chat (one writer of the conversation): its body is never proxied, only read here.
 * t-b07b50ff: the phone's warnings (`avisos`, a long-poll over the chat that lives here).
 */
const CHAT_ROUTES: ReadonlySet<string> = new Set(['/api/v2/chat', '/api/v2/chat/audio', '/api/v2/chat/audio/parte', '/api/v2/chat/audio/fim', '/api/v2/chat/arquivo', '/api/v2/chat/correcao', '/api/v2/ping', '/api/v2/credencial', '/api/v2/avisos']);
export const isChatRoute = (url: string): boolean => CHAT_ROUTES.has(url.split('?')[0] ?? '');

/**
 * Passo 9 — the Android app's pairing (`/local/celular/novo-aparelho` on the entregador's gate) asks the registro, which
 * writes `celular.json`, through the gate credential marked local (`isLocalGate`).
 */
export const GATE_PHONE_PAIR_PATH = '/v1/portao/celular/novo-aparelho';

const BAD_GATEWAY = JSON.stringify({ erro: 'registro-fora', mensagem: 'O Oráculo da VPS está reiniciando; tente de novo em instantes.' });

/** One request to the registro's phone server, as it came: method, path with query, headers and body untouched. */
function proxy(req: IncomingMessage, res: ServerResponse, target: { readonly host: string; readonly port: number }, log: (line: string) => void): void {
  const out = httpRequest({ host: target.host, port: target.port, method: req.method, path: req.url, headers: req.headers });
  out.once('response', (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
    answer.pipe(res);
  });
  out.once('error', (error) => {
    log(`[celular-frente] o servidor do celular do registro não respondeu: ${error.message}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(BAD_GATEWAY);
  });
  // The phone gave up: the registro's half is dropped too.
  res.once('close', () => {
    if (!res.writableFinished) out.destroy();
  });
  req.pipe(out);
}

/** The socket of the entregador's 47815: the chat here (`chat`), the rest to the registro (`upstream`). */
export function createPhoneFront(deps: {
  readonly chat: MobileHandler;
  readonly upstream: () => { readonly host: string; readonly port: number };
  readonly log?: (line: string) => void;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const log = deps.log ?? ((line: string) => console.log(line));
  const chat = mobileRequestListener(deps.chat);
  return (req, res) => {
    if (isChatRoute(req.url ?? '')) {
      chat(req, res);
      return;
    }
    // The registro sees this machine's own Tailscale address: who may come in is decided here, as its server does.
    if (!fromTailnet(req.socket.remoteAddress, req.headers)) {
      res.writeHead(403).end();
      req.socket.destroy();
      return;
    }
    proxy(req, res, deps.upstream(), log);
  };
}

/** `io` that reads and never writes: `celular.json` is the registro's. */
function readOnly(io: ConfigIoDeps): ConfigIoDeps {
  const refuse = (): never => {
    throw new Error('celular.json é só leitura no entregador');
  };
  return { ...io, writeFileText: refuse, renameFile: refuse, mkdirSync: refuse, unlinkFile: () => undefined };
}

/** The paired phones as the registro left them in `celular.json`, re-read when it changes; never written here. */
export function createPhoneSignatures(filePath: string, io: ConfigIoDeps): {
  enabled(): boolean;
  verify(message: string, signatureHex: string): { readonly name: string } | null;
} {
  const reader = readOnly(io);
  let seen: { readonly mtime: number; readonly auth: CelularAuth } | null = null;
  const current = (): CelularAuth | null => {
    try {
      const mtime = statSync(filePath).mtimeMs;
      if (seen?.mtime !== mtime) seen = { mtime, auth: createCelularAuth({ filePath, io: reader }) };
      return seen.auth;
    } catch {
      return null;
    }
  };
  return {
    enabled: () => current()?.enabled ?? false,
    verify: (message, signatureHex) => {
      const device = current()?.verifySignature(message, signatureHex);
      return device ? { name: device.name } : null;
    },
  };
}
