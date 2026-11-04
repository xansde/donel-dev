// Lugares remotos (VPS) — leitura e escrita do `~/.claude` de OUTRA máquina,
// por `ssh`. Mora em src/main/accounts/ de propósito: é a mesma fronteira de
// credencial (CLAUDE.md, "Credenciais"), estendida pelo dono em 04/11/2026 para
// gravar o par da conta escolhida no lugar remoto. Regras que valem aqui:
//
// - O par só viaja pelo STDIN do `ssh` (canal cifrado), dentro do programa que
//   o `node` remoto executa. Nunca em argumento de linha de comando (aparece no
//   `ps` das duas pontas), nunca em log, nunca em mensagem de erro.
// - O mesmo contrato de `claude-state.ts`, do outro lado: escrita atômica
//   (temp + rename, modo 600), merge que preserva chaves desconhecidas, e o
//   bloco `oauthAccount` de `~/.claude.json` apagado para o CLI refazer o fetch
//   do perfil.
// - A escrita é condicional (compare-and-swap): só grava se o refresh token
//   em disco ainda for o que a leitura viu. Se o CLI remoto renovou no meio, o
//   par novo dele não é atropelado: a escrita volta `changed` e o motor relê,
//   captura e tenta de novo.
// - A identidade da conta em disco sai como sha256 do `accountUuid`, calculado
//   LÁ: e-mail e nome do `.claude.json` remoto nunca cruzam a rede.

import { spawn } from 'node:child_process';
import type { CredentialPair } from './account-mod';

export type RemoteReadResult =
  | { readonly kind: 'ok'; readonly pair: CredentialPair | null; readonly fingerprint: string | null }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'io' };

/** `changed` = o refresh token em disco não era mais o esperado: nada foi escrito. */
export type RemoteWriteResult = { readonly kind: 'written' } | { readonly kind: 'changed' } | { readonly kind: 'unreachable' } | { readonly kind: 'io' };

export interface RemoteClaudeState {
  read(sshTarget: string): Promise<RemoteReadResult>;
  /** `next: null` tira a credencial do lugar (o CLI de lá fica deslogado localmente; nada é revogado no servidor). */
  write(sshTarget: string, expectedRefreshToken: string | null, next: CredentialPair | null): Promise<RemoteWriteResult>;
}

type RemoteInput =
  | { readonly op: 'read' }
  | { readonly op: 'write'; readonly expectedRefreshToken: string | null; readonly next: CredentialPair | null };

/**
 * O programa que o `node` do lugar remoto executa (`node -`, lido do stdin).
 * `input` entra como literal JSON — JSON é JS válido, sem eval de nada vindo
 * da rede. Saída: UMA linha JSON no stdout. Exportado para o teste rodar o
 * mesmo texto contra um HOME temporário.
 */
export function buildRemoteProgram(input: RemoteInput): string {
  return `'use strict';
const INPUT = ${JSON.stringify(input)};
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const home = os.homedir();
const credPath = path.join(home, '.claude', '.credentials.json');
const claudeJsonPath = path.join(home, '.claude.json');
function readObject(p) {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}
function extractPair(obj) {
  const o = obj.claudeAiOauth;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.accessToken !== 'string' || typeof o.refreshToken !== 'string' || typeof o.expiresAt !== 'number') return null;
  return { accessToken: o.accessToken, refreshToken: o.refreshToken, expiresAt: o.expiresAt, scopes: Array.isArray(o.scopes) ? o.scopes.filter((s) => typeof s === 'string') : [] };
}
function writeAtomic(p, obj, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-donel-' + process.pid + '-' + Date.now();
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, p);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}
function fingerprint() {
  const account = readObject(claudeJsonPath).oauthAccount;
  const uuid = account && typeof account === 'object' ? account.accountUuid : null;
  return typeof uuid === 'string' && uuid ? crypto.createHash('sha256').update(uuid, 'utf8').digest('hex') : null;
}
function fileMode(p, fallback) {
  try { return fs.statSync(p).mode & 0o777; } catch { return fallback; }
}
let out;
try {
  const creds = readObject(credPath);
  const current = extractPair(creds);
  if (INPUT.op === 'read') {
    out = { kind: 'ok', pair: current, fingerprint: fingerprint() };
  } else {
    const currentRefresh = current ? current.refreshToken : null;
    if (currentRefresh !== INPUT.expectedRefreshToken) {
      out = { kind: 'changed' };
    } else {
      const nextCreds = Object.assign({}, creds);
      if (INPUT.next) {
        const prevOauth = creds.claudeAiOauth && typeof creds.claudeAiOauth === 'object' ? creds.claudeAiOauth : {};
        nextCreds.claudeAiOauth = Object.assign({}, prevOauth, INPUT.next);
      } else {
        delete nextCreds.claudeAiOauth;
      }
      writeAtomic(credPath, nextCreds, 0o600);
      const claudeJson = readObject(claudeJsonPath);
      if ('oauthAccount' in claudeJson) {
        delete claudeJson.oauthAccount;
        writeAtomic(claudeJsonPath, claudeJson, fileMode(claudeJsonPath, 0o600));
      }
      out = { kind: 'written' };
    }
  }
} catch (error) {
  out = { kind: 'io' };
}
process.stdout.write(JSON.stringify(out) + '\\n');
`;
}

export interface SshRunner {
  /** Roda `node -` no destino com `program` no stdin. `null` = o ssh não conseguiu (rede, host, chave, sem `node`). */
  (sshTarget: string, program: string): Promise<string | null>;
}

const SSH_TIMEOUT_MS = 30_000;

/** O `ssh` do sistema, sem senha (BatchMode): quem cuida da autenticação é a rede da pessoa (Tailscale SSH, chave). */
export function createSystemSshRunner(): SshRunner {
  return (sshTarget, program) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', '--', sshTarget, 'node -'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        finish(null);
      }, SSH_TIMEOUT_MS);
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code === 0 ? stdout : null));
      child.stdin.on('error', () => undefined);
      child.stdin.end(program);
    });
}

function parseLastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split(/\r?\n/);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parsePair(value: unknown): CredentialPair | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<CredentialPair>;
  if (typeof candidate.accessToken !== 'string' || typeof candidate.refreshToken !== 'string' || typeof candidate.expiresAt !== 'number') return null;
  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt,
    scopes: Array.isArray(candidate.scopes) ? candidate.scopes.filter((s): s is string => typeof s === 'string') : [],
  };
}

export function createRemoteClaudeState(run: SshRunner = createSystemSshRunner()): RemoteClaudeState {
  return {
    async read(sshTarget) {
      const stdout = await run(sshTarget, buildRemoteProgram({ op: 'read' }));
      if (stdout === null) return { kind: 'unreachable' };
      const out = parseLastJsonLine(stdout);
      if (!out || out.kind !== 'ok') return { kind: 'io' };
      return { kind: 'ok', pair: parsePair(out.pair), fingerprint: typeof out.fingerprint === 'string' && out.fingerprint ? out.fingerprint : null };
    },
    async write(sshTarget, expectedRefreshToken, next) {
      const stdout = await run(sshTarget, buildRemoteProgram({ op: 'write', expectedRefreshToken, next }));
      if (stdout === null) return { kind: 'unreachable' };
      const out = parseLastJsonLine(stdout);
      if (out?.kind === 'written') return { kind: 'written' };
      if (out?.kind === 'changed') return { kind: 'changed' };
      return { kind: 'io' };
    },
  };
}
