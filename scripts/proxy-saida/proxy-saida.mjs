#!/usr/bin/env node
// Proxy de saída do Donel (decisão do dono, 06/11/2026): as VPS falam com a Anthropic pelo IP da casa dele.
//
// Um arquivo, sem dependência, dois modos escolhidos pela config:
//
//   modo "pc"  — roda no PC do dono. Proxy HTTP CONNECT que escuta SÓ no IP da Tailscale, exige usuário e
//                senha, só abre túnel para os destinos da lista e grava uma linha por conexão (sem conteúdo).
//   modo "vps" — roda em cada VPS, em 127.0.0.1. É o HTTPS_PROXY das sessões do Claude. Manda os destinos da
//                lista para o proxy do PC e o resto direto. Se o PC não responde, cai para o direto (ou para,
//                se a config pedir), grava o aviso e volta sozinho quando o PC voltar.
//
// Uso: node proxy-saida.mjs <config.json>      sobe o proxy no modo da config
//      node proxy-saida.mjs hash                lê a senha do stdin e imprime o hash para a config do PC
//
// Desenho e operação: docs/handoffs/2026-11-06-proxy-no-pc.md.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Destinos que passam pelo proxy do PC (o domínio e os subdomínios dele). Medido em 06/11 com o Claude Code
 * 2.1.318 (`claude -p` numa VPS apontada direto para o proxy): api.anthropic.com, mcp-proxy.anthropic.com e a
 * telemetria do CLI no Datadog. claude.ai e platform.claude.com entram pelo login e pela renovação de token
 * (doc de network-config). `api.ipify.org` é a única exceção: devolve o IP de saída e serve para conferir de
 * qualquer VPS que ela sai pela casa. Os MCP (Seazone, Supabase...) não são do Claude Code e ficam fora.
 */
export const DEFAULT_ALLOW = [
  'anthropic.com',
  'claude.ai',
  'claude.com',
  'http-intake.logs.us5.datadoghq.com',
  'api.ipify.org',
];

const TAILNET = { base: (100 << 24) | (64 << 16), mask: 0xffc00000 }; // 100.64.0.0/10 (CGNAT da Tailscale)

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n >>> 0;
}

/** True para um IPv4 da faixa da Tailscale (aceita a forma IPv4-mapeada `::ffff:100.x.y.z`). */
export function isTailnetAddress(address) {
  const n = ipv4ToInt(String(address ?? '').replace(/^::ffff:/i, ''));
  return n !== null && ((n & TAILNET.mask) >>> 0) === TAILNET.base >>> 0;
}

/** O proxy do PC nunca escuta fora da Tailscale: nem 0.0.0.0, nem a rede de casa, nem IPv6. */
export function assertTailnetBind(bind) {
  if (!isTailnetAddress(bind)) {
    throw new Error(`bind recusado: "${bind}" não é um IP da Tailscale (100.64.0.0/10)`);
  }
}

/** `host:porta` do CONNECT (aceita `[ipv6]:porta`). Null quando malformado. */
export function parseConnectTarget(target) {
  const m = /^(?:\[([0-9a-fA-F:.]+)\]|([^\s:/[\]]+)):(\d{1,5})$/.exec(String(target ?? ''));
  if (!m) return null;
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return null;
  return { host: (m[1] ?? m[2]).toLowerCase().replace(/\.$/, ''), port };
}

/** Só a porta 443 dos domínios da lista (o próprio domínio ou um subdomínio dele). */
export function isAllowed(host, port, allow = DEFAULT_ALLOW) {
  if (port !== 443) return false;
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return allow.some((d) => {
    const domain = String(d).toLowerCase().replace(/^\*?\./, '');
    return h === domain || h.endsWith(`.${domain}`);
  });
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Confere o `Proxy-Authorization: Basic ...` contra usuário e hash da config, em tempo constante. */
export function checkProxyAuth(header, user, passwordHash) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(String(header ?? ''));
  const [scheme, salt, expected] = String(passwordHash ?? '').split('$');
  if (!m || scheme !== 'scrypt' || !salt || !expected) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const userOk = decoded.slice(0, sep) === user;
  const got = Buffer.from(hashPassword(decoded.slice(sep + 1), salt).split('$')[2], 'hex');
  const want = Buffer.from(expected, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want) && userOk;
}

// ---------------------------------------------------------------------------------------------------------
// Log: uma linha JSON por evento, nunca conteúdo nem senha. Gira em 10 MB (fica o .1).

function expandHome(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function makeLogger(file) {
  const target = expandHome(file);
  if (target) fs.mkdirSync(path.dirname(target), { recursive: true });
  return (entry) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    console.log(line);
    if (!target) return;
    try {
      if (fs.existsSync(target) && fs.statSync(target).size > 10 * 1024 * 1024) fs.renameSync(target, `${target}.1`);
      fs.appendFileSync(target, `${line}\n`);
    } catch (error) {
      console.error(`log falhou: ${error.message}`);
    }
  };
}

function reply(socket, status, text, extra = '') {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${text}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);
}

/** Liga dois sockets e chama `done(bytesUp, bytesDown)` uma vez, quando qualquer lado fecha. */
function pipeBoth(client, upstream, done) {
  let up = 0;
  let down = 0;
  let finished = false;
  client.on('data', (c) => { up += c.length; });
  upstream.on('data', (c) => { down += c.length; });
  const finish = () => {
    if (finished) return;
    finished = true;
    client.destroy();
    upstream.destroy();
    done(up, down);
  };
  client.on('close', finish).on('error', finish);
  upstream.on('close', finish).on('error', finish);
  client.pipe(upstream);
  upstream.pipe(client);
}

// ---------------------------------------------------------------------------------------------------------
// Modo PC

export function startPcProxy(config, log = makeLogger(config.log)) {
  assertTailnetBind(config.bind);
  if (!config.usuario || !String(config.senhaHash ?? '').startsWith('scrypt$')) {
    throw new Error('config do PC sem usuario/senhaHash');
  }
  const allow = config.permitir ?? DEFAULT_ALLOW;
  // O scrypt trava o processo ~150 ms; o CLI abre ~10 conexões de uma vez e o relay desiste em 4 s. Guarda o
  // último cabeçalho aceito (em memória) para conferir só uma vez por senha.
  let acceptedAuth = null;
  const authOk = (header) => {
    if (header && header === acceptedAuth) return true;
    if (!checkProxyAuth(header, config.usuario, config.senhaHash)) return false;
    acceptedAuth = header;
    return true;
  };
  const server = http.createServer((req, res) => {
    res.writeHead(405, { Connection: 'close' }).end();
  });
  server.on('connect', (req, client, head) => {
    const started = Date.now();
    const cliente = client.remoteAddress;
    const destino = req.url;
    const base = { cliente, destino };
    client.on('error', () => {});
    if (!isTailnetAddress(cliente)) {
      log({ ...base, decisao: 'fora-da-tailnet' });
      return client.destroy();
    }
    if (!authOk(req.headers['proxy-authorization'])) {
      log({ ...base, decisao: 'senha-recusada' });
      return reply(client, 407, 'Proxy Authentication Required', 'Proxy-Authenticate: Basic realm="donel"\r\n');
    }
    const target = parseConnectTarget(destino);
    if (!target || !isAllowed(target.host, target.port, allow)) {
      log({ ...base, decisao: 'fora-da-lista' });
      return reply(client, 403, 'Forbidden');
    }
    const upstream = net.connect({ host: target.host, port: target.port });
    upstream.setTimeout(15_000, () => upstream.destroy(new Error('timeout')));
    let connected = false;
    upstream.once('error', (error) => {
      if (connected) return; // depois do túnel aberto, quem cuida é o pipeBoth
      log({ ...base, decisao: 'erro', erro: error.code ?? error.message });
      reply(client, 502, 'Bad Gateway');
    });
    upstream.once('connect', () => {
      connected = true;
      upstream.setTimeout(0);
      if (client.destroyed) return upstream.destroy();
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      pipeBoth(client, upstream, (bytesUp, bytesDown) =>
        log({ ...base, decisao: 'permitido', bytesUp, bytesDown, ms: Date.now() - started }),
      );
    });
  });
  // No boot do Windows a Tailscale pode subir depois do proxy: sem o IP ainda, tenta de novo a cada 10 s.
  const listen = () => server.listen(config.porta, config.bind);
  server.on('error', (error) => {
    log({ evento: 'escuta-falhou', erro: error.code ?? error.message, bind: config.bind, porta: config.porta });
    setTimeout(listen, 10_000).unref();
  });
  server.on('listening', () => log({ evento: 'escutando', bind: config.bind, porta: config.porta, destinos: allow }));
  listen();
  return server;
}

// ---------------------------------------------------------------------------------------------------------
// Modo VPS

/**
 * Abre um túnel CONNECT pelo proxy do PC. Resolve com o socket já em túnel; rejeita com `{ status }` ou erro de rede.
 * Dois prazos: chegar no PC (curto: PC desligado não responde nada, o firewall do Windows descarta) e o PC
 * responder (longo: inclui ele conectar no destino, que de casa às vezes leva segundos).
 */
export function connectViaUpstream(upstream, host, port, { connectMs = 4000, replyMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: upstream.host, port: upstream.porta });
    let buffered = Buffer.alloc(0);
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(connectMs, () => fail(Object.assign(new Error('PC não atendeu'), { code: 'ETIMEDOUT' })));
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.setTimeout(replyMs, () => fail(Object.assign(new Error('PC não respondeu'), { code: 'ESEMRESPOSTA' })));
      const auth = Buffer.from(`${upstream.usuario}:${upstream.senha}`).toString('base64');
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
    });
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buffered.length > 16 * 1024) fail(new Error('resposta do proxy do PC grande demais'));
        return;
      }
      socket.off('data', onData);
      socket.off('error', fail);
      socket.setTimeout(0);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buffered.subarray(0, end).toString('latin1'))?.[1]);
      if (status !== 200) {
        socket.destroy();
        return reject(Object.assign(new Error(`proxy do PC respondeu ${status}`), { status }));
      }
      resolve({ socket, rest: buffered.subarray(end + 4) });
    };
    socket.on('data', onData);
  });
}

function connectDirect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(15_000, () => socket.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.off('error', reject);
      socket.setTimeout(0);
      resolve({ socket, rest: Buffer.alloc(0) });
    });
  });
}

/**
 * Estado do caminho até o PC. `usarProxy()` diz se a próxima conexão da lista tenta o PC. Ao cair, grava o
 * aviso uma vez e testa o PC a cada `probeMs`; quando ele volta, grava a volta e as conexões retornam a ele.
 */
export function createUpstreamHealth({ probe, log, onChange = () => {}, probeMs = 15_000, queda = 'direto' }) {
  let up = true;
  let timer = null;
  let since = new Date().toISOString();
  const schedule = () => {
    timer = setTimeout(async () => {
      timer = null;
      if (await probe().then(() => true, () => false)) markUp();
      else schedule();
    }, probeMs);
    timer.unref?.();
  };
  const markUp = () => {
    if (up) return;
    up = true;
    since = new Date().toISOString();
    log({ evento: 'proxy-voltou', caminho: 'proxy do PC' });
    onChange({ estado: 'proxy', desde: since });
  };
  const markDown = (motivo) => {
    if (!up) return;
    up = false;
    since = new Date().toISOString();
    const caminho = queda === 'parar' ? 'parado' : 'direto (IP da nuvem)';
    const aviso =
      queda === 'parar'
        ? 'Proxy do PC fora; o Claude desta VPS está parado até o PC voltar.'
        : 'Proxy do PC fora; o Claude desta VPS está saindo direto, pelo IP da nuvem, até o PC voltar.';
    log({ evento: 'proxy-caiu', motivo, caminho, aviso });
    onChange({ estado: queda === 'parar' ? 'parado' : 'direto', desde: since, motivo });
    if (!timer) schedule();
  };
  /** Um destino falhou mas o PC atendeu: só cai se o PC também não alcança a Anthropic agora. */
  const recheck = (motivo) => {
    if (up) probe().catch(() => markDown(motivo));
  };
  return { usarProxy: () => up, markUp, markDown, recheck, stop: () => timer && clearTimeout(timer) };
}

export function startVpsRelay(config, log = makeLogger(config.log)) {
  const upstream = config.upstream;
  if (!upstream?.host || !upstream?.porta || !upstream?.usuario || !upstream?.senha) {
    throw new Error('config da VPS sem upstream.host/porta/usuario/senha');
  }
  const queda = config.queda === 'parar' ? 'parar' : 'direto';
  const allow = config.permitir ?? DEFAULT_ALLOW;
  const stateFile = expandHome(config.estado);
  const writeState = (state) => {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, `${JSON.stringify({ ...state, queda })}\n`);
    } catch (error) {
      console.error(`estado falhou: ${error.message}`);
    }
  };
  const health = createUpstreamHealth({
    queda,
    log,
    onChange: writeState,
    probeMs: config.testeMs ?? 15_000,
    probe: () => connectViaUpstream(upstream, 'api.anthropic.com', 443).then(({ socket }) => socket.destroy()),
  });
  writeState({ estado: 'proxy', desde: new Date().toISOString() });

  const server = http.createServer((req, res) => {
    res.writeHead(405, { Connection: 'close' }).end();
  });
  server.on('connect', async (req, client, head) => {
    client.on('error', () => {});
    const target = parseConnectTarget(req.url);
    if (!target) return reply(client, 400, 'Bad Request');
    let tunnel;
    try {
      if (!isAllowed(target.host, target.port, allow)) {
        tunnel = await connectDirect(target.host, target.port);
      } else if (health.usarProxy()) {
        try {
          tunnel = await connectViaUpstream(upstream, target.host, target.port);
        } catch (error) {
          // 403 = o PC recusou o destino: devolve a recusa, sem contornar pelo direto.
          if (error.status === 403) return reply(client, 403, 'Forbidden');
          // 502: o PC atendeu mas não chegou NESTE destino (de casa, às vezes um IP do Cloudflare demora).
          // Esta conexão segue pela queda; o caminho todo só cai se o PC também não alcançar a Anthropic.
          if (error.status === 502) health.recheck('proxy do PC não alcança a Anthropic');
          else health.markDown(error.status ? `proxy do PC respondeu ${error.status}` : (error.code ?? error.message));
        }
      }
      if (!tunnel) {
        if (queda === 'parar') return reply(client, 503, 'Service Unavailable');
        tunnel = await connectDirect(target.host, target.port);
      }
    } catch (error) {
      return reply(client, 502, 'Bad Gateway');
    }
    if (client.destroyed) return tunnel.socket.destroy();
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (tunnel.rest.length) client.write(tunnel.rest);
    if (head?.length) tunnel.socket.write(head);
    pipeBoth(client, tunnel.socket, () => {});
  });
  server.on('error', (error) => {
    log({ evento: 'escuta-falhou', erro: error.code ?? error.message });
    process.exitCode = 1;
  });
  server.listen(config.porta ?? 3128, '127.0.0.1', () =>
    log({ evento: 'escutando', bind: '127.0.0.1', porta: config.porta ?? 3128, upstream: `${upstream.host}:${upstream.porta}`, queda }),
  );
  return { server, health };
}

// ---------------------------------------------------------------------------------------------------------

async function main(argv) {
  if (argv[0] === 'hash') {
    const input = fs.readFileSync(0, 'utf8').trim(); // trim tira também um BOM perdido
    if (!input) throw new Error('senha vazia no stdin');
    process.stdout.write(`${hashPassword(input)}\n`);
    return;
  }
  if (!argv[0]) throw new Error('uso: node proxy-saida.mjs <config.json> | hash');
  const config = JSON.parse(fs.readFileSync(expandHome(argv[0]), 'utf8').trimStart()); // trimStart tira o BOM que o PowerShell 5.1 grava
  if (config.modo === 'pc') startPcProxy(config);
  else if (config.modo === 'vps') startVpsRelay(config);
  else throw new Error(`modo desconhecido: ${config.modo}`);
  process.on('uncaughtException', (error) => console.error(`erro não tratado: ${error.stack ?? error}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
